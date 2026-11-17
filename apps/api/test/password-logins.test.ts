// Logins without SMS (LOGIN_MODE=password), as agreed for the first real school:
//  - staff: email or mobile + password the principal sets; must change it first time
//  - only owner/principal add staff, set their passwords, or remove them
//  - parents: admission number (any format) + child's date of birth (DDMMYYYY) the first time
//  - one login per family, lockout after wrong tries, reset back to date of birth by the office
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/passwords.js';
import { addFamily, addMember, api, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setupEnv({ loginMode: 'password' }); });
afterAll(async () => { await env.close(); });

const login = (identifier: string, password: string) =>
  env.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier, password } });

async function ownerToken(s: { ownerPhone: string }) {
  await env.owner.query('UPDATE accounts SET password_hash = $2 WHERE phone = $1', [s.ownerPhone, await hashPassword('Owner#Pass1')]);
  return (await login(s.ownerPhone, 'Owner#Pass1')).json().accessToken as string;
}

async function familyWithDob(s: { schoolId: string; yearId: string }, dob = '2015-08-05') {
  const f = await addFamily(env, s, ['Tanvi', 'Aman']);
  const adm = `GV/2027/${Math.floor(Math.random() * 90000) + 10000}`;
  await env.owner.query('UPDATE students SET admission_no = $2, date_of_birth = $3 WHERE id = $1', [f.students[0], adm, dob]);
  await env.owner.query("UPDATE students SET date_of_birth = '2018-01-20' WHERE id = $1", [f.students[1]]);
  return { ...f, adm };
}

describe('Login mode', () => {
  it('tells the apps it is password mode and switches SMS off', async () => {
    expect((await env.app.inject({ method: 'GET', url: '/auth/mode' })).json()).toEqual({ mode: 'password' });
    const r = await env.app.inject({ method: 'POST', url: '/auth/start', payload: { phone: '9876543210' } });
    expect(r.json().error.code).toBe('otp_off');
  });
});

