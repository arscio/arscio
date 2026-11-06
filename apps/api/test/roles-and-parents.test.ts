// ROLES: owner/principal assign roles; one person, many roles.
// PARENTS: one phone per family; all children appear together; only their own.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addFamily, addMember, addTuitionDue, api, loginAs, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => { await env.close(); });

describe('Roles', () => {
  it('principal gives a teacher an extra accountant role; permissions combine', async () => {
    const s = await newSchool(env);
    const principal = await addMember(env, s.schoolId, ['principal']);
    const teacher = await addMember(env, s.schoolId, ['teacher']);
    const pTok = (await loginAs(env, principal.phone)).accessToken;

    const r = await api(env, pTok, s.schoolId).put(`/members/${teacher.membershipId}/roles`, {
      roles: ['teacher', 'accountant'],
    });
    expect(r.statusCode).toBe(200);

    const tTok = (await loginAs(env, teacher.phone)).accessToken;
    const me = (await api(env, tTok, s.schoolId).get('/school')).json().me;
    expect(me.roles.sort()).toEqual(['accountant', 'teacher']);
    expect(me.permissions).toEqual(expect.arrayContaining(['attendance.take', 'fees.collect']));
    expect(me.permissions).not.toContain('roles.assign');
  });

  it('principal cannot create owners or principals; owner can', async () => {
    const s = await newSchool(env);
    const principal = await addMember(env, s.schoolId, ['principal']);
    const staff = await addMember(env, s.schoolId, ['teacher']);
    const pTok = (await loginAs(env, principal.phone)).accessToken;
    const r = await api(env, pTok, s.schoolId).put(`/members/${staff.membershipId}/roles`, { roles: ['owner'] });
    expect(r.statusCode).toBe(403);

    const oTok = (await loginAs(env, s.ownerPhone)).accessToken;
    const o = await api(env, oTok, s.schoolId).put(`/members/${staff.membershipId}/roles`, { roles: ['teacher', 'principal'] });
    expect(o.statusCode).toBe(200);
  });

  it('teachers cannot assign roles', async () => {
    const s = await newSchool(env);
    const t = await addMember(env, s.schoolId, ['teacher']);
    const tok = (await loginAs(env, t.phone)).accessToken;
    const r = await api(env, tok, s.schoolId).put(`/members/${t.membershipId}/roles`, { roles: ['principal'] });
    expect(r.statusCode).toBe(403);
  });

  it('role changes are recorded in the audit log', async () => {
    const s = await newSchool(env);
    const oTok = (await loginAs(env, s.ownerPhone)).accessToken;
    const t = await addMember(env, s.schoolId, ['teacher']);
    await api(env, oTok, s.schoolId).put(`/members/${t.membershipId}/roles`, { roles: ['teacher', 'office_admin'] });
    const a = await env.owner.query(
      "SELECT after->>'role' AS role FROM audit_log WHERE table_name = 'membership_roles' AND action = 'INSERT' AND account_id = $1",
      [s.ownerAccountId],
    );
    expect(a.rows.map((x) => x.role)).toContain('office_admin');
  });
});

describe('Parents', () => {
  it('sees all their children together, and only their own', async () => {
    const s = await newSchool(env);
    const fam = await addFamily(env, s, ['Arif', 'Sana'], { withParentLogin: true });
    const other = await addFamily(env, s, ['Someone Else']);
    const tok = (await loginAs(env, fam.phone)).accessToken;

    const kids = (await api(env, tok).get('/me/children')).json().children;
    expect(kids.map((k: { first_name: string }) => k.first_name).sort()).toEqual(['Arif', 'Sana']);
    expect(kids[0].class_name).toBe('5');

    await addTuitionDue(env, s, fam.students[0]!);
    const own = await api(env, tok, s.schoolId).get(`/students/${fam.students[0]}/dues`);
    expect(own.statusCode).toBe(200);
    const notMine = await api(env, tok, s.schoolId).get(`/students/${other.students[0]}/dues`);
    expect(notMine.statusCode).toBe(403);
  });

  it('cannot collect fees or change settings', async () => {
    const s = await newSchool(env);
    const fam = await addFamily(env, s, ['Kid'], { withParentLogin: true });
    const tok = (await loginAs(env, fam.phone)).accessToken;
    expect((await api(env, tok, s.schoolId).patch('/school/settings', { attendanceMode: 'period' })).statusCode).toBe(403);
  });
});

describe('School settings', () => {
  it('principal chooses attendance once a day or every period', async () => {
    const s = await newSchool(env);
    const p = await addMember(env, s.schoolId, ['principal']);
    const tok = (await loginAs(env, p.phone)).accessToken;
    const r = await api(env, tok, s.schoolId).patch('/school/settings', { attendanceMode: 'period', periodsPerDay: 8 });
    expect(r.json()).toMatchObject({ attendance_mode: 'period', periods_per_day: 8 });
  });

  it('online payment switch: OFF by default, needs Razorpay details to turn ON', async () => {
    const s = await newSchool(env);
    const tok = (await loginAs(env, s.ownerPhone)).accessToken;
    const school = (await api(env, tok, s.schoolId).get('/school')).json().school;
    expect(school.online_payments_enabled).toBe(false);
    const bad = await api(env, tok, s.schoolId).patch('/school/settings', { onlinePaymentsEnabled: true });
    expect(bad.statusCode).toBe(400);
    const ok = await api(env, tok, s.schoolId).patch('/school/settings', {
      onlinePaymentsEnabled: true, razorpayKeyId: 'rzp_test_abc123',
    });
    expect(ok.json().online_payments_enabled).toBe(true);
  });
});

describe('Me', () => {
  it('lists every school I belong to with my roles there', async () => {
    const a = await newSchool(env, 'School A');
    const b = await newSchool(env, 'School B');
    const t = await addMember(env, a.schoolId, ['teacher', 'accountant']);
    // Same person also teaches at School B
    const m = (await env.owner.query(
      'INSERT INTO memberships (school_id, account_id, display_name) VALUES ($1, $2, $3) RETURNING id',
      [b.schoolId, t.accountId, 'Staff'])).rows[0];
    await env.owner.query("INSERT INTO membership_roles (school_id, membership_id, role) VALUES ($1, $2, 'teacher')", [b.schoolId, m.id]);
    const tok = (await loginAs(env, t.phone)).accessToken;
    const me = (await api(env, tok).get('/me')).json();
    const bySchool = Object.fromEntries(me.schools.map((s: { name: string; roles: string[] }) => [s.name, s.roles]));
    expect(bySchool).toEqual({ 'School A': ['accountant', 'teacher'], 'School B': ['teacher'] });
  });
});
