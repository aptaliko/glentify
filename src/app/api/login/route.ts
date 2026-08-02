import { NextRequest, NextResponse } from 'next/server';
import { isValidPassword, getAuthCookieName, getAuthCookieValue } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (typeof body.password !== 'string' || !isValidPassword(body.password)) {
    return NextResponse.json({ error: 'Λάθος κωδικός' }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true, token: getAuthCookieValue() });
  response.cookies.set(getAuthCookieName(), getAuthCookieValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
