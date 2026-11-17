// Homework, given by teachers in the teacher app.
//  - Any teacher can give homework to any class (same as attendance, pending your decision).
//  - Parents of every child in the class get one app message per homework.
//  - Only the teacher who gave it, or the principal/owner, can change or remove it.
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { can, must, schoolTx } from '../context.js';
import { todayIST } from './attendance.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const body = z.object({
  sectionId: uuid,
  subjectId: uuid.optional().nullable(),
  title: z.string().trim().min(2, 'Write what the homework is').max(120),
  details: z.string().trim().max(2000).optional().nullable(),
  dueOn: date.optional().nullable(),
});

const SELECT = `
  SELECT h.id, h.section_id AS "sectionId", c.name AS "className", s.name AS "sectionName",
         h.subject_id AS "subjectId", sub.name AS "subjectName", h.title, h.details,
         h.due_on AS "dueOn", h.created_at AS "createdAt", h.created_by AS "createdBy", a.name AS "givenBy",
         h.report_sent_at AS "reportSentAt"
    FROM homework h
    JOIN sections s ON s.id = h.section_id
    JOIN classes c ON c.id = s.class_id
    JOIN accounts a ON a.id = h.created_by
    LEFT JOIN subjects sub ON sub.id = h.subject_id`;

export function registerHomeworkRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler) {
  const pre = { preHandler: requireSchool };

  /** Classes and their subjects, for the "give homework" form. Mine first. */
  app.get('/teacher/classes', pre, async (req) => {
    if (!can(req, 'homework.post') && !can(req, 'attendance.take')) throw forbidden();
    return schoolTx(db, req, async (tx) => ({
      sections: (await tx.query(
        `SELECT s.id AS "sectionId", c.name AS "className", s.name AS "sectionName",
                (s.class_teacher_membership = $1
                  OR EXISTS (SELECT 1 FROM section_teachers t WHERE t.section_id = s.id AND t.membership_id = $1)) AS mine,
                coalesce((SELECT json_agg(json_build_object('id', sub.id, 'name', sub.name,
                    'mine', EXISTS (SELECT 1 FROM section_teachers t WHERE t.section_id = s.id AND t.subject_id = sub.id AND t.membership_id = $1))
                    ORDER BY cs.sort_order)
                   FROM class_subjects cs JOIN subjects sub ON sub.id = cs.subject_id WHERE cs.class_id = c.id), '[]') AS subjects
           FROM sections s
           JOIN classes c ON c.id = s.class_id
           JOIN academic_years y ON y.id = s.academic_year_id AND y.is_current
          ORDER BY 4 DESC, c.sort_order, s.name`, [req.school!.membershipId])).rows,
    }));
  });

  app.post('/homework', pre, async (req) => {
    must(req, 'homework.post');
    const b = body.parse(req.body);
    if (b.dueOn && b.dueOn < todayIST()) throw badRequest('past_date', 'The due date has already passed');
    return schoolTx(db, req, async (tx) => {
      const sec = (await tx.query<{ class_id: string; label: string }>(
        `SELECT s.class_id, section_label(c.name, s.name) AS label
           FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.id = $1`, [b.sectionId])).rows[0];
      if (!sec) throw notFound('Class not found');
      let subjectName: string | null = null;
      if (b.subjectId) {
        const sub = (await tx.query<{ name: string }>(
          'SELECT sub.name FROM class_subjects cs JOIN subjects sub ON sub.id = cs.subject_id WHERE cs.class_id = $1 AND cs.subject_id = $2',
          [sec.class_id, b.subjectId])).rows[0];
        if (!sub) throw badRequest('wrong_subject', 'That subject is not taught in this class');
        subjectName = sub.name;
      }
      const hw = (await tx.query<{ id: string }>(
        `INSERT INTO homework (school_id, section_id, subject_id, title, details, due_on, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.school!.schoolId, b.sectionId, b.subjectId ?? null, b.title, b.details ?? null, b.dueOn ?? null, req.accountId])).rows[0]!;

      // One message per family (a family with two children in the class gets one).
      const sent = await tx.query(
        `INSERT INTO notifications (school_id, account_id, channel, title, body, data)
         SELECT DISTINCT ON (f.account_id) $1::uuid, f.account_id, 'push', $2, $3, jsonb_build_object('kind', 'homework', 'homeworkId', $4::text)
           FROM enrollments e
           JOIN students st ON st.id = e.student_id AND st.status = 'active'
           JOIN families f ON f.id = st.family_id AND f.account_id IS NOT NULL
          WHERE e.section_id = $5`,
        [req.school!.schoolId, `Homework${subjectName ? `: ${subjectName}` : ''} (${sec.label})`, b.title, hw.id, b.sectionId]);
      return { id: hw.id, parentsTold: sent.rowCount ?? 0 };
    });
  });

  /** Homework for one class (newest first), or everything I gave recently. */
  app.get('/homework', pre, async (req) => {
    if (!can(req, 'homework.post') && !can(req, 'students.view')) throw forbidden();
    const q = z.object({ sectionId: uuid.optional(), mine: z.coerce.boolean().optional(), days: z.coerce.number().int().min(1).max(120).default(14) }).parse(req.query);
    return schoolTx(db, req, async (tx) => ({
      homework: (await tx.query(
        `${SELECT}
          WHERE ($1::uuid IS NULL OR h.section_id = $1)
            AND (NOT $2 OR h.created_by = $3)
            AND h.created_at > now() - make_interval(days => $4)
          ORDER BY h.created_at DESC LIMIT 200`,
        [q.sectionId ?? null, q.mine ?? false, req.accountId, q.days])).rows,
    }));
  });

  const ownOrPrincipal = async (req: Parameters<typeof can>[0], id: string, tx: Parameters<Parameters<typeof schoolTx>[2]>[0]) => {
    const row = (await tx.query<{ created_by: string }>('SELECT created_by FROM homework WHERE id = $1', [id])).rows[0];
    if (!row) throw notFound('Homework not found');
    if (row.created_by !== req.accountId && !can(req, 'school.settings')) {
      throw forbidden('Only the teacher who gave this homework can change it');
    }
  };

  app.patch('/homework/:id', pre, async (req) => {
    must(req, 'homework.post');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = body.omit({ sectionId: true, subjectId: true }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      await ownOrPrincipal(req, id, tx);
      await tx.query('UPDATE homework SET title = $2, details = $3, due_on = $4 WHERE id = $1',
        [id, b.title, b.details ?? null, b.dueOn ?? null]);
      return { ok: true };
    });
  });

  app.delete('/homework/:id', pre, async (req) => {
    must(req, 'homework.post');
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      await ownOrPrincipal(req, id, tx);
      await tx.query('DELETE FROM homework WHERE id = $1', [id]);
      return { ok: true };
    });
  });
}
