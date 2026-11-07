// Fees: setting up the fee structure, working out what each child owes,
// concessions, receipts, the day book, defaulters and summaries.
//
// How it fits together (plain words):
//   fee types (Tuition, Transport...)  x  instalments (Apr-Jun, Jul-Sep...)
//   -> an amount for each class          (the "fee structure")
//   -> "Generate dues": every child gets lines of what they owe
//   -> concessions reduce those lines (sibling 10%, staff ward 50%...)
//   -> collecting at the counter creates a receipt against those lines
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Db, Tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { can, must, schoolTx } from '../context.js';
import { todayIST } from './attendance.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const s = String(v).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) { ctx.addIssue({ code: 'custom', message: 'Enter an amount like 1500 or 1500.50' }); return z.NEVER; }
  return s;
});

const friendly = (e: unknown, msg: { duplicate?: string; inUse?: string }): never => {
  const code = (e as { code?: string }).code;
  if (code === '23505' && msg.duplicate) throw badRequest('duplicate', msg.duplicate);
  if (code === '23503' && msg.inUse) throw badRequest('in_use', msg.inUse);
  throw e;
};

async function currentYear(tx: Tx) {
  const y = (await tx.query<{ id: string; name: string }>('SELECT id, name FROM academic_years WHERE is_current')).rows[0];
  if (!y) throw badRequest('no_year', 'No current academic year is set');
  return y;
}

/**
 * Re-work concessions on a set of students' dues.
 * Percent concessions apply to each matching line; flat ones are "per line".
 * A concession can never make a line go below what's already been paid.
 */
export async function recomputeConcessions(tx: Tx, yearId: string, studentIds: string[] | null) {
  await tx.query(
    `WITH paid AS (
       SELECT l.fee_due_id, sum(l.amount) AS paid
         FROM receipt_lines l JOIN receipts r ON r.id = l.receipt_id AND r.status = 'active'
        GROUP BY l.fee_due_id
     ), calc AS (
       SELECT d.id,
              round(coalesce((SELECT sum(CASE WHEN c.kind = 'percent' THEN d.amount * c.value / 100 ELSE c.value END)
                                FROM fee_concessions c
                               WHERE c.student_id = d.student_id AND c.academic_year_id = d.academic_year_id
                                 AND (c.fee_head_id IS NULL OR c.fee_head_id = d.fee_head_id)), 0), 2) AS want,
              d.amount - coalesce(p.paid, 0) AS room
         FROM fee_dues d LEFT JOIN paid p ON p.fee_due_id = d.id
        WHERE d.academic_year_id = $1 AND ($2::uuid[] IS NULL OR d.student_id = ANY($2))
     )
     UPDATE fee_dues d SET concession = greatest(0, least(calc.want, calc.room))
       FROM calc WHERE calc.id = d.id AND d.concession IS DISTINCT FROM greatest(0, least(calc.want, calc.room))`,
    [yearId, studentIds]);
}

