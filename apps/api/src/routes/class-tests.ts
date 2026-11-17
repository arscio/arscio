// Teachers' own class tests, and assignment (homework) submissions.
//  - A class test is for one subject in one class. The teacher enters marks and
//    "publishes" them: each family gets an app message. Class tests are shown to
//    parents but never count towards the final result.
//  - Assignments: from the due day, the teacher ticks who handed it in (submitted,
//    late, not submitted) and sends the result to parents.
// Who may: the teacher who teaches that subject in that class, the class teacher,
// or the principal/owner.
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Db, Tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { can, schoolTx } from '../context.js';
import { todayIST } from './attendance.js';
import { markText, notifyFamily } from '../exams/workflow.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Teaches this subject in this section, is its class teacher, or is the principal. */
async function teachesHere(tx: Tx, req: FastifyRequest, sectionId: string, subjectId: string | null) {
  if (can(req, 'reportcards.manage')) return true;
  if (!can(req, 'marks.enter') && !can(req, 'homework.post')) return false;
  const r = await tx.query(
    `SELECT 1 FROM sections s WHERE s.id = $1 AND (s.class_teacher_membership = $3
       OR EXISTS (SELECT 1 FROM section_teachers t WHERE t.section_id = s.id AND t.membership_id = $3 AND ($2::uuid IS NULL OR t.subject_id = $2)))`,
    [sectionId, subjectId, req.school!.membershipId]);
  return (r.rowCount ?? 0) > 0;
}

