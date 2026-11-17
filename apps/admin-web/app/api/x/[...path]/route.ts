// Every screen talks to the arscio server through this one door.
// Files (photos, documents, ZIPs) pass through untouched, so they can be viewed or downloaded.
import { NextResponse, type NextRequest } from 'next/server';
import { callApi } from '@/lib/server/session';

const PASS = ['content-type', 'content-disposition', 'cache-control', 'x-content-type-options'];

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.text();
  const res = await callApi(url, { method: req.method, body });
  const type = res.headers.get('content-type') ?? 'application/json';
  if (type.startsWith('application/json')) {
    return new NextResponse(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
  }
  const headers = new Headers();
  for (const h of PASS) { const v = res.headers.get(h); if (v) headers.set(h, v); }
  return new NextResponse(res.body, { status: res.status, headers });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
