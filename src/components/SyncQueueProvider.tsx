// src/components/SyncQueueProvider.tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Network } from '@capacitor/network';
import { isNativeApp } from '@/lib/platform';
import { primeOfflineData } from '@/lib/offlineCache';
import { processQueue, dismissNeedsAttention } from '@/lib/syncQueue';
import { initSyncHandlers } from '@/lib/syncHandlers';

// A single systemic-error pass is almost always a transient blip — a dropped request, a cold
// serverless function, a momentary CORS/5xx — that the very next pass clears, with the queued
// work intact and still retrying. Showing the alarming "Ο συγχρονισμός σταμάτησε προσωρινά"
// notice for one blip is misleading (verified: an already-online reorder that syncs fine still
// flashed it). Only surface the notice once sync has stayed blocked across this many
// consecutive passes; any non-blocked pass resets the streak.
const BLOCKED_NOTICE_THRESHOLD = 2;

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
  // Consecutive systemic-error passes. Deliberately a ref, not persisted: a genuinely stuck
  // sync re-alarms after the same streak on a fresh app start (matching blockedDismissed's
  // "re-show on restart" contract), while a transient blip never trips the notice at all.
  const consecutiveBlockedRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!isNativeApp()) return;
    const result = await processQueue();
    setPendingCount(result.remaining);
    setNeedsAttentionCount(result.needsAttention);
    setConflictCount(result.conflict);
    // Escalate to the "σταμάτησε" notice only after BLOCKED_NOTICE_THRESHOLD consecutive
    // blocked passes — a lone blip resets the streak and falls through to the ordinary
    // "N εκκρεμεί συγχρονισμός" pending indicator instead. See BLOCKED_NOTICE_THRESHOLD above.
    consecutiveBlockedRef.current = result.blocked ? consecutiveBlockedRef.current + 1 : 0;
    const showBlocked = result.blocked && consecutiveBlockedRef.current >= BLOCKED_NOTICE_THRESHOLD;
    setBlocked(showBlocked);
    // Re-arm the notice: once sync is no longer showing as blocked, a *future* stall should
    // surface again even if the user had closed the previous one.
    if (!showBlocked) setBlockedDismissed(false);
    // If any queued write actually synced this pass (processed counts only successes), the
    // server has moved past what the blob last captured — re-pull it so the blob-reading
    // offline viewers (programs/local/*) don't show stale data. Before this, the blob was
    // ONLY re-primed on a networkStatusChange(connected) below, so an edit made and synced
    // while already online (no connectivity transition — the common case: reorder/rename in
    // Διαχείριση with a live connection) left the viewer stale until a manual
    // "Προετοιμασία για offline". The sequence viewer is mount-only, so a background re-prime
    // never disrupts a live gig; the program overview re-reads on foreground and picks it up.
    if (result.processed > 0) await primeOfflineData();
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;
    initSyncHandlers();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const listenerPromise = Network.addListener('networkStatusChange', async (status) => {
      if (!status.connected) return;
      await refresh(); // drain the write queue first (this re-primes if anything synced)
      // Always re-pull on a fresh reconnect, even when we synced nothing: a collaborator (or
      // this user on another device) may have changed shared data while we were offline.
      await primeOfflineData();
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
            {pendingCount === 1
              ? '1 συγχρονισμός εκκρεμεί'
              : `${pendingCount} συγχρονισμοί εκκρεμούν`}
          </div>
        )
      )}
    </SyncQueueContext.Provider>
  );
}