const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function registerClassTestRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler) {
  const pre = { preHandler: requireSchool };

  // ---------------- Class tests ----------------

  /** My class tests (or one class's, for the principal). */
  app.get('/class-tests', pre, async (req) => {
    if (!can(req, 'marks.enter') && !can(req, 'reportcards.manage')) throw forbidden();
    const q = z.object({ sectionId: uuid.optional() }).parse(req.query);
    return schoolTx(db, req, async (tx) => ({
      tests: (await tx.query(
        `SELECT t.id, t.title, t.held_on::text AS "heldOn", t.max_marks AS "maxMarks", t.published_at AS "publishedAt",
                t.section_id AS "sectionId", c.name AS "className", s.name AS "sectionName",
                t.subject_id AS "subjectId", sub.name AS "subjectName", a.name AS "givenBy",
                (SELECT count(*)::int FROM class_test_marks m WHERE m.test_id = t.id) AS entered,
                (SELECT count(*)::int FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
                  WHERE e.section_id = t.section_id) AS total
           FROM class_tests t
           JOIN sections s ON s.id = t.section_id JOIN classes c ON c.id = s.class_id
           JOIN subjects sub ON sub.id = t.subject_id JOIN accounts a ON a.id = t.created_by
          WHERE ($1::uuid IS NULL OR t.section_id = $1) AND ($2::boolean OR t.created_by = $3)
          ORDER BY t.held_on DESC, t.created_at DESC LIMIT 200`,
        [q.sectionId ?? null, can(req, 'reportcards.manage'), req.accountId])).rows,
    }));
  });

  app.post('/class-tests', pre, async (req) => {
    const b = z.object({
      sectionId: uuid, subjectId: uuid,
      title: z.string().trim().min(2, 'Give the test a name').max(80),
      heldOn: date, maxMarks: z.coerce.number().positive().max(1000),
    }).parse(req.body);
    if (b.heldOn > todayIST()) throw badRequest('future', 'A class test can be added on or after the day it was held');
    return schoolTx(db, req, async (tx) => {
      if (!(await teachesHere(tx, req, b.sectionId, b.subjectId))) throw forbidden('You don’t teach this subject in this class');
      const ok = await tx.query(
        'SELECT 1 FROM sections s JOIN class_subjects cs ON cs.class_id = s.class_id AND cs.subject_id = $2 WHERE s.id = $1',
        [b.sectionId, b.subjectId]);
      if (!ok.rowCount) throw badRequest('wrong_subject', 'That subject is not taught in this class');
      return (await tx.query(
        `INSERT INTO class_tests (school_id, section_id, subject_id, title, held_on, max_marks, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.school!.schoolId, b.sectionId, b.subjectId, b.title, b.heldOn, b.maxMarks, req.accountId])).rows[0];
    });
  });

  const ownTest = async (tx: Tx, req: FastifyRequest, id: string) => {
    const t = (await tx.query<{ id: string; section_id: string; subject_id: string; title: string; max_marks: string;
      published_at: Date | null; created_by: string; subject: string }>(
      `SELECT t.*, sub.name AS subject FROM class_tests t JOIN subjects sub ON sub.id = t.subject_id WHERE t.id = $1`, [id])).rows[0];
    if (!t) throw notFound('Class test not found');
    if (t.created_by !== req.accountId && !can(req, 'reportcards.manage')) throw forbidden('Only the teacher who gave this test can change it');
    return t;
  };

  app.get('/class-tests/:id', pre, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const t = await ownTest(tx, req, id);
      const sec = (await tx.query(
        `SELECT c.name AS "className", s.name AS "sectionName" FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.id = $1`,
        [t.section_id])).rows[0];
      const students = (await tx.query(
        `SELECT st.id, st.first_name AS "firstName", st.last_name AS "lastName", e.roll_no AS "rollNo", st.photo_url AS "photoUrl",
                m.marks, coalesce(m.is_absent, false) AS absent
           FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
           LEFT JOIN class_test_marks m ON m.test_id = $2 AND m.student_id = st.id
          WHERE e.section_id = $1 ORDER BY e.roll_no NULLS LAST, st.first_name`, [t.section_id, id])).rows;
      return {
        test: { id: t.id, title: t.title, maxMarks: t.max_marks, publishedAt: t.published_at, subjectName: t.subject,
          heldOn: (await tx.query<{ d: string }>('SELECT held_on::text AS d FROM class_tests WHERE id = $1', [id])).rows[0]!.d },
        section: sec, students,
      };
    });
  });

  /** Save the marks; with publish=true parents are told (corrections later are told too). */
  app.put('/class-tests/:id/marks', pre, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      publish: z.boolean().default(false),
      rows: z.array(z.object({ studentId: uuid, marks: z.number().min(0).nullable().optional(), absent: z.boolean().default(false) })).max(200),
    }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const t = await ownTest(tx, req, id);
      const max = Number(t.max_marks);
      const names = new Map((await tx.query<{ student_id: string; first_name: string }>(
        `SELECT e.student_id, st.first_name FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
          WHERE e.section_id = $1`, [t.section_id])).rows.map((r) => [r.student_id, r.first_name]));
      const before = new Map((await tx.query<{ student_id: string; marks: string | null; is_absent: boolean }>(
        'SELECT student_id, marks, is_absent FROM class_test_marks WHERE test_id = $1', [id])).rows.map((r) => [r.student_id, r]));
      const text = (m: { marks: number | null; absent: boolean } | null) =>
        m ? markText({ marks: m.marks, max, internal: null, internalMax: null, grade: null, absent: m.absent }) : '-';
      const changes: { studentId: string; old: string; now: string }[] = [];
      for (const r of b.rows) {
        if (!names.has(r.studentId)) throw badRequest('not_in_class', 'One of the students is not in this class');
        if (r.marks != null && r.marks > max) throw badRequest('too_high', `Marks can't be more than ${max}`);
        const o = before.get(r.studentId);
        const old = o ? text({ marks: o.marks == null ? null : Number(o.marks), absent: o.is_absent }) : '-';
        if (!r.absent && r.marks == null) {
          await tx.query('DELETE FROM class_test_marks WHERE test_id = $1 AND student_id = $2', [id, r.studentId]);
          if (o) changes.push({ studentId: r.studentId, old, now: '-' });
          continue;
        }
        await tx.query(
          `INSERT INTO class_test_marks (school_id, test_id, student_id, marks, is_absent) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (test_id, student_id) DO UPDATE SET marks = excluded.marks, is_absent = excluded.is_absent`,
          [req.school!.schoolId, id, r.studentId, r.absent ? null : r.marks, r.absent]);
        const now = text({ marks: r.absent ? null : r.marks ?? null, absent: r.absent });
        if (old !== now) changes.push({ studentId: r.studentId, old, now });
      }
      let told = 0;
      if (t.published_at) {
        for (const c of changes.filter((x) => x.now !== '-')) {
          await notifyFamily(tx, c.studentId, `Class test marks corrected: ${t.subject}`,
            `${names.get(c.studentId)}'s marks in "${t.title}" are now ${c.now} (were ${c.old}).`, { kind: 'class_test', testId: id });
          told++;
        }
      } else if (b.publish) {
        await tx.query('UPDATE class_tests SET published_at = now() WHERE id = $1', [id]);
        const all = (await tx.query<{ student_id: string; marks: string | null; is_absent: boolean }>(
          'SELECT student_id, marks, is_absent FROM class_test_marks WHERE test_id = $1', [id])).rows;
        for (const m of all) {
          await notifyFamily(tx, m.student_id, `Class test: ${t.subject}`,
            `${names.get(m.student_id)} got ${text({ marks: m.marks == null ? null : Number(m.marks), absent: m.is_absent })} in "${t.title}". (Class tests don't count in the final result.)`,
            { kind: 'class_test', testId: id });
          told++;
        }
      }
      return { ok: true, published: !!t.published_at || b.publish, parentsTold: told };
    });
  });

  app.delete('/class-tests/:id', pre, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      await ownTest(tx, req, id);
      await tx.query('DELETE FROM class_tests WHERE id = $1', [id]);
      return { ok: true };
    });
  });

  // ---------------- Assignment submissions ----------------

  const homeworkFor = async (tx: Tx, req: FastifyRequest, id: string) => {
    const h = (await tx.query<{ id: string; section_id: string; subject_id: string | null; title: string; due_on: string | null;
      created_by: string; report_sent_at: Date | null; subject: string | null }>(
      `SELECT h.id, h.section_id, h.subject_id, h.title, h.due_on::text AS due_on, h.created_by, h.report_sent_at, sub.name AS subject
         FROM homework h LEFT JOIN subjects sub ON sub.id = h.subject_id WHERE h.id = $1`, [id])).rows[0];
    if (!h) throw notFound('Homework not found');
    if (h.created_by !== req.accountId && !(await teachesHere(tx, req, h.section_id, null))) {
      throw forbidden('Only the teacher who gave this homework, the class teacher or the principal can do this');
    }
    return h;
  };

  app.get('/homework/:id/submissions', pre, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const h = await homeworkFor(tx, req, id);
      const students = (await tx.query(
        `SELECT st.id, st.first_name AS "firstName", st.last_name AS "lastName", e.roll_no AS "rollNo", st.photo_url AS "photoUrl",
                hs.status
           FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
           LEFT JOIN homework_submissions hs ON hs.homework_id = $2 AND hs.student_id = st.id
          WHERE e.section_id = $1 ORDER BY e.roll_no NULLS LAST, st.first_name`, [h.section_id, id])).rows;
      return {
        homework: { id: h.id, title: h.title, dueOn: h.due_on, subjectName: h.subject, reportSentAt: h.report_sent_at,
          canMark: !h.due_on || h.due_on <= todayIST() },
        students,
      };
    });
  });

  /**
   * Tick who handed it in. sendReport=true tells every family (once). After the report
   * has gone, a changed tick tells that one family.
   */
  app.put('/homework/:id/submissions', pre, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      sendReport: z.boolean().default(false),
      rows: z.array(z.object({ studentId: uuid, status: z.enum(['submitted', 'late', 'not_submitted']) })).max(200),
    }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const h = await homeworkFor(tx, req, id);
      if (h.due_on && h.due_on > todayIST()) throw badRequest('not_due', `This can be marked from the due day (${longDate(h.due_on)}).`);
      const names = new Map((await tx.query<{ student_id: string; first_name: string }>(
        `SELECT e.student_id, st.first_name FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
          WHERE e.section_id = $1`, [h.section_id])).rows.map((r) => [r.student_id, r.first_name]));
      const before = new Map((await tx.query<{ student_id: string; status: string }>(
        'SELECT student_id, status FROM homework_submissions WHERE homework_id = $1', [id])).rows.map((r) => [r.student_id, r.status]));
      const word = { submitted: 'handed in', late: 'handed in late', not_submitted: 'did not hand in' } as const;
      const what = `"${h.title}"${h.subject ? ` (${h.subject})` : ''}${h.due_on ? `, due ${longDate(h.due_on)}` : ''}`;
      let told = 0;
      for (const r of b.rows) {
        if (!names.has(r.studentId)) throw badRequest('not_in_class', 'One of the students is not in this class');
        await tx.query(
          `INSERT INTO homework_submissions (school_id, homework_id, student_id, status, marked_by) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (homework_id, student_id) DO UPDATE SET status = excluded.status, marked_by = excluded.marked_by, marked_at = now()`,
          [req.school!.schoolId, id, r.studentId, r.status, req.accountId]);
        if (h.report_sent_at && before.get(r.studentId) !== r.status) {
          await notifyFamily(tx, r.studentId, 'Homework update', `${names.get(r.studentId)} ${word[r.status]} ${what}.`, { kind: 'homework', homeworkId: id });
          told++;
        }
      }
      if (b.sendReport && !h.report_sent_at) {
        const missing = [...names.keys()].filter((sid) => !b.rows.some((r) => r.studentId === sid) && !before.has(sid));
        if (missing.length) throw badRequest('incomplete', `Tick every student first (${missing.length} left).`);
        await tx.query('UPDATE homework SET report_sent_at = now() WHERE id = $1', [id]);
        const all = (await tx.query<{ student_id: string; status: keyof typeof word }>(
          'SELECT student_id, status FROM homework_submissions WHERE homework_id = $1', [id])).rows;
        for (const s of all) {
          if (!names.has(s.student_id)) continue;
          await notifyFamily(tx, s.student_id, `Homework: ${h.subject ?? 'class work'}`, `${names.get(s.student_id)} ${word[s.status]} ${what}.`,
            { kind: 'homework', homeworkId: id });
          told++;
        }
      }
      return { ok: true, reportSent: !!h.report_sent_at || b.sendReport, parentsTold: told };
    });
  });
}
