// Builds one student's report card for the current academic year.
//
// How the numbers work (Classes 1-10, "marks and grades"):
//  - Each exam's marks become a percentage: marks / max marks x 100. Absent counts as 0.
//    Internal marks (for the subjects that have them) are added: (written + internal) / (max + internal max).
//  - A subject's TERM score is the weighted average of that term's exams, using each
//    exam's weightage (e.g. Periodic Test 20%, Half Yearly 80%). Weightages don't have
//    to add up to 100; they are used as proportions.
//  - A subject's YEAR score is the average of its term scores.
//  - Grades come from the school's grade scale (CBSE 8-point by default).
//  - If any mark is still missing, that score is left blank (shown as "pending"),
//    never guessed.
// Nursery/KG ("grades only"): teachers give a grade per exam; the term grade is the
// latest grade given in that term. No percentages.
import type { Tx } from '../db.js';
import { notFound } from '../errors.js';

export interface Band { min?: number; max?: number; grade: string; point?: number; label?: string }

export const round1 = (n: number) => Math.round(n * 10) / 10;

export function gradeFor(bands: Band[], pct: number | null): string | null {
  if (pct === null) return null;
  const b = bands.find((x) => x.min !== undefined && pct >= x.min && pct <= (x.max ?? 100));
  return b?.grade ?? bands[bands.length - 1]?.grade ?? null;
}

export async function scales(tx: Tx) {
  const rows = (await tx.query<{ id: string; name: string; bands: Band[] }>('SELECT id, name, bands FROM grading_scales ORDER BY name')).rows;
  const marks = rows.find((r) => r.bands.some((b) => b.min !== undefined)) ?? null;
  const grades = rows.find((r) => r.bands.every((b) => b.min === undefined)) ?? null;
  return { all: rows, marks, grades };
}

interface Cell { examId: string; marks: number | null; max: number; grade: string | null; absent: boolean; entered: boolean;
  internal: number | null; internalMax: number | null }

