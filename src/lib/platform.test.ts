import { describe, it, expect, afterEach, vi } from 'vitest';
import { isNativeApp } from './platform';

const globals = globalThis as unknown as { window?: unknown; androidBridge?: unknown };

afterEach(() => {
  vi.unstubAllEnvs();
  delete globals.window;
  delete globals.androidBridge;
});

describe('isNativeApp', () => {
  it('is false on the server (no window) in a web build', () => {
    expect(isNativeApp()).toBe(false);
  });

  it('is false in a browser without a Capacitor bridge', () => {
    globals.window = globals;
    expect(isNativeApp()).toBe(false);
  });

  it('is true in a browser with a Capacitor bridge', () => {
    globals.window = globals;
    globals.androidBridge = {};
    expect(isNativeApp()).toBe(true);
  });

  it('is true during prerender of the mobile build, so markup matches the native client', () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_BUILD', '1');
    expect(isNativeApp()).toBe(true);
  });
});
