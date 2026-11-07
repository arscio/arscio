// Shows a school's logo (public, like on its website and receipts).
import { NextResponse, type NextRequest } from 'next/server';
import { API_URL } from '@/lib/server/session';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 });
  const r = await fetch(`${API_URL}/schools/${id}/logo`, { cache: 'no-store' });
  if (!r.ok) return new NextResponse(null, { status: 404 });
  return new NextResponse(await r.arrayBuffer(), {
    headers: {
      'content-type': r.headers.get('content-type') ?? 'image/png',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}
