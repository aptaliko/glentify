// src/components/SyncQueueProvider.tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Network } from '@capacitor/network';
import { isNativeApp } from '@/lib/platform';
import { primeOfflineData } from '@/lib/offlineCache';
import { processQueue, dismissNeedsAttention } from '@/lib/syncQueue';
import { initSyncHandlers } from '@/lib/syncHandlers';

interface SyncQueueContextValue {
  pendingCount: number;
  needsAttentionCount: number;
  conflictCount: number;
  blocked: boolean;
  notifyQueueChanged: () => Promise<void>;
}

const SyncQueueContext = createContext<SyncQueueContextValue>({
  pendingCount: 0,
  needsAttentionCount: 0,
  conflictCount: 0,
  blocked: false,
  notifyQueueChanged: async () => {},
});

export function useSyncQueue(): SyncQueueContextValue {
  return useContext(SyncQueueContext);
}

export default function SyncQueueProvider({ children }: { children: ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);
  const [needsAttentionCount, setNeedsAttentionCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [blocked, setBlocked] = useState(false);
  // UI-only acknowledgement of the "sync paused" notice. Deliberately NOT persisted and
  // NOT written to the queue: the blocked state means the pending edits are still live and
  // will retry — closing the badge only hides the notice, it never drops work. Kept as
  // component state so an app restart re-shows it if sync is still genuinely stuck.
  const [blockedDismissed, setBlockedDismissed] = useState(false);

  const refresh = useCallback(async () => {
    if (!isNativeApp()) return;
    const result = await processQueue();
    setPendingCount(result.remaining);
    setNeedsAttentionCount(result.needsAttention);
    setConflictCount(result.conflict);
    setBlocked(result.blocked);
    // Re-arm the notice: once a pass is no longer blocked, a *future* stall should surface
    // again even if the user had closed the previous one.
    if (!result.blocked) setBlockedDismissed(false);
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;
    initSyncHandlers();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const listenerPromise = Network.addListener('networkStatusChange', async (status) => {
      if (!status.connected) return;
      await refresh(); // drain the write queue first
      await primeOfflineData(); // then re-pull server truth into the blob
    });
    // App-resume retry. The queue is otherwise only drained on mount, a
    // networkStatusChange(connected), or a page's notifyQueueChanged() — there is no timer
    // or polling. If the device reconnects while the app is backgrounded, or Android reports
    // "connected" during a hotspot handoff before routing is actually usable (one failed
    // attempt → sticky `blocked` state), nothing ever retries and the user is stuck until a
    // manual force-quit. `visibilitychange` fires `visible` whenever the Capacitor WebView
    // returns to the foreground, giving us that missing retry without a new native plugin.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      listenerPromise.then((listener) => listener.remove());
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  // Dismiss every needsAttention item the user has acknowledged, then recount. These
  // items are dead (permanently skipped, never retried), so clearing them loses nothing
  // beyond the sticky badge itself — and is what makes it not "visible all the time".
  const dismissAll = useCallback(async () => {
    await dismissNeedsAttention();
    await refresh();
  }, [refresh]);

  return (
    <SyncQueueContext.Provider value={{ pendingCount, needsAttentionCount, conflictCount, blocked, notifyQueueChanged: refresh }}>
      {children}
      {isNativeApp() && pendingCount > 0 && (
        needsAttentionCount > 0 ? (
          // Tappable: acknowledging clears the flagged items so the badge (and the
          // per-item notes it mirrors) stop showing.
          <button
            type="button"
            onClick={dismissAll}
            className="fixed bottom-4 right-4 z-50 rounded-full bg-error px-3 py-1 text-sm text-error-content shadow"
          >
            {conflictCount > 0
              ? `${conflictCount} αλλαγές δεν εφαρμόστηκαν`
              : `${needsAttentionCount} χρειάζεται προσοχή`}
            <span className="ml-2 opacity-80">✕</span>
          </button>
        ) : blocked ? (
          // Closeable: hides the notice only (queue untouched, still retrying). Reappears on
          // the next stall or app restart via the blockedDismissed reset in refresh().
          blockedDismissed ? null : (
            <button
              type="button"
              onClick={() => setBlockedDismissed(true)}
              className="fixed bottom-4 right-4 z-50 rounded-full bg-warning px-3 py-1 text-sm text-warning-content shadow"
            >
              Ο συγχρονισμός σταμάτησε προσωρινά
              <span className="ml-2 opacity-80">✕</span>
            </button>
          )
        ) : (
          <div className="fixed bottom-4 right-4 z-50 rounded-full bg-info px-3 py-1 text-sm text-info-content shadow">
            {`${pendingCount} εκκρεμεί συγχρονισμός`}
          </div>
        )
      )}
    </SyncQueueContext.Provider>
  );
}
