// Parent logins (password mode): who has logged in, missing dates of birth,
// printable login slips, and "reset back to date of birth" for the office.
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { must, schoolTx } from '../context.js';
import type { AuthService } from '../auth/service.js';
import { normaliseAdmissionNo } from '../auth/service.js';
import { schoolInfo } from './certificates.js';
import { parentSlipsPdf } from '../logins/slips.js';

const classLabel = (n: string) => (/^\d+$/.test(n) ? `Class ${n}` : n);

export function registerParentLoginRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler,
  auth: AuthService, appDownloadUrl?: string) {
  const pre = { preHandler: requireSchool };

  /** Students with their family's login status. Without sectionId: only problems (missing DOB, locked). */
  app.get('/parent-logins', pre, async (req) => {
    must(req, 'students.view');
    const q = z.object({ sectionId: z.string().uuid().optional() }).parse(req.query);
    return schoolTx(db, req, async (tx) => {
      const rows = (await tx.query(
        `SELECT st.id, trim(st.first_name || ' ' || coalesce(st.last_name, '')) AS name, st.admission_no AS "admissionNo",
                st.date_of_birth IS NOT NULL AS "hasDob", c.name AS "className", sec.name AS "sectionName", e.roll_no AS "rollNo",
                f.phone AS "familyPhone", f.account_id AS "accountId",
                CASE WHEN a.id IS NULL OR a.password_hash IS NULL THEN 'not_started'
                     WHEN a.must_change_password THEN 'not_started'
                     ELSE 'active' END AS status,
                (a.locked_until > now()) IS TRUE AS "accountLocked"
           FROM students st
           JOIN families f ON f.id = st.family_id
           LEFT JOIN accounts a ON a.id = f.account_id
           LEFT JOIN enrollments e ON e.student_id = st.id
                AND e.academic_year_id = (SELECT id FROM academic_years WHERE school_id = app_school_id() AND is_current)
           LEFT JOIN sections sec ON sec.id = e.section_id
           LEFT JOIN classes c ON c.id = sec.class_id
          WHERE st.status = 'active' AND ($1::uuid IS NULL OR e.section_id = $1)
          ORDER BY c.sort_order NULLS LAST, sec.name, e.roll_no NULLS LAST, st.first_name`,
        [q.sectionId ?? null])).rows as {
          id: string; admissionNo: string; hasDob: boolean; accountLocked: boolean; locked?: boolean; className: string | null;
        }[];
      // Locks on first-time logins are kept by admission number.
      const keys = rows.map((r) => `adm:${normaliseAdmissionNo(r.admissionNo)}`);
      const locked = new Set((await db.query<{ login_key: string }>(
        'SELECT login_key FROM login_failures WHERE login_key = ANY($1) AND locked_until > now()', [keys])).rows.map((r) => r.login_key));
      for (const r of rows) r.locked = r.accountLocked || locked.has(`adm:${normaliseAdmissionNo(r.admissionNo)}`);
      const missingDob = rows.filter((r) => !r.hasDob).length;
      return {
        students: q.sectionId ? rows : rows.filter((r) => !r.hasDob || r.locked),
        missingDob,
        appDownloadUrl: appDownloadUrl ?? null,
      };
    });
  });

  /** Printable slips for a class (one per family). */
  app.get('/parent-logins/slips.pdf', pre, async (req, reply) => {
    must(req, 'students.view');
    const q = z.object({ sectionId: z.string().uuid(), onlyNew: z.enum(['0', '1']).default('0') }).parse(req.query);
    const { school, slips, label } = await schoolTx(db, req, async (tx) => {
      const sec = (await tx.query<{ label: string }>(
        `SELECT c.name || '-' || s.name AS label, c.name AS cname, s.name AS sname FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.id = $1`,
        [q.sectionId])).rows[0];
      if (!sec) throw notFound('Class not found');
      const rows = (await tx.query<{ name: string; adm: string; has_dob: boolean; family_id: string; cls: string; sec: string; started: boolean }>(
        `SELECT trim(st.first_name || ' ' || coalesce(st.last_name, '')) AS name, st.admission_no AS adm,
                st.date_of_birth IS NOT NULL AS has_dob, st.family_id, c.name AS cls, sec.name AS sec,
                (a.password_hash IS NOT NULL AND NOT a.must_change_password) IS TRUE AS started
           FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
           JOIN sections sec ON sec.id = e.section_id JOIN classes c ON c.id = sec.class_id
           JOIN families f ON f.id = st.family_id LEFT JOIN accounts a ON a.id = f.account_id
          WHERE e.section_id = $1 ORDER BY e.roll_no NULLS LAST, st.first_name`, [q.sectionId])).rows;
      const seen = new Set<string>();
      const slips = rows.filter((r) => {
        if (q.onlyNew === '1' && r.started) return false;
        if (seen.has(r.family_id)) return false; // one login per family
        seen.add(r.family_id);
        return true;
      }).map((r) => ({ studentName: r.name, className: `${classLabel(r.cls)}, Section ${r.sec}`, admissionNo: r.adm, hasDob: r.has_dob }));
      return { school: (await schoolInfo(tx)).name as string, slips, label: sec.label };
    });
    const pdf = await parentSlipsPdf(school, slips, appDownloadUrl);
    return reply.header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="login-slips-${label.replace(/[^A-Za-z0-9-]/g, '')}.pdf"`)
      .header('cache-control', 'private, no-store').send(pdf);
  });

  /** Office: the parent forgot their password or is locked out -> back to the child's date of birth. */
  app.post('/parent-logins/:studentId/reset', pre, async (req) => {
    must(req, 'accounts.reset_login');
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(req.params);
    const fam = await schoolTx(db, req, async (tx) => {
      const f = (await tx.query<{ account_id: string | null; adms: string[]; staff: boolean }>(
        `SELECT f.account_id, array_agg(o.admission_no) AS adms,
                EXISTS (SELECT 1 FROM memberships m JOIN membership_roles r ON r.membership_id = m.id
                         WHERE m.account_id = f.account_id AND r.role <> 'parent') AS staff
           FROM students st JOIN families f ON f.id = st.family_id JOIN students o ON o.family_id = f.id
          WHERE st.id = $1 GROUP BY f.id`, [studentId])).rows[0];
      if (!f) throw notFound('Student not found');
      if (f.staff) throw badRequest('is_staff', 'This parent also works at the school. The principal can give them a new password from Staff.');
      await tx.query(
        `INSERT INTO audit_log (school_id, account_id, action, table_name, row_id)
         VALUES (app_school_id(), $1, 'RESET_PARENT_LOGIN', 'students', $2)`, [req.accountId, studentId]);
      return f;
    });
    if (fam.account_id) await auth.resetLogin(fam.account_id);
    await db.query('DELETE FROM login_failures WHERE login_key = ANY($1)', [fam.adms.map((a) => `adm:${normaliseAdmissionNo(a)}`)]);
    return { ok: true };
  });
}
