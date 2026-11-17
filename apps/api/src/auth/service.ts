// The login flow, exactly as decided:
//   1. First time: phone -> OTP by SMS -> person sets a password
//   2. After that: phone + password
//   3. Forgot password: OTP -> set a new password
//   4. School office can reset a login (person goes back to step 1)
// Same flow for parents and teachers.
//
// Password mode (no SMS, LOGIN_MODE=password):
//   - staff: email or mobile + password; the principal sets the first one
//   - parents: admission number (any format) + password; the first one is the
//     child's date of birth (DDMMYYYY)
//   - everyone must choose their own password after the first login
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db.js';
import { normalizeIndianPhone } from '@arscio/shared';
import { badRequest, tooMany, unauthorized } from '../errors.js';
import type { OtpSender } from './otp-sender.js';
import { checkPasswordStrength, hashPassword, verifyPassword } from './passwords.js';
import { REFRESH_TTL_DAYS, Tokens, newRefreshToken, sha256 } from './tokens.js';

export type OtpPurpose = 'first_login' | 'reset_password';

const OTP_TTL_MIN = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS_PER_15_MIN = 3;
const LOGIN_MAX_FAILS = 5;
const LOCK_MINUTES = 15;

export interface Session {
  accessToken: string;
  refreshToken: string;
  account: { id: string; name: string; phone: string };
  /** True after a first login or a reset: the app must show "choose a new password". */
  mustChangePassword: boolean;
}

/** GV/2027/0187, gv-2027-0187 and GV20270187 are the same admission number. */
export const normaliseAdmissionNo = (v: string) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** A date of birth as parents type it: 05082015, 05/08/2015 or 5-8-2015 -> "05082015". */
function dobDigits(v: string): string {
  const parts = v.trim().split(/[^0-9]+/).filter(Boolean);
  if (parts.length === 3) return `${parts[0]!.padStart(2, '0')}${parts[1]!.padStart(2, '0')}${parts[2]}`;
  return v.replace(/\D/g, '');
}
/** Stored date "2015-08-05" -> "05082015". */
const dobAsPassword = (d: string | Date) => {
  const [y, m, day] = (typeof d === 'string' ? d : d.toISOString()).slice(0, 10).split('-');
  return `${day}${m}${y}`;
};

export class AuthService {
  constructor(
    private db: Db,
    private tokens: Tokens,
    private otp: OtpSender,
    private secret: string,
    public mode: 'otp' | 'password' = 'otp',
  ) {}

  private codeHash(phone: string, code: string) {
    return createHmac('sha256', this.secret).update(`${phone}:${code}`).digest('hex');
  }

  /**
   * Step 1 of every login. Tells the app what to show next:
   * "otp" (first time / after a reset) or "password".
   * For unknown numbers we also answer "otp" (and send nothing) so that
   * nobody can use this screen to find out who is registered.
   */
  async start(phone: string): Promise<{ next: 'otp' | 'password' }> {
    const acc = await this.findAccount(phone);
    if (acc?.password_hash) return { next: 'password' };
    if (acc) await this.sendOtp(phone, 'first_login');
    return { next: 'otp' };
  }

  /** "Forgot password" - sends a reset code if the number has a password. */
  async forgot(phone: string): Promise<void> {
    const acc = await this.findAccount(phone);
    if (acc?.password_hash) await this.sendOtp(phone, 'reset_password');
    else if (acc) await this.sendOtp(phone, 'first_login');
  }

