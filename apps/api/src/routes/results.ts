// Results day.
//  Principal ("reportcards.manage"): sets each class's formula, pass rule and result date;
//    checks the results; makes the marksheets; confirms (releases) the ones below the pass rule.
//  Office ("students.view" + "reportcards.manage" or "students.manage"): downloads a class's
//    marksheets, signed or blank to sign by hand.
//  Parents: download their child's marksheet from the result date (if not held).
//  Anyone: checks a marksheet by its QR code.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Db, Tx } from '../db.js';
import { withContext } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { can, must, schoolTx } from '../context.js';
import { schoolInfo } from './certificates.js';
import { todayIST } from './attendance.js';
import { notifyFamily } from '../exams/workflow.js';
import {
  classLabelOf, computeMarksheet, loadSettings, marksheetsPdf, newVerifyCode, type MarksheetData, type Settings,
} from '../results/marksheet.js';
import type { CertSign } from '../certificates/pdf.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function currentYear(tx: Tx) {
  const y = (await tx.query<{ id: string; name: string }>('SELECT id, name FROM academic_years WHERE is_current')).rows[0];
  if (!y) throw badRequest('no_year', 'No current academic year is set');
  return y;
}

/** The principal's signature for marksheets (printed if uploaded), or a blank line to sign by hand. */
async function marksheetSign(tx: Tx, mode: 'printed' | 'hand'): Promise<CertSign> {
  const sig = (await tx.query<{ signer_name: string; signer_title: string | null; mime: string; data: Buffer }>(
    "SELECT signer_name, signer_title, mime, data FROM signatures WHERE role = 'principal'")).rows[0];
  const holder = (await tx.query<{ display_name: string }>(
    `SELECT m.display_name FROM memberships m JOIN membership_roles r ON r.membership_id = m.id
      WHERE r.role = 'principal' AND m.status = 'active' AND m.school_id = app_school_id() ORDER BY m.created_at LIMIT 1`)).rows[0];
  return {
    mode: mode === 'printed' && sig ? 'printed' : 'hand',
    title: sig?.signer_title || 'Principal',
    name: sig?.signer_name ?? holder?.display_name ?? null,
    image: mode === 'printed' && sig ? { mime: sig.mime, data: sig.data } : null,
  };
}

interface Row { id: string; student_id: string; verify_code: string; data: MarksheetData; passed: boolean; held: boolean;
  released_at: Date | null; result_note: string | null; generated_at: Date }

/** Make (or remake) the marksheets for a class. Returns how many were made and who has marks missing. */
export async function generateForClass(tx: Tx, schoolId: string, yearId: string, classId: string, settings: Settings) {
  return generateMissing(tx, schoolId, yearId, classId, settings);
}

async function generate(tx: Tx, schoolId: string, yearId: string, classId: string, settings: Settings, by: string | null, onlyStudent?: string) {
  const students = (await tx.query<{ id: string }>(
    `SELECT st.id FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
       JOIN sections s ON s.id = e.section_id
      WHERE e.academic_year_id = $1 AND s.class_id = $2 AND ($3::uuid IS NULL OR st.id = $3)`,
    [yearId, classId, onlyStudent ?? null])).rows;
  let made = 0; const missing: { studentId: string; name: string; missing: string[] }[] = [];
  for (const s of students) {
    const data = await computeMarksheet(tx, s.id, yearId, settings);
    if (!data.complete) { missing.push({ studentId: s.id, name: data.student.name, missing: data.missing }); continue; }
    const held = !data.passed;
    await tx.query(
      `INSERT INTO marksheets (school_id, academic_year_id, student_id, class_id, verify_code, data, passed, held, generated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (academic_year_id, student_id) DO UPDATE SET
         data = excluded.data, passed = excluded.passed, held = excluded.held, class_id = excluded.class_id,
         generated_at = now(), generated_by = excluded.generated_by,
         -- a release stays only while the student is still below the pass rule
         released_at = CASE WHEN excluded.held THEN marksheets.released_at END,
         released_by = CASE WHEN excluded.held THEN marksheets.released_by END,
         result_note = CASE WHEN excluded.held THEN marksheets.result_note END`,
      [schoolId, yearId, s.id, classId, newVerifyCode(), JSON.stringify(data), data.passed, held, by]);
    made++;
  }
  return { made, missing };
}

