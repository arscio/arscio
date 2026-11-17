// Setting up a school: classes & sections, subjects, staff, and adding
// students by hand (until we have the school's Excel file).
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { nextAdmissionNo } from '../students/file.js';
import { addSection, moveStudents, seatAlerts, tidyAfterRemove } from '../students/sections.js';
import { GRANTABLE, ROLES, canAssignRole, normalizeIndianPhone, type Permission, type Role } from '@arscio/shared';
import type { Db, Tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { must, schoolTx } from '../context.js';
import type { AuthService } from '../auth/service.js';

const uuid = z.string().uuid();
const phone = z.string().transform((v, ctx) => {
  const p = normalizeIndianPhone(v);
  if (!p) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit mobile number' });
    return z.NEVER;
  }
  return p;
});
const optText = (max = 200) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
/** Was this field actually sent? (so leaving a field out never wipes it) */
const sent = (body: unknown, key: string) =>
  typeof body === 'object' && body !== null && key in body;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2015-06-21');

/** Turn database "already exists / still in use" errors into plain messages. */
function friendly(e: unknown, messages: { duplicate?: string; inUse?: string }): never {
  const code = (e as { code?: string }).code;
  if (code === '23505' && messages.duplicate) throw badRequest('duplicate', messages.duplicate);
  if (code === '23503' && messages.inUse) throw badRequest('in_use', messages.inUse);
  throw e;
}

async function currentYear(tx: Tx) {
  const y = (await tx.query<{ id: string; name: string }>(
    'SELECT id, name FROM academic_years WHERE is_current')).rows[0];
  if (!y) throw badRequest('no_year', 'No current academic year is set');
  return y;
}

