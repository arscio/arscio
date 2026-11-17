// Fills an EMPTY database with two demo schools so the apps can be tried.
// Usage: pnpm --filter @arscio/api demo
//
// Logins it creates (all on the "console" OTP setting):
//   Owner / principal  Zahid   9876543210  Valley#2027
//   Teachers           Rina    9123456780  Rina#2027   (on leave today in the demo)
//                      Bikash  9123456781  Bikash#2027
//                      Tara    9123456782  Tara#2027
//   Parent             Imran   9876500011  Imran#2027  (children Arif, Sana, Zara)
import pg from 'pg';
import { createSchool } from '../platform/create-school.js';
import { hashPassword } from '../auth/passwords.js';

const db = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
await db.connect();
const q = async <T = { id: string }>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];
const one = async <T = { id: string }>(sql: string, args: unknown[] = []) => (await q<T>(sql, args))[0]!;

if ((await q('SELECT id FROM schools')).length) {
  console.error('The database already has schools. The demo only fills an empty database.');
  process.exit(1);
}

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const yearName = (() => { const [y, m] = today.split('-').map(Number); const s = m! >= 4 ? y! : y! - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; })();
const startYear = Number(yearName.slice(0, 4));
const year = { name: yearName, startsOn: `${startYear}-04-01`, endsOn: `${startYear + 1}-03-31` };

async function setPassword(accountId: string, pw: string) {
  await db.query('UPDATE accounts SET password_hash = $2, password_set_at = now() WHERE id = $1', [accountId, await hashPassword(pw)]);
}
async function member(schoolId: string, phone: string, name: string, roles: string[], designation?: string) {
  const acc = await one(`INSERT INTO accounts (phone, name) VALUES ($1, $2) ON CONFLICT (phone) DO UPDATE SET name = accounts.name RETURNING id`, [phone, name]);
  const m = await one('INSERT INTO memberships (school_id, account_id, display_name, designation) VALUES ($1, $2, $3, $4) RETURNING id', [schoolId, acc.id, name, designation ?? null]);
  for (const r of roles) await db.query('INSERT INTO membership_roles (school_id, membership_id, role) VALUES ($1, $2, $3)', [schoolId, m.id, r]);
  return { accountId: acc.id, membershipId: m.id };
}

