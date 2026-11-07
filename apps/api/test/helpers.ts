import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import type { Role } from '@aiedu/shared';
import { buildApp } from '../src/app.js';
import { createPool, type Db } from '../src/db.js';
import { createSchool } from '../src/platform/create-school.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './global-setup.js';

export const SECRET = 'test-secret-that-is-at-least-32-characters-long';

/** Captures OTPs instead of sending SMS, so tests can "read the phone". */
export class FakeOtp implements OtpSender {
  sent: { phone: string; code: string; purpose: string }[] = [];
  async send(phone: string, code: string, purpose: string) {
    this.sent.push({ phone, code, purpose });
  }
  last(phone: string) {
    return [...this.sent].reverse().find((s) => s.phone === phone);
  }
}

export interface TestEnv {
  app: FastifyInstance;
  db: Db;          // app (locked-down) connection
  owner: pg.Client; // platform/owner connection, bypasses school separation
  otp: FakeOtp;
  close(): Promise<void>;
}

export async function setupEnv(): Promise<TestEnv> {
  const db = createPool(TEST_APP_URL);
  const owner = new pg.Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  const otp = new FakeOtp();
  const app = await buildApp({ db, jwtSecret: SECRET, otpSender: otp, disableRateLimit: true });
  return {
    app, db, owner, otp,
    async close() {
      await app.close();
      await db.end();
      await owner.end();
    },
  };
}

let phoneCounter = 6000000000 + Math.floor(Math.random() * 900000) * 1000;
export const newPhone = () => `+91${++phoneCounter}`;

let codeCounter = 0;
export async function newSchool(env: TestEnv, name = 'Test School') {
  const ownerPhone = newPhone();
  const r = await createSchool(env.owner, {
    code: `T${Date.now()}${++codeCounter}`,
    name,
    ownerName: 'School Owner',
    ownerPhone,
    academicYear: { name: '2027-28', startsOn: '2027-04-01', endsOn: '2028-03-31' },
  });
  const yearId = (await env.owner.query('SELECT id FROM academic_years WHERE school_id = $1', [r.schoolId])).rows[0].id;
  return { ...r, ownerPhone, yearId };
}

/** Add a staff member/parent login directly (as the school office would). */
export async function addMember(env: TestEnv, schoolId: string, roles: Role[], name = 'Staff') {
  const phone = newPhone();
  const acc = (await env.owner.query('INSERT INTO accounts (phone, name) VALUES ($1, $2) RETURNING id', [phone, name])).rows[0];
  const m = (
    await env.owner.query(
      'INSERT INTO memberships (school_id, account_id, display_name) VALUES ($1, $2, $3) RETURNING id',
      [schoolId, acc.id, name],
    )
  ).rows[0];
  for (const role of roles) {
    await env.owner.query('INSERT INTO membership_roles (school_id, membership_id, role) VALUES ($1, $2, $3)', [
      schoolId, m.id, role,
    ]);
  }
  return { accountId: acc.id as string, membershipId: m.id as string, phone };
}

/** Full real login flow (OTP -> set password). Returns an access token. */
export async function loginAs(env: TestEnv, phone: string, password = 'Strong#Pass1') {
  const start = await env.app.inject({ method: 'POST', url: '/auth/start', payload: { phone } });
  if (start.json().next === 'password') {
    const r = await env.app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password } });
    return r.json() as { accessToken: string; refreshToken: string };
  }
  const code = env.otp.last(phone)!.code;
  const v = await env.app.inject({ method: 'POST', url: '/auth/verify-otp', payload: { phone, code } });
  const s = await env.app.inject({
    method: 'POST', url: '/auth/set-password', payload: { setupToken: v.json().setupToken, password },
  });
  return s.json() as { accessToken: string; refreshToken: string };
}

