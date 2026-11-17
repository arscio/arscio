// Excel import and export page. Needs the "Excel import and export" permission
// (owner and principal have it; they can give it to anyone on the staff).
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { must, schoolTx } from '../context.js';
import { readWorkbook, text, type Sheet } from '../data/sheet.js';
import { FIELDS, apply, check, marksFields, marksSetup, suggest, undo, type Kind } from '../data/import.js';
import { EXPORTS, buildExport, buildTemplate, type ExportKind } from '../data/export.js';

const uuid = z.string().uuid();
const KINDS = ['students', 'staff', 'marks'] as const;

function decodeFile(dataUrl: string) {
  const m = /^data:[^;,]*;base64,(.+)$/s.exec(dataUrl);
  if (!m) throw badRequest('bad_file', 'That file could not be read. Please try again.');
  const buf = Buffer.from(m[1]!, 'base64');
  if (buf.length > 10 * 1024 * 1024) throw badRequest('too_big', 'The file is too large. Please keep it under 10 MB.');
  return buf;
}

const fileBody = z.object({ fileName: z.string().max(200), dataUrl: z.string() });
const importBody = fileBody.extend({
  kind: z.enum(KINDS),
  sheet: z.string().max(100).optional(),
  mapping: z.record(z.string(), z.number().int().min(0).max(500).nullable()),
  skipExisting: z.boolean().default(true),
  examId: uuid.optional(), sectionId: uuid.optional(),
});

function sendFile(reply: import('fastify').FastifyReply, f: { buf: Buffer; fileName: string }) {
  return reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .header('content-disposition', `attachment; filename="${f.fileName.replace(/"/g, '')}"`)
    .header('cache-control', 'private, no-store').send(f.buf);
}

