// EXAMS AND MARKS, as agreed for the first real school:
//  - principal sets exams with dates, a marks deadline, and internal marks for chosen subjects
//  - one responsible teacher per subject per class (principal picks when several teach it)
//  - submit -> parents told, 7 days to correct (every correction recorded and told), then final
//  - class tests (shown, not counted) and assignment submissions sent to parents
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addFamily, addMember, api, loginAs, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let S: Awaited<ReturnType<typeof newSchool>>;
let principal: ReturnType<typeof api>;
let rina: ReturnType<typeof api>;   // teaches Maths
let bikash: ReturnType<typeof api>; // also teaches Maths, and is the class teacher
let parent: ReturnType<typeof api>;
let rinaM: string; let bikashM: string;
let sectionId: string; let kids: string[]; let familyAccount: string;
let maths: string; let science: string;
let term: string; let ut1: string;

const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() + 5.5 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
const sheetUrl = (examId: string, subjectId: string) => `/marks/sheet?examId=${examId}&sectionId=${sectionId}&subjectId=${subjectId}`;
const messages = async () => (await env.owner.query(
  'SELECT title, body FROM notifications WHERE account_id = $1 ORDER BY created_at', [familyAccount])).rows as { title: string; body: string }[];

beforeAll(async () => {
  env = await setupEnv();
  S = await newSchool(env);
  principal = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['principal'])).phone)).accessToken, S.schoolId);
  const r = await addMember(env, S.schoolId, ['teacher'], 'Rina Das'); rinaM = r.membershipId;
  rina = api(env, (await loginAs(env, r.phone)).accessToken, S.schoolId);
  const b = await addMember(env, S.schoolId, ['teacher'], 'Bikash Roy'); bikashM = b.membershipId;
  bikash = api(env, (await loginAs(env, b.phone)).accessToken, S.schoolId);
  const fam = await addFamily(env, S, ['Arif', 'Sana'], { withParentLogin: true });
  familyAccount = fam.accountId!;
  parent = api(env, (await loginAs(env, fam.phone)).accessToken, S.schoolId);
  sectionId = fam.sectionId; kids = fam.students;
  maths = (await principal.post('/subjects', { name: 'Mathematics' })).json().id;
  science = (await principal.post('/subjects', { name: 'Science' })).json().id;
  const cls = (await env.owner.query('SELECT class_id FROM sections WHERE id = $1', [sectionId])).rows[0].class_id;
  await principal.put(`/classes/${cls}/subjects`, { subjectIds: [maths, science] });
  for (const m of [rinaM, bikashM]) {
    await env.owner.query('INSERT INTO section_teachers (school_id, section_id, subject_id, membership_id) VALUES ($1, $2, $3, $4)',
      [S.schoolId, sectionId, maths, m]);
  }
  await env.owner.query('UPDATE sections SET class_teacher_membership = $1 WHERE id = $2', [bikashM, sectionId]);
  term = (await principal.post('/exams/terms', { name: 'Term 1' })).json().id;
});
afterAll(async () => { await env.close(); });

describe('Exam setup by the principal', () => {
  it('sets dates, a marks deadline and internal marks for chosen subjects', async () => {
    const bad = await principal.post('/exams', { termId: term, name: 'Unit Test 1', maxMarks: 40, weightagePct: 10,
      startsOn: daysAgo(5), endsOn: daysAgo(3), marksDueOn: daysAgo(4) });
    expect(bad.json().error.code).toBe('bad_dates');
    const r = await principal.post('/exams', { termId: term, name: 'Unit Test 1', maxMarks: 40, weightagePct: 10,
      startsOn: daysAgo(5), endsOn: daysAgo(3), marksDueOn: daysAgo(1), internals: [{ subjectId: science, internalMax: 10 }] });
    expect(r.statusCode).toBe(200);
    ut1 = r.json().id;
    const x = (await principal.get('/exams/setup')).json().terms[0].exams[0];
    expect(x.marksDueOn).toBe(daysAgo(1));
    expect(x.internals).toEqual([{ subjectId: science, internalMax: 10 }]);
  });

  it('shows an upcoming exam in the teacher app before it starts, but marks wait for the exam', async () => {
    const later = (await principal.post('/exams', { termId: term, name: 'Half Yearly', maxMarks: 80, weightagePct: 30,
      startsOn: '2099-01-10', endsOn: '2099-01-20', marksDueOn: '2099-01-30' })).json().id;
    const sci = (await bikash.get('/marks/tasks')).json().tasks.find((t: { examId: string; subjectName: string }) => t.examId === later && t.subjectName === 'Science');
    expect(sci.status).toBe('upcoming');
    expect((await bikash.put('/marks/sheet', { examId: later, sectionId, subjectId: science, rows: [] })).statusCode).toBe(403);
  });
});

