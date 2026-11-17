// The final marksheet for the year.
//
// How the result is worked out (set by the principal for each class):
//  - Only the exams the principal chose count, each with its weight (e.g. Unit Test 1 = 10,
//    Half Yearly = 30, Unit Test 2 = 10, Final = 50). Weights are used as proportions.
//  - Each exam's mark becomes a percentage: (written + internal) / (max + internal max).
//    Absent counts as 0.
//  - A subject's result = the weighted average of those percentages.
//  - Overall = the average of all subjects. Grades come from the school's grade scale.
//  - Pass rule: every subject at least "subject minimum" % AND overall at least "overall minimum" %.
//  - If any mark is missing, no marksheet is made for that student (shown as "marks missing").
// Nursery/KG (grades only): the latest grade in each subject; there is no pass/fail.
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import type { Tx } from '../db.js';
import { gradeFor, round1, scales, type Band } from '../exams/report.js';
import { INK, PEACOCK, RULE, SOFT, finish, header, newDoc, type CertSchool, type CertSign } from '../certificates/pdf.js';

export interface Weight { examId: string; weight: number }
export interface Settings { weights: Weight[]; passSubjectPct: number; passOverallPct: number; resultDate: string | null }

export interface MarksheetData {
  student: { id: string; name: string; admissionNo: string; rollNo: number | null; classLabel: string; dateOfBirth: string | null;
    fatherName: string | null; motherName: string | null };
  yearName: string;
  style: 'grades_only' | 'marks_and_grades';
  exams: { id: string; name: string; weight: number; weightPct: number }[];
  rows: { subject: string; cells: { examId: string; text: string }[]; pct: number | null; grade: string | null; below: boolean }[];
  pct: number | null; grade: string | null;
  passed: boolean; result: string;
  passRule: { subject: number; overall: number } | null;
  attendance: { present: number; days: number; pct: number | null };
  remark: string | null;
  complete: boolean; missing: string[];
}

export const classLabelOf = (name: string) => (/^\d+$/.test(name) ? `Class ${name}` : name);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export async function loadSettings(tx: Tx, yearId: string, classId: string): Promise<Settings | null> {
  const r = (await tx.query<{ weights: Weight[]; pass_subject_pct: string; pass_overall_pct: string; result_date: string | null }>(
    `SELECT weights, pass_subject_pct, pass_overall_pct, result_date::text FROM result_settings
      WHERE academic_year_id = $1 AND class_id = $2`, [yearId, classId])).rows[0];
  if (!r) return null;
  return { weights: r.weights, passSubjectPct: Number(r.pass_subject_pct), passOverallPct: Number(r.pass_overall_pct), resultDate: r.result_date };
}

