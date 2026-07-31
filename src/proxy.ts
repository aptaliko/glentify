import { NextRequest, NextResponse } from 'next/server';
import { getAuthCookieName, isAuthCookieValid } from '@/lib/auth';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/login' || pathname === '/api/login') {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(getAuthCookieName())?.value;
  if (!isAuthCookieValid(cookie)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
