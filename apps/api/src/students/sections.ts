// Sections are made only when a class needs them. One section = no letter ("Class 6");
// a second section turns the first into "A" and the new one into "B".
import type { Tx } from '../db.js';
import { badRequest, notFound } from '../errors.js';

interface Sec { id: string; name: string; seats: number | null; students: number }

export async function sectionsOf(tx: Tx, classId: string, yearId: string): Promise<Sec[]> {
  return (await tx.query<Sec>(
    `SELECT s.id, s.name, s.seats, (SELECT count(*)::int FROM enrollments e WHERE e.section_id = s.id) AS students
       FROM sections s WHERE s.class_id = $1 AND s.academic_year_id = $2 ORDER BY s.name`, [classId, yearId])).rows;
}

const nextLetter = (used: string[]) => {
  for (let i = 0; i < 26; i++) { const l = String.fromCharCode(65 + i); if (!used.includes(l)) return l; }
  throw badRequest('too_many_sections', 'This class already has 26 sections');
};

/**
 * Adds a section to a class. The first section of a class has no letter. Adding a second one
 * names the existing one "A" (if it had no letter) and the new one the next free letter.
 * A new section starts with the same seats and subject teachers as the first one.
 */
export async function addSection(tx: Tx, schoolId: string, classId: string, yearId: string, wanted?: string | null) {
  const cls = (await tx.query('SELECT 1 FROM classes WHERE id = $1', [classId])).rowCount;
  if (!cls) throw notFound('Class not found');
  const existing = await sectionsOf(tx, classId, yearId);
  if (!existing.length) {
    return (await tx.query<{ id: string; name: string }>(
      `INSERT INTO sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, '') RETURNING id, name`,
      [schoolId, yearId, classId])).rows[0]!;
  }
  const plain = existing.find((s) => s.name === '');
  const used = existing.map((s) => s.name).filter(Boolean);
  if (plain) {
    const first = nextLetter(used);
    await tx.query('UPDATE sections SET name = $2 WHERE id = $1', [plain.id, first]);
    used.push(first); plain.name = first;
  }
  const name = (wanted ?? '').trim().toUpperCase() || nextLetter(used);
  if (used.includes(name)) throw badRequest('duplicate', `Section ${name} already exists in this class`);
  const model = existing[0]!;
  const sec = (await tx.query<{ id: string; name: string }>(
    `INSERT INTO sections (school_id, academic_year_id, class_id, name, seats) VALUES ($1, $2, $3, $4, $5) RETURNING id, name`,
    [schoolId, yearId, classId, name, model.seats])).rows[0]!;
  await tx.query(
    `INSERT INTO section_teachers (school_id, section_id, subject_id, membership_id)
     SELECT school_id, $2, subject_id, membership_id FROM section_teachers WHERE section_id = $1`, [model.id, sec.id]);
  return sec;
}

/** After a section is removed: if only one is left, it goes back to having no letter. */
export async function tidyAfterRemove(tx: Tx, classId: string, yearId: string) {
  const left = await sectionsOf(tx, classId, yearId);
  if (left.length === 1 && left[0]!.name !== '') await tx.query(`UPDATE sections SET name = '' WHERE id = $1`, [left[0]!.id]);
}

/** Moves students to another section of the same class (this year). Their roll numbers are cleared. */
export async function moveStudents(tx: Tx, studentIds: string[], toSectionId: string) {
  const to = (await tx.query<{ class_id: string; academic_year_id: string }>(
    'SELECT class_id, academic_year_id FROM sections WHERE id = $1', [toSectionId])).rows[0];
  if (!to) throw notFound('Section not found');
  const r = await tx.query(
    `UPDATE enrollments e SET section_id = $2, roll_no = NULL
       FROM sections s
      WHERE e.section_id = s.id AND s.class_id = $3 AND e.academic_year_id = $4
        AND e.student_id = ANY($1::uuid[]) AND e.section_id <> $2`,
    [studentIds, toSectionId, to.class_id, to.academic_year_id]);
  const already = (await tx.query('SELECT count(*)::int AS n FROM enrollments WHERE section_id = $1 AND student_id = ANY($2::uuid[])',
    [toSectionId, studentIds])).rows[0].n as number;
  if (already !== studentIds.length) throw badRequest('wrong_class', 'Some of these students are not in this class this year');
  return r.rowCount ?? 0;
}

/** Sections with more students than seats that the principal hasn't decided about yet. */
export async function seatAlerts(tx: Tx, yearId: string) {
  return (await tx.query<{ classId: string; sectionId: string; label: string; students: number; seats: number; sections: number }>(
    `SELECT c.id AS "classId", s.id AS "sectionId", section_label(c.name, s.name) AS label, n.students, s.seats,
            (SELECT count(*)::int FROM sections x WHERE x.class_id = c.id AND x.academic_year_id = $1) AS sections
       FROM sections s JOIN classes c ON c.id = s.class_id
       CROSS JOIN LATERAL (SELECT count(*)::int AS students FROM enrollments e WHERE e.section_id = s.id) n
      WHERE s.academic_year_id = $1 AND s.seats IS NOT NULL AND n.students > s.seats
        AND (s.seats_ok_up_to IS NULL OR n.students > s.seats_ok_up_to)
      ORDER BY c.sort_order, s.name`, [yearId])).rows;
}
