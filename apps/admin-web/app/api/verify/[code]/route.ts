// Public: checks a marksheet code (from the QR code) with the arscio server. No login.
import { NextResponse, type NextRequest } from 'next/server';
import { API_URL } from '@/lib/server/session';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  if (!/^[A-Za-z0-9-]{4,20}$/.test(code)) return NextResponse.json({ valid: false });
  const r = await fetch(`${API_URL}/verify/${encodeURIComponent(code)}`, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  return NextResponse.json(await r.json());
}
