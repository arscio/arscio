// TIMETABLE, TEACHER LEAVE and SUBSTITUTE COVER
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayIST } from '../src/routes/attendance.js';
import { addFamily, addMember, api, loginAs, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let S: Awaited<ReturnType<typeof newSchool>>;
let principal: ReturnType<typeof api>;
let rina: ReturnType<typeof api>;
let bikash: ReturnType<typeof api>;
const T: Record<string, { membershipId: string; accountId: string }> = {};
let sec5: string;
let sec6: string;
let maths: string;

const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekday = (d: string) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w === 0 ? 7 : w; };
// The next Monday after today (always in the future).
const monday = (() => { let d = addDays(todayIST(), 1); while (weekday(d) !== 1) d = addDays(d, 1); return d; })();

beforeAll(async () => {
  env = await setupEnv();
  S = await newSchool(env);
  principal = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['principal'], 'Mrs Bora')).phone)).accessToken, S.schoolId);
  for (const name of ['Rina Das', 'Bikash Roy', 'Tara Devi']) {
    const m = await addMember(env, S.schoolId, ['teacher'], name);
    T[name] = m;
    if (name === 'Rina Das') rina = api(env, (await loginAs(env, m.phone)).accessToken, S.schoolId);
    if (name === 'Bikash Roy') bikash = api(env, (await loginAs(env, m.phone)).accessToken, S.schoolId);
  }
  sec5 = (await addFamily(env, S, ['Arif'])).sectionId;
  const cls6 = (await env.owner.query("SELECT id FROM classes WHERE school_id = $1 AND name = '6'", [S.schoolId])).rows[0].id;
  sec6 = (await env.owner.query("INSERT INTO sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'A') RETURNING id", [S.schoolId, S.yearId, cls6])).rows[0].id;
  maths = (await principal.post('/subjects', { name: 'Mathematics' })).json().id;
});
afterAll(async () => { await env.close(); });