/** Works out one student's marksheet (nothing is saved here). */
export async function computeMarksheet(tx: Tx, studentId: string, yearId: string, settings: Settings): Promise<MarksheetData> {
  const st = (await tx.query(
    `SELECT st.id, trim(st.first_name || ' ' || coalesce(st.last_name, '')) AS name, st.admission_no AS "admissionNo",
            st.date_of_birth::text AS "dateOfBirth", f.father_name AS "fatherName", f.mother_name AS "motherName",
            e.roll_no AS "rollNo", c.id AS "classId", c.name AS "className", sec.name AS "sectionName",
            c.assessment_style AS style, y.name AS "yearName", y.starts_on::text AS "yearStart"
       FROM students st JOIN families f ON f.id = st.family_id
       JOIN enrollments e ON e.student_id = st.id AND e.academic_year_id = $2
       JOIN academic_years y ON y.id = $2
       JOIN sections sec ON sec.id = e.section_id JOIN classes c ON c.id = sec.class_id
      WHERE st.id = $1`, [studentId, yearId])).rows[0];
  if (!st) throw new Error('student not enrolled');
  const gradesOnly = st.style === 'grades_only';
  const sc = await scales(tx);
  const bands: Band[] = (gradesOnly ? sc.grades?.bands : sc.marks?.bands) ?? [];

  const examIds = settings.weights.map((w) => w.examId);
  const exams = examIds.length ? (await tx.query<{ id: string; name: string }>(
    'SELECT id, name FROM exams WHERE id = ANY($1)', [examIds])).rows : [];
  const totalW = settings.weights.reduce((a, w) => a + w.weight, 0);
  const examList = settings.weights.map((w) => ({
    id: w.examId, name: exams.find((x) => x.id === w.examId)?.name ?? 'Exam', weight: w.weight,
    weightPct: totalW ? round1((w.weight / totalW) * 100) : 0,
  }));
  const subjects = (await tx.query<{ id: string; name: string }>(
    `SELECT sub.id, sub.name FROM class_subjects cs JOIN subjects sub ON sub.id = cs.subject_id
      WHERE cs.class_id = $1 ORDER BY cs.sort_order, sub.name`, [st.classId])).rows;
  const marks = examIds.length ? (await tx.query<{ exam_id: string; subject_id: string; marks: string | null; max: string | null;
    internal: string | null; internal_max: string | null; grade: string | null; absent: boolean }>(
    `SELECT exam_id, subject_id, marks_obtained AS marks, max_marks AS max, internal_marks AS internal, internal_max, grade, is_absent AS absent
       FROM marks WHERE student_id = $1 AND exam_id = ANY($2)`, [studentId, examIds])).rows : [];

  const missing: string[] = [];
  const rows = subjects.map((sub) => {
    let weighted = 0; let complete = true; let lastGrade: string | null = null;
    const cells = examList.map((x) => {
      const m = marks.find((k) => k.exam_id === x.id && k.subject_id === sub.id);
      if (!m || (!m.absent && m.marks == null && m.grade == null)) {
        complete = false; missing.push(`${sub.name} (${x.name})`);
        return { examId: x.id, text: '—' };
      }
      if (gradesOnly) { if (m.grade) lastGrade = m.grade; return { examId: x.id, text: m.absent ? 'AB' : m.grade ?? '—' }; }
      const got = m.absent ? 0 : Number(m.marks ?? 0) + Number(m.internal ?? 0);
      const max = Number(m.max ?? 0) + Number(m.internal_max ?? 0);
      if (max > 0 && totalW > 0) weighted += (got / max) * 100 * (x.weight / totalW);
      return { examId: x.id, text: m.absent ? 'AB' : `${fmt(got)}/${fmt(max)}` };
    });
    if (gradesOnly) return { subject: sub.name, cells, pct: null, grade: lastGrade, below: false };
    const pct = complete && examList.length ? round1(weighted) : null;
    return { subject: sub.name, cells, pct, grade: gradeFor(bands, pct),
      below: pct !== null && pct < settings.passSubjectPct };
  });

  const complete = missing.length === 0 && examList.length > 0 && subjects.length > 0;
  const pct = !gradesOnly && complete ? round1(rows.reduce((a, r) => a + (r.pct ?? 0), 0) / rows.length) : null;
  const passed = gradesOnly ? true : complete && pct !== null && pct >= settings.passOverallPct && !rows.some((r) => r.below);
  const result = gradesOnly ? 'Completed' : !complete ? 'Marks missing' : passed ? 'Pass'
    : rows.some((r) => r.below) ? `Below the pass mark in ${rows.filter((r) => r.below).map((r) => r.subject).join(', ')}` : 'Below the pass mark overall';

  const days = (await tx.query<{ status: string }>(
    `SELECT DISTINCT ON (a.on_date) k.status
       FROM attendance_sessions a JOIN attendance_marks k ON k.session_id = a.id AND k.student_id = $1
      WHERE a.on_date >= $2::date ORDER BY a.on_date, a.period_no`, [studentId, st.yearStart])).rows;
  const present = days.filter((d) => ['present', 'late'].includes(d.status)).length + days.filter((d) => d.status === 'half_day').length / 2;
  const remark = (await tx.query<{ remark: string }>(
    `SELECT r.remark FROM report_remarks r JOIN terms t ON t.id = r.term_id
      WHERE r.student_id = $1 AND r.subject_id IS NULL AND t.academic_year_id = $2
      ORDER BY t.sort_order DESC LIMIT 1`, [studentId, yearId])).rows[0]?.remark ?? null;

  return {
    student: { id: st.id, name: st.name, admissionNo: st.admissionNo, rollNo: st.rollNo,
      classLabel: `${classLabelOf(st.className)} ${st.sectionName}`, dateOfBirth: st.dateOfBirth,
      fatherName: st.fatherName, motherName: st.motherName },
    yearName: st.yearName, style: st.style,
    exams: examList, rows, pct, grade: gradeFor(bands, pct), passed, result,
    passRule: gradesOnly ? null : { subject: settings.passSubjectPct, overall: settings.passOverallPct },
    attendance: { present, days: days.length, pct: days.length ? round1((present / days.length) * 100) : null },
    remark, complete, missing,
  };
}

