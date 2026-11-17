// Helpers for the digital student file: admission numbers, photo links, file checks.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Tx } from '../db.js';
import { badRequest } from '../errors.js';

/** Next admission number in the school's format, e.g. "{CODE}/{YEAR}/{SEQ}" -> GV/2027/0187. */
export async function nextAdmissionNo(tx: Tx, schoolId: string, year: number) {
  const s = (await tx.query<{ code: string; format: string }>(
    'SELECT code, admission_no_format AS format FROM schools WHERE id = $1', [schoolId])).rows[0]!;
  for (let tries = 0; tries < 50; tries++) {
    const n = (await tx.query<{ n: number }>(
      `INSERT INTO admission_counters (school_id, year, next_no) VALUES ($1, $2, 2)
       ON CONFLICT (school_id, year) DO UPDATE SET next_no = admission_counters.next_no + 1
       RETURNING next_no - 1 AS n`, [schoolId, year])).rows[0]!.n;
    const no = formatAdmissionNo(s.format, s.code, year, n);
    // Skip numbers already typed in by hand (old students).
    const taken = await tx.query('SELECT 1 FROM students WHERE admission_no = $1', [no]);
    if (!taken.rowCount) return no;
  }
  throw badRequest('no_number', 'Could not find a free admission number. Please type one in.');
}

export function formatAdmissionNo(format: string, code: string, year: number, n: number) {
  return format.replace('{CODE}', code).replace('{YEAR}', String(year)).replace('{YY}', String(year).slice(2))
    .replace('{SEQ}', String(n).padStart(4, '0'));
}

/** Photos are shown in apps without a login header, so their link carries a signature instead. */
export function photoSig(secret: string, schoolId: string, studentId: string, version: string) {
  return createHmac('sha256', secret).update(`photo:${schoolId}:${studentId}:${version}`).digest('base64url').slice(0, 22);
}
export function photoUrl(secret: string, schoolId: string, studentId: string, version: string) {
  return `/photos/${schoolId}/${studentId}?v=${version}&s=${photoSig(secret, schoolId, studentId, version)}`;
}
export function photoSigOk(secret: string, schoolId: string, studentId: string, version: string, sig: string) {
  const want = Buffer.from(photoSig(secret, schoolId, studentId, version));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Decode a "data:...;base64,..." upload and check what it really is (not what it claims to be). */
export function decodeUpload(dataUrl: string, maxBytes: number, allowPdf: boolean) {
  const m = /^data:[^;,]*;base64,(.+)$/s.exec(dataUrl);
  if (!m) throw badRequest('bad_file', 'That file could not be read. Please try again.');
  const buf = Buffer.from(m[1]!, 'base64');
  if (buf.length > maxBytes) throw badRequest('too_big', `The file is too large. Please keep it under ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const mime = sniff(buf);
  if (!mime || (mime === 'application/pdf' && !allowPdf)) {
    throw badRequest('bad_type', allowPdf ? 'Please upload a photo (JPG or PNG) or a PDF.' : 'Please upload a photo (JPG or PNG).');
  }
  return { buf, mime };
}

function sniff(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf' | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

export const extFor = (mime: string) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' }[mime] ?? 'bin');
export const safeName = (s: string) => s.replace(/[^\w\- .()]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'document';