export async function buildReport(tx: Tx, studentId: string, opts: { publishedOnly: boolean }) {
  const st = (await tx.query(
    `SELECT st.id, st.first_name AS "firstName", st.last_name AS "lastName", st.admission_no AS "admissionNo",
            st.photo_url AS "photoUrl", st.date_of_birth AS "dateOfBirth",
            f.father_name AS "fatherName", f.mother_name AS "motherName",
            y.id AS "yearId", y.name AS "yearName", y.starts_on::text AS "yearStart",
            e.roll_no AS "rollNo", e.section_id AS "sectionId", sec.name AS "sectionName",
            c.id AS "classId", c.name AS "className", c.assessment_style AS style,
            m.display_name AS "classTeacher",
            json_build_object('id', s.id, 'name', s.name, 'shortName', s.short_name, 'address', s.address, 'phone', s.phone,
              'logoUrl', s.logo_url, 'brandColor', s.brand_color, 'affiliationNo', s.affiliation_no, 'board', s.board) AS school
       FROM students st
       JOIN families f ON f.id = st.family_id
       JOIN schools s ON s.id = st.school_id
       JOIN academic_years y ON y.school_id = st.school_id AND y.is_current
       JOIN enrollments e ON e.student_id = st.id AND e.academic_year_id = y.id
       JOIN sections sec ON sec.id = e.section_id
       JOIN classes c ON c.id = sec.class_id
       LEFT JOIN memberships m ON m.id = sec.class_teacher_membership
      WHERE st.id = $1`, [studentId])).rows[0];
  if (!st) throw notFound('This student is not in a class this year');

  const gradesOnly = st.style === 'grades_only';
  const sc = await scales(tx);
  const bands: Band[] = (gradesOnly ? sc.grades?.bands : sc.marks?.bands) ?? [];

  const subjects = (await tx.query<{ id: string; name: string }>(
    `SELECT sub.id, sub.name FROM class_subjects cs JOIN subjects sub ON sub.id = cs.subject_id
      WHERE cs.class_id = $1 ORDER BY cs.sort_order, sub.name`, [st.classId])).rows;
  const terms = (await tx.query<{ id: string; name: string; publishedAt: string | null }>(
    `SELECT id, name, published_at AS "publishedAt" FROM terms
      WHERE academic_year_id = $1 ${opts.publishedOnly ? 'AND published_at IS NOT NULL' : ''}
      ORDER BY sort_order, name`, [st.yearId])).rows;
  const termIds = terms.map((t) => t.id);
  const exams = termIds.length ? (await tx.query<{ id: string; termId: string; name: string; max: string; weight: string }>(
    `SELECT id, term_id AS "termId", name, default_max_marks AS max, weightage_pct AS weight FROM exams
      WHERE term_id = ANY($1) AND (cardinality(class_ids) = 0 OR $2 = ANY(class_ids))
      ORDER BY sort_order, starts_on NULLS LAST, name`, [termIds, st.classId])).rows : [];
  const marks = exams.length ? (await tx.query<{ examId: string; subjectId: string; marks: string | null; max: string | null; grade: string | null; absent: boolean;
      internal: string | null; internalMax: string | null }>(
    `SELECT exam_id AS "examId", subject_id AS "subjectId", marks_obtained AS marks, max_marks AS max, grade, is_absent AS absent,
            internal_marks AS internal, internal_max AS "internalMax"
       FROM marks WHERE student_id = $1 AND exam_id = ANY($2)`, [studentId, exams.map((x) => x.id)])).rows : [];
  const remarks = termIds.length ? (await tx.query<{ termId: string; subjectId: string | null; remark: string }>(
    `SELECT term_id AS "termId", subject_id AS "subjectId", remark FROM report_remarks
      WHERE student_id = $1 AND term_id = ANY($2)`, [studentId, termIds])).rows : [];

  const markOf = (examId: string, subjectId: string) => marks.find((x) => x.examId === examId && x.subjectId === subjectId);

  const termOut = terms.map((t) => {
    const tExams = exams.filter((x) => x.termId === t.id);
    const rows = subjects.map((sub) => {
      const cells: Cell[] = tExams.map((x) => {
        const m = markOf(x.id, sub.id);
        return {
          examId: x.id,
          marks: m?.marks != null ? Number(m.marks) : null,
          max: Number(m?.max ?? x.max),
          grade: m?.grade ?? null,
          absent: m?.absent ?? false,
          entered: !!m && (m.absent || m.marks != null || m.grade != null),
          internal: m?.internal != null ? Number(m.internal) : null,
          internalMax: m?.internalMax != null ? Number(m.internalMax) : null,
        };
      });
      let pct: number | null = null;
      let grade: string | null = null;
      if (gradesOnly) {
        grade = [...cells].reverse().find((c) => c.grade)?.grade ?? null;
      } else if (cells.length && cells.every((c) => c.entered)) {
        const totalW = tExams.reduce((a, x) => a + Number(x.weight), 0);
        pct = round1(cells.reduce((a, c, i) => {
          const p = c.absent ? 0 : (((c.marks ?? 0) + (c.internal ?? 0)) / (c.max + (c.internalMax ?? 0))) * 100;
          const w = totalW > 0 ? Number(tExams[i]!.weight) / totalW : 1 / cells.length;
          return a + p * w;
        }, 0));
        grade = gradeFor(bands, pct);
      }
      return { subjectId: sub.id, subject: sub.name, cells, pct, grade };
    });
    const complete = !gradesOnly && rows.length > 0 && rows.every((r) => r.pct !== null);
    const pct = complete ? round1(rows.reduce((a, r) => a + r.pct!, 0) / rows.length) : null;
    return {
      id: t.id, name: t.name, publishedAt: t.publishedAt,
      exams: tExams.map((x) => ({ id: x.id, name: x.name, max: Number(x.max), weightagePct: Number(x.weight) })),
      rows, pct, grade: gradeFor(bands, pct),
      remark: remarks.find((r) => r.termId === t.id && !r.subjectId)?.remark ?? null,
    };
  });

  // Whole year, per subject: average of the terms (only when every term is complete).
  const year = gradesOnly || !termOut.length ? null : (() => {
    const rows = subjects.map((sub, i) => {
      const ps = termOut.map((t) => t.rows[i]!.pct);
      const pct = ps.every((p) => p !== null) ? round1(ps.reduce((a, p) => a + p!, 0) / ps.length) : null;
      return { subjectId: sub.id, subject: sub.name, pct, grade: gradeFor(bands, pct) };
    });
    const complete = rows.length > 0 && rows.every((r) => r.pct !== null);
    const pct = complete ? round1(rows.reduce((a, r) => a + r.pct!, 0) / rows.length) : null;
    const below = rows.filter((r) => r.pct !== null && r.pct < 33).map((r) => r.subject);
    return { rows, pct, grade: gradeFor(bands, pct), needsSupportIn: below };
  })();

  // Attendance this year: the first attendance of each day counts as the day's roll call.
  const days = (await tx.query<{ status: string }>(
    `SELECT DISTINCT ON (a.on_date) k.status
       FROM attendance_sessions a JOIN attendance_marks k ON k.session_id = a.id AND k.student_id = $1
      WHERE a.on_date >= $2::date
      ORDER BY a.on_date, a.period_no`, [studentId, st.yearStart])).rows;
  const present = days.filter((d) => ['present', 'late'].includes(d.status)).length + days.filter((d) => d.status === 'half_day').length / 2;

  return {
    student: {
      id: st.id, name: `${st.firstName}${st.lastName ? ` ${st.lastName}` : ''}`, admissionNo: st.admissionNo, photoUrl: st.photoUrl,
      dateOfBirth: st.dateOfBirth, fatherName: st.fatherName, motherName: st.motherName, rollNo: st.rollNo,
      className: st.className, sectionName: st.sectionName, classTeacher: st.classTeacher,
    },
    school: st.school,
    yearName: st.yearName,
    style: st.style as 'grades_only' | 'marks_and_grades',
    scale: bands,
    terms: termOut,
    year,
    attendance: { present, days: days.length, pct: days.length ? round1((present / days.length) * 100) : null },
  };
}