  private async sendOtp(phone: string, purpose: OtpPurpose) {
    const recent = await this.db.query<{ n: string }>(
      "SELECT count(*) AS n FROM otp_codes WHERE phone = $1 AND created_at > now() - interval '15 minutes'",
      [phone],
    );
    if (Number(recent.rows[0]!.n) >= OTP_MAX_SENDS_PER_15_MIN) {
      throw tooMany('Too many codes requested. Please wait 15 minutes and try again.');
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.query(
      `INSERT INTO otp_codes (phone, purpose, code_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
      [phone, purpose, this.codeHash(phone, code), OTP_TTL_MIN],
    );
    await this.otp.send(phone, code, purpose);
  }

  /** Checks the 6-digit code. Success returns a 10-minute "set password" ticket. */
  async verifyOtp(phone: string, code: string): Promise<{ setupToken: string }> {
    const row = (
      await this.db.query<{ id: string; code_hash: string; attempts: number }>(
        `SELECT id, code_hash, attempts FROM otp_codes
          WHERE phone = $1 AND used_at IS NULL AND expires_at > now()
          ORDER BY created_at DESC LIMIT 1`,
        [phone],
      )
    ).rows[0];
    const wrong = badRequest('invalid_otp', 'The code is wrong or has expired');
    if (!row) throw wrong;
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      throw badRequest('invalid_otp', 'Too many wrong tries. Please ask for a new code.');
    }
    await this.db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    const given = Buffer.from(this.codeHash(phone, code));
    const stored = Buffer.from(row.code_hash);
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) throw wrong;

    await this.db.query('UPDATE otp_codes SET used_at = now() WHERE id = $1', [row.id]);
    const acc = await this.findAccount(phone);
    if (!acc) throw wrong;
    return { setupToken: await this.tokens.setup(acc.id, 'set_password') };
  }

  /** Sets (or resets) the password using the ticket from verifyOtp, then logs in. */
  async setPassword(setupToken: string, password: string, deviceLabel?: string): Promise<Session> {
    const { accountId, issuedAt } = await this.tokens.verify(setupToken, 'setup');
    checkPasswordStrength(password);
    const acc = (
      await this.db.query<{ password_set_at: Date | null }>(
        'SELECT password_set_at FROM accounts WHERE id = $1', [accountId])
    ).rows[0];
    if (!acc) throw unauthorized();
    // A ticket can only be used once: if the password changed after the ticket
    // was issued, the ticket is dead.
    if (acc.password_set_at && acc.password_set_at.getTime() >= issuedAt) {
      throw unauthorized('This link has already been used. Please start again.');
    }
    await this.db.query(
      `UPDATE accounts SET password_hash = $2, password_set_at = now(), must_change_password = false,
              failed_logins = 0, locked_until = NULL WHERE id = $1`,
      [accountId, await hashPassword(password)],
    );
    // Log out every other device after a password change.
    await this.db.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL',
      [accountId],
    );
    return this.issueSession(accountId, deviceLabel);
  }

  async login(phone: string, password: string, deviceLabel?: string): Promise<Session> {
    const acc = await this.findAccount(phone);
    const fail = unauthorized('Wrong phone number or password');
    if (!acc || !acc.password_hash) throw fail;
    if (acc.locked_until && acc.locked_until > new Date()) {
      throw tooMany(`Too many wrong tries. Try again after ${LOCK_MINUTES} minutes, or use "Forgot password".`);
    }
    if (!(await verifyPassword(acc.password_hash, password))) {
      await this.db.query(
        `UPDATE accounts SET failed_logins = failed_logins + 1,
           locked_until = CASE WHEN failed_logins + 1 >= $2
                               THEN now() + make_interval(mins => $3) ELSE NULL END
         WHERE id = $1`,
        [acc.id, LOGIN_MAX_FAILS, LOCK_MINUTES],
      );
      throw fail;
    }
    await this.db.query(
      'UPDATE accounts SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
      [acc.id],
    );
    return this.issueSession(acc.id, deviceLabel);
  }

  /**
   * One login box for everyone: email, mobile number or admission number.
   * Every wrong answer gives the same message, so the box can't be used to
   * find out who is registered.
   */
  async loginAny(identifier: string, password: string, deviceLabel?: string): Promise<Session> {
    const id = identifier.trim();
    const fail = unauthorized('Wrong login ID or password');
    if (!id || !password) throw fail;
    if (id.includes('@')) {
      const acc = (await this.db.query<{ id: string; password_hash: string | null; locked_until: Date | null }>(
        'SELECT id, password_hash, locked_until FROM accounts WHERE lower(email) = lower($1)', [id])).rows[0];
      return this.checkAccountPassword(acc, password, fail, deviceLabel);
    }
    const phone = normalizeIndianPhone(id);
    if (phone) {
      const acc = await this.findAccount(phone);
      if (acc) return this.checkAccountPassword(acc, password, fail, deviceLabel);
    }
    return this.parentLogin(normaliseAdmissionNo(id), password, fail, deviceLabel);
  }

  private async checkAccountPassword(
    acc: { id: string; password_hash: string | null; locked_until: Date | null } | undefined,
    password: string, fail: Error, deviceLabel?: string,
  ): Promise<Session> {
    if (!acc || !acc.password_hash) throw fail;
    if (acc.locked_until && acc.locked_until > new Date()) throw this.lockedError();
    if (!(await verifyPassword(acc.password_hash, password))) {
      await this.countFailure(acc.id);
      throw fail;
    }
    await this.db.query(
      'UPDATE accounts SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [acc.id]);
    return this.issueSession(acc.id, deviceLabel);
  }

  private lockedError() {
    return tooMany(this.mode === 'password'
      ? `Too many wrong tries. Try again after ${LOCK_MINUTES} minutes, or ask the school office to reset your password.`
      : `Too many wrong tries. Try again after ${LOCK_MINUTES} minutes, or use "Forgot password".`);
  }

  private countFailure(accountId: string) {
    return this.db.query(
      `UPDATE accounts SET failed_logins = failed_logins + 1,
         locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE NULL END
       WHERE id = $1`, [accountId, LOGIN_MAX_FAILS, LOCK_MINUTES]);
  }

  /** Parent: admission number + password (first time: the child's date of birth). */
  private async parentLogin(norm: string, password: string, fail: Error, deviceLabel?: string): Promise<Session> {
    if (norm.length < 2) throw fail;
    const key = `adm:${norm}`;
    const lock = (await this.db.query<{ locked_until: Date | null }>(
      'SELECT locked_until FROM login_failures WHERE login_key = $1', [key])).rows[0];
    if (lock?.locked_until && lock.locked_until > new Date()) throw this.lockedError();

    const matches = (await this.db.query<{
      student_id: string; family_id: string; account_id: string | null; family_phone: string; father_name: string; dob: string | Date | null;
    }>('SELECT * FROM parent_login_lookup($1)', [norm])).rows;

    for (const m of matches) {
      // The family's login is the account already linked, or else the one with the family's phone number.
      const acc = (await this.db.query<{ id: string; password_hash: string | null; locked_until: Date | null; must_change_password: boolean }>(
        `SELECT id, password_hash, locked_until, must_change_password FROM accounts
          WHERE id = coalesce($1, (SELECT id FROM accounts WHERE phone = $2))`,
        [m.account_id, m.family_phone])).rows[0];
      if (acc?.password_hash) {
        if (acc.locked_until && acc.locked_until > new Date()) throw this.lockedError();
        if (await verifyPassword(acc.password_hash, password)) {
          await this.db.query('SELECT link_parent_account($1, $2)', [m.family_id, acc.id]);
          await this.db.query('DELETE FROM login_failures WHERE login_key = $1', [key]);
          await this.db.query(
            'UPDATE accounts SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [acc.id]);
          return this.issueSession(acc.id, deviceLabel);
        }
        await this.countFailure(acc.id);
        continue;
      }
      // No password yet (first login or after a reset): the child's date of birth.
      // Never let a date of birth open a staff member's account (same phone number, no password yet).
      if (acc && (await this.isStaffAnywhere(acc.id))) continue;
      if (m.dob && dobDigits(password) === dobAsPassword(m.dob) && /^\d{8}$/.test(dobDigits(password))) {
        const accountId = acc?.id ?? (await this.db.query<{ id: string }>(
          `INSERT INTO accounts (phone, name) VALUES ($1, $2)
           ON CONFLICT (phone) DO UPDATE SET phone = excluded.phone RETURNING id`, [m.family_phone, m.father_name])).rows[0]!.id;
        await this.db.query('UPDATE accounts SET must_change_password = true, last_login_at = now(), failed_logins = 0, locked_until = NULL WHERE id = $1', [accountId]);
        await this.db.query('SELECT link_parent_account($1, $2)', [m.family_id, accountId]);
        await this.db.query('DELETE FROM login_failures WHERE login_key = $1', [key]);
        return this.issueSession(accountId, deviceLabel);
      }
    }
    await this.db.query(
      `INSERT INTO login_failures (login_key, failures) VALUES ($1, 1)
       ON CONFLICT (login_key) DO UPDATE SET
         failures = CASE WHEN login_failures.locked_until < now() THEN 1 ELSE login_failures.failures + 1 END,
         locked_until = CASE WHEN (CASE WHEN login_failures.locked_until < now() THEN 1 ELSE login_failures.failures + 1 END) >= $2
                             THEN now() + make_interval(mins => $3) ELSE NULL END,
         updated_at = now()`, [key, LOGIN_MAX_FAILS, LOCK_MINUTES]);
    throw fail;
  }

  private async isStaffAnywhere(accountId: string) {
    return !!(await this.db.query('SELECT staff_account_exists($1) AS yes', [accountId])).rows[0]?.yes;
  }

  /** "Change password": old password + new one. Other devices are logged out. */
  async changePassword(accountId: string, oldPassword: string, newPassword: string, deviceLabel?: string): Promise<Session> {
    const acc = (await this.db.query<{ password_hash: string | null; must_change_password: boolean; locked_until: Date | null }>(
      'SELECT password_hash, must_change_password, locked_until FROM accounts WHERE id = $1', [accountId])).rows[0];
    if (!acc) throw unauthorized();
    if (acc.locked_until && acc.locked_until > new Date()) throw this.lockedError();
    // A parent who logged in with the date of birth has no stored password yet:
    // they already proved it at login, so the old password isn't asked again.
    const needsOld = !!acc.password_hash && !acc.must_change_password;
    if (needsOld && !(await verifyPassword(acc.password_hash!, oldPassword))) {
      await this.countFailure(accountId);
      throw badRequest('wrong_password', 'Your current password is wrong');
    }
    checkPasswordStrength(newPassword);
    if (acc.password_hash && await verifyPassword(acc.password_hash, newPassword)) {
      throw badRequest('same_password', 'Choose a password different from the one the school gave you');
    }
    if (/^\d{8}$/.test(newPassword)) {
      throw badRequest('weak_password', 'Do not use a date of birth as your password');
    }
    await this.db.query(
      `UPDATE accounts SET password_hash = $2, password_set_at = now(), must_change_password = false,
              failed_logins = 0, locked_until = NULL WHERE id = $1`, [accountId, await hashPassword(newPassword)]);
    await this.revokeAll(accountId);
    return this.issueSession(accountId, deviceLabel);
  }

  /** The principal gives a staff member a first (or new) password. They must change it after logging in. */
  async setTemporaryPassword(accountId: string, password: string): Promise<void> {
    checkPasswordStrength(password);
    await this.db.query(
      `UPDATE accounts SET password_hash = $2, password_set_at = now(), must_change_password = true,
              failed_logins = 0, locked_until = NULL WHERE id = $1`, [accountId, await hashPassword(password)]);
    await this.revokeAll(accountId);
  }

  /** Logs someone out everywhere (e.g. a teacher who has left). */
  revokeAll(accountId: string) {
    return this.db.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [accountId]);
  }

  /** Swap an old refresh token for a fresh pair (old one stops working). */
  async refresh(refreshToken: string): Promise<Session> {
    const row = (
      await this.db.query<{ id: string; account_id: string }>(
        `UPDATE refresh_tokens SET revoked_at = now()
          WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
          RETURNING id, account_id`,
        [sha256(refreshToken)],
      )
    ).rows[0];
    if (!row) throw unauthorized();
    return this.issueSession(row.account_id);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.db.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [sha256(refreshToken)],
    );
  }

  /** Office resets someone's login: password removed, all devices logged out. */
  async resetLogin(accountId: string): Promise<void> {
    // In password mode a parent then logs in with the child's date of birth again.
    await this.db.query(
      `UPDATE accounts SET password_hash = NULL, password_set_at = now(), failed_logins = 0, locked_until = NULL,
              must_change_password = $2 WHERE id = $1`,
      [accountId, this.mode === 'password'],
    );
    await this.db.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL',
      [accountId],
    );
  }

  private async issueSession(accountId: string, deviceLabel?: string): Promise<Session> {
    const { token, hash } = newRefreshToken();
    await this.db.query(
      `INSERT INTO refresh_tokens (account_id, token_hash, device_label, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
      [accountId, hash, deviceLabel ?? null, REFRESH_TTL_DAYS],
    );
    const { must_change_password: mustChangePassword, ...acc } = (
      await this.db.query<{ id: string; name: string; phone: string; must_change_password: boolean }>(
        'SELECT id, name, phone, must_change_password FROM accounts WHERE id = $1', [accountId])
    ).rows[0]!;
    return { accessToken: await this.tokens.access(accountId, mustChangePassword), refreshToken: token, account: acc, mustChangePassword };
  }

  private async findAccount(phone: string) {
    return (
      await this.db.query<{ id: string; password_hash: string | null; locked_until: Date | null }>(
        'SELECT id, password_hash, locked_until FROM accounts WHERE phone = $1', [phone])
    ).rows[0];
  }
}
