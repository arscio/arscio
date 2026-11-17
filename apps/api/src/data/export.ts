// Excel downloads: any list in Arscio, filtered, as a tidy .xlsx; and blank templates for importing.
import ExcelJS from 'exceljs';
import { ROLE_LABELS, type Role } from '@arscio/shared';
import type { Tx } from '../db.js';
import { badRequest } from '../errors.js';
import { FIELDS, marksSetup } from './import.js';

export const EXPORTS = {
  students: 'Students and families',
  staff: 'Staff',
  attendance: 'Attendance register (one month)',
  fees: 'Fees due and paid',
  receipts: 'Receipts',
  marks: 'Marks',
  register: 'Admission and withdrawal register',
  certificates: 'Certificates issued',
  leave: 'Teacher leave',
} as const;
export type ExportKind = keyof typeof EXPORTS;

export interface ExportFilters {
  sectionId?: string; classId?: string; status?: 'active' | 'left' | 'all';
  month?: string; from?: string; to?: string; termId?: string; onlyDue?: boolean;
}

interface Col { header: string; key: string; width?: number; money?: boolean; date?: boolean }
const PEACOCK = 'FF0B7FA6';

function sheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: Record<string, unknown>[], title?: string) {
  const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.min(40, Math.max(10, c.header.length + 2)) }));
  for (const r of rows) {
    const out: Record<string, unknown> = {};
    for (const c of cols) {
      const v = r[c.key];
      out[c.key] = v === null || v === undefined ? null
        : c.money ? Number(v) : c.date && typeof v === 'string' ? new Date(`${v.slice(0, 10)}T00:00:00Z`) : v;
    }
    ws.addRow(out);
  }
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PEACOCK } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 22;
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.money) col.numFmt = '#,##,##0.00';
    if (c.date) col.numFmt = 'dd/mm/yyyy';
  });
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  if (title) wb.title = title;
  return ws;
}

const classLabel = (c: string | null) => (c ? (/^\d+$/.test(c) ? `Class ${c}` : c) : '');