describe('Who enters the marks', () => {
  it('when two teachers teach Maths, nobody can until the principal picks one', async () => {
    expect((await rina.get('/marks/tasks')).json().tasks).toEqual([]);
    const prog = (await principal.get(`/marks/progress?examId=${ut1}`)).json();
    const row = prog.rows.find((x: { subjectName: string }) => x.subjectName === 'Mathematics');
    expect(row.teacher.how).toBe('needs_choice');
    expect(row.teacher.candidates.map((c: { name: string }) => c.name)).toEqual(['Bikash Roy', 'Rina Das']);
    expect(row.overdue).toBe(true); // deadline was yesterday

    await principal.put('/marks/teacher', { sectionId, subjectId: maths, membershipId: rinaM });
    expect((await rina.get('/marks/tasks')).json().tasks.map((t: { subjectName: string }) => t.subjectName)).toContain('Mathematics');
    expect((await bikash.get(sheetUrl(ut1, maths))).statusCode).toBe(403);
    // Science has no subject teacher, so the class teacher (Bikash) does it
    expect((await bikash.get(sheetUrl(ut1, science))).statusCode).toBe(200);
  });
});

describe('Submit, 7 days to correct, then final', () => {
  it('cannot submit until every student has marks or is absent', async () => {
    const r = await rina.put('/marks/sheet', { examId: ut1, sectionId, subjectId: maths, submit: true, rows: [{ studentId: kids[0], marks: 30 }] });
    expect(r.json().error.code).toBe('incomplete');
    // A draft save is fine and parents are not told yet
    expect((await parent.get(`/parent/children/${kids[0]}/marks`)).json().exams).toEqual([]);
  });

  it('on submit parents see the marks as provisional and get a message', async () => {
    const before = (await messages()).length;
    const r = await rina.put('/marks/sheet', { examId: ut1, sectionId, subjectId: maths, submit: true,
      rows: [{ studentId: kids[0], marks: 30 }, { studentId: kids[1], absent: true }] });
    expect(r.json().submittedNow).toBe(true);
    const m = (await parent.get(`/parent/children/${kids[0]}/marks`)).json();
    expect(m.exams[0].name).toBe('Unit Test 1');
    expect(m.exams[0].subjects[0]).toMatchObject({ subject: 'Mathematics', marks: 30, max: 40, provisional: true });
    const msgs = (await messages()).slice(before);
    expect(msgs.map((x) => x.body)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Arif got 30\/40\. These can still be corrected until/),
      expect.stringMatching(/^Sana got Absent\./),
    ]));
    const task = (await rina.get('/marks/tasks')).json().tasks.find((t: { examId: string; subjectName: string }) => t.examId === ut1 && t.subjectName === 'Mathematics');
    expect(task.status).toBe('submitted');
  });

  it('a correction is recorded and the family is told', async () => {
    const before = (await messages()).length;
    await rina.put('/marks/sheet', { examId: ut1, sectionId, subjectId: maths,
      rows: [{ studentId: kids[0], marks: 32 }, { studentId: kids[1], absent: true }] });
    const msgs = (await messages()).slice(before);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.body).toBe("Arif's Unit Test 1 marks in Mathematics are now 32/40 (were 30/40).");
    const log = (await env.owner.query('SELECT old_value, new_value FROM marks_changes WHERE student_id = $1', [kids[0]])).rows;
    expect(log).toHaveLength(1);
    // submitted marks can't be left blank by the teacher
    const blank = await rina.put('/marks/sheet', { examId: ut1, sectionId, subjectId: maths, rows: [{ studentId: kids[0], marks: null }] });
    expect(blank.json().error.code).toBe('cant_clear');
  });

  it('after 7 days the teacher cannot change them; the principal can reopen', async () => {
    await env.owner.query("UPDATE marks_submissions SET first_submitted_at = now() - interval '8 days' WHERE exam_id = $1", [ut1]);
    const closed = await rina.put('/marks/sheet', { examId: ut1, sectionId, subjectId: maths, rows: [{ studentId: kids[0], marks: 33 }] });
    expect(closed.statusCode).toBe(403);
    expect((await rina.get(sheetUrl(ut1, maths))).json().canEdit).toBe(false);
    const p = (await parent.get(`/parent/children/${kids[0]}/marks`)).json();
    expect(p.exams[0].subjects[0].provisional).toBe(false);

    await principal.post('/marks/reopen', { examId: ut1, sectionId, subjectId: maths, days: 2 });
    expect((await rina.put('/marks/sheet', { examId: ut1, sectionId, subjectId: maths, rows: [{ studentId: kids[0], marks: 33 }] })).statusCode).toBe(200);
  });
});

