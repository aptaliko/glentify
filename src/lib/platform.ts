import { Capacitor } from '@capacitor/core';

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Render-safe variant of `isNativePlatform()`.
 *
 * `isNativePlatform()` inspects the global object for the Capacitor bridge, so on the
 * server (prerender) it always answers `false`. Calling it directly in a component body
 * would therefore make the native client's first render disagree with the prerendered
 * HTML (a hydration mismatch). This helper keeps the two in sync:
 *
 * - In the mobile bundle (`npm run build:mobile` sets `NEXT_PUBLIC_MOBILE_BUILD=1`) the
 *   answer is a build-time constant `true`, so the export is prerendered *and* hydrated
 *   as native — no mismatch, and no web-only UI is ever rendered on device.
 * - In the web bundle the flag is absent, so the answer is `false` during prerender and
 *   `false` in the browser (a browser has no Capacitor bridge) — identical to today.
 *
 * Because the result is stable for a given build, it can be read during render instead of
 * being deferred to an effect, which avoids a one-frame flash of the wrong platform's UI.
 */
export function isNativeApp(): boolean {
  if (process.env.NEXT_PUBLIC_MOBILE_BUILD === '1') return true;
  if (typeof window === 'undefined') return false;
  return isNativePlatform();
}
