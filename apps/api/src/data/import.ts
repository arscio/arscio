// Importing students and families, staff, and marks from any Excel file.
// Every import is checked row by row first (nothing is saved), then saved in one go, and recorded
// so it can be undone.
import { canAssignRole, normalizeIndianPhone, ROLE_LABELS, ROLES, type Role } from '@arscio/shared';
import type { Tx } from '../db.js';
import { badRequest } from '../errors.js';
import { nextAdmissionNo } from '../students/file.js';
import { date, digits, gender, int, matchClass, text, type Cell, type Sheet } from './sheet.js';

export type Kind = 'students' | 'staff' | 'marks';
export interface Field { key: string; label: string; required?: boolean; words: string[]; hint?: string }

export const FIELDS: Record<'students' | 'staff', Field[]> = {
  students: [
    { key: 'admissionNo', label: 'Admission number', words: ['admission no', 'adm no', 'admission number', 'adm', 'admn no', 'sr no', 'scholar no', 'registration no', 'reg no'], hint: 'Leave empty to give new numbers' },
    { key: 'fullName', label: 'Student name (full)', words: ['student name', 'name of student', 'name', 'full name', 'student'] },
    { key: 'firstName', label: 'First name', words: ['first name', 'firstname', 'given name'] },
    { key: 'lastName', label: 'Last name', words: ['last name', 'surname', 'lastname', 'family name'] },
    { key: 'className', label: 'Class', required: true, words: ['class', 'std', 'standard', 'grade', 'class section', 'class & section', 'class/section'], hint: 'e.g. 7, VII, Class 7 or 7A' },
    { key: 'section', label: 'Section', words: ['section', 'sec', 'div', 'division'] },
    { key: 'rollNo', label: 'Roll number', words: ['roll no', 'roll', 'roll number', 'rollno'] },
    { key: 'dateOfBirth', label: 'Date of birth', words: ['date of birth', 'dob', 'birth date', 'd.o.b', 'birthday'] },
    { key: 'gender', label: 'Gender', words: ['gender', 'sex', 'boy/girl'] },
    { key: 'bloodGroup', label: 'Blood group', words: ['blood group', 'blood', 'bg'] },
    { key: 'admissionDate', label: 'Date of admission', words: ['admission date', 'date of admission', 'doa', 'joining date'] },
    { key: 'fatherName', label: "Father's name", words: ["father's name", 'father name', 'father', 'fathers name'] },
    { key: 'motherName', label: "Mother's name", words: ["mother's name", 'mother name', 'mother', 'mothers name'] },
    { key: 'guardianName', label: "Guardian's name", words: ['guardian', "guardian's name", 'guardian name'] },
    { key: 'phone', label: 'Family mobile number', required: true, words: ['mobile', 'phone', 'mobile no', 'phone no', 'contact', 'contact no', 'parent mobile', "father's mobile", 'whatsapp', 'mobile number'], hint: 'The parents log in with this' },
    { key: 'altPhone', label: 'Other phone', words: ['alternate', 'alt phone', 'other phone', "mother's mobile", 'phone 2', 'mobile 2'] },
    { key: 'email', label: 'Email', words: ['email', 'e-mail', 'mail'] },
    { key: 'address', label: 'Address', words: ['address', 'residence', 'village', 'locality'] },
    { key: 'aadhaar', label: 'Aadhaar (only last 4 kept)', words: ['aadhaar', 'aadhar', 'uid', 'aadhaar no', 'aadhar no'] },
  ],
  staff: [
    { key: 'name', label: 'Name', required: true, words: ['name', 'staff name', 'teacher name', 'employee name', 'full name'] },
    { key: 'phone', label: 'Mobile number', required: true, words: ['mobile', 'phone', 'mobile no', 'contact', 'phone no'], hint: 'They log in with this' },
    { key: 'roles', label: 'Role', words: ['role', 'roles', 'type', 'post', 'staff type'], hint: 'Teacher, Office Admin, Accountant. Empty means Teacher.' },
    { key: 'designation', label: 'Designation', words: ['designation', 'title', 'position', 'post held'] },
    { key: 'employeeCode', label: 'Employee code', words: ['employee code', 'emp code', 'employee id', 'staff id', 'emp id', 'code'] },
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');

/** Guess which column holds which field, from the column headings. */
export function suggest(fields: Field[], headers: string[]): Record<string, number | null> {
  const used = new Set<number>();
  const out: Record<string, number | null> = {};
  // Exact matches first, then "contains", so "Father's mobile" doesn't steal "Father's name"
  for (const pass of ['exact', 'contains'] as const) {
    for (const f of fields) {
      if (out[f.key] !== undefined && out[f.key] !== null) continue;
      const i = headers.findIndex((h, idx) => !used.has(idx) && f.words.concat(f.label).some((w) =>
        pass === 'exact' ? norm(h) === norm(w) : norm(w).length >= 5 && norm(h).includes(norm(w))));
      out[f.key] = i >= 0 ? i : null;
      if (i >= 0) used.add(i);
    }
  }
  // A plain "Name" column is the student's full name, unless first/last were found
  if ('firstName' in out && out.firstName !== null) out.fullName = null;
  return out;
}

export interface RowResult { row: number; status: 'ok' | 'error' | 'skip'; messages: string[]; show: Record<string, string | null> }
interface Ctx { tx: Tx; schoolId: string; accountId: string; roles: Role[] }
const get = (r: Cell[], m: Record<string, number | null>, k: string): Cell => (m[k] === null || m[k] === undefined ? null : r[m[k]!] ?? null);

// ===================== Students and families =====================

interface StudentRow {
  admissionNo: string | null; firstName: string; lastName: string | null; className: string; sectionId: string; rollNo: number | null;
  dob: string | null; gender: 'male' | 'female' | 'other' | null; bloodGroup: string | null; admissionDate: string | null;
  father: string | null; mother: string | null; guardian: string | null; phone: string; altPhone: string | null;
  email: string | null; address: string | null; aadhaarLast4: string | null;
}

async function checkStudents(c: Ctx, sheet: Sheet, m: Record<string, number | null>, opts: { skipExisting: boolean }) {
  if (m.fullName == null && m.firstName == null) throw badRequest('need_name', 'Choose the column with the student’s name');
  for (const f of FIELDS.students.filter((x) => x.required)) if (m[f.key] == null) throw badRequest('need_field', `Choose the column for “${f.label}”`);
  const classes = (await c.tx.query<{ id: string; name: string }>('SELECT id, name FROM classes ORDER BY sort_order')).rows;
  const sections = (await c.tx.query<{ id: string; class_id: string; name: string }>(
    `SELECT s.id, s.class_id, s.name FROM sections s JOIN academic_years y ON y.id = s.academic_year_id AND y.is_current`)).rows;
  const existing = new Map((await c.tx.query<{ admission_no: string; name: string }>(
    `SELECT admission_no, first_name || coalesce(' ' || last_name, '') AS name FROM students`)).rows.map((r) => [r.admission_no.toLowerCase(), r.name]));
  const seenAdm = new Map<string, number>();
  const results: (RowResult & { data?: StudentRow })[] = [];

  sheet.rows.forEach((r, i) => {
    const row = sheet.rowNumbers[i]!;
    const msg: string[] = [];
    const warn: string[] = [];
    let first = text(get(r, m, 'firstName')), last = text(get(r, m, 'lastName'));
    if (!first) {
      const full = text(get(r, m, 'fullName'));
      if (full) { const parts = full.split(' '); first = parts.length > 1 ? parts.slice(0, -1).join(' ') : full; last = parts.length > 1 ? parts.at(-1)! : null; }
    }
    if (!first) msg.push('Name is missing');
    const adm = text(get(r, m, 'admissionNo'));
    let skip = false;
    if (adm) {
      if (existing.has(adm.toLowerCase())) {
        if (opts.skipExisting) skip = true; else msg.push(`Admission number ${adm} is already used (${existing.get(adm.toLowerCase())})`);
      }
      if (seenAdm.has(adm.toLowerCase())) msg.push(`Admission number ${adm} is also on row ${seenAdm.get(adm.toLowerCase())}`);
      seenAdm.set(adm.toLowerCase(), row);
    }
    const cm = matchClass(get(r, m, 'className'), classes.map((x) => x.name));
    let sectionId = '';
    const rawClass = text(get(r, m, 'className'));
    if (!cm) msg.push(rawClass ? `Class “${rawClass}” is not one of this school’s classes` : 'Class is missing');
    else {
      const cls = classes.find((x) => x.name === cm.className)!;
      const secName = (text(get(r, m, 'section')) ?? cm.section ?? '').toUpperCase();
      const options = sections.filter((s) => s.class_id === cls.id);
      const sec = secName ? options.find((s) => s.name.toUpperCase() === secName) : options.length === 1 ? options[0] : undefined;
      if (!options.length) msg.push(`Class ${cm.className} has no sections this year. Add one in Classes & sections.`);
      else if (!sec) msg.push(secName ? `Class ${cm.className} has no section ${secName}` : `Say which section of Class ${cm.className}`);
      else sectionId = sec.id;
    }
    const phoneRaw = digits(get(r, m, 'phone'));
    const phone = phoneRaw ? normalizeIndianPhone(phoneRaw) : null;
    if (!phoneRaw) msg.push('Mobile number is missing');
    else if (!phone) msg.push(`Mobile number ${phoneRaw} is not a valid Indian mobile number`);
    const altRaw = digits(get(r, m, 'altPhone'));
    const alt = altRaw ? normalizeIndianPhone(altRaw) : null;
    if (altRaw && !alt) warn.push('Other phone not valid, left out');
    const dob = date(get(r, m, 'dateOfBirth'));
    if (!dob.ok) msg.push(`Date of birth “${text(get(r, m, 'dateOfBirth'))}” is not a valid date (write it like 14/03/2013)`);
    const doa = date(get(r, m, 'admissionDate'));
    if (!doa.ok) msg.push(`Date of admission “${text(get(r, m, 'admissionDate'))}” is not a valid date (write it like 14/03/2013)`);
    const g = gender(get(r, m, 'gender'));
    if (g === undefined) warn.push(`Gender “${text(get(r, m, 'gender'))}” not understood, left empty`);
    const roll = int(get(r, m, 'rollNo'));
    if (roll === undefined) warn.push('Roll number is not a whole number, left empty');
    const aad = digits(get(r, m, 'aadhaar'));
    if (aad && aad.length !== 12 && aad.length !== 4) warn.push('Aadhaar number looks incomplete, left out');
    const email = text(get(r, m, 'email'));
    const data: StudentRow | undefined = msg.length ? undefined : {
      admissionNo: adm, firstName: first!, lastName: last, className: cm!.className, sectionId, rollNo: roll ?? null,
      dob: dob.ok ? dob.value : null, gender: g ?? null, bloodGroup: text(get(r, m, 'bloodGroup'))?.toUpperCase().replace(/\s/g, '') ?? null,
      admissionDate: doa.ok ? doa.value : null, father: text(get(r, m, 'fatherName')), mother: text(get(r, m, 'motherName')),
      guardian: text(get(r, m, 'guardianName')), phone: phone!, altPhone: alt, email: email && /^\S+@\S+\.\S+$/.test(email) ? email : null,
      address: text(get(r, m, 'address')), aadhaarLast4: aad && (aad.length === 12 || aad.length === 4) ? aad.slice(-4) : null,
    };
    results.push({
      row, status: skip ? 'skip' : msg.length ? 'error' : 'ok', messages: skip ? ['Already in Arscio, skipped'] : [...msg, ...warn],
      show: {
        name: [first, last].filter(Boolean).join(' ') || null, admissionNo: adm ?? (msg.length ? null : '(new number)'),
        class: cm ? `${cm.className}${sectionId ? ` ${sections.find((s) => s.id === sectionId)!.name}` : ''}` : rawClass,
        phone: phone ? phone.replace('+91', '') : phoneRaw, father: text(get(r, m, 'fatherName')),
      },
      data,
    });
  });
  return results;
}

async function applyStudents(c: Ctx, rows: StudentRow[]) {
  const yearId = (await c.tx.query<{ id: string }>('SELECT id FROM academic_years WHERE is_current')).rows[0]!.id;
  const thisYear = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 4));
  const created = { students: [] as string[], families: [] as string[] };
  for (const s of rows) {
    let fam = (await c.tx.query<{ id: string }>('SELECT id FROM families WHERE phone = $1', [s.phone])).rows[0];
    if (!fam) {
      fam = (await c.tx.query<{ id: string }>(
        `INSERT INTO families (school_id, phone, father_name, mother_name, guardian_name, alt_phone, email, address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [c.schoolId, s.phone, s.father, s.mother, s.guardian, s.altPhone, s.email, s.address])).rows[0]!;
      created.families.push(fam.id);
    } else {
      // Fill in what the family record is missing; never overwrite
      await c.tx.query(
        `UPDATE families SET father_name = coalesce(father_name, $2), mother_name = coalesce(mother_name, $3), guardian_name = coalesce(guardian_name, $4),
           alt_phone = coalesce(alt_phone, $5), email = coalesce(email, $6), address = coalesce(address, $7) WHERE id = $1`,
        [fam.id, s.father, s.mother, s.guardian, s.altPhone, s.email, s.address]);
    }
    const adm = s.admissionNo ?? await nextAdmissionNo(c.tx, c.schoolId, Number((s.admissionDate ?? String(thisYear)).slice(0, 4)));
    const st = (await c.tx.query<{ id: string }>(
      `INSERT INTO students (school_id, family_id, admission_no, first_name, last_name, date_of_birth, gender, blood_group, admission_date, aadhaar_last4)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [c.schoolId, fam.id, adm, s.firstName, s.lastName, s.dob, s.gender, s.bloodGroup, s.admissionDate, s.aadhaarLast4])).rows[0]!;
    await c.tx.query('INSERT INTO enrollments (school_id, student_id, academic_year_id, section_id, roll_no) VALUES ($1, $2, $3, $4, $5)',
      [c.schoolId, st.id, yearId, s.sectionId, s.rollNo]);
    created.students.push(st.id);
  }
  return created;
}

// ===================== Staff =====================

interface StaffRow { name: string; phone: string; roles: Role[]; designation: string | null; employeeCode: string | null }

async function checkStaff(c: Ctx, sheet: Sheet, m: Record<string, number | null>) {
  for (const f of FIELDS.staff.filter((x) => x.required)) if (m[f.key] == null) throw badRequest('need_field', `Choose the column for “${f.label}”`);
  const staffPhones = new Map((await c.tx.query<{ phone: string; name: string }>(
    `SELECT a.phone, m.display_name AS name FROM memberships m JOIN accounts a ON a.id = m.account_id
      WHERE m.school_id = app_school_id() AND EXISTS (SELECT 1 FROM membership_roles r WHERE r.membership_id = m.id AND r.role <> 'parent')`)).rows.map((r) => [r.phone, r.name]));
  const seen = new Map<string, number>();
  const roleWords = new Map<string, Role>(ROLES.filter((r) => r !== 'parent').flatMap((r) => [[norm(r), r], [norm(ROLE_LABELS[r]), r]] as [string, Role][]));
  roleWords.set('office', 'office_admin'); roleWords.set('clerk', 'office_admin'); roleWords.set('admin', 'office_admin'); roleWords.set('accounts', 'accountant');
  return sheet.rows.map((r, i) => {
    const row = sheet.rowNumbers[i]!;
    const msg: string[] = [];
    const name = text(get(r, m, 'name'));
    if (!name || name.length < 2) msg.push('Name is missing');
    const raw = digits(get(r, m, 'phone'));
    const phone = raw ? normalizeIndianPhone(raw) : null;
    if (!raw) msg.push('Mobile number is missing'); else if (!phone) msg.push(`Mobile number ${raw} is not a valid Indian mobile number`);
    let skip = false;
    if (phone && staffPhones.has(phone)) skip = true;
    if (phone && seen.has(phone)) msg.push(`Same mobile number as row ${seen.get(phone)}`);
    if (phone) seen.set(phone, row);
    const rolesText = text(get(r, m, 'roles'));
    const roles: Role[] = [];
    for (const part of (rolesText ?? '').split(/[,/&+]| and /i).map((x) => x.trim()).filter(Boolean)) {
      const role = roleWords.get(norm(part)) ?? (/teach/i.test(part) ? 'teacher' : undefined);
      if (!role) msg.push(`Role “${part}” not understood (use Teacher, Office Admin or Accountant)`);
      else if (!canAssignRole(c.roles, role)) msg.push(`You cannot give the ${ROLE_LABELS[role]} role`);
      else if (!roles.includes(role)) roles.push(role);
    }
    if (!roles.length && !msg.some((x) => x.startsWith('Role'))) roles.push('teacher');
    return {
      row, status: skip ? 'skip' as const : msg.length ? 'error' as const : 'ok' as const,
      messages: skip ? [`Already on the staff list (${staffPhones.get(phone!)}), skipped`] : msg,
      show: { name, phone: phone ? phone.replace('+91', '') : raw, roles: roles.map((x) => ROLE_LABELS[x]).join(', ') || null, designation: text(get(r, m, 'designation')) },
      data: msg.length || skip ? undefined : { name: name!, phone: phone!, roles, designation: text(get(r, m, 'designation')), employeeCode: text(get(r, m, 'employeeCode')) } as StaffRow,
    };
  });
}

async function applyStaff(c: Ctx, rows: StaffRow[]) {
  const created: { membershipId: string; newMembership: boolean; roles: Role[] }[] = [];
  for (const s of rows) {
    const account = (await c.tx.query<{ id: string }>(
      `INSERT INTO accounts (phone, name) VALUES ($1, $2) ON CONFLICT (phone) DO UPDATE SET phone = excluded.phone RETURNING id`, [s.phone, s.name])).rows[0]!;
    let m = (await c.tx.query<{ id: string }>('SELECT id FROM memberships WHERE account_id = $1 AND school_id = $2', [account.id, c.schoolId])).rows[0];
    const isNew = !m;
    if (!m) {
      m = (await c.tx.query<{ id: string }>(
        `INSERT INTO memberships (school_id, account_id, display_name, designation, employee_code) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [c.schoolId, account.id, s.name, s.designation, s.employeeCode])).rows[0]!;
    }
    const added: Role[] = [];
    for (const r of s.roles) {
      const ins = await c.tx.query(`INSERT INTO membership_roles (school_id, membership_id, role, assigned_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [c.schoolId, m.id, r, c.accountId]);
      if (ins.rowCount) added.push(r);
    }
    created.push({ membershipId: m.id, newMembership: isNew, roles: added });
  }
  return created;
}

// ===================== Marks =====================

export async function marksSetup(tx: Tx, examId: string, sectionId: string) {
  const exam = (await tx.query<{ id: string; name: string; max: string; locked: boolean; term: string; class_ids: string[] }>(
    `SELECT x.id, x.name, x.default_max_marks AS max, x.marks_locked AS locked, t.name AS term, x.class_ids
       FROM exams x JOIN terms t ON t.id = x.term_id WHERE x.id = $1`, [examId])).rows[0];
  if (!exam) throw badRequest('no_exam', 'Choose the exam');
  const sec = (await tx.query<{ class_id: string; class_name: string; name: string; style: string }>(
    `SELECT s.class_id, c.name AS class_name, s.name, c.assessment_style AS style FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.id = $1`, [sectionId])).rows[0];
  if (!sec) throw badRequest('no_section', 'Choose the class and section');
  if (exam.class_ids.length && !exam.class_ids.includes(sec.class_id)) throw badRequest('wrong_class', `${exam.name} is not held for Class ${sec.class_name}`);
  const subjects = (await tx.query<{ id: string; name: string }>(
    `SELECT sub.id, sub.name FROM class_subjects cs JOIN subjects sub ON sub.id = cs.subject_id WHERE cs.class_id = $1 ORDER BY cs.sort_order, sub.name`, [sec.class_id])).rows;
  const students = (await tx.query<{ id: string; name: string; admission_no: string; roll_no: number | null }>(
    `SELECT st.id, st.first_name || coalesce(' ' || st.last_name, '') AS name, st.admission_no, e.roll_no
       FROM enrollments e JOIN students st ON st.id = e.student_id AND st.status = 'active'
      WHERE e.section_id = $1 ORDER BY e.roll_no NULLS LAST, st.first_name`, [sectionId])).rows;
  return { exam: { ...exam, max: Number(exam.max) }, section: sec, subjects, students, gradesOnly: sec.style === 'grades_only' };
}

export function marksFields(subjects: { id: string; name: string }[], max: number): Field[] {
  return [
    { key: 'admissionNo', label: 'Admission number', words: ['admission no', 'adm no', 'admission number', 'adm'] },
    { key: 'rollNo', label: 'Roll number', words: ['roll no', 'roll', 'roll number'] },
    { key: 'name', label: 'Student name', words: ['name', 'student name', 'student'] },
    ...subjects.map((s) => ({ key: `sub:${s.id}`, label: `${s.name} (out of ${max})`, words: [s.name] })),
  ];
}

interface MarkRow { studentId: string; subjectId: string; marks: number | null; grade: string | null; absent: boolean }

async function checkMarks(c: Ctx, sheet: Sheet, m: Record<string, number | null>, p: { examId: string; sectionId: string }) {
  const s = await marksSetup(c.tx, p.examId, p.sectionId);
  if (s.exam.locked) throw badRequest('locked', `Marks for ${s.exam.name} are locked. Unlock them in Exams first.`);
  if (m.admissionNo == null && m.rollNo == null && m.name == null) throw badRequest('need_id', 'Choose the column with the admission number, roll number or name');
  const subCols = s.subjects.filter((x) => m[`sub:${x.id}`] != null);
  if (!subCols.length) throw badRequest('need_subject', 'Choose at least one subject column');
  const seen = new Set<string>();
  return sheet.rows.map((r, i) => {
    const row = sheet.rowNumbers[i]!;
    const msg: string[] = [];
    const adm = text(get(r, m, 'admissionNo')), roll = int(get(r, m, 'rollNo')), nm = text(get(r, m, 'name'));
    const st = (adm && s.students.find((x) => x.admission_no.toLowerCase() === adm.toLowerCase()))
      || (roll != null && s.students.find((x) => x.roll_no === roll))
      || (nm && s.students.filter((x) => x.name.toLowerCase() === nm.toLowerCase()).length === 1 && s.students.find((x) => x.name.toLowerCase() === nm.toLowerCase()))
      || null;
    if (!st) msg.push(`No student ${adm ?? (roll != null ? `with roll ${roll}` : nm ?? '')} in Class ${s.section.class_name} ${s.section.name}`);
    else if (seen.has(st.id)) msg.push(`${st.name} appears twice in the file`);
    if (st) seen.add(st.id);
    const marks: MarkRow[] = [];
    const show: Record<string, string | null> = { name: st?.name ?? nm ?? adm ?? null };
    for (const sub of subCols) {
      const v = get(r, m, `sub:${sub.id}`);
      const t = text(v);
      show[sub.name] = t;
      if (t === null) continue;
      if (/^(ab|a|abs|absent)$/i.test(t)) { if (st) marks.push({ studentId: st.id, subjectId: sub.id, marks: null, grade: null, absent: true }); continue; }
      if (s.gradesOnly) { if (st) marks.push({ studentId: st.id, subjectId: sub.id, marks: null, grade: t.toUpperCase(), absent: false }); continue; }
      const n = typeof v === 'number' ? v : Number(t);
      if (!Number.isFinite(n) || n < 0) msg.push(`${sub.name}: “${t}” is not a number (write AB for absent)`);
      else if (n > s.exam.max) msg.push(`${sub.name}: ${n} is more than ${s.exam.max}`);
      else if (st) marks.push({ studentId: st.id, subjectId: sub.id, marks: Math.round(n * 100) / 100, grade: null, absent: false });
    }
    if (!msg.length && !marks.length) return { row, status: 'skip' as const, messages: ['No marks on this row'], show };
    return { row, status: msg.length ? 'error' as const : 'ok' as const, messages: msg, show, data: msg.length ? undefined : marks };
  });
}

async function applyMarks(c: Ctx, rows: MarkRow[][], p: { examId: string }) {
  const max = Number((await c.tx.query<{ max: string }>('SELECT default_max_marks AS max FROM exams WHERE id = $1', [p.examId])).rows[0]!.max);
  const before: { studentId: string; subjectId: string; prev: { marks: string | null; grade: string | null; absent: boolean; max: string | null } | null }[] = [];
  for (const m of rows.flat()) {
    const prev = (await c.tx.query<{ marks: string | null; grade: string | null; absent: boolean; max: string | null }>(
      'SELECT marks_obtained AS marks, grade, is_absent AS absent, max_marks AS max FROM marks WHERE exam_id = $1 AND student_id = $2 AND subject_id = $3',
      [p.examId, m.studentId, m.subjectId])).rows[0] ?? null;
    before.push({ studentId: m.studentId, subjectId: m.subjectId, prev });
    await c.tx.query(
      `INSERT INTO marks (school_id, exam_id, student_id, subject_id, marks_obtained, max_marks, grade, is_absent, entered_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (exam_id, student_id, subject_id) DO UPDATE SET marks_obtained = excluded.marks_obtained, max_marks = excluded.max_marks,
         grade = excluded.grade, is_absent = excluded.is_absent, entered_by = excluded.entered_by, entered_at = now()`,
      [c.schoolId, p.examId, m.studentId, m.subjectId, m.marks, m.grade ? null : max, m.grade, m.absent, c.accountId]);
  }
  return { examId: p.examId, before };
}

// ===================== Entry points =====================

export async function check(c: Ctx, kind: Kind, sheet: Sheet, mapping: Record<string, number | null>, p: { skipExisting?: boolean; examId?: string; sectionId?: string }) {
  const rows = kind === 'students' ? await checkStudents(c, sheet, mapping, { skipExisting: p.skipExisting ?? true })
    : kind === 'staff' ? await checkStaff(c, sheet, mapping)
      : await checkMarks(c, sheet, mapping, { examId: p.examId!, sectionId: p.sectionId! });
  return rows;
}

export async function apply(c: Ctx, kind: Kind, rows: Awaited<ReturnType<typeof check>>, p: { examId?: string }) {
  const good = rows.filter((r) => r.status === 'ok' && 'data' in r && r.data).map((r) => (r as { data: unknown }).data);
  if (kind === 'students') return applyStudents(c, good as StudentRow[]);
  if (kind === 'staff') return { staff: await applyStaff(c, good as StaffRow[]) };
  return applyMarks(c, good as MarkRow[][], { examId: p.examId! });
}

/** Undo an import: remove what it created, or put marks back as they were. */
export async function undo(tx: Tx, kind: Kind, details: Record<string, unknown>) {
  if (kind === 'students') {
    const d = details as { students: string[]; families: string[] };
    const used = (await tx.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM attendance_marks WHERE student_id = ANY($1)) + (SELECT count(*) FROM marks WHERE student_id = ANY($1))
            + (SELECT count(*) FROM receipts WHERE student_id = ANY($1)) + (SELECT count(*) FROM student_documents WHERE student_id = ANY($1))
            + (SELECT count(*) FROM certificates WHERE student_id = ANY($1)) AS n`, [d.students])).rows[0]!.n;
    if (Number(used) > 0) throw badRequest('in_use', 'These students already have attendance, marks, fees or documents, so the import can no longer be undone. Edit or mark them as left instead.');
    await tx.query('DELETE FROM fee_dues WHERE student_id = ANY($1)', [d.students]);
    await tx.query('DELETE FROM enrollments WHERE student_id = ANY($1)', [d.students]);
    await tx.query('DELETE FROM student_photos WHERE student_id = ANY($1)', [d.students]);
    await tx.query('DELETE FROM students WHERE id = ANY($1)', [d.students]);
    await tx.query(`DELETE FROM families f WHERE f.id = ANY($1) AND f.account_id IS NULL AND NOT EXISTS (SELECT 1 FROM students s WHERE s.family_id = f.id)`, [d.families]);
    return { removed: d.students.length };
  }
  if (kind === 'staff') {
    const d = details as { staff: { membershipId: string; newMembership: boolean; roles: Role[] }[] };
    try {
      await tx.query('SAVEPOINT undo_staff');
      for (const s of d.staff) {
        await tx.query('DELETE FROM membership_roles WHERE membership_id = $1 AND role = ANY($2)', [s.membershipId, s.roles]);
        if (s.newMembership) {
          await tx.query('DELETE FROM membership_permissions WHERE membership_id = $1', [s.membershipId]);
          await tx.query('DELETE FROM memberships WHERE id = $1', [s.membershipId]);
        }
      }
    } catch {
      await tx.query('ROLLBACK TO SAVEPOINT undo_staff');
      throw badRequest('in_use', 'Some of these staff are already in use (classes, timetable or attendance), so the import can no longer be undone. Mark them inactive instead.');
    }
    return { removed: d.staff.length };
  }
  const d = details as { examId: string; before: { studentId: string; subjectId: string; prev: { marks: string | null; grade: string | null; absent: boolean; max: string | null } | null }[] };
  const locked = (await tx.query<{ l: boolean }>('SELECT marks_locked AS l FROM exams WHERE id = $1', [d.examId])).rows[0]?.l;
  if (locked) throw badRequest('locked', 'Marks for this exam are now locked, so the import can no longer be undone');
  for (const b of d.before) {
    if (!b.prev) await tx.query('DELETE FROM marks WHERE exam_id = $1 AND student_id = $2 AND subject_id = $3', [d.examId, b.studentId, b.subjectId]);
    else await tx.query('UPDATE marks SET marks_obtained = $4, grade = $5, is_absent = $6, max_marks = $7 WHERE exam_id = $1 AND student_id = $2 AND subject_id = $3',
      [d.examId, b.studentId, b.subjectId, b.prev.marks, b.prev.grade, b.prev.absent, b.prev.max]);
  }
  return { removed: d.before.length };
}
