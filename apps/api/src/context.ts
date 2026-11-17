// Works out WHO is calling and FOR WHICH SCHOOL, on every request.
//
//  - "Authorization: Bearer <token>"  -> which person
//  - "X-School-Id: <id>"              -> which school (needed for school work)
//
// We then check the person really belongs to that school and load their roles.
// Every database query for the request runs locked to that school.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { permissionsFor, type Permission, type Role } from '@arscio/shared';
import { withContext, type Db, type Tx } from './db.js';
import { AppError, forbidden, unauthorized } from './errors.js';
import type { Tokens } from './auth/tokens.js';

export interface SchoolCtx {
  schoolId: string;
  membershipId: string;
  roles: Role[];
  permissions: Set<Permission>;
}

declare module 'fastify' {
  interface FastifyRequest {
    accountId: string | null;
    school: SchoolCtx | null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function makeGuards(db: Db, tokens: Tokens) {
  /** Must be logged in. */
  const MUST_CHANGE_ALLOWED = new Set(['/auth/change-password', '/me']);
  async function requireLogin(req: FastifyRequest, _res: FastifyReply) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    const { accountId, payload } = await tokens.verify(header.slice(7), 'access');
    // Someone who must choose a new password can only do that (and see who they are) until it's done.
    if (payload.mcp && !MUST_CHANGE_ALLOWED.has(req.routeOptions.url ?? '')) {
      throw new AppError(403, 'must_change_password', 'Please choose a new password first');
    }
    req.accountId = accountId;
  }

  /** Must be logged in AND an active member of the school in X-School-Id. */
  async function requireSchool(req: FastifyRequest, res: FastifyReply) {
    await requireLogin(req, res);
    const schoolId = req.headers['x-school-id'];
    if (typeof schoolId !== 'string' || !UUID.test(schoolId)) {
      throw forbidden('Please choose a school');
    }
    const row = await withContext(db, { schoolId, accountId: req.accountId }, async (tx) =>
      (
        await tx.query<{ id: string; roles: Role[]; extra: Permission[]; school_status: string }>(
          `SELECT m.id, s.status AS school_status, coalesce(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles,
                  (SELECT coalesce(array_agg(p.permission), '{}') FROM membership_permissions p WHERE p.membership_id = m.id) AS extra
             FROM memberships m
             JOIN schools s ON s.id = m.school_id
             LEFT JOIN membership_roles r ON r.membership_id = m.id
            WHERE m.school_id = $1 AND m.account_id = $2 AND m.status = 'active'
            GROUP BY m.id, s.status`,
          [schoolId, req.accountId],
        )
      ).rows[0],
    );
    if (!row) throw forbidden('You are not part of this school');
    // Paused from the Arscio control panel (for example, an unpaid account).
    if (row.school_status !== 'active') {
      throw new AppError(403, 'school_paused', "This school's Arscio account is paused. Please contact the school office.");
    }
    req.school = {
      schoolId,
      membershipId: row.id,
      roles: row.roles,
      permissions: permissionsFor(row.roles, row.extra),
    };
  }

  return { requireLogin, requireSchool };
}

export function can(req: FastifyRequest, perm: Permission): boolean {
  return req.school?.permissions.has(perm) ?? false;
}

export function must(req: FastifyRequest, perm: Permission): void {
  if (!can(req, perm)) throw forbidden();
}

/** Run database work locked to this request's school and person. */
export function schoolTx<T>(db: Db, req: FastifyRequest, work: (tx: Tx) => Promise<T>) {
  if (!req.school || !req.accountId) throw unauthorized();
  return withContext(db, { schoolId: req.school.schoolId, accountId: req.accountId }, work);
}
