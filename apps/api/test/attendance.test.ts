// ATTENDANCE: daily or per period; today only for teachers; everyone marked; parents alerted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayIST } from '../src/routes/attendance.js';
import { addFamily, addMember, api, loginAs, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let S: Awaited<ReturnType<typeof newSchool>>;
let teacher: ReturnType<typeof api>;
let principal: ReturnType<typeof api>;
let teacherMembership: string;
let sectionId: string;
let kids: string[];
let parentAccount: string;

const yesterday = () => {
  const d = new Date(`${todayIST()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const tomorrow = () => {
  const d = new Date(`${todayIST()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  env = await setupEnv();
  S = await newSchool(env);
  const t = await addMember(env, S.schoolId, ['teacher'], 'Rina Das');
  teacherMembership = t.membershipId;
  teacher = api(env, (await loginAs(env, t.phone)).accessToken, S.schoolId);
  const p = await addMember(env, S.schoolId, ['principal']);
  principal = api(env, (await loginAs(env, p.phone)).accessToken, S.schoolId);
  const fam = await addFamily(env, S, ['Arif', 'Sana', 'Tara'], { withParentLogin: true });
  sectionId = fam.sectionId;
  kids = fam.students;
  parentAccount = fam.accountId!;
  await env.owner.query('UPDATE sections SET class_teacher_membership = $1 WHERE id = $2', [teacherMembership, sectionId]);
});
afterAll(async () => { await env.close(); });

const marks = (statuses: string[]) => kids.map((studentId, i) => ({ studentId, status: statuses[i] ?? 'present' }));

describe('Attendance (once a day)', () => {
  it('teacher home lists their class, not yet taken', async () => {
    const r = (await teacher.get('/teacher/today')).json();
    expect(r.mode).toBe('daily');
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]).toMatchObject({ className: '5', sectionName: 'A', isClassTeacher: true, studentCount: 3, taken: [] });
  });

  it('the sheet lists every student, unmarked', async () => {
    const r = (await teacher.get(`/attendance/sheet?sectionId=${sectionId}`)).json();
    expect(r.students.map((s: { firstName: string }) => s.firstName)).toEqual(['Arif', 'Sana', 'Tara']);
    expect(r.session).toBeNull();
  });

  it('refuses to save until every student is marked', async () => {
    const r = await teacher.put('/attendance/sheet', {
      sectionId, date: todayIST(), period: 0, marks: marks(['present']).slice(0, 2),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toBe('1 student is not marked yet');
  });

  it('saves; parents of the absent child get ONE alert even if saved twice', async () => {
    const r = await teacher.put('/attendance/sheet', { sectionId, date: todayIST(), period: 0, marks: marks(['present', 'absent']) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ total: 3, present: 2, absent: 1, parentAlerts: 1 });

    const again = await teacher.put('/attendance/sheet', { sectionId, date: todayIST(), period: 0, marks: marks(['present', 'absent']) });
    expect(again.json().parentAlerts).toBe(0);

    const n = await env.owner.query("SELECT title, body FROM notifications WHERE account_id = $1 AND data->>'kind' = 'absent'", [parentAccount]);
    expect(n.rows).toHaveLength(1);
    expect(n.rows[0].body).toMatch(/^Sana was marked absent in Class 5 A on /);

    const home = (await teacher.get('/teacher/today')).json();
    expect(home.sections[0].taken[0]).toMatchObject({ periodNo: 0, present: 2, absent: 1, takenBy: 'Rina Das' });
    const sheet = (await teacher.get(`/attendance/sheet?sectionId=${sectionId}`)).json();
    expect(sheet.students.map((s: { status: string }) => s.status)).toEqual(['present', 'absent', 'present']);
  });

  it('teachers cannot change yesterday or mark tomorrow; the principal can correct yesterday', async () => {
    const y = await teacher.put('/attendance/sheet', { sectionId, date: yesterday(), period: 0, marks: marks([]) });
    expect(y.statusCode).toBe(403);
    const t = await principal.put('/attendance/sheet', { sectionId, date: tomorrow(), period: 0, marks: marks([]) });
    expect(t.statusCode).toBe(400);
    const p = await principal.put('/attendance/sheet', { sectionId, date: yesterday(), period: 0, marks: marks(['absent']) });
    expect(p.statusCode).toBe(200);
    expect(p.json().parentAlerts).toBe(0); // no "absent today" alert for a past day
  });

  it('"on leave" is counted separately from present and absent', async () => {
    const r = await teacher.put('/attendance/sheet', { sectionId, date: todayIST(), period: 0, marks: marks(['late', 'absent', 'leave']) });
    expect(r.json()).toMatchObject({ present: 1, absent: 1, leave: 1 });
    const home = (await teacher.get('/teacher/today')).json();
    expect(home.sections[0].taken[0]).toMatchObject({ present: 1, absent: 1, leave: 1 });
  });

  it('a period number is refused in once-a-day mode', async () => {
    const r = await teacher.put('/attendance/sheet', { sectionId, date: todayIST(), period: 2, marks: marks([]) });
    expect(r.statusCode).toBe(400);
  });

  it('any teacher can cover another class; it records who took it', async () => {
    const sub = await addMember(env, S.schoolId, ['teacher'], 'Bikash Roy');
    const subApi = api(env, (await loginAs(env, sub.phone)).accessToken, S.schoolId);
    expect((await subApi.get('/teacher/today')).json().sections).toHaveLength(0);
    const all = (await subApi.get('/attendance/sections')).json().sections;
    expect(all.map((s: { sectionId: string }) => s.sectionId)).toContain(sectionId);
    await subApi.put('/attendance/sheet', { sectionId, date: todayIST(), period: 0, marks: marks([]) });
    const sheet = (await teacher.get(`/attendance/sheet?sectionId=${sectionId}`)).json();
    expect(sheet.session.takenBy).toBe('Bikash Roy');
  });

  it('parents and accountants cannot take attendance', async () => {
    const acc = await addMember(env, S.schoolId, ['accountant']);
    const a = api(env, (await loginAs(env, acc.phone)).accessToken, S.schoolId);
    expect((await a.get('/teacher/today')).statusCode).toBe(403);
  });
});

describe('Attendance (every period)', () => {
  it('needs a period number between 1 and the periods in a day', async () => {
    await principal.patch('/school/settings', { attendanceMode: 'period', periodsPerDay: 6 });
    expect((await teacher.put('/attendance/sheet', { sectionId, date: todayIST(), period: 0, marks: marks([]) })).statusCode).toBe(400);
    expect((await teacher.put('/attendance/sheet', { sectionId, date: todayIST(), period: 7, marks: marks([]) })).statusCode).toBe(400);
    const ok = await teacher.put('/attendance/sheet', { sectionId, date: todayIST(), period: 3, marks: marks(['present', 'present', 'absent']) });
    expect(ok.statusCode).toBe(200);
    const home = (await teacher.get('/teacher/today')).json();
    expect(home.mode).toBe('period');
    expect(home.sections[0].taken.map((t: { periodNo: number }) => t.periodNo)).toEqual([0, 3]);
  });
});
