// A whole school shares one internet address (office Wi-Fi), and parents on Jio/Airtel often share one
// too. Limits must be per person, so 45 staff logging in at 9 am never block each other, while one
// person hammering the login is still stopped.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/passwords.js';
import { newPhone, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setupEnv({ loginMode: 'password', rateLimit: true }); });
afterAll(async () => { await env.close(); });

const SAME_WIFI = '203.0.113.7';
const login = (identifier: string, password: string) =>
  env.app.inject({ method: 'POST', url: '/auth/login', remoteAddress: SAME_WIFI, payload: { identifier, password } });

describe('Many people on one Wi-Fi', () => {
  it('45 staff log in, refresh and use the app from the same address without being blocked', async () => {
    await newSchool(env);
    const hash = await hashPassword('Staff#Pass1');
    const phones: string[] = [];
    for (let i = 0; i < 45; i++) {
      const phone = newPhone();
      await env.owner.query(
        'INSERT INTO accounts (phone, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (phone) DO UPDATE SET password_hash = $3',
        [phone, `Staff ${i}`, hash]);
      phones.push(phone);
    }
    const tokens: { accessToken: string; refreshToken: string }[] = [];
    for (const p of phones) {
      const r = await login(p, 'Staff#Pass1');
      expect(r.statusCode).toBe(200);
      tokens.push(r.json());
    }
    for (const t of tokens) {
      const r = await env.app.inject({ method: 'POST', url: '/auth/refresh', remoteAddress: SAME_WIFI, payload: { refreshToken: t.refreshToken } });
      expect(r.statusCode).toBe(200);
    }
    // Everyone opens a few screens: 45 x 8 = 360 requests from one address, above the old 300 limit.
    for (const t of tokens) {
      for (let k = 0; k < 8; k++) {
        const r = await env.app.inject({ method: 'GET', url: '/me', remoteAddress: SAME_WIFI, headers: { authorization: `Bearer ${t.accessToken}` } });
        expect(r.statusCode).toBe(200);
      }
    }
  });

  it('one person trying to log in again and again is still stopped', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 25; i++) codes.push((await login('9000000001', 'wrong-guess')).statusCode);
    expect(codes).toContain(429);
  });
});
