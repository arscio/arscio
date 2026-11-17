// Principal's dashboard and staff attendance.
//  - Staff attendance: the office marks it once a day on the website (everyone starts
//    as present; tap the few who are absent, late or on leave). Today and the last 7 days.
//  - Dashboard: today's attendance, teachers present, fees this month, defaulters,
//    a 6-month fee chart and an "attention" list of things that need someone's action.
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Db, Tx } from '../db.js';
import { badRequest } from '../errors.js';
import { must, schoolTx } from '../context.js';
import { todayIST } from './attendance.js';
import { dayFor, scheduleFor, settings } from '../timetable/service.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const STATUS = z.enum(['present', 'absent', 'late', 'half_day', 'leave']);

const daysBefore = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - n);
  return x.toISOString().slice(0, 10);
};

/** Everyone on the staff list (any role except parent), with that day's status. */
async function staffDay(tx: Tx, on: string, schoolId: string) {
  return (await tx.query(
    `SELECT m.id AS "membershipId", m.display_name AS name, m.designation,
            array_agg(DISTINCT r.role) AS roles, sa.status, ma.name AS "markedBy", sa.marked_at AS "markedAt"
       FROM memberships m
       JOIN membership_roles r ON r.membership_id = m.id AND r.role <> 'parent'
       LEFT JOIN staff_attendance sa ON sa.membership_id = m.id AND sa.on_date = $1
       LEFT JOIN accounts ma ON ma.id = sa.marked_by
      WHERE m.status = 'active' AND m.school_id = $2
      GROUP BY m.id, sa.status, ma.name, sa.marked_at
      ORDER BY bool_or(r.role = 'teacher') DESC, m.display_name`, [on, schoolId])).rows as {
        membershipId: string; name: string; designation: string | null; roles: string[]; status: string | null; markedBy: string | null; markedAt: string | null;
      }[];
}

