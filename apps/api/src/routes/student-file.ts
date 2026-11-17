// The digital student file (office website only; teachers never see documents).
//  - Photo: uploaded once, shown everywhere (signed link, so apps can load it).
//  - Documents: each labelled ("Birth certificate", "Class 6 marksheet (previous school)"),
//    viewed on screen without downloading, downloaded one at a time or all together.
//    Never deleted: replacing a document keeps the old one in its history.
//  - Checklist: the principal sets which documents each class needs at admission.
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import JSZip from 'jszip';
import { z } from 'zod';
import { withContext, type Db } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { must, schoolTx } from '../context.js';
import { decodeUpload, extFor, formatAdmissionNo, photoSigOk, photoUrl, safeName } from '../students/file.js';

const uuid = z.string().uuid();

export function registerStudentFileRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler, secret: string) {
  const pre = { preHandler: requireSchool };

  // ---------------- Photo ----------------

  app.put('/students/:id/photo', { ...pre, bodyLimit: 3 * 1024 * 1024 }, async (req) => {
    must(req, 'students.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { dataUrl } = z.object({ dataUrl: z.string() }).parse(req.body);
    const { buf, mime } = decodeUpload(dataUrl, 2 * 1024 * 1024, false);
    return schoolTx(db, req, async (tx) => {
      const st = await tx.query('SELECT 1 FROM students WHERE id = $1', [id]);
      if (!st.rowCount) throw notFound('Student not found');
      await tx.query(
        `INSERT INTO student_photos (student_id, school_id, mime, data, updated_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (student_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_by = excluded.updated_by, updated_at = now()`,
        [id, req.school!.schoolId, mime, buf, req.accountId]);
      const url = photoUrl(secret, req.school!.schoolId, id, String(Date.now()));
      await tx.query('UPDATE students SET photo_url = $2 WHERE id = $1', [id, url]);
      return { photoUrl: url };
    });
  });

  app.delete('/students/:id/photo', pre, async (req) => {
    must(req, 'students.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      await tx.query('DELETE FROM student_photos WHERE student_id = $1', [id]);
      await tx.query('UPDATE students SET photo_url = NULL WHERE id = $1', [id]);
      return { ok: true };
    });
  });

  /** The photo itself. No login needed, but the link must carry the right signature. */
  app.get('/photos/:schoolId/:studentId', async (req, reply) => {
    const p = z.object({ schoolId: uuid, studentId: uuid }).parse(req.params);
    const q = z.object({ v: z.string().max(20), s: z.string().max(40) }).parse(req.query);
    if (!photoSigOk(secret, p.schoolId, p.studentId, q.v, q.s)) throw notFound('No photo');
    const row = await withContext(db, { schoolId: p.schoolId }, async (tx) =>
      (await tx.query<{ mime: string; data: Buffer }>('SELECT mime, data FROM student_photos WHERE student_id = $1', [p.studentId])).rows[0]);
    if (!row) throw notFound('No photo');
    return reply.header('content-type', row.mime).header('cache-control', 'private, max-age=86400')
      .header('x-content-type-options', 'nosniff').header('cross-origin-resource-policy', 'cross-origin').send(row.data);
  });

  // ---------------- Admission number ----------------

  app.get('/students/admission-number', pre, async (req) => {
    must(req, 'students.manage');
    const { year } = z.object({ year: z.coerce.number().int().min(1990).max(2100).optional() }).parse(req.query);
    return schoolTx(db, req, async (tx) => {
      const y = year ?? Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 4));
      const s = (await tx.query<{ code: string; format: string; next: number | null }>(
        `SELECT s.code, s.admission_no_format AS format, (SELECT next_no FROM admission_counters c WHERE c.school_id = s.id AND c.year = $1) AS next
           FROM schools s WHERE s.id = app_school_id()`, [y])).rows[0]!;
      return { format: s.format, next: formatAdmissionNo(s.format, s.code, y, s.next ?? 1) };
    });
  });

  app.put('/school/admission-format', pre, async (req) => {
    must(req, 'school.settings');
    const { format, year, nextNo } = z.object({
      format: z.string().trim().min(5).max(40),
      year: z.number().int().min(1990).max(2100).optional(),
      nextNo: z.number().int().min(1).max(999999).optional(),
    }).parse(req.body);
    if (!format.includes('{SEQ}')) throw badRequest('no_seq', 'The format must include {SEQ}, the running number');
    return schoolTx(db, req, async (tx) => {
      await tx.query('UPDATE schools SET admission_no_format = $1 WHERE id = app_school_id()', [format]);
      // A school moving to Arscio can carry on from its own last number
      if (year && nextNo) {
        await tx.query(
          `INSERT INTO admission_counters (school_id, year, next_no) VALUES (app_school_id(), $1, $2)
           ON CONFLICT (school_id, year) DO UPDATE SET next_no = excluded.next_no`, [year, nextNo]);
      }
      return { ok: true };
    });
  });

  // ---------------- Document checklist (document types) ----------------

  app.get('/documents/types', pre, async (req) => {
    must(req, 'students.manage');
    return schoolTx(db, req, async (tx) => ({
      types: (await tx.query(
        `SELECT id, name, category, required_classes AS "requiredClasses", asks_for_class AS "asksForClass", system
           FROM document_types ORDER BY sort_order, name`)).rows,
    }));
  });

  app.put('/documents/types/:id', pre, async (req) => {
    must(req, 'school.settings');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ requiredClasses: z.array(uuid) }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const r = await tx.query('UPDATE document_types SET required_classes = $2 WHERE id = $1 AND NOT system', [id, b.requiredClasses]);
      if (!r.rowCount) throw notFound('Document type not found');
      return { ok: true };
    });
  });

  app.post('/documents/types', pre, async (req) => {
    must(req, 'school.settings');
    const b = z.object({ name: z.string().trim().min(2).max(60), requiredClasses: z.array(uuid).default([]), asksForClass: z.boolean().default(false) }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const dupe = await tx.query('SELECT 1 FROM document_types WHERE lower(name) = lower($1)', [b.name]);
      if (dupe.rowCount) throw badRequest('duplicate', 'There is already a document with that name');
      return (await tx.query(
        `INSERT INTO document_types (school_id, name, category, required_classes, asks_for_class, sort_order)
         VALUES ($1, $2, 'admission', $3, $4, (SELECT coalesce(max(sort_order), 0) + 1 FROM document_types WHERE category = 'admission'))
         RETURNING id`, [req.school!.schoolId, b.name, b.requiredClasses, b.asksForClass])).rows[0];
    });
  });

  // ---------------- The file ----------------

  app.get('/students/:id/file', pre, async (req) => {
    must(req, 'students.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const st = (await tx.query(
        `SELECT st.id, st.first_name || coalesce(' ' || st.last_name, '') AS name, st.admission_no AS "admissionNo",
                st.photo_url AS "photoUrl", st.aadhaar_last4 AS "aadhaarLast4", st.status, st.admission_date AS "admissionDate",
                c.id AS "classId", c.name AS "className", sec.name AS "sectionName"
           FROM students st
           LEFT JOIN academic_years y ON y.school_id = st.school_id AND y.is_current
           LEFT JOIN enrollments e ON e.student_id = st.id AND e.academic_year_id = y.id
           LEFT JOIN sections sec ON sec.id = e.section_id LEFT JOIN classes c ON c.id = sec.class_id
          WHERE st.id = $1`, [id])).rows[0];
      if (!st) throw notFound('Student not found');
      const docs = (await tx.query(
        `SELECT d.id, d.label, d.year_name AS "yearName", d.file_name AS "fileName", d.mime, d.size_bytes AS size,
                d.source, d.created_at AS "createdAt", a.name AS "uploadedBy", d.replaced_by AS "replacedBy",
                t.id AS "typeId", t.name AS "typeName", coalesce(t.category, 'other') AS category
           FROM student_documents d
           LEFT JOIN document_types t ON t.id = d.type_id
           LEFT JOIN accounts a ON a.id = d.uploaded_by
          WHERE d.student_id = $1 ORDER BY d.created_at DESC`, [id])).rows;
      const current = docs.filter((d) => !d.replacedBy);
      const history = (docId: string): typeof docs => {
        const older = docs.filter((d) => d.replacedBy === docId);
        return older.flatMap((o) => [o, ...history(o.id)]);
      };
      const types = (await tx.query(
        `SELECT id, name, category, required_classes AS "requiredClasses", asks_for_class AS "asksForClass", system
           FROM document_types ORDER BY sort_order, name`)).rows;
      const checklist = types
        .filter((t) => t.category === 'admission' && st.classId && t.requiredClasses.includes(st.classId))
        .map((t) => ({ typeId: t.id, name: t.name, done: current.some((d) => d.typeId === t.id) }));
      return {
        student: st,
        checklist,
        missing: checklist.filter((c) => !c.done).length,
        types: types.filter((t) => !t.system).map(({ id: tid, name, asksForClass }) => ({ id: tid, name, asksForClass })),
        documents: current.map((d) => ({ ...d, history: history(d.id) })),
      };
    });
  });

  app.post('/students/:id/documents', { ...pre, bodyLimit: 15 * 1024 * 1024 }, async (req) => {
    must(req, 'students.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      typeId: uuid,
      forClass: z.string().trim().max(20).optional().nullable(),
      yearName: z.string().trim().max(10).optional().nullable(),
      note: z.string().trim().max(60).optional().nullable(),
      fileName: z.string().max(200),
      dataUrl: z.string(),
      replacesId: uuid.optional().nullable(),
    }).parse(req.body);
    const { buf, mime } = decodeUpload(b.dataUrl, 10 * 1024 * 1024, true);
    return schoolTx(db, req, async (tx) => {
      const t = (await tx.query<{ name: string; asks: boolean; system: boolean }>(
        'SELECT name, asks_for_class AS asks, system FROM document_types WHERE id = $1', [b.typeId])).rows[0];
      if (!t) throw badRequest('bad_type', 'Choose what kind of document this is');
      if (t.system) throw badRequest('system_type', 'Arscio files this document itself');
      if (t.asks && !b.forClass) throw badRequest('need_class', 'Say which class this is for, e.g. Class 6');
      const st = await tx.query('SELECT 1 FROM students WHERE id = $1', [id]);
      if (!st.rowCount) throw notFound('Student not found');
      // A clear label, e.g. "Previous school marksheet (Class 6)"
      const forClass = b.forClass ? (/^\d+$/.test(b.forClass) ? `Class ${b.forClass}` : b.forClass) : null;
      const label = [t.name, forClass ? `(${forClass})` : null, b.note ? `· ${b.note}` : null].filter(Boolean).join(' ');
      const doc = (await tx.query<{ id: string }>(
        `INSERT INTO student_documents (school_id, student_id, type_id, label, year_name, file_name, mime, size_bytes, data, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [req.school!.schoolId, id, b.typeId, label, b.yearName ?? null, `${safeName(label)}.${extFor(mime)}`, mime, buf.length, buf, req.accountId])).rows[0]!;
      if (b.replacesId) {
        const r = await tx.query('UPDATE student_documents SET replaced_by = $2 WHERE id = $1 AND student_id = $3 AND replaced_by IS NULL', [b.replacesId, doc.id, id]);
        if (!r.rowCount) throw badRequest('bad_replace', 'The document being replaced was not found');
      }
      return { id: doc.id, label };
    });
  });

  /** View on screen (inline) or download one document. */
  app.get('/documents/:id/content', pre, async (req, reply) => {
    must(req, 'students.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { download } = z.object({ download: z.enum(['0', '1']).optional() }).parse(req.query);
    const row = await schoolTx(db, req, async (tx) =>
      (await tx.query<{ mime: string; data: Buffer; file_name: string }>('SELECT mime, data, file_name FROM student_documents WHERE id = $1', [id])).rows[0]);
    if (!row) throw notFound('Document not found');
    return reply.header('content-type', row.mime)
      .header('content-disposition', `${download === '1' ? 'attachment' : 'inline'}; filename="${row.file_name.replace(/"/g, '')}"`)
      .header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff')
      .send(row.data);
  });

  /** Everything in the student's file as one ZIP, in folders. */
  app.get('/students/:id/file.zip', pre, async (req, reply) => {
    must(req, 'students.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { st, docs } = await schoolTx(db, req, async (tx) => ({
      st: (await tx.query<{ name: string; admission_no: string }>(
        `SELECT first_name || coalesce(' ' || last_name, '') AS name, admission_no FROM students WHERE id = $1`, [id])).rows[0],
      docs: (await tx.query<{ label: string; mime: string; data: Buffer; category: string; year_name: string | null }>(
        `SELECT d.label, d.mime, d.data, coalesce(t.category, 'other') AS category, d.year_name
           FROM student_documents d LEFT JOIN document_types t ON t.id = d.type_id
          WHERE d.student_id = $1 AND d.replaced_by IS NULL ORDER BY d.created_at`, [id])).rows,
    }));
    if (!st) throw notFound('Student not found');
    if (!docs.length) throw badRequest('empty', 'There are no documents in this file yet');
    const folder: Record<string, string> = { admission: '1 Admission documents', report_card: '2 Report cards', certificate: '3 Certificates issued', other: '4 Other' };
    const zip = new JSZip();
    const used = new Set<string>();
    for (const d of docs) {
      let name = `${folder[d.category] ?? folder.other}/${safeName(d.label)}${d.year_name ? ` ${d.year_name}` : ''}`;
      for (let i = 2; used.has(name); i++) name = `${name} (${i})`;
      used.add(name);
      zip.file(`${name}.${extFor(d.mime)}`, d.data);
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const fileName = `${safeName(`${st.name} ${st.admission_no.replace(/\//g, '-')}`)}.zip`;
    return reply.header('content-type', 'application/zip').header('content-disposition', `attachment; filename="${fileName}"`)
      .header('cache-control', 'private, no-store').send(buf);
  });

  app.put('/students/:id/aadhaar', pre, async (req) => {
    must(req, 'students.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { last4 } = z.object({ last4: z.string().regex(/^\d{4}$/, 'Enter only the last 4 digits').nullable() }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const r = await tx.query('UPDATE students SET aadhaar_last4 = $2 WHERE id = $1', [id, last4]);
      if (!r.rowCount) throw notFound('Student not found');
      return { ok: true };
    });
  });
}
