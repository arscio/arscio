// A complete demo school for trying Arscio end to end, as a real school would use it.
// Usage:  pnpm demo:reset   (from the project folder; WIPES the local database first)
//
// Green Valley Public School, current year, Nursery to Class 10, one section each,
// 10 students per class (130 students), about 115 families, 26 staff.
// Two months of attendance, Term 1 fees mostly paid, Term 2 partly paid, Term 1 results
// published, timetable, homework, notices, leave and a teacher on leave on the next school day.
// Every login uses the same password: Demo#2027  (see docs/demo-guide.md for the list).
import pg from 'pg';
import { createSchool } from '../platform/create-school.js';
import { hashPassword } from '../auth/passwords.js';

const PASSWORD = process.env.DEMO_PASSWORD || 'Demo#2027'; // the test server sets its own
const db = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
await db.connect();
const q = async <T = { id: string }>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];
const one = async <T = { id: string }>(sql: string, args: unknown[] = []) => (await q<T>(sql, args))[0]!;

if ((await q('SELECT id FROM schools')).length) {
  console.error('The database already has schools. Run "pnpm demo:reset" to wipe it and build the demo.');
  process.exit(1);
}

// A fixed random sequence, so the demo is the same every time
let seed = 20271;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const yearName = (() => { const [y, m] = today.split('-').map(Number); const s = m! >= 4 ? y! : y! - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; })();
const Y = Number(yearName.slice(0, 4));
const year = { name: yearName, startsOn: `${Y}-04-01`, endsOn: `${Y + 1}-03-31` };
const HOLIDAYS = new Set([`${Y}-08-15`, `${Y}-10-02`, `${Y}-10-20`, `${Y}-10-21`]);
const isSchoolDay = (d: string) => dow(d) !== 0 && !HOLIDAYS.has(d);
const lastSchoolDay = (() => { let d = today; while (!isSchoolDay(d)) d = addDays(d, -1); return d; })();
const nextSchoolDay = (() => { let d = today; while (!isSchoolDay(d)) d = addDays(d, 1); return d; })();

