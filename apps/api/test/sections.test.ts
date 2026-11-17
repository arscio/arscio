// Sections only when needed (decided 17 Nov 2026):
//  - one section = no letter ("Class 6"); a second one makes them "6 A" and "6 B"
//  - each section has seats; admission is never blocked, the principal is told instead
//  - the principal keeps it as it is, or makes a new section and chooses who moves
//  - removing a section until one is left takes the letter away again
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, api, loginAs, newPhone, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let S: Awaited<ReturnType<typeof newSchool>>;
let owner: ReturnType<typeof api>;
let office: ReturnType<typeof api>;
let class6: string;

const structure = async () => (await owner.get('/setup/structure')).json();
const class6Sections = async () => (await structure()).classes.find((c: { name: string }) => c.name === '6').sections;
const admit = (sectionId: string, n: number) => office.post('/students', {
  firstName: `Child${n}`, lastName: 'Das', sectionId, family: { phone: newPhone(), fatherName: 'Father' },
});

beforeAll(async () => {
  env = await setupEnv();
  S = await newSchool(env);
  owner = api(env, (await loginAs(env, S.ownerPhone)).accessToken, S.schoolId);
  const o = await addMember(env, S.schoolId, ['office_admin'], 'Office');
  office = api(env, (await loginAs(env, o.phone)).accessToken, S.schoolId);
  class6 = (await env.owner.query("SELECT id FROM classes WHERE school_id = $1 AND name = '6'", [S.schoolId])).rows[0].id;
});
afterAll(async () => { await env.close(); });

describe('Sections when needed', () => {
  let only: string;
  const kids: string[] = [];

  it('a class with one section has no letter', async () => {
    only = (await owner.post('/sections', { classId: class6 })).json().id;
    const s = await class6Sections();
    expect(s.map((x: { name: string }) => x.name)).toEqual(['']);
    expect((await owner.patch(`/sections/${only}`, { name: 'A' })).json().error.code).toBe('single_section');
  });

  it('admission past the seats goes through, and the principal is told', async () => {
    expect((await owner.patch(`/sections/${only}`, { seats: 3 })).statusCode).toBe(200);
    for (let i = 1; i <= 3; i++) {
      const r = await admit(only, i);
      expect(r.statusCode).toBe(200);
      expect(r.json().overSeats).toBeNull();
      kids.push(r.json().id);
    }
    const r = await admit(only, 4);
    expect(r.statusCode).toBe(200);
    expect(r.json().overSeats).toEqual({ label: 'Class 6', students: 4, seats: 3 });
    kids.push(r.json().id);

    const alerts = (await structure()).seatAlerts;
    expect(alerts).toEqual([expect.objectContaining({ classId: class6, label: 'Class 6', students: 4, seats: 3 })]);
    const d = (await owner.get('/dashboard')).json();
    expect(d.attention.find((a: { kind: string }) => a.kind === 'seats').text).toMatch(/Class 6 has 4 students for 3 seats/);
  });

  it('"keep as it is" hides the notice until more students join', async () => {
    expect((await owner.post(`/sections/${only}/keep`)).json().seatsOkUpTo).toBe(4);
    expect((await structure()).seatAlerts).toEqual([]);
    kids.push((await admit(only, 5)).json().id);
    expect((await structure()).seatAlerts).toHaveLength(1);
  });

  it('only the principal/owner decides', async () => {
    expect((await office.post(`/classes/${class6}/split`, { studentIds: [kids[0]] })).statusCode).toBe(403);
    expect((await office.post(`/sections/${only}/keep`)).statusCode).toBe(403);
  });

  it('making a new section: the old one becomes A, chosen students move to B with the same seats', async () => {
    const r = await owner.post(`/classes/${class6}/split`, { studentIds: [kids[3]!, kids[4]!] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ section: { name: 'B' }, moved: 2 });
    const s = await class6Sections();
    expect(s.map((x: { name: string; students: number; seats: number }) => [x.name, x.students, x.seats]))
      .toEqual([['A', 3, 3], ['B', 2, 3]]);
    expect((await structure()).seatAlerts).toEqual([]);
    // Shown as "Class 6 A" / "Class 6 B" now
    const list = (await owner.get(`/students?sectionId=${s[1].id}`)).json();
    expect(JSON.stringify(list)).toContain('"sectionName":"B"');
  });

  it('students can be moved between sections of the same class only', async () => {
    const [a, b] = await class6Sections();
    expect((await owner.post('/students/move', { studentIds: [kids[0]], toSectionId: b.id })).json().moved).toBe(1);
    const class7 = (await env.owner.query("SELECT id FROM classes WHERE school_id = $1 AND name = '7'", [S.schoolId])).rows[0].id;
    const s7 = (await owner.post('/sections', { classId: class7 })).json().id;
    expect((await owner.post('/students/move', { studentIds: [kids[1]], toSectionId: s7 })).json().error.code).toBe('wrong_class');
    // move back so A can be emptied below
    await owner.post('/students/move', { studentIds: [kids[0]], toSectionId: a.id });
  });

  it('removing a section with students is refused; when one is left it loses its letter', async () => {
    const [a, b] = await class6Sections();
    expect((await owner.del(`/sections/${b.id}`)).statusCode).toBe(400);
    await owner.post('/students/move', { studentIds: [kids[3]!, kids[4]!], toSectionId: a.id });
    expect((await owner.del(`/sections/${b.id}`)).statusCode).toBe(200);
    const s = await class6Sections();
    expect(s.map((x: { name: string; students: number }) => [x.name, x.students])).toEqual([['', 5]]);
  });
});
