// EXAMS, MARKS and REPORT CARDS
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addFamily, addMember, api, loginAs, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let S: Awaited<ReturnType<typeof newSchool>>;
let principal: ReturnType<typeof api>;
let teacher: ReturnType<typeof api>;
let otherTeacher: ReturnType<typeof api>;
let parent: ReturnType<typeof api>;
let sectionId: string;
let kids: string[];
let maths: string;
let english: string;
let term1: string;
let pt1: string;
let halfYearly: string;
let parentAccount: string;

beforeAll(async () => {
  env = await setupEnv();
  S = await newSchool(env);
  principal = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['principal'])).phone)).accessToken, S.schoolId);
  const t = await addMember(env, S.schoolId, ['teacher'], 'Rina Das');
  teacher = api(env, (await loginAs(env, t.phone)).accessToken, S.schoolId);
  const t2 = await addMember(env, S.schoolId, ['teacher'], 'Bikash Roy');
  otherTeacher = api(env, (await loginAs(env, t2.phone)).accessToken, S.schoolId);
  const fam = await addFamily(env, S, ['Arif', 'Sana'], { withParentLogin: true });
  parentAccount = fam.accountId!;
  parent = api(env, (await loginAs(env, fam.phone)).accessToken, S.schoolId);
  sectionId = fam.sectionId;
  kids = fam.students;
  maths = (await principal.post('/subjects', { name: 'Mathematics' })).json().id;
  english = (await principal.post('/subjects', { name: 'English' })).json().id;
  const cls = (await env.owner.query('SELECT class_id FROM sections WHERE id = $1', [sectionId])).rows[0].class_id;
  await principal.put(`/classes/${cls}/subjects`, { subjectIds: [maths, english] });
  // Rina teaches only Mathematics in this class; Bikash is the class teacher.
  await env.owner.query('INSERT INTO section_teachers (school_id, section_id, subject_id, membership_id) VALUES ($1, $2, $3, $4)',
    [S.schoolId, sectionId, maths, t.membershipId]);
  await env.owner.query('UPDATE sections SET class_teacher_membership = $1 WHERE id = $2', [t2.membershipId, sectionId]);
});
afterAll(async () => { await env.close(); });

const sheet = (examId: string, subjectId: string) => `/marks/sheet?examId=${examId}&sectionId=${sectionId}&subjectId=${subjectId}`;

describe('Exam setup', () => {
  it('only the principal sets up terms and exams', async () => {
    expect((await teacher.post('/exams/terms', { name: 'Term 1' })).statusCode).toBe(403);
    term1 = (await principal.post('/exams/terms', { name: 'Term 1' })).json().id;
    expect((await principal.post('/exams/terms', { name: 'term 1' })).statusCode).toBe(400);
    pt1 = (await principal.post('/exams', { termId: term1, name: 'Periodic Test 1', maxMarks: 20, weightagePct: 20 })).json().id;
    halfYearly = (await principal.post('/exams', { termId: term1, name: 'Half Yearly', maxMarks: 80, weightagePct: 80 })).json().id;
    const setup = (await principal.get('/exams/setup')).json();
    expect(setup.terms[0].exams.map((x: { name: string }) => x.name)).toEqual(['Periodic Test 1', 'Half Yearly']);
    expect(setup.scales.length).toBe(2);
  });
});

