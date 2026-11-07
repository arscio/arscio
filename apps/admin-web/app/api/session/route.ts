// Choose which school you're working in (staff can belong to more than one).
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { SCHOOL, callApi } from '@/lib/server/session';

export async function POST(req: NextRequest) {
  const { schoolId } = (await req.json().catch(() => ({}))) as { schoolId?: string };
  if (!schoolId) return NextResponse.json({ error: { message: 'Choose a school' } }, { status: 400 });
  // Check the server agrees this person belongs to that school before saving it.
  const check = await callApi('/school', { method: 'GET', schoolId });
  if (!check.ok) return NextResponse.json(await check.json(), { status: check.status });
  (await cookies()).set(SCHOOL, schoolId, {
    httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 24 * 60 * 60,
  });
  return NextResponse.json({ ok: true });
}
