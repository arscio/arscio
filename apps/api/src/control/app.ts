// The Arscio control panel: only for us (the Arscio team), never for schools.
//  - It listens only inside the server (127.0.0.1); we reach it through an SSH tunnel,
//    and it also asks for the control panel password.
//  - Schools: onboard a school (school + owner login with a one-time password), pause or
//    resume a school, give the owner a new password, see how much each school uses Arscio.
//  - Health: services up or down and since when, crashes, server errors, memory, disk,
//    database size, backups, background jobs, with plain warnings at the top.
//  - Activity: what happened each day (people active, attendance, receipts, messages).
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type pg from 'pg';
import { z, ZodError } from 'zod';
import { normalizeIndianPhone } from '@arscio/shared';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { createSchool } from '../platform/create-school.js';
import * as sys from './system.js';

export interface ControlDeps {
  owner: pg.Pool;
  passwordHash: string;          // hash of the control panel password
  secret: string;                // signs the login cookie
  apiUrl: string;                // e.g. http://127.0.0.1:4100
  webUrl: string;                // e.g. http://127.0.0.1:4101
  backupDir: string;
  loginMode: 'otp' | 'password';
  publicWebUrl?: string;         // where school staff log in (shown after onboarding)
  system?: Partial<typeof sys>;  // replaced in tests
  logger?: boolean;
}

const COOKIE = 'arscio_control';
const SESSION_HOURS = 12;

/** Easy to read out over the phone: no 0/O or 1/l look-alikes. */
export function tempPassword(length = 10) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join('');
}

/** Indian school session: April to March. */
export function currentSession(today = new Date()) {
  const y = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return { name: `${y}-${String((y + 1) % 100).padStart(2, '0')}`, startsOn: `${y}-04-01`, endsOn: `${y + 1}-03-31` };
}

