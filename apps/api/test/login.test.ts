// LOGIN: OTP first time -> set password -> phone + password -> forgot = OTP reset
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, api, newPhone, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => { await env.close(); });

const post = (url: string, payload: object) => env.app.inject({ method: 'POST', url, payload });

describe('Login flow (same for parents and teachers)', () => {
  it('first login: OTP, then the person sets a password', async () => {
    const school = await newSchool(env);
    const t = await addMember(env, school.schoolId, ['teacher'], 'Teacher Rina');
    const localPhone = t.phone.slice(3); // they type 10 digits, no +91

    const start = await post('/auth/start', { phone: localPhone });
    expect(start.json()).toEqual({ next: 'otp' });
    const sms = env.otp.last(t.phone)!;
    expect(sms.purpose).toBe('first_login');

    const wrong = await post('/auth/verify-otp', { phone: localPhone, code: sms.code === '000000' ? '111111' : '000000' });
    expect(wrong.statusCode).toBe(400);

    const ok = await post('/auth/verify-otp', { phone: localPhone, code: sms.code });
    expect(ok.statusCode).toBe(200);
    const { setupToken } = ok.json();

    const weak = await post('/auth/set-password', { setupToken, password: '123456' });
    expect(weak.statusCode).toBe(400);

    const set = await post('/auth/set-password', { setupToken, password: 'Rina@2027' });
    expect(set.statusCode).toBe(200);
    expect(set.json().account.name).toBe('Teacher Rina');

    // The same "set password" ticket cannot be used twice.
    const again = await post('/auth/set-password', { setupToken, password: 'Other@2027' });
    expect(again.statusCode).toBe(401);

    // From now on: phone + password
    expect((await post('/auth/start', { phone: localPhone })).json()).toEqual({ next: 'password' });
    const login = await post('/auth/login', { phone: localPhone, password: 'Rina@2027' });
    expect(login.statusCode).toBe(200);
    expect(login.json().accessToken).toBeTruthy();
  });

  it('unknown numbers get the same answer but no SMS is sent', async () => {
    const phone = newPhone();
    const before = env.otp.sent.length;
    expect((await post('/auth/start', { phone })).json()).toEqual({ next: 'otp' });
    expect(env.otp.sent.length).toBe(before);
  });

  it('locks the login for 15 minutes after 5 wrong passwords', async () => {
    const school = await newSchool(env);
    const p = await addMember(env, school.schoolId, ['parent']);
    await post('/auth/start', { phone: p.phone });
    const v = await post('/auth/verify-otp', { phone: p.phone, code: env.otp.last(p.phone)!.code });
    await post('/auth/set-password', { setupToken: v.json().setupToken, password: 'Family#99' });

    for (let i = 0; i < 5; i++) {
      expect((await post('/auth/login', { phone: p.phone, password: 'nope-nope' })).statusCode).toBe(401);
    }
    const locked = await post('/auth/login', { phone: p.phone, password: 'Family#99' });
    expect(locked.statusCode).toBe(429);
  });

  it('forgot password: OTP reset, and old devices are logged out', async () => {
    const school = await newSchool(env);
    const p = await addMember(env, school.schoolId, ['parent']);
    await post('/auth/start', { phone: p.phone });
    const v1 = await post('/auth/verify-otp', { phone: p.phone, code: env.otp.last(p.phone)!.code });
    const first = (await post('/auth/set-password', { setupToken: v1.json().setupToken, password: 'First#Pass' })).json();

    await post('/auth/forgot', { phone: p.phone });
    const sms = env.otp.last(p.phone)!;
    expect(sms.purpose).toBe('reset_password');
    const v2 = await post('/auth/verify-otp', { phone: p.phone, code: sms.code });
    const second = await post('/auth/set-password', { setupToken: v2.json().setupToken, password: 'Second#Pass' });
    expect(second.statusCode).toBe(200);

    expect((await post('/auth/login', { phone: p.phone, password: 'First#Pass' })).statusCode).toBe(401);
    expect((await post('/auth/login', { phone: p.phone, password: 'Second#Pass' })).statusCode).toBe(200);
    // The phone that was logged in before the reset can no longer stay logged in.
    expect((await post('/auth/refresh', { refreshToken: first.refreshToken })).statusCode).toBe(401);
  });

  it('stay-logged-in token works once and is then replaced', async () => {
    const school = await newSchool(env);
    const p = await addMember(env, school.schoolId, ['parent']);
    await post('/auth/start', { phone: p.phone });
    const v = await post('/auth/verify-otp', { phone: p.phone, code: env.otp.last(p.phone)!.code });
    const s = (await post('/auth/set-password', { setupToken: v.json().setupToken, password: 'Stay#In123' })).json();
    const r1 = await post('/auth/refresh', { refreshToken: s.refreshToken });
    expect(r1.statusCode).toBe(200);
    expect((await post('/auth/refresh', { refreshToken: s.refreshToken })).statusCode).toBe(401);
    expect((await post('/auth/refresh', { refreshToken: r1.json().refreshToken })).statusCode).toBe(200);
  });

  it('only 3 OTPs per 15 minutes per phone', async () => {
    const school = await newSchool(env);
    const p = await addMember(env, school.schoolId, ['parent']);
    for (let i = 0; i < 3; i++) expect((await post('/auth/start', { phone: p.phone })).statusCode).toBe(200);
    expect((await post('/auth/start', { phone: p.phone })).statusCode).toBe(429);
  });

  it('school office can reset a parent login; they log in with OTP again', async () => {
    const school = await newSchool(env);
    const office = await addMember(env, school.schoolId, ['office_admin']);
    const parent = await addMember(env, school.schoolId, ['parent']);
    await post('/auth/start', { phone: parent.phone });
    const v = await post('/auth/verify-otp', { phone: parent.phone, code: env.otp.last(parent.phone)!.code });
    await post('/auth/set-password', { setupToken: v.json().setupToken, password: 'Parent#One' });

    await post('/auth/start', { phone: office.phone });
    const ov = await post('/auth/verify-otp', { phone: office.phone, code: env.otp.last(office.phone)!.code });
    const officeSession = (await post('/auth/set-password', { setupToken: ov.json().setupToken, password: 'Office#One' })).json();

    const r = await api(env, officeSession.accessToken, school.schoolId).post(`/accounts/${parent.accountId}/reset-login`);
    expect(r.statusCode).toBe(200);
    expect((await post('/auth/start', { phone: parent.phone })).json()).toEqual({ next: 'otp' });
    expect((await post('/auth/login', { phone: parent.phone, password: 'Parent#One' })).statusCode).toBe(401);
  });

  it('an office in another school cannot reset this school\'s parent', async () => {
    const a = await newSchool(env, 'School A');
    const b = await newSchool(env, 'School B');
    const officeB = await addMember(env, b.schoolId, ['office_admin']);
    const parentA = await addMember(env, a.schoolId, ['parent']);
    await post('/auth/start', { phone: officeB.phone });
    const v = await post('/auth/verify-otp', { phone: officeB.phone, code: env.otp.last(officeB.phone)!.code });
    const s = (await post('/auth/set-password', { setupToken: v.json().setupToken, password: 'OfficeB#1' })).json();
    const r = await api(env, s.accessToken, b.schoolId).post(`/accounts/${parentA.accountId}/reset-login`);
    expect(r.statusCode).toBe(404);
  });
});
