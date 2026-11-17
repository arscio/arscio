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

describe('Dashboard data', () => {
  it('"keep this screen logged in" lasts 30 days instead of 12 hours', async () => {
    const short = await call('POST', '/api/login', { password: 'Control#Pass1' });
    expect(String(short.headers['set-cookie'])).toContain(`Max-Age=${12 * 3600}`);
    const long = await call('POST', '/api/login', { password: 'Control#Pass1', remember: true });
    expect(String(long.headers['set-cookie'])).toContain(`Max-Age=${30 * 86400}`);
  });

  it('serves the panel fonts, and nothing else from that folder', async () => {
    const f = await call('GET', '/fonts/sora-700.woff2');
    expect(f.statusCode).toBe(200);
    expect(f.headers['content-type']).toBe('font/woff2');
    expect((await call('GET', '/fonts/..%2Fapp.ts')).statusCode).toBe(400);
  });

  it('the request counter saves one row per minute with speed and errors', async () => {
    const { RequestMetrics } = await import('../src/platform/metrics.js');
    const m = new RequestMetrics();
    for (const ms of [5, 10, 20, 400]) m.record(200, ms, 'a1');
    m.record(500, 30, 'a2'); m.record(401, 3, null);
    (m as unknown as { minute: number }).minute -= 1; // pretend that minute has ended
    await m.flush(owner);
    const row = (await owner.query('SELECT * FROM platform_metrics ORDER BY minute DESC LIMIT 1')).rows[0];
    expect(row).toMatchObject({ requests: 6, server_errors: 1, client_errors: 1, people: 2, max_ms: 400 });
  });

  it('overview, graphs and live feed', async () => {
    const o = (await call('GET', '/api/overview')).json();
    for (const k of ['schoolsActive', 'students', 'staff', 'familiesIn', 'peopleToday', 'sectionsTotal', 'sectionsTaken',
      'collectedToday', 'messagesToday', 'errors24h', 'requests24h', 'dbBytes']) expect(o).toHaveProperty(k);
    expect(o.requests24h).toBeGreaterThanOrEqual(6);

    await owner.query(`INSERT INTO platform_samples (at, cpu_pct, mem_used_mb, mem_total_mb, swap_used_mb, load1, api_ms, db_conns, disk_used_pct)
                       VALUES (date_trunc('minute', now()) - interval '2 hours', 12.5, 900, 1900, 0, 0.3, 8, 5, 14) ON CONFLICT DO NOTHING`);
    const day = (await call('GET', '/api/series?range=24h')).json();
    expect(day.bucketSec).toBe(900);
    expect(day.traffic.length).toBeGreaterThanOrEqual(96);
    expect(day.machine.some((p: { cpu: number }) => p.cpu === 12.5)).toBe(true);
    expect((await call('GET', '/api/series?range=1y')).statusCode).toBe(400);

    const feed = (await call('GET', '/api/feed')).json();
    expect(Array.isArray(feed.events)).toBe(true);
    expect(feed.events.some((e: { kind: string }) => e.kind === 'panel')).toBe(true);
  });
});
