// A school's own identity: logo, colour, short name, affiliation number.
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { withContext, type Db } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { must, schoolTx } from '../context.js';

const MAX_BYTES = 300 * 1024;

/** Only real PNG / JPEG / WebP pictures (no SVG: it can carry scripts). */
function sniff(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export function registerIdentityRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler) {
  const pre = { preHandler: requireSchool };

  app.patch('/school/identity', pre, async (req) => {
    must(req, 'school.settings');
    const b = z.object({
      brandColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Choose a colour').nullable().optional(),
      shortName: z.string().trim().max(20).nullable().optional(),
      affiliationNo: z.string().trim().max(30).nullable().optional(),
    }).parse(req.body);
    const sent = (k: string) => typeof req.body === 'object' && req.body !== null && k in req.body;
    return schoolTx(db, req, async (tx) => (await tx.query(
      `UPDATE schools SET
         brand_color = CASE WHEN $2 THEN $3 ELSE brand_color END,
         short_name = CASE WHEN $4 THEN nullif($5, '') ELSE short_name END,
         affiliation_no = CASE WHEN $6 THEN nullif($7, '') ELSE affiliation_no END
       WHERE id = $1 RETURNING brand_color AS "brandColor", short_name AS "shortName", affiliation_no AS "affiliationNo"`,
      [req.school!.schoolId, sent('brandColor'), b.brandColor ?? null, sent('shortName'), b.shortName ?? null,
       sent('affiliationNo'), b.affiliationNo ?? null])).rows[0]);
  });

  /** Upload the logo as a data URL ("data:image/png;base64,...."). */
  app.put('/school/logo', { ...pre, bodyLimit: 600 * 1024 }, async (req) => {
    must(req, 'school.settings');
    const { dataUrl } = z.object({ dataUrl: z.string().max(560_000) }).parse(req.body);
    const m = /^data:[^;]+;base64,(.+)$/.exec(dataUrl);
    if (!m) throw badRequest('bad_image', 'Choose a PNG, JPG or WebP picture');
    const buf = Buffer.from(m[1]!, 'base64');
    if (buf.length > MAX_BYTES) throw badRequest('too_big', 'The logo is too large. Please use a picture under 300 KB.');
    const mime = sniff(buf);
    if (!mime) throw badRequest('bad_image', 'Choose a PNG, JPG or WebP picture');
    return schoolTx(db, req, async (tx) => {
      await tx.query(
        `INSERT INTO school_logos (school_id, mime, data) VALUES ($1, $2, $3)
         ON CONFLICT (school_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = now()`,
        [req.school!.schoolId, mime, buf]);
      const url = `/schools/${req.school!.schoolId}/logo?v=${Date.now()}`;
      await tx.query('UPDATE schools SET logo_url = $2 WHERE id = $1', [req.school!.schoolId, url]);
      return { logoUrl: url };
    });
  });

  app.delete('/school/logo', pre, async (req) => {
    must(req, 'school.settings');
    return schoolTx(db, req, async (tx) => {
      await tx.query('DELETE FROM school_logos WHERE school_id = $1', [req.school!.schoolId]);
      await tx.query('UPDATE schools SET logo_url = NULL WHERE id = $1', [req.school!.schoolId]);
      return { ok: true };
    });
  });

  /** Public: the logo is shown on the school's website, receipts and the parent app. */
  app.get('/schools/:id/logo', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await withContext(db, { schoolId: id }, async (tx) =>
      (await tx.query<{ mime: string; data: Buffer }>('SELECT mime, data FROM school_logos WHERE school_id = $1', [id])).rows[0]);
    if (!row) throw notFound('No logo');
    return reply
      .header('content-type', row.mime)
      .header('cache-control', 'public, max-age=86400')
      .header('x-content-type-options', 'nosniff')
      .header('cross-origin-resource-policy', 'cross-origin')
      .send(row.data);
  });
}
