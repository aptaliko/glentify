import { createHmac } from 'crypto';

const COOKIE_NAME = 'glentify_auth';

function getExpectedToken(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET env var is not set');
  return createHmac('sha256', secret).update('authenticated').digest('hex');
}

export function isValidPassword(password: string): boolean {
  return password === process.env.APP_PASSWORD;
}

export function getAuthCookieName(): string {
  return COOKIE_NAME;
}

export function getAuthCookieValue(): string {
  return getExpectedToken();
}

export function isAuthCookieValid(value: string | undefined): boolean {
  if (!value) return false;
  return value === getExpectedToken();
}