export async function buildExport(tx: Tx, kind: ExportKind, f: ExportFilters) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Arscio';
  const school = (await tx.query<{ name: string; short: string | null; code: string }>('SELECT name, short_name AS short, code FROM schools WHERE id = app_school_id()')).rows[0]!;
  wb.company = school.name;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  let fileName = `${school.code} ${EXPORTS[kind]} ${today}`;
  const secFilter = `($1::uuid IS NULL OR e.section_id = $1) AND ($2::uuid IS NULL OR s.class_id = $2)`;

  if (kind === 'students') {
    const rows = (await tx.query(
      `SELECT st.admission_no, st.first_name, st.last_name, c.name AS class, s.name AS section, e.roll_no,
              st.date_of_birth::text AS dob, initcap(st.gender) AS gender, st.blood_group, st.admission_date::text AS doa,
              f.father_name, f.mother_name, f.guardian_name, substr(f.phone, 4) AS phone, substr(f.alt_phone, 4) AS alt_phone, f.email, f.address,
              st.aadhaar_last4, CASE st.status WHEN 'active' THEN 'Studying' WHEN 'left' THEN 'Left' WHEN 'passed_out' THEN 'Passed out' ELSE st.status END AS status,
              st.left_on::text AS left_on
         FROM students st JOIN families f ON f.id = st.family_id
         LEFT JOIN LATERAL (SELECT e.section_id, e.roll_no FROM enrollments e JOIN academic_years y ON y.id = e.academic_year_id
                             WHERE e.student_id = st.id ORDER BY y.is_current DESC, y.starts_on DESC LIMIT 1) e ON true
         LEFT JOIN sections s ON s.id = e.section_id LEFT JOIN classes c ON c.id = s.class_id
        WHERE ${secFilter} AND ($3 = 'all' OR ($3 = 'active' AND st.status = 'active') OR ($3 = 'left' AND st.status <> 'active'))
        ORDER BY c.sort_order, s.name, e.roll_no NULLS LAST, st.first_name`,
      [f.sectionId ?? null, f.classId ?? null, f.status ?? 'active'])).rows;
    sheet(wb, 'Students', [
      { header: 'Admission number', key: 'admission_no', width: 16 }, { header: 'First name', key: 'first_name', width: 16 }, { header: 'Last name', key: 'last_name', width: 14 },
      { header: 'Class', key: 'class', width: 8 }, { header: 'Section', key: 'section', width: 8 }, { header: 'Roll number', key: 'roll_no', width: 8 },
      { header: 'Date of birth', key: 'dob', date: true, width: 12 }, { header: 'Gender', key: 'gender', width: 8 }, { header: 'Blood group', key: 'blood_group', width: 8 },
      { header: 'Date of admission', key: 'doa', date: true, width: 12 }, { header: "Father's name", key: 'father_name', width: 18 }, { header: "Mother's name", key: 'mother_name', width: 18 },
      { header: "Guardian's name", key: 'guardian_name', width: 16 }, { header: 'Family mobile number', key: 'phone', width: 14 }, { header: 'Other phone', key: 'alt_phone', width: 13 },
      { header: 'Email', key: 'email', width: 22 }, { header: 'Address', key: 'address', width: 30 }, { header: 'Aadhaar (last 4)', key: 'aadhaar_last4', width: 9 },
      { header: 'Status', key: 'status', width: 10 }, { header: 'Left on', key: 'left_on', date: true, width: 12 },
    ], rows);
  } else if (kind === 'staff') {
    const rows = (await tx.query<{ name: string; phone: string; roles: Role[]; designation: string | null; employee_code: string | null; status: string }>(
      `SELECT m.display_name AS name, substr(a.phone, 4) AS phone, array_agg(r.role ORDER BY r.role) AS roles, m.designation, m.employee_code, m.status
         FROM memberships m JOIN accounts a ON a.id = m.account_id JOIN membership_roles r ON r.membership_id = m.id AND r.role <> 'parent'
        WHERE m.school_id = app_school_id() GROUP BY m.id, a.id ORDER BY m.status, m.display_name`)).rows;
    sheet(wb, 'Staff', [
      { header: 'Name', key: 'name', width: 22 }, { header: 'Mobile number', key: 'phone', width: 14 }, { header: 'Role', key: 'roles', width: 22 },
      { header: 'Designation', key: 'designation', width: 18 }, { header: 'Employee code', key: 'employee_code', width: 12 }, { header: 'Status', key: 'status', width: 10 },
    ], rows.map((r) => ({ ...r, roles: r.roles.map((x) => ROLE_LABELS[x]).join(', '), status: r.status === 'active' ? 'Active' : 'Inactive' })));
  } else if (kind === 'attendance') {
    if (!f.sectionId || !f.month || !/^\d{4}-\d{2}$/.test(f.month)) throw badRequest('need_filters', 'Choose a class and a month');
    const sec = (await tx.query<{ c: string; s: string }>('SELECT c.name AS c, s.name AS s FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.id = $1', [f.sectionId])).rows[0];
    if (!sec) throw badRequest('no_section', 'Class not found');
    const [y, mo] = f.month.split('-').map(Number) as [number, number];
    const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const students = (await tx.query<{ id: string; roll_no: number | null; name: string; admission_no: string }>(
      `SELECT st.id, e.roll_no, st.first_name || coalesce(' ' || st.last_name, '') AS name, st.admission_no
         FROM enrollments e JOIN students st ON st.id = e.student_id WHERE e.section_id = $1 ORDER BY e.roll_no NULLS LAST, st.first_name`, [f.sectionId])).rows;
    const marks = (await tx.query<{ student_id: string; d: number; status: string }>(
      `SELECT DISTINCT ON (k.student_id, a.on_date) k.student_id, extract(day FROM a.on_date)::int AS d, k.status
         FROM attendance_sessions a JOIN attendance_marks k ON k.session_id = a.id
        WHERE a.section_id = $1 AND to_char(a.on_date, 'YYYY-MM') = $2 ORDER BY k.student_id, a.on_date, a.period_no`, [f.sectionId, f.month])).rows;
    const code: Record<string, string> = { present: 'P', absent: 'A', late: 'L', half_day: 'H', leave: 'LV' };
    const cols: Col[] = [{ header: 'Roll', key: 'roll', width: 6 }, { header: 'Name', key: 'name', width: 22 }, { header: 'Admission number', key: 'adm', width: 15 },
      ...Array.from({ length: days }, (_, i) => ({ header: String(i + 1), key: `d${i + 1}`, width: 4 })),
      { header: 'Present', key: 'present', width: 8 }, { header: 'Absent', key: 'absent', width: 8 }, { header: 'Days taken', key: 'taken', width: 9 }];
    const rows = students.map((s) => {
      const r: Record<string, unknown> = { roll: s.roll_no, name: s.name, adm: s.admission_no };
      let p = 0, a = 0, t = 0;
      for (const m of marks.filter((x) => x.student_id === s.id)) {
        r[`d${m.d}`] = code[m.status] ?? m.status; t++;
        if (m.status === 'present' || m.status === 'late') p++; else if (m.status === 'half_day') p += 0.5; else if (m.status === 'absent') a++;
      }
      return { ...r, present: p, absent: a, taken: t };
    });
    const ws = sheet(wb, `${classLabel(sec.c)} ${sec.s} ${f.month}`, cols, rows);
    ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
    fileName = `${school.code} Attendance ${classLabel(sec.c)} ${sec.s} ${f.month}`;
  } else if (kind === 'fees') {
    const rows = (await tx.query(
      `SELECT st.admission_no, st.first_name || coalesce(' ' || st.last_name, '') AS name, c.name AS class, s.name AS section, substr(fa.phone, 4) AS phone,
              i.name AS instalment, i.due_on::text AS due_on, h.name AS fee_head, b.amount, b.concession, b.paid, b.balance
         FROM fee_due_balances b JOIN students st ON st.id = b.student_id JOIN families fa ON fa.id = st.family_id
         JOIN fee_instalments i ON i.id = b.instalment_id JOIN fee_heads h ON h.id = b.fee_head_id
         JOIN academic_years y ON y.id = b.academic_year_id AND y.is_current
         LEFT JOIN enrollments e ON e.student_id = st.id AND e.academic_year_id = y.id
         LEFT JOIN sections s ON s.id = e.section_id LEFT JOIN classes c ON c.id = s.class_id
        WHERE ${secFilter} AND (NOT $3 OR b.balance > 0)
        ORDER BY c.sort_order, s.name, e.roll_no NULLS LAST, st.first_name, i.due_on, h.name`,
      [f.sectionId ?? null, f.classId ?? null, f.onlyDue ?? false])).rows;
    sheet(wb, 'Fees', [
      { header: 'Admission number', key: 'admission_no', width: 16 }, { header: 'Name', key: 'name', width: 22 }, { header: 'Class', key: 'class', width: 7 },
      { header: 'Section', key: 'section', width: 7 }, { header: 'Family mobile', key: 'phone', width: 13 }, { header: 'Instalment', key: 'instalment', width: 14 },
      { header: 'Due on', key: 'due_on', date: true, width: 11 }, { header: 'Fee', key: 'fee_head', width: 16 }, { header: 'Amount', key: 'amount', money: true, width: 11 },
      { header: 'Concession', key: 'concession', money: true, width: 11 }, { header: 'Paid', key: 'paid', money: true, width: 11 }, { header: 'Balance', key: 'balance', money: true, width: 11 },
    ], rows);
    // A second sheet: one line per student, for calling defaulters
    const per = new Map<string, Record<string, unknown> & { due: number; paid: number; balance: number }>();
    for (const r of rows as Record<string, string>[]) {
      const k = r.admission_no!;
      const p = per.get(k) ?? { admission_no: k, name: r.name, class: r.class, section: r.section, phone: r.phone, due: 0, paid: 0, balance: 0 };
      p.due += Number(r.amount) - Number(r.concession); p.paid += Number(r.paid); p.balance += Number(r.balance);
      per.set(k, p);
    }
    sheet(wb, 'By student', [
      { header: 'Admission number', key: 'admission_no', width: 16 }, { header: 'Name', key: 'name', width: 22 }, { header: 'Class', key: 'class', width: 7 },
      { header: 'Section', key: 'section', width: 7 }, { header: 'Family mobile', key: 'phone', width: 13 },
      { header: 'Total due', key: 'due', money: true, width: 12 }, { header: 'Paid', key: 'paid', money: true, width: 12 }, { header: 'Balance', key: 'balance', money: true, width: 12 },
    ], [...per.values()]);
  } else if (kind === 'receipts') {
    const from = f.from ?? `${today.slice(0, 7)}-01`, to = f.to ?? today;
    const rows = (await tx.query(
      `SELECT r.receipt_no, r.paid_on::text AS paid_on, st.admission_no, st.first_name || coalesce(' ' || st.last_name, '') AS name,
              r.total_amount, upper(replace(r.mode, '_', ' ')) AS mode, r.reference, m.display_name AS collected_by,
              CASE r.status WHEN 'active' THEN 'Valid' ELSE 'Cancelled' END AS status, r.cancel_reason
         FROM receipts r JOIN students st ON st.id = r.student_id
         LEFT JOIN memberships m ON m.account_id = r.collected_by AND m.school_id = r.school_id
        WHERE r.paid_on BETWEEN $1 AND $2 ORDER BY r.paid_on, r.receipt_no`, [from, to])).rows;
    sheet(wb, 'Receipts', [
      { header: 'Receipt number', key: 'receipt_no', width: 20 }, { header: 'Date', key: 'paid_on', date: true, width: 11 }, { header: 'Admission number', key: 'admission_no', width: 16 },
      { header: 'Name', key: 'name', width: 22 }, { header: 'Amount', key: 'total_amount', money: true, width: 12 }, { header: 'Paid by', key: 'mode', width: 12 },
      { header: 'Reference', key: 'reference', width: 16 }, { header: 'Collected by', key: 'collected_by', width: 16 }, { header: 'Status', key: 'status', width: 10 },
      { header: 'Why cancelled', key: 'cancel_reason', width: 20 },
    ], rows);
    fileName = `${school.code} Receipts ${from} to ${to}`;
  } else if (kind === 'marks') {
    if (!f.sectionId || !f.termId) throw badRequest('need_filters', 'Choose a term and a class');
    const exams = (await tx.query<{ id: string; name: string; max: string }>(
      `SELECT x.id, x.name, x.default_max_marks AS max FROM exams x WHERE x.term_id = $1
          AND (cardinality(x.class_ids) = 0 OR (SELECT class_id FROM sections WHERE id = $2) = ANY(x.class_ids)) ORDER BY x.sort_order, x.name`, [f.termId, f.sectionId])).rows;
    for (const x of exams) {
      const s = await marksSetup(tx, x.id, f.sectionId);
      const marks = (await tx.query<{ student_id: string; subject_id: string; m: string | null; grade: string | null; absent: boolean }>(
        'SELECT student_id, subject_id, marks_obtained AS m, grade, is_absent AS absent FROM marks WHERE exam_id = $1', [x.id])).rows;
      sheet(wb, x.name, [
        { header: 'Roll number', key: 'roll', width: 8 }, { header: 'Admission number', key: 'adm', width: 16 }, { header: 'Name', key: 'name', width: 22 },
        ...s.subjects.map((sub) => ({ header: s.gradesOnly ? sub.name : `${sub.name} (out of ${Number(x.max)})`, key: sub.id, width: 12 })),
      ], s.students.map((st) => {
        const r: Record<string, unknown> = { roll: st.roll_no, adm: st.admission_no, name: st.name };
        for (const m of marks.filter((y) => y.student_id === st.id)) r[m.subject_id] = m.absent ? 'AB' : m.grade ?? (m.m === null ? null : Number(m.m));
        return r;
      }));
    }
    if (!exams.length) throw badRequest('no_exams', 'This term has no exams for that class');
  } else if (kind === 'register') {
    const rows = (await tx.query(
      `SELECT st.admission_no, st.admission_date::text AS doa, st.first_name || coalesce(' ' || st.last_name, '') AS name, initcap(st.gender) AS gender,
              st.date_of_birth::text AS dob, f.father_name, f.mother_name, f.address, first.c AS class_admitted, st.left_on::text AS left_on,
              CASE WHEN st.status <> 'active' THEN cur.c END AS class_left, tc.details->>'reason' AS reason, tc.serial_no AS tc_no
         FROM students st JOIN families f ON f.id = st.family_id
         LEFT JOIN LATERAL (SELECT c.name AS c FROM enrollments e JOIN sections s ON s.id = e.section_id JOIN classes c ON c.id = s.class_id JOIN academic_years y ON y.id = e.academic_year_id WHERE e.student_id = st.id ORDER BY y.starts_on LIMIT 1) first ON true
         LEFT JOIN LATERAL (SELECT c.name AS c FROM enrollments e JOIN sections s ON s.id = e.section_id JOIN classes c ON c.id = s.class_id JOIN academic_years y ON y.id = e.academic_year_id WHERE e.student_id = st.id ORDER BY y.starts_on DESC LIMIT 1) cur ON true
         LEFT JOIN LATERAL (SELECT serial_no, details FROM certificates WHERE student_id = st.id AND kind = 'tc' ORDER BY issued_at LIMIT 1) tc ON true
        ORDER BY st.admission_date NULLS FIRST, st.admission_no`)).rows;
    sheet(wb, 'Admission register', [
      { header: 'Admission number', key: 'admission_no', width: 16 }, { header: 'Date of admission', key: 'doa', date: true, width: 12 }, { header: 'Name', key: 'name', width: 22 },
      { header: 'Gender', key: 'gender', width: 8 }, { header: 'Date of birth', key: 'dob', date: true, width: 12 }, { header: "Father's name", key: 'father_name', width: 18 },
      { header: "Mother's name", key: 'mother_name', width: 18 }, { header: 'Address', key: 'address', width: 28 }, { header: 'Class admitted', key: 'class_admitted', width: 9 },
      { header: 'Date of leaving', key: 'left_on', date: true, width: 12 }, { header: 'Class left', key: 'class_left', width: 9 }, { header: 'Reason', key: 'reason', width: 22 },
      { header: 'TC number', key: 'tc_no', width: 20 },
    ], rows);
  } else if (kind === 'certificates') {
    const rows = (await tx.query(
      `SELECT c.serial_no, CASE c.kind WHEN 'tc' THEN 'Transfer' WHEN 'bonafide' THEN 'Bonafide' ELSE 'Character' END AS kind, c.issued_at::date::text AS issued_on,
              st.admission_no, st.first_name || coalesce(' ' || st.last_name, '') AS name, c.details->>'className' AS class, m.display_name AS issued_by
         FROM certificates c JOIN students st ON st.id = c.student_id LEFT JOIN memberships m ON m.account_id = c.issued_by AND m.school_id = c.school_id
        ORDER BY c.issued_at`)).rows;
    sheet(wb, 'Certificates', [
      { header: 'Serial number', key: 'serial_no', width: 20 }, { header: 'Certificate', key: 'kind', width: 11 }, { header: 'Issued on', key: 'issued_on', date: true, width: 11 },
      { header: 'Admission number', key: 'admission_no', width: 16 }, { header: 'Name', key: 'name', width: 22 }, { header: 'Class', key: 'class', width: 7 }, { header: 'Issued by', key: 'issued_by', width: 16 },
    ], rows);
  } else if (kind === 'leave') {
    const from = f.from ?? `${today.slice(0, 4)}-01-01`, to = f.to ?? today;
    const rows = (await tx.query(
      `SELECT m.display_name AS name, l.from_date::text AS from_date, l.to_date::text AS to_date,
              CASE l.part WHEN 'full' THEN 'Full day' WHEN 'first_half' THEN 'First half' WHEN 'second_half' THEN 'Second half' ELSE 'Periods ' || array_to_string(l.periods, ', ') END AS part,
              (l.to_date - l.from_date + 1) AS days, l.reason, initcap(l.status) AS status, d.display_name AS decided_by
         FROM teacher_leaves l JOIN memberships m ON m.id = l.membership_id
         LEFT JOIN memberships d ON d.account_id = l.decided_by AND d.school_id = l.school_id
        WHERE l.from_date <= $2 AND l.to_date >= $1 ORDER BY l.from_date, m.display_name`, [from, to])).rows;
    sheet(wb, 'Leave', [
      { header: 'Teacher', key: 'name', width: 20 }, { header: 'From', key: 'from_date', date: true, width: 11 }, { header: 'To', key: 'to_date', date: true, width: 11 },
      { header: 'Part', key: 'part', width: 12 }, { header: 'Days', key: 'days', width: 6 }, { header: 'Reason', key: 'reason', width: 28 },
      { header: 'Status', key: 'status', width: 10 }, { header: 'Decided by', key: 'decided_by', width: 16 },
    ], rows);
    fileName = `${school.code} Teacher leave ${from} to ${to}`;
  }
  return { buf: Buffer.from(await wb.xlsx.writeBuffer()), fileName: `${fileName.replace(/[^\w\- ]+/g, '')}.xlsx` };
}

