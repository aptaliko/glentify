'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isNativeApp } from '@/lib/platform';
import { getAuthToken, clearAuthToken } from '@/lib/authToken';
import { isTokenLocallyValid } from '@/lib/tokenClient';

// Public routes that must render without a session (mirrors proxy.ts's PUBLIC_PATHS —
// the web equivalent of this guard). A native user with no/expired token still needs to
// reach these, so the guard never blocks or redirects them.
const PUBLIC_PREFIXES = ['/login', '/register', '/forgot-password', '/reset-password'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Native-only startup auth gate. On web, proxy.ts redirects an unauthenticated request
 * to /login before the page renders; proxy.ts is stripped from the mobile bundle, so
 * without this a native user with an expired session sees the home page and is only
 * bounced to /login on the next action that hits a 401 (via nativeApiFetch).
 *
 * This checks the token at mount — purely locally (parse the embedded expiry, NO
 * network) so being offline never forces a login — and redirects immediately when it's
 * missing or expired, rendering nothing meanwhile so protected content never flashes.
 * A locally-valid but server-rejected token (e.g. AUTH_SECRET rotated) is still caught
 * by nativeApiFetch's existing 401 redirect.
 *
 * On web (`isNativeApp() === false`) it's a pure passthrough.
 */
export default function NativeAuthGuard({ children }: { children: ReactNode }) {
  const native = isNativeApp();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = isPublicPath(pathname);
  // Non-native and public routes render immediately; a native protected route stays
  // gated (checked=false) until the one-time token check resolves. Once cleared it
  // stays cleared — in-app navigation never re-gates (nativeApiFetch's 401 is the
  // backstop for a session that dies mid-use), so there's no flash between screens.
  const [checked, setChecked] = useState(!native || isPublic);

  useEffect(() => {
    if (checked) return;
    let cancelled = false;
    getAuthToken().then(async (token) => {
      if (cancelled) return;
      if (isTokenLocallyValid(token)) {
        setChecked(true);
        return;
      }
      // Missing/expired: drop the dead token and route to /login via Next's client
      // router (a hard window.location.href doesn't resolve against Capacitor's local
      // asset server — see HomePage.handleLogout). Leave `checked` false so the
      // protected page never renders during the redirect.
      await clearAuthToken();
      router.replace('/login');
    });
    return () => {
      cancelled = true;
    };
  }, [checked, router]);

  if (!checked) return null;
  return <>{children}</>;
}
