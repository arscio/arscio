// Every screen talks to the aiedu server through this one door.
import { NextResponse, type NextRequest } from 'next/server';
import { callApi } from '@/lib/server/session';

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.text();
  const res = await callApi(url, { method: req.method, body });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { 'content-type': 'application/json' } });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
