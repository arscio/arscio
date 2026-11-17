// Puts the server together: login routes, "who am I" routes, and the first
// school routes (settings, roles, fees). Feature modules get added here.
import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import { ROLES, canAssignRole, normalizeIndianPhone, type Role } from '@arscio/shared';
import { withContext, type Db } from './db.js';
import { AppError, badRequest, forbidden, notFound } from './errors.js';
import { AuthService } from './auth/service.js';
import { Tokens, sha256 } from './auth/tokens.js';
import type { RequestMetrics } from './platform/metrics.js';
import type { OtpSender } from './auth/otp-sender.js';
import { can, makeGuards, must, schoolTx } from './context.js';
import { cancelReceipt, createReceipt, studentDues } from './fees/service.js';
import { registerSetupRoutes } from './routes/setup.js';
import { registerAttendanceRoutes } from './routes/attendance.js';
import { registerAttendanceReportRoutes } from './routes/attendance-reports.js';
import { registerHomeworkRoutes } from './routes/homework.js';
import { registerIdentityRoutes } from './routes/identity.js';
import { registerFeeRoutes } from './routes/fees.js';
import { registerNoticeRoutes } from './routes/notices.js';
import { registerInboxRoutes, registerParentRoutes } from './routes/parent.js';
import { registerExamRoutes } from './routes/exams.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerTimetableRoutes } from './routes/timetable.js';
import { registerStudentFileRoutes } from './routes/student-file.js';
import { registerCertificateRoutes } from './routes/certificates.js';
import { registerParentLoginRoutes } from './routes/parent-logins.js';
import { registerClassTestRoutes } from './routes/class-tests.js';
import { registerResultRoutes } from './routes/results.js';
import { registerNewYearRoutes } from './routes/new-year.js';
import { registerDataRoutes } from './routes/data.js';
import cors from '@fastify/cors';

export interface AppDeps {
  db: Db;
  jwtSecret: string;
  otpSender: OtpSender;
  logger?: boolean;
  /** Websites allowed to call the server directly from a browser (the phone apps don't need this). */
  corsOrigins?: string[];
  /** Turn off request-rate limits (automated tests only). */
  disableRateLimit?: boolean;
  /** 'otp' (SMS codes) or 'password' (no SMS: school sets passwords; parents start with date of birth). */
  loginMode?: 'otp' | 'password';
  /** Where people download the apps (printed as a QR code on login slips). */
  appDownloadUrl?: string;
  /** The office website's address (marksheet QR codes point to its /verify page). */
  publicWebUrl?: string;
  /** Counts requests per minute for the control panel's graphs. */
  metrics?: RequestMetrics;
}

