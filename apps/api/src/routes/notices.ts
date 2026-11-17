// Notices: written once on the website, delivered to the right people as an app message.
// Audiences: everyone / all parents / all staff / chosen classes / chosen sections.
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { can, must, schoolTx } from '../context.js';

const uuid = z.string().uuid();

// Parents of active students (optionally only some classes / sections) and/or active staff.
const RECIPIENTS = `
  SELECT DISTINCT f.account_id
    FROM enrollments e
    JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
    JOIN students st ON st.id = e.student_id AND st.status = 'active'
    JOIN families f ON f.id = st.family_id AND f.account_id IS NOT NULL
    JOIN sections s ON s.id = e.section_id
   WHERE $2 IN ('everyone', 'parents')
      OR ($2 = 'classes' AND s.class_id = ANY($3::uuid[]))
      OR ($2 = 'sections' AND s.id = ANY($4::uuid[]))
  UNION
  SELECT DISTINCT m.account_id
    FROM memberships m JOIN membership_roles r ON r.membership_id = m.id AND r.role <> 'parent'
   WHERE m.status = 'active' AND m.school_id = app_school_id() AND $2 IN ('everyone', 'staff')`;

export function registerNoticeRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler) {
  const pre = { preHandler: requireSchool };

  app.post('/notices', pre, async (req) => {
    must(req, 'notices.publish');
    const b = z.object({
      title: z.string().trim().min(3, 'Write a title').max(120),
      body: z.string().trim().min(3, 'Write the notice').max(4000),
      audience: z.enum(['everyone', 'parents', 'staff', 'classes', 'sections']),
      classIds: z.array(uuid).max(20).default([]),
      sectionIds: z.array(uuid).max(60).default([]),
    }).parse(req.body);
    if (b.audience === 'classes' && b.classIds.length === 0) throw badRequest('no_audience', 'Choose at least one class');
    if (b.audience === 'sections' && b.sectionIds.length === 0) throw badRequest('no_audience', 'Choose at least one section');
    return schoolTx(db, req, async (tx) => {
      const n = (await tx.query<{ id: string }>(
        `INSERT INTO notices (school_id, title, body, audience, class_ids, section_ids, created_by, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now()) RETURNING id`,
        [req.school!.schoolId, b.title, b.body, b.audience, b.classIds, b.sectionIds, req.accountId])).rows[0]!;
      const sent = await tx.query(
        `INSERT INTO notifications (school_id, account_id, channel, title, body, data)
         SELECT $1, r.account_id, 'push', $5, $6, jsonb_build_object('kind', 'notice', 'noticeId', $7::text)
           FROM (${RECIPIENTS}) r`,
        [req.school!.schoolId, b.audience, b.classIds, b.sectionIds, b.title, b.body, n.id]);
      return { id: n.id, recipients: sent.rowCount ?? 0 };
    });
  });

  /** Notices sent by the school, newest first, with how many people have read each. */
  app.get('/notices', pre, async (req) => {
    if (!can(req, 'notices.publish') && !can(req, 'students.view')) throw forbidden();
    return schoolTx(db, req, async (tx) => ({
      notices: (await tx.query(
        `SELECT n.id, n.title, n.body, n.audience, n.class_ids AS "classIds", n.section_ids AS "sectionIds",
                n.published_at AS "publishedAt", a.name AS "sentBy", n.withdrawn_at AS "withdrawnAt",
                w.name AS "withdrawnBy",
                (SELECT count(*)::int FROM notifications x WHERE x.data->>'noticeId' = n.id::text) AS recipients,
                (SELECT count(*)::int FROM notifications x WHERE x.data->>'noticeId' = n.id::text AND x.read_at IS NOT NULL) AS "readBy"
           FROM notices n JOIN accounts a ON a.id = n.created_by LEFT JOIN accounts w ON w.id = n.withdrawn_by
          ORDER BY n.published_at DESC NULLS LAST LIMIT 200`)).rows,
    }));
  });

  /** Withdraw: it disappears from people's apps, but the record stays. */
  app.post('/notices/:id/withdraw', pre, async (req) => {
    must(req, 'notices.publish');
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const r = await tx.query(
        'UPDATE notices SET withdrawn_at = now(), withdrawn_by = $2 WHERE id = $1 AND withdrawn_at IS NULL RETURNING id',
        [id, req.accountId]);
      if (!r.rowCount) throw notFound('Notice not found or already withdrawn');
      await tx.query("DELETE FROM notifications WHERE data->>'noticeId' = $1 AND school_id = $2", [id, req.school!.schoolId]);
      return { ok: true };
    });
  });
}
