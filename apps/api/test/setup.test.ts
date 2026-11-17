// SETUP: sections, subjects, staff, and adding students by hand.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, api, loginAs, newPhone, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let S: Awaited<ReturnType<typeof newSchool>>;
let owner: ReturnType<typeof api>;
let class5: string;

beforeAll(async () => {
  env = await setupEnv();
  S = await newSchool(env);
  owner = api(env, (await loginAs(env, S.ownerPhone)).accessToken, S.schoolId);
  class5 = (await env.owner.query("SELECT id FROM classes WHERE school_id = $1 AND name = '5'", [S.schoolId])).rows[0].id;
});
afterAll(async () => { await env.close(); });

describe('Classes, sections and subjects', () => {
  it('starts with Nursery-UKG (grades) and 1-10 (marks)', async () => {
    const r = (await owner.get('/setup/structure')).json();
    expect(r.year.name).toBe('2027-28');
    expect(r.classes.map((c: { name: string }) => c.name)).toEqual(
      ['Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(r.classes[0].assessment_style).toBe('grades_only');
    expect(r.classes[3].assessment_style).toBe('marks_and_grades');
  });

  it('adds sections; refuses duplicates', async () => {
    // A class's only section has no letter ("Class 5"); the second one makes them A and B.
    expect((await owner.post('/sections', { classId: class5, name: 'a' })).json().name).toBe('');
    expect((await owner.post('/sections', { classId: class5, name: 'B' })).json().name).toBe('B');
    const dup = await owner.post('/sections', { classId: class5, name: 'A' });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error.message).toMatch(/already exists/);
    const c = (await owner.get('/setup/structure')).json().classes.find((x: { name: string }) => x.name === '5');
    expect(c.sections.map((s: { name: string }) => s.name)).toEqual(['A', 'B']);
  });

  it('subjects: add, attach to a class, cannot delete while in use', async () => {
    const eng = (await owner.post('/subjects', { name: 'English', code: 'ENG' })).json();
    const maths = (await owner.post('/subjects', { name: 'Mathematics' })).json();
    expect((await owner.post('/subjects', { name: 'English' })).statusCode).toBe(400);
    expect((await owner.put(`/classes/${class5}/subjects`, { subjectIds: [eng.id, maths.id] })).statusCode).toBe(200);
    const c = (await owner.get('/setup/structure')).json().classes.find((x: { name: string }) => x.name === '5');
    expect(c.subject_ids).toEqual([eng.id, maths.id]);
    const del = await env.app.inject({
      method: 'DELETE', url: `/subjects/${eng.id}`,
      headers: { authorization: `Bearer ${(await loginAs(env, S.ownerPhone)).accessToken}`, 'x-school-id': S.schoolId },
    });
    expect(del.statusCode).toBe(400);
    expect(del.json().error.code).toBe('in_use');
  });
});

describe('Staff', () => {
  it('owner adds a teacher who is also the accountant; they log in with OTP', async () => {
    const phone = newPhone();
    const r = await owner.post('/staff', {
      name: 'Rina Das', phone: phone.slice(3), designation: 'TGT English', roles: ['teacher', 'accountant'],
    });
    expect(r.statusCode).toBe(200);
    const list = (await owner.get('/staff')).json().staff;
    const rina = list.find((s: { name: string }) => s.name === 'Rina Das');
    expect(rina.roles).toEqual(['accountant', 'teacher']);
    expect(rina.hasLoggedIn).toBe(false);

    const tok = (await loginAs(env, phone)).accessToken;
    const me = (await api(env, tok, S.schoolId).get('/school')).json().me;
    expect(me.permissions).toContain('fees.collect');
    expect((await owner.get('/staff')).json().staff.find((s: { name: string }) => s.name === 'Rina Das').hasLoggedIn).toBe(true);
  });

  it('refuses the same phone twice', async () => {
    const phone = newPhone();
    await owner.post('/staff', { name: 'Once', phone, roles: ['teacher'] });
    const again = await owner.post('/staff', { name: 'Twice', phone, roles: ['teacher'] });
    expect(again.statusCode).toBe(400);
  });

  it('principal cannot add another principal; office admin cannot add staff', async () => {
    const p = await addMember(env, S.schoolId, ['principal']);
    const pApi = api(env, (await loginAs(env, p.phone)).accessToken, S.schoolId);
    expect((await pApi.post('/staff', { name: 'New P', phone: newPhone(), roles: ['principal'] })).statusCode).toBe(403);
    expect((await pApi.post('/staff', { name: 'New T', phone: newPhone(), roles: ['teacher'] })).statusCode).toBe(200);
    const o = await addMember(env, S.schoolId, ['office_admin']);
    const oApi = api(env, (await loginAs(env, o.phone)).accessToken, S.schoolId);
    expect((await oApi.post('/staff', { name: 'X', phone: newPhone(), roles: ['teacher'] })).statusCode).toBe(403);
  });

  it('a deactivated staff member can no longer use the school', async () => {
    const phone = newPhone();
    const { membershipId } = (await owner.post('/staff', { name: 'Leaving', phone, roles: ['teacher'] })).json();
    const tok = (await loginAs(env, phone)).accessToken;
    expect((await api(env, tok, S.schoolId).get('/school')).statusCode).toBe(200);
    await env.app.inject({
      method: 'PATCH', url: `/staff/${membershipId}`, payload: { status: 'inactive' },
      headers: { authorization: `Bearer ${(await loginAs(env, S.ownerPhone)).accessToken}`, 'x-school-id': S.schoolId },
    });
    expect((await api(env, tok, S.schoolId).get('/school')).statusCode).toBe(403);
  });
});

describe('Adding students by hand', () => {
  it('two children with the same phone join one family; parent sees both', async () => {
    const sec = (await owner.get('/setup/structure')).json().classes.find((x: { name: string }) => x.name === '5').sections[0];
    const famPhone = newPhone();
    const a = await owner.post('/students', {
      admissionNo: 'A-101', firstName: 'Arif', lastName: 'Ali', gender: 'male', dateOfBirth: '2017-05-02',
      sectionId: sec.id, rollNo: 1, family: { phone: famPhone, fatherName: 'Imran Ali' },
    });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ newFamily: true, siblings: 0 });

    const b = await owner.post('/students', {
      admissionNo: 'A-102', firstName: 'Sana', lastName: 'Ali', sectionId: sec.id, rollNo: 2,
      family: { phone: famPhone.slice(3), motherName: 'Ruksana Ali' },
    });
    expect(b.json()).toMatchObject({ newFamily: false, siblings: 1, familyId: a.json().familyId });

    const dup = await owner.post('/students', {
      admissionNo: 'A-101', firstName: 'X', sectionId: sec.id, family: { phone: newPhone() },
    });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error.message).toMatch(/A-101 is already used/);

    const detail = (await owner.get(`/students/${a.json().id}`)).json();
    expect(detail.family).toMatchObject({ fatherName: 'Imran Ali', motherName: 'Ruksana Ali' });
    expect(detail.siblings).toHaveLength(1);

    // The parent logs in with that phone and sees both children
    const ptok = (await loginAs(env, famPhone)).accessToken;
    const kids = (await api(env, ptok).get('/me/children')).json().children;
    expect(kids.map((k: { first_name: string }) => k.first_name).sort()).toEqual(['Arif', 'Sana']);

    // Search works by name, admission number and phone
    expect((await owner.get('/students?search=sana')).json().students).toHaveLength(1);
    expect((await owner.get('/students?search=A-10')).json().students).toHaveLength(2);
    expect((await owner.get(`/students?search=${famPhone.slice(-6)}`)).json().students).toHaveLength(2);
  });

  it('editing only the fields that were sent; marking a student as left', async () => {
    const sec = (await owner.get('/setup/structure')).json().classes.find((x: { name: string }) => x.name === '5').sections[1];
    const s = (await owner.post('/students', {
      admissionNo: 'E-1', firstName: 'Edit', lastName: 'Me', sectionId: sec.id, family: { phone: newPhone(), fatherName: 'Dad' },
    })).json();
    await env.app.inject({
      method: 'PATCH', url: `/students/${s.id}`, payload: { firstName: 'Edited', family: { address: 'Dhubri' } },
      headers: { authorization: `Bearer ${(await loginAs(env, S.ownerPhone)).accessToken}`, 'x-school-id': S.schoolId },
    });
    const d = (await owner.get(`/students/${s.id}`)).json();
    expect(d).toMatchObject({ firstName: 'Edited', lastName: 'Me' });
    expect(d.family).toMatchObject({ fatherName: 'Dad', address: 'Dhubri' });

    await env.app.inject({
      method: 'PATCH', url: `/students/${s.id}`, payload: { status: 'left' },
      headers: { authorization: `Bearer ${(await loginAs(env, S.ownerPhone)).accessToken}`, 'x-school-id': S.schoolId },
    });
    expect((await owner.get('/students?search=Edited')).json().students).toHaveLength(0);
    expect((await owner.get('/students?search=Edited&status=all')).json().students).toHaveLength(1);
  });

  it('teachers cannot add students', async () => {
    const t = await addMember(env, S.schoolId, ['teacher']);
    const tApi = api(env, (await loginAs(env, t.phone)).accessToken, S.schoolId);
    const sec = (await owner.get('/setup/structure')).json().classes.find((x: { name: string }) => x.name === '5').sections[0];
    expect((await tApi.post('/students', { admissionNo: 'Z', firstName: 'Z', sectionId: sec.id, family: { phone: newPhone() } })).statusCode).toBe(403);
  });
});
