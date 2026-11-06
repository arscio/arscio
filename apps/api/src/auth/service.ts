// The login flow, exactly as decided:
//   1. First time: phone -> OTP by SMS -> person sets a password
//   2. After that: phone + password
//   3. Forgot password: OTP -> set a new password
//   4. School office can reset a login (person goes back to step 1)
// Same flow for parents and teachers.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db.js';
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
}

export class AuthService {
  constructor(
    private db: Db,
    private tokens: Tokens,
    private otp: OtpSender,
    private secret: string,
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
      `UPDATE accounts SET password_hash = $2, password_set_at = now(),
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
    await this.db.query(
      'UPDATE accounts SET password_hash = NULL, password_set_at = now(), failed_logins = 0, locked_until = NULL WHERE id = $1',
      [accountId],
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
    const acc = (
      await this.db.query<{ id: string; name: string; phone: string }>(
        'SELECT id, name, phone FROM accounts WHERE id = $1', [accountId])
    ).rows[0]!;
    return { accessToken: await this.tokens.access(accountId), refreshToken: token, account: acc };
  }

  private async findAccount(phone: string) {
    return (
      await this.db.query<{ id: string; password_hash: string | null; locked_until: Date | null }>(
        'SELECT id, password_hash, locked_until FROM accounts WHERE phone = $1', [phone])
    ).rows[0];
  }
}