export function registerSetupRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler, auth: AuthService) {
  const email = z.string().trim().toLowerCase().max(120).email('Enter a valid email address').optional().nullable()
    .or(z.literal('').transform(() => null));
  const tempPassword = z.string().min(6, 'Password must be at least 6 characters').max(128);

  /** Only an owner may change another owner's login; nobody changes their own here. */
  async function guardTarget(tx: Tx, req: Parameters<typeof must>[0], membershipId: string) {
    const t = (await tx.query<{ account_id: string; roles: string[] }>(
      `SELECT m.account_id, coalesce(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
         FROM memberships m LEFT JOIN membership_roles r ON r.membership_id = m.id
        WHERE m.id = $1 AND m.school_id = $2 GROUP BY m.id`, [membershipId, req.school!.schoolId])).rows[0];
    if (!t || !t.roles.some((r) => r !== 'parent')) throw notFound('Staff member not found');
    if (membershipId === req.school!.membershipId) throw forbidden('Use "Change password" for your own login');
    if (t.roles.includes('owner') && !req.school!.roles.includes('owner')) throw forbidden('Only the owner can change this login');
    return t.account_id;
  }
  const pre = { preHandler: requireSchool };

  // ---------- Overview of the school's structure ----------
  app.get('/setup/structure', pre, async (req) => {
    must(req, 'students.view');
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const classes = (await tx.query(
        `SELECT c.id, c.name, c.sort_order, c.assessment_style,
                coalesce((SELECT json_agg(json_build_object(
                    'id', s.id, 'name', s.name, 'seats', s.seats, 'seatsOkUpTo', s.seats_ok_up_to,
                    'classTeacherId', s.class_teacher_membership,
                    'classTeacherName', m.display_name,
                    'students', (SELECT count(*) FROM enrollments e WHERE e.section_id = s.id))
                  ORDER BY s.name)
                  FROM sections s LEFT JOIN memberships m ON m.id = s.class_teacher_membership
                  WHERE s.class_id = c.id AND s.academic_year_id = $1), '[]') AS sections,
                coalesce((SELECT array_agg(cs.subject_id ORDER BY cs.sort_order)
                  FROM class_subjects cs WHERE cs.class_id = c.id), '{}') AS subject_ids
           FROM classes c ORDER BY c.sort_order`,
        [year.id],
      )).rows;
      const subjects = (await tx.query('SELECT id, name, code FROM subjects ORDER BY name')).rows;
      return { year, classes, subjects, seatAlerts: await seatAlerts(tx, year.id) };
    });
  });

  // ---------- Sections ----------
  app.post('/sections', pre, async (req) => {
    must(req, 'school.settings');
    const b = z.object({ classId: uuid, name: z.string().trim().max(20).optional() }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      return addSection(tx, req.school!.schoolId, b.classId, year.id, b.name);
    });
  });

  /** Make a new section and move the chosen students into it, in one go. */
  app.post('/classes/:id/split', pre, async (req) => {
    must(req, 'school.settings');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ studentIds: z.array(uuid).min(1, 'Choose who moves to the new section').max(500) }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const sec = await addSection(tx, req.school!.schoolId, id, year.id);
      const moved = await moveStudents(tx, b.studentIds, sec.id);
      // Deciding is done: the sections start fresh.
      await tx.query('UPDATE sections SET seats_ok_up_to = NULL WHERE class_id = $1 AND academic_year_id = $2', [id, year.id]);
      return { section: sec, moved };
    });
  });

  /** Move students to another section of the same class. */
  app.post('/students/move', pre, async (req) => {
    must(req, 'school.settings');
    const b = z.object({ studentIds: z.array(uuid).min(1).max(500), toSectionId: uuid }).parse(req.body);
    return schoolTx(db, req, async (tx) => ({ moved: await moveStudents(tx, b.studentIds, b.toSectionId) }));
  });

  /** "Keep as it is": the principal accepts more students than seats; asked again only if more join. */
  app.post('/sections/:id/keep', pre, async (req) => {
    must(req, 'school.settings');
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const r = await tx.query(
        `UPDATE sections s SET seats_ok_up_to = (SELECT count(*) FROM enrollments e WHERE e.section_id = s.id)
          WHERE s.id = $1 RETURNING seats_ok_up_to AS "seatsOkUpTo"`, [id]);
      if (!r.rowCount) throw notFound('Section not found');
      return r.rows[0];
    });
  });

  app.patch('/sections/:id', pre, async (req) => {
    must(req, 'school.settings');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      name: z.string().trim().min(1).max(20).optional(),
      classTeacherId: uuid.nullable().optional(),
      seats: z.number().int().min(1, 'Seats must be at least 1').max(500).nullable().optional(),
    }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      if (b.name) {
        const only = (await tx.query(`SELECT name = '' AS plain FROM sections WHERE id = $1`, [id])).rows[0];
        if (only?.plain) throw badRequest('single_section', 'A class with one section has no letter. Add a second section first.');
      }
      const r = await tx.query(
        `UPDATE sections SET
           name = coalesce(upper($2), name),
           class_teacher_membership = CASE WHEN $4 THEN $3::uuid ELSE class_teacher_membership END,
           seats = CASE WHEN $6 THEN $5::int ELSE seats END,
           seats_ok_up_to = CASE WHEN $6 THEN NULL ELSE seats_ok_up_to END
         WHERE id = $1 RETURNING id, name, seats, class_teacher_membership AS "classTeacherId"`,
        [id, b.name ?? null, b.classTeacherId ?? null, b.classTeacherId !== undefined, b.seats ?? null, b.seats !== undefined],
      ).catch((e) => friendly(e, { duplicate: 'That section name is already used in this class' }));
      if (!r.rowCount) throw notFound('Section not found');
      return r.rows[0];
    });
  });

  app.delete('/sections/:id', pre, async (req) => {
    must(req, 'school.settings');
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const sec = (await tx.query<{ class_id: string; academic_year_id: string }>(
        'SELECT class_id, academic_year_id FROM sections WHERE id = $1', [id])).rows[0];
      if (!sec) throw notFound('Section not found');
      await tx.query('DELETE FROM section_teachers WHERE section_id = $1', [id]);
      await tx.query('DELETE FROM sections WHERE id = $1', [id])
        .catch((e) => friendly(e, { inUse: 'This section has students or records in it. Move its students to another section first.' }));
      await tidyAfterRemove(tx, sec.class_id, sec.academic_year_id);
      return { ok: true };
    });
  });

  /** Which teacher teaches which subject in a section. */
  app.get('/sections/:id/teachers', pre, async (req) => {
    must(req, 'students.view');
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => ({
      teachers: (await tx.query(
        `SELECT st.subject_id AS "subjectId", st.membership_id AS "membershipId", m.display_name AS "name"
           FROM section_teachers st JOIN memberships m ON m.id = st.membership_id
          WHERE st.section_id = $1`, [id])).rows,
    }));
  });

  app.put('/sections/:id/teachers', pre, async (req) => {
    must(req, 'school.settings');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { assignments } = z.object({
      assignments: z.array(z.object({ subjectId: uuid, membershipId: uuid })).max(100),
    }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      await tx.query('DELETE FROM section_teachers WHERE section_id = $1', [id]);
      for (const a of assignments) {
        await tx.query(
          'INSERT INTO section_teachers (school_id, section_id, subject_id, membership_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [req.school!.schoolId, id, a.subjectId, a.membershipId],
        );
      }
      return { ok: true, count: assignments.length };
    });
  });

  // ---------- Classes ----------
  app.patch('/classes/:id', pre, async (req) => {
    must(req, 'school.settings');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ assessmentStyle: z.enum(['grades_only', 'marks_and_grades']) }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const r = await tx.query('UPDATE classes SET assessment_style = $2 WHERE id = $1 RETURNING id, assessment_style', [id, b.assessmentStyle]);
      if (!r.rowCount) throw notFound('Class not found');
      return r.rows[0];
    });
  });

  app.put('/classes/:id/subjects', pre, async (req) => {
    must(req, 'school.settings');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { subjectIds } = z.object({ subjectIds: z.array(uuid).max(40) }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      await tx.query('DELETE FROM class_subjects WHERE class_id = $1', [id]);
      for (const [i, s] of subjectIds.entries()) {
        await tx.query(
          'INSERT INTO class_subjects (school_id, class_id, subject_id, sort_order) VALUES ($1, $2, $3, $4)',
          [req.school!.schoolId, id, s, i],
        );
      }
      return { ok: true };
    });
  });

  // ---------- Subjects ----------
  app.post('/subjects', pre, async (req) => {
    must(req, 'school.settings');
    const b = z.object({ name: z.string().trim().min(1).max(60), code: optText(20) }).parse(req.body);
    return schoolTx(db, req, async (tx) =>
      (await tx.query('INSERT INTO subjects (school_id, name, code) VALUES ($1, $2, $3) RETURNING id, name, code',
        [req.school!.schoolId, b.name, b.code])
        .catch((e) => friendly(e, { duplicate: `"${b.name}" already exists` }))).rows[0]);
  });

  app.patch('/subjects/:id', pre, async (req) => {
    must(req, 'school.settings');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ name: z.string().trim().min(1).max(60), code: optText(20) }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const r = await tx.query('UPDATE subjects SET name = $2, code = $3 WHERE id = $1 RETURNING id, name, code', [id, b.name, b.code])
        .catch((e) => friendly(e, { duplicate: `"${b.name}" already exists` }));
      if (!r.rowCount) throw notFound('Subject not found');
      return r.rows[0];
    });
  });

  app.delete('/subjects/:id', pre, async (req) => {
    must(req, 'school.settings');
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const r = await tx.query('DELETE FROM subjects WHERE id = $1', [id])
        .catch((e) => friendly(e, { inUse: 'This subject is used by classes, teachers or marks. Remove it from those first.' }));
      if (!r.rowCount) throw notFound('Subject not found');
      return { ok: true };
    });
  });

  // ---------- Staff ----------
  app.get('/staff', pre, async (req) => {
    must(req, 'students.view');
    return schoolTx(db, req, async (tx) => ({
      staff: (await tx.query(
        `SELECT m.id AS "membershipId", m.account_id AS "accountId", m.display_name AS name,
                m.designation, m.employee_code AS "employeeCode", m.status, a.phone, a.email,
                (a.password_hash IS NOT NULL) AS "hasLoggedIn", a.must_change_password AS "mustChangePassword",
                coalesce(array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles,
                (SELECT coalesce(array_agg(p.permission), '{}') FROM membership_permissions p WHERE p.membership_id = m.id) AS extra
           FROM memberships m
           JOIN accounts a ON a.id = m.account_id
           LEFT JOIN membership_roles r ON r.membership_id = m.id
          WHERE m.school_id = app_school_id()
          GROUP BY m.id, a.id
         HAVING bool_or(r.role IS DISTINCT FROM 'parent')
          ORDER BY m.status, m.display_name`)).rows,
    }));
  });

  app.post('/staff', pre, async (req) => {
    must(req, 'roles.assign');
    const b = z.object({
      name: z.string().trim().min(2).max(100),
      phone,
      email,
      // First password, given by the principal. The teacher must change it after logging in.
      password: tempPassword.optional(),
      designation: optText(60),
      employeeCode: optText(30),
      roles: z.array(z.enum(ROLES)).min(1, 'Choose at least one role'),
    }).parse(req.body);
    if (b.roles.includes('parent')) throw badRequest('bad_role', 'Parents get their login from the student record');
    for (const r of new Set<Role>(b.roles)) {
      if (!canAssignRole(req.school!.roles, r)) throw forbidden(`You cannot give the ${r} role`);
    }
    return schoolTx(db, req, async (tx) => {
      const account = (await tx.query<{ id: string }>(
        `INSERT INTO accounts (phone, name) VALUES ($1, $2)
         ON CONFLICT (phone) DO UPDATE SET phone = excluded.phone RETURNING id`, [b.phone, b.name])).rows[0]!;
      if (b.email) await setEmail(tx, account.id, b.email);
      const existing = (await tx.query<{ id: string }>(
        'SELECT id FROM memberships WHERE account_id = $1 AND school_id = $2', [account.id, req.school!.schoolId])).rows[0];
      let membershipId: string;
      if (existing) {
        // e.g. a parent at this school who is also a teacher - one person, many roles
        const isStaff = (await tx.query(
          "SELECT 1 FROM membership_roles WHERE membership_id = $1 AND role <> 'parent'", [existing.id])).rowCount;
        if (isStaff) throw badRequest('duplicate', 'This phone number is already on the staff list');
        membershipId = existing.id;
        await tx.query('UPDATE memberships SET display_name = $2, designation = $3, employee_code = $4 WHERE id = $1',
          [membershipId, b.name, b.designation, b.employeeCode]);
      } else {
        membershipId = (await tx.query<{ id: string }>(
          `INSERT INTO memberships (school_id, account_id, display_name, designation, employee_code)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [req.school!.schoolId, account.id, b.name, b.designation, b.employeeCode])).rows[0]!.id;
      }
      for (const r of new Set(b.roles)) {
        await tx.query(
          `INSERT INTO membership_roles (school_id, membership_id, role, assigned_by)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [req.school!.schoolId, membershipId, r, req.accountId]);
      }
      return { membershipId, accountId: account.id };
    }).then(async (r) => {
      // Saved after the staff record, so a failed save never leaves a stray password behind.
      if (b.password) {
        const has = (await db.query('SELECT password_hash IS NOT NULL AS has FROM accounts WHERE id = $1', [r.accountId])).rows[0]?.has;
        if (!has) await auth.setTemporaryPassword(r.accountId, b.password);
      }
      return r;
    });
  });

  /** Principal gives a staff member a new password (first login, or they forgot it). */
  app.post('/staff/:membershipId/password', pre, async (req) => {
    must(req, 'roles.assign');
    const { membershipId } = z.object({ membershipId: uuid }).parse(req.params);
    const { password } = z.object({ password: tempPassword }).parse(req.body);
    const accountId = await schoolTx(db, req, async (tx) => {
      const id = await guardTarget(tx, req, membershipId);
      await tx.query(
        `INSERT INTO audit_log (school_id, account_id, action, table_name, row_id)
         VALUES ($1, $2, 'SET_STAFF_PASSWORD', 'accounts', $3)`, [req.school!.schoolId, req.accountId, id]);
      return id;
    });
    await auth.setTemporaryPassword(accountId, password);
    return { ok: true };
  });

  app.patch('/staff/:membershipId', pre, async (req) => {
    must(req, 'roles.assign');
    const { membershipId } = z.object({ membershipId: uuid }).parse(req.params);
    const b = z.object({
      name: z.string().trim().min(2).max(100).optional(),
      designation: optText(60),
      employeeCode: optText(30),
      email,
      status: z.enum(['active', 'inactive']).optional(),
    }).parse(req.body);
    if (b.status === 'inactive' && membershipId === req.school!.membershipId) {
      throw forbidden('You cannot deactivate yourself');
    }
    let removedAccount: string | null = null;
    const result = await schoolTx(db, req, async (tx) => {
      if (b.status || b.email !== undefined) {
        const accountId = await guardTarget(tx, req, membershipId);
        if (b.email !== undefined) await setEmail(tx, accountId, b.email);
        if (b.status === 'inactive') removedAccount = accountId;
      }
      const r = await tx.query(
        `UPDATE memberships SET display_name = coalesce($2, display_name),
           designation = CASE WHEN $7 THEN $3 ELSE designation END,
           employee_code = CASE WHEN $8 THEN $4 ELSE employee_code END,
           status = coalesce($5, status)
         WHERE id = $1 AND school_id = $6 RETURNING id`,
        [membershipId, b.name ?? null, b.designation, b.employeeCode, b.status ?? null, req.school!.schoolId,
         sent(req.body, 'designation'), sent(req.body, 'employeeCode')]);
      if (!r.rowCount) throw notFound('Staff member not found');
      return { ok: true };
    });
    // A teacher who has left is logged out of every phone and computer straight away
    // (unless they are still a parent here, in which case only the staff access goes).
    if (removedAccount) await auth.revokeAll(removedAccount);
    return result;
  });

  /** Give or take away an extra permission (e.g. Excel import and export). Owner and principal only. */
  app.put('/staff/:membershipId/permissions/:permission', pre, async (req) => {
    must(req, 'roles.assign');
    const p = z.object({ membershipId: uuid, permission: z.enum(GRANTABLE as [Permission, ...Permission[]]) }).parse(req.params);
    const { on } = z.object({ on: z.boolean() }).parse(req.body);
    if (!req.school!.roles.some((r) => r === 'owner' || r === 'principal')) throw forbidden('Only the owner or principal can give this');
    return schoolTx(db, req, async (tx) => {
      const m = await tx.query('SELECT 1 FROM memberships WHERE id = $1 AND school_id = app_school_id()', [p.membershipId]);
      if (!m.rowCount) throw notFound('Staff member not found');
      if (on) {
        await tx.query(`INSERT INTO membership_permissions (school_id, membership_id, permission, granted_by) VALUES (app_school_id(), $1, $2, $3)
                        ON CONFLICT DO NOTHING`, [p.membershipId, p.permission, req.accountId]);
      } else {
        await tx.query('DELETE FROM membership_permissions WHERE membership_id = $1 AND permission = $2', [p.membershipId, p.permission]);
      }
      return { ok: true };
    });
  });

  // ---------- Students (added by hand) ----------
  app.get('/students', pre, async (req) => {
    must(req, 'students.view');
    const q = z.object({
      sectionId: uuid.optional(),
      search: z.string().trim().max(60).optional(),
      status: z.enum(['active', 'left', 'passed_out', 'transferred', 'all']).default('active'),
    }).parse(req.query);
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const rows = (await tx.query(
        `SELECT st.id, st.admission_no AS "admissionNo", st.first_name AS "firstName", st.last_name AS "lastName",
                st.gender, st.date_of_birth AS "dateOfBirth", st.status,
                c.name AS "className", sec.name AS "sectionName", sec.id AS "sectionId", e.roll_no AS "rollNo",
                f.phone AS "familyPhone", f.father_name AS "fatherName", f.mother_name AS "motherName"
           FROM students st
           JOIN families f ON f.id = st.family_id
           LEFT JOIN enrollments e ON e.student_id = st.id AND e.academic_year_id = $1
           LEFT JOIN sections sec ON sec.id = e.section_id
           LEFT JOIN classes c ON c.id = sec.class_id
          WHERE ($2::uuid IS NULL OR e.section_id = $2)
            AND ($3 = 'all' OR st.status = $3)
            AND ($4::text IS NULL OR st.first_name || ' ' || coalesce(st.last_name, '') ILIKE '%' || $4 || '%'
                 OR st.admission_no ILIKE $4 || '%' OR f.phone LIKE '%' || $4 || '%')
          ORDER BY c.sort_order NULLS LAST, sec.name, e.roll_no NULLS LAST, st.first_name
          LIMIT 500`,
        [year.id, q.sectionId ?? null, q.status, q.search || null])).rows;
      return { students: rows };
    });
  });

  const studentBody = z.object({
    admissionNo: z.string().trim().max(30).optional().nullable(),
    aadhaarLast4: z.string().regex(/^\d{4}$/, 'Enter only the last 4 digits of Aadhaar').optional().nullable(),
    firstName: z.string().trim().min(1, 'First name is required').max(60),
    lastName: optText(60),
    dateOfBirth: date.optional().nullable(),
    gender: z.enum(['male', 'female', 'other']).optional().nullable(),
    bloodGroup: optText(5),
    admissionDate: date.optional().nullable(),
    sectionId: uuid,
    rollNo: z.number().int().min(1).max(999).optional().nullable(),
    family: z.object({
      phone,
      fatherName: optText(100),
      motherName: optText(100),
      guardianName: optText(100),
      altPhone: optText(15),
      address: optText(300),
    }),
  });

  /**
   * Add a student. The family is found by phone number (one phone per family);
   * if it's new, it is created along with the parent's login, so the parent
   * can log into the app with that number and see ALL their children.
   */
  app.post('/students', pre, async (req) => {
    must(req, 'students.manage');
    const b = studentBody.parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const schoolId = req.school!.schoolId;
      const parentName = b.family.fatherName ?? b.family.motherName ?? b.family.guardianName ?? 'Parent';

      // Parent login (shared across schools, identified by phone)
      const account = (await tx.query<{ id: string }>(
        `INSERT INTO accounts (phone, name) VALUES ($1, $2)
         ON CONFLICT (phone) DO UPDATE SET phone = excluded.phone RETURNING id`, [b.family.phone, parentName])).rows[0]!;
      let membership = (await tx.query<{ id: string }>(
        'SELECT id FROM memberships WHERE account_id = $1 AND school_id = $2', [account.id, schoolId])).rows[0];
      if (!membership) {
        membership = (await tx.query<{ id: string }>(
          'INSERT INTO memberships (school_id, account_id, display_name) VALUES ($1, $2, $3) RETURNING id',
          [schoolId, account.id, parentName])).rows[0]!;
      }
      await tx.query(
        `INSERT INTO membership_roles (school_id, membership_id, role, assigned_by)
         VALUES ($1, $2, 'parent', $3) ON CONFLICT DO NOTHING`, [schoolId, membership.id, req.accountId]);

      // Family (fill in any details that were blank before)
      const family = (await tx.query<{ id: string; created: boolean }>(
        `INSERT INTO families (school_id, phone, account_id, father_name, mother_name, guardian_name, alt_phone, address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (school_id, phone) DO UPDATE SET
           account_id = coalesce(families.account_id, excluded.account_id),
           father_name = coalesce(families.father_name, excluded.father_name),
           mother_name = coalesce(families.mother_name, excluded.mother_name),
           guardian_name = coalesce(families.guardian_name, excluded.guardian_name),
           alt_phone = coalesce(families.alt_phone, excluded.alt_phone),
           address = coalesce(families.address, excluded.address)
         RETURNING id, (xmax = 0) AS created`,
        [schoolId, b.family.phone, account.id, b.family.fatherName, b.family.motherName,
         b.family.guardianName, b.family.altPhone, b.family.address])).rows[0]!;

      // Blank admission number -> the system gives the next one (GV/2027/0187)
      const admissionNo = b.admissionNo || await nextAdmissionNo(tx, schoolId,
        Number((b.admissionDate ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })).slice(0, 4)));
      const student = (await tx.query<{ id: string }>(
        `INSERT INTO students (school_id, family_id, admission_no, first_name, last_name, date_of_birth,
                               gender, blood_group, admission_date, aadhaar_last4)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [schoolId, family.id, admissionNo, b.firstName, b.lastName, b.dateOfBirth ?? null,
         b.gender ?? null, b.bloodGroup, b.admissionDate ?? null, b.aadhaarLast4 ?? null])
        .catch((e) => friendly(e, { duplicate: `Admission number ${admissionNo} is already used` }))).rows[0]!;

      await tx.query(
        `INSERT INTO enrollments (school_id, student_id, academic_year_id, section_id, roll_no)
         VALUES ($1, $2, $3, $4, $5)`, [schoolId, student.id, year.id, b.sectionId, b.rollNo ?? null]);

      const siblings = (await tx.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM students WHERE family_id = $1 AND id <> $2', [family.id, student.id])).rows[0]!.n;
      // Admission is never blocked by seats; the principal is told and decides on the home screen.
      const full = (await tx.query<{ label: string; students: number; seats: number }>(
        `SELECT section_label(c.name, s.name) AS label, s.seats,
                (SELECT count(*)::int FROM enrollments e WHERE e.section_id = s.id) AS students
           FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.id = $1`, [b.sectionId])).rows[0];
      const overSeats = full && full.seats != null && full.students > full.seats ? full : null;
      return { id: student.id, admissionNo, familyId: family.id, newFamily: family.created, siblings, overSeats };
    });
  });

  app.get('/students/:id', pre, async (req) => {
    must(req, 'students.view');
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const s = (await tx.query(
        `SELECT st.id, st.admission_no AS "admissionNo", st.first_name AS "firstName", st.last_name AS "lastName",
                st.date_of_birth AS "dateOfBirth", st.gender, st.blood_group AS "bloodGroup",
                st.admission_date AS "admissionDate", st.status,
                e.section_id AS "sectionId", e.roll_no AS "rollNo", st.photo_url AS "photoUrl",
                c.name AS "className", sec.name AS "sectionName",
                json_build_object('phone', f.phone, 'fatherName', f.father_name, 'motherName', f.mother_name,
                  'guardianName', f.guardian_name, 'altPhone', f.alt_phone, 'address', f.address) AS family,
                (SELECT json_agg(json_build_object('id', o.id, 'name', o.first_name || ' ' || coalesce(o.last_name, '')))
                   FROM students o WHERE o.family_id = st.family_id AND o.id <> st.id) AS siblings
           FROM students st JOIN families f ON f.id = st.family_id
           LEFT JOIN enrollments e ON e.student_id = st.id AND e.academic_year_id = $2
           LEFT JOIN sections sec ON sec.id = e.section_id
           LEFT JOIN classes c ON c.id = sec.class_id
          WHERE st.id = $1`, [id, year.id])).rows[0];
      if (!s) throw notFound('Student not found');
      return s;
    });
  });

  app.patch('/students/:id', pre, async (req) => {
    must(req, 'students.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = studentBody.omit({ family: true }).partial().extend({
      status: z.enum(['active', 'left', 'passed_out', 'transferred']).optional(),
      family: studentBody.shape.family.omit({ phone: true }).partial().optional(),
    }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const r = await tx.query(
        `UPDATE students SET
           admission_no = coalesce($2, admission_no), first_name = coalesce($3, first_name),
           last_name = CASE WHEN $4 THEN $5 ELSE last_name END,
           date_of_birth = CASE WHEN $6 THEN $7::date ELSE date_of_birth END,
           gender = CASE WHEN $8 THEN $9 ELSE gender END,
           status = coalesce($10, status),
           left_on = CASE WHEN $10 IS NOT NULL AND $10 <> 'active' THEN coalesce(left_on, current_date)
                          WHEN $10 = 'active' THEN NULL ELSE left_on END
         WHERE id = $1 RETURNING family_id`,
        [id, b.admissionNo ?? null, b.firstName ?? null,
         sent(req.body, 'lastName'), b.lastName ?? null, sent(req.body, 'dateOfBirth'), b.dateOfBirth ?? null,
         sent(req.body, 'gender'), b.gender ?? null, b.status ?? null])
        .catch((e) => friendly(e, { duplicate: `Admission number ${b.admissionNo} is already used` }));
      if (!r.rowCount) throw notFound('Student not found');
      const rollSent = sent(req.body, 'rollNo');
      if (b.sectionId || rollSent) {
        await tx.query(
          `INSERT INTO enrollments (school_id, student_id, academic_year_id, section_id, roll_no)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (student_id, academic_year_id) DO UPDATE SET
             section_id = coalesce($4, enrollments.section_id),
             roll_no = CASE WHEN $6 THEN $5 ELSE enrollments.roll_no END`,
          [req.school!.schoolId, id, year.id, b.sectionId ?? null, b.rollNo ?? null, rollSent]);
      }
      if (b.family) {
        const f = b.family;
        const raw = (req.body as { family: object }).family;
        await tx.query(
          `UPDATE families SET
             father_name = CASE WHEN $2 THEN $3 ELSE father_name END,
             mother_name = CASE WHEN $4 THEN $5 ELSE mother_name END,
             guardian_name = CASE WHEN $6 THEN $7 ELSE guardian_name END,
             alt_phone = CASE WHEN $8 THEN $9 ELSE alt_phone END,
             address = CASE WHEN $10 THEN $11 ELSE address END
           WHERE id = $1`,
          [r.rows[0].family_id, sent(raw, 'fatherName'), f.fatherName ?? null, sent(raw, 'motherName'), f.motherName ?? null,
           sent(raw, 'guardianName'), f.guardianName ?? null, sent(raw, 'altPhone'), f.altPhone ?? null,
           sent(raw, 'address'), f.address ?? null]);
      }
      return { ok: true };
    });
  });

  // ---------- School profile ----------
  app.patch('/school/profile', pre, async (req) => {
    must(req, 'school.settings');
    const b = z.object({
      name: z.string().trim().min(2).max(150).optional(),
      address: optText(300), phone: optText(20), email: optText(100),
    }).parse(req.body);
    return schoolTx(db, req, async (tx) =>
      (await tx.query(
        `UPDATE schools SET name = coalesce($2, name),
           address = CASE WHEN $6 THEN $3 ELSE address END,
           phone = CASE WHEN $7 THEN $4 ELSE phone END,
           email = CASE WHEN $8 THEN $5 ELSE email END
          WHERE id = $1 RETURNING name, address, phone, email`,
        [req.school!.schoolId, b.name ?? null, b.address, b.phone, b.email,
         sent(req.body, 'address'), sent(req.body, 'phone'), sent(req.body, 'email')])).rows[0]);
  });
}

/** Email used for staff login: one account per email address. */
async function setEmail(tx: Tx, accountId: string, email: string | null) {
  try {
    await tx.query('SAVEPOINT set_email');
    await tx.query('UPDATE accounts SET email = $2 WHERE id = $1', [accountId, email]);
    await tx.query('RELEASE SAVEPOINT set_email');
  } catch (e) {
    await tx.query('ROLLBACK TO SAVEPOINT set_email');
    if ((e as { code?: string }).code === '23505') throw badRequest('duplicate', 'This email is already used by another login');
    throw e;
  }
}
