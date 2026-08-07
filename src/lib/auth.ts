import { createHmac, timingSafeEqual } from 'crypto';

const COOKIE_NAME = 'glentify_auth';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days, matches the existing cookie maxAge

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET env var is not set');
  return secret;
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('hex');
}

export function getAuthCookieName(): string {
  return COOKIE_NAME;
}

export function createSessionToken(userId: number): string {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userIdStr, expStr, signature] = parts;
  const payload = `${userIdStr}.${expStr}`;
  const expected = sign(payload);
  const actual = Buffer.from(signature, 'hex');
  const wanted = Buffer.from(expected, 'hex');
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const userId = Number(userIdStr);
  if (!Number.isInteger(userId)) return null;
  return userId;
}
