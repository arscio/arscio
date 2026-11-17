// Certificates the school issues (transfer, bonafide, character) and the admission & withdrawal register.
// Each certificate gets a serial number, is made as a PDF, and is filed in the student's file.
// How each kind is signed is the principal's choice: a printed signature (uploaded once) or by hand.
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Db, Tx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { must, schoolTx } from '../context.js';
import { letterPdf, tcPdf, type CertCommon, type CertSign } from '../certificates/pdf.js';
import { classFig, classWords, dateShort, dateWords } from '../certificates/words.js';
import { studentDues, toPaise, fromPaise } from '../fees/service.js';
import { decodeUpload } from '../students/file.js';

const uuid = z.string().uuid();
const KINDS = ['tc', 'bonafide', 'character'] as const;
type Kind = (typeof KINDS)[number];
const KIND_INFO: Record<Kind, { title: string; short: string; docType: string }> = {
  tc: { title: 'Transfer certificate', short: 'TC', docType: 'Transfer certificate (issued)' },
  bonafide: { title: 'Bonafide certificate', short: 'BC', docType: 'Bonafide certificate (issued)' },
  character: { title: 'Character certificate', short: 'CC', docType: 'Character certificate (issued)' },
};
const ROLE_TITLE = { principal: 'Principal', owner: 'Director' } as const;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const tcBody = z.object({
  applicationDate: z.string().date(),
  leavingDate: z.string().date(),
  reason: z.string().trim().min(2).max(120),
  completed: z.boolean().default(false),          // finished the last class of the school
  promotion: z.enum(['yes', 'no', 'na']),
  promotedTo: z.string().trim().max(20).optional().nullable(),
  conduct: z.string().trim().min(2).max(40).default('Good'),
  workingDays: z.number().int().min(0).max(400).optional().nullable(),
  presentDays: z.number().int().min(0).max(400).optional().nullable(),
  subjects: z.string().trim().max(200).optional().nullable(),
  remarks: z.string().trim().max(200).optional().nullable(),
  markLeft: z.boolean().default(true),
});
const bonafideBody = z.object({ purpose: z.string().trim().min(2).max(120), includePhoto: z.boolean().default(true) });
const characterBody = z.object({ conduct: z.string().trim().min(2).max(40).default('Good'), remarks: z.string().trim().max(200).optional().nullable() });

async function settingsFor(tx: Tx, kind: Kind) {
  const r = (await tx.query<{ sign_mode: 'printed' | 'hand'; signer_role: 'principal' | 'owner' }>(
    'SELECT sign_mode, signer_role FROM certificate_settings WHERE kind = $1', [kind])).rows[0];
  return { signMode: r?.sign_mode ?? 'hand', signerRole: r?.signer_role ?? 'principal' };
}

/** Name of the person who holds a role here, if no signature has been set up. */
async function roleHolder(tx: Tx, role: 'principal' | 'owner') {
  return (await tx.query<{ display_name: string }>(
    `SELECT m.display_name FROM memberships m JOIN membership_roles r ON r.membership_id = m.id
      WHERE r.role = $1 AND m.status = 'active' AND m.school_id = app_school_id() ORDER BY m.created_at LIMIT 1`, [role])).rows[0]?.display_name ?? null;
}

async function signFor(tx: Tx, kind: Kind): Promise<CertSign & { role: 'principal' | 'owner' }> {
  const s = await settingsFor(tx, kind);
  const sig = (await tx.query<{ signer_name: string; signer_title: string | null; mime: string; data: Buffer }>(
    'SELECT signer_name, signer_title, mime, data FROM signatures WHERE role = $1', [s.signerRole])).rows[0];
  if (s.signMode === 'printed' && !sig) {
    throw badRequest('no_signature', `This certificate is set to use a printed signature, but no ${ROLE_TITLE[s.signerRole].toLowerCase()} signature has been uploaded. Upload it in School settings, or switch to signing by hand.`);
  }
  return {
    role: s.signerRole, mode: s.signMode,
    title: sig?.signer_title || ROLE_TITLE[s.signerRole],
    name: sig?.signer_name ?? await roleHolder(tx, s.signerRole),
    image: s.signMode === 'printed' && sig ? { mime: sig.mime, data: sig.data } : null,
  };
}

