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

  const refresh = useCallback(async () => {
    if (!isNativeApp()) return;
    const result = await processQueue();
    setPendingCount(result.remaining);
    setNeedsAttentionCount(result.needsAttention);
    setConflictCount(result.conflict);
    setBlocked(result.blocked);
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
    return () => {
      listenerPromise.then((listener) => listener.remove());
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
        ) : (
          <div
            className={`fixed bottom-4 right-4 z-50 rounded-full px-3 py-1 text-sm shadow ${
              blocked ? 'bg-warning text-warning-content' : 'bg-info text-info-content'
            }`}
          >
            {blocked
              ? 'Ο συγχρονισμός σταμάτησε προσωρινά'
              : `${pendingCount} εκκρεμεί συγχρονισμός`}
          </div>
        )
      )}
    </SyncQueueContext.Provider>
  );
}