const hashed = await hashPassword(PASSWORD);
async function account(phone: string, name: string) {
  const a = await one(`INSERT INTO accounts (phone, name, password_hash, password_set_at) VALUES ($1, $2, $3, now())
    ON CONFLICT (phone) DO UPDATE SET password_hash = excluded.password_hash RETURNING id`, [phone, name, hashed]);
  return a.id;
}
async function member(schoolId: string, phone: string, name: string, roles: string[], designation?: string, code?: string) {
  const accountId = await account(phone, name);
  const m = await one('INSERT INTO memberships (school_id, account_id, display_name, designation, employee_code) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [schoolId, accountId, name, designation ?? null, code ?? null]);
  for (const r of roles) await db.query('INSERT INTO membership_roles (school_id, membership_id, role) VALUES ($1, $2, $3)', [schoolId, m.id, r]);
  return { accountId, membershipId: m.id, name, phone };
}

// ======================= The school =======================
const s = await createSchool(db, { code: 'GV', name: 'Green Valley Public School', ownerName: 'Zahid', ownerPhone: '+919876543210', receiptPrefix: 'GV', academicYear: year });
const SID = s.schoolId;
await db.query(`UPDATE schools SET short_name = 'GVPS', brand_color = '#0B7FA6', affiliation_no = '2030456', periods_per_day = 6,
  address = 'College Road, Dhubri, Assam 783301', phone = '03662-230456', email = 'office@greenvalley.edu.in' WHERE id = $1`, [SID]);
await db.query('UPDATE accounts SET password_hash = $2, password_set_at = now() WHERE id = $1', [s.ownerAccountId, hashed]);
const yearId = (await one('SELECT id FROM academic_years WHERE school_id = $1', [SID])).id;
const ownerAcc = s.ownerAccountId;

// ---- Office staff ----
const principal = await member(SID, '+919000000001', 'Dr. Anjali Bora', ['principal'], 'Principal', 'P001');
const office = await member(SID, '+919000000002', 'Pranjal Deka', ['office_admin'], 'Office Superintendent', 'O001');
const accountant = await member(SID, '+919000000003', 'Ritu Agarwal', ['accountant'], 'Accountant', 'A001');
await db.query(`INSERT INTO membership_permissions (school_id, membership_id, permission, granted_by) VALUES ($1, $2, 'data.import_export', $3)`, [SID, office.membershipId, ownerAcc]);

// ---- Classes and subjects ----
const classes = await q<{ id: string; name: string; sort_order: number }>('SELECT id, name, sort_order FROM classes WHERE school_id = $1 ORDER BY sort_order', [SID]);
const PRE = ['Nursery', 'LKG', 'UKG'];
const SUBJECTS = {
  pre: ['English', 'Numbers', 'Environmental awareness', 'Drawing and craft'],
  primary: ['English', 'Hindi', 'Assamese', 'Mathematics', 'EVS'],
  secondary: ['English', 'Hindi', 'Assamese', 'Mathematics', 'Science', 'Social Science'],
};
const subjectId: Record<string, string> = {};
for (const n of [...new Set([...SUBJECTS.pre, ...SUBJECTS.primary, ...SUBJECTS.secondary])]) {
  subjectId[n] = (await one('INSERT INTO subjects (school_id, name) VALUES ($1, $2) RETURNING id', [SID, n])).id;
}
const groupOf = (c: string) => (PRE.includes(c) ? 'pre' : Number(c) <= 5 ? 'primary' : 'secondary') as 'pre' | 'primary' | 'secondary';
for (const c of classes) {
  for (const [i, n] of SUBJECTS[groupOf(c.name)].entries()) {
    await db.query('INSERT INTO class_subjects (school_id, class_id, subject_id, sort_order) VALUES ($1, $2, $3, $4)', [SID, c.id, subjectId[n], i]);
  }
}

// ---- Teachers: who teaches which subject in which classes ----
type T = { name: string; designation: string; teaches: [string, string[]][] };
const TEACHERS: T[] = [
  { name: 'Ruma Choudhury', designation: 'NTT', teaches: [['*', ['Nursery']]] },
  { name: 'Gitanjali Sarma', designation: 'NTT', teaches: [['*', ['LKG']]] },
  { name: 'Dipankar Nath', designation: 'NTT', teaches: [['*', ['UKG']]] },
  { name: 'Sabina Begum', designation: 'PRT English', teaches: [['English', ['1', '2', '3']]] },
  { name: 'Moitri Das', designation: 'PRT English', teaches: [['English', ['4', '5']], ['EVS', ['5']]] },
  { name: 'Pallavi Hazarika', designation: 'PRT Hindi', teaches: [['Hindi', ['1', '2', '3', '4', '5']]] },
  { name: 'Jyoti Bora', designation: 'PRT Assamese', teaches: [['Assamese', ['1', '2', '3', '4', '5']]] },
  { name: 'Anup Kalita', designation: 'PRT Mathematics', teaches: [['Mathematics', ['1', '2', '3']]] },
  { name: 'Rashmi Goswami', designation: 'PRT Mathematics', teaches: [['Mathematics', ['4', '5']], ['EVS', ['4']]] },
  { name: 'Nitumoni Deka', designation: 'PRT EVS', teaches: [['EVS', ['1', '2', '3']]] },
  { name: 'Rina Das', designation: 'TGT English', teaches: [['English', ['6', '7', '8']]] },
  { name: 'Farhan Ali', designation: 'TGT English', teaches: [['English', ['9', '10']]] },
  { name: 'Bikash Roy', designation: 'TGT Mathematics', teaches: [['Mathematics', ['6', '7', '8']]] },
  { name: 'Hemanta Baishya', designation: 'TGT Mathematics', teaches: [['Mathematics', ['9', '10']]] },
  { name: 'Tara Devi', designation: 'TGT Science', teaches: [['Science', ['6', '7', '8']]] },
  { name: 'Kaushik Medhi', designation: 'TGT Science', teaches: [['Science', ['9', '10']]] },
  { name: 'Mridul Saikia', designation: 'TGT Social Science', teaches: [['Social Science', ['6', '7', '8', '9', '10']]] },
  { name: 'Babita Thakuria', designation: 'TGT Hindi', teaches: [['Hindi', ['6', '7', '8', '9', '10']]] },
  { name: 'Lakhimi Gogoi', designation: 'TGT Assamese', teaches: [['Assamese', ['6', '7', '8', '9', '10']]] },
];
const teachers: (Awaited<ReturnType<typeof member>> & T)[] = [];
for (const [i, t] of TEACHERS.entries()) {
  const m = await member(SID, `+9191000000${String(i + 1).padStart(2, '0')}`, t.name, ['teacher'], t.designation, `T${String(i + 1).padStart(3, '0')}`);
  teachers.push({ ...m, ...t });
}
// One teacher also helps in the accounts office: one person, two roles
await db.query(`INSERT INTO membership_roles (school_id, membership_id, role) VALUES ($1, $2, 'accountant')`, [SID, teachers.find((t) => t.name === 'Hemanta Baishya')!.membershipId]);
const CLASS_TEACHER: Record<string, string> = {
  Nursery: 'Ruma Choudhury', LKG: 'Gitanjali Sarma', UKG: 'Dipankar Nath', 1: 'Sabina Begum', 2: 'Nitumoni Deka', 3: 'Anup Kalita', 4: 'Rashmi Goswami',
  5: 'Moitri Das', 6: 'Rina Das', 7: 'Bikash Roy', 8: 'Tara Devi', 9: 'Kaushik Medhi', 10: 'Farhan Ali',
};
const tByName = (n: string) => teachers.find((t) => t.name === n)!;

// ---- Sections (one per class) with class teachers and subject teachers ----
const sections: { id: string; classId: string; className: string; subjects: string[]; teacherOf: Record<string, string> }[] = [];
for (const c of classes) {
  const ct = tByName(CLASS_TEACHER[c.name]!);
  const sec = await one('INSERT INTO sections (school_id, academic_year_id, class_id, name, class_teacher_membership) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [SID, yearId, c.id, 'A', ct.membershipId]);
  const subs = SUBJECTS[groupOf(c.name)];
  const teacherOf: Record<string, string> = {};
  for (const sub of subs) {
    const t = teachers.find((x) => x.teaches.some(([s2, cls]) => (s2 === '*' || s2 === sub) && cls.includes(c.name)))!;
    teacherOf[sub] = t.membershipId;
    await db.query('INSERT INTO section_teachers (school_id, section_id, subject_id, membership_id) VALUES ($1, $2, $3, $4)', [SID, sec.id, subjectId[sub], t.membershipId]);
  }
  sections.push({ id: sec.id, classId: c.id, className: c.name, subjects: subs, teacherOf });
}

// ---- Timetable: 6 periods, Monday to Saturday, no teacher in two places at once ----
const bells = [['09:00', '09:40'], ['09:40', '10:20'], ['10:20', '11:00'], ['11:20', '12:00'], ['12:00', '12:40'], ['13:20', '14:00']];
for (const [i, [a, b]] of bells.entries()) await db.query('INSERT INTO period_times (school_id, period_no, starts_at, ends_at) VALUES ($1, $2, $3, $4)', [SID, i + 1, a, b]);
const quota = new Map<string, Map<string, number>>();
for (const sec of sections) quota.set(sec.id, new Map(sec.subjects.map((x) => [x, Math.floor(36 / sec.subjects.length)])));
for (let day = 1; day <= 6; day++) {
  for (let p = 1; p <= 6; p++) {
    const busy = new Set<string>();
    for (const sec of [...sections].sort(() => rnd() - 0.5)) {
      const left = quota.get(sec.id)!;
      const options = sec.subjects.filter((x) => (left.get(x) ?? 0) > 0 && !busy.has(sec.teacherOf[x]!))
        .sort((a, b) => left.get(b)! - left.get(a)! || rnd() - 0.5);
      const sub = options[0];
      if (!sub) {
        await db.query(`INSERT INTO timetable_slots (school_id, academic_year_id, section_id, day_no, period_no, subject_id, membership_id) VALUES ($1, $2, $3, $4, $5, NULL, NULL)`, [SID, yearId, sec.id, day, p]);
        continue;
      }
      busy.add(sec.teacherOf[sub]!);
      left.set(sub, left.get(sub)! - 1);
      await db.query(`INSERT INTO timetable_slots (school_id, academic_year_id, section_id, day_no, period_no, subject_id, membership_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [SID, yearId, sec.id, day, p, subjectId[sub], sec.teacherOf[sub]]);
    }
  }
}

// ======================= Students and families =======================
const BOYS = ['Arif', 'Rohan', 'Ankur', 'Manash', 'Rahul', 'Kabir', 'Faizal', 'Bikash', 'Nayan', 'Dhruv', 'Abhijit', 'Rituraj', 'Sahil', 'Imdad', 'Pritam', 'Jahnu', 'Arnav', 'Ayaan', 'Bhaskar', 'Debojit', 'Hiranya', 'Kunal', 'Mrinal', 'Nabajit', 'Partha', 'Rajdeep', 'Sourav', 'Tanmoy', 'Udayan', 'Zubair'];
const GIRLS = ['Sana', 'Priya', 'Nasrin', 'Aanya', 'Dipika', 'Ishita', 'Riya', 'Sneha', 'Ananya', 'Barsha', 'Chayanika', 'Deepshikha', 'Gargi', 'Himakshi', 'Jinia', 'Kasturi', 'Lipika', 'Mausumi', 'Nandini', 'Pori', 'Rimjhim', 'Sabnam', 'Trishna', 'Upasana', 'Zara', 'Ayesha', 'Bonya', 'Puja', 'Tanya', 'Rukhsana'];
const SURNAMES = ['Bora', 'Das', 'Kalita', 'Ahmed', 'Roy', 'Sharma', 'Baruah', 'Deka', 'Saikia', 'Gogoi', 'Hazarika', 'Nath', 'Choudhury', 'Ali', 'Sarma', 'Medhi', 'Talukdar', 'Rahman', 'Bhuyan', 'Phukan', 'Barman', 'Sinha', 'Paul', 'Islam'];
const FATHERS = ['Dilip', 'Jiten', 'Gopal', 'Amit', 'Rakesh', 'Pankaj', 'Hemen', 'Bipul', 'Dhiren', 'Gautam', 'Jayanta', 'Kamal', 'Nirmal', 'Pradip', 'Sanjib', 'Tapan', 'Utpal', 'Mukul'];
const MOTHERS = ['Mousumi', 'Salma', 'Rita', 'Anjali', 'Bina', 'Dipali', 'Gita', 'Junmoni', 'Karabi', 'Lily', 'Mamoni', 'Nilima', 'Purnima', 'Rumi', 'Seema', 'Tultul'];
const PLACES = ['Ward 1', 'Ward 3', 'Ward 5', 'Bidyapara', 'College Road', 'Chandni Chowk', 'Gauripur', 'Kalurghat', 'Bilasipara Road', 'Netai Dhubuni Ghat'];
const BLOOD = ['A+', 'B+', 'O+', 'AB+', 'O-', null];
const MUSLIM = new Set(['Ahmed', 'Ali', 'Rahman', 'Islam', 'Hussain']);

interface Fam { id: string; phone: string; surname: string; father: string; accountId: string }
const families: Fam[] = [];
async function newFamily(surname: string, phone?: string, fatherFirst?: string): Promise<Fam> {
  const n = families.length + 1;
  const ph = phone ?? `+919800${String(100000 + n * 37).slice(-6)}`;
  const father = `${fatherFirst ?? pick(MUSLIM.has(surname) ? ['Abdul', 'Rafiqul', 'Imran', 'Nurul', 'Shahjahan'] : FATHERS)} ${surname === 'Begum' ? 'Ali' : surname}`;
  const mother = `${pick(MUSLIM.has(surname) ? ['Salma', 'Rehana', 'Nasima', 'Farida'] : MOTHERS)} ${MUSLIM.has(surname) ? 'Begum' : surname}`;
  const accountId = await account(ph, father);
  const m = await one('INSERT INTO memberships (school_id, account_id, display_name) VALUES ($1, $2, $3) RETURNING id', [SID, accountId, father]);
  await db.query(`INSERT INTO membership_roles (school_id, membership_id, role) VALUES ($1, $2, 'parent')`, [SID, m.id]);
  const f = await one(`INSERT INTO families (school_id, phone, account_id, father_name, mother_name, address, alt_phone)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [SID, ph, accountId, father, mother, `${pick(PLACES)}, Dhubri, Assam`, rnd() < 0.4 ? `+919700${String(200000 + n * 53).slice(-6)}` : null]);
  const fam = { id: f.id, phone: ph, surname, father, accountId };
  families.push(fam);
  return fam;
}

// The featured family: Imran Hussain, two children here (and one in a second school, below)
const imran = await newFamily('Hussain', '+919876500011', 'Imran');
await db.query(`UPDATE families SET mother_name = 'Rehana Begum', address = 'Ward 5, College Road, Dhubri, Assam' WHERE id = $1`, [imran.id]);
await db.query('UPDATE accounts SET name = $2 WHERE id = $1', [imran.accountId, 'Imran Hussain']);

const students: { id: string; name: string; sectionId: string; classId: string; className: string; group: string; ability: number; family: Fam }[] = [];
const admCounter: Record<number, number> = {};
let used = new Set<string>();
for (const sec of sections) {
  const cls = classes.find((c) => c.id === sec.classId)!;
  const joinYear = Math.max(Y - (cls.sort_order - 1), Y - 9);
  const kids: { first: string; last: string; gender: 'male' | 'female'; fam: Fam }[] = [];
  if (sec.className === '6') kids.push({ first: 'Arif', last: 'Hussain', gender: 'male', fam: imran });
  if (sec.className === '4') kids.push({ first: 'Sana', last: 'Hussain', gender: 'female', fam: imran });
  while (kids.length < 10) {
    const girl = rnd() < 0.5;
    const first = pick(girl ? GIRLS : BOYS);
    // About one child in eight has a brother or sister in another class (same family, same mobile)
    const sibling = rnd() < 0.13 && families.length > 4 ? pick(families.filter((f) => f !== imran)) : null;
    const last = sibling ? sibling.surname : pick(SURNAMES);
    const surname = girl && MUSLIM.has(last) && last !== 'Begum' ? last : last === 'Begum' ? 'Ali' : last;
    if (used.has(`${first} ${surname}`)) continue;
    used.add(`${first} ${surname}`);
    kids.push({ first, last: surname, gender: girl ? 'female' : 'male', fam: sibling ?? await newFamily(surname) });
  }
  kids.sort((a, b) => `${a.first} ${a.last}`.localeCompare(`${b.first} ${b.last}`));
  for (const [i, k] of kids.entries()) {
    const jy = k.first === 'Arif' && k.last === 'Hussain' ? Y - 5 : joinYear - (rnd() < 0.3 ? 0 : 0);
    admCounter[jy] = (admCounter[jy] ?? 0) + 1;
    const adm = k.first === 'Arif' && k.last === 'Hussain' ? `GV/${jy}/0187` : `GV/${jy}/${String(100 + admCounter[jy]!).padStart(4, '0')}`;
    const age = PRE.indexOf(cls.name) >= 0 ? 3 + PRE.indexOf(cls.name) : 5 + Number(cls.name);
    const dob = `${Y - age}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
    const st = await one(`INSERT INTO students (school_id, family_id, admission_no, first_name, last_name, date_of_birth, gender, blood_group, admission_date, aadhaar_last4)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [SID, k.fam.id, adm, k.first, k.last, dob, k.gender, pick(BLOOD), `${jy}-04-0${1 + Math.floor(rnd() * 6)}`, rnd() < 0.6 ? String(1000 + Math.floor(rnd() * 9000)) : null]);
    await db.query('INSERT INTO enrollments (school_id, student_id, academic_year_id, section_id, roll_no) VALUES ($1, $2, $3, $4, $5)', [SID, st.id, yearId, sec.id, i + 1]);
    students.push({ id: st.id, name: `${k.first} ${k.last}`, sectionId: sec.id, classId: sec.classId, className: sec.className, group: groupOf(sec.className), ability: k.first === 'Arif' ? 0.78 : 0.35 + rnd() * 0.6, family: k.fam });
  }
}
used = new Set();
await db.query(`INSERT INTO admission_counters (school_id, year, next_no) SELECT $1, y, 300 FROM generate_series($2::int, $3::int) y ON CONFLICT DO NOTHING`, [SID, Y - 10, Y]);

// ======================= Attendance: from 1 September to the last school day =======================
const chronic = new Set(students.filter((_, i) => i % 41 === 7).map((x) => x.id)); // a few with poor attendance
const streak = students.find((x) => x.className === '8')!.id;                       // absent the last 3 days
const streakDays = (() => { const out: string[] = []; let d = lastSchoolDay; while (out.length < 3) { if (isSchoolDay(d)) out.push(d); d = addDays(d, -1); } return new Set(out); })();
for (let d = `${Y}-09-01`; d <= lastSchoolDay; d = addDays(d, 1)) {
  if (!isSchoolDay(d)) continue;
  for (const sec of sections) {
    const ct = tByName(CLASS_TEACHER[sec.className]!);
    const ses = await one('INSERT INTO attendance_sessions (school_id, section_id, on_date, period_no, taken_by, taken_at) VALUES ($1, $2, $3, 0, $4, $5) RETURNING id',
      [SID, sec.id, d, ct.accountId, `${d}T09:${String(5 + Math.floor(rnd() * 20)).padStart(2, '0')}:00+05:30`]);
    const vals: string[] = [];
    const args: unknown[] = [SID, ses.id];
    for (const st of students.filter((x) => x.sectionId === sec.id)) {
      const r = rnd();
      const status = (st.id === streak && streakDays.has(d)) ? 'absent'
        : chronic.has(st.id) ? (r < 0.32 ? 'absent' : 'present')
          : r < 0.045 ? 'absent' : r < 0.065 ? 'late' : r < 0.075 ? 'leave' : 'present';
      args.push(st.id, status);
      vals.push(`($1, $2, $${args.length - 1}, $${args.length})`);
    }
    await db.query(`INSERT INTO attendance_marks (school_id, session_id, student_id, status) VALUES ${vals.join(', ')}`, args);
  }
}
// Staff attendance for the last 10 school days
{
  const staff = [principal, office, accountant, ...teachers];
  let n = 0;
  for (let d = lastSchoolDay; n < 10; d = addDays(d, -1)) {
    if (!isSchoolDay(d)) continue;
    n++;
    for (const m of staff) {
      const r = rnd();
      await db.query('INSERT INTO staff_attendance (school_id, membership_id, on_date, status, marked_by) VALUES ($1, $2, $3, $4, $5)',
        [SID, m.membershipId, d, r < 0.03 ? 'absent' : r < 0.08 ? 'late' : 'present', office.accountId]);
    }
  }
}

// ======================= Fees =======================
const heads: Record<string, string> = {};
for (const h of ['Tuition fee', 'Development fee', 'Computer fee', 'Exam fee']) heads[h] = (await one('INSERT INTO fee_heads (school_id, name) VALUES ($1, $2) RETURNING id', [SID, h])).id;
const inst: { id: string; name: string; due: string }[] = [];
for (const [i, [name, due]] of ([['Term 1', `${Y}-07-15`], ['Term 2', `${Y}-11-15`], ['Term 3', `${Y + 1}-02-15`]] as const).entries()) {
  inst.push({ id: (await one(`INSERT INTO fee_instalments (school_id, academic_year_id, name, due_on, grace_days, fine_type, fine_amount, fine_cap, sort_order)
    VALUES ($1, $2, $3, $4, 7, 'per_day', 10, 300, $5) RETURNING id`, [SID, yearId, name, due, i])).id, name, due });
}
const tuition = { pre: 6000, primary: 8000, secondary: 10000 };
for (const c of classes) {
  const g = groupOf(c.name);
  for (const t of inst) {
    const lines: [string, number][] = [['Tuition fee', tuition[g]]];
    if (t.name === 'Term 1') lines.push(['Development fee', 2000]);
    if (g === 'secondary' || (g === 'primary' && Number(c.name) >= 3)) lines.push(['Computer fee', 1000]);
    if (g !== 'pre' && t.name !== 'Term 3') lines.push(['Exam fee', 500]);
    for (const [h, amt] of lines) await db.query('INSERT INTO fee_structure (school_id, class_id, fee_head_id, instalment_id, amount) VALUES ($1, $2, $3, $4, $5)', [SID, c.id, heads[h], t.id, amt]);
  }
}
await db.query(`INSERT INTO fee_dues (school_id, student_id, academic_year_id, instalment_id, fee_head_id, amount)
  SELECT $1, e.student_id, e.academic_year_id, fs.instalment_id, fs.fee_head_id, fs.amount
    FROM enrollments e JOIN sections s ON s.id = e.section_id JOIN fee_structure fs ON fs.class_id = s.class_id WHERE e.academic_year_id = $2`, [SID, yearId]);
// A sibling concession on one family's younger child
const sanaId = students.find((x) => x.name === 'Sana Hussain')!.id;
await db.query(`UPDATE fee_dues SET concession = amount * 0.1 WHERE student_id = $1 AND fee_head_id = $2`, [sanaId, heads['Tuition fee']]);
await db.query(`INSERT INTO fee_concessions (school_id, student_id, academic_year_id, fee_head_id, kind, value, reason, approved_by)
  VALUES ($1, $2, $3, $4, 'percent', 10, 'Sibling concession (brother Arif in Class 6)', $5)`, [SID, sanaId, yearId, heads['Tuition fee'], ownerAcc]);

let receiptNo = 1;
const payDay = (from: string, to: string) => {
  const a = new Date(`${from}T00:00:00Z`).getTime(), b = new Date(`${to}T00:00:00Z`).getTime();
  let d = new Date(a + rnd() * (b - a)).toISOString().slice(0, 10);
  while (!isSchoolDay(d)) d = addDays(d, 1);
  return d > lastSchoolDay ? lastSchoolDay : d;
};
const collectors = [accountant.accountId, office.accountId];
async function pay(studentId: string, instId: string, onDate: string, part = 1) {
  const dues = await q<{ id: string; head: string; balance: string }>(
    `SELECT d.id, h.name AS head, (d.amount - d.concession) AS balance FROM fee_dues d JOIN fee_heads h ON h.id = d.fee_head_id
      WHERE d.student_id = $1 AND d.instalment_id = $2 ORDER BY h.name`, [studentId, instId]);
  const lines = dues.map((x) => ({ ...x, amt: Math.round(Number(x.balance) * part) })).filter((x) => x.amt > 0);
  const total = lines.reduce((a, x) => a + x.amt, 0);
  if (!total) return;
  const mode = pick(['cash', 'cash', 'upi', 'upi', 'upi', 'bank_transfer', 'cheque']);
  const r = await one(`INSERT INTO receipts (school_id, academic_year_id, receipt_no, student_id, paid_on, total_amount, mode, reference, collected_by, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [SID, yearId, `GV/${yearName}/${onDate.slice(5, 7)}/${String(receiptNo++).padStart(4, '0')}`, studentId, onDate, total, mode,
      mode === 'upi' ? `UPI${Math.floor(rnd() * 1e9)}` : mode === 'cheque' ? `CHQ ${100000 + Math.floor(rnd() * 900000)}` : null, pick(collectors), `${onDate}T11:30:00+05:30`]);
  const term = inst.find((t) => t.id === instId)!.name;
  for (const l of lines) await db.query('INSERT INTO receipt_lines (school_id, receipt_id, fee_due_id, description, amount) VALUES ($1, $2, $3, $4, $5)', [SID, r.id, l.id, `${l.head} - ${term}`, l.amt]);
}
for (const st of students) {
  const r = rnd();
  // Term 1: most paid (April to October), a few paid half, a few not at all
  if (st.name === 'Arif Hussain' || st.name === 'Sana Hussain') await pay(st.id, inst[0]!.id, `${Y}-07-03`);
  else if (r < 0.86) await pay(st.id, inst[0]!.id, payDay(`${Y}-04-10`, `${Y}-10-25`));
  else if (r < 0.93) await pay(st.id, inst[0]!.id, payDay(`${Y}-06-01`, `${Y}-09-30`), 0.5);
  // Term 2 (due 15 November): about a third have paid already
  if (st.name !== 'Arif Hussain' && st.name !== 'Sana Hussain' && rnd() < 0.35 && today >= `${Y}-10-20`) await pay(st.id, inst[1]!.id, payDay(`${Y}-10-20`, lastSchoolDay));
}
await db.query('INSERT INTO receipt_counters (school_id, academic_year_id, next_no) VALUES ($1, $2, $3)', [SID, yearId, receiptNo]);

// ======================= Exams and report cards =======================
const scales = Object.fromEntries((await q<{ name: string; id: string }>('SELECT id, name FROM grading_scales WHERE school_id = $1', [SID])).map((x) => [x.name, x.id]));
const t1 = await one(`INSERT INTO terms (school_id, academic_year_id, name, sort_order, published_at, published_by) VALUES ($1, $2, 'Term 1', 1, $3, $4) RETURNING id`,
  [SID, yearId, `${Y}-10-10T10:00:00+05:30`, principal.accountId]);
const t2 = await one(`INSERT INTO terms (school_id, academic_year_id, name, sort_order) VALUES ($1, $2, 'Term 2', 2) RETURNING id`, [SID, yearId]);
const preIds = classes.filter((c) => PRE.includes(c.name)).map((c) => c.id);
const schoolIds = classes.filter((c) => !PRE.includes(c.name)).map((c) => c.id);
const exam = (term: string, name: string, max: number, w: number, order: number, on: string, classIds: string[], scale: string) => one(
  `INSERT INTO exams (school_id, term_id, name, default_max_marks, weightage_pct, sort_order, starts_on, class_ids, grading_scale_id, marks_locked)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, [SID, term, name, max, w, order, on, classIds, scales[scale], term === t1.id]);
const pt1 = await exam(t1.id, 'Periodic Test 1', 20, 20, 1, `${Y}-07-14`, schoolIds, 'CBSE 8-point');
const hy = await exam(t1.id, 'Half Yearly', 80, 80, 2, `${Y}-09-22`, schoolIds, 'CBSE 8-point');
const preT1 = await exam(t1.id, 'Term 1 assessment', 100, 100, 1, `${Y}-09-22`, preIds, 'Pre-primary');
const pt2 = await exam(t2.id, 'Periodic Test 2', 20, 20, 1, `${Y}-11-23`, schoolIds, 'CBSE 8-point');
const annual = await exam(t2.id, 'Annual Exam', 80, 80, 2, `${Y + 1}-02-20`, schoolIds, 'CBSE 8-point');
await db.query(`UPDATE exams SET ends_on = starts_on + 6, marks_due_on = starts_on + 14 WHERE school_id = $1`, [SID]);
await exam(t2.id, 'Term 2 assessment', 100, 100, 1, `${Y + 1}-02-20`, preIds, 'Pre-primary');
const PRE_GRADES = ['A+', 'A', 'B', 'C', 'D'];
const REMARKS = ['Works hard and is regular. Keep it up.', 'Good progress this term. Needs more practice in writing.', 'Bright and curious; should take part more in class.',
  'Polite and helpful. Must complete homework on time.', 'Excellent effort in all subjects.', 'Can do better with regular revision at home.'];
for (const st of students) {
  const sec = sections.find((x) => x.id === st.sectionId)!;
  const by = tByName(CLASS_TEACHER[sec.className]!).accountId;
  for (const sub of sec.subjects) {
    const k = Math.min(0.98, Math.max(0.2, st.ability + (rnd() - 0.5) * 0.25));
    if (st.group === 'pre') {
      await db.query(`INSERT INTO marks (school_id, exam_id, student_id, subject_id, grade, entered_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        [SID, preT1.id, st.id, subjectId[sub], PRE_GRADES[Math.min(4, Math.floor((1 - k) * 5))], by]);
    } else {
      const absent = rnd() < 0.015;
      await db.query(`INSERT INTO marks (school_id, exam_id, student_id, subject_id, marks_obtained, max_marks, is_absent, entered_by) VALUES ($1, $2, $3, $4, $5, 20, $6, $7)`,
        [SID, pt1.id, st.id, subjectId[sub], absent ? null : Math.round(k * 20 * 2) / 2, absent, by]);
      await db.query(`INSERT INTO marks (school_id, exam_id, student_id, subject_id, marks_obtained, max_marks, entered_by) VALUES ($1, $2, $3, $4, $5, 80, $6)`,
        [SID, hy.id, st.id, subjectId[sub], Math.round(Math.min(0.99, k + (rnd() - 0.5) * 0.1) * 80), by]);
    }
  }
  await db.query('INSERT INTO report_remarks (school_id, term_id, student_id, remark, written_by) VALUES ($1, $2, $3, $4, $5)',
    [SID, t1.id, st.id, st.name === 'Arif Hussain' ? 'Arif is attentive and helps his classmates. Keep practising fractions.' : pick(REMARKS), by]);
}

// Term 1 marks were submitted by the teachers (so parents see them) and are final by now.
await db.query(
  `INSERT INTO marks_submissions (school_id, exam_id, section_id, subject_id, first_submitted_at, submitted_by)
   SELECT DISTINCT ON (mk.exam_id, e.section_id, mk.subject_id) $1::uuid, mk.exam_id, e.section_id, mk.subject_id,
          (x.starts_on + 9)::timestamp AT TIME ZONE 'Asia/Kolkata', mk.entered_by
     FROM marks mk JOIN exams x ON x.id = mk.exam_id
     JOIN enrollments e ON e.student_id = mk.student_id AND e.academic_year_id = $2
    WHERE mk.school_id = $1`, [SID, yearId]);
// Final result for Classes 1-10: PT1 10%, Half Yearly 30%, PT2 10%, Annual 50%; results on 31 March.
for (const cid of schoolIds) {
  await db.query(
    `INSERT INTO result_settings (school_id, academic_year_id, class_id, weights, pass_subject_pct, pass_overall_pct, result_date, updated_by)
     VALUES ($1, $2, $3, $4, 33, 33, $5, $6)`,
    [SID, yearId, cid, JSON.stringify([{ examId: pt1.id, weight: 10 }, { examId: hy.id, weight: 30 }, { examId: pt2.id, weight: 10 }, { examId: annual.id, weight: 50 }]),
     `${Y + 1}-03-31`, principal.accountId]);
}

// ======================= Homework, notices, leave =======================
const HW: Record<string, string[]> = {
  English: ['Read chapter 5 and write the new words', 'Write a letter to your friend about Bihu', 'Learn the poem by heart'],
  Mathematics: ['Fractions, exercise 4.2', 'Practice tables 12 to 15', 'Word problems on page 63'],
  Science: ['Draw and label a plant cell', 'Activity: dissolving salt in water'], 'Social Science': ['Map work: rivers of Assam'],
  Hindi: ['Paath 6 ke prashn uttar'], Assamese: ['Rochona: Mor priyo utsav'], EVS: ['Collect five different leaves'], Numbers: ['Count and colour 1 to 20'],
  'Environmental awareness': ['Bring a picture of a farm animal'], 'Drawing and craft': ['Paper boat'],
};
for (const sec of sections) {
  for (const sub of sec.subjects.slice(0, 2 + Math.floor(rnd() * 2))) {
    const list = HW[sub] ?? ['Revise today’s lesson'];
    await db.query(`INSERT INTO homework (school_id, section_id, subject_id, title, details, due_on, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [SID, sec.id, subjectId[sub], pick(list), rnd() < 0.5 ? 'Write neatly in your homework copy.' : null, nextSchoolDay,
        teachers.find((t) => t.membershipId === sec.teacherOf[sub])!.accountId, `${lastSchoolDay}T13:00:00+05:30`]);
  }
}
const sec10 = sections.find((x) => x.className === '10')!;
await db.query(`INSERT INTO notices (school_id, title, body, audience, class_ids, section_ids, created_by, published_at) VALUES
  ($1, 'Annual sports day on 21 November', 'All students should come in sports uniform by 8:30 am. Parents are welcome to watch from 10 am.', 'everyone', '{}', '{}', $2, $4),
  ($1, 'Term 2 fees due on 15 November', 'Please pay the Term 2 fees by 15 November to avoid the late fine of ₹10 a day. You can pay at the office or by UPI.', 'parents', '{}', '{}', $3, $5),
  ($1, 'Class 10 pre-board timetable', 'Pre-board exams start on 1 December. The timetable is on the notice board and has been shared in class.', 'sections', '{}', ARRAY[$6]::uuid[], $2, $5),
  ($1, 'Staff meeting on Saturday', 'All teachers: staff meeting in the library at 2:15 pm on Saturday about the annual exams.', 'staff', '{}', '{}', $2, $5)`,
  [SID, principal.accountId, accountant.accountId, `${lastSchoolDay}T08:00:00+05:30`, `${addDays(lastSchoolDay, -2)}T12:00:00+05:30`, sec10.id]);

// Rina Das is on approved leave on the next school day, so the principal has periods to cover.
const rina = tByName('Rina Das'), bikash = tByName('Bikash Roy'), tara = tByName('Tara Devi');
await db.query(`INSERT INTO teacher_leaves (school_id, membership_id, from_date, to_date, part, reason, status, decided_by, decided_at)
  VALUES ($1, $2, $3, $3, 'full', 'Fever', 'approved', $4, now())`, [SID, rina.membershipId, nextSchoolDay, principal.accountId]);
await db.query(`INSERT INTO teacher_leaves (school_id, membership_id, from_date, to_date, part, reason) VALUES ($1, $2, $3, $3, 'first_half', 'Bank work')`,
  [SID, bikash.membershipId, addDays(nextSchoolDay, 7)]);
await db.query(`INSERT INTO teacher_leaves (school_id, membership_id, from_date, to_date, part, reason, status, decided_by, decided_at)
  VALUES ($1, $2, $3, $4, 'full', 'Family wedding', 'approved', $5, $6)`, [SID, tara.membershipId, addDays(lastSchoolDay, -20), addDays(lastSchoolDay, -18), principal.accountId, `${addDays(lastSchoolDay, -25)}T10:00:00+05:30`]);

// ======================= A second school, for a parent with children in two schools =======================
const bva = await createSchool(db, { code: 'BVA', name: 'Brahmaputra Valley Academy', ownerName: 'Zahid', ownerPhone: '+919876543210', receiptPrefix: 'BVA', academicYear: year });
await db.query(`UPDATE schools SET short_name = 'BVA', brand_color = '#22B3C4', affiliation_no = '2030789' WHERE id = $1`, [bva.schoolId]);
const bvaYear = (await one('SELECT id FROM academic_years WHERE school_id = $1', [bva.schoolId])).id;
const bvaClass = await one(`SELECT id FROM classes WHERE school_id = $1 AND name = '2'`, [bva.schoolId]);
const bvaSec = await one(`INSERT INTO sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'A') RETURNING id`, [bva.schoolId, bvaYear, bvaClass.id]);
const bvaM = await one('INSERT INTO memberships (school_id, account_id, display_name) VALUES ($1, $2, $3) RETURNING id', [bva.schoolId, imran.accountId, 'Imran Hussain']);
await db.query(`INSERT INTO membership_roles (school_id, membership_id, role) VALUES ($1, $2, 'parent')`, [bva.schoolId, bvaM.id]);
const bvaFam = await one(`INSERT INTO families (school_id, phone, account_id, father_name, mother_name) VALUES ($1, $2, $3, 'Imran Hussain', 'Rehana Begum') RETURNING id`, [bva.schoolId, imran.phone, imran.accountId]);
const zara = await one(`INSERT INTO students (school_id, family_id, admission_no, first_name, last_name, gender, admission_date) VALUES ($1, $2, 'BVA/2025/0032', 'Zara', 'Hussain', 'female', '2025-04-02') RETURNING id`, [bva.schoolId, bvaFam.id]);
await db.query('INSERT INTO enrollments (school_id, student_id, academic_year_id, section_id, roll_no) VALUES ($1, $2, $3, $4, 4)', [bva.schoolId, zara.id, bvaYear, bvaSec.id]);

await db.end();

// ======================= Summary =======================
const parentsShown = students.filter((x) => ['Nursery', '1', '5', '8', '10'].includes(x.className)).filter((_, i) => i % 10 === 3);
console.log(`\nDemo school ready for ${yearName}: Green Valley Public School`);
console.log(`${students.length} students in ${sections.length} classes, ${families.length} families, ${teachers.length} teachers, ${receiptNo - 1} receipts.`);
console.log(`Next school day: ${nextSchoolDay} (Rina Das is on leave that day). Password for every login: ${PASSWORD}\n`);
console.log('Owner           Zahid             98765 43210');
console.log(`Principal       ${principal.name.padEnd(17)} 90000 00001`);
console.log(`Office admin    ${office.name.padEnd(17)} 90000 00002`);
console.log(`Accountant      ${accountant.name.padEnd(17)} 90000 00003`);
for (const t of teachers.slice(0, 19)) {
  const cls = Object.entries(CLASS_TEACHER).find(([, n]) => n === t.name)?.[0];
  console.log(`Teacher         ${t.name.padEnd(17)} ${t.phone.slice(3, 8)} ${t.phone.slice(8)}   ${t.designation}${cls ? `, class teacher of ${PRE.includes(cls) ? cls : `Class ${cls}`}` : ''}`);
}
console.log('Parent          Imran Hussain     98765 00011   Arif (Class 6), Sana (Class 4), Zara (other school)');
for (const p of parentsShown) console.log(`Parent          ${p.family.father.padEnd(17)} ${p.family.phone.slice(3, 8)} ${p.family.phone.slice(8)}   ${p.name} (${PRE.includes(p.className) ? p.className : `Class ${p.className}`})`);