describe('Timetable', () => {
  it('only the principal sets up the timetable', async () => {
    expect((await rina.put('/timetable/slot', { sectionId: sec5, dayNo: 1, periodNo: 1, subjectId: maths, membershipId: T['Rina Das']!.membershipId })).statusCode).toBe(403);
  });

  it('builds a weekly timetable and refuses to put a teacher in two classes at once', async () => {
    const ok = await principal.put('/timetable/slot', { sectionId: sec5, dayNo: 1, periodNo: 1, subjectId: maths, membershipId: T['Rina Das']!.membershipId });
    expect(ok.statusCode).toBe(200);
    await principal.put('/timetable/slot', { sectionId: sec5, dayNo: 1, periodNo: 2, subjectId: maths, membershipId: T['Rina Das']!.membershipId });
    await principal.put('/timetable/slot', { sectionId: sec6, dayNo: 1, periodNo: 2, subjectId: maths, membershipId: T['Bikash Roy']!.membershipId });
    const clash = await principal.put('/timetable/slot', { sectionId: sec6, dayNo: 1, periodNo: 1, subjectId: maths, membershipId: T['Rina Das']!.membershipId });
    expect(clash.statusCode).toBe(400);
    expect(clash.json().error.message).toBe('Rina Das is already teaching Class 5 A in that period');
    const grid = (await principal.get(`/timetable/sections/${sec5}`)).json();
    expect(grid.days.map((d: { label: string }) => d.label)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    expect(grid.slots).toHaveLength(2);
  });

  it('a Day 1-6 cycle moves on only on working days, and skips no-class days', async () => {
    const base = { mode: 'cycle', cycleDays: 6, workingDays: [1, 2, 3, 4, 5, 6], periodsPerDay: 8, periodTimes: [] };
    await principal.put('/timetable/settings', { ...base, cycleStart: monday });
    const dayAt = async (d: string) => {
      const r = (await principal.get(`/cover?date=${d}`)).json();
      return r.day.label;
    };
    expect(await dayAt(monday)).toBe('Day 1');
    expect(await dayAt(addDays(monday, 5))).toBe('Day 6'); // Saturday
    expect(await dayAt(addDays(monday, 6))).toBe('Holiday'); // Sunday
    expect(await dayAt(addDays(monday, 7))).toBe('Day 1'); // next Monday
    // Tuesday becomes a holiday: Wednesday is then Day 2.
    await principal.put(`/timetable/days/${addDays(monday, 1)}`, { noClasses: true, followsDay: null, note: 'Sports day' });
    expect(await dayAt(addDays(monday, 2))).toBe('Day 2');
    expect((await principal.del(`/timetable/days/${addDays(monday, 1)}`)).statusCode).toBe(200);
    // Back to the same timetable every week.
    await principal.put('/timetable/settings', { ...base, mode: 'weekly', cycleStart: null });
    expect(await dayAt(monday)).toBe('Monday');
  });
});

describe('Leave and substitute cover', () => {
  let leaveId: string;

  it('a teacher applies for leave and the principal is told', async () => {
    const r = await rina.post('/leaves', { fromDate: monday, toDate: monday, part: 'full', reason: 'Family wedding' });
    expect(r.statusCode).toBe(200);
    leaveId = r.json().id;
    expect((await rina.post('/leaves', { fromDate: monday, toDate: monday, part: 'full', reason: 'Again' })).statusCode).toBe(400);
    // Both the owner and the principal are told.
    const n = await env.owner.query("SELECT title FROM notifications WHERE data->>'kind' = 'leave_request'");
    expect(n.rows).toEqual([{ title: 'Leave request: Rina Das' }, { title: 'Leave request: Rina Das' }]);
  });

  it('a teacher cannot approve leave; the principal approves and Rina is told', async () => {
    expect((await bikash.post(`/leaves/${leaveId}/decide`, { approve: true })).statusCode).toBe(403);
    expect((await principal.get('/leaves')).json().leaves).toHaveLength(1);
    expect((await principal.post(`/leaves/${leaveId}/decide`, { approve: true, note: 'Enjoy' })).json().status).toBe('approved');
    const n = await env.owner.query("SELECT title FROM notifications WHERE account_id = $1 AND data->>'kind' = 'leave_decision'", [T['Rina Das']!.accountId]);
    expect(n.rows).toEqual([{ title: 'Leave approved' }]);
  });

  it('Rina’s periods show as needing cover, with free teachers listed least busy first', async () => {
    const c = (await principal.get(`/cover?date=${monday}`)).json();
    expect(c.needCover).toBe(2);
    const p1 = c.gaps.find((g: { periodNo: number }) => g.periodNo === 1);
    const p2 = c.gaps.find((g: { periodNo: number }) => g.periodNo === 2);
    // Period 1: Bikash and Tara are both free; Tara has no classes that day so she is first.
    expect(p1.free.map((f: { name: string }) => f.name)).toEqual(['Tara Devi', 'Bikash Roy']);
    // Period 2: Bikash is teaching Class 6 A, so only Tara is free.
    expect(p2.free.map((f: { name: string }) => f.name)).toEqual(['Tara Devi']);
  });

  it('assigns a substitute, tells them, and puts the period on their Today screen', async () => {
    expect((await principal.post('/cover', { date: monday, sectionId: sec5, periodNo: 2, membershipId: T['Bikash Roy']!.membershipId })).statusCode).toBe(400);
    const r = await principal.post('/cover', { date: monday, sectionId: sec5, periodNo: 1, membershipId: T['Bikash Roy']!.membershipId });
    expect(r.statusCode).toBe(200);
    const n = await env.owner.query("SELECT title, body FROM notifications WHERE account_id = $1 AND data->>'kind' = 'cover'", [T['Bikash Roy']!.accountId]);
    expect(n.rows[0].title).toBe('You are covering a class');
    expect(n.rows[0].body).toContain('Class 5 A, period 1');
    const today = (await bikash.get(`/teacher/today?date=${monday}`)).json();
    expect(today.schedule.find((p: { isCover: boolean }) => p.isCover)).toMatchObject({ periodNo: 1, classLabel: 'Class 5 A', coveredFor: 'Rina Das' });
    const rinaDay = (await rina.get(`/teacher/today?date=${monday}`)).json();
    expect(rinaDay.onLeave).toBe('full');
    expect((await principal.get(`/cover?date=${monday}`)).json().needCover).toBe(1);
  });

  it('cancelling a future approved leave removes the cover that was arranged for it', async () => {
    expect((await rina.post(`/leaves/${leaveId}/cancel`)).json().status).toBe('cancelled');
    const c = (await principal.get(`/cover?date=${monday}`)).json();
    expect(c.gaps).toHaveLength(0);
    const subs = await env.owner.query('SELECT count(*)::int AS n FROM substitutions WHERE school_id = $1', [S.schoolId]);
    expect(subs.rows[0].n).toBe(0);
  });
});