export function registerDataRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler) {
  const pre = { preHandler: requireSchool };
  const mustFor = (req: FastifyRequest, kind: Kind) => {
    must(req, 'data.import_export');
    if (kind === 'staff') must(req, 'roles.assign');
  };

  app.get('/data/options', pre, async (req) => {
    must(req, 'data.import_export');
    return schoolTx(db, req, async (tx) => ({
      exports: Object.entries(EXPORTS).map(([kind, label]) => ({ kind, label })),
      sections: (await tx.query(
        `SELECT s.id, s.class_id AS "classId", c.name AS "className", s.name FROM sections s JOIN classes c ON c.id = s.class_id
           JOIN academic_years y ON y.id = s.academic_year_id AND y.is_current ORDER BY c.sort_order, s.name`)).rows,
      terms: (await tx.query(
        `SELECT t.id, t.name FROM terms t JOIN academic_years y ON y.id = t.academic_year_id AND y.is_current ORDER BY t.sort_order, t.name`)).rows,
      exams: (await tx.query(
        `SELECT x.id, x.name, t.name AS "termName", x.class_ids AS "classIds", x.marks_locked AS locked, x.default_max_marks::float AS max
           FROM exams x JOIN terms t ON t.id = x.term_id JOIN academic_years y ON y.id = t.academic_year_id AND y.is_current
          ORDER BY t.sort_order, x.sort_order, x.name`)).rows,
      fields: FIELDS,
    }));
  });

  // ---------------- Export ----------------

  app.get('/data/export/:kind', pre, async (req, reply) => {
    must(req, 'data.import_export');
    const { kind } = z.object({ kind: z.enum(Object.keys(EXPORTS) as [ExportKind, ...ExportKind[]]) }).parse(req.params);
    const f = z.object({
      sectionId: uuid.optional(), classId: uuid.optional(), status: z.enum(['active', 'left', 'all']).optional(),
      month: z.string().regex(/^\d{4}-\d{2}$/).optional(), from: z.string().date().optional(), to: z.string().date().optional(),
      termId: uuid.optional(), onlyDue: z.enum(['0', '1']).optional(),
    }).parse(req.query);
    if (kind === 'fees' || kind === 'receipts') must(req, 'fees.view_reports');
    const out = await schoolTx(db, req, (tx) => buildExport(tx, kind, { ...f, onlyDue: f.onlyDue === '1' }));
    return sendFile(reply, out);
  });

  app.get('/data/templates/:kind', pre, async (req, reply) => {
    const { kind } = z.object({ kind: z.enum(KINDS) }).parse(req.params);
    mustFor(req, kind);
    const q = z.object({ examId: uuid.optional(), sectionId: uuid.optional() }).parse(req.query);
    return sendFile(reply, await schoolTx(db, req, (tx) => buildTemplate(tx, kind, q)));
  });

  // ---------------- Import ----------------

  /** Step 1: open the file, list its sheets and columns, and guess which column is which. */
  app.post('/data/import/read', { ...pre, bodyLimit: 15 * 1024 * 1024 }, async (req) => {
    const b = fileBody.extend({ kind: z.enum(KINDS), examId: uuid.optional(), sectionId: uuid.optional() }).parse(req.body);
    mustFor(req, b.kind);
    const sheets = await readWorkbook(decodeFile(b.dataUrl), b.fileName);
    if (!sheets.length) throw badRequest('empty', 'This file has no rows with data');
    return schoolTx(db, req, async (tx) => {
      let fields = b.kind === 'marks' ? [] : FIELDS[b.kind];
      if (b.kind === 'marks') {
        if (!b.examId || !b.sectionId) throw badRequest('need_filters', 'Choose the exam and class first');
        const s = await marksSetup(tx, b.examId, b.sectionId);
        fields = marksFields(s.subjects, s.exam.max);
      }
      return {
        fields,
        sheets: sheets.map((s: Sheet) => ({
          name: s.name, headers: s.headers, rowCount: s.rows.length,
          sample: s.rows.slice(0, 4).map((r) => r.map((c) => text(c))),
          suggested: suggest(fields, s.headers),
        })),
      };
    });
  });

  async function prepare(req: FastifyRequest) {
    const b = importBody.parse(req.body);
    mustFor(req, b.kind);
    if (b.kind === 'marks' && (!b.examId || !b.sectionId)) throw badRequest('need_filters', 'Choose the exam and class first');
    const sheets = await readWorkbook(decodeFile(b.dataUrl), b.fileName);
    const sheet = (b.sheet && sheets.find((s) => s.name === b.sheet)) || sheets[0];
    if (!sheet) throw badRequest('empty', 'This file has no rows with data');
    if (sheet.rows.length > 5000) throw badRequest('too_many', 'Please import at most 5,000 rows at a time');
    return { b, sheet };
  }
  const ctx = (req: FastifyRequest, tx: Parameters<Parameters<typeof schoolTx>[2]>[0]) =>
    ({ tx, schoolId: req.school!.schoolId, accountId: req.accountId!, roles: req.school!.roles });
  const counts = (rows: { status: string }[]) => ({
    ok: rows.filter((r) => r.status === 'ok').length, error: rows.filter((r) => r.status === 'error').length, skip: rows.filter((r) => r.status === 'skip').length,
  });

  /** Step 2: check every row. Nothing is saved. */
  app.post('/data/import/check', { ...pre, bodyLimit: 15 * 1024 * 1024 }, async (req) => {
    const { b, sheet } = await prepare(req);
    return schoolTx(db, req, async (tx) => {
      const rows = await check(ctx(req, tx), b.kind, sheet, b.mapping, b);
      return { counts: counts(rows), rows: rows.map(({ row, status, messages, show }) => ({ row, status, messages, show })) };
    });
  });

  /** Step 3: save the good rows (problem rows are left out), all in one go, and record the import. */
  app.post('/data/import/run', { ...pre, bodyLimit: 15 * 1024 * 1024 }, async (req) => {
    const { b, sheet } = await prepare(req);
    return schoolTx(db, req, async (tx) => {
      const rows = await check(ctx(req, tx), b.kind, sheet, b.mapping, b);
      const c = counts(rows);
      if (!c.ok) throw badRequest('nothing', 'There are no rows ready to import');
      const details = await apply(ctx(req, tx), b.kind, rows, b);
      const label = b.kind === 'marks' ? await (async () => {
        const s = await marksSetup(tx, b.examId!, b.sectionId!);
        return `${s.exam.name}, Class ${s.section.class_name} ${s.section.name}`;
      })() : null;
      const batch = (await tx.query<{ id: string }>(
        `INSERT INTO import_batches (school_id, kind, file_name, rows_total, rows_ok, rows_failed, errors, imported_by, details)
         VALUES (app_school_id(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [b.kind, b.fileName, rows.length, c.ok, c.error, JSON.stringify(rows.filter((r) => r.status === 'error').slice(0, 200).map(({ row, messages }) => ({ row, messages }))),
         req.accountId, { ...details, label }])).rows[0]!;
      return { id: batch.id, counts: c };
    });
  });

  app.get('/data/imports', pre, async (req) => {
    must(req, 'data.import_export');
    return schoolTx(db, req, async (tx) => ({
      imports: (await tx.query(
        `SELECT b.id, b.kind, b.file_name AS "fileName", b.rows_total AS total, b.rows_ok AS ok, b.rows_failed AS failed,
                b.created_at AS "createdAt", b.undone_at AS "undoneAt", m.display_name AS "importedBy", b.details->>'label' AS label
           FROM import_batches b LEFT JOIN memberships m ON m.account_id = b.imported_by AND m.school_id = b.school_id
          ORDER BY b.created_at DESC LIMIT 50`)).rows,
    }));
  });

  app.post('/data/imports/:id/undo', pre, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const b = (await tx.query<{ kind: Kind; details: Record<string, unknown>; undone_at: string | null }>(
        'SELECT kind, details, undone_at FROM import_batches WHERE id = $1', [id])).rows[0];
      if (!b) throw notFound('Import not found');
      mustFor(req, b.kind);
      if (b.undone_at) throw badRequest('already', 'This import was already undone');
      const r = await undo(tx, b.kind, b.details);
      await tx.query('UPDATE import_batches SET undone_at = now(), undone_by = $2 WHERE id = $1', [id, req.accountId]);
      return r;
    });
  });
}