export async function buildControlApp(d: ControlDeps) {
  const S = { ...sys, ...d.system };
  const app = Fastify({ logger: d.logger ?? false, trustProxy: false, bodyLimit: 64 * 1024 });
  await app.register(rateLimit, { global: false });

  // ---------------- login (a signed cookie that lasts 12 hours) ----------------
  const sign = (exp: number) => `${exp}.${createHmac('sha256', d.secret).update(`control:${exp}`).digest('base64url')}`;
  const valid = (v: string | undefined) => {
    if (!v) return false;
    const exp = Number(v.split('.')[0]);
    if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
    const a = Buffer.from(sign(exp)), b = Buffer.from(v);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const cookieOf = (req: FastifyRequest) =>
    (req.headers.cookie ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!valid(cookieOf(req))) return reply.status(401).send({ error: { message: 'Please log in' } });
  };

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof ZodError) return reply.status(400).send({ error: { message: err.issues[0]?.message ?? 'Please check the form' } });
    const code = (err as { statusCode?: number }).statusCode ?? 500;
    if (code === 429) return reply.status(429).send({ error: { message: 'Too many tries. Wait a minute.' } });
    if (code < 500) return reply.status(code).send({ error: { message: err.message } });
    app.log.error(err);
    return reply.status(500).send({ error: { message: `Something went wrong: ${err.message}` } });
  });

  // Never cached; never shown inside another site.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store').header('x-frame-options', 'DENY').header('x-content-type-options', 'nosniff');
  });

  const ui = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui.html'), 'utf8');
  app.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8').send(ui));

  app.post('/api/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { password } = z.object({ password: z.string().min(1).max(200) }).parse(req.body);
    if (!(await verifyPassword(d.passwordHash, password))) return reply.status(401).send({ error: { message: 'Wrong password' } });
    const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
    await log('control_login', null, {});
    return reply.header('set-cookie', `${COOKIE}=${sign(exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`).send({ ok: true });
  });
  app.post('/api/logout', async (_req, reply) =>
    reply.header('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`).send({ ok: true }));
  app.get('/api/me', async (req) => ({ loggedIn: valid(cookieOf(req)) }));

  const q = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, args: unknown[] = []) => d.owner.query<T>(sql, args).then((r) => r.rows);
  const log = (action: string, schoolId: string | null, detail: Record<string, unknown>) =>
    d.owner.query('INSERT INTO platform_log (action, school_id, detail) VALUES ($1, $2, $3)', [action, schoolId, JSON.stringify(detail)]).catch(() => undefined);

  // ---------------- Health ----------------
  app.get('/api/health', { preHandler: guard }, async () => {
    const [services, machine, backups, api, web, crashes] = await Promise.all([
      S.services(), S.machine(), S.backups(d.backupDir), S.ping(`${d.apiUrl}/health`), S.ping(`${d.webUrl}/login`), S.crashes(30),
    ]);
    const db = (await q<{ size: string }>('SELECT pg_size_pretty(pg_database_size(current_database())) AS size'))[0]!.size;
    const errors24h = Number((await q<{ n: string }>("SELECT count(*) AS n FROM platform_errors WHERE at > now() - interval '24 hours'"))[0]!.n);
    const errors1h = Number((await q<{ n: string }>("SELECT count(*) AS n FROM platform_errors WHERE at > now() - interval '1 hour'"))[0]!.n);
    const jobs = await q<{ job: string; last_run_at: Date; last_ok_at: Date | null; last_error: string | null; detail: unknown }>(
      'SELECT * FROM platform_heartbeats ORDER BY job');
    const queued = Number((await q<{ n: string }>("SELECT count(*) AS n FROM notifications WHERE status = 'queued' AND created_at < now() - interval '5 minutes'"))[0]!.n);

    // Plain-language warnings, most serious first
    const warnings: { level: 'bad' | 'warn'; text: string }[] = [];
    if (!api.ok) warnings.push({ level: 'bad', text: 'The Arscio server is not answering. Apps and the website cannot work.' });
    if (!web.ok) warnings.push({ level: 'bad', text: 'The office website is not answering.' });
    for (const s of services) {
      if (s.state !== 'active' && s.state !== 'unknown') warnings.push({ level: 'bad', text: `${s.label} is ${s.state}.` });
    }
    const recentCrashes = crashes.filter((c) => Date.parse(c.at) > Date.now() - 24 * 3600e3 && /exited|Failed/.test(c.text));
    if (recentCrashes.length) warnings.push({ level: 'warn', text: `${recentCrashes.length} crash${recentCrashes.length === 1 ? '' : 'es'} in the last 24 hours (restarted by itself). See Crashes below.` });
    if (machine.disk.usedPct >= 90) warnings.push({ level: 'bad', text: `Disk is ${machine.disk.usedPct}% full. Free space or enlarge the disk now.` });
    else if (machine.disk.usedPct >= 80) warnings.push({ level: 'warn', text: `Disk is ${machine.disk.usedPct}% full. Plan to enlarge it.` });
    if (machine.memory.availableMb && machine.memory.availableMb < 150) warnings.push({ level: 'warn', text: `Only ${machine.memory.availableMb} MB of memory is free.` });
    const lastBackup = backups.last?.at ? Date.parse(backups.last.at) : backups.files[0] ? Date.parse(backups.files[0].at) : 0;
    if (!backups.found || !lastBackup) warnings.push({ level: 'warn', text: 'No backup has been made yet.' });
    else if (backups.last && !backups.last.ok) warnings.push({ level: 'bad', text: `The last backup failed: ${backups.last.error ?? 'unknown reason'}` });
    else if (Date.now() - lastBackup > 26 * 3600e3) warnings.push({ level: 'bad', text: 'The daily backup has not run for more than a day.' });
    if (errors1h) warnings.push({ level: 'warn', text: `${errors1h} server error${errors1h === 1 ? '' : 's'} in the last hour. See Errors below.` });
    for (const j of jobs) {
      const stale = j.job === 'push' ? 5 * 60e3 : 45 * 60e3;
      if (Date.now() - j.last_run_at.getTime() > stale) warnings.push({ level: 'warn', text: `Background job "${JOB_NAMES[j.job] ?? j.job}" has not run since ${j.last_run_at.toISOString()}.` });
      else if (j.last_error) warnings.push({ level: 'warn', text: `Background job "${JOB_NAMES[j.job] ?? j.job}" failed last time: ${j.last_error}` });
    }
    if (queued > 20) warnings.push({ level: 'warn', text: `${queued} phone notifications are waiting to be sent.` });

    return {
      checkedAt: new Date().toISOString(), warnings, api, web, services, machine, backups,
      database: { size: db }, errors: { last24h: errors24h, lastHour: errors1h },
      jobs: jobs.map((j) => ({ ...j, name: JOB_NAMES[j.job] ?? j.job })), crashes, queuedNotifications: queued,
    };
  });

  app.get('/api/errors', { preHandler: guard }, async () => ({
    errors: await q(`SELECT e.id, e.at, e.method, e.route, e.status, e.message, s.name AS school
                       FROM platform_errors e LEFT JOIN schools s ON s.id = e.school_id ORDER BY e.at DESC LIMIT 100`),
    logLines: await S.logErrors(),
  }));

  // ---------------- Schools ----------------
  app.get('/api/schools', { preHandler: guard }, async () => ({
    loginMode: d.loginMode,
    defaults: currentSession(),
    schools: await q(`
      SELECT s.id, s.code, s.name, s.board, s.address, s.status, s.created_at AS "createdAt",
             o.display_name AS "ownerName", a.phone AS "ownerPhone", a.email AS "ownerEmail",
             (a.password_hash IS NOT NULL AND NOT a.must_change_password) AS "ownerLoggedIn",
             (SELECT count(*)::int FROM students st WHERE st.school_id = s.id AND st.status = 'active') AS students,
             (SELECT count(DISTINCT m.id)::int FROM memberships m JOIN membership_roles r ON r.membership_id = m.id AND r.role <> 'parent'
               WHERE m.school_id = s.id AND m.status = 'active') AS staff,
             (SELECT count(*)::int FROM families f WHERE f.school_id = s.id) AS families,
             (SELECT count(*)::int FROM families f JOIN accounts fa ON fa.id = f.account_id
               WHERE f.school_id = s.id AND fa.password_hash IS NOT NULL AND NOT fa.must_change_password) AS "familiesLoggedIn",
             (SELECT max(rt.created_at) FROM refresh_tokens rt JOIN memberships m ON m.account_id = rt.account_id WHERE m.school_id = s.id) AS "lastActive",
             (SELECT coalesce(sum(octet_length(data)), 0) FROM student_photos p WHERE p.school_id = s.id)
           + (SELECT coalesce(sum(octet_length(data)), 0) FROM student_documents p WHERE p.school_id = s.id)
           + (SELECT coalesce(sum(octet_length(data)), 0) FROM school_logos p WHERE p.school_id = s.id)
           + (SELECT coalesce(sum(octet_length(data)), 0) FROM signatures p WHERE p.school_id = s.id) AS "storageBytes"
        FROM schools s
        LEFT JOIN LATERAL (SELECT m.display_name, m.account_id FROM memberships m JOIN membership_roles r ON r.membership_id = m.id AND r.role = 'owner'
                            WHERE m.school_id = s.id ORDER BY m.created_at LIMIT 1) o ON true
        LEFT JOIN accounts a ON a.id = o.account_id
       ORDER BY s.created_at DESC`),
  }));

  /** Onboard a school: the school, its classes and settings, and the owner's login. */
  app.post('/api/schools', { preHandler: guard }, async (req) => {
    const b = z.object({
      name: z.string().trim().min(3, 'School name is too short').max(120),
      code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, 'Code: 2 to 20 letters, numbers or dashes, e.g. GVPS-DHUBRI'),
      board: z.string().trim().max(40).default('CBSE'),
      address: z.string().trim().max(300).optional(),
      ownerName: z.string().trim().min(2, "Owner's name is too short").max(80),
      ownerPhone: z.string().trim(),
      ownerEmail: z.string().trim().toLowerCase().email("Owner's email doesn't look right").optional().or(z.literal('')),
      session: z.object({ name: z.string().trim().min(4).max(20), startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    }).parse(req.body);
    const phone = normalizeIndianPhone(b.ownerPhone);
    if (!phone) throw httpError(400, "Owner's mobile number should be a 10-digit Indian number");
    if (b.session.endsOn <= b.session.startsOn) throw httpError(400, 'The session must end after it starts');
    if ((await q('SELECT 1 FROM schools WHERE code = $1', [b.code])).length) throw httpError(400, `The code ${b.code} is already used by another school`);
    const email = b.ownerEmail || null;
    if (email) {
      const other = await q<{ phone: string }>('SELECT phone FROM accounts WHERE lower(email) = $1', [email]);
      if (other.length && other[0]!.phone !== phone) throw httpError(400, 'This email is already used by a different login');
    }
    const existing = (await q<{ password_hash: string | null }>('SELECT password_hash FROM accounts WHERE phone = $1', [phone]))[0];

    const client = await d.owner.connect();
    let created: Awaited<ReturnType<typeof createSchool>>;
    try {
      created = await createSchool(client, { code: b.code, name: b.name, ownerName: b.ownerName, ownerPhone: phone, academicYear: b.session });
    } finally { client.release(); }
    await d.owner.query('UPDATE schools SET board = $2, address = $3 WHERE id = $1', [created.schoolId, b.board, b.address || null]);
    if (email) await d.owner.query('UPDATE accounts SET email = $2 WHERE id = $1', [created.ownerAccountId, email]);

    // A person who already has a Arscio login keeps their own password.
    let password: string | null = null;
    if (!existing?.password_hash) {
      password = tempPassword();
      await d.owner.query(
        `UPDATE accounts SET password_hash = $2, password_set_at = now(), must_change_password = true, failed_logins = 0, locked_until = NULL
          WHERE id = $1`, [created.ownerAccountId, await hashPassword(password)]);
    }
    await log('school_created', created.schoolId, { code: b.code, name: b.name, owner: b.ownerName });
    return {
      schoolId: created.schoolId, password,
      login: { email, phone, website: d.publicWebUrl ?? null },
      note: password ? null : 'This owner already has a Arscio login (another school or an earlier account), so they use their existing password.',
    };
  });

  app.post('/api/schools/:id/status', { preHandler: guard }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { status } = z.object({ status: z.enum(['active', 'suspended']) }).parse(req.body);
    const r = await d.owner.query('UPDATE schools SET status = $2 WHERE id = $1 RETURNING name', [id, status]);
    if (!r.rowCount) throw httpError(404, 'School not found');
    await log(status === 'active' ? 'school_resumed' : 'school_paused', id, {});
    return { ok: true };
  });

  /** The owner forgot their password: a new one-time password (they must change it after logging in). */
  app.post('/api/schools/:id/owner-password', { preHandler: guard }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const owner = (await q<{ account_id: string }>(
      `SELECT m.account_id FROM memberships m JOIN membership_roles r ON r.membership_id = m.id AND r.role = 'owner'
        WHERE m.school_id = $1 ORDER BY m.created_at LIMIT 1`, [id]))[0];
    if (!owner) throw httpError(404, 'This school has no owner login');
    const password = tempPassword();
    await d.owner.query(
      `UPDATE accounts SET password_hash = $2, password_set_at = now(), must_change_password = true, failed_logins = 0, locked_until = NULL
        WHERE id = $1`, [owner.account_id, await hashPassword(password)]);
    await d.owner.query('UPDATE refresh_tokens SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [owner.account_id]);
    await log('owner_password_reset', id, {});
    return { password };
  });

  // ---------------- Activity ----------------
  app.get('/api/activity', { preHandler: guard }, async () => {
    const days = await q(`
      WITH d AS (SELECT generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - 13, (now() AT TIME ZONE 'Asia/Kolkata')::date, '1 day')::date AS day)
      SELECT d.day::text AS day,
        (SELECT count(DISTINCT account_id)::int FROM refresh_tokens WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = d.day) AS "activePeople",
        (SELECT count(*)::int FROM attendance_sessions WHERE on_date = d.day) AS "attendanceTaken",
        (SELECT count(*)::int FROM receipts WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = d.day) AS receipts,
        (SELECT count(*)::int FROM notifications WHERE status = 'sent' AND (sent_at AT TIME ZONE 'Asia/Kolkata')::date = d.day) AS "messagesSent",
        (SELECT count(*)::int FROM marks WHERE (entered_at AT TIME ZONE 'Asia/Kolkata')::date = d.day) AS "marksEntered",
        (SELECT count(*)::int FROM platform_errors WHERE (at AT TIME ZONE 'Asia/Kolkata')::date = d.day) AS errors
      FROM d ORDER BY d.day DESC`);
    const recent = await q(`SELECT l.at, l.action, l.detail, s.name AS school FROM platform_log l LEFT JOIN schools s ON s.id = l.school_id
                              ORDER BY l.at DESC LIMIT 30`);
    return { days, recent };
  });

  return app;
}

const JOB_NAMES: Record<string, string> = { push: 'Phone notifications', results_day: 'Results day' };

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}
