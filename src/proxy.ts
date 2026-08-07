import { NextRequest, NextResponse } from 'next/server';
import { getAuthCookieName, verifySessionToken } from '@/lib/auth';

const MOBILE_ORIGINS = new Set(['capacitor://localhost', 'http://localhost', 'https://localhost']);

// Paths reachable without a session — auth pages and the API endpoints that establish one.
const PUBLIC_PATHS = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/api/login',
  '/api/register',
  '/api/forgot-password',
  '/api/reset-password',
]);

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !MOBILE_ORIGINS.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

  if (PUBLIC_PATHS.has(pathname)) {
    return applyCors(NextResponse.next(), cors);
  }

  const cookie = request.cookies.get(getAuthCookieName())?.value;
  const bearer = getBearerToken(request);
  const userId = verifySessionToken(cookie) ?? verifySessionToken(bearer);

  if (userId === null) {
    if (pathname.startsWith('/api/')) {
      return applyCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cors);
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', String(userId));
  return applyCors(NextResponse.next({ request: { headers: requestHeaders } }), cors);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