const phoneSchema = z.string().transform((v, ctx) => {
  const p = normalizeIndianPhone(v);
  if (!p) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit mobile number' });
    return z.NEVER;
  }
  return p;
});
const uuid = z.string().uuid();
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount like 1500 or 1500.50');

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { db } = deps;
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true });
  const tokens = new Tokens(deps.jwtSecret);
  const loginMode = deps.loginMode ?? 'otp';
  const auth = new AuthService(db, tokens, deps.otpSender, deps.jwtSecret, loginMode);
  const { requireLogin, requireSchool } = makeGuards(db, tokens);

  app.decorateRequest('accountId', null);
  app.decorateRequest('school', null);
  await app.register(helmet);
  if (deps.metrics) {
    const metrics = deps.metrics;
    // The control panel checks /health every few seconds; those checks aren't real use.
    app.addHook('onResponse', async (req, reply) => {
      if (req.url === '/health') return;
      metrics.record(reply.statusCode, reply.elapsedTime, req.accountId ?? null);
    });
  }
  if (deps.corsOrigins?.length) await app.register(cors, { origin: deps.corsOrigins, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  // Many people share one internet address: a whole school on the office Wi-Fi, or hundreds of parents
  // behind one mobile-network address (Jio/Airtel). So logged-in requests are counted per person, and only
  // anonymous requests per address (with a higher allowance).
  if (!deps.disableRateLimit) await app.register(rateLimit, {
    timeWindow: '1 minute',
    keyGenerator: async (req) => {
      const h = req.headers.authorization;
      if (h?.startsWith('Bearer ')) {
        try { return `acct:${(await tokens.verify(h.slice(7), 'access')).accountId}`; } catch { /* fall through */ }
      }
      return `ip:${req.ip}`;
    },
    max: async (_req, key) => (key.startsWith('acct:') ? 300 : 1200),
  });

  // Friendly, consistent error replies: { error: { code, message } }
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: { code: 'invalid_input', message: err.issues[0]?.message ?? 'Invalid input', issues: err.issues },
      });
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({ error: { code: 'too_many_requests', message: 'Too many requests, slow down' } });
    }
    req.log.error(err);
    // Kept for the control panel (time, page and message only; never request data or passwords).
    db.query(
      'INSERT INTO platform_errors (method, route, status, message, school_id, account_id) VALUES ($1, $2, 500, $3, $4, $5)',
      [req.method, (req.routeOptions?.url ?? req.url.split('?')[0] ?? '').slice(0, 200), String((err as Error).message ?? err).slice(0, 500),
       req.school?.schoolId ?? null, req.accountId ?? null],
    ).catch(() => undefined);
    return reply.status(500).send({ error: { code: 'server_error', message: 'Something went wrong' } });
  });

  app.get('/health', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });

  // ---------------- Login ----------------
  // Login limits are per person (the mobile number, email or admission number typed, or the device's
  // refresh token), not per internet address, so 45 staff on one school Wi-Fi never block each other.
  // Wrong passwords are separately locked per account (login_failures).
  const loginKey = (req: { ip: string; body?: unknown }) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const who = [b.identifier, b.phone, b.refreshToken, b.setupToken].find((v) => typeof v === 'string') as string | undefined;
    return who ? `login:${sha256(who.trim().toLowerCase())}` : `login-ip:${req.ip}`;
  };
  const authLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute', hook: 'preHandler' as const, keyGenerator: loginKey } } };

  app.post('/auth/start', authLimit, async (req) => {
    if (loginMode === 'password') throw badRequest('otp_off', 'SMS login is switched off. Ask the school office to reset your password.');
    const { phone } = z.object({ phone: phoneSchema }).parse(req.body);
    return auth.start(phone);
  });
  app.post('/auth/verify-otp', authLimit, async (req) => {
    if (loginMode === 'password') throw badRequest('otp_off', 'SMS login is switched off. Ask the school office to reset your password.');
    const b = z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }).parse(req.body);
    return auth.verifyOtp(b.phone, b.code);
  });
  app.post('/auth/set-password', authLimit, async (req) => {
    const b = z.object({ setupToken: z.string(), password: z.string(), device: z.string().max(100).optional() }).parse(req.body);
    return auth.setPassword(b.setupToken, b.password, b.device);
  });
  /** How the apps should show the login screen ("otp" or "password"). */
  app.get('/auth/mode', async () => ({ mode: loginMode }));

  app.post('/auth/login', authLimit, async (req) => {
    const b = z.object({
      // One box: email, mobile number or admission number. ("phone" kept for older app versions.)
      identifier: z.string().trim().min(1).max(120).optional(),
      phone: z.string().trim().max(20).optional(),
      password: z.string().min(1).max(128),
      device: z.string().max(100).optional(),
    }).parse(req.body);
    const id = b.identifier ?? b.phone;
    if (!id) throw badRequest('missing_login', 'Enter your email, mobile number or admission number');
    return auth.loginAny(id, b.password, b.device);
  });

  app.post('/auth/change-password', { ...authLimit, preHandler: requireLogin }, async (req) => {
    const b = z.object({
      oldPassword: z.string().max(128).default(''),
      newPassword: z.string().max(128),
      device: z.string().max(100).optional(),
    }).parse(req.body);
    return auth.changePassword(req.accountId!, b.oldPassword, b.newPassword, b.device);
  });
  app.post('/auth/forgot', authLimit, async (req) => {
    if (loginMode === 'password') throw badRequest('otp_off', 'SMS login is switched off. Ask the school office to reset your password.');
    const { phone } = z.object({ phone: phoneSchema }).parse(req.body);
    await auth.forgot(phone);
    return { next: 'otp' };
  });
  app.post('/auth/refresh', authLimit, async (req) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    return auth.refresh(refreshToken);
  });
  app.post('/auth/logout', async (req) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    await auth.logout(refreshToken);
    return { ok: true };
  });

  // ---------------- Me ----------------

  /** Who am I, and which schools/roles do I have? (used right after login) */
  app.get('/me', { preHandler: requireLogin }, async (req) =>
    withContext(db, { accountId: req.accountId }, async (tx) => {
      const account = (await tx.query('SELECT id, name, phone, email, must_change_password AS "mustChangePassword" FROM accounts WHERE id = $1', [req.accountId])).rows[0];
      const schools = (
        await tx.query(
          `SELECT s.id, s.name, s.logo_url, m.id AS membership_id,
                  coalesce(array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
             FROM memberships m
             JOIN schools s ON s.id = m.school_id AND s.status = 'active'
             LEFT JOIN membership_roles r ON r.membership_id = m.id
            WHERE m.account_id = $1 AND m.status = 'active'
            GROUP BY s.id, m.id ORDER BY s.name`,
          [req.accountId],
        )
      ).rows;
      return { account, schools };
    }),
  );

  /** Parent app home: all my children, across every school, together. */
  app.get('/me/children', { preHandler: requireLogin }, async (req) => {
    const schools = await withContext(db, { accountId: req.accountId }, async (tx) =>
      (
        await tx.query<{ school_id: string; school_name: string; logo_url: string | null; brand_color: string | null; short_name: string | null }>(
          `SELECT m.school_id, s.name AS school_name, s.logo_url, s.brand_color, s.short_name
             FROM memberships m
             JOIN schools s ON s.id = m.school_id AND s.status = 'active'
             JOIN membership_roles r ON r.membership_id = m.id AND r.role = 'parent'
            WHERE m.account_id = $1 AND m.status = 'active'`,
          [req.accountId],
        )
      ).rows,
    );
    const children = [];
    for (const s of schools) {
      const rows = await withContext(db, { schoolId: s.school_id, accountId: req.accountId }, async (tx) =>
        (
          await tx.query(
            `SELECT st.id, st.first_name, st.last_name, st.admission_no, st.photo_url,
                    c.name AS class_name, sec.name AS section_name, e.roll_no
               FROM students st
               JOIN families f ON f.id = st.family_id AND f.account_id = $1
               LEFT JOIN academic_years y ON y.school_id = st.school_id AND y.is_current
               LEFT JOIN enrollments e ON e.student_id = st.id AND e.academic_year_id = y.id
               LEFT JOIN sections sec ON sec.id = e.section_id
               LEFT JOIN classes c ON c.id = sec.class_id
              WHERE st.status = 'active'
              ORDER BY c.sort_order, st.first_name`,
            [req.accountId],
          )
        ).rows,
      );
      for (const r of rows) {
        children.push({ ...r, schoolId: s.school_id, schoolName: s.school_name, schoolShortName: s.short_name,
          schoolLogoUrl: s.logo_url, schoolColor: s.brand_color });
      }
    }
    return { children };
  });

  // ---------------- School settings ----------------

  app.get('/school', { preHandler: requireSchool }, async (req) =>
    schoolTx(db, req, async (tx) => {
      const school = (
        await tx.query(
          `SELECT id, code, name, board, address, phone, email, logo_url, website_domain,
                  attendance_mode, periods_per_day, online_payments_enabled, receipt_prefix,
                  brand_color, short_name, affiliation_no
             FROM schools WHERE id = $1`,
          [req.school!.schoolId],
        )
      ).rows[0];
      return { school, me: { roles: req.school!.roles, permissions: [...req.school!.permissions] } };
    }),
  );

  app.patch('/school/settings', { preHandler: requireSchool }, async (req) => {
    must(req, 'school.settings');
    const b = z
      .object({
        attendanceMode: z.enum(['daily', 'period']).optional(),
        periodsPerDay: z.number().int().min(1).max(15).optional(),
        onlinePaymentsEnabled: z.boolean().optional(),
        razorpayKeyId: z.string().min(5).optional(),
      })
      .strict()
      .parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const r = await tx.query(
        `UPDATE schools SET
           attendance_mode = coalesce($2, attendance_mode),
           periods_per_day = coalesce($3, periods_per_day),
           razorpay_key_id = coalesce($5, razorpay_key_id),
           online_payments_enabled = coalesce($4, online_payments_enabled)
         WHERE id = $1
         RETURNING attendance_mode, periods_per_day, online_payments_enabled`,
        [req.school!.schoolId, b.attendanceMode ?? null, b.periodsPerDay ?? null,
         b.onlinePaymentsEnabled ?? null, b.razorpayKeyId ?? null],
      ).catch((e: { code?: string }) => {
        if (e.code === '23514') throw badRequest('razorpay_missing', 'Add the school\'s Razorpay details before turning on online payment');
        throw e;
      });
      return r.rows[0];
    });
  });

  // ---------------- Roles ----------------

  /** Owner/principal set the full list of roles a person holds. */
  app.put('/members/:membershipId/roles', { preHandler: requireSchool }, async (req) => {
    must(req, 'roles.assign');
    const { membershipId } = z.object({ membershipId: uuid }).parse(req.params);
    const { roles } = z.object({ roles: z.array(z.enum(ROLES)).max(ROLES.length) }).parse(req.body);
    const wanted = new Set<Role>(roles);
    return schoolTx(db, req, async (tx) => {
      const exists = await tx.query('SELECT 1 FROM memberships WHERE id = $1 AND school_id = $2', [
        membershipId, req.school!.schoolId,
      ]);
      if (!exists.rowCount) throw notFound('Person not found in this school');
      const current = new Set<Role>(
        (await tx.query<{ role: Role }>('SELECT role FROM membership_roles WHERE membership_id = $1', [membershipId]))
          .rows.map((r) => r.role),
      );
      const changed = [...new Set([...wanted, ...current])].filter((r) => wanted.has(r) !== current.has(r));
      for (const r of changed) {
        if (!canAssignRole(req.school!.roles, r)) throw forbidden(`You cannot give or remove the ${r} role`);
      }
      if (membershipId === req.school!.membershipId && current.has('owner') && !wanted.has('owner')) {
        throw forbidden('You cannot remove your own owner role');
      }
      for (const r of changed) {
        if (wanted.has(r)) {
          await tx.query(
            'INSERT INTO membership_roles (school_id, membership_id, role, assigned_by) VALUES ($1, $2, $3, $4)',
            [req.school!.schoolId, membershipId, r, req.accountId],
          );
        } else {
          await tx.query('DELETE FROM membership_roles WHERE membership_id = $1 AND role = $2', [membershipId, r]);
        }
      }
      return { membershipId, roles: [...wanted].sort() };
    });
  });

  /** Office resets a parent's/teacher's login (they'll log in with OTP again). */
  app.post('/accounts/:accountId/reset-login', { preHandler: requireSchool }, async (req) => {
    must(req, 'accounts.reset_login');
    const { accountId } = z.object({ accountId: uuid }).parse(req.params);
    const belongs = await schoolTx(db, req, async (tx) =>
      (await tx.query('SELECT 1 FROM memberships WHERE account_id = $1 AND school_id = $2', [
        accountId, req.school!.schoolId,
      ])).rowCount,
    );
    if (!belongs) throw notFound('Person not found in this school');
    const staff = await schoolTx(db, req, async (tx) => (await tx.query(
      `SELECT 1 FROM memberships m JOIN membership_roles r ON r.membership_id = m.id
        WHERE m.account_id = $1 AND m.school_id = $2 AND r.role <> 'parent'`, [accountId, req.school!.schoolId])).rowCount);
    // Staff logins are the principal's job (and in password mode they get a new password, not a reset).
    if (staff && (loginMode === 'password' || !req.school!.permissions.has('roles.assign'))) {
      throw forbidden(loginMode === 'password' ? 'For staff, give a new password from the Staff page' : 'Only the owner or principal can reset a staff login');
    }
    await auth.resetLogin(accountId);
    await schoolTx(db, req, (tx) =>
      tx.query(
        `INSERT INTO audit_log (school_id, account_id, action, table_name, row_id)
         VALUES ($1, $2, 'RESET_LOGIN', 'accounts', $3)`,
        [req.school!.schoolId, req.accountId, accountId],
      ),
    );
    return { ok: true };
  });

  // ---------------- Fees ----------------

  app.get('/students/:studentId/dues', { preHandler: requireSchool }, async (req) => {
    const { studentId } = z.object({ studentId: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      if (!can(req, 'fees.collect') && !can(req, 'fees.view_reports')) {
        // Parents may only see their own children.
        const own = await tx.query(
          'SELECT 1 FROM students s JOIN families f ON f.id = s.family_id WHERE s.id = $1 AND f.account_id = $2',
          [studentId, req.accountId],
        );
        if (!can(req, 'parent.own_children') || !own.rowCount) throw forbidden();
      }
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      return { dues: await studentDues(tx, studentId, today) };
    });
  });

  app.post('/fees/receipts', { preHandler: requireSchool }, async (req) => {
    must(req, 'fees.collect');
    const b = z
      .object({
        studentId: uuid,
        mode: z.enum(['cash', 'upi', 'cheque', 'bank_transfer', 'card']),
        reference: z.string().max(100).optional(),
        paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        lines: z.array(z.object({ feeDueId: uuid, amount: money, fine: money.optional() })).min(1).max(50),
      })
      .parse(req.body);
    return schoolTx(db, req, (tx) => createReceipt(tx, b, req.accountId!));
  });

  app.post('/fees/receipts/:receiptId/cancel', { preHandler: requireSchool }, async (req) => {
    must(req, 'fees.cancel_receipt');
    const { receiptId } = z.object({ receiptId: uuid }).parse(req.params);
    const { reason } = z.object({ reason: z.string() }).parse(req.body);
    return schoolTx(db, req, (tx) => cancelReceipt(tx, receiptId, reason, req.accountId!));
  });

  registerSetupRoutes(app, db, requireSchool, auth);
  registerAttendanceRoutes(app, db, requireSchool);
  registerAttendanceReportRoutes(app, db, requireSchool);
  registerHomeworkRoutes(app, db, requireSchool);
  registerIdentityRoutes(app, db, requireSchool);
  registerFeeRoutes(app, db, requireSchool);
  registerNoticeRoutes(app, db, requireSchool);
  registerExamRoutes(app, db, requireSchool);
  registerDashboardRoutes(app, db, requireSchool);
  registerTimetableRoutes(app, db, requireSchool);
  registerStudentFileRoutes(app, db, requireSchool, deps.jwtSecret);
  registerCertificateRoutes(app, db, requireSchool);
  registerParentLoginRoutes(app, db, requireSchool, auth, deps.appDownloadUrl);
  registerClassTestRoutes(app, db, requireSchool);
  registerResultRoutes(app, db, requireSchool, {
    secret: deps.jwtSecret,
    verifyBase: deps.publicWebUrl ?? deps.corsOrigins?.[0] ?? 'http://localhost:3000',
  });
  registerNewYearRoutes(app, db, requireSchool);
  registerDataRoutes(app, db, requireSchool);
  registerParentRoutes(app, db, requireSchool);
  registerInboxRoutes(app, db, requireLogin);

  return app;
}
