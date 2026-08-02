import { NextRequest, NextResponse } from 'next/server';
import { getAuthCookieName, isAuthCookieValid } from '@/lib/auth';

const MOBILE_ORIGINS = new Set(['capacitor://localhost', 'http://localhost', 'https://localhost']);

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !MOBILE_ORIGINS.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function applyCors(response: NextResponse, cors: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
  return response;
}

function getBearerToken(request: NextRequest): string | undefined {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const cors = corsHeaders(request.headers.get('origin'));

  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: cors });
  }

  if (pathname === '/login' || pathname === '/api/login') {
    return applyCors(NextResponse.next(), cors);
  }

  const cookie = request.cookies.get(getAuthCookieName())?.value;
  const bearer = getBearerToken(request);
  const isAuthed = isAuthCookieValid(cookie) || isAuthCookieValid(bearer);

  if (!isAuthed) {
    if (pathname.startsWith('/api/')) {
      return applyCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cors);
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return applyCors(NextResponse.next(), cors);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