/** A short-lived download link for the parent app (opens in the phone's browser). */
const linkSig = (secret: string, id: string, exp: number) =>
  createHmac('sha256', secret).update(`marksheet:${id}:${exp}`).digest('base64url').slice(0, 32);

export function registerResultRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler,
  opts: { secret: string; verifyBase: string; publicApiBase?: string }) {
  const pre = { preHandler: requireSchool };
  const canPrint = (req: FastifyRequest) => can(req, 'reportcards.manage') || can(req, 'students.manage');

  /** Every class: its formula, pass rule, result date, and how far the marksheets are. */
  app.get('/results/setup', pre, async (req) => {
    if (!canPrint(req)) throw forbidden();
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const classes = (await tx.query(
        `SELECT c.id, c.name, c.assessment_style AS style,
                rs.weights, rs.pass_subject_pct AS "passSubjectPct", rs.pass_overall_pct AS "passOverallPct", rs.result_date::text AS "resultDate",
                (SELECT count(*)::int FROM enrollments e JOIN sections s ON s.id = e.section_id JOIN students st ON st.id = e.student_id AND st.status = 'active'
                  WHERE e.academic_year_id = $1 AND s.class_id = c.id) AS students,
                (SELECT count(*)::int FROM marksheets m WHERE m.academic_year_id = $1 AND m.class_id = c.id) AS made,
                (SELECT count(*)::int FROM marksheets m WHERE m.academic_year_id = $1 AND m.class_id = c.id AND m.held AND m.released_at IS NULL) AS held,
                coalesce((SELECT json_agg(json_build_object('id', x.id, 'name', x.name, 'termName', t.name) ORDER BY t.sort_order, x.sort_order)
                   FROM exams x JOIN terms t ON t.id = x.term_id AND t.academic_year_id = $1
                  WHERE cardinality(x.class_ids) = 0 OR c.id = ANY(x.class_ids)), '[]') AS exams
           FROM classes c LEFT JOIN result_settings rs ON rs.class_id = c.id AND rs.academic_year_id = $1
          ORDER BY c.sort_order`, [year.id])).rows;
      return { year, classes, today: todayIST() };
    });
  });

  app.put('/results/classes/:classId', pre, async (req) => {
    must(req, 'reportcards.manage');
    const { classId } = z.object({ classId: uuid }).parse(req.params);
    const b = z.object({
      weights: z.array(z.object({ examId: uuid, weight: z.coerce.number().positive().max(1000) })).min(1, 'Choose at least one exam').max(12),
      passSubjectPct: z.coerce.number().min(0).max(100),
      passOverallPct: z.coerce.number().min(0).max(100),
      resultDate: date.nullable(),
      applyToClassIds: z.array(uuid).max(30).default([]),
    }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const targets = [...new Set([classId, ...b.applyToClassIds])];
      for (const cid of targets) {
        const ok = (await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM exams x JOIN terms t ON t.id = x.term_id AND t.academic_year_id = $1
            WHERE x.id = ANY($2) AND (cardinality(x.class_ids) = 0 OR $3 = ANY(x.class_ids))`,
          [year.id, b.weights.map((w) => w.examId), cid])).rows[0]!.n;
        if (ok !== b.weights.length) throw badRequest('bad_exam', 'One of the chosen exams is not written by this class');
        await tx.query(
          `INSERT INTO result_settings (school_id, academic_year_id, class_id, weights, pass_subject_pct, pass_overall_pct, result_date, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (academic_year_id, class_id) DO UPDATE SET weights = excluded.weights, pass_subject_pct = excluded.pass_subject_pct,
             pass_overall_pct = excluded.pass_overall_pct, result_date = excluded.result_date, updated_by = excluded.updated_by, updated_at = now()`,
          [req.school!.schoolId, year.id, cid, JSON.stringify(b.weights), b.passSubjectPct, b.passOverallPct, b.resultDate, req.accountId]);
      }
      return { ok: true, classes: targets.length };
    });
  });

  /** A class's results: worked out now (not saved), with any marksheets already made. */
  app.get('/results/classes/:classId', pre, async (req) => {
    if (!canPrint(req)) throw forbidden();
    const { classId } = z.object({ classId: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const settings = await loadSettings(tx, year.id, classId);
      const cls = (await tx.query<{ name: string }>('SELECT name FROM classes WHERE id = $1', [classId])).rows[0];
      if (!cls) throw notFound('Class not found');
      if (!settings) return { className: classLabelOf(cls.name), settings: null, students: [] };
      const ids = (await tx.query<{ id: string }>(
        `SELECT st.id FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
           JOIN sections s ON s.id = e.section_id
          WHERE e.academic_year_id = $1 AND s.class_id = $2 ORDER BY s.name, e.roll_no NULLS LAST, st.first_name`, [year.id, classId])).rows;
      const made = new Map((await tx.query<Row>(
        'SELECT * FROM marksheets WHERE academic_year_id = $1 AND class_id = $2', [year.id, classId])).rows.map((r) => [r.student_id, r]));
      const students = [];
      for (const { id } of ids) {
        const d = await computeMarksheet(tx, id, year.id, settings);
        const m = made.get(id);
        students.push({
          studentId: id, name: d.student.name, classLabel: d.student.classLabel, rollNo: d.student.rollNo,
          pct: d.pct, grade: d.grade, passed: d.passed, result: d.result, complete: d.complete, missing: d.missing,
          marksheet: m ? { id: m.id, held: m.held, releasedAt: m.released_at, note: m.result_note, generatedAt: m.generated_at,
            changedSince: JSON.stringify(m.data.rows) !== JSON.stringify(d.rows) } : null,
        });
      }
      return { className: classLabelOf(cls.name), settings, students };
    });
  });

  /** Make the marksheets now (also happens by itself on the result date). Remaking keeps each QR code's link working. */
  app.post('/results/classes/:classId/generate', pre, async (req) => {
    must(req, 'reportcards.manage');
    const { classId } = z.object({ classId: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const settings = await loadSettings(tx, year.id, classId);
      if (!settings) throw badRequest('no_settings', 'Set how the result is worked out for this class first');
      return generate(tx, req.school!.schoolId, year.id, classId, settings, req.accountId!);
    });
  });

  /** Principal confirms a marksheet that is below the pass rule, with a note printed on it. */
  app.post('/results/marksheets/:id/release', pre, async (req) => {
    must(req, 'reportcards.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ note: z.string().trim().max(120).optional().nullable() }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const r = await tx.query<{ student_id: string; name: string; result_date: string | null }>(
        `UPDATE marksheets m SET released_at = now(), released_by = $2, result_note = $3 WHERE m.id = $1 AND m.held
         RETURNING m.student_id, m.data->'student'->>'name' AS name,
           (SELECT result_date::text FROM result_settings rs WHERE rs.academic_year_id = m.academic_year_id AND rs.class_id = m.class_id) AS result_date`,
        [id, req.accountId, b.note || null]);
      if (!r.rowCount) throw badRequest('not_held', 'This marksheet is not waiting for your confirmation');
      const m = r.rows[0]!;
      if (m.result_date && m.result_date <= todayIST()) {
        await notifyFamily(tx, m.student_id, 'Marksheet ready', `${m.name.split(' ')[0]}'s marksheet is ready in the app.`, { kind: 'marksheet' });
      }
      await tx.query(
        `INSERT INTO audit_log (school_id, account_id, action, table_name, row_id) VALUES (app_school_id(), $1, 'RELEASE_MARKSHEET', 'marksheets', $2)`,
        [req.accountId, id]);
      return { ok: true };
    });
  });

  /** Office: a class's marksheets in one PDF: signed, or blank to sign by hand. Held ones are left out. */
  app.get('/results/classes/:classId/marksheets.pdf', pre, async (req, reply) => {
    if (!canPrint(req)) throw forbidden();
    const { classId } = z.object({ classId: uuid }).parse(req.params);
    const q = z.object({ sign: z.enum(['printed', 'hand']).default('printed'), sectionId: uuid.optional() }).parse(req.query);
    const { pdf, label } = await schoolTx(db, req, async (tx) => {
      const year = await currentYear(tx);
      const settings = await loadSettings(tx, year.id, classId);
      if (!settings) throw badRequest('no_settings', 'Set how the result is worked out for this class first');
      if (settings.resultDate && settings.resultDate <= todayIST()) await generateMissing(tx, req.school!.schoolId, year.id, classId, settings);
      const rows = (await tx.query<Row & { roll: number | null }>(
        `SELECT m.*, e.roll_no AS roll FROM marksheets m
           JOIN enrollments e ON e.student_id = m.student_id AND e.academic_year_id = m.academic_year_id
          WHERE m.academic_year_id = $1 AND m.class_id = $2 AND (NOT m.held OR m.released_at IS NOT NULL)
            AND ($3::uuid IS NULL OR e.section_id = $3)
          ORDER BY m.data->'student'->>'classLabel', e.roll_no NULLS LAST, m.data->'student'->>'name'`,
        [year.id, classId, q.sectionId ?? null])).rows;
      const school = await schoolInfo(tx);
      const sign = await marksheetSign(tx, q.sign);
      const cls = (await tx.query<{ name: string }>('SELECT name FROM classes WHERE id = $1', [classId])).rows[0]!;
      return {
        label: classLabelOf(cls.name).replace(/\s+/g, '-'),
        pdf: await marksheetsPdf(school, rows.map((r) => ({ data: r.data, verifyCode: r.verify_code, resultNote: r.result_note,
          issuedOn: settings.resultDate ?? todayIST() })), sign, opts.verifyBase),
      };
    });
    return sendPdf(reply, pdf, `marksheets-${label}${q.sign === 'hand' ? '-to-sign' : ''}.pdf`);
  });

  // ---------------- Parents ----------------

  /** Is the marksheet ready? If so, a download link that works for 10 minutes. */
  app.get('/parent/children/:id/marksheet', pre, async (req) => {
    if (!req.school?.permissions.has('parent.own_children')) throw forbidden();
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const own = (await tx.query<{ class_id: string; year_id: string }>(
        `SELECT s.class_id, e.academic_year_id AS year_id FROM students st
           JOIN families f ON f.id = st.family_id AND f.account_id = $2
           JOIN academic_years y ON y.school_id = st.school_id AND y.is_current
           JOIN enrollments e ON e.student_id = st.id AND e.academic_year_id = y.id
           JOIN sections s ON s.id = e.section_id
          WHERE st.id = $1`, [id, req.accountId])).rows[0];
      if (!own) throw forbidden('This child is not linked to your login');
      const settings = await loadSettings(tx, own.year_id, own.class_id);
      if (!settings?.resultDate) return { status: 'not_yet', resultDate: null };
      if (settings.resultDate > todayIST()) return { status: 'not_yet', resultDate: settings.resultDate };
      let m = (await tx.query<Row>('SELECT * FROM marksheets WHERE academic_year_id = $1 AND student_id = $2', [own.year_id, id])).rows[0];
      if (!m) {
        await generate(tx, req.school!.schoolId, own.year_id, own.class_id, settings, null, id);
        m = (await tx.query<Row>('SELECT * FROM marksheets WHERE academic_year_id = $1 AND student_id = $2', [own.year_id, id])).rows[0];
      }
      if (!m) return { status: 'not_ready', resultDate: settings.resultDate };
      if (m.held && !m.released_at) return { status: 'with_school', resultDate: settings.resultDate };
      const exp = Math.floor(Date.now() / 1000) + 600;
      return {
        status: 'ready', resultDate: settings.resultDate,
        summary: { pct: m.data.pct, grade: m.data.grade, result: m.data.result, note: m.result_note },
        downloadUrl: `${opts.publicApiBase ?? ''}/marksheets/${m.id}/download?exp=${exp}&s=${linkSig(opts.secret, m.id, exp)}`,
      };
    });
  });

  /** The download itself (from the link above; no login, so the phone's browser can open it). */
  app.get('/marksheets/:id/download', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const q = z.object({ exp: z.coerce.number().int(), s: z.string().max(64) }).parse(req.query);
    const want = Buffer.from(linkSig(opts.secret, id, q.exp)); const got = Buffer.from(q.s);
    if (q.exp < Date.now() / 1000 || want.length !== got.length || !timingSafeEqual(want, got)) {
      throw forbidden('This download link has expired. Open the marksheet again in the app.');
    }
    const schoolId = (await db.query<{ school_id: string }>('SELECT marksheet_school($1) AS school_id', [id])).rows[0]?.school_id;
    if (!schoolId) throw notFound('Marksheet not found');
    const pdf = await withContext(db, { schoolId }, async (tx) => {
      const m = (await tx.query<Row & { result_date: string | null }>(
        `SELECT m.*, rs.result_date::text AS result_date FROM marksheets m
           LEFT JOIN result_settings rs ON rs.academic_year_id = m.academic_year_id AND rs.class_id = m.class_id
          WHERE m.id = $1`, [id])).rows[0];
      if (!m || (m.held && !m.released_at)) throw notFound('Marksheet not found');
      return marksheetsPdf(await schoolInfo(tx), [{ data: m.data, verifyCode: m.verify_code, resultNote: m.result_note,
        issuedOn: m.result_date ?? todayIST() }], await marksheetSign(tx, 'printed'), opts.verifyBase);
    });
    return sendPdf(reply, pdf, 'marksheet.pdf');
  });

  // ---------------- Anyone: check a marksheet ----------------

  app.get('/verify/:code', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { code } = z.object({ code: z.string().trim().max(20) }).parse(req.params);
    const r = (await db.query('SELECT * FROM verify_marksheet($1)', [code])).rows[0];
    if (!r) return { valid: false };
    return {
      valid: true, school: r.school_name, student: r.student_name, admissionNo: r.admission_no, class: r.class_label,
      session: r.year_name, pct: r.overall_pct == null ? null : Number(r.overall_pct), grade: r.overall_grade, result: r.result,
      issuedOn: r.issued_on,
    };
  });
}

