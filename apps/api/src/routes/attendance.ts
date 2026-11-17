// Student attendance, taken in the teacher app.
//
// Rules:
//  - The principal's school setting decides: once a day (period 0) or every period (1..N).
//  - Any teacher can take attendance for any section (substitutes happen), and the
//    record always says who took it. "My classes" lists their own sections first.
//  - Teachers can only take or change TODAY's attendance. The principal/office can
//    correct past days. Nobody can mark a future day.
//  - Every student in the section must be marked before saving.
//  - When a child is marked absent, an app notification is queued for the parents
//    (at most once per child per day).
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Db, Tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { dayFor, scheduleFor, settings } from '../timetable/service.js';
import { can, schoolTx } from '../context.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const STATUSES = ['present', 'absent', 'late', 'half_day', 'leave'] as const;

/** Today's date in India, as YYYY-MM-DD. */
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const prettyDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

async function schoolMode(tx: Tx) {
  return (await tx.query<{ attendance_mode: 'daily' | 'period'; periods_per_day: number }>(
    'SELECT attendance_mode, periods_per_day FROM schools WHERE id = app_school_id()')).rows[0]!;
}

export function registerAttendanceRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler) {
  const pre = { preHandler: requireSchool };
  const mayTake = (req: Parameters<typeof can>[0]) => can(req, 'attendance.take') || can(req, 'attendance.view_all');
  /** Teachers: only their own classes, or a class the principal asked them to cover that day. The office: any class. */
  const mayTakeSection = async (tx: Tx, req: Parameters<typeof can>[0], sectionId: string, day: string) => {
    if (can(req, 'attendance.view_all')) return;
    const r = await tx.query(
      `SELECT 1 FROM sections s WHERE s.id = $1 AND (s.class_teacher_membership = $2
          OR EXISTS (SELECT 1 FROM section_teachers t WHERE t.section_id = s.id AND t.membership_id = $2)
          OR EXISTS (SELECT 1 FROM timetable_slots t WHERE t.section_id = s.id AND t.membership_id = $2)
          OR EXISTS (SELECT 1 FROM substitutions b WHERE b.section_id = s.id AND b.on_date = $3 AND b.substitute_membership = $2))`,
      [sectionId, req.school!.membershipId, day]);
    if (!r.rowCount) throw forbidden('This is not your class. The principal can assign you to cover it.');
  };

  /** Home screen of the teacher app: my sections, and what's done today. */
  app.get('/teacher/today', pre, async (req) => {
    if (!mayTake(req)) throw forbidden();
    const q = z.object({ date: date.optional() }).parse(req.query);
    const day = q.date ?? todayIST();
    return schoolTx(db, req, async (tx) => {
      const mode = await schoolMode(tx);
      const rows = (await tx.query(
        `WITH mine AS (
           SELECT s.id AS section_id, true AS is_class_teacher, NULL::uuid AS subject_id
             FROM sections s WHERE s.class_teacher_membership = $1
           UNION ALL
           SELECT st.section_id, false, st.subject_id FROM section_teachers st WHERE st.membership_id = $1
           UNION ALL
           SELECT DISTINCT t.section_id, false, t.subject_id FROM timetable_slots t WHERE t.membership_id = $1
         )
         SELECT s.id AS "sectionId", c.name AS "className", s.name AS "sectionName",
                bool_or(m.is_class_teacher) AS "isClassTeacher",
                coalesce(json_agg(DISTINCT jsonb_build_object('id', sub.id, 'name', sub.name))
                  FILTER (WHERE sub.id IS NOT NULL), '[]') AS subjects,
                (SELECT count(*)::int FROM enrollments e JOIN students x ON x.id = e.student_id AND x.status = 'active'
                  WHERE e.section_id = s.id) AS "studentCount",
                (SELECT coalesce(json_agg(json_build_object(
                    'periodNo', a.period_no,
                    'present', (SELECT count(*) FROM attendance_marks k WHERE k.session_id = a.id AND k.status IN ('present', 'late', 'half_day')),
                    'absent', (SELECT count(*) FROM attendance_marks k WHERE k.session_id = a.id AND k.status = 'absent'),
                    'leave', (SELECT count(*) FROM attendance_marks k WHERE k.session_id = a.id AND k.status = 'leave'),
                    'takenBy', (SELECT name FROM accounts WHERE id = a.taken_by)) ORDER BY a.period_no), '[]')
                   FROM attendance_sessions a WHERE a.section_id = s.id AND a.on_date = $2) AS taken
           FROM mine m
           JOIN sections s ON s.id = m.section_id
           JOIN academic_years y ON y.id = s.academic_year_id AND y.is_current
           JOIN classes c ON c.id = s.class_id
           LEFT JOIN subjects sub ON sub.id = m.subject_id
          GROUP BY s.id, c.name, c.sort_order, s.name
          ORDER BY bool_or(m.is_class_teacher) DESC, c.sort_order, s.name`,
        [req.school!.membershipId, day])).rows;
      // Today's timetable for this teacher: own periods (marked if on leave) and classes they cover.
      const ts = await settings(tx);
      const dayInfo = await dayFor(tx, ts, day);
      const me = req.school!.membershipId;
      const schedule = (await scheduleFor(tx, ts, dayInfo))
        .filter((p) => p.teacher?.membershipId === me || p.substitute?.membershipId === me)
        .map((p) => ({
          periodNo: p.periodNo, time: ts.periodTimes.find((t) => t.periodNo === p.periodNo) ?? null,
          sectionId: p.sectionId, classLabel: p.classLabel, subject: p.subject,
          isCover: p.substitute?.membershipId === me, onLeave: p.teacher?.membershipId === me && p.onLeave,
          coveredFor: p.substitute?.membershipId === me ? p.teacher?.name ?? null : null,
        }));
      const covers = (await tx.query(
        `SELECT DISTINCT b.section_id AS "sectionId", CASE WHEN c.name ~ '^[0-9]+$' THEN 'Class ' || c.name ELSE c.name END || ' ' || x.name AS "classLabel"
           FROM substitutions b JOIN sections x ON x.id = b.section_id JOIN classes c ON c.id = x.class_id
          WHERE b.on_date = $1 AND b.substitute_membership = $2`, [day, me])).rows;
      const onLeave = (await tx.query(
        `SELECT part FROM teacher_leaves WHERE membership_id = $1 AND status = 'approved' AND $2::date BETWEEN from_date AND to_date`,
        [me, day])).rows[0]?.part ?? null;
      return {
        date: day, today: todayIST(), mode: mode.attendance_mode, periodsPerDay: mode.periods_per_day,
        canEditPast: can(req, 'attendance.view_all'), sections: rows,
        day: dayInfo, schedule, covers, onLeave,
      };
    });
  });

  /** Every section, for when a teacher covers another class. */
  app.get('/attendance/sections', pre, async (req) => {
    if (!mayTake(req)) throw forbidden();
    return schoolTx(db, req, async (tx) => ({
      sections: (await tx.query(
        `SELECT s.id AS "sectionId", c.name AS "className", s.name AS "sectionName"
           FROM sections s JOIN classes c ON c.id = s.class_id
           JOIN academic_years y ON y.id = s.academic_year_id AND y.is_current
          ORDER BY c.sort_order, s.name`)).rows,
    }));
  });

  /** The register for one section, one day (and one period, in period mode). */
  app.get('/attendance/sheet', pre, async (req) => {
    if (!mayTake(req)) throw forbidden();
    const q = z.object({ sectionId: uuid, date: date.optional(), period: z.coerce.number().int().min(0).max(15).default(0) }).parse(req.query);
    const day = q.date ?? todayIST();
    return schoolTx(db, req, async (tx) => {
      await mayTakeSection(tx, req, q.sectionId, day);
      const section = (await tx.query(
        `SELECT s.id, c.name AS "className", s.name AS "sectionName"
           FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.id = $1`, [q.sectionId])).rows[0];
      if (!section) throw notFound('Section not found');
      const session = (await tx.query(
        `SELECT a.id, a.taken_at AS "takenAt", acc.name AS "takenBy", a.subject_id AS "subjectId"
           FROM attendance_sessions a JOIN accounts acc ON acc.id = a.taken_by
          WHERE a.section_id = $1 AND a.on_date = $2 AND a.period_no = $3`, [q.sectionId, day, q.period])).rows[0] ?? null;
      const students = (await tx.query(
        `SELECT st.id, st.first_name AS "firstName", st.last_name AS "lastName", e.roll_no AS "rollNo", st.photo_url AS "photoUrl",
                st.photo_url AS "photoUrl", k.status, k.note
           FROM enrollments e
           JOIN students st ON st.id = e.student_id AND st.status = 'active'
           LEFT JOIN attendance_marks k ON k.student_id = st.id AND k.session_id = $2
          WHERE e.section_id = $1
          ORDER BY e.roll_no NULLS LAST, st.first_name`, [q.sectionId, session?.id ?? null])).rows;
      return { section, date: day, period: q.period, session, students };
    });
  });

  app.put('/attendance/sheet', pre, async (req) => {
    if (!mayTake(req)) throw forbidden();
    const b = z.object({
      sectionId: uuid,
      date,
      period: z.number().int().min(0).max(15),
      subjectId: uuid.optional().nullable(),
      marks: z.array(z.object({
        studentId: uuid, status: z.enum(STATUSES), note: z.string().trim().max(200).optional().nullable(),
      })).min(1).max(200),
    }).parse(req.body);

    const today = todayIST();
    if (b.date > today) throw badRequest('future_date', 'Attendance cannot be taken for a future day');
    if (b.date < today && !can(req, 'attendance.view_all')) {
      throw forbidden('Only today\'s attendance can be changed in the teacher app. Ask the office to correct older days.');
    }

    return schoolTx(db, req, async (tx) => {
      await mayTakeSection(tx, req, b.sectionId, b.date);
      const mode = await schoolMode(tx);
      if (mode.attendance_mode === 'daily' && b.period !== 0) {
        throw badRequest('wrong_mode', 'This school takes attendance once a day');
      }
      if (mode.attendance_mode === 'period' && (b.period < 1 || b.period > mode.periods_per_day)) {
        throw badRequest('wrong_mode', `Choose a period from 1 to ${mode.periods_per_day}`);
      }
      const section = (await tx.query<{ class_name: string; section_name: string }>(
        `SELECT c.name AS class_name, s.name AS section_name FROM sections s JOIN classes c ON c.id = s.class_id
          WHERE s.id = $1`, [b.sectionId])).rows[0];
      if (!section) throw notFound('Section not found');

      // Every active student of the section, exactly once.
      const roster = new Set((await tx.query<{ id: string }>(
        `SELECT st.id FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
          WHERE e.section_id = $1`, [b.sectionId])).rows.map((r) => r.id));
      const given = new Set(b.marks.map((m) => m.studentId));
      if (given.size !== b.marks.length) throw badRequest('duplicate', 'A student appears twice');
      for (const id of given) if (!roster.has(id)) throw badRequest('not_in_section', 'A student is not in this section');
      const missing = roster.size - given.size;
      if (missing > 0) throw badRequest('incomplete', `${missing} ${missing === 1 ? 'student is' : 'students are'} not marked yet`);

      const session = (await tx.query<{ id: string }>(
        `INSERT INTO attendance_sessions (school_id, section_id, on_date, period_no, subject_id, taken_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (section_id, on_date, period_no)
           DO UPDATE SET taken_by = excluded.taken_by, taken_at = now(),
                         subject_id = coalesce(excluded.subject_id, attendance_sessions.subject_id)
         RETURNING id`,
        [req.school!.schoolId, b.sectionId, b.date, b.period, b.subjectId ?? null, req.accountId])).rows[0]!;

      const before = new Map((await tx.query<{ student_id: string; status: string }>(
        'SELECT student_id, status FROM attendance_marks WHERE session_id = $1', [session.id])).rows
        .map((r) => [r.student_id, r.status]));

      for (const m of b.marks) {
        await tx.query(
          `INSERT INTO attendance_marks (school_id, session_id, student_id, status, note)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (session_id, student_id) DO UPDATE SET status = excluded.status, note = excluded.note`,
          [req.school!.schoolId, session.id, m.studentId, m.status, m.note ?? null]);
      }

      // Tell parents of children who are newly absent (only for today, once per day).
      let alerts = 0;
      if (b.date === today) {
        const newlyAbsent = b.marks.filter((m) => m.status === 'absent' && before.get(m.studentId) !== 'absent');
        for (const m of newlyAbsent) {
          const r = await tx.query(
            `INSERT INTO notifications (school_id, account_id, channel, title, body, data)
             SELECT $1, f.account_id, 'push', 'Absent today',
                    st.first_name || ' was marked absent in ' ||
                      section_label($4, $5) || ' on ' || $6 || '.',
                    jsonb_build_object('kind', 'absent', 'studentId', st.id, 'date', $3::text)
               FROM students st JOIN families f ON f.id = st.family_id
              WHERE st.id = $2 AND f.account_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM notifications n
                                 WHERE n.data->>'kind' = 'absent' AND n.data->>'studentId' = st.id::text
                                   AND n.data->>'date' = $3::text)`,
            [req.school!.schoolId, m.studentId, b.date, section.class_name, section.section_name, prettyDate(b.date)]);
          alerts += r.rowCount ?? 0;
        }
      }

      const absent = b.marks.filter((m) => m.status === 'absent').length;
      const leave = b.marks.filter((m) => m.status === 'leave').length;
      return { sessionId: session.id, total: b.marks.length, present: b.marks.length - absent - leave, absent, leave, parentAlerts: alerts };
    });
  });
}
