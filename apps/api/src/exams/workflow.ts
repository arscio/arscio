// The rules for who enters marks and when they can still be corrected.
//
// Who enters a subject's marks in a class section:
//   1. the teacher the principal picked for it (when several teach that subject), else
//   2. the only teacher who teaches that subject there, else
//   3. if nobody teaches it there, the class teacher.
//   If several teach it and the principal hasn't picked one, nobody can (yet).
// The principal/owner can always enter or correct marks.
//
// The 7-day window: after the first "Submit", the teacher can correct marks for 7 days
// (students check their papers and ask). The principal can reopen for a few more days.
import type { Tx } from '../db.js';

export const CORRECTION_DAYS = 7;

export interface Responsible {
  membershipId: string | null;
  name: string | null;
  how: 'chosen' | 'only_teacher' | 'class_teacher' | 'needs_choice' | 'nobody';
  candidates: { membershipId: string; name: string }[];
}

export async function responsibleTeacher(tx: Tx, sectionId: string, subjectId: string): Promise<Responsible> {
  const chosen = (await tx.query<{ membership_id: string; name: string }>(
    `SELECT mt.membership_id, m.display_name AS name FROM marks_teachers mt
       JOIN memberships m ON m.id = mt.membership_id AND m.status = 'active'
      WHERE mt.section_id = $1 AND mt.subject_id = $2`, [sectionId, subjectId])).rows[0];
  const teachers = (await tx.query<{ membershipId: string; name: string }>(
    `SELECT t.membership_id AS "membershipId", m.display_name AS name FROM section_teachers t
       JOIN memberships m ON m.id = t.membership_id AND m.status = 'active'
      WHERE t.section_id = $1 AND t.subject_id = $2 ORDER BY m.display_name`, [sectionId, subjectId])).rows;
  if (chosen) return { membershipId: chosen.membership_id, name: chosen.name, how: 'chosen', candidates: teachers };
  if (teachers.length === 1) return { ...teachers[0]!, how: 'only_teacher', candidates: teachers };
  if (teachers.length > 1) return { membershipId: null, name: null, how: 'needs_choice', candidates: teachers };
  const ct = (await tx.query<{ id: string; name: string }>(
    `SELECT m.id, m.display_name AS name FROM sections s JOIN memberships m ON m.id = s.class_teacher_membership AND m.status = 'active'
      WHERE s.id = $1`, [sectionId])).rows[0];
  if (ct) return { membershipId: ct.id, name: ct.name, how: 'class_teacher', candidates: [] };
  return { membershipId: null, name: null, how: 'nobody', candidates: [] };
}

/**
 * SQL that is true when membership $M is responsible for subject sub.id in section s.id.
 * Same rules as responsibleTeacher(), for use inside list queries.
 * Expects aliases s (sections) and sub (subjects); `m` is the parameter placeholder.
 */
export const RESPONSIBLE_SQL = (m: string) => `(
  CASE
    WHEN EXISTS (SELECT 1 FROM marks_teachers mt WHERE mt.section_id = s.id AND mt.subject_id = sub.id)
      THEN EXISTS (SELECT 1 FROM marks_teachers mt WHERE mt.section_id = s.id AND mt.subject_id = sub.id AND mt.membership_id = ${m})
    WHEN EXISTS (SELECT 1 FROM section_teachers t WHERE t.section_id = s.id AND t.subject_id = sub.id)
      THEN (SELECT count(*) FROM section_teachers t WHERE t.section_id = s.id AND t.subject_id = sub.id) = 1
       AND EXISTS (SELECT 1 FROM section_teachers t WHERE t.section_id = s.id AND t.subject_id = sub.id AND t.membership_id = ${m})
    ELSE s.class_teacher_membership = ${m}
  END)`;

export interface SubmissionRow {
  first_submitted_at: Date; reopened_until: Date | null;
}

/** Until when a submitted list can still be corrected by its teacher. */
export function editableUntil(s: SubmissionRow | undefined): Date | null {
  if (!s) return null;
  const week = new Date(s.first_submitted_at.getTime() + CORRECTION_DAYS * 24 * 3600 * 1000);
  return s.reopened_until && s.reopened_until > week ? s.reopened_until : week;
}

export const istDate = (d: Date) =>
  d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

/** One app message to a student's family (if the family has a login). */
export async function notifyFamily(tx: Tx, studentId: string, title: string, body: string, data: Record<string, string>) {
  await tx.query(
    `INSERT INTO notifications (school_id, account_id, channel, title, body, data)
     SELECT st.school_id, f.account_id, 'push', $2, $3, $4::jsonb
       FROM students st JOIN families f ON f.id = st.family_id
      WHERE st.id = $1 AND f.account_id IS NOT NULL`,
    [studentId, title, body, JSON.stringify({ ...data, studentId })]);
}

/** "72/80" or "15/20 + 62/80 = 77/100", "Absent", or a grade. */
export function markText(m: { marks: number | null; max: number | null; internal: number | null; internalMax: number | null; grade: string | null; absent: boolean }) {
  if (m.absent) return 'Absent';
  if (m.marks == null && m.grade) return m.grade;
  if (m.marks == null) return '-';
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  if (m.internalMax) {
    const total = m.marks + (m.internal ?? 0), totalMax = (m.max ?? 0) + m.internalMax;
    return `${fmt(total)}/${fmt(totalMax)}`;
  }
  return `${fmt(m.marks)}/${fmt(m.max ?? 0)}`;
}
