import { useEffect } from 'react';

/**
 * Holds a screen wake lock for the lifetime of the calling component so the
 * device screen does not sleep mid-song during a live session. Re-acquires on
 * `visibilitychange` because the browser auto-releases the lock whenever the
 * tab is hidden (switching apps, locking, notification shade). A no-op where
 * the Screen Wake Lock API is unavailable.
 */
export function useKeepScreenAwake(): void {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    async function acquire() {
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        // request rejects if not visible / not allowed — retried on next visibilitychange
        sentinel = null;
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible' && !released && !sentinel) {
        void acquire();
      }
    }

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release();
      sentinel = null;
    };
  }, []);
}