export function registerDashboardRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler) {
  const pre = { preHandler: requireSchool };

  app.get('/staff-attendance', pre, async (req) => {
    must(req, 'attendance.view_all');
    const { date: on = todayIST() } = z.object({ date: date.optional() }).parse(req.query);
    return schoolTx(db, req, async (tx) => ({ date: on, today: todayIST(), staff: await staffDay(tx, on, req.school!.schoolId) }));
  });

  app.put('/staff-attendance', pre, async (req) => {
    must(req, 'attendance.view_all');
    const b = z.object({ date, rows: z.array(z.object({ membershipId: z.string().uuid(), status: STATUS })).min(1).max(500) }).parse(req.body);
    const today = todayIST();
    if (b.date > today) throw badRequest('future', 'You can’t mark attendance for a future day');
    if (b.date < daysBefore(today, 7)) throw badRequest('too_old', 'Staff attendance can only be changed for the last 7 days');
    return schoolTx(db, req, async (tx) => {
      const ids = new Set((await staffDay(tx, b.date, req.school!.schoolId)).map((s) => s.membershipId));
      for (const r of b.rows) {
        if (!ids.has(r.membershipId)) throw badRequest('not_staff', 'One of these people is not on the staff list');
        await tx.query(
          `INSERT INTO staff_attendance (school_id, membership_id, on_date, status, marked_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (membership_id, on_date) DO UPDATE SET status = excluded.status, marked_by = excluded.marked_by, marked_at = now()`,
          [req.school!.schoolId, r.membershipId, b.date, r.status, req.accountId]);
      }
      return { saved: b.rows.length };
    });
  });

  app.get('/dashboard', pre, async (req) => {
    must(req, 'dashboard.view');
    const today = todayIST();
    const monthStart = `${today.slice(0, 7)}-01`;
    return schoolTx(db, req, async (tx) => {
      const year = (await tx.query<{ id: string; name: string }>('SELECT id, name FROM academic_years WHERE is_current')).rows[0];
      if (!year) throw badRequest('no_year', 'No current academic year is set');

      // ---- Today's student attendance (first attendance of the day counts) ----
      const sections = (await tx.query<{ id: string; label: string; students: number; taken: boolean }>(
        `SELECT s.id, CASE WHEN c.name ~ '^[0-9]+$' THEN 'Class ' || c.name ELSE c.name END || ' ' || s.name AS label,
                (SELECT count(*)::int FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active' WHERE e.section_id = s.id) AS students,
                EXISTS (SELECT 1 FROM attendance_sessions a WHERE a.section_id = s.id AND a.on_date = $2) AS taken
           FROM sections s JOIN classes c ON c.id = s.class_id
          WHERE s.academic_year_id = $1 ORDER BY c.sort_order, s.name`, [year.id, today])).rows;
      const marks = (await tx.query<{ status: string; n: number }>(
        `SELECT t.status, count(*)::int AS n FROM (
           SELECT DISTINCT ON (k.student_id) k.status
             FROM attendance_sessions a JOIN attendance_marks k ON k.session_id = a.id
            WHERE a.on_date = $1 ORDER BY k.student_id, a.period_no) t GROUP BY t.status`, [today])).rows;
      const count = (s: string) => marks.find((m) => m.status === s)?.n ?? 0;
      const present = count('present') + count('late') + count('half_day') / 2;
      const marked = marks.reduce((a, m) => a + m.n, 0);
      const totalStudents = sections.reduce((a, s) => a + s.students, 0);

      // ---- Staff today ----
      const staff = await staffDay(tx, today, req.school!.schoolId);
      const teachers = staff.filter((s) => s.roles.includes('teacher'));
      const isIn = (s: { status: string | null }) => s.status && ['present', 'late', 'half_day'].includes(s.status);

      // ---- Fees ----
      const fees = (await tx.query(
        `SELECT
           (SELECT coalesce(sum(total_amount), 0) FROM receipts WHERE status = 'active' AND paid_on = $2) AS today,
           (SELECT coalesce(sum(total_amount), 0) FROM receipts WHERE status = 'active' AND paid_on >= $3) AS "thisMonth",
           (SELECT count(*)::int FROM receipts WHERE status = 'active' AND paid_on >= $3) AS "receiptsThisMonth",
           (SELECT coalesce(sum(amount - concession), 0) FROM fee_dues WHERE academic_year_id = $1) AS "yearBilled",
           (SELECT coalesce(sum(paid), 0) FROM fee_due_balances WHERE academic_year_id = $1) AS "yearCollected"`,
        [year.id, today, monthStart])).rows[0];
      const defaulters = (await tx.query(
        `SELECT st.id AS "studentId", st.first_name || coalesce(' ' || st.last_name, '') AS name,
                CASE WHEN c.name ~ '^[0-9]+$' THEN 'Class ' || c.name ELSE c.name END || ' ' || sec.name AS class,
                sum(b.balance) AS overdue, min(b.due_on) AS "since"
           FROM fee_due_balances b
           JOIN fee_instalments i ON i.id = b.instalment_id
           JOIN students st ON st.id = b.student_id AND st.status = 'active'
           LEFT JOIN enrollments e ON e.student_id = st.id AND e.academic_year_id = b.academic_year_id
           LEFT JOIN sections sec ON sec.id = e.section_id
           LEFT JOIN classes c ON c.id = sec.class_id
          WHERE b.academic_year_id = $1 AND b.balance > 0 AND (b.due_on + i.grace_days) < $2::date
          GROUP BY st.id, c.name, sec.name ORDER BY sum(b.balance) DESC`, [year.id, today])).rows;
      const months = (await tx.query<{ month: string; total: string }>(
        `SELECT to_char(m, 'YYYY-MM') AS month,
                (SELECT coalesce(sum(total_amount), 0) FROM receipts r
                  WHERE r.status = 'active' AND date_trunc('month', r.paid_on) = m) AS total
           FROM generate_series(date_trunc('month', $1::date) - interval '5 months', date_trunc('month', $1::date), interval '1 month') m
          ORDER BY m`, [today])).rows;

      // ---- Attention list ----
      const attention: { kind: string; tone: 'warn' | 'info'; text: string; href: string }[] = [];
      // Sundays, holidays and "no classes" days: nothing to nag about for attendance
      const ts = await settings(tx);
      const day = await dayFor(tx, ts, today);
      const notTaken = day.noClasses ? [] : sections.filter((s) => !s.taken && s.students > 0);
      if (notTaken.length) attention.push({ kind: 'attendance', tone: 'warn', href: '/attendance',
        text: `Attendance not taken today: ${notTaken.slice(0, 4).map((s) => s.label).join(', ')}${notTaken.length > 4 ? ` and ${notTaken.length - 4} more` : ''}` });
      // Leave and cover
      const gaps = (await scheduleFor(tx, ts, day)).filter((p) => p.onLeave && !p.substitute).length;
      if (gaps) attention.push({ kind: 'cover', tone: 'warn', href: '/cover', text: `${gaps} ${gaps === 1 ? 'period needs' : 'periods need'} a substitute today` });
      const pendingLeaves = (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM teacher_leaves WHERE status = 'pending'")).rows[0]!.n;
      if (pendingLeaves) attention.push({ kind: 'leave', tone: 'warn', href: '/cover', text: `${pendingLeaves} leave ${pendingLeaves === 1 ? 'request is' : 'requests are'} waiting for you` });
      if (!day.noClasses && !staff.some((s) => s.status)) attention.push({ kind: 'staff', tone: 'warn', href: '/staff/attendance', text: 'Staff attendance is not marked yet today' });
      const streaks = (await tx.query<{ name: string; class: string }>(
        `WITH days AS (SELECT DISTINCT on_date FROM attendance_sessions WHERE on_date <= $1 ORDER BY on_date DESC LIMIT 3),
              day_status AS (
                SELECT DISTINCT ON (k.student_id, a.on_date) k.student_id, a.on_date, k.status
                  FROM attendance_sessions a JOIN attendance_marks k ON k.session_id = a.id
                 WHERE a.on_date IN (SELECT on_date FROM days) ORDER BY k.student_id, a.on_date, a.period_no)
         SELECT st.first_name || coalesce(' ' || st.last_name, '') AS name,
                CASE WHEN c.name ~ '^[0-9]+$' THEN 'Class ' || c.name ELSE c.name END || ' ' || sec.name AS class
           FROM day_status d
           JOIN students st ON st.id = d.student_id
           JOIN enrollments e ON e.student_id = st.id AND e.academic_year_id = $2
           JOIN sections sec ON sec.id = e.section_id JOIN classes c ON c.id = sec.class_id
          GROUP BY st.id, c.name, sec.name
         HAVING count(*) FILTER (WHERE d.status = 'absent') = 3 AND (SELECT count(*) FROM days) = 3`, [today, year.id])).rows;
      for (const s of streaks.slice(0, 5)) attention.push({ kind: 'absent_streak', tone: 'warn', href: '/attendance', text: `${s.name} (${s.class}) has been absent 3 days in a row. Call the family.` });
      const lowAttendance = (await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM (
           SELECT k.student_id FROM (
             SELECT DISTINCT ON (k.student_id, a.on_date) k.student_id, k.status
               FROM attendance_sessions a JOIN attendance_marks k ON k.session_id = a.id
              WHERE a.on_date >= $1 ORDER BY k.student_id, a.on_date, a.period_no) k
           GROUP BY k.student_id
          HAVING count(*) >= 5 AND avg(CASE WHEN k.status IN ('present','late') THEN 1 WHEN k.status = 'half_day' THEN 0.5 ELSE 0 END) < 0.75) x`,
        [monthStart])).rows[0]!.n;
      if (lowAttendance) attention.push({ kind: 'low_attendance', tone: 'info', href: '/attendance/register', text: `${lowAttendance} ${lowAttendance === 1 ? 'student is' : 'students are'} below 75% attendance this month` });
      if (defaulters.length) attention.push({ kind: 'defaulters', tone: 'info', href: '/fees/defaulters',
        text: `${defaulters.length} ${defaulters.length === 1 ? 'student has' : 'students have'} overdue fees` });
      const marksGap = (await tx.query<{ exam: string; missing: number }>(
        `SELECT x.name AS exam, sum(GREATEST(sec_count.students - coalesce(entered.n, 0), 0))::int AS missing
           FROM exams x
           JOIN terms t ON t.id = x.term_id AND t.academic_year_id = $1
           JOIN sections s ON s.academic_year_id = $1
           JOIN classes c ON c.id = s.class_id AND (cardinality(x.class_ids) = 0 OR c.id = ANY(x.class_ids))
           JOIN class_subjects cs ON cs.class_id = c.id
           CROSS JOIN LATERAL (SELECT count(*)::int AS students FROM enrollments e WHERE e.section_id = s.id) sec_count
           LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM marks mk JOIN enrollments e ON e.student_id = mk.student_id AND e.section_id = s.id
                               WHERE mk.exam_id = x.id AND mk.subject_id = cs.subject_id) entered ON true
          WHERE EXISTS (SELECT 1 FROM marks m2 WHERE m2.exam_id = x.id) AND NOT x.marks_locked
          GROUP BY x.id, x.name HAVING sum(GREATEST(sec_count.students - coalesce(entered.n, 0), 0)) > 0`, [year.id])).rows;
      for (const g of marksGap) attention.push({ kind: 'marks', tone: 'info', href: '/exams/marks', text: `${g.exam}: ${g.missing} marks still to be entered` });

      return {
        date: today,
        year,
        holiday: day.noClasses ? (day.note || (day.label === 'Holiday' ? 'No school today' : day.label)) : null,
        attendance: {
          totalStudents, marked, present, absent: count('absent') + count('half_day') / 2, leave: count('leave'),
          pct: marked ? Math.round((present / marked) * 1000) / 10 : null,
          sectionsTaken: sections.filter((s) => s.taken).length, sectionsTotal: sections.filter((s) => s.students > 0).length,
        },
        staff: {
          total: staff.length, marked: staff.filter((s) => s.status).length, in: staff.filter(isIn).length,
          teachers: teachers.length, teachersIn: teachers.filter(isIn).length,
          away: staff.filter((s) => s.status && !isIn(s)).map((s) => ({ name: s.name, status: s.status })),
        },
        fees: { ...fees, overdueTotal: defaulters.reduce((a, d) => a + Number(d.overdue), 0).toFixed(2), defaulterCount: defaulters.length,
          topDefaulters: defaulters.slice(0, 5), months },
        attention,
      };
    });
  });
}