async function school(code: string, name: string, extra: { shortName: string; color: string; affiliation: string }) {
  const s = await createSchool(db, { code, name, ownerName: 'Zahid', ownerPhone: '+919876543210', receiptPrefix: code, academicYear: year });
  await db.query('UPDATE schools SET short_name = $2, brand_color = $3, affiliation_no = $4 WHERE id = $1', [s.schoolId, extra.shortName, extra.color, extra.affiliation]);
  await setPassword(s.ownerAccountId, 'Valley#2027');
  const yearId = (await one('SELECT id FROM academic_years WHERE school_id = $1', [s.schoolId])).id;
  return { ...s, yearId };
}
async function section(sc: { schoolId: string; yearId: string }, className: string, sectionName: string, classTeacher?: string) {
  const cls = await one('SELECT id FROM classes WHERE school_id = $1 AND name = $2', [sc.schoolId, className]);
  const sec = await one('INSERT INTO sections (school_id, academic_year_id, class_id, name, class_teacher_membership) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [sc.schoolId, sc.yearId, cls.id, sectionName, classTeacher ?? null]);
  return { classId: cls.id, sectionId: sec.id };
}
async function student(sc: { schoolId: string; yearId: string }, familyId: string, sectionId: string, admissionNo: string, first: string, last: string, roll: number) {
  const st = await one('INSERT INTO students (school_id, family_id, admission_no, first_name, last_name, admission_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [sc.schoolId, familyId, admissionNo, first, last, `${admissionNo.split('/')[1] ?? startYear}-04-01`]);
  await db.query('INSERT INTO enrollments (school_id, student_id, academic_year_id, section_id, roll_no) VALUES ($1, $2, $3, $4, $5)', [sc.schoolId, st.id, sc.yearId, sectionId, roll]);
  return st.id;
}
async function fees(sc: { schoolId: string; yearId: string }, studentId: string, lines: [string, number][], instalment: string, dueOn: string) {
  const inst = await one(`INSERT INTO fee_instalments (school_id, academic_year_id, name, due_on, fine_type, fine_amount, fine_cap)
    VALUES ($1, $2, $3, $4, 'per_day', 10, 200) ON CONFLICT (academic_year_id, name) DO UPDATE SET name = excluded.name RETURNING id`, [sc.schoolId, sc.yearId, instalment, dueOn]);
  for (const [head, amount] of lines) {
    const h = await one(`INSERT INTO fee_heads (school_id, name) VALUES ($1, $2) ON CONFLICT (school_id, name) DO UPDATE SET name = excluded.name RETURNING id`, [sc.schoolId, head]);
    await db.query('INSERT INTO fee_dues (school_id, student_id, academic_year_id, instalment_id, fee_head_id, amount) VALUES ($1, $2, $3, $4, $5, $6)',
      [sc.schoolId, studentId, sc.yearId, inst.id, h.id, amount]);
  }
}

// ---- Green Valley Public School ----
const gv = await school('GV', 'Green Valley Public School', { shortName: 'GV', color: '#0B7FA6', affiliation: '2030456' });
const rina = await member(gv.schoolId, '+919123456780', 'Rina Das', ['teacher'], 'Teacher');
await setPassword(rina.accountId, 'Rina#2027');
const s6a = await section(gv, '6', 'A', rina.membershipId);
const s4b = await section(gv, '4', 'B');
const maths = await one(`INSERT INTO subjects (school_id, name) VALUES ($1, 'Mathematics') RETURNING id`, [gv.schoolId]);
const english = await one(`INSERT INTO subjects (school_id, name) VALUES ($1, 'English') RETURNING id`, [gv.schoolId]);
for (const [i, sub] of [maths, english].entries()) {
  for (const c of [s6a.classId, s4b.classId]) await db.query('INSERT INTO class_subjects (school_id, class_id, subject_id, sort_order) VALUES ($1, $2, $3, $4)', [gv.schoolId, c, sub.id, i]);
}
await db.query('INSERT INTO section_teachers (school_id, section_id, subject_id, membership_id) VALUES ($1, $2, $3, $4)', [gv.schoolId, s6a.sectionId, maths.id, rina.membershipId]);

const imran = await member(gv.schoolId, '+919876500011', 'Imran Hussain', ['parent']);
await setPassword(imran.accountId, 'Imran#2027');
const famGv = await one('INSERT INTO families (school_id, phone, account_id, father_name) VALUES ($1, $2, $3, $4) RETURNING id', [gv.schoolId, '+919876500011', imran.accountId, 'Imran Hussain']);
const arif = await student(gv, famGv.id, s6a.sectionId, 'GV/2021/0187', 'Arif', 'Hussain', 7);
const sana = await student(gv, famGv.id, s4b.sectionId, 'GV/2023/0241', 'Sana', 'Hussain', 3);
const classmates: [string, string, number][] = [['Aanya', 'Bora', 5], ['Bikash', 'Das', 9], ['Dipika', 'Kalita', 11], ['Faizal', 'Ahmed', 14], ['Ishita', 'Roy', 16], ['Kabir', 'Sharma', 18]];
const others: string[] = [];
for (const [i, [f, l, r]] of classmates.entries()) {
  const fam = await one('INSERT INTO families (school_id, phone, father_name) VALUES ($1, $2, $3) RETURNING id', [gv.schoolId, `+91987650${String(100 + i).padStart(4, '0')}`, `${l} family`]);
  others.push(await student(gv, fam.id, s6a.sectionId, `GV/2021/${String(150 + i).padStart(4, '0')}`, f, l, r));
}

// Term 1 fees: everyone in 6 A paid between June and October (so the 6-month chart has history);
// Kabir still owes, so he shows up as overdue.
const t1Inst = await one(`INSERT INTO fee_instalments (school_id, academic_year_id, name, due_on, fine_type, fine_amount, fine_cap)
  VALUES ($1, $2, 'Term 1', $3, 'per_day', 10, 200) RETURNING id`, [gv.schoolId, gv.yearId, `${startYear}-07-15`]);
const tuition = await one(`INSERT INTO fee_heads (school_id, name) VALUES ($1, 'Tuition fee') RETURNING id`, [gv.schoolId]);
const payDays = [`${startYear}-06-12`, `${startYear}-07-03`, `${startYear}-07-10`, `${startYear}-08-05`, `${startYear}-09-14`, `${startYear}-10-08`];
let receiptNo = 1;
for (const [i, id] of [arif, ...others].entries()) {
  const due = await one(`INSERT INTO fee_dues (school_id, student_id, academic_year_id, instalment_id, fee_head_id, amount)
    VALUES ($1, $2, $3, $4, $5, 12000) RETURNING id`, [gv.schoolId, id, gv.yearId, t1Inst.id, tuition.id]);
  if (i === 6) continue; // Kabir hasn't paid Term 1
  const paidOn = payDays[i % payDays.length]!;
  const r = await one(`INSERT INTO receipts (school_id, academic_year_id, receipt_no, student_id, paid_on, total_amount, mode, collected_by)
    VALUES ($1, $2, $3, $4, $5, 12000, $6, $7) RETURNING id`,
    [gv.schoolId, gv.yearId, `GV/${yearName}/${paidOn.slice(5, 7)}/${String(receiptNo++).padStart(4, '0')}`, id, paidOn, i % 2 ? 'upi' : 'cash', gv.ownerAccountId]);
  await db.query(`INSERT INTO receipt_lines (school_id, receipt_id, fee_due_id, description, amount, fine) VALUES ($1, $2, $3, 'Tuition fee - Term 1', 12000, 0)`,
    [gv.schoolId, r.id, due.id]);
}
await db.query(`INSERT INTO receipt_counters (school_id, academic_year_id, next_no) VALUES ($1, $2, $3)`, [gv.schoolId, gv.yearId, receiptNo]);

const term = `${startYear}-11-15`;
await fees(gv, arif, [['Tuition fee', 12000], ['Computer lab', 1500], ['Sports and activities', 1000]], 'Term 2', term);
await fees(gv, sana, [['Tuition fee', 9800]], 'Term 2', term);

// This month's attendance for 6 A: Arif absent once, present otherwise (today included).
const monthStart = `${today.slice(0, 8)}01`;
for (let d = new Date(`${monthStart}T00:00:00Z`); d.toISOString().slice(0, 10) <= today; d.setUTCDate(d.getUTCDate() + 1)) {
  if (d.getUTCDay() === 0) continue;
  const on = d.toISOString().slice(0, 10);
  const ses = await one('INSERT INTO attendance_sessions (school_id, section_id, on_date, period_no, taken_by) VALUES ($1, $2, $3, 0, $4) RETURNING id', [gv.schoolId, s6a.sectionId, on, rina.accountId]);
  await db.query('INSERT INTO attendance_marks (school_id, session_id, student_id, status) VALUES ($1, $2, $3, $4)', [gv.schoolId, ses.id, arif, on === `${today.slice(0, 8)}04` ? 'absent' : 'present']);
  for (const o of others) await db.query("INSERT INTO attendance_marks (school_id, session_id, student_id, status) VALUES ($1, $2, $3, 'present')", [gv.schoolId, ses.id, o]);
}

await db.query(`INSERT INTO homework (school_id, section_id, subject_id, title, due_on, created_by) VALUES
  ($1, $2, $3, 'Fractions, exercise 4.2', $5, $6), ($1, $2, $4, 'Write a letter to a friend', $5, $6)`,
  [gv.schoolId, s6a.sectionId, maths.id, english.id, today, rina.accountId]);
await db.query(`INSERT INTO notices (school_id, title, body, audience, created_by, published_at) VALUES
  ($1, 'Annual sports day on 21 November', 'All students should come in sports uniform. Parents are welcome.', 'everyone', $2, now())`,
  [gv.schoolId, gv.ownerAccountId]);

// Exams: Term 1 (results published) and Term 2 (Periodic Test 2 still to be marked).
const t1 = await one(`INSERT INTO terms (school_id, academic_year_id, name, sort_order, published_at, published_by)
  VALUES ($1, $2, 'Term 1', 1, now(), $3) RETURNING id`, [gv.schoolId, gv.yearId, gv.ownerAccountId]);
const t2 = await one(`INSERT INTO terms (school_id, academic_year_id, name, sort_order) VALUES ($1, $2, 'Term 2', 2) RETURNING id`, [gv.schoolId, gv.yearId]);
const exam = (term: string, name: string, max: number, w: number, order: number, on: string) => one(
  `INSERT INTO exams (school_id, term_id, name, default_max_marks, weightage_pct, sort_order, starts_on) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
  [gv.schoolId, term, name, max, w, order, on]);
const pt1 = await exam(t1.id, 'Periodic Test 1', 20, 20, 1, `${startYear}-07-14`);
const hy = await exam(t1.id, 'Half Yearly', 80, 80, 2, `${startYear}-09-22`);
await exam(t2.id, 'Periodic Test 2', 20, 20, 1, `${startYear}-11-23`);
await exam(t2.id, 'Annual Exam', 80, 80, 2, `${startYear + 1}-02-20`);
const roster = [arif, ...others];
const scores: Record<string, [number, number, number, number]> = {}; // pt1 maths, hy maths, pt1 english, hy english
const base = [[18, 62, 16, 66], [17, 70, 18, 72], [12, 48, 14, 55], [19, 75, 17, 68], [15, 58, 13, 50], [20, 78, 19, 74], [9, 30, 11, 41]];
roster.forEach((id, i) => { scores[id] = base[i % base.length] as [number, number, number, number]; });
for (const id of roster) {
  const [a, b, c, d] = scores[id]!;
  for (const [ex, sub, m, max] of [[pt1.id, maths.id, a, 20], [hy.id, maths.id, b, 80], [pt1.id, english.id, c, 20], [hy.id, english.id, d, 80]] as const) {
    await db.query(`INSERT INTO marks (school_id, exam_id, student_id, subject_id, marks_obtained, max_marks, entered_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [gv.schoolId, ex, id, sub, m, max, rina.accountId]);
  }
}
await db.query(`INSERT INTO report_remarks (school_id, term_id, student_id, remark, written_by) VALUES ($1, $2, $3, $4, $5)`,
  [gv.schoolId, t1.id, arif, 'Arif is attentive and helps his classmates. Keep practising fractions.', rina.accountId]);

// Timetable: 6 periods, Monday to Saturday, three teachers.
const bikash = await member(gv.schoolId, '+919123456781', 'Bikash Roy', ['teacher'], 'Teacher');
await setPassword(bikash.accountId, 'Bikash#2027');
const tara = await member(gv.schoolId, '+919123456782', 'Tara Devi', ['teacher'], 'Librarian');
await setPassword(tara.accountId, 'Tara#2027');
await db.query('UPDATE sections SET class_teacher_membership = $1 WHERE id = $2', [bikash.membershipId, s4b.sectionId]);
await db.query('INSERT INTO section_teachers (school_id, section_id, subject_id, membership_id) VALUES ($1, $2, $3, $4), ($1, $5, $3, $4), ($1, $5, $6, $7)',
  [gv.schoolId, s6a.sectionId, english.id, bikash.membershipId, s4b.sectionId, maths.id, rina.membershipId]);
await db.query('UPDATE schools SET periods_per_day = 6 WHERE id = $1', [gv.schoolId]);
const bells = [['09:00', '09:40'], ['09:40', '10:20'], ['10:20', '11:00'], ['11:20', '12:00'], ['12:00', '12:40'], ['13:20', '14:00']];
for (const [i, [a, b]] of bells.entries()) await db.query('INSERT INTO period_times (school_id, period_no, starts_at, ends_at) VALUES ($1, $2, $3, $4)', [gv.schoolId, i + 1, a, b]);
const plan: [string, number, string | null, string][] = [
  [s6a.sectionId, 1, maths.id, rina.membershipId], [s6a.sectionId, 2, english.id, bikash.membershipId], [s6a.sectionId, 3, null, tara.membershipId],
  [s6a.sectionId, 4, maths.id, rina.membershipId], [s6a.sectionId, 5, english.id, bikash.membershipId], [s6a.sectionId, 6, null, tara.membershipId],
  [s4b.sectionId, 1, english.id, bikash.membershipId], [s4b.sectionId, 2, maths.id, rina.membershipId], [s4b.sectionId, 3, english.id, bikash.membershipId],
  [s4b.sectionId, 4, null, tara.membershipId], [s4b.sectionId, 5, maths.id, rina.membershipId],
];
for (let day = 1; day <= 6; day++) {
  for (const [sec, p, sub, who] of plan) {
    await db.query(`INSERT INTO timetable_slots (school_id, academic_year_id, section_id, day_no, period_no, subject_id, membership_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [gv.schoolId, gv.yearId, sec, day, p, sub, who]);
  }
}
// Rina is on approved leave today (so the cover page has periods to fill); Bikash has asked for leave next week.
await db.query(`INSERT INTO teacher_leaves (school_id, membership_id, from_date, to_date, part, reason, status, decided_by, decided_at)
  VALUES ($1, $2, $3, $3, 'full', 'Fever', 'approved', $4, now())`, [gv.schoolId, rina.membershipId, today, gv.ownerAccountId]);
const nextWeek = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
await db.query(`INSERT INTO teacher_leaves (school_id, membership_id, from_date, to_date, part, reason) VALUES ($1, $2, $3, $3, 'first_half', 'Bank work')`,
  [gv.schoolId, bikash.membershipId, nextWeek]);

// ---- Brahmaputra Valley Academy (a second school for the same parent) ----
const bva = await school('BVA', 'Brahmaputra Valley Academy', { shortName: 'BVA', color: '#22B3C4', affiliation: '2030789' });
const s2a = await section(bva, '2', 'A');
const imranBva = await member(bva.schoolId, '+919876500011', 'Imran Hussain', ['parent']);
const famBva = await one('INSERT INTO families (school_id, phone, account_id, father_name) VALUES ($1, $2, $3, $4) RETURNING id', [bva.schoolId, '+919876500011', imranBva.accountId, 'Imran Hussain']);
await student(bva, famBva.id, s2a.sectionId, 'BVA/2025/0032', 'Zara', 'Hussain', 4);

await db.end();
console.log(`Demo ready for ${yearName}: Green Valley Public School and Brahmaputra Valley Academy.`);
console.log('Owner 9876543210 / Valley#2027 · Teachers 9123456780 / Rina#2027, 9123456781 / Bikash#2027, 9123456782 / Tara#2027 · Parent 9876500011 / Imran#2027');
