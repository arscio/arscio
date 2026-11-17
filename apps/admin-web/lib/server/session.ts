// SERVER-SIDE ONLY. The website's own small server keeps the login tickets in
// secure cookies that the browser's JavaScript can never read. Every request
// from the screens goes through here, and we attach the ticket on the way to
// the arscio server. This protects logins even if a page were ever tampered with.
import 'server-only';
import { cookies } from 'next/headers';

export const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const ACCESS = 'arscio_at';
const REFRESH = 'arscio_rt';
export const SCHOOL = 'arscio_school';

const secure = process.env.NODE_ENV === 'production';
const base = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export async function saveSession(t: SessionTokens) {
  const jar = await cookies();
  jar.set(ACCESS, t.accessToken, { ...base, maxAge: 14 * 60 });
  jar.set(REFRESH, t.refreshToken, { ...base, maxAge: 60 * 24 * 60 * 60 });
}

export async function clearSession() {
  const jar = await cookies();
  for (const name of [ACCESS, REFRESH, SCHOOL]) jar.delete(name);
}

export async function getRefreshToken() {
  return (await cookies()).get(REFRESH)?.value;
}

async function refresh(): Promise<string | null> {
  const rt = await getRefreshToken();
  if (!rt) return null;
  const r = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: rt }),
    cache: 'no-store',
  });
  if (!r.ok) {
    await clearSession();
    return null;
  }
  const t = (await r.json()) as SessionTokens;
  await saveSession(t);
  return t.accessToken;
}

/** Call the arscio server as the logged-in person, renewing the ticket if needed. */
export async function callApi(path: string, init: { method: string; body?: string; schoolId?: string | null }) {
  const jar = await cookies();
  let token = jar.get(ACCESS)?.value ?? (await refresh());
  if (!token) return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Please log in' } }), { status: 401 });

  const send = (tok: string) => {
    const headers: Record<string, string> = { authorization: `Bearer ${tok}` };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const school = init.schoolId === undefined ? jar.get(SCHOOL)?.value : init.schoolId;
    if (school) headers['x-school-id'] = school;
    return fetch(`${API_URL}${path}`, { method: init.method, headers, body: init.body, cache: 'no-store' });
  };

  let res = await send(token);
  if (res.status === 401) {
    token = await refresh();
    if (token) res = await send(token);
  }
  return res;
}