describe('Staff logins', () => {
  it('principal adds a teacher with email + first password; teacher logs in by email or mobile and must change it', async () => {
    const s = await newSchool(env);
    const oTok = await ownerToken(s);
    const add = await api(env, oTok, s.schoolId).post('/staff', {
      name: 'Meena Das', phone: '9123456780', email: 'Meena.Das@School.in', password: 'Welcome@123', roles: ['teacher'],
    });
    expect(add.statusCode).toBe(200);

    const first = await login('meena.das@school.in', 'Welcome@123');
    expect(first.statusCode).toBe(200);
    expect(first.json().mustChangePassword).toBe(true);
    const tok = first.json().accessToken;
    // Nothing else works until the password is changed
    const blocked = await api(env, tok, s.schoolId).get('/school');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('must_change_password');
    expect((await api(env, tok).get('/me')).json().account.mustChangePassword).toBe(true);

    expect((await api(env, tok).post('/auth/change-password', { newPassword: 'Welcome@123' })).json().error.code).toBe('same_password');
    const ch = await api(env, tok).post('/auth/change-password', { newPassword: 'Meena#2027' });
    expect(ch.statusCode).toBe(200);
    expect(ch.json().mustChangePassword).toBe(false);
    expect((await api(env, ch.json().accessToken, s.schoolId).get('/school')).statusCode).toBe(200);

    // Old one no longer works; mobile number works as well as email
    expect((await login('meena.das@school.in', 'Welcome@123')).statusCode).toBe(401);
    expect((await login('91234 56780', 'Meena#2027')).statusCode).toBe(200);

    // Later changes need the old password
    const t2 = (await login('9123456780', 'Meena#2027')).json().accessToken;
    expect((await api(env, t2).post('/auth/change-password', { oldPassword: 'wrong', newPassword: 'Another#1' })).json().error.code).toBe('wrong_password');
    expect((await api(env, t2).post('/auth/change-password', { oldPassword: 'Meena#2027', newPassword: 'Another#1' })).statusCode).toBe(200);
  });

  it('only owner/principal can add staff or set their passwords', async () => {
    const s = await newSchool(env);
    const oTok = await ownerToken(s);
    const office = await addMember(env, s.schoolId, ['office_admin']);
    await api(env, oTok, s.schoolId).post(`/staff/${office.membershipId}/password`, { password: 'Office@123' });
    let offTok = (await login(office.phone, 'Office@123')).json().accessToken;
    offTok = (await api(env, offTok).post('/auth/change-password', { newPassword: 'Office#2027' })).json().accessToken;
    const o = api(env, offTok, s.schoolId);
    expect((await o.post('/staff', { name: 'X Y', phone: '9000000011', password: 'abc@1234', roles: ['teacher'] })).statusCode).toBe(403);
    const teacher = await addMember(env, s.schoolId, ['teacher']);
    expect((await o.post(`/staff/${teacher.membershipId}/password`, { password: 'Hack@1234' })).statusCode).toBe(403);
  });

  it('a principal cannot take over the owner login', async () => {
    const s = await newSchool(env);
    const oTok = await ownerToken(s);
    const p = await addMember(env, s.schoolId, ['principal']);
    await api(env, oTok, s.schoolId).post(`/staff/${p.membershipId}/password`, { password: 'Princ@123' });
    let pTok = (await login(p.phone, 'Princ@123')).json().accessToken;
    pTok = (await api(env, pTok).post('/auth/change-password', { newPassword: 'Princ#2027' })).json().accessToken;
    const ownerMembership = (await env.owner.query(
      'SELECT m.id FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE a.phone = $1', [s.ownerPhone])).rows[0].id;
    expect((await api(env, pTok, s.schoolId).post(`/staff/${ownerMembership}/password`, { password: 'Taken@123' })).statusCode).toBe(403);
    expect((await api(env, pTok, s.schoolId).patch(`/staff/${ownerMembership}`, { status: 'inactive' })).statusCode).toBe(403);
  });

  it('removing a teacher who left logs them out everywhere', async () => {
    const s = await newSchool(env);
    const oTok = await ownerToken(s);
    const t = await addMember(env, s.schoolId, ['teacher']);
    await api(env, oTok, s.schoolId).post(`/staff/${t.membershipId}/password`, { password: 'Teach@123' });
    const first = (await login(t.phone, 'Teach@123')).json();
    const sess = (await api(env, first.accessToken).post('/auth/change-password', { newPassword: 'Teach#2027' })).json();
    expect((await api(env, oTok, s.schoolId).patch(`/staff/${t.membershipId}`, { status: 'inactive' })).statusCode).toBe(200);
    expect((await api(env, sess.accessToken, s.schoolId).get('/school')).statusCode).toBe(403);
    const refresh = await env.app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: sess.refreshToken } });
    expect(refresh.statusCode).toBe(401);
  });

  it('the same email cannot be used twice', async () => {
    const s = await newSchool(env);
    const oTok = await ownerToken(s);
    const a = api(env, oTok, s.schoolId);
    expect((await a.post('/staff', { name: 'One Person', phone: '9111111122', email: 'same@school.in', roles: ['teacher'] })).statusCode).toBe(200);
    const dup = await a.post('/staff', { name: 'Two Person', phone: '9111111133', email: 'SAME@school.in', roles: ['teacher'] });
    expect(dup.json().error.code).toBe('duplicate');
  });
});

