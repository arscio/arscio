// HOMEWORK and ATTENDANCE REPORTS
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayIST } from '../src/routes/attendance.js';
import { addFamily, addMember, api, loginAs, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let S: Awaited<ReturnType<typeof newSchool>>;
let teacher: ReturnType<typeof api>;
let teacher2: ReturnType<typeof api>;
let principal: ReturnType<typeof api>;
let office: ReturnType<typeof api>;
let sectionId: string;
let kids: string[];
let fam1Account: string;
let english: string;

const daysAgo = (n: number) => {
  const d = new Date(`${todayIST()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  env = await setupEnv();
  S = await newSchool(env);
  const t = await addMember(env, S.schoolId, ['teacher'], 'Rina Das');
  teacher = api(env, (await loginAs(env, t.phone)).accessToken, S.schoolId);
  teacher2 = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['teacher'], 'Bikash Roy')).phone)).accessToken, S.schoolId);
  principal = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['principal'])).phone)).accessToken, S.schoolId);
  office = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['office_admin'])).phone)).accessToken, S.schoolId);
  const f1 = await addFamily(env, S, ['Arif', 'Sana'], { withParentLogin: true }); // two children, one family
  const f2 = await addFamily(env, S, ['Tara'], { withParentLogin: true });
  sectionId = f1.sectionId;
  kids = [...f1.students, ...f2.students];
  fam1Account = f1.accountId!;
  await env.owner.query('UPDATE sections SET class_teacher_membership = $1 WHERE id = $2', [t.membershipId, sectionId]);
  english = (await principal.post('/subjects', { name: 'English' })).json().id;
  const cls = (await env.owner.query('SELECT class_id FROM sections WHERE id = $1', [sectionId])).rows[0].class_id;
  await principal.put(`/classes/${cls}/subjects`, { subjectIds: [english] });
});
afterAll(async () => { await env.close(); });

describe('Homework', () => {
  it('teacher sees classes with their subjects, own class first', async () => {
    const r = (await teacher.get('/teacher/classes')).json();
    expect(r.sections[0]).toMatchObject({ sectionId, mine: true });
    expect(r.sections[0].subjects.map((s: { name: string }) => s.name)).toEqual(['English']);
  });

  it('gives homework; each family gets ONE message even with two children in the class', async () => {
    const r = await teacher.post('/homework', { sectionId, subjectId: english, title: 'Write 10 lines on my school', dueOn: daysAgo(-1) });
    expect(r.statusCode).toBe(200);
    expect(r.json().parentsTold).toBe(2);
    const n = await env.owner.query("SELECT title, body FROM notifications WHERE account_id = $1 AND data->>'kind' = 'homework'", [fam1Account]);
    expect(n.rows).toEqual([{ title: 'Homework: English (Class 5 A)', body: 'Write 10 lines on my school' }]);
  });

  it('refuses a past due date, a subject not taught in the class, and an empty title', async () => {
    expect((await teacher.post('/homework', { sectionId, title: 'Old', dueOn: daysAgo(1) })).statusCode).toBe(400);
    const other = (await principal.post('/subjects', { name: 'Sanskrit' })).json().id;
    expect((await teacher.post('/homework', { sectionId, subjectId: other, title: 'Shlokas' })).statusCode).toBe(400);
    expect((await teacher.post('/homework', { sectionId, title: ' ' })).statusCode).toBe(400);
  });

  it('lists homework; only the giver or principal can remove it', async () => {
    const mine = (await teacher.get('/homework?mine=true')).json().homework;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ subjectName: 'English', className: '5', sectionName: 'A', givenBy: 'Rina Das' });
    const id = mine[0].id;
    expect((await teacher2.del(`/homework/${id}`)).statusCode).toBe(403);
    expect((await teacher.patch(`/homework/${id}`, { title: 'Write 12 lines on my school' })).statusCode).toBe(200);
    expect((await teacher2.get('/homework?mine=true')).json().homework).toHaveLength(0);
    expect((await teacher2.get(`/homework?sectionId=${sectionId}`)).json().homework[0].title).toBe('Write 12 lines on my school');
    const extra = (await teacher2.post('/homework', { sectionId, title: 'Temporary' })).json().id;
    expect((await principal.del(`/homework/${extra}`)).statusCode).toBe(200);
  });

  it('office (no teaching role) cannot give homework', async () => {
    expect((await office.post('/homework', { sectionId, title: 'Something' })).statusCode).toBe(403);
  });
});

describe('Attendance reports', () => {
  const mark = (who: ReturnType<typeof api>, date: string, statuses: string[], period = 0) =>
    who.put('/attendance/sheet', { sectionId, date, period, marks: kids.map((studentId, i) => ({ studentId, status: statuses[i] ?? 'present' })) });

  it('day overview: numbers per section, and who is absent with a phone to call', async () => {
    await mark(teacher, todayIST(), ['present', 'absent', 'leave']);
    const r = (await office.get('/attendance/day')).json();
    expect(r.totals).toMatchObject({ students: 3, present: 1, absent: 1, leave: 1, sectionsTaken: 1, sections: 1 });
    expect(r.sections[0]).toMatchObject({ className: '5', sectionName: 'A', taken: true, takenBy: 'Rina Das', classTeacher: 'Rina Das' });
    expect(r.absentees).toHaveLength(1);
    expect(r.absentees[0]).toMatchObject({ firstName: 'Sana', className: '5', parentName: 'Father', absentLast30: 1 });
    expect(r.absentees[0].phone).toMatch(/^\+91/);
  });

  it('office can correct a past day; the monthly register adds it up', async () => {
    const y = daysAgo(1);
    expect((await office.put('/attendance/sheet', { sectionId, date: y, period: 0, marks: kids.map((studentId) => ({ studentId, status: 'absent' })) })).statusCode).toBe(200);
    const month = todayIST().slice(0, 7);
    const r = (await office.get(`/attendance/register?sectionId=${sectionId}&month=${month}`)).json();
    expect(r.section).toMatchObject({ className: '5', sectionName: 'A' });
    const sana = r.students.find((s: { firstName: string }) => s.firstName === 'Sana');
    expect(sana.marks[todayIST()]).toBe('absent');
    if (y.slice(0, 7) === month) {
      expect(r.schoolDays).toEqual([y, todayIST()]);
      expect(sana).toMatchObject({ present: 0, absent: 2, percent: 0 });
      const arif = r.students.find((s: { firstName: string }) => s.firstName === 'Arif');
      expect(arif).toMatchObject({ present: 1, absent: 1, percent: 50 });
      const tara = r.students.find((s: { firstName: string }) => s.firstName === 'Tara');
      expect(tara).toMatchObject({ present: 0, absent: 1, leave: 1, percent: 0 });
    }
  });

  it('every-period schools: the first period marked is the day\'s roll call', async () => {
    await principal.patch('/school/settings', { attendanceMode: 'period', periodsPerDay: 8 });
    const d = daysAgo(2);
    await principal.put('/attendance/sheet', { sectionId, date: d, period: 3, marks: kids.map((studentId) => ({ studentId, status: 'absent' })) });
    await principal.put('/attendance/sheet', { sectionId, date: d, period: 1, marks: kids.map((studentId) => ({ studentId, status: 'present' })) });
    const r = (await office.get(`/attendance/day?date=${d}`)).json();
    expect(r.sections[0]).toMatchObject({ present: 3, absent: 0, periodsTaken: 2 });
    await principal.patch('/school/settings', { attendanceMode: 'daily' });
  });

  it('teachers cannot open school-wide reports', async () => {
    expect((await teacher.get('/attendance/day')).statusCode).toBe(403);
  });
});