/** On or after the result date, make any marksheets not made yet (silently skips missing marks). */
async function generateMissing(tx: Tx, schoolId: string, yearId: string, classId: string, settings: Settings) {
  const n = (await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM enrollments e JOIN sections s ON s.id = e.section_id JOIN students st ON st.id = e.student_id AND st.status = 'active'
      WHERE e.academic_year_id = $1 AND s.class_id = $2
        AND NOT EXISTS (SELECT 1 FROM marksheets m WHERE m.academic_year_id = $1 AND m.student_id = st.id)`, [yearId, classId])).rows[0]!.n;
  if (n) {
    const missing = (await tx.query<{ id: string }>(
      `SELECT st.id FROM enrollments e JOIN sections s ON s.id = e.section_id JOIN students st ON st.id = e.student_id AND st.status = 'active'
        WHERE e.academic_year_id = $1 AND s.class_id = $2
          AND NOT EXISTS (SELECT 1 FROM marksheets m WHERE m.academic_year_id = $1 AND m.student_id = st.id)`, [yearId, classId])).rows;
    for (const s of missing) await generate(tx, schoolId, yearId, classId, settings, null, s.id);
  }
}

function sendPdf(reply: FastifyReply, pdf: Buffer, name: string) {
  return reply.header('content-type', 'application/pdf')
    .header('content-disposition', `inline; filename="${name}"`)
    .header('cache-control', 'private, no-store').send(pdf);
}
