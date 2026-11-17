// Exams, marks and report cards.
//  - Principal/owner ("reportcards.manage"): sets up terms, exams and weightage, edits
//    the grade scale, locks marks, writes remarks, prints report cards, publishes results.
//  - Teachers ("marks.enter"): enter marks only for the subjects they are responsible for
//    (see exams/workflow.ts), submit them, and can correct them for 7 days afterwards.
//  - Parents see submitted marks straight away, marked "provisional" during those 7 days.
//  - Parents see a term's report card only after the principal publishes it.
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Db, Tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { can, must, schoolTx } from '../context.js';
import { buildReport, gradeFor, scales, type Band } from '../exams/report.js';
import { RESPONSIBLE_SQL, editableUntil, istDate, markText, notifyFamily, responsibleTeacher } from '../exams/workflow.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sent = (b: object, k: string) => Object.prototype.hasOwnProperty.call(b, k);

async function currentYear(tx: Tx) {
  const y = (await tx.query<{ id: string; name: string }>('SELECT id, name FROM academic_years WHERE is_current')).rows[0];
  if (!y) throw badRequest('no_year', 'No current academic year is set');
  return y;
}

/** May this person enter marks for this subject in this section? (principal always; else the responsible teacher) */
async function canEnter(tx: Tx, req: FastifyRequest, sectionId: string, subjectId: string) {
  if (can(req, 'reportcards.manage')) return true;
  if (!can(req, 'marks.enter')) return false;
  const r = await responsibleTeacher(tx, sectionId, subjectId);
  return r.membershipId === req.school!.membershipId;
}

/** Class teacher of this student's section this year, or the principal/owner. */
async function canRemark(tx: Tx, req: FastifyRequest, studentId: string) {
  if (can(req, 'reportcards.manage')) return true;
  const r = await tx.query(
    `SELECT 1 FROM enrollments e JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
       JOIN sections s ON s.id = e.section_id
      WHERE e.student_id = $1 AND s.class_teacher_membership = $2`, [studentId, req.school!.membershipId]);
  return (r.rowCount ?? 0) > 0;
}

const examBody = z.object({
  termId: uuid,
  name: z.string().trim().min(2, 'Give the exam a name').max(60),
  maxMarks: z.coerce.number().positive().max(1000),
  weightagePct: z.coerce.number().min(0).max(100),
  classIds: z.array(uuid).default([]),
  startsOn: date.nullable().optional(),
  endsOn: date.nullable().optional(),
  /** Last day for teachers to submit marks. */
  marksDueOn: date.nullable().optional(),
  /** Subjects with internal marks, e.g. [{ subjectId, internalMax: 20 }]. */
  internals: z.array(z.object({ subjectId: uuid, internalMax: z.coerce.number().positive().max(1000) })).max(40).optional(),
});

function checkDates(b: { startsOn?: string | null; endsOn?: string | null; marksDueOn?: string | null }) {
  if (b.startsOn && b.endsOn && b.endsOn < b.startsOn) throw badRequest('bad_dates', 'The last exam day is before the first');
  const last = b.endsOn ?? b.startsOn;
  if (last && b.marksDueOn && b.marksDueOn < last) throw badRequest('bad_dates', 'The marks deadline must be on or after the last exam day');
}

async function saveInternals(tx: Tx, schoolId: string, examId: string, internals: { subjectId: string; internalMax: number }[]) {
  await tx.query('DELETE FROM exam_subjects WHERE exam_id = $1', [examId]);
  for (const i of internals) {
    await tx.query('INSERT INTO exam_subjects (school_id, exam_id, subject_id, internal_max) VALUES ($1, $2, $3, $4)',
      [schoolId, examId, i.subjectId, i.internalMax]);
  }
}

const bandSchema = z.array(z.object({
  min: z.number().min(0).max(100).optional(),
  max: z.number().min(0).max(100).optional(),
  grade: z.string().trim().min(1).max(4),
  point: z.number().optional(),
  label: z.string().trim().max(40).optional(),
})).min(2).max(12);