describe('Parent logins', () => {
  it('admission number in any format + date of birth, then must change; one login for the family', async () => {
    const s = await newSchool(env);
    const f = await familyWithDob(s);
    const typed = f.adm.replace(/\//g, '').toLowerCase(); // gv202712345
    expect((await login(typed, '05/08/2015')).statusCode).toBe(200); // slashes in the date are fine too
    const first = await login(f.adm, '05082015');
    expect(first.json().mustChangePassword).toBe(true);
    const ch = await api(env, first.json().accessToken).post('/auth/change-password', { newPassword: 'Family#2027' });
    expect(ch.statusCode).toBe(200);
    const kids = (await api(env, ch.json().accessToken).get('/me/children')).json();
    expect(JSON.stringify(kids)).toContain('Tanvi');
    expect(JSON.stringify(kids)).toContain('Aman');
    // date of birth no longer works; the new password does
    expect((await login(f.adm, '05082015')).statusCode).toBe(401);
    expect((await login(typed, 'Family#2027')).statusCode).toBe(200);
  });

  it('a date of birth cannot be the new password', async () => {
    const s = await newSchool(env);
    const f = await familyWithDob(s);
    const tok = (await login(f.adm, '05082015')).json().accessToken;
    expect((await api(env, tok).post('/auth/change-password', { newPassword: '01012016' })).json().error.code).toBe('weak_password');
  });

  it('locks after 5 wrong tries', async () => {
    const s = await newSchool(env);
    const f = await familyWithDob(s);
    for (let i = 0; i < 5; i++) expect((await login(f.adm, `0101200${i}`)).statusCode).toBe(401);
    expect((await login(f.adm, '05082015')).statusCode).toBe(429);
  });

  it('office resets a parent back to the date of birth', async () => {
    const s = await newSchool(env);
    const oTok = await ownerToken(s);
    const office = await addMember(env, s.schoolId, ['office_admin']);
    await api(env, oTok, s.schoolId).post(`/staff/${office.membershipId}/password`, { password: 'Office@123' });
    const offTok = (await api(env, (await login(office.phone, 'Office@123')).json().accessToken)
      .post('/auth/change-password', { newPassword: 'Office#2027' })).json().accessToken;

    const f = await familyWithDob(s);
    const t = (await login(f.adm, '05082015')).json().accessToken;
    await api(env, t).post('/auth/change-password', { newPassword: 'Forgot#Me1' });
    const acc = (await env.owner.query('SELECT account_id FROM families WHERE id = $1', [f.familyId])).rows[0].account_id;
    expect((await api(env, offTok, s.schoolId).post(`/accounts/${acc}/reset-login`)).statusCode).toBe(200);
    expect((await login(f.adm, 'Forgot#Me1')).statusCode).toBe(401);
    const again = await login(f.adm, '05082015');
    expect(again.statusCode).toBe(200);
    expect(again.json().mustChangePassword).toBe(true);
  });

  it("a child's date of birth never opens a staff member's login", async () => {
    const s = await newSchool(env);
    const f = await familyWithDob(s);
    // The father also works at the school but has not logged in yet
    const acc = (await env.owner.query('SELECT id FROM accounts WHERE phone = $1', [f.phone])).rows[0]
      ?? (await env.owner.query("INSERT INTO accounts (phone, name) VALUES ($1, 'Father') RETURNING id", [f.phone])).rows[0];
    const m = (await env.owner.query(
      "INSERT INTO memberships (school_id, account_id, display_name) VALUES ($1, $2, 'Father') ON CONFLICT (school_id, account_id) DO UPDATE SET display_name = 'Father' RETURNING id",
      [s.schoolId, acc.id])).rows[0];
    await env.owner.query("INSERT INTO membership_roles (school_id, membership_id, role) VALUES ($1, $2, 'teacher')", [s.schoolId, m.id]);
    expect((await login(f.adm, '05082015')).statusCode).toBe(401);
  });

  it('wrong admission numbers and unknown emails give the same answer', async () => {
    const a = await login('NOPE/0000/1', '05082015');
    const b = await login('nobody@nowhere.in', 'whatever1');
    expect(a.statusCode).toBe(401);
    expect(a.json().error.message).toBe(b.json().error.message);
  });
});

describe('Parent login list and slips', () => {
  it('shows missing dates of birth, prints slips, office resets a locked family', async () => {
    const s = await newSchool(env);
    const oTok = await ownerToken(s);
    const f = await familyWithDob(s);
    const g = await addFamily(env, s, ['NoDob']); // no date of birth
    const a = api(env, oTok, s.schoolId);

    const problems = (await a.get('/parent-logins')).json();
    expect(problems.missingDob).toBe(1);
    expect(problems.students.map((x: { id: string }) => x.id)).toEqual([g.students[0]]);

    const list = (await a.get(`/parent-logins?sectionId=${f.sectionId}`)).json();
    expect(list.students.find((x: { id: string }) => x.id === f.students[0]).status).toBe('not_started');

    const pdf = await a.get(`/parent-logins/slips.pdf?sectionId=${f.sectionId}`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');

    for (let i = 0; i < 5; i++) await login(f.adm, '11111111');
    expect((await a.get('/parent-logins')).json().students.some((x: { id: string; locked: boolean }) => x.id === f.students[0] && x.locked)).toBe(true);
    expect((await a.post(`/parent-logins/${f.students[0]}/reset`)).statusCode).toBe(200);
    expect((await login(f.adm, '05082015')).statusCode).toBe(200);
  });

  it('office cannot use the general reset on a staff login in password mode', async () => {
    const s = await newSchool(env);
    const oTok = await ownerToken(s);
    const office = await addMember(env, s.schoolId, ['office_admin']);
    await api(env, oTok, s.schoolId).post(`/staff/${office.membershipId}/password`, { password: 'Office@123' });
    const offTok = (await api(env, (await login(office.phone, 'Office@123')).json().accessToken)
      .post('/auth/change-password', { newPassword: 'Office#2027' })).json().accessToken;
    const principal = await addMember(env, s.schoolId, ['principal']);
    expect((await api(env, offTok, s.schoolId).post(`/accounts/${principal.accountId}/reset-login`)).statusCode).toBe(403);
  });
});
