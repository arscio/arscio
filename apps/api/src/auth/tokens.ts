// Login "tickets".
//  - access token: short-lived (15 min), sent with every request
//  - refresh token: long-lived (60 days), lets the phone app stay logged in;
//    only a scrambled copy is stored, and it is replaced on every use
//  - setup token: 10 min ticket, given after a correct OTP, used to set a password
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { unauthorized } from '../errors.js';

const ACCESS_TTL = '15m';
const SETUP_TTL = '10m';
export const REFRESH_TTL_DAYS = 60;

export class Tokens {
  private key: Uint8Array;
  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async access(accountId: string): Promise<string> {
    return new SignJWT({ typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(accountId)
      .setIssuedAt()
      .setExpirationTime(ACCESS_TTL)
      .sign(this.key);
  }

  async setup(accountId: string, purpose: string): Promise<string> {
    return new SignJWT({ typ: 'setup', purpose, iatMs: Date.now() })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(accountId)
      .setIssuedAt()
      .setExpirationTime(SETUP_TTL)
      .sign(this.key);
  }

  async verify(token: string, typ: 'access' | 'setup') {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      if (payload.typ !== typ || !payload.sub) throw new Error('wrong token type');
      const issuedAt = typeof payload.iatMs === 'number' ? payload.iatMs : (payload.iat ?? 0) * 1000;
      return { accountId: payload.sub, issuedAt, payload };
    } catch {
      throw unauthorized();
    }
  }
}

export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
