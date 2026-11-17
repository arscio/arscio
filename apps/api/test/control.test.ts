// CONTROL PANEL (for the Arscio team only): login, onboarding a school, pausing it,
// owner password reset, health warnings, server errors kept for us.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/passwords.js';
import { buildControlApp, currentSession } from '../src/control/app.js';
import { TEST_OWNER_URL } from './global-setup.js';
import { api, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let owner: pg.Pool;
let control: Awaited<ReturnType<typeof buildControlApp>>;
let cookie = '';

const fakeSystem = {
  services: async () => [{ unit: 'arscio-api', label: 'Arscio server', state: 'active', since: new Date().toISOString(), restarts: 0, memoryMb: 120 }],
  machine: async () => ({ hostname: 'test', upSince: new Date().toISOString(), load: [0.1, 0.1, 0.1], cpus: 2,
    memory: { totalMb: 1900, availableMb: 700 }, swap: { totalMb: 0, usedMb: 0 }, disk: { totalGb: 40, freeGb: 4, usedPct: 91 } }),
  backups: async (folder: string) => ({ folder, found: false, last: null, files: [] }),
  ping: async () => ({ ok: true, ms: 12, status: 200 }),
  crashes: async () => [],
  logErrors: async () => [],
};
const call = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  control.inject({ method, url, payload: payload as object, headers: cookie ? { cookie } : {} });

beforeAll(async () => {
  env = await setupEnv({ loginMode: 'password' });
  owner = new pg.Pool({ connectionString: TEST_OWNER_URL });
  control = await buildControlApp({
    owner, passwordHash: await hashPassword('Control#Pass1'), secret: 'test-secret-test-secret-test-secret',
    apiUrl: 'http://x', webUrl: 'http://x', backupDir: '/nonexistent', loginMode: 'password',
    publicWebUrl: 'https://app.arscio.in', system: fakeSystem,
  });
});
afterAll(async () => { await control.close(); await owner.end(); await env.close(); });

describe('Control panel login', () => {
  it('needs the control panel password', async () => {
    expect((await call('GET', '/api/schools')).statusCode).toBe(401);
    expect((await call('POST', '/api/login', { password: 'wrong' })).statusCode).toBe(401);
    const r = await call('POST', '/api/login', { password: 'Control#Pass1' });
    expect(r.statusCode).toBe(200);
    cookie = String(r.headers['set-cookie']).split(';')[0]!;
    expect((await call('GET', '/api/me')).json().loggedIn).toBe(true);
  });

  it('serves the page', async () => {
    const r = await call('GET', '/');
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('Arscio control');
  });
});

describe('Onboarding a school', () => {
  const code = `T${Date.now().toString(36).toUpperCase()}`;
  let schoolId = ''; let password = '';

  it('creates the school, classes and the owner login with a one-time password', async () => {
    const r = await call('POST', '/api/schools', {
      name: 'Green Valley Public School', code, board: 'CBSE', address: 'Dhubri',
      ownerName: 'Rafiqul Islam', ownerPhone: '97000 12345', ownerEmail: 'Owner.GV@Example.in', session: currentSession(),
    });
    expect(r.statusCode).toBe(200);
    ({ schoolId, password } = r.json());
    expect(password).toMatch(/^[A-Za-z2-9]{10}$/);
    const classes = (await owner.query('SELECT count(*)::int AS n FROM classes WHERE school_id = $1', [schoolId])).rows[0].n;
    expect(classes).toBe(13);
    const list = (await call('GET', '/api/schools')).json().schools.find((s: { id: string }) => s.id === schoolId);
    expect(list).toMatchObject({ name: 'Green Valley Public School', ownerName: 'Rafiqul Islam', ownerEmail: 'owner.gv@example.in', ownerLoggedIn: false, students: 0 });
  });

  it('the owner logs in to Arscio with the email and must choose a new password', async () => {
    const r = await env.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: 'owner.gv@example.in', password } });
    expect(r.statusCode).toBe(200);
    expect(r.json().mustChangePassword).toBe(true);
    const ch = await api(env, r.json().accessToken).post('/auth/change-password', { newPassword: 'Owner#2027' });
    expect(ch.statusCode).toBe(200);
    const me = (await api(env, ch.json().accessToken).get('/me')).json();
    expect(me.schools.map((s: { name: string }) => s.name)).toContain('Green Valley Public School');
  });

  it('refuses a code that is already used, and a bad mobile number', async () => {
    const base = { name: 'Another School', ownerName: 'Someone Else', ownerPhone: '9700012399', session: currentSession() };
    expect((await call('POST', '/api/schools', { ...base, code })).json().error.message).toMatch(/already used/);
    expect((await call('POST', '/api/schools', { ...base, code: 'NEW-1', ownerPhone: '12345' })).json().error.message).toMatch(/10-digit/);
  });

  it('a new owner password works once and logs the owner out everywhere', async () => {
    const before = await env.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: '9700012345', password: 'Owner#2027' } });
    const r = await call('POST', `/api/schools/${schoolId}/owner-password`);
    const fresh = r.json().password;
    const refresh = await env.app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: before.json().refreshToken } });
    expect(refresh.statusCode).toBe(401);
    const again = await env.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: '9700012345', password: fresh } });
    expect(again.json().mustChangePassword).toBe(true);
  });

  it('pausing a school stops its staff, with a clear message; resuming brings it back', async () => {
    const pw = (await call('POST', `/api/schools/${schoolId}/owner-password`)).json().password;
    let tok = (await env.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: '9700012345', password: pw } })).json().accessToken;
    tok = (await api(env, tok).post('/auth/change-password', { newPassword: 'Owner#2028' })).json().accessToken;
    expect((await api(env, tok, schoolId).get('/school')).statusCode).toBe(200);
    await call('POST', `/api/schools/${schoolId}/status`, { status: 'suspended' });
    const paused = await api(env, tok, schoolId).get('/school');
    expect(paused.statusCode).toBe(403);
    expect(paused.json().error.code).toBe('school_paused');
    await call('POST', `/api/schools/${schoolId}/status`, { status: 'active' });
    expect((await api(env, tok, schoolId).get('/school')).statusCode).toBe(200);
    const log = (await call('GET', '/api/activity')).json().recent.map((x: { action: string }) => x.action);
    expect(log).toEqual(expect.arrayContaining(['school_created', 'school_paused', 'school_resumed', 'owner_password_reset']));
  });
});

describe('Health', () => {
  it('turns problems into plain warnings', async () => {
    const h = (await call('GET', '/api/health')).json();
    const texts = h.warnings.map((w: { text: string }) => w.text);
    expect(texts).toEqual(expect.arrayContaining([expect.stringMatching(/Disk is 91% full/), 'No backup has been made yet.']));
    expect(h.database.size).toMatch(/B$/);
  });

  it('unexpected server errors are kept for the control panel', async () => {
    await owner.query("INSERT INTO platform_errors (method, route, status, message) VALUES ('GET', '/students/:id', 500, 'test explosion')");
    const e = (await call('GET', '/api/errors')).json();
    expect(e.errors[0]).toMatchObject({ route: '/students/:id', message: 'test explosion' });
  });
});
