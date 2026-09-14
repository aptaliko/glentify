// Client-safe session-token inspection for the native build.
//
// `auth.ts`'s verifySessionToken can't run on the client — it needs AUTH_SECRET and
// Node crypto (timingSafeEqual/Buffer), neither of which exists in the mobile bundle.
// The token embeds its own expiry (`${userId}.${expiresAtSeconds}.${hmacSignature}`),
// so this parses the expiry WITHOUT the secret. It cannot verify the signature — only
// detect a structurally-present, unexpired token — which is exactly what a startup
// redirect needs (offline-safe, no network). Full validity is still enforced
// server-side: proxy.ts on web, and the 401 backstop in nativeApiFetch on native.
export function isTokenLocallyValid(token: string | null): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const exp = Number(parts[1]);
  return Number.isFinite(exp) && exp >= Math.floor(Date.now() / 1000);
}