export function registerFeeRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler) {
  const pre = { preHandler: requireSchool };
  const canSeeFees = (req: Parameters<typeof can>[0]) => can(req, 'fees.collect') || can(req, 'fees.view_reports');

  // ================= Setup =================

  app.get('/fees/setup', pre, async (req) => {
    if (!canSeeFees(req) && !can(req, 'fees.manage_structure')) throw forbidden();
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      // (one after another: a transaction can only run one query at a time)
      const heads = await tx.query('SELECT id, name, is_active AS "isActive" FROM fee_heads ORDER BY name');
      const instalments = await
        tx.query(
          `SELECT i.id, i.name, i.due_on AS "dueOn", i.grace_days AS "graceDays", i.fine_type AS "fineType",
                  i.fine_amount AS "fineAmount", i.fine_cap AS "fineCap", i.sort_order AS "sortOrder",
                  EXISTS (SELECT 1 FROM fee_dues d WHERE d.instalment_id = i.id) AS "hasDues"
             FROM fee_instalments i WHERE i.academic_year_id = $1 ORDER BY i.due_on, i.sort_order`, [year.id]);
      const classes = await tx.query(
          `SELECT c.id, c.name,
                  (SELECT count(*)::int FROM enrollments e JOIN sections s ON s.id = e.section_id
                     JOIN students st ON st.id = e.student_id AND st.status = 'active'
                    WHERE s.class_id = c.id AND e.academic_year_id = $1) AS students
             FROM classes c ORDER BY c.sort_order`, [year.id]);
      const structure = await tx.query(
          `SELECT fs.class_id AS "classId", fs.fee_head_id AS "feeHeadId", fs.instalment_id AS "instalmentId", fs.amount
             FROM fee_structure fs JOIN fee_instalments i ON i.id = fs.instalment_id AND i.academic_year_id = $1`, [year.id]);
      const dues = await tx.query(
          `SELECT count(*)::int AS lines, count(DISTINCT student_id)::int AS students FROM fee_dues WHERE academic_year_id = $1`, [year.id]);
      return { year, heads: heads.rows, instalments: instalments.rows, classes: classes.rows, structure: structure.rows, dues: dues.rows[0] };
    });
  });

  app.post('/fees/heads', pre, async (req) => {
    must(req, 'fees.manage_structure');
    const b = z.object({ name: z.string().trim().min(2).max(60) }).parse(req.body);
    return schoolTx(db, req, async (tx) => (await tx.query(
      'INSERT INTO fee_heads (school_id, name) VALUES ($1, $2) RETURNING id, name',
      [req.school!.schoolId, b.name]).catch((e) => friendly(e, { duplicate: `"${b.name}" already exists` }))).rows[0]);
  });

  app.patch('/fees/heads/:id', pre, async (req) => {
    must(req, 'fees.manage_structure');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ name: z.string().trim().min(2).max(60).optional(), isActive: z.boolean().optional() }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const r = await tx.query('UPDATE fee_heads SET name = coalesce($2, name), is_active = coalesce($3, is_active) WHERE id = $1 RETURNING id',
        [id, b.name ?? null, b.isActive ?? null]).catch((e) => friendly(e, { duplicate: 'That name is already used' }));
      if (!r.rowCount) throw notFound('Fee type not found');
      return { ok: true };
    });
  });

  const instalmentBody = z.object({
    name: z.string().trim().min(2).max(40),
    dueOn: date,
    graceDays: z.number().int().min(0).max(60).default(0),
    fineType: z.enum(['none', 'flat', 'per_day']).default('none'),
    fineAmount: money.default('0'),
    fineCap: money.nullable().optional(),
  });

  app.post('/fees/instalments', pre, async (req) => {
    must(req, 'fees.manage_structure');
    const b = instalmentBody.parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      return (await tx.query(
        `INSERT INTO fee_instalments (school_id, academic_year_id, name, due_on, grace_days, fine_type, fine_amount, fine_cap, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT coalesce(max(sort_order), 0) + 1 FROM fee_instalments WHERE academic_year_id = $2))
         RETURNING id, name`,
        [req.school!.schoolId, year.id, b.name, b.dueOn, b.graceDays, b.fineType, b.fineAmount, b.fineCap ?? null])
        .catch((e) => friendly(e, { duplicate: `"${b.name}" already exists this year` }))).rows[0];
    });
  });

  app.patch('/fees/instalments/:id', pre, async (req) => {
    must(req, 'fees.manage_structure');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = instalmentBody.parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const r = await tx.query(
        `UPDATE fee_instalments SET name = $2, due_on = $3, grace_days = $4, fine_type = $5, fine_amount = $6, fine_cap = $7
          WHERE id = $1 RETURNING id`,
        [id, b.name, b.dueOn, b.graceDays, b.fineType, b.fineAmount, b.fineCap ?? null])
        .catch((e) => friendly(e, { duplicate: 'That name is already used this year' }));
      if (!r.rowCount) throw notFound('Instalment not found');
      return { ok: true };
    });
  });

  app.delete('/fees/instalments/:id', pre, async (req) => {
    must(req, 'fees.manage_structure');
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      if ((await tx.query('SELECT 1 FROM fee_dues WHERE instalment_id = $1 LIMIT 1', [id])).rowCount) {
        throw badRequest('in_use', 'Children already owe fees for this instalment, so it cannot be removed');
      }
      await tx.query('DELETE FROM fee_structure WHERE instalment_id = $1', [id]);
      const r = await tx.query('DELETE FROM fee_instalments WHERE id = $1', [id]);
      if (!r.rowCount) throw notFound('Instalment not found');
      return { ok: true };
    });
  });

  /** Set one class's fees: an amount for each fee type in each instalment (0 or missing = none). */
  app.put('/fees/structure/:classId', pre, async (req) => {
    must(req, 'fees.manage_structure');
    const { classId } = z.object({ classId: uuid }).parse(req.params);
    const { items } = z.object({
      items: z.array(z.object({ feeHeadId: uuid, instalmentId: uuid, amount: money })).max(500),
    }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      await tx.query(
        `DELETE FROM fee_structure fs USING fee_instalments i
          WHERE fs.instalment_id = i.id AND i.academic_year_id = $2 AND fs.class_id = $1`, [classId, year.id]);
      let saved = 0;
      for (const it of items) {
        if (Number(it.amount) <= 0) continue;
        await tx.query(
          'INSERT INTO fee_structure (school_id, class_id, fee_head_id, instalment_id, amount) VALUES ($1, $2, $3, $4, $5)',
          [req.school!.schoolId, classId, it.feeHeadId, it.instalmentId, it.amount]);
        saved++;
      }
      return { ok: true, saved };
    });
  });

  /**
   * Create each child's fee lines from the structure. Safe to run again: it only
   * adds what's missing. With updateUnpaid, lines nobody has paid anything on yet
   * are changed to the new amounts too.
   */
  app.post('/fees/generate-dues', pre, async (req) => {
    must(req, 'fees.manage_structure');
    const b = z.object({ classId: uuid.optional().nullable(), updateUnpaid: z.boolean().default(false) }).parse(req.body ?? {});
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const added = await tx.query(
        `INSERT INTO fee_dues (school_id, student_id, academic_year_id, instalment_id, fee_head_id, amount)
         SELECT $1, e.student_id, e.academic_year_id, fs.instalment_id, fs.fee_head_id, fs.amount
           FROM enrollments e
           JOIN students st ON st.id = e.student_id AND st.status = 'active'
           JOIN sections s ON s.id = e.section_id
           JOIN fee_structure fs ON fs.class_id = s.class_id
           JOIN fee_instalments i ON i.id = fs.instalment_id AND i.academic_year_id = e.academic_year_id
          WHERE e.academic_year_id = $2 AND ($3::uuid IS NULL OR s.class_id = $3)
         ON CONFLICT (student_id, instalment_id, fee_head_id) DO NOTHING`,
        [req.school!.schoolId, year.id, b.classId ?? null]);
      let updated = 0;
      if (b.updateUnpaid) {
        const u = await tx.query(
          `UPDATE fee_dues d SET amount = fs.amount, concession = 0
             FROM enrollments e JOIN sections s ON s.id = e.section_id
             JOIN fee_structure fs ON fs.class_id = s.class_id
            WHERE e.student_id = d.student_id AND e.academic_year_id = d.academic_year_id
              AND fs.instalment_id = d.instalment_id AND fs.fee_head_id = d.fee_head_id
              AND d.academic_year_id = $1 AND d.amount <> fs.amount
              AND ($2::uuid IS NULL OR s.class_id = $2)
              AND NOT EXISTS (SELECT 1 FROM receipt_lines l JOIN receipts r ON r.id = l.receipt_id AND r.status = 'active'
                               WHERE l.fee_due_id = d.id)`,
          [year.id, b.classId ?? null]);
        updated = u.rowCount ?? 0;
      }
      await recomputeConcessions(tx, year.id, null);
      const students = (await tx.query<{ n: number }>(
        `SELECT count(DISTINCT student_id)::int AS n FROM fee_dues WHERE academic_year_id = $1`, [year.id])).rows[0]!.n;
      return { added: added.rowCount ?? 0, updated, studentsWithFees: students };
    });
  });

  // ================= Concessions =================

  app.get('/students/:id/concessions', pre, async (req) => {
    if (!canSeeFees(req) && !can(req, 'fees.manage_structure')) throw forbidden();
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      return {
        concessions: (await tx.query(
          `SELECT c.id, c.kind, c.value, c.reason, h.name AS "feeHead", c.fee_head_id AS "feeHeadId",
                  a.name AS "approvedBy", c.created_at AS "createdAt"
             FROM fee_concessions c LEFT JOIN fee_heads h ON h.id = c.fee_head_id JOIN accounts a ON a.id = c.approved_by
            WHERE c.student_id = $1 AND c.academic_year_id = $2 ORDER BY c.created_at`, [id, year.id])).rows,
      };
    });
  });

  app.post('/fees/concessions', pre, async (req) => {
    must(req, 'fees.manage_structure');
    const b = z.object({
      studentId: uuid,
      feeHeadId: uuid.nullable().optional(),
      kind: z.enum(['percent', 'flat']),
      value: money,
      reason: z.string().trim().min(3, 'Write the reason for the concession').max(200),
    }).parse(req.body);
    if (b.kind === 'percent' && Number(b.value) > 100) throw badRequest('bad_value', 'A percentage cannot be more than 100');
    if (Number(b.value) <= 0) throw badRequest('bad_value', 'Enter an amount above zero');
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const r = (await tx.query<{ id: string }>(
        `INSERT INTO fee_concessions (school_id, student_id, academic_year_id, fee_head_id, kind, value, reason, approved_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [req.school!.schoolId, b.studentId, year.id, b.feeHeadId ?? null, b.kind, b.value, b.reason, req.accountId])).rows[0]!;
      await recomputeConcessions(tx, year.id, [b.studentId]);
      return { id: r.id };
    });
  });

  app.delete('/fees/concessions/:id', pre, async (req) => {
    must(req, 'fees.manage_structure');
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const c = (await tx.query<{ student_id: string; academic_year_id: string }>(
        'DELETE FROM fee_concessions WHERE id = $1 RETURNING student_id, academic_year_id', [id])).rows[0];
      if (!c) throw notFound('Concession not found');
      await recomputeConcessions(tx, c.academic_year_id, [c.student_id]);
      return { ok: true };
    });
  });

  // ================= Receipts =================

  /** Everything needed to print a receipt, with the school's own identity on it. */
  app.get('/fees/receipts/:id', pre, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const r = (await tx.query(
        `SELECT r.id, r.receipt_no AS "receiptNo", r.paid_on AS "paidOn", r.total_amount AS total, r.mode, r.reference,
                r.status, r.created_at AS "createdAt", r.cancel_reason AS "cancelReason", r.cancelled_at AS "cancelledAt",
                cb.name AS "cancelledBy", col.name AS "collectedBy", y.name AS "yearName",
                json_build_object('id', st.id, 'name', st.first_name || coalesce(' ' || st.last_name, ''),
                  'admissionNo', st.admission_no, 'familyAccountId', f.account_id,
                  'className', c.name, 'sectionName', sec.name, 'rollNo', e.roll_no,
                  'fatherName', f.father_name, 'motherName', f.mother_name, 'phone', f.phone) AS student,
                json_build_object('id', s.id, 'name', s.name, 'address', s.address, 'phone', s.phone, 'email', s.email,
                  'logoUrl', s.logo_url, 'brandColor', s.brand_color, 'affiliationNo', s.affiliation_no, 'board', s.board) AS school,
                (SELECT json_agg(json_build_object('description', l.description, 'amount', l.amount, 'fine', l.fine) ORDER BY l.description)
                   FROM receipt_lines l WHERE l.receipt_id = r.id) AS lines
           FROM receipts r
           JOIN schools s ON s.id = r.school_id
           JOIN academic_years y ON y.id = r.academic_year_id
           JOIN students st ON st.id = r.student_id
           JOIN families f ON f.id = st.family_id
           JOIN accounts col ON col.id = r.collected_by
           LEFT JOIN accounts cb ON cb.id = r.cancelled_by
           LEFT JOIN enrollments e ON e.student_id = st.id AND e.academic_year_id = r.academic_year_id
           LEFT JOIN sections sec ON sec.id = e.section_id
           LEFT JOIN classes c ON c.id = sec.class_id
          WHERE r.id = $1`, [id])).rows[0];
      if (!r) throw notFound('Receipt not found');
      if (!canSeeFees(req) && !(can(req, 'parent.own_children') && r.student.familyAccountId === req.accountId)) throw forbidden();
      delete r.student.familyAccountId;
      return r;
    });
  });

  /** Receipts for a student, or the day book (all receipts between two dates). */
  app.get('/fees/receipts', pre, async (req) => {
    if (!canSeeFees(req)) throw forbidden();
    const q = z.object({ studentId: uuid.optional(), from: date.optional(), to: date.optional() }).parse(req.query);
    const from = q.from ?? (q.studentId ? '2000-01-01' : todayIST());
    const to = q.to ?? (q.studentId ? '2999-12-31' : from);
    return schoolTx(db, req, async (tx) => {
      const receipts = (await tx.query(
        `SELECT r.id, r.receipt_no AS "receiptNo", r.paid_on AS "paidOn", r.created_at AS "createdAt", r.total_amount AS total,
                r.mode, r.reference, r.status, r.cancel_reason AS "cancelReason", cb.name AS "cancelledBy",
                col.name AS "collectedBy", st.id AS "studentId",
                st.first_name || coalesce(' ' || st.last_name, '') AS "studentName", st.admission_no AS "admissionNo",
                c.name AS "className", sec.name AS "sectionName"
           FROM receipts r
           JOIN students st ON st.id = r.student_id
           JOIN accounts col ON col.id = r.collected_by
           LEFT JOIN accounts cb ON cb.id = r.cancelled_by
           LEFT JOIN enrollments e ON e.student_id = st.id AND e.academic_year_id = r.academic_year_id
           LEFT JOIN sections sec ON sec.id = e.section_id
           LEFT JOIN classes c ON c.id = sec.class_id
          WHERE ($1::uuid IS NULL OR r.student_id = $1) AND r.paid_on BETWEEN $2 AND $3
          ORDER BY r.created_at DESC LIMIT 1000`, [q.studentId ?? null, from, to])).rows;
      const byMode: Record<string, string> = {};
      let total = 0;
      for (const r of receipts) {
        if (r.status !== 'active') continue;
        total += Math.round(Number(r.total) * 100);
        byMode[r.mode] = ((Number(byMode[r.mode] ?? 0) * 100 + Math.round(Number(r.total) * 100)) / 100).toFixed(2);
      }
      return { from, to, receipts, total: (total / 100).toFixed(2), byMode, cancelled: receipts.filter((r) => r.status === 'cancelled').length };
    });
  });

  // ================= Defaulters & summary =================

  /** Families who still owe money that is past its due date. */
  app.get('/fees/defaulters', pre, async (req) => {
    if (!canSeeFees(req)) throw forbidden();
    const q = z.object({ asOf: date.optional(), classId: uuid.optional() }).parse(req.query);
    const asOf = q.asOf ?? todayIST();
    return schoolTx(db, req, async (tx) => {
      const rows = (await tx.query(
        `SELECT st.id AS "studentId", st.first_name || coalesce(' ' || st.last_name, '') AS name,
                st.admission_no AS "admissionNo", c.name AS "className", sec.name AS "sectionName", e.roll_no AS "rollNo",
                f.phone, coalesce(f.father_name, f.mother_name, f.guardian_name) AS "parentName",
                sum(b.balance) AS overdue, min(b.due_on) AS "oldestDue",
                count(DISTINCT b.instalment_id)::int AS instalments,
                string_agg(DISTINCT i.name, ', ') AS "instalmentNames"
           FROM fee_due_balances b
           JOIN fee_instalments i ON i.id = b.instalment_id
           JOIN students st ON st.id = b.student_id AND st.status = 'active'
           JOIN families f ON f.id = st.family_id
           JOIN academic_years y ON y.id = b.academic_year_id AND y.is_current
           LEFT JOIN enrollments e ON e.student_id = st.id AND e.academic_year_id = y.id
           LEFT JOIN sections sec ON sec.id = e.section_id
           LEFT JOIN classes c ON c.id = sec.class_id
          WHERE b.balance > 0 AND (b.due_on + i.grace_days) < $1::date
            AND ($2::uuid IS NULL OR c.id = $2)
          GROUP BY st.id, c.name, c.sort_order, sec.name, e.roll_no, f.phone, f.father_name, f.mother_name, f.guardian_name
          ORDER BY sum(b.balance) DESC, c.sort_order, sec.name`, [asOf, q.classId ?? null])).rows;
      const total = rows.reduce((a, r) => a + Math.round(Number(r.overdue) * 100), 0);
      return { asOf, defaulters: rows, total: (total / 100).toFixed(2), count: rows.length };
    });
  });

  /** Numbers for the fees page and the principal's dashboard. */
  app.get('/fees/summary', pre, async (req) => {
    if (!canSeeFees(req)) throw forbidden();
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const today = todayIST();
      const r = (await tx.query(
        `SELECT
           (SELECT coalesce(sum(total_amount), 0) FROM receipts WHERE status = 'active' AND paid_on = $2) AS today,
           (SELECT coalesce(sum(total_amount), 0) FROM receipts WHERE status = 'active' AND date_trunc('month', paid_on) = date_trunc('month', $2::date)) AS "thisMonth",
           (SELECT coalesce(sum(amount - concession), 0) FROM fee_dues WHERE academic_year_id = $1) AS "yearBilled",
           (SELECT coalesce(sum(paid), 0) FROM fee_due_balances WHERE academic_year_id = $1) AS "yearCollected",
           (SELECT coalesce(sum(b.balance), 0) FROM fee_due_balances b JOIN fee_instalments i ON i.id = b.instalment_id
             WHERE b.academic_year_id = $1 AND b.balance > 0 AND (b.due_on + i.grace_days) < $2::date) AS overdue,
           (SELECT count(DISTINCT b.student_id)::int FROM fee_due_balances b JOIN fee_instalments i ON i.id = b.instalment_id
             JOIN students st ON st.id = b.student_id AND st.status = 'active'
             WHERE b.academic_year_id = $1 AND b.balance > 0 AND (b.due_on + i.grace_days) < $2::date) AS defaulters`,
        [year.id, today])).rows[0];
      const months = (await tx.query(
        `SELECT to_char(m, 'YYYY-MM') AS month,
                coalesce((SELECT sum(total_amount) FROM receipts r WHERE r.status = 'active'
                           AND date_trunc('month', r.paid_on) = m), 0) AS collected
           FROM generate_series(date_trunc('month', $1::date) - interval '5 months', date_trunc('month', $1::date), interval '1 month') m
          ORDER BY m`, [today])).rows;
      return { year, today, ...r, months };
    });
  });
}