describe('Marks entry', () => {
  it('each teacher sees only their own subject; the class teacher takes subjects nobody teaches', async () => {
    const mine = (await teacher.get('/marks/tasks')).json().tasks;
    expect(new Set(mine.map((x: { subjectName: string }) => x.subjectName))).toEqual(new Set(['Mathematics']));
    const ct = (await otherTeacher.get('/marks/tasks')).json().tasks;
    expect(new Set(ct.map((x: { subjectName: string }) => x.subjectName))).toEqual(new Set(['English']));
  });

  it('refuses a subject the teacher does not teach', async () => {
    expect((await teacher.get(sheet(pt1, english))).statusCode).toBe(403);
    expect((await teacher.put('/marks/sheet', { examId: pt1, sectionId, subjectId: english, rows: [] })).statusCode).toBe(403);
  });

  it('saves marks, refuses marks above the maximum, and marks absent students', async () => {
    const bad = await teacher.put('/marks/sheet', { examId: pt1, sectionId, subjectId: maths, rows: [{ studentId: kids[0], marks: 25 }] });
    expect(bad.statusCode).toBe(400);
    const ok = await teacher.put('/marks/sheet', { examId: pt1, sectionId, subjectId: maths,
      rows: [{ studentId: kids[0], marks: 18 }, { studentId: kids[1], absent: true }] });
    expect(ok.json().saved).toBe(2);
    const s = (await teacher.get(sheet(pt1, maths))).json();
    expect(s.students.map((x: { marks: string | null; absent: boolean }) => [x.marks, x.absent])).toEqual([['18.00', false], [null, true]]);
  });

  it('locked marks can only be changed by the principal', async () => {
    await principal.patch(`/exams/${pt1}`, { locked: true });
    const r = await teacher.put('/marks/sheet', { examId: pt1, sectionId, subjectId: maths, rows: [{ studentId: kids[0], marks: 19 }] });
    expect(r.statusCode).toBe(403);
    expect((await principal.put('/marks/sheet', { examId: pt1, sectionId, subjectId: maths, rows: [{ studentId: kids[0], marks: 18 }] })).statusCode).toBe(200);
    await principal.patch(`/exams/${pt1}`, { locked: false });
  });

  it('an exam with marks cannot be deleted', async () => {
    expect((await principal.del(`/exams/${pt1}`)).statusCode).toBe(400);
  });
});

describe('Report cards', () => {
  it('works out weighted term scores and grades, and leaves missing results blank', async () => {
    // Arif: PT1 18/20 (90%) x 20% + Half Yearly 60/80 (75%) x 80% = 78% -> B1 in Maths
    await teacher.put('/marks/sheet', { examId: halfYearly, sectionId, subjectId: maths,
      rows: [{ studentId: kids[0], marks: 60 }, { studentId: kids[1], marks: 40 }] });
    let r = (await principal.get(`/reportcards/student/${kids[0]}`)).json();
    const mathsRow = r.terms[0].rows.find((x: { subject: string }) => x.subject === 'Mathematics');
    expect(mathsRow).toMatchObject({ pct: 78, grade: 'B1' });
    expect(r.terms[0].rows.find((x: { subject: string }) => x.subject === 'English').pct).toBeNull();
    expect(r.terms[0].pct).toBeNull();
    // Sana was absent for PT1: 0 x 20% + 50% x 80% = 40% -> D
    r = (await principal.get(`/reportcards/student/${kids[1]}`)).json();
    expect(r.terms[0].rows.find((x: { subject: string }) => x.subject === 'Mathematics')).toMatchObject({ pct: 40, grade: 'D' });
  });

  it('the class teacher writes remarks; a subject teacher cannot', async () => {
    expect((await teacher.put('/reportcards/remark', { termId: term1, studentId: kids[0], remark: 'Good work' })).statusCode).toBe(403);
    expect((await otherTeacher.put('/reportcards/remark', { termId: term1, studentId: kids[0], remark: 'Hard-working and polite.' })).statusCode).toBe(200);
    const r = (await principal.get(`/reportcards/section/${sectionId}`)).json();
    expect(r.reports[0].terms[0].remark).toBe('Hard-working and polite.');
  });

  it('parents see nothing until the principal publishes; then each family gets one message', async () => {
    let r = (await parent.get(`/parent/children/${kids[0]}/report`)).json();
    expect(r.terms).toEqual([]);
    const pr = await principal.post(`/exams/terms/${term1}/publish`, { published: true });
    const p = pr.json();
    expect(p.notified).toBe(1);
    const n = await env.owner.query("SELECT title FROM notifications WHERE account_id = $1 AND data->>'kind' = 'report_card'", [parentAccount]);
    expect(n.rows).toEqual([{ title: 'Term 1 report card' }]);
    r = (await parent.get(`/parent/children/${kids[0]}/report`)).json();
    expect(r.terms[0].rows.find((x: { subject: string }) => x.subject === 'Mathematics').grade).toBe('B1');
  });

  it('another school cannot see this school’s report cards', async () => {
    const S2 = await newSchool(env, 'Other School');
    const p2 = api(env, (await loginAs(env, (await addMember(env, S2.schoolId, ['principal'])).phone)).accessToken, S2.schoolId);
    expect((await p2.get(`/reportcards/student/${kids[0]}`)).statusCode).toBe(404);
  });
});
