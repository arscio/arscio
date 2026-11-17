// Login steps, passed through to the arscio server. When a step returns login
// tickets, we keep them in secure cookies and give the page only the name.
import { NextResponse, type NextRequest } from 'next/server';
import { API_URL, callApi, clearSession, getRefreshToken, saveSession } from '@/lib/server/session';

const ALLOWED = new Set(['start', 'verify-otp', 'set-password', 'login', 'forgot']);

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;

  if (action === 'logout') {
    const rt = await getRefreshToken();
    if (rt) {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }),
      }).catch(() => {});
    }
    await clearSession();
    return NextResponse.json({ ok: true });
  }
  if (action === 'change-password') {
    // Needs the person's current login ticket (kept in the cookie, never shown to the page).
    const body = { ...(await req.json().catch(() => ({}))), device: 'Admin website' };
    const r = await callApi('/auth/change-password', { method: 'POST', body: JSON.stringify(body), schoolId: null });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.accessToken) {
      await saveSession(data);
      return NextResponse.json({ account: data.account, mustChangePassword: false });
    }
    return NextResponse.json(data, { status: r.status });
  }
  if (!ALLOWED.has(action)) return NextResponse.json({ error: { message: 'Not found' } }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  if (action === 'set-password' || action === 'login') body.device = 'Admin website';
  const r = await fetch(`${API_URL}/auth/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await r.json().catch(() => ({}));
  if (r.ok && data.accessToken) {
    await saveSession(data);
    return NextResponse.json({ account: data.account, mustChangePassword: !!data.mustChangePassword });
  }
  return NextResponse.json(data, { status: r.status });
}

/** GET /api/auth/mode: "otp" or "password", so the login page shows the right boxes. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (action !== 'mode') return NextResponse.json({ error: { message: 'Not found' } }, { status: 404 });
  const r = await fetch(`${API_URL}/auth/mode`, { cache: 'no-store' }).catch(() => null);
  const data = r?.ok ? await r.json() : { mode: 'otp' };
  return NextResponse.json(data);
}