/** Short code printed under the QR code, e.g. "K7Q2-M9XD-4TPA". No look-alike letters. */
export function newVerifyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(12);
  const s = Array.from(b, (x) => chars[x % chars.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export interface SheetToPrint { data: MarksheetData; verifyCode: string; resultNote: string | null; issuedOn: string }

/** One or many marksheets in a single PDF (one A4 page each). */
export async function marksheetsPdf(school: CertSchool, sheets: SheetToPrint[], sign: CertSign, verifyBase: string) {
  const doc = newDoc();
  for (const [i, s] of sheets.entries()) {
    if (i > 0) doc.addPage();
    await drawOne(doc, school, s, sign, verifyBase);
  }
  if (!sheets.length) doc.font('regular').fontSize(12).fillColor(SOFT).text('No marksheets to print.', 48, 60);
  return finish(doc);
}

async function drawOne(doc: PDFKit.PDFDocument, school: CertSchool, s: SheetToPrint, sign: CertSign, verifyBase: string) {
  const d = s.data;
  const W = doc.page.width, M = 48;
  let y = header(doc, { school, title: 'Marksheet', serialNo: s.verifyCode, admissionNo: d.student.admissionNo, duplicate: false, serialLabel: 'Code' });

  // Student details, two columns
  const left: [string, string][] = [['Name', d.student.name], ['Class', d.student.classLabel], ['Roll no.', d.student.rollNo ? String(d.student.rollNo) : '-']];
  const right: [string, string][] = [['Session', d.yearName], ['Father', d.student.fatherName ?? '-'], ['Mother', d.student.motherName ?? '-']];
  const colW = (W - 2 * M) / 2;
  const startY = y;
  for (const [col, list] of [[0, left], [1, right]] as const) {
    let yy = startY;
    for (const [k, v] of list) {
      doc.font('regular').fontSize(9).fillColor(SOFT).text(k, M + col * colW, yy, { width: 70 });
      doc.font('display').fontSize(10.5).fillColor(INK).text(v, M + col * colW + 70, yy - 1, { width: colW - 80 });
      yy = Math.max(doc.y, yy + 14) + 3;
    }
    y = Math.max(y, yy);
  }
  y += 8;

  // Marks table: Subject | each exam (weight) | Result % | Grade
  const gradesOnly = d.style === 'grades_only';
  const subjW = 130;
  const tail = gradesOnly ? 60 : 110;
  const exW = d.exams.length ? (W - 2 * M - subjW - tail) / d.exams.length : 0;
  const rowH = 20;
  const line = (yy: number) => doc.lineWidth(0.6).strokeColor(RULE).moveTo(M, yy).lineTo(W - M, yy).stroke();
  doc.lineWidth(1).strokeColor(PEACOCK).moveTo(M, y).lineTo(W - M, y).stroke();
  doc.font('display').fontSize(8.5).fillColor(PEACOCK);
  doc.text('SUBJECT', M + 4, y + 6, { width: subjW });
  d.exams.forEach((x, i) => doc.text(`${x.name.toUpperCase()}${gradesOnly ? '' : ` (${fmt(x.weightPct)}%)`}`, M + subjW + i * exW, y + 6, { width: exW - 4, align: 'center' }));
  if (!gradesOnly) doc.text('RESULT', W - M - tail, y + 6, { width: 60, align: 'center' });
  doc.text('GRADE', W - M - (gradesOnly ? 60 : 50), y + 6, { width: gradesOnly ? 60 : 50, align: 'center' });
  y += 24; line(y);
  for (const r of d.rows) {
    doc.font('regular').fontSize(10).fillColor(INK).text(r.subject, M + 4, y + 5, { width: subjW - 6, height: rowH, ellipsis: true });
    r.cells.forEach((c, i) => doc.text(c.text, M + subjW + i * exW, y + 5, { width: exW - 4, align: 'center' }));
    if (!gradesOnly) {
      doc.font('display').fillColor(r.below ? '#B4432F' : INK).text(r.pct === null ? '—' : `${fmt(r.pct)}%`, W - M - tail, y + 5, { width: 60, align: 'center' });
    }
    doc.font('display').fillColor(INK).text(r.grade ?? '—', W - M - (gradesOnly ? 60 : 50), y + 5, { width: gradesOnly ? 60 : 50, align: 'center' });
    y += rowH; line(y);
  }
  if (!gradesOnly) {
    doc.font('display').fontSize(10.5).fillColor(INK).text('Overall', M + 4, y + 6, { width: subjW });
    doc.text(d.pct === null ? '—' : `${fmt(d.pct)}%`, W - M - tail, y + 6, { width: 60, align: 'center' });
    doc.text(d.grade ?? '—', W - M - 50, y + 6, { width: 50, align: 'center' });
    y += 24;
    doc.lineWidth(1).strokeColor(PEACOCK).moveTo(M, y).lineTo(W - M, y).stroke();
  }
  y += 14;

  // Result, attendance, remark
  const resultText = s.resultNote ? `${d.passed ? 'Pass' : d.result}. ${s.resultNote}` : d.result;
  doc.font('regular').fontSize(9.5).fillColor(SOFT).text('Result', M, y, { width: 90 });
  doc.font('display').fontSize(12).fillColor(d.passed ? PEACOCK : '#B4432F').text(resultText, M + 90, y - 2, { width: W - 2 * M - 90 });
  y = doc.y + 8;
  doc.font('regular').fontSize(9.5).fillColor(SOFT).text('Attendance', M, y, { width: 90 });
  doc.font('regular').fontSize(10.5).fillColor(INK).text(d.attendance.days ? `${fmt(d.attendance.present)} of ${d.attendance.days} days (${fmt(d.attendance.pct ?? 0)}%)` : '-', M + 90, y - 1);
  y = doc.y + 6;
  if (d.remark) {
    doc.font('regular').fontSize(9.5).fillColor(SOFT).text('Remark', M, y, { width: 90 });
    doc.font('regular').fontSize(10.5).fillColor(INK).text(d.remark, M + 90, y - 1, { width: W - 2 * M - 90 });
    y = doc.y + 6;
  }
  if (d.passRule) {
    doc.font('regular').fontSize(8.5).fillColor(SOFT).text(
      `How the result is worked out: ${d.exams.map((x) => `${x.name} ${fmt(x.weightPct)}%`).join(', ')}. Pass: at least ${fmt(d.passRule.subject)}% in every subject and ${fmt(d.passRule.overall)}% overall.`,
      M, y + 4, { width: W - 2 * M });
  }

  // Footer: QR code to check, date, signature
  const fy = doc.page.height - 150;
  const url = `${verifyBase.replace(/\/$/, '')}/verify/${s.verifyCode}`;
  const qr = await QRCode.toBuffer(url, { margin: 0, width: 240, errorCorrectionLevel: 'M' });
  doc.image(qr, M, fy, { width: 74 });
  doc.font('regular').fontSize(8).fillColor(SOFT).text('Scan to check this marksheet', M + 84, fy + 8, { width: 170 });
  doc.font('display').fontSize(10).fillColor(INK).text(s.verifyCode, M + 84, fy + 22, { width: 170 });
  doc.font('regular').fontSize(8).fillColor(SOFT).text(`Issued ${new Date(`${s.issuedOn}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`, M + 84, fy + 38, { width: 170 });

  const sx = W - M - 180;
  if (sign.mode === 'printed' && sign.image && (sign.image.mime === 'image/png' || sign.image.mime === 'image/jpeg')) {
    doc.image(sign.image.data, sx + 20, fy - 6, { fit: [140, 50], align: 'center', valign: 'bottom' });
  }
  doc.lineWidth(0.8).strokeColor(INK).moveTo(sx, fy + 50).lineTo(W - M, fy + 50).stroke();
  doc.font('display').fontSize(10).fillColor(INK).text(sign.name ?? '', sx, fy + 56, { width: 180, align: 'center' });
  doc.font('regular').fontSize(9).fillColor(SOFT).text(sign.title, sx, doc.y, { width: 180, align: 'center' });
}