async function studentInfo(tx: Tx, id: string) {
  const st = (await tx.query(
    `SELECT st.id, st.first_name || coalesce(' ' || st.last_name, '') AS name, st.admission_no AS "admissionNo",
            st.date_of_birth::text AS dob, st.gender, st.admission_date::text AS "admissionDate", st.status, st.left_on::text AS "leftOn",
            f.father_name AS father, f.mother_name AS mother, f.guardian_name AS guardian, f.address,
            cur.class_name AS "className", cur.section_name AS "sectionName", cur.year_name AS "yearName", cur.class_id AS "classId",
            first.class_name AS "firstClass", first.year_name AS "firstYear"
       FROM students st JOIN families f ON f.id = st.family_id
       LEFT JOIN LATERAL (SELECT c.name AS class_name, c.id AS class_id, sec.name AS section_name, y.name AS year_name
                            FROM enrollments e JOIN sections sec ON sec.id = e.section_id JOIN classes c ON c.id = sec.class_id
                            JOIN academic_years y ON y.id = e.academic_year_id
                           WHERE e.student_id = st.id ORDER BY y.starts_on DESC LIMIT 1) cur ON true
       LEFT JOIN LATERAL (SELECT c.name AS class_name, y.name AS year_name
                            FROM enrollments e JOIN sections sec ON sec.id = e.section_id JOIN classes c ON c.id = sec.class_id
                            JOIN academic_years y ON y.id = e.academic_year_id
                           WHERE e.student_id = st.id ORDER BY y.starts_on ASC LIMIT 1) first ON true
      WHERE st.id = $1`, [id])).rows[0];
  if (!st) throw notFound('Student not found');
  return st;
}

export async function schoolInfo(tx: Tx) {
  const s = (await tx.query(
    `SELECT s.name, s.address, s.phone, s.email, s.board, s.affiliation_no AS "affiliationNo", s.code,
            (SELECT name FROM academic_years WHERE school_id = s.id AND is_current) AS "yearName"
       FROM schools s WHERE s.id = app_school_id()`)).rows[0]!;
  const logo = (await tx.query<{ mime: string; data: Buffer }>('SELECT mime, data FROM school_logos WHERE school_id = app_school_id()')).rows[0] ?? null;
  return { ...s, logo };
}

/** Attendance this year, counted the same way as on the report card. */
async function attendanceDays(tx: Tx, studentId: string) {
  const days = (await tx.query<{ status: string }>(
    `SELECT DISTINCT ON (a.on_date) k.status
       FROM attendance_sessions a JOIN attendance_marks k ON k.session_id = a.id AND k.student_id = $1
       JOIN academic_years y ON y.school_id = a.school_id AND y.is_current AND a.on_date BETWEEN y.starts_on AND y.ends_on
      ORDER BY a.on_date, a.period_no`, [studentId])).rows;
  const present = days.filter((d) => ['present', 'late'].includes(d.status)).length + days.filter((d) => d.status === 'half_day').length / 2;
  return { days: days.length, present: Math.round(present) };
}

async function nextSerial(tx: Tx, code: string, kind: Kind, yearName: string) {
  const key = `${kind}:${yearName}`;
  const n = (await tx.query<{ n: number }>(
    `INSERT INTO certificate_counters (school_id, kind, next_no) VALUES (app_school_id(), $1, 2)
     ON CONFLICT (school_id, kind) DO UPDATE SET next_no = certificate_counters.next_no + 1 RETURNING next_no - 1 AS n`, [key])).rows[0]!.n;
  return `${code}/${KIND_INFO[kind].short}/${yearName}/${String(n).padStart(4, '0')}`;
}