export function registerExamRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler) {
  const pre = { preHandler: requireSchool };

  // ---------------- Setup (principal / owner) ----------------

  app.get('/exams/setup', pre, async (req) => {
    if (!can(req, 'reportcards.manage') && !can(req, 'marks.enter')) throw forbidden();
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const terms = (await tx.query(
        `SELECT t.id, t.name, t.sort_order AS "sortOrder", t.published_at AS "publishedAt",
                coalesce((SELECT json_agg(json_build_object('id', x.id, 'name', x.name, 'maxMarks', x.default_max_marks,
                    'weightagePct', x.weightage_pct, 'classIds', x.class_ids, 'startsOn', x.starts_on, 'locked', x.marks_locked,
                    'endsOn', x.ends_on, 'marksDueOn', x.marks_due_on,
                    'internals', coalesce((SELECT json_agg(json_build_object('subjectId', es.subject_id, 'internalMax', es.internal_max))
                                             FROM exam_subjects es WHERE es.exam_id = x.id), '[]'),
                    'marksEntered', (SELECT count(*) FROM marks mk WHERE mk.exam_id = x.id))
                    ORDER BY x.sort_order, x.starts_on NULLS LAST, x.name) FROM exams x WHERE x.term_id = t.id), '[]') AS exams
           FROM terms t WHERE t.academic_year_id = $1 ORDER BY t.sort_order, t.name`, [year.id])).rows;
      const classes = (await tx.query(
        `SELECT id, name, assessment_style AS style FROM classes ORDER BY sort_order`)).rows;
      const subjects = (await tx.query(`SELECT id, name FROM subjects ORDER BY name`)).rows;
      const sc = await scales(tx);
      return { year, terms, classes, subjects, scales: sc.all };
    });
  });

  app.post('/exams/terms', pre, async (req) => {
    must(req, 'reportcards.manage');
    const b = z.object({ name: z.string().trim().min(2, 'Give the term a name').max(40) }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const dupe = await tx.query('SELECT 1 FROM terms WHERE academic_year_id = $1 AND lower(name) = lower($2)', [year.id, b.name]);
      if (dupe.rowCount) throw badRequest('duplicate', 'There is already a term with that name');
      return (await tx.query(
        `INSERT INTO terms (school_id, academic_year_id, name, sort_order)
         VALUES ($1, $2, $3, (SELECT coalesce(max(sort_order), 0) + 1 FROM terms WHERE academic_year_id = $2))
         RETURNING id, name`, [req.school!.schoolId, year.id, b.name])).rows[0];
    });
  });

  app.patch('/exams/terms/:id', pre, async (req) => {
    must(req, 'reportcards.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ name: z.string().trim().min(2).max(40) }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const r = await tx.query('UPDATE terms SET name = $2 WHERE id = $1 RETURNING id, name', [id, b.name]);
      if (!r.rowCount) throw notFound('Term not found');
      return r.rows[0];
    });
  });

  /** Publish (or un-publish) a term's report cards to parents. */
  app.post('/exams/terms/:id/publish', pre, async (req) => {
    must(req, 'reportcards.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ published: z.boolean() }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const t = (await tx.query<{ name: string; academic_year_id: string; published_at: string | null }>(
        'SELECT name, academic_year_id, published_at FROM terms WHERE id = $1', [id])).rows[0];
      if (!t) throw notFound('Term not found');
      if (!b.published) {
        await tx.query('UPDATE terms SET published_at = NULL, published_by = NULL WHERE id = $1', [id]);
        return { published: false, notified: 0 };
      }
      if (t.published_at) return { published: true, notified: 0 };
      await tx.query('UPDATE terms SET published_at = now(), published_by = $2 WHERE id = $1', [id, req.accountId]);
      // One app message per family whose child is in a class that has exams this term.
      const n = await tx.query(
        `INSERT INTO notifications (school_id, account_id, channel, title, body, data)
         SELECT DISTINCT ON (f.account_id) $1::uuid, f.account_id, 'push', $3::text,
                st.first_name || '''s report card is ready in the app.', jsonb_build_object('kind', 'report_card', 'termId', $2::text, 'studentId', st.id::text)
           FROM enrollments e
           JOIN students st ON st.id = e.student_id AND st.status = 'active'
           JOIN families f ON f.id = st.family_id AND f.account_id IS NOT NULL
           JOIN sections s ON s.id = e.section_id
          WHERE e.academic_year_id = $4
            AND EXISTS (SELECT 1 FROM exams x WHERE x.term_id = $2::uuid AND (cardinality(x.class_ids) = 0 OR s.class_id = ANY(x.class_ids)))`,
        [req.school!.schoolId, id, `${t.name} report card`, t.academic_year_id]);
      return { published: true, notified: n.rowCount ?? 0 };
    });
  });

  app.post('/exams', pre, async (req) => {
    must(req, 'reportcards.manage');
    const b = examBody.parse(req.body);
    checkDates(b);
    return schoolTx(db, req, async (tx) => {
      const dupe = await tx.query('SELECT 1 FROM exams WHERE term_id = $1 AND lower(name) = lower($2)', [b.termId, b.name]);
      if (dupe.rowCount) throw badRequest('duplicate', 'This term already has an exam with that name');
      const x = (await tx.query<{ id: string; name: string }>(
        `INSERT INTO exams (school_id, term_id, name, default_max_marks, weightage_pct, class_ids, starts_on, ends_on, marks_due_on, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, (SELECT coalesce(max(sort_order), 0) + 1 FROM exams WHERE term_id = $2))
         RETURNING id, name`,
        [req.school!.schoolId, b.termId, b.name, b.maxMarks, b.weightagePct, b.classIds, b.startsOn ?? null,
         b.endsOn ?? null, b.marksDueOn ?? null])).rows[0]!;
      if (b.internals?.length) await saveInternals(tx, req.school!.schoolId, x.id, b.internals);
      return x;
    });
  });

  app.patch('/exams/:id', pre, async (req) => {
    must(req, 'reportcards.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const raw = (req.body ?? {}) as object;
    const b = examBody.omit({ termId: true }).partial().extend({ locked: z.boolean().optional() }).parse(raw);
    return schoolTx(db, req, async (tx) => {
      const sets: string[] = []; const vals: unknown[] = [id];
      const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
      if (sent(raw, 'name')) set('name', b.name);
      if (sent(raw, 'maxMarks')) set('default_max_marks', b.maxMarks);
      if (sent(raw, 'weightagePct')) set('weightage_pct', b.weightagePct);
      if (sent(raw, 'classIds')) set('class_ids', b.classIds);
      if (sent(raw, 'startsOn')) set('starts_on', b.startsOn ?? null);
      if (sent(raw, 'endsOn')) set('ends_on', b.endsOn ?? null);
      if (sent(raw, 'marksDueOn')) set('marks_due_on', b.marksDueOn ?? null);
      if (sent(raw, 'locked')) set('marks_locked', b.locked);
      if (!sets.length && !sent(raw, 'internals')) throw badRequest('nothing', 'Nothing to change');
      if (sets.length) {
        const r = await tx.query(`UPDATE exams SET ${sets.join(', ')} WHERE id = $1 RETURNING id`, vals);
        if (!r.rowCount) throw notFound('Exam not found');
      }
      const now = (await tx.query<{ s: string | null; e: string | null; d: string | null }>(
        `SELECT starts_on::text AS s, ends_on::text AS e, marks_due_on::text AS d FROM exams WHERE id = $1`, [id])).rows[0];
      if (!now) throw notFound('Exam not found');
      checkDates({ startsOn: now.s, endsOn: now.e, marksDueOn: now.d });
      // Marks already entered keep their own internal maximum; new entries use the new one.
      if (sent(raw, 'internals')) await saveInternals(tx, req.school!.schoolId, id, b.internals ?? []);
      return { ok: true };
    });
  });

  app.delete('/exams/:id', pre, async (req) => {
    must(req, 'reportcards.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const used = await tx.query('SELECT 1 FROM marks WHERE exam_id = $1 LIMIT 1', [id]);
      if (used.rowCount) throw badRequest('has_marks', 'Marks have already been entered for this exam, so it cannot be removed');
      const r = await tx.query('DELETE FROM exams WHERE id = $1', [id]);
      if (!r.rowCount) throw notFound('Exam not found');
      return { ok: true };
    });
  });

  app.put('/exams/scales/:id', pre, async (req) => {
    must(req, 'reportcards.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { bands } = z.object({ bands: bandSchema }).parse(req.body);
    const withRanges = bands.filter((x) => x.min !== undefined);
    if (withRanges.length && withRanges.length !== bands.length) throw badRequest('bad_scale', 'Every grade needs a mark range');
    return schoolTx(db, req, async (tx) => {
      const r = await tx.query('UPDATE grading_scales SET bands = $2 WHERE id = $1', [id, JSON.stringify(bands)]);
      if (!r.rowCount) throw notFound('Grade scale not found');
      return { ok: true };
    });
  });

  // ---------------- Marks entry ----------------

  type Sub = { first_submitted_at: Date; reopened_until: Date | null; submitted_by: string };
  const loadSubmission = async (tx: Tx, examId: string, sectionId: string, subjectId: string) =>
    (await tx.query<Sub>(
      `SELECT first_submitted_at, reopened_until, submitted_by FROM marks_submissions
        WHERE exam_id = $1 AND section_id = $2 AND subject_id = $3`, [examId, sectionId, subjectId])).rows[0];

  /** Where a marks list stands, in one word the apps can show. */
  function statusOf(r: { locked: boolean; startsOn: string | null; entered: number; total: number; submittedAt: Date | null; editableUntil: Date | null }, today: string) {
    if (r.locked) return 'locked';
    if (r.startsOn && r.startsOn > today) return 'upcoming';
    if (r.submittedAt) return r.editableUntil && r.editableUntil > new Date() ? 'submitted' : 'final';
    return r.entered > 0 ? 'draft' : 'to_do';
  }
  const todayIst = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

  /**
   * My marks lists: every exam x class x subject I am responsible for (including exams
   * that haven't started yet, so teachers see what's coming). Principal with ?all=1: everything.
   */
  app.get('/marks/tasks', pre, async (req) => {
    if (!can(req, 'marks.enter') && !can(req, 'reportcards.manage')) throw forbidden();
    const { all } = z.object({ all: z.enum(['1', '0']).optional() }).parse(req.query);
    const everything = all === '1' && can(req, 'reportcards.manage');
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const rows = (await tx.query(
        `SELECT x.id AS "examId", x.name AS "examName", t.name AS "termName", x.marks_locked AS locked,
                x.starts_on::text AS "startsOn", x.ends_on::text AS "endsOn", x.marks_due_on::text AS "marksDueOn",
                s.id AS "sectionId", c.name AS "className", s.name AS "sectionName", c.assessment_style AS style,
                sub.id AS "subjectId", sub.name AS "subjectName",
                (SELECT count(*)::int FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
                  WHERE e.section_id = s.id) AS total,
                (SELECT count(*)::int FROM marks mk JOIN enrollments e ON e.student_id = mk.student_id AND e.section_id = s.id
                  WHERE mk.exam_id = x.id AND mk.subject_id = sub.id) AS entered,
                ms.first_submitted_at AS "submittedAt", ms.reopened_until AS "reopenedUntil"
           FROM exams x
           JOIN terms t ON t.id = x.term_id AND t.academic_year_id = $1
           JOIN sections s ON s.academic_year_id = $1
           JOIN classes c ON c.id = s.class_id AND (cardinality(x.class_ids) = 0 OR c.id = ANY(x.class_ids))
           JOIN class_subjects cs ON cs.class_id = c.id
           JOIN subjects sub ON sub.id = cs.subject_id
           LEFT JOIN marks_submissions ms ON ms.exam_id = x.id AND ms.section_id = s.id AND ms.subject_id = sub.id
          WHERE $2::boolean OR ${RESPONSIBLE_SQL('$3')}
          ORDER BY t.sort_order, x.sort_order, c.sort_order, s.name, cs.sort_order`,
        [year.id, everything, req.school!.membershipId])).rows;
      const today = todayIst();
      return {
        tasks: rows.map((r) => {
          const until = r.submittedAt ? editableUntil({ first_submitted_at: r.submittedAt, reopened_until: r.reopenedUntil }) : null;
          const status = statusOf({ ...r, editableUntil: until }, today);
          return {
            ...r, editableUntil: until, status,
            overdue: !r.submittedAt && !!r.marksDueOn && r.marksDueOn < today && !r.locked,
          };
        }),
      };
    });
  });

  /** Principal: one exam, every class and subject: who enters, how far they are, and who is late. */
  app.get('/marks/progress', pre, async (req) => {
    must(req, 'reportcards.manage');
    const { examId } = z.object({ examId: uuid }).parse(req.query);
    return schoolTx(db, req, async (tx) => {
      const exam = (await tx.query(
        `SELECT x.id, x.name, x.class_ids AS "classIds", x.marks_locked AS locked, x.starts_on::text AS "startsOn",
                x.ends_on::text AS "endsOn", x.marks_due_on::text AS "marksDueOn", t.academic_year_id AS "yearId"
           FROM exams x JOIN terms t ON t.id = x.term_id WHERE x.id = $1`, [examId])).rows[0];
      if (!exam) throw notFound('Exam not found');
      const rows = (await tx.query(
        `SELECT s.id AS "sectionId", c.name AS "className", s.name AS "sectionName",
                sub.id AS "subjectId", sub.name AS "subjectName",
                (SELECT count(*)::int FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
                  WHERE e.section_id = s.id) AS total,
                (SELECT count(*)::int FROM marks mk JOIN enrollments e ON e.student_id = mk.student_id AND e.section_id = s.id
                  WHERE mk.exam_id = $1 AND mk.subject_id = sub.id) AS entered,
                ms.first_submitted_at AS "submittedAt", ms.reopened_until AS "reopenedUntil"
           FROM sections s
           JOIN classes c ON c.id = s.class_id AND (cardinality($2::uuid[]) = 0 OR c.id = ANY($2))
           JOIN class_subjects cs ON cs.class_id = c.id
           JOIN subjects sub ON sub.id = cs.subject_id
           LEFT JOIN marks_submissions ms ON ms.exam_id = $1 AND ms.section_id = s.id AND ms.subject_id = sub.id
          WHERE s.academic_year_id = $3
          ORDER BY c.sort_order, s.name, cs.sort_order`, [examId, exam.classIds, exam.yearId])).rows;
      const today = todayIst();
      const out = [];
      for (const r of rows) {
        const until = r.submittedAt ? editableUntil({ first_submitted_at: r.submittedAt, reopened_until: r.reopenedUntil }) : null;
        out.push({
          ...r, editableUntil: until,
          status: statusOf({ locked: exam.locked, startsOn: exam.startsOn, entered: r.entered, total: r.total, submittedAt: r.submittedAt, editableUntil: until }, today),
          overdue: !r.submittedAt && !!exam.marksDueOn && exam.marksDueOn < today && !exam.locked,
          teacher: await responsibleTeacher(tx, r.sectionId, r.subjectId),
        });
      }
      return { exam, rows: out };
    });
  });

  /** Principal picks who enters a subject's marks in a class (when several teachers teach it). */
  app.put('/marks/teacher', pre, async (req) => {
    must(req, 'reportcards.manage');
    const b = z.object({ sectionId: uuid, subjectId: uuid, membershipId: uuid.nullable() }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      if (!b.membershipId) {
        await tx.query('DELETE FROM marks_teachers WHERE section_id = $1 AND subject_id = $2', [b.sectionId, b.subjectId]);
        return { ok: true };
      }
      const ok = await tx.query(
        `SELECT 1 FROM memberships m JOIN membership_roles r ON r.membership_id = m.id AND r.role = 'teacher'
          WHERE m.id = $1 AND m.status = 'active'`, [b.membershipId]);
      if (!ok.rowCount) throw badRequest('not_teacher', 'Choose a teacher of this school');
      await tx.query(
        `INSERT INTO marks_teachers (school_id, section_id, subject_id, membership_id, chosen_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (section_id, subject_id) DO UPDATE SET membership_id = excluded.membership_id, chosen_by = excluded.chosen_by, chosen_at = now()`,
        [req.school!.schoolId, b.sectionId, b.subjectId, b.membershipId, req.accountId]);
      return { ok: true };
    });
  });

  /** Principal gives the teacher a few more days to correct submitted marks. */
  app.post('/marks/reopen', pre, async (req) => {
    must(req, 'reportcards.manage');
    const b = z.object({ examId: uuid, sectionId: uuid, subjectId: uuid, days: z.coerce.number().int().min(1).max(14) }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const r = await tx.query<{ reopened_until: Date }>(
        `UPDATE marks_submissions SET reopened_until = now() + make_interval(days => $4), reopened_by = $5
          WHERE exam_id = $1 AND section_id = $2 AND subject_id = $3 RETURNING reopened_until`,
        [b.examId, b.sectionId, b.subjectId, b.days, req.accountId]);
      if (!r.rowCount) throw badRequest('not_submitted', 'These marks have not been submitted yet, so they are still open');
      return { editableUntil: r.rows[0]!.reopened_until };
    });
  });

  app.get('/marks/sheet', pre, async (req) => {
    const q = z.object({ examId: uuid, sectionId: uuid, subjectId: uuid }).parse(req.query);
    return schoolTx(db, req, async (tx) => {
      if (!(await canEnter(tx, req, q.sectionId, q.subjectId))) throw forbidden('Another teacher enters the marks for this subject in this class');
      const exam = (await tx.query(
        `SELECT x.id, x.name, t.name AS "termName", x.default_max_marks AS "maxMarks", x.marks_locked AS locked, x.class_ids AS "classIds",
                x.starts_on::text AS "startsOn", x.marks_due_on::text AS "marksDueOn",
                (SELECT internal_max FROM exam_subjects es WHERE es.exam_id = x.id AND es.subject_id = $2) AS "internalMax"
           FROM exams x JOIN terms t ON t.id = x.term_id WHERE x.id = $1`, [q.examId, q.subjectId])).rows[0];
      if (!exam) throw notFound('Exam not found');
      const sec = (await tx.query(
        `SELECT s.id, c.id AS "classId", c.name AS "className", s.name AS "sectionName", c.assessment_style AS style
           FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.id = $1`, [q.sectionId])).rows[0];
      if (!sec) throw notFound('Class not found');
      if (exam.classIds.length && !exam.classIds.includes(sec.classId)) throw badRequest('not_for_class', 'This exam is not set for this class');
      const subject = (await tx.query('SELECT id, name FROM subjects WHERE id = $1', [q.subjectId])).rows[0];
      if (!subject) throw notFound('Subject not found');
      const sc = await scales(tx);
      const students = (await tx.query(
        `SELECT st.id, st.first_name AS "firstName", st.last_name AS "lastName", e.roll_no AS "rollNo", st.photo_url AS "photoUrl",
                mk.marks_obtained AS marks, mk.max_marks AS "maxMarks", mk.grade, coalesce(mk.is_absent, false) AS absent,
                mk.internal_marks AS internal, mk.internal_max AS "internalMax"
           FROM enrollments e
           JOIN students st ON st.id = e.student_id AND st.status = 'active'
           LEFT JOIN marks mk ON mk.student_id = st.id AND mk.exam_id = $2 AND mk.subject_id = $3
          WHERE e.section_id = $1
          ORDER BY e.roll_no NULLS LAST, st.first_name`, [q.sectionId, q.examId, q.subjectId])).rows;
      const used = students.find((s) => s.maxMarks)?.maxMarks;
      const usedInternal = students.find((s) => s.internalMax)?.internalMax;
      const sub = await loadSubmission(tx, q.examId, q.sectionId, q.subjectId);
      const until = editableUntil(sub);
      const principal = can(req, 'reportcards.manage');
      const notStarted = !!exam.startsOn && exam.startsOn > todayIst();
      let canEdit = true; let why: string | null = null;
      if (!principal) {
        if (exam.locked) { canEdit = false; why = 'The principal has locked the marks for this exam.'; }
        else if (notStarted) { canEdit = false; why = `This exam starts on ${exam.startsOn}. Marks can be entered from then.`; }
        else if (until && until < new Date()) { canEdit = false; why = `The 7 days to correct these marks ended on ${istDate(until)}. Ask the principal to reopen them.`; }
      }
      return {
        exam: {
          id: exam.id, name: exam.name, termName: exam.termName, maxMarks: used ?? exam.maxMarks, locked: exam.locked,
          internalMax: sec.style === 'grades_only' ? null : (usedInternal ?? exam.internalMax ?? null), marksDueOn: exam.marksDueOn,
        },
        section: { id: sec.id, className: sec.className, sectionName: sec.sectionName, style: sec.style },
        subject,
        gradeOptions: (sc.grades?.bands ?? []).map((b: Band) => ({ grade: b.grade, label: b.label ?? null })),
        scale: sc.marks?.bands ?? [],
        submission: sub ? { submittedAt: sub.first_submitted_at, editableUntil: until, open: !!until && until > new Date() } : null,
        canEdit, whyNot: why,
        students,
      };
    });
  });

  /**
   * Save marks. With submit=true (the first time), parents see them and the 7 days start.
   * After submitting, every change is recorded and the child's family is told.
   */
  app.put('/marks/sheet', pre, async (req) => {
    const b = z.object({
      examId: uuid, sectionId: uuid, subjectId: uuid,
      maxMarks: z.coerce.number().positive().max(1000).optional(),
      submit: z.boolean().default(false),
      rows: z.array(z.object({
        studentId: uuid,
        marks: z.number().min(0).nullable().optional(),
        internal: z.number().min(0).nullable().optional(),
        grade: z.string().trim().max(4).nullable().optional(),
        absent: z.boolean().default(false),
      })).max(200),
    }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      if (!(await canEnter(tx, req, b.sectionId, b.subjectId))) throw forbidden('Another teacher enters the marks for this subject in this class');
      const principal = can(req, 'reportcards.manage');
      const exam = (await tx.query<{ name: string; max: string; locked: boolean; class_ids: string[]; starts_on: string | null; internal_max: string | null }>(
        `SELECT name, default_max_marks AS max, marks_locked AS locked, class_ids, starts_on::text,
                (SELECT internal_max FROM exam_subjects es WHERE es.exam_id = x.id AND es.subject_id = $2) AS internal_max
           FROM exams x WHERE id = $1`, [b.examId, b.subjectId])).rows[0];
      if (!exam) throw notFound('Exam not found');
      if (exam.locked && !principal) throw forbidden('Marks for this exam are locked. Ask the principal to unlock them.');
      if (!principal && exam.starts_on && exam.starts_on > todayIst()) throw forbidden('This exam has not started yet');
      const sub = await loadSubmission(tx, b.examId, b.sectionId, b.subjectId);
      const until = editableUntil(sub);
      if (!principal && until && until < new Date()) {
        throw forbidden(`The 7 days to correct these marks ended on ${istDate(until)}. Ask the principal to reopen them.`);
      }
      const sec = (await tx.query<{ class_id: string; style: string }>(
        `SELECT s.class_id, c.assessment_style AS style FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.id = $1`, [b.sectionId])).rows[0];
      if (!sec) throw notFound('Class not found');
      if (exam.class_ids.length && !exam.class_ids.includes(sec.class_id)) throw badRequest('not_for_class', 'This exam is not set for this class');
      const students = new Map((await tx.query<{ student_id: string; first_name: string }>(
        `SELECT e.student_id, st.first_name FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
          WHERE e.section_id = $1`, [b.sectionId])).rows.map((r) => [r.student_id, r.first_name]));
      const subjectName = (await tx.query<{ name: string }>('SELECT name FROM subjects WHERE id = $1', [b.subjectId])).rows[0]?.name ?? 'Subject';
      const gradesOnly = sec.style === 'grades_only';
      const sc = await scales(tx);
      const allowed = new Set((sc.grades?.bands ?? []).map((x) => x.grade));
      const max = b.maxMarks ?? Number(exam.max);
      const internalMax = gradesOnly || !exam.internal_max ? null : Number(exam.internal_max);

      type Old = { marks: string | null; max: string | null; internal: string | null; internal_max: string | null; grade: string | null; absent: boolean };
      const before = new Map((await tx.query<Old & { student_id: string }>(
        `SELECT student_id, marks_obtained AS marks, max_marks AS max, internal_marks AS internal, internal_max, grade, is_absent AS absent
           FROM marks WHERE exam_id = $1 AND subject_id = $2 AND student_id = ANY($3)`,
        [b.examId, b.subjectId, b.rows.map((r) => r.studentId)])).rows.map((r) => [r.student_id, r]));
      const asText = (m: Old | undefined) => m ? markText({
        marks: m.marks == null ? null : Number(m.marks), max: m.max == null ? null : Number(m.max),
        internal: m.internal == null ? null : Number(m.internal), internalMax: m.internal_max == null ? null : Number(m.internal_max),
        grade: m.grade, absent: m.absent }) : '-';

      let saved = 0;
      const changed: { studentId: string; old: string; now: string; oldRow: Old | undefined; newRow: Old | undefined }[] = [];
      for (const r of b.rows) {
        if (!students.has(r.studentId)) throw badRequest('not_in_class', 'One of the students is not in this class');
        const empty = !r.absent && (gradesOnly ? !r.grade : r.marks == null);
        let newRow: Old | undefined;
        if (empty) {
          if (sub && before.has(r.studentId) && !principal) throw badRequest('cant_clear', 'Submitted marks can be corrected but not left blank. Tick Absent if the student missed the exam.');
          await tx.query('DELETE FROM marks WHERE exam_id = $1 AND student_id = $2 AND subject_id = $3', [b.examId, r.studentId, b.subjectId]);
        } else {
          if (!gradesOnly && r.marks != null && r.marks > max) throw badRequest('too_high', `Marks can't be more than ${max}`);
          if (internalMax !== null && r.internal != null && r.internal > internalMax) throw badRequest('too_high', `Internal marks can't be more than ${internalMax}`);
          if (gradesOnly && r.grade && !allowed.has(r.grade)) throw badRequest('bad_grade', `"${r.grade}" is not on the grade scale`);
          const marksVal = gradesOnly || r.absent ? null : r.marks;
          const internalVal = internalMax === null || r.absent ? null : (r.internal ?? null);
          const totalPct = marksVal != null ? ((marksVal + (internalVal ?? 0)) / (max + (internalMax ?? 0))) * 100 : null;
          const grade = gradesOnly ? (r.absent ? null : r.grade) : (totalPct !== null ? gradeFor(sc.marks?.bands ?? [], totalPct) : null);
          await tx.query(
            `INSERT INTO marks (school_id, exam_id, student_id, subject_id, marks_obtained, max_marks, grade, is_absent, entered_by, internal_marks, internal_max)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (exam_id, student_id, subject_id) DO UPDATE
               SET marks_obtained = excluded.marks_obtained, max_marks = excluded.max_marks, grade = excluded.grade,
                   is_absent = excluded.is_absent, entered_by = excluded.entered_by, entered_at = now(),
                   internal_marks = excluded.internal_marks, internal_max = excluded.internal_max`,
            [req.school!.schoolId, b.examId, r.studentId, b.subjectId, marksVal, gradesOnly ? null : max, grade, r.absent,
             req.accountId, internalVal, internalVal === null && internalMax === null ? null : internalMax]);
          newRow = { marks: marksVal == null ? null : String(marksVal), max: gradesOnly ? null : String(max),
            internal: internalVal == null ? null : String(internalVal), internal_max: internalMax == null ? null : String(internalMax),
            grade: grade ?? null, absent: r.absent };
          saved++;
        }
        const old = before.get(r.studentId);
        if (sub && asText(old) !== asText(newRow)) changed.push({ studentId: r.studentId, old: asText(old), now: asText(newRow), oldRow: old, newRow });
      }

      // Already submitted: keep a record of every correction and tell the family.
      if (sub && changed.length) {
        for (const c of changed) {
          await tx.query(
            `INSERT INTO marks_changes (school_id, exam_id, student_id, subject_id, old_value, new_value, changed_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [req.school!.schoolId, b.examId, c.studentId, b.subjectId, JSON.stringify(c.oldRow ?? null), JSON.stringify(c.newRow ?? null), req.accountId]);
          await notifyFamily(tx, c.studentId, `Marks corrected: ${subjectName}`,
            `${students.get(c.studentId)}'s ${exam.name} marks in ${subjectName} are now ${c.now} (were ${c.old}).`,
            { kind: 'marks', examId: b.examId, subjectId: b.subjectId });
        }
        await tx.query('UPDATE marks_submissions SET last_changed_at = now() WHERE exam_id = $1 AND section_id = $2 AND subject_id = $3',
          [b.examId, b.sectionId, b.subjectId]);
      }

      // First submit: everyone must have marks (or be marked absent). Then parents are told.
      let submittedNow = false;
      if (b.submit && !sub) {
        const missing = (await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
            WHERE e.section_id = $1 AND NOT EXISTS (SELECT 1 FROM marks mk WHERE mk.exam_id = $2 AND mk.subject_id = $3 AND mk.student_id = e.student_id)`,
          [b.sectionId, b.examId, b.subjectId])).rows[0]!.n;
        if (missing) {
          throw badRequest('incomplete', `${missing} ${missing === 1 ? 'student has' : 'students have'} no marks yet. Enter marks or tick Absent for everyone, then submit.`);
        }
        const ins = (await tx.query<{ first_submitted_at: Date }>(
          `INSERT INTO marks_submissions (school_id, exam_id, section_id, subject_id, submitted_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING first_submitted_at`,
          [req.school!.schoolId, b.examId, b.sectionId, b.subjectId, req.accountId])).rows[0]!;
        const until2 = editableUntil({ first_submitted_at: ins.first_submitted_at, reopened_until: null })!;
        const all = (await tx.query<Old & { student_id: string }>(
          `SELECT student_id, marks_obtained AS marks, max_marks AS max, internal_marks AS internal, internal_max, grade, is_absent AS absent
             FROM marks WHERE exam_id = $1 AND subject_id = $2 AND student_id = ANY($3)`,
          [b.examId, b.subjectId, [...students.keys()]])).rows;
        for (const m of all) {
          await notifyFamily(tx, m.student_id, `${exam.name} marks: ${subjectName}`,
            `${students.get(m.student_id)} got ${asText(m)}. These can still be corrected until ${istDate(until2)}.`,
            { kind: 'marks', examId: b.examId, subjectId: b.subjectId });
        }
        submittedNow = true;
      }
      const s2 = await loadSubmission(tx, b.examId, b.sectionId, b.subjectId);
      return { saved, submitted: !!s2, submittedNow, editableUntil: editableUntil(s2), parentsTold: submittedNow ? students.size : changed.length };
    });
  });

  // ---------------- Remarks and report cards ----------------

  app.put('/reportcards/remark', pre, async (req) => {
    const b = z.object({ termId: uuid, studentId: uuid, remark: z.string().trim().max(400) }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      if (!(await canRemark(tx, req, b.studentId))) throw forbidden('Only the class teacher or the principal can write this remark');
      if (!b.remark) {
        await tx.query('DELETE FROM report_remarks WHERE term_id = $1 AND student_id = $2 AND subject_id IS NULL', [b.termId, b.studentId]);
        return { ok: true };
      }
      const up = await tx.query(
        `UPDATE report_remarks SET remark = $3, written_by = $4, written_at = now()
          WHERE term_id = $1 AND student_id = $2 AND subject_id IS NULL`, [b.termId, b.studentId, b.remark, req.accountId]);
      if (!up.rowCount) {
        await tx.query(
          `INSERT INTO report_remarks (school_id, term_id, student_id, subject_id, remark, written_by)
           VALUES ($1, $2, $3, NULL, $4, $5)`, [req.school!.schoolId, b.termId, b.studentId, b.remark, req.accountId]);
      }
      return { ok: true };
    });
  });

  /** A class's report cards: each student's results at a glance, for checking before printing. */
  app.get('/reportcards/section/:sectionId', pre, async (req) => {
    const { sectionId } = z.object({ sectionId: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const sec = (await tx.query(
        `SELECT s.id, c.name AS "className", s.name AS "sectionName", s.class_teacher_membership AS ct
           FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.id = $1`, [sectionId])).rows[0];
      if (!sec) throw notFound('Class not found');
      if (!can(req, 'reportcards.manage') && sec.ct !== req.school!.membershipId) throw forbidden();
      const ids = (await tx.query<{ id: string }>(
        `SELECT st.id FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
          WHERE e.section_id = $1 ORDER BY e.roll_no NULLS LAST, st.first_name`, [sectionId])).rows.map((r) => r.id);
      const reports = [];
      for (const id of ids) reports.push(await buildReport(tx, id, { publishedOnly: false }));
      return { section: { id: sec.id, className: sec.className, sectionName: sec.sectionName }, reports };
    });
  });

  app.get('/reportcards/student/:id', pre, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      if (!(await canRemark(tx, req, id))) throw forbidden();
      return buildReport(tx, id, { publishedOnly: false });
    });
  });
}