/** Templates: the right column headings, one example row, and a sheet explaining each column. */
export async function buildTemplate(tx: Tx, kind: 'students' | 'staff' | 'marks', p: { examId?: string; sectionId?: string }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Arscio';
  if (kind === 'marks') {
    if (!p.examId || !p.sectionId) throw badRequest('need_filters', 'Choose the exam and class first');
    const s = await marksSetup(tx, p.examId, p.sectionId);
    const ws = sheet(wb, 'Marks', [
      { header: 'Roll number', key: 'roll', width: 8 }, { header: 'Admission number', key: 'adm', width: 16 }, { header: 'Name', key: 'name', width: 22 },
      ...s.subjects.map((sub) => ({ header: s.gradesOnly ? sub.name : `${sub.name} (out of ${s.exam.max})`, key: sub.id, width: 14 })),
    ], s.students.map((st) => ({ roll: st.roll_no, adm: st.admission_no, name: st.name })));
    ws.getColumn(1).font = { color: { argb: 'FF4A6B78' } };
    const help = wb.addWorksheet('How to fill');
    help.addRows([[`${s.exam.term}: ${s.exam.name}, Class ${s.section.class_name} ${s.section.name}`], [],
      [s.gradesOnly ? 'Write a grade (A1, A2, B1...) under each subject.' : `Write marks out of ${s.exam.max} under each subject.`],
      ['Write AB if the student was absent. Leave a cell empty if marks are not ready.'],
      ['Do not change the admission numbers; Arscio uses them to find each student.']]);
    help.getColumn(1).width = 90; help.getRow(1).font = { bold: true, size: 13 };
    return { buf: Buffer.from(await wb.xlsx.writeBuffer()), fileName: `Marks ${s.exam.name} Class ${s.section.class_name}${s.section.name}.xlsx` };
  }
  const fields = FIELDS[kind].filter((f) => kind !== 'students' || !['fullName'].includes(f.key));
  const example: Record<string, unknown> = kind === 'students' ? {
    admissionNo: '', firstName: 'Arif', lastName: 'Hussain', className: '7', section: 'A', rollNo: 7, dateOfBirth: '14/03/2014', gender: 'Male',
    bloodGroup: 'B+', admissionDate: '03/04/2021', fatherName: 'Imran Hussain', motherName: 'Rehana Begum', guardianName: '', phone: '9876500011',
    altPhone: '', email: '', address: 'Ward 5, Dhubri', aadhaar: '',
  } : { name: 'Rina Das', phone: '9123456780', roles: 'Teacher', designation: 'TGT English', employeeCode: 'T014' };
  const ws = sheet(wb, kind === 'students' ? 'Students' : 'Staff', fields.map((f) => ({ header: f.label, key: f.key, width: Math.max(12, f.label.length + 2) })), [example]);
  ws.getRow(2).font = { italic: true, color: { argb: 'FF8AA3AD' } };
  fields.forEach((f, i) => { if (f.required) ws.getRow(1).getCell(i + 1).value = `${f.label} *`; });
  const help = wb.addWorksheet('How to fill');
  help.columns = [{ header: 'Column', key: 'c', width: 28 }, { header: 'Needed?', key: 'r', width: 10 }, { header: 'How to fill it', key: 'h', width: 70 }];
  help.getRow(1).font = { bold: true };
  for (const f of fields) help.addRow({ c: f.label, r: f.required ? 'Yes' : '', h: f.hint ?? '' });
  help.addRow({});
  help.addRow({ c: 'Row 2 is an example. Replace it with real data or delete it.' });
  if (kind === 'students') {
    help.addRow({ c: 'Brothers and sisters: give them the same family mobile number; they are joined into one family.' });
    help.addRow({ c: 'Dates can be written 14/03/2014, 14-03-2014 or as an Excel date.' });
  }
  return { buf: Buffer.from(await wb.xlsx.writeBuffer()), fileName: `Arscio ${kind === 'students' ? 'students' : 'staff'} template.xlsx` };
}