export function registerCertificateRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler) {
  const pre = { preHandler: requireSchool };

  // ---------------- Settings: how each kind is signed, and the signature images ----------------

  app.get('/certificates/settings', pre, async (req) => {
    must(req, 'students.manage');
    return schoolTx(db, req, async (tx) => {
      const kinds = await Promise.all(KINDS.map(async (k) => ({ kind: k, title: KIND_INFO[k].title, ...(await settingsFor(tx, k)) })));
      const sigs = (await tx.query('SELECT role, signer_name AS "signerName", signer_title AS "signerTitle", updated_at AS "updatedAt" FROM signatures')).rows;
      const signatures = await Promise.all((['principal', 'owner'] as const).map(async (role) => {
        const s = sigs.find((x) => x.role === role);
        return { role, defaultTitle: ROLE_TITLE[role], uploaded: !!s, signerName: s?.signerName ?? await roleHolder(tx, role), signerTitle: s?.signerTitle ?? null, updatedAt: s?.updatedAt ?? null };
      }));
      return { kinds, signatures };
    });
  });

  app.put('/certificates/settings/:kind', pre, async (req) => {
    must(req, 'school.settings');
    const { kind } = z.object({ kind: z.enum(KINDS) }).parse(req.params);
    const b = z.object({ signMode: z.enum(['printed', 'hand']), signerRole: z.enum(['principal', 'owner']) }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      await tx.query(
        `INSERT INTO certificate_settings (school_id, kind, sign_mode, signer_role) VALUES (app_school_id(), $1, $2, $3)
         ON CONFLICT (school_id, kind) DO UPDATE SET sign_mode = excluded.sign_mode, signer_role = excluded.signer_role`, [kind, b.signMode, b.signerRole]);
      return { ok: true };
    });
  });

  app.put('/signatures/:role', { ...pre, bodyLimit: 1024 * 1024 }, async (req) => {
    must(req, 'school.settings');
    const { role } = z.object({ role: z.enum(['principal', 'owner']) }).parse(req.params);
    const b = z.object({ signerName: z.string().trim().min(2).max(80), signerTitle: z.string().trim().max(40).optional().nullable(), dataUrl: z.string().optional() }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      if (b.dataUrl) {
        const { buf, mime } = decodeUpload(b.dataUrl, 300 * 1024, false);
        if (mime === 'image/webp') throw badRequest('bad_type', 'Please upload the signature as a PNG or JPG');
        await tx.query(
          `INSERT INTO signatures (school_id, role, signer_name, signer_title, mime, data, updated_by) VALUES (app_school_id(), $1, $2, $3, $4, $5, $6)
           ON CONFLICT (school_id, role) DO UPDATE SET signer_name = excluded.signer_name, signer_title = excluded.signer_title,
             mime = excluded.mime, data = excluded.data, updated_by = excluded.updated_by, updated_at = now()`,
          [role, b.signerName, b.signerTitle || null, mime, buf, req.accountId]);
      } else {
        const r = await tx.query('UPDATE signatures SET signer_name = $2, signer_title = $3 WHERE role = $1', [role, b.signerName, b.signerTitle || null]);
        if (!r.rowCount) throw badRequest('no_image', 'Upload a picture of the signature');
      }
      return { ok: true };
    });
  });

  app.get('/signatures/:role/image', pre, async (req, reply) => {
    must(req, 'school.settings');
    const { role } = z.object({ role: z.enum(['principal', 'owner']) }).parse(req.params);
    const row = await schoolTx(db, req, async (tx) =>
      (await tx.query<{ mime: string; data: Buffer }>('SELECT mime, data FROM signatures WHERE role = $1', [role])).rows[0]);
    if (!row) throw notFound('No signature');
    return reply.header('content-type', row.mime).header('cache-control', 'private, no-store').send(row.data);
  });

  app.delete('/signatures/:role', pre, async (req) => {
    must(req, 'school.settings');
    const { role } = z.object({ role: z.enum(['principal', 'owner']) }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const used = (await tx.query<{ kind: string }>(`SELECT kind FROM certificate_settings WHERE signer_role = $1 AND sign_mode = 'printed'`, [role])).rows;
      if (used.length) throw badRequest('in_use', `This signature is printed on ${used.map((u) => KIND_INFO[u.kind as Kind].title.toLowerCase()).join(', ')}. Switch those to “sign by hand” first.`);
      await tx.query('DELETE FROM signatures WHERE role = $1', [role]);
      return { ok: true };
    });
  });

  // ---------------- Issuing ----------------

  /** What the certificate form starts with: facts Arscio already knows. */
  app.get('/students/:id/certificates', pre, async (req) => {
    must(req, 'students.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const st = await studentInfo(tx, id);
      const dues = await studentDues(tx, id, today());
      const pending = dues.reduce((a, d) => a + toPaise(d.balance), 0);
      const att = await attendanceDays(tx, id);
      const lastClass = (await tx.query<{ name: string }>('SELECT name FROM classes WHERE school_id = app_school_id() ORDER BY sort_order DESC LIMIT 1')).rows[0]?.name;
      const nextClass = st.classId ? (await tx.query<{ name: string }>(
        `SELECT name FROM classes WHERE school_id = app_school_id() AND sort_order > (SELECT sort_order FROM classes WHERE id = $1) ORDER BY sort_order LIMIT 1`, [st.classId])).rows[0]?.name ?? null : null;
      const issued = (await tx.query(
        `SELECT c.id, c.kind, c.serial_no AS "serialNo", c.issued_at AS "issuedAt", c.details, m.display_name AS "issuedBy",
                (SELECT d.id FROM student_documents d WHERE d.student_id = c.student_id AND d.label LIKE '%' || c.serial_no || '%' LIMIT 1) AS "documentId"
           FROM certificates c LEFT JOIN memberships m ON m.account_id = c.issued_by AND m.school_id = c.school_id
          WHERE c.student_id = $1 ORDER BY c.issued_at DESC`, [id])).rows;
      return {
        student: st,
        known: {
          duesPending: fromPaise(pending), attendance: att, nextClass,
          inFinalClass: !!st.className && st.className === lastClass,
        },
        settings: await Promise.all(KINDS.map(async (k) => ({ kind: k, ...(await settingsFor(tx, k)) }))),
        issued,
      };
    });
  });

  app.post('/students/:id/certificates', pre, async (req) => {
    must(req, 'students.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { kind, details: raw, reissue } = z.object({ kind: z.enum(KINDS), details: z.unknown(), reissue: z.boolean().default(false) }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const st = await studentInfo(tx, id);
      const school = await schoolInfo(tx);
      if (!school.yearName) throw badRequest('no_year', 'Set up the current school year first');
      const sign = await signFor(tx, kind);
      const issuer = (await tx.query<{ display_name: string }>('SELECT display_name FROM memberships WHERE account_id = $1 AND school_id = app_school_id()', [req.accountId])).rows[0]?.display_name ?? 'Office';
      const earlierTc = kind === 'tc' ? (await tx.query<{ serial_no: string }>(`SELECT serial_no FROM certificates WHERE student_id = $1 AND kind = 'tc' ORDER BY issued_at DESC LIMIT 1`, [id])).rows[0] : undefined;
      if (earlierTc && !reissue) throw badRequest('tc_exists', `A transfer certificate (${earlierTc.serial_no}) was already issued. Issue a duplicate copy instead.`);

      const serialNo = await nextSerial(tx, school.code, kind, school.yearName);
      const issuedOn = dateShort(today());
      const common: CertCommon = {
        school, title: KIND_INFO[kind].title, serialNo, admissionNo: st.admissionNo, issuedOn,
        duplicate: !!earlierTc, preparedBy: issuer, sign,
      };
      const parent = [st.father ? `${st.father}` : null, st.mother ? `${st.mother}` : null].filter(Boolean).join(' and ') || st.guardian || '—';
      const his = st.gender === 'female' ? 'her' : st.gender === 'male' ? 'his' : 'their';
      const childOf = st.gender === 'female' ? 'daughter' : st.gender === 'male' ? 'son' : 'child';
      const cls = st.className ? `${classFig(st.className)}${st.sectionName ? ` (Section ${st.sectionName})` : ''}` : '—';
      let pdf: Buffer;
      let details: Record<string, unknown>;

      if (kind === 'tc') {
        const d = tcBody.parse(raw);
        if (st.admissionDate && d.leavingDate < st.admissionDate) throw badRequest('bad_date', 'The leaving date is before the admission date');
        const dues = await studentDues(tx, id, today());
        const pending = dues.reduce((a, x) => a + toPaise(x.balance), 0);
        const att = await attendanceDays(tx, id);
        const working = d.workingDays ?? att.days, present = d.presentDays ?? att.present;
        details = { ...d, className: st.className, sectionName: st.sectionName, yearName: st.yearName, duesPending: fromPaise(pending), workingDays: working, presentDays: present };
        const rows: [string, string][] = [
          ['Name of the student', st.name],
          ["Mother's name", st.mother ?? '—'],
          ["Father's or guardian's name", st.father ?? st.guardian ?? '—'],
          ['Date of birth (in figures and words)', st.dob ? `${dateShort(st.dob)} (${dateWords(st.dob)})` : '—'],
          ['Date of first admission, with class', st.admissionDate ? `${dateShort(st.admissionDate)}${st.firstClass ? `, ${classFig(st.firstClass)}` : ''}` : (st.firstClass ? classFig(st.firstClass) : '—')],
          ['Class last studied (in figures and words)', st.className ? `${classFig(st.className)} (${classWords(st.className)}), ${st.yearName}` : '—'],
          ['Subjects studied', d.subjects || '—'],
          ['Qualified for promotion to a higher class', d.promotion === 'yes' ? `Yes${d.promotedTo ? `, to ${classFig(d.promotedTo)}` : ''}` : d.promotion === 'no' ? 'No' : 'Not applicable'],
          ['All dues paid to the school', pending > 0 ? `No (₹${fromPaise(pending)} pending)` : 'Yes'],
          ['Working days / days present this year', `${working} / ${present}`],
          ['General conduct', d.conduct],
          ['Date of application for the certificate', dateShort(d.applicationDate)],
          ['Date the student left the school', dateShort(d.leavingDate)],
          ['Reason for leaving', d.reason],
          ['Any other remarks', d.remarks || '—'],
        ];
        pdf = await tcPdf(common, rows);
        if (d.markLeft) {
          await tx.query(`UPDATE students SET status = $2, left_on = $3 WHERE id = $1`, [id, d.completed ? 'passed_out' : 'left', d.leavingDate]);
        }
      } else if (kind === 'bonafide') {
        const d = bonafideBody.parse(raw);
        if (st.status !== 'active') throw badRequest('not_studying', 'A bonafide certificate is only for students studying here now');
        details = { ...d, className: st.className, sectionName: st.sectionName, yearName: st.yearName };
        const photo = d.includePhoto ? (await tx.query<{ mime: string; data: Buffer }>('SELECT mime, data FROM student_photos WHERE student_id = $1', [id])).rows[0] ?? null : null;
        pdf = await letterPdf({ ...common, photo }, [
          `This is to certify that ${st.name}, ${childOf} of ${parent}, is a bonafide student of ${school.name}, studying in ${cls} in the session ${st.yearName}.`,
          `As per school records, ${his === 'their' ? `${st.name}'s` : his} admission number is ${st.admissionNo}${st.dob ? ` and date of birth is ${dateShort(st.dob)} (${dateWords(st.dob)})` : ''}.`,
          `This certificate is issued on request for the purpose of ${d.purpose}.`,
        ]);
      } else {
        const d = characterBody.parse(raw);
        details = { ...d, className: st.className, yearName: st.yearName, status: st.status };
        const studied = st.status === 'active'
          ? `is studying in ${cls} in the session ${st.yearName}`
          : `studied in this school${st.admissionDate ? ` from ${dateShort(st.admissionDate)}` : ''}${st.leftOn ? ` to ${dateShort(st.leftOn)}` : ''}${st.className ? `, last in ${classFig(st.className)}` : ''}`;
        pdf = await letterPdf(common, [
          `This is to certify that ${st.name}, ${childOf} of ${parent}, admission number ${st.admissionNo}, ${studied}.`,
          `To the best of our knowledge, ${his} conduct and character have been ${d.conduct.toLowerCase()}. ${d.remarks ?? ''}`.trim(),
          `We wish ${his === 'their' ? 'them' : st.gender === 'female' ? 'her' : 'him'} every success in the future.`,
        ]);
      }

      const cert = (await tx.query<{ id: string }>(
        `INSERT INTO certificates (school_id, student_id, kind, serial_no, details, sign_mode, signer_role, issued_by)
         VALUES (app_school_id(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [id, kind, serialNo, details, sign.mode, sign.role, req.accountId])).rows[0]!;
      const typeId = (await tx.query<{ id: string }>('SELECT id FROM document_types WHERE name = $1', [KIND_INFO[kind].docType])).rows[0]?.id ?? null;
      const label = `${KIND_INFO[kind].title}${earlierTc ? ' (duplicate)' : ''} ${serialNo}`;
      const doc = (await tx.query<{ id: string }>(
        `INSERT INTO student_documents (school_id, student_id, type_id, label, year_name, file_name, mime, size_bytes, data, source, uploaded_by)
         VALUES (app_school_id(), $1, $2, $3, $4, $5, 'application/pdf', $6, $7, 'system', $8) RETURNING id`,
        [id, typeId, label, school.yearName, `${KIND_INFO[kind].title} ${serialNo.replace(/\//g, '-')}.pdf`, pdf.length, pdf, req.accountId])).rows[0]!;
      return { id: cert.id, serialNo, documentId: doc.id, signMode: sign.mode };
    });
  });

  /** Every certificate issued, newest first (the certificate register). */
  app.get('/certificates', pre, async (req) => {
    must(req, 'students.manage');
    const q = z.object({ kind: z.enum(KINDS).optional() }).parse(req.query);
    return schoolTx(db, req, async (tx) => ({
      certificates: (await tx.query(
        `SELECT c.id, c.kind, c.serial_no AS "serialNo", c.issued_at AS "issuedAt", c.sign_mode AS "signMode",
                st.id AS "studentId", st.first_name || coalesce(' ' || st.last_name, '') AS name, st.admission_no AS "admissionNo",
                c.details->>'className' AS "className", m.display_name AS "issuedBy",
                (SELECT d.id FROM student_documents d WHERE d.student_id = c.student_id AND d.label LIKE '%' || c.serial_no LIMIT 1) AS "documentId"
           FROM certificates c JOIN students st ON st.id = c.student_id
           LEFT JOIN memberships m ON m.account_id = c.issued_by AND m.school_id = c.school_id
          WHERE ($1::text IS NULL OR c.kind = $1) ORDER BY c.issued_at DESC LIMIT 500`, [q.kind ?? null])).rows,
    }));
  });

  /** Admission and withdrawal register: one line per student ever admitted. */
  app.get('/registers/admission-withdrawal', pre, async (req) => {
    must(req, 'students.manage');
    const q = z.object({
      year: z.coerce.number().int().min(1950).max(2100).optional(),
      show: z.enum(['all', 'studying', 'left']).default('all'),
    }).parse(req.query);
    return schoolTx(db, req, async (tx) => ({
      rows: (await tx.query(
        `SELECT st.id, st.admission_no AS "admissionNo", st.admission_date::text AS "admissionDate",
                st.first_name || coalesce(' ' || st.last_name, '') AS name, st.gender, st.date_of_birth::text AS dob,
                f.father_name AS father, f.mother_name AS mother, f.guardian_name AS guardian, f.address,
                first.class_name AS "classAdmitted", cur.class_name AS "classNow", st.status, st.left_on::text AS "leftOn",
                tc.serial_no AS "tcNo", tc.issued_at::date::text AS "tcDate", tc.details->>'reason' AS reason
           FROM students st JOIN families f ON f.id = st.family_id
           LEFT JOIN LATERAL (SELECT c.name AS class_name FROM enrollments e JOIN sections s ON s.id = e.section_id JOIN classes c ON c.id = s.class_id
                                JOIN academic_years y ON y.id = e.academic_year_id WHERE e.student_id = st.id ORDER BY y.starts_on ASC LIMIT 1) first ON true
           LEFT JOIN LATERAL (SELECT c.name AS class_name FROM enrollments e JOIN sections s ON s.id = e.section_id JOIN classes c ON c.id = s.class_id
                                JOIN academic_years y ON y.id = e.academic_year_id WHERE e.student_id = st.id ORDER BY y.starts_on DESC LIMIT 1) cur ON true
           LEFT JOIN LATERAL (SELECT serial_no, issued_at, details FROM certificates WHERE student_id = st.id AND kind = 'tc' ORDER BY issued_at ASC LIMIT 1) tc ON true
          WHERE ($1::int IS NULL OR extract(year FROM st.admission_date) = $1)
            AND ($2 = 'all' OR ($2 = 'studying' AND st.status = 'active') OR ($2 = 'left' AND st.status <> 'active'))
          ORDER BY st.admission_date NULLS FIRST, st.admission_no`, [q.year ?? null, q.show])).rows,
    }));
  });
}
