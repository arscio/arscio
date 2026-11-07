// Attendance reports for the principal and office (website).
//
// "Roll call": in every-period schools, the day's attendance for a child is taken
// from the FIRST period that was marked that day. In once-a-day schools it's the
// day's single register. Per-period details are still kept.
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { must, schoolTx } from '../context.js';
import { todayIST } from './attendance.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The roll-call register for each section on each date. */
const ROLL_CALL = `
  SELECT DISTINCT ON (a.section_id, a.on_date) a.id, a.section_id, a.on_date, a.period_no, a.taken_at, a.taken_by
    FROM attendance_sessions a
   WHERE a.on_date BETWEEN $1 AND $2
   ORDER BY a.section_id, a.on_date, a.period_no`;

export function registerAttendanceReportRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler) {
  const pre = { preHandler: requireSchool };

  /** One day, whole school: each section's numbers, and who is absent. */
  app.get('/attendance/day', pre, async (req) => {
    must(req, 'attendance.view_all');
    const q = z.object({ date: date.optional() }).parse(req.query);
    const day = q.date ?? todayIST();
    return schoolTx(db, req, async (tx) => {
      const sections = (await tx.query(
        `WITH rc AS (${ROLL_CALL})
         SELECT s.id AS "sectionId", c.name AS "className", s.name AS "sectionName",
                m.display_name AS "classTeacher",
                (SELECT count(*)::int FROM enrollments e JOIN students x ON x.id = e.student_id AND x.status = 'active'
                  WHERE e.section_id = s.id) AS students,
                rc.id IS NOT NULL AS taken,
                rc.taken_at AS "takenAt", acc.name AS "takenBy",
                (SELECT count(*)::int FROM attendance_sessions a WHERE a.section_id = s.id AND a.on_date = $1) AS "periodsTaken",
                (SELECT count(*)::int FROM attendance_marks k WHERE k.session_id = rc.id AND k.status IN ('present','late','half_day')) AS present,
                (SELECT count(*)::int FROM attendance_marks k WHERE k.session_id = rc.id AND k.status = 'absent') AS absent,
                (SELECT count(*)::int FROM attendance_marks k WHERE k.session_id = rc.id AND k.status = 'leave') AS leave
           FROM sections s
           JOIN classes c ON c.id = s.class_id
           JOIN academic_years y ON y.id = s.academic_year_id AND y.is_current
           LEFT JOIN memberships m ON m.id = s.class_teacher_membership
           LEFT JOIN rc ON rc.section_id = s.id
           LEFT JOIN accounts acc ON acc.id = rc.taken_by
          ORDER BY c.sort_order, s.name`, [day, day])).rows;

      const absentees = (await tx.query(
        `WITH rc AS (${ROLL_CALL})
         SELECT st.id, st.first_name AS "firstName", st.last_name AS "lastName", e.roll_no AS "rollNo",
                c.name AS "className", s.name AS "sectionName", k.note,
                f.phone, coalesce(f.father_name, f.mother_name, f.guardian_name) AS "parentName",
                (SELECT count(*)::int FROM (
                   SELECT r2.on_date FROM (${ROLL_CALL.replace('$1', "($1::date - 30)")}) r2
                   JOIN attendance_marks k2 ON k2.session_id = r2.id AND k2.student_id = st.id AND k2.status = 'absent') z) AS "absentLast30"
           FROM rc
           JOIN attendance_marks k ON k.session_id = rc.id AND k.status = 'absent'
           JOIN students st ON st.id = k.student_id
           JOIN families f ON f.id = st.family_id
           JOIN sections s ON s.id = rc.section_id
           JOIN classes c ON c.id = s.class_id
           LEFT JOIN enrollments e ON e.student_id = st.id AND e.section_id = s.id
          ORDER BY c.sort_order, s.name, e.roll_no NULLS LAST, st.first_name`, [day, day])).rows;

      const t = sections.reduce((a, s) => ({
        students: a.students + s.students,
        present: a.present + s.present, absent: a.absent + s.absent, leave: a.leave + s.leave,
        sectionsTaken: a.sectionsTaken + (s.taken ? 1 : 0),
      }), { students: 0, present: 0, absent: 0, leave: 0, sectionsTaken: 0 });
      return { date: day, today: todayIST(), totals: { ...t, sections: sections.length }, sections, absentees };
    });
  });

  /** The monthly register for one section: every child, every day. */
  app.get('/attendance/register', pre, async (req) => {
    must(req, 'attendance.view_all');
    const q = z.object({ sectionId: uuid, month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query);
    const [y, m] = q.month.split('-').map(Number) as [number, number];
    if (m < 1 || m > 12) throw badRequest('bad_month', 'Choose a month');
    const first = `${q.month}-01`;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const last = `${q.month}-${String(daysInMonth).padStart(2, '0')}`;

    return schoolTx(db, req, async (tx) => {
      const section = (await tx.query(
        `SELECT c.name AS "className", s.name AS "sectionName", m.display_name AS "classTeacher"
           FROM sections s JOIN classes c ON c.id = s.class_id
           LEFT JOIN memberships m ON m.id = s.class_teacher_membership WHERE s.id = $1`, [q.sectionId])).rows[0];
      if (!section) throw notFound('Section not found');

      const days = (await tx.query<{ d: string }>(
        `SELECT DISTINCT on_date::text AS d FROM attendance_sessions
          WHERE section_id = $1 AND on_date BETWEEN $2 AND $3 ORDER BY 1`, [q.sectionId, first, last])).rows.map((r) => r.d);

      const students = (await tx.query(
        `WITH rc AS (${ROLL_CALL})
         SELECT st.id, st.first_name AS "firstName", st.last_name AS "lastName", e.roll_no AS "rollNo", st.status,
                coalesce((SELECT json_object_agg(rc.on_date::text, k.status)
                   FROM rc JOIN attendance_marks k ON k.session_id = rc.id AND k.student_id = st.id
                  WHERE rc.section_id = $3), '{}') AS marks
           FROM enrollments e JOIN students st ON st.id = e.student_id
          WHERE e.section_id = $3
          ORDER BY e.roll_no NULLS LAST, st.first_name`, [first, last, q.sectionId])).rows;

      const rows = students.map((s) => {
        const vals = Object.values(s.marks as Record<string, string>);
        const present = vals.filter((v) => v === 'present' || v === 'late').length + vals.filter((v) => v === 'half_day').length / 2;
        const absent = vals.filter((v) => v === 'absent').length + vals.filter((v) => v === 'half_day').length / 2;
        const leave = vals.filter((v) => v === 'leave').length;
        const counted = present + absent;
        return { ...s, present, absent, leave, percent: counted ? Math.round((present / counted) * 1000) / 10 : null };
      });
      return { section, month: q.month, daysInMonth, schoolDays: days, students: rows };
    });
  });
}