export function api(env: TestEnv, token: string, schoolId?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (schoolId) headers['x-school-id'] = schoolId;
  return {
    get: (url: string) => env.app.inject({ method: 'GET', url, headers }),
    post: (url: string, payload?: object) => env.app.inject({ method: 'POST', url, headers, payload: payload ?? {} }),
    put: (url: string, payload?: object) => env.app.inject({ method: 'PUT', url, headers, payload: payload ?? {} }),
    patch: (url: string, payload?: object) => env.app.inject({ method: 'PATCH', url, headers, payload: payload ?? {} }),
    del: (url: string) => env.app.inject({ method: 'DELETE', url, headers }),
  };
}

/** A family with children, plus class/section/enrollment. */
export async function addFamily(
  env: TestEnv,
  school: { schoolId: string; yearId: string },
  childNames: string[],
  opts: { withParentLogin?: boolean } = {},
) {
  const o = env.owner;
  const phone = newPhone();
  let accountId: string | null = null;
  if (opts.withParentLogin) {
    accountId = (await o.query('INSERT INTO accounts (phone, name) VALUES ($1, $2) RETURNING id', [phone, 'Parent'])).rows[0].id;
    const m = (await o.query(
      'INSERT INTO memberships (school_id, account_id, display_name) VALUES ($1, $2, $3) RETURNING id',
      [school.schoolId, accountId, 'Parent'],
    )).rows[0];
    await o.query("INSERT INTO membership_roles (school_id, membership_id, role) VALUES ($1, $2, 'parent')", [school.schoolId, m.id]);
  }
  const fam = (await o.query(
    'INSERT INTO families (school_id, phone, account_id, father_name) VALUES ($1, $2, $3, $4) RETURNING id',
    [school.schoolId, phone, accountId, 'Father'],
  )).rows[0];
  const cls = (await o.query("SELECT id FROM classes WHERE school_id = $1 AND name = '5'", [school.schoolId])).rows[0];
  let sec = (await o.query('SELECT id FROM sections WHERE class_id = $1', [cls.id])).rows[0];
  if (!sec) {
    sec = (await o.query(
      "INSERT INTO sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'A') RETURNING id",
      [school.schoolId, school.yearId, cls.id],
    )).rows[0];
  }
  const students: string[] = [];
  for (const [i, n] of childNames.entries()) {
    const st = (await o.query(
      'INSERT INTO students (school_id, family_id, admission_no, first_name) VALUES ($1, $2, $3, $4) RETURNING id',
      [school.schoolId, fam.id, `ADM${Date.now()}${Math.random().toString().slice(2, 6)}${i}`, n],
    )).rows[0];
    await o.query(
      'INSERT INTO enrollments (school_id, student_id, academic_year_id, section_id, roll_no) VALUES ($1, $2, $3, $4, $5)',
      [school.schoolId, st.id, school.yearId, sec.id, i + 1],
    );
    students.push(st.id);
  }
  return { familyId: fam.id as string, phone, accountId, students, sectionId: sec.id as string };
}

/** Tuition Rs 3000 for Q1 (due 10 Apr, Rs 10/day fine capped at Rs 200). */
export async function addTuitionDue(env: TestEnv, school: { schoolId: string; yearId: string }, studentId: string) {
  const o = env.owner;
  const head = (await o.query(
    "INSERT INTO fee_heads (school_id, name) VALUES ($1, 'Tuition') ON CONFLICT (school_id, name) DO UPDATE SET name = excluded.name RETURNING id",
    [school.schoolId],
  )).rows[0];
  const inst = (await o.query(
    `INSERT INTO fee_instalments (school_id, academic_year_id, name, due_on, fine_type, fine_amount, fine_cap)
     VALUES ($1, $2, 'Q1 (Apr-Jun)', '2027-04-10', 'per_day', 10, 200)
     ON CONFLICT (academic_year_id, name) DO UPDATE SET name = excluded.name RETURNING id`,
    [school.schoolId, school.yearId],
  )).rows[0];
  const due = (await o.query(
    `INSERT INTO fee_dues (school_id, student_id, academic_year_id, instalment_id, fee_head_id, amount)
     VALUES ($1, $2, $3, $4, $5, 3000) RETURNING id`,
    [school.schoolId, studentId, school.yearId, inst.id, head.id],
  )).rows[0];
  return due.id as string;
}
