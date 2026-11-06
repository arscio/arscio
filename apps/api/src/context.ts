// Works out WHO is calling and FOR WHICH SCHOOL, on every request.
//
//  - "Authorization: Bearer <token>"  -> which person
//  - "X-School-Id: <id>"              -> which school (needed for school work)
//
// We then check the person really belongs to that school and load their roles.
// Every database query for the request runs locked to that school.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { permissionsFor, type Permission, type Role } from '@aiedu/shared';
import { withContext, type Db, type Tx } from './db.js';
import { forbidden, unauthorized } from './errors.js';
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
  async function requireLogin(req: FastifyRequest, _res: FastifyReply) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    const { accountId } = await tokens.verify(header.slice(7), 'access');
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
        await tx.query<{ id: string; roles: Role[] }>(
          `SELECT m.id, coalesce(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
             FROM memberships m
             JOIN schools s ON s.id = m.school_id AND s.status = 'active'
             LEFT JOIN membership_roles r ON r.membership_id = m.id
            WHERE m.school_id = $1 AND m.account_id = $2 AND m.status = 'active'
            GROUP BY m.id`,
          [schoolId, req.accountId],
        )
      ).rows[0],
    );
    if (!row) throw forbidden('You are not part of this school');
    req.school = {
      schoolId,
      membershipId: row.id,
      roles: row.roles,
      permissions: permissionsFor(row.roles),
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
