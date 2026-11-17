// PRINCIPAL DASHBOARD and STAFF ATTENDANCE
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayIST } from '../src/routes/attendance.js';
import { addFamily, addMember, addTuitionDue, api, loginAs, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let S: Awaited<ReturnType<typeof newSchool>>;
let principal: ReturnType<typeof api>;
let office: ReturnType<typeof api>;
let teacher: ReturnType<typeof api>;
let teacherM: { membershipId: string };
let officeM: { membershipId: string };
let sectionId: string;
let kids: string[];

const daysAgo = (n: number) => {
  const d = new Date(`${todayIST()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  env = await setupEnv();
  S = await newSchool(env);
  // Every day is a school day here, so the test works on Sundays too
  await env.owner.query("UPDATE schools SET working_days = '{1,2,3,4,5,6,7}' WHERE id = $1", [S.schoolId]);
  principal = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['principal'], 'Mrs Bora')).phone)).accessToken, S.schoolId);
  const o = await addMember(env, S.schoolId, ['office_admin'], 'Priya Office');
  officeM = o;
  office = api(env, (await loginAs(env, o.phone)).accessToken, S.schoolId);
  const t = await addMember(env, S.schoolId, ['teacher'], 'Rina Das');
  teacherM = t;
  teacher = api(env, (await loginAs(env, t.phone)).accessToken, S.schoolId);
  const fam = await addFamily(env, S, ['Arif', 'Sana', 'Tara']);
  sectionId = fam.sectionId;
  kids = fam.students;
});
afterAll(async () => { await env.close(); });

describe('Staff attendance', () => {
  it('the office sees every staff member (not parents), teachers first, and nobody from another school', async () => {
    // Priya (who is logged in) also works at a second school: she must appear only once here.
    const S2 = await newSchool(env, 'Second School');
    const acc = (await env.owner.query('SELECT account_id FROM memberships WHERE id = $1', [officeM.membershipId])).rows[0].account_id;
    const m2 = (await env.owner.query("INSERT INTO memberships (school_id, account_id, display_name) VALUES ($1, $2, 'Priya Office') RETURNING id", [S2.schoolId, acc])).rows[0].id;
    await env.owner.query("INSERT INTO membership_roles (school_id, membership_id, role) VALUES ($1, $2, 'office_admin')", [S2.schoolId, m2]);
    const asRina = (await teacher.get('/staff-attendance')).statusCode;
    expect(asRina).toBe(403);
    const r = (await office.get('/staff-attendance')).json();
    expect(r.staff.filter((s: { name: string }) => s.name === 'Priya Office')).toHaveLength(1);
    expect(r.staff[0].name).toBe('Rina Das');
    expect(r.staff.map((s: { name: string }) => s.name)).toContain('Priya Office');
    expect(r.staff.every((s: { status: string | null }) => s.status === null)).toBe(true);
  });

  it('marks today, refuses future days and days older than a week, and teachers cannot mark it', async () => {
    const ok = await office.put('/staff-attendance', { date: todayIST(), rows: [{ membershipId: teacherM.membershipId, status: 'leave' }, { membershipId: officeM.membershipId, status: 'present' }] });
    expect(ok.json().saved).toBe(2);
    expect((await office.put('/staff-attendance', { date: daysAgo(-1), rows: [{ membershipId: teacherM.membershipId, status: 'present' }] })).statusCode).toBe(400);
    expect((await office.put('/staff-attendance', { date: daysAgo(10), rows: [{ membershipId: teacherM.membershipId, status: 'present' }] })).statusCode).toBe(400);
    expect((await teacher.put('/staff-attendance', { date: todayIST(), rows: [{ membershipId: teacherM.membershipId, status: 'present' }] })).statusCode).toBe(403);
  });
});

describe('Dashboard', () => {
  it('only the principal/owner can see it', async () => {
    expect((await office.get('/dashboard')).statusCode).toBe(403);
    expect((await teacher.get('/dashboard')).statusCode).toBe(403);
  });

  it('shows attendance, teachers present, fees and an attention list', async () => {
    // Nobody took attendance yet: it should be on the attention list.
    let d = (await principal.get('/dashboard')).json();
    expect(d.attendance).toMatchObject({ totalStudents: 3, marked: 0, sectionsTaken: 0, sectionsTotal: 1 });
    expect(d.attention.some((a: { kind: string }) => a.kind === 'attendance')).toBe(true);
    expect(d.staff).toMatchObject({ teachers: 1, teachersIn: 0 });
    expect(d.staff.away).toEqual([{ name: 'Rina Das', status: 'leave' }]);

    // Arif absent for the last 3 school days -> "absent 3 days in a row".
    for (const n of [2, 1, 0]) {
      const ses = (await env.owner.query(
        'INSERT INTO attendance_sessions (school_id, section_id, on_date, period_no, taken_by) VALUES ($1, $2, $3, 0, (SELECT account_id FROM memberships WHERE id = $4)) RETURNING id',
        [S.schoolId, sectionId, daysAgo(n), teacherM.membershipId])).rows[0].id;
      for (const [i, k] of kids.entries()) {
        await env.owner.query('INSERT INTO attendance_marks (school_id, session_id, student_id, status) VALUES ($1, $2, $3, $4)',
          [S.schoolId, ses, k, i === 0 ? 'absent' : 'present']);
      }
    }
    // An overdue fee (due date in the past) makes a defaulter.
    const dueId = await addTuitionDue(env, S, kids[1]!);
    await env.owner.query("UPDATE fee_instalments SET due_on = $2 WHERE id = (SELECT instalment_id FROM fee_dues WHERE id = $1)", [dueId, daysAgo(20)]);

    d = (await principal.get('/dashboard')).json();
    expect(d.attendance).toMatchObject({ marked: 3, present: 2, absent: 1, sectionsTaken: 1 });
    expect(d.attendance.pct).toBeCloseTo(66.7, 1);
    expect(d.attention.some((a: { kind: string }) => a.kind === 'attendance')).toBe(false);
    expect(d.attention.find((a: { kind: string }) => a.kind === 'absent_streak').text).toContain('Arif');
    expect(d.fees.defaulterCount).toBe(1);
    expect(d.fees.topDefaulters[0].name).toContain('Sana');
    expect(d.fees.months).toHaveLength(6);
  });
});

describe('Staff list', () => {
  it('a person who works at two schools sees only this school’s staff on the staff page', async () => {
    const r = (await office.get('/staff')).json();
    expect(r.staff.filter((s: { name: string }) => s.name === 'Priya Office')).toHaveLength(1);
  });
});

describe('Holidays', () => {
  it('does not ask for attendance on a day with no school', async () => {
    await env.owner.query("UPDATE schools SET working_days = '{}' WHERE id = $1", [S.schoolId]);
    const d = (await principal.get('/dashboard')).json();
    expect(d.holiday).toBe('No school today');
    expect(d.attention.some((a: { kind: string }) => a.kind === 'attendance' || a.kind === 'staff')).toBe(false);
    await env.owner.query("UPDATE schools SET working_days = '{1,2,3,4,5,6,7}' WHERE id = $1", [S.schoolId]);
  });
});
