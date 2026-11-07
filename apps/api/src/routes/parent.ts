// What the parent app needs. Every call checks the child really belongs to
// this parent's family (one phone number per family).
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { withContext, type Db, type Tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { schoolTx } from '../context.js';
import { studentDues } from '../fees/service.js';
import { todayIST } from './attendance.js';

const uuid = z.string().uuid();

/** The child, if (and only if) they belong to the logged-in parent. */
async function ownChild(tx: Tx, req: FastifyRequest, studentId: string) {
  const c = (await tx.query(
    `SELECT st.id, st.first_name AS "firstName", st.last_name AS "lastName", st.admission_no AS "admissionNo",
            e.section_id AS "sectionId", e.roll_no AS "rollNo", c.name AS "className", sec.name AS "sectionName",
            m.display_name AS "classTeacher", y.id AS "yearId"
       FROM students st
       JOIN families f ON f.id = st.family_id AND f.account_id = $2
       LEFT JOIN academic_years y ON y.school_id = st.school_id AND y.is_current
       LEFT JOIN enrollments e ON e.student_id = st.id AND e.academic_year_id = y.id
       LEFT JOIN sections sec ON sec.id = e.section_id
       LEFT JOIN classes c ON c.id = sec.class_id
       LEFT JOIN memberships m ON m.id = sec.class_teacher_membership
      WHERE st.id = $1 AND st.status = 'active'`, [studentId, req.accountId])).rows[0];
  if (!c) throw forbidden('This child is not linked to your phone number');
  return c as { id: string; firstName: string; sectionId: string | null; yearId: string; [k: string]: unknown };
}

const ROLL_CALL_FOR = `
  SELECT DISTINCT ON (a.on_date) a.on_date, k.status
    FROM attendance_sessions a JOIN attendance_marks k ON k.session_id = a.id AND k.student_id = $1
   WHERE a.on_date BETWEEN $2 AND $3
   ORDER BY a.on_date, a.period_no`;

export function registerParentRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler) {
  const pre = { preHandler: requireSchool };
  const mustParent = (req: FastifyRequest) => {
    if (!req.school?.permissions.has('parent.own_children')) throw forbidden();
  };

  /** Home screen for one child: today, this month, fees, homework, school identity. */
  app.get('/parent/children/:id/summary', pre, async (req) => {
    mustParent(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const child = await ownChild(tx, req, id);
      const today = todayIST();
      const monthStart = `${today.slice(0, 7)}-01`;
      const days = (await tx.query<{ on_date: string; status: string }>(ROLL_CALL_FOR, [id, monthStart, today])).rows;
      const todayMark = days.find((d) => d.on_date === today)?.status ?? null;
      const present = days.filter((d) => ['present', 'late'].includes(d.status)).length + days.filter((d) => d.status === 'half_day').length / 2;
      const absent = days.filter((d) => d.status === 'absent').length + days.filter((d) => d.status === 'half_day').length / 2;

      const dues = await studentDues(tx, id, today);
      const open = dues.filter((d) => Number(d.balance) > 0);
      const sum = (xs: typeof dues) => (xs.reduce((a, d) => a + Math.round(Number(d.balance) * 100), 0) / 100).toFixed(2);
      const overdue = open.filter((d) => d.dueOn < today);
      const next = open.filter((d) => d.dueOn >= today).map((d) => d.dueOn).sort()[0] ?? null;

      const homework = child.sectionId ? (await tx.query(
        `SELECT h.id, h.title, h.due_on AS "dueOn", sub.name AS "subjectName", h.created_at AS "createdAt"
           FROM homework h LEFT JOIN subjects sub ON sub.id = h.subject_id
          WHERE h.section_id = $1 AND h.created_at > now() - interval '7 days'
          ORDER BY h.created_at DESC LIMIT 3`, [child.sectionId])).rows : [];

      const school = (await tx.query(
        `SELECT id, name, short_name AS "shortName", logo_url AS "logoUrl", brand_color AS "brandColor",
                phone, address, online_payments_enabled AS "onlinePayments"
           FROM schools WHERE id = $1`, [req.school!.schoolId])).rows[0];

      return {
        child, school,
        attendance: { today: todayMark, month: { present, absent, leave: days.filter((d) => d.status === 'leave').length, days: days.length } },
        fees: { due: sum(open), overdue: sum(overdue), nextDueOn: next, hasFees: dues.length > 0 },
        homework,
      };
    });
  });

  /** A month of attendance, day by day. */
  app.get('/parent/children/:id/attendance', pre, async (req) => {
    mustParent(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
    const m = month ?? todayIST().slice(0, 7);
    const [y, mo] = m.split('-').map(Number) as [number, number];
    if (mo < 1 || mo > 12) throw badRequest('bad_month', 'Choose a month');
    const last = `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
    return schoolTx(db, req, async (tx) => {
      await ownChild(tx, req, id);
      const days = (await tx.query<{ on_date: string; status: string }>(ROLL_CALL_FOR, [id, `${m}-01`, last])).rows;
      return { month: m, days: days.map((d) => ({ date: d.on_date, status: d.status })) };
    });
  });

  app.get('/parent/children/:id/homework', pre, async (req) => {
    mustParent(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const child = await ownChild(tx, req, id);
      if (!child.sectionId) return { homework: [] };
      return {
        homework: (await tx.query(
          `SELECT h.id, h.title, h.details, h.due_on AS "dueOn", h.created_at AS "createdAt",
                  sub.name AS "subjectName", a.name AS "givenBy"
             FROM homework h LEFT JOIN subjects sub ON sub.id = h.subject_id JOIN accounts a ON a.id = h.created_by
            WHERE h.section_id = $1 AND h.created_at > now() - interval '30 days'
            ORDER BY h.created_at DESC`, [child.sectionId])).rows,
      };
    });
  });

  app.get('/parent/children/:id/fees', pre, async (req) => {
    mustParent(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      await ownChild(tx, req, id);
      const dues = await studentDues(tx, id, todayIST());
      const receipts = (await tx.query(
        `SELECT id, receipt_no AS "receiptNo", paid_on AS "paidOn", total_amount AS total, mode, status
           FROM receipts WHERE student_id = $1 ORDER BY created_at DESC`, [id])).rows;
      return { dues, receipts };
    });
  });

}

/** Inbox and push-device routes: need login only (not a school). */
export function registerInboxRoutes(app: FastifyInstance, db: Db, requireLogin: preHandlerHookHandler) {
  const pre = { preHandler: requireLogin };

  app.get('/me/messages', pre, async (req) => {
    const q = z.object({ kind: z.enum(['notice', 'homework', 'absent']).optional() }).parse(req.query);
    return withContext(db, { accountId: req.accountId }, async (tx) => ({
      messages: (await tx.query(
        `SELECT n.id, n.title, n.body, n.data, n.created_at AS "createdAt", n.read_at AS "readAt",
                s.name AS "schoolName", s.id AS "schoolId"
           FROM notifications n JOIN schools s ON s.id = n.school_id
          WHERE n.account_id = $1 AND ($2::text IS NULL OR n.data->>'kind' = $2)
          ORDER BY n.created_at DESC LIMIT 200`, [req.accountId, q.kind ?? null])).rows,
      unread: (await tx.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM notifications WHERE account_id = $1 AND read_at IS NULL', [req.accountId])).rows[0]!.n,
    }));
  });

  app.post('/me/messages/:id/read', pre, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return withContext(db, { accountId: req.accountId }, async (tx) => {
      const r = await tx.query(
        'UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE id = $1 AND account_id = $2 RETURNING id', [id, req.accountId]);
      if (!r.rowCount) throw notFound('Message not found');
      return { ok: true };
    });
  });

  /** The phone tells us where to send its notifications. */
  app.post('/me/push-devices', pre, async (req) => {
    const b = z.object({
      app: z.enum(['teacher', 'parent']),
      platform: z.enum(['android', 'ios']),
      pushToken: z.string().min(10).max(300),
    }).parse(req.body);
    return withContext(db, { accountId: req.accountId }, async (tx) => {
      // (if the phone changed hands, the address moves to whoever is logged in now)
      await tx.query('SELECT claim_push_device($1, $2, $3, $4)', [req.accountId, b.app, b.platform, b.pushToken]);
      return { ok: true };
    });
  });
}
