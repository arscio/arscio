// Moving to a new school year (usually in April).
//  1. Prepare: create next year, with the same classes and sections (and, if wanted, the same
//     class teachers, subject teachers, timetable and fee structure).
//  2. Decide for each student: move up, stay in the same class, leaving, or passed out.
//  3. Start the new year: report cards are filed in every student's file, students are placed in
//     next year's sections with fresh roll numbers, leavers are marked, fees for the year are created.
//  The same day, if nothing has happened in the new year yet, the move can be undone.
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { addSection } from '../students/sections.js';
import type { Db, Tx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { must, schoolTx } from '../context.js';
import { buildReport } from '../exams/report.js';
import { reportCardPdf } from '../exams/report-pdf.js';
import { classFig } from '../certificates/words.js';

const uuid = z.string().uuid();

async function years(tx: Tx) {
  const cur = (await tx.query<{ id: string; name: string; startsOn: string; endsOn: string }>(
    `SELECT id, name, starts_on::text AS "startsOn", ends_on::text AS "endsOn" FROM academic_years WHERE is_current`)).rows[0];
  if (!cur) throw badRequest('no_year', 'Set up the current school year first');
  const next = (await tx.query<{ id: string; name: string; startsOn: string; endsOn: string }>(
    `SELECT id, name, starts_on::text AS "startsOn", ends_on::text AS "endsOn" FROM academic_years
      WHERE NOT is_current AND starts_on > $1 ORDER BY starts_on LIMIT 1`, [cur.startsOn])).rows[0] ?? null;
  return { cur, next };
}

const addYear = (iso: string) => `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;
const nextName = (name: string) => {
  const m = /^(\d{4})-(\d{2,4})$/.exec(name);
  if (!m) return '';
  const a = Number(m[1]) + 1;
  return `${a}-${m[2]!.length === 2 ? String(a + 1).slice(2) : a + 1}`;
};

export function registerNewYearRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler) {
  const pre = { preHandler: requireSchool };

  app.get('/new-year', pre, async (req) => {
    must(req, 'school.settings');
    return schoolTx(db, req, async (tx) => {
      const { cur, next } = await years(tx);
      const classes = (await tx.query<{ id: string; name: string; sortOrder: number }>(
        'SELECT id, name, sort_order AS "sortOrder" FROM classes ORDER BY sort_order')).rows;
      const sectionsOf = async (yearId: string) => (await tx.query(
        `SELECT s.id, s.class_id AS "classId", c.name AS "className", s.name, m.display_name AS "classTeacher",
                (SELECT count(*)::int FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active' WHERE e.section_id = s.id) AS students
           FROM sections s JOIN classes c ON c.id = s.class_id LEFT JOIN memberships m ON m.id = s.class_teacher_membership
          WHERE s.academic_year_id = $1 ORDER BY c.sort_order, s.name`, [yearId])).rows;
      const curSections = await sectionsOf(cur.id);
      const students = (await tx.query(
        `SELECT st.id, st.first_name || coalesce(' ' || st.last_name, '') AS name, st.admission_no AS "admissionNo",
                e.section_id AS "sectionId", e.roll_no AS "rollNo"
           FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
          WHERE e.academic_year_id = $1 ORDER BY e.roll_no NULLS LAST, st.first_name`, [cur.id])).rows;
      const published = (await tx.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM terms WHERE academic_year_id = $1 AND published_at IS NOT NULL', [cur.id])).rows[0]!.n;
      const last = (await tx.query(
        `SELECT t.id, t.done_at AS "doneAt", t.summary, y.name AS "toYear", (t.to_year_id = $1) AS "isThisYear"
           FROM year_transitions t JOIN academic_years y ON y.id = t.to_year_id
          WHERE t.undone_at IS NULL ORDER BY t.done_at DESC LIMIT 1`, [cur.id])).rows[0] ?? null;
      return {
        current: cur,
        next: next ? { ...next, sections: await sectionsOf(next.id) } : null,
        suggest: { name: nextName(cur.name), startsOn: addYear(cur.startsOn), endsOn: addYear(cur.endsOn) },
        classes, sections: curSections, students, publishedTerms: published,
        lastMove: last && last.isThisYear ? { ...last, canUndo: Date.now() - new Date(last.doneAt).getTime() < 24 * 3600 * 1000 } : null,
      };
    });
  });

  app.post('/new-year/prepare', pre, async (req) => {
    must(req, 'school.settings');
    const b = z.object({
      name: z.string().trim().min(4).max(20),
      startsOn: z.string().date(), endsOn: z.string().date(),
      copyTeachers: z.boolean().default(true), copyTimetable: z.boolean().default(false), copyFees: z.boolean().default(true),
    }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const { cur, next } = await years(tx);
      if (next) throw badRequest('already', `${next.name} is already prepared`);
      if (b.startsOn <= cur.startsOn) throw badRequest('bad_date', `The new year must start after ${cur.name} starts`);
      if (b.endsOn <= b.startsOn) throw badRequest('bad_date', 'The end date must be after the start date');
      const dupe = await tx.query('SELECT 1 FROM academic_years WHERE name = $1', [b.name]);
      if (dupe.rowCount) throw badRequest('duplicate', `There is already a year called ${b.name}`);
      const yearId = (await tx.query<{ id: string }>(
        `INSERT INTO academic_years (school_id, name, starts_on, ends_on) VALUES (app_school_id(), $1, $2, $3) RETURNING id`,
        [b.name, b.startsOn, b.endsOn])).rows[0]!.id;
      // Same sections, keeping the class teacher if asked
      const map = (await tx.query<{ old_id: string; new_id: string }>(
        `WITH src AS (SELECT * FROM sections WHERE academic_year_id = $1),
              ins AS (INSERT INTO sections (school_id, academic_year_id, class_id, name, seats, class_teacher_membership)
                      SELECT school_id, $2, class_id, name, seats, CASE WHEN $3 THEN class_teacher_membership END FROM src RETURNING id, class_id, name)
         SELECT src.id AS old_id, ins.id AS new_id FROM src JOIN ins ON ins.class_id = src.class_id AND ins.name = src.name`,
        [cur.id, yearId, b.copyTeachers])).rows;
      if (b.copyTeachers) {
        for (const m of map) {
          await tx.query(`INSERT INTO section_teachers (school_id, section_id, subject_id, membership_id)
                          SELECT school_id, $2, subject_id, membership_id FROM section_teachers WHERE section_id = $1`, [m.old_id, m.new_id]);
        }
      }
      if (b.copyTimetable) {
        for (const m of map) {
          await tx.query(`INSERT INTO timetable_slots (school_id, academic_year_id, section_id, day_no, period_no, subject_id, membership_id)
                          SELECT school_id, $3, $2, day_no, period_no, subject_id, membership_id FROM timetable_slots WHERE section_id = $1`, [m.old_id, m.new_id, yearId]);
        }
      }
      let feeLines = 0;
      if (b.copyFees) {
        // Same instalments one year later, with the same amounts; change them in Fees if they go up.
        const inst = (await tx.query<{ old_id: string; new_id: string }>(
          `WITH src AS (SELECT * FROM fee_instalments WHERE academic_year_id = $1),
                ins AS (INSERT INTO fee_instalments (school_id, academic_year_id, name, due_on, grace_days, fine_type, fine_amount, fine_cap, sort_order)
                        SELECT school_id, $2, name, (due_on + interval '1 year')::date, grace_days, fine_type, fine_amount, fine_cap, sort_order FROM src
                        RETURNING id, name)
           SELECT src.id AS old_id, ins.id AS new_id FROM src JOIN ins ON ins.name = src.name`, [cur.id, yearId])).rows;
        for (const i of inst) {
          feeLines += (await tx.query(`INSERT INTO fee_structure (school_id, class_id, fee_head_id, instalment_id, amount)
                          SELECT school_id, class_id, fee_head_id, $2, amount FROM fee_structure WHERE instalment_id = $1`, [i.old_id, i.new_id])).rowCount ?? 0;
        }
      }
      return { id: yearId, sections: map.length, feeLines };
    });
  });

  app.post('/new-year/sections', pre, async (req) => {
    must(req, 'school.settings');
    const b = z.object({ classId: uuid, name: z.string().trim().max(10).optional() }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const { next } = await years(tx);
      if (!next) throw badRequest('not_prepared', 'Prepare the new year first');
      return addSection(tx, req.school!.schoolId, b.classId, next.id, b.name);
    });
  });

  /** Throw away a prepared year that hasn't started (e.g. wrong dates). */
  app.delete('/new-year', pre, async (req) => {
    must(req, 'school.settings');
    return schoolTx(db, req, async (tx) => {
      const { next } = await years(tx);
      if (!next) throw notFound('No new year is prepared');
      const used = await tx.query('SELECT 1 FROM enrollments WHERE academic_year_id = $1 LIMIT 1', [next.id]);
      if (used.rowCount) throw badRequest('in_use', 'Students are already placed in this year');
      await tx.query('DELETE FROM fee_structure WHERE instalment_id IN (SELECT id FROM fee_instalments WHERE academic_year_id = $1)', [next.id]);
      await tx.query('DELETE FROM fee_instalments WHERE academic_year_id = $1', [next.id]);
      await tx.query('DELETE FROM timetable_slots WHERE academic_year_id = $1', [next.id]);
      await tx.query('DELETE FROM section_teachers WHERE section_id IN (SELECT id FROM sections WHERE academic_year_id = $1)', [next.id]);
      await tx.query('DELETE FROM sections WHERE academic_year_id = $1', [next.id]);
      await tx.query('DELETE FROM academic_years WHERE id = $1', [next.id]);
      return { ok: true };
    });
  });

  app.post('/new-year/start', pre, async (req) => {
    must(req, 'school.settings');
    const b = z.object({
      decisions: z.array(z.object({
        studentId: uuid,
        action: z.enum(['promote', 'repeat', 'leave', 'passed_out']),
        sectionId: uuid.optional().nullable(),
      })).max(20000),
      rollOrder: z.enum(['name', 'keep']).default('name'),
    }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const { cur, next } = await years(tx);
      if (!next) throw badRequest('not_prepared', 'Prepare the new year first');
      const enrolled = (await tx.query<{ id: string; name: string; class_id: string; class_name: string; sort: number; roll_no: number | null; first_name: string }>(
        `SELECT st.id, st.first_name || coalesce(' ' || st.last_name, '') AS name, st.first_name, c.id AS class_id, c.name AS class_name, c.sort_order AS sort, e.roll_no
           FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
           JOIN sections s ON s.id = e.section_id JOIN classes c ON c.id = s.class_id
          WHERE e.academic_year_id = $1`, [cur.id])).rows;
      const byId = new Map(b.decisions.map((d) => [d.studentId, d]));
      const missing = enrolled.filter((s) => !byId.has(s.id));
      if (missing.length) throw badRequest('missing', `Choose what happens to ${missing.length} more student${missing.length === 1 ? '' : 's'} (e.g. ${missing[0]!.name})`);
      const nextSections = new Map((await tx.query<{ id: string; class_id: string; sort: number; name: string; class_name: string }>(
        `SELECT s.id, s.class_id, c.sort_order AS sort, s.name, c.name AS class_name FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.academic_year_id = $1`, [next.id])).rows.map((s) => [s.id, s]));
      const classOrder = (await tx.query<{ id: string; sort: number }>('SELECT id, sort_order AS sort FROM classes ORDER BY sort_order')).rows;
      const nextClassOf = (sort: number) => classOrder.find((c) => c.sort > sort)?.id ?? null;

      // Check every decision before changing anything
      for (const s of enrolled) {
        const d = byId.get(s.id)!;
        if (d.action === 'promote' || d.action === 'repeat') {
          const target = d.sectionId ? nextSections.get(d.sectionId) : undefined;
          if (!target) throw badRequest('no_section', `Choose next year's class for ${s.name}`);
          const want = d.action === 'repeat' ? s.class_id : nextClassOf(s.sort);
          if (target.class_id !== want) {
            throw badRequest('wrong_class', d.action === 'repeat'
              ? `${s.name} is staying in ${classFig(s.class_name)}, but was put in ${classFig(target.class_name)}`
              : `${s.name} moves up from ${classFig(s.class_name)}, but was put in ${classFig(target.class_name)}`);
          }
        }
      }

      // 1. File this year's report card in each student's file (only if report cards were published)
      const school = (await tx.query(
        `SELECT name, address, phone, email, board, affiliation_no AS "affiliationNo", code FROM schools WHERE id = app_school_id()`)).rows[0]!;
      const logo = (await tx.query<{ mime: string; data: Buffer }>('SELECT mime, data FROM school_logos WHERE school_id = app_school_id()')).rows[0] ?? null;
      const rcType = (await tx.query<{ id: string }>(`SELECT id FROM document_types WHERE name = 'Report card' AND category = 'report_card'`)).rows[0]?.id ?? null;
      const published = (await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM terms WHERE academic_year_id = $1 AND published_at IS NOT NULL', [cur.id])).rows[0]!.n;
      let filed = 0;
      if (published) {
        for (const s of enrolled) {
          const exists = await tx.query(`SELECT 1 FROM student_documents WHERE student_id = $1 AND type_id IS NOT DISTINCT FROM $2 AND year_name = $3 AND replaced_by IS NULL`, [s.id, rcType, cur.name]);
          if (exists.rowCount) continue;
          const d = byId.get(s.id)!;
          const nextClass = d.sectionId ? nextSections.get(d.sectionId)?.class_name : null;
          const result = d.action === 'promote' ? `Promoted to ${classFig(nextClass!)}`
            : d.action === 'passed_out' ? `Passed ${classFig(s.class_name)}` : d.action === 'repeat' ? `To continue in ${classFig(s.class_name)}` : null;
          const r = await buildReport(tx, s.id, { publishedOnly: true });
          const pdf = await reportCardPdf(r, { ...school, logo }, result);
          const label = `${classFig(s.class_name)} report card`;
          await tx.query(
            `INSERT INTO student_documents (school_id, student_id, type_id, label, year_name, file_name, mime, size_bytes, data, source, uploaded_by)
             VALUES (app_school_id(), $1, $2, $3, $4, $5, 'application/pdf', $6, $7, 'system', $8)`,
            [s.id, rcType, label, cur.name, `${label} ${cur.name}.pdf`, pdf.length, pdf, req.accountId]);
          filed++;
        }
      }

      // 2. Place students in next year's sections, with roll numbers
      const placed = new Map<string, typeof enrolled>();
      const changes: { studentId: string; from: string; to: string }[] = [];
      const counts = { promoted: 0, repeated: 0, left: 0, passedOut: 0, reportCards: filed };
      for (const s of enrolled) {
        const d = byId.get(s.id)!;
        if (d.action === 'promote' || d.action === 'repeat') {
          (placed.get(d.sectionId!) ?? placed.set(d.sectionId!, []).get(d.sectionId!)!).push(s);
          if (d.action === 'promote') counts.promoted++; else counts.repeated++;
        } else {
          const to = d.action === 'leave' ? 'left' : 'passed_out';
          await tx.query('UPDATE students SET status = $2, left_on = coalesce(left_on, $3) WHERE id = $1', [s.id, to, cur.endsOn]);
          changes.push({ studentId: s.id, from: 'active', to });
          if (to === 'left') counts.left++; else counts.passedOut++;
        }
      }
      for (const [sectionId, list] of placed) {
        list.sort((a, c) => (b.rollOrder === 'keep' ? (a.roll_no ?? 9999) - (c.roll_no ?? 9999) : 0) || a.name.localeCompare(c.name));
        let roll = 1;
        for (const s of list) {
          await tx.query(`INSERT INTO enrollments (school_id, student_id, academic_year_id, section_id, roll_no) VALUES (app_school_id(), $1, $2, $3, $4)
                          ON CONFLICT (student_id, academic_year_id) DO UPDATE SET section_id = excluded.section_id, roll_no = excluded.roll_no`,
            [s.id, next.id, sectionId, roll++]);
        }
      }

      // 3. The new year becomes the current one
      await tx.query('UPDATE academic_years SET is_current = false WHERE id = $1', [cur.id]);
      await tx.query('UPDATE academic_years SET is_current = true WHERE id = $1', [next.id]);

      // 4. Fees for the new year, from the fee structure (if there is one)
      const dues = await tx.query(
        `INSERT INTO fee_dues (school_id, student_id, academic_year_id, instalment_id, fee_head_id, amount)
         SELECT app_school_id(), e.student_id, e.academic_year_id, fs.instalment_id, fs.fee_head_id, fs.amount
           FROM enrollments e JOIN sections s ON s.id = e.section_id
           JOIN fee_structure fs ON fs.class_id = s.class_id
           JOIN fee_instalments i ON i.id = fs.instalment_id AND i.academic_year_id = e.academic_year_id
          WHERE e.academic_year_id = $1
         ON CONFLICT (student_id, instalment_id, fee_head_id) DO NOTHING`, [next.id]);

      const summary = { ...counts, feeLines: dues.rowCount ?? 0, from: cur.name, to: next.name };
      await tx.query(
        `INSERT INTO year_transitions (school_id, from_year_id, to_year_id, summary, status_changes, done_by) VALUES (app_school_id(), $1, $2, $3, $4, $5)`,
        [cur.id, next.id, summary, JSON.stringify(changes), req.accountId]);
      return summary;
    });
  });

  /** Undo the move, the same day, if nothing has happened in the new year yet. */
  app.post('/new-year/undo', pre, async (req) => {
    must(req, 'school.settings');
    return schoolTx(db, req, async (tx) => {
      const t = (await tx.query<{ id: string; from_year_id: string; to_year_id: string; done_at: string; status_changes: { studentId: string; from: string; to: string }[] }>(
        `SELECT t.id, t.from_year_id, t.to_year_id, t.done_at, t.status_changes FROM year_transitions t
           JOIN academic_years y ON y.id = t.to_year_id AND y.is_current
          WHERE t.undone_at IS NULL ORDER BY t.done_at DESC LIMIT 1`)).rows[0];
      if (!t) throw badRequest('nothing', 'There is no move to undo');
      if (Date.now() - new Date(t.done_at).getTime() > 24 * 3600 * 1000) throw badRequest('too_late', 'A move can only be undone within a day');
      const att = await tx.query('SELECT 1 FROM attendance_sessions a JOIN sections s ON s.id = a.section_id WHERE s.academic_year_id = $1 LIMIT 1', [t.to_year_id]);
      if (att.rowCount) throw badRequest('in_use', 'Attendance has already been taken in the new year, so it can no longer be undone');
      const paid = await tx.query(
        `SELECT 1 FROM fee_dues d JOIN receipt_lines l ON l.fee_due_id = d.id JOIN receipts r ON r.id = l.receipt_id AND r.status = 'active'
          WHERE d.academic_year_id = $1 LIMIT 1`, [t.to_year_id]);
      if (paid.rowCount) throw badRequest('in_use', 'Fees have already been collected for the new year, so it can no longer be undone');
      await tx.query('DELETE FROM fee_dues WHERE academic_year_id = $1', [t.to_year_id]);
      await tx.query('DELETE FROM enrollments WHERE academic_year_id = $1', [t.to_year_id]);
      for (const c of t.status_changes) {
        await tx.query(`UPDATE students SET status = $2, left_on = NULL WHERE id = $1 AND status = $3`, [c.studentId, c.from, c.to]);
      }
      await tx.query('UPDATE academic_years SET is_current = false WHERE id = $1', [t.to_year_id]);
      await tx.query('UPDATE academic_years SET is_current = true WHERE id = $1', [t.from_year_id]);
      await tx.query('UPDATE year_transitions SET undone_at = now(), undone_by = $2 WHERE id = $1', [t.id, req.accountId]);
      return { ok: true };
    });
  });
}