describe('Internal marks', () => {
  it('adds internal marks to the total and the report card', async () => {
    const r = await bikash.put('/marks/sheet', { examId: ut1, sectionId, subjectId: science, submit: true,
      rows: [{ studentId: kids[0], marks: 30, internal: 8 }, { studentId: kids[1], marks: 20, internal: 5 }] });
    expect(r.statusCode).toBe(200);
    const tooHigh = await bikash.put('/marks/sheet', { examId: ut1, sectionId, subjectId: science, rows: [{ studentId: kids[0], marks: 30, internal: 11 }] });
    expect(tooHigh.json().error.code).toBe('too_high');
    const sci = (await parent.get(`/parent/children/${kids[0]}/marks`)).json().exams[0].subjects.find((s: { subject: string }) => s.subject === 'Science');
    expect(sci).toMatchObject({ marks: 30, max: 40, internal: 8, internalMax: 10 });
    const rep = (await principal.get(`/reportcards/student/${kids[0]}`)).json();
    const row = rep.terms[0].rows.find((x: { subject: string }) => x.subject === 'Science');
    expect(row.cells[0]).toMatchObject({ marks: 30, internal: 8, internalMax: 10 });
  });
});

describe('Class tests', () => {
  it('teacher gives a class test; parents see it but it is not in the report card', async () => {
    const t = await rina.post('/class-tests', { sectionId, subjectId: maths, title: 'Fractions quiz', heldOn: today(), maxMarks: 10 });
    expect(t.statusCode).toBe(200);
    const id = t.json().id;
    expect((await bikash.put(`/class-tests/${id}/marks`, { rows: [] })).statusCode).toBe(403); // not his test
    const before = (await messages()).length;
    const r = await rina.put(`/class-tests/${id}/marks`, { publish: true,
      rows: [{ studentId: kids[0], marks: 9 }, { studentId: kids[1], absent: true }] });
    expect(r.json().parentsTold).toBe(2);
    expect((await messages()).slice(before).map((x) => x.body)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Arif got 9\/10 in "Fractions quiz"/)]));
    const m = (await parent.get(`/parent/children/${kids[0]}/marks`)).json();
    expect(m.classTests[0]).toMatchObject({ title: 'Fractions quiz', marks: 9, max: 10 });
    const rep = JSON.stringify((await principal.get(`/reportcards/student/${kids[0]}`)).json());
    expect(rep).not.toContain('Fractions quiz');
  });

  it('a teacher cannot give a test for a subject they do not teach there', async () => {
    const r = await rina.post('/class-tests', { sectionId, subjectId: science, title: 'Plants', heldOn: today(), maxMarks: 10 });
    expect(r.statusCode).toBe(403);
  });
});

describe('Assignment submissions', () => {
  it('on the due day the teacher ticks who handed it in and parents get the result', async () => {
    const hw = (await rina.post('/homework', { sectionId, subjectId: maths, title: 'Exercise 4.2', dueOn: today() })).json().id;
    const notYet = await rina.put(`/homework/${hw}/submissions`, { sendReport: true, rows: [{ studentId: kids[0], status: 'submitted' }] });
    expect(notYet.json().error.code).toBe('incomplete');
    const before = (await messages()).length;
    const r = await rina.put(`/homework/${hw}/submissions`, { sendReport: true,
      rows: [{ studentId: kids[0], status: 'submitted' }, { studentId: kids[1], status: 'not_submitted' }] });
    expect(r.json().parentsTold).toBe(2);
    const bodies = (await messages()).slice(before).map((x) => x.body);
    expect(bodies).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Arif handed in "Exercise 4\.2" \(Mathematics\)/),
      expect.stringMatching(/^Sana did not hand in "Exercise 4\.2"/),
    ]));
    const list = (await parent.get(`/parent/children/${kids[1]}/homework`)).json().homework;
    expect(list.find((h: { id: string }) => h.id === hw).submission).toBe('not_submitted');
    // Sana brings it the next day: only her family is told
    const late = await rina.put(`/homework/${hw}/submissions`, { rows: [{ studentId: kids[1], status: 'late' }] });
    expect(late.json().parentsTold).toBe(1);
  });

  it('cannot be ticked before the due day', async () => {
    const hw = (await rina.post('/homework', { sectionId, subjectId: maths, title: 'Exercise 5.1', dueOn: '2099-01-01' })).json().id;
    expect((await rina.put(`/homework/${hw}/submissions`, { rows: [] })).json().error.code).toBe('not_due');
  });
});
