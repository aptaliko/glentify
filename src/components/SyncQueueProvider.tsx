// src/components/SyncQueueProvider.tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Network } from '@capacitor/network';
import { isNativeApp } from '@/lib/platform';
import { primeOfflineData } from '@/lib/offlineCache';
import { processQueue, getQueuedActions } from '@/lib/syncQueue';
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
    setBlocked(result.blocked);
    const actions = await getQueuedActions();
    setConflictCount(actions.filter((a) => a.needsAttention && a.needsAttentionReason === 'conflict').length);
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

  return (
    <SyncQueueContext.Provider value={{ pendingCount, needsAttentionCount, conflictCount, blocked, notifyQueueChanged: refresh }}>
      {children}
      {isNativeApp() && pendingCount > 0 && (
        <div
          className={`fixed bottom-4 right-4 z-50 rounded-full px-3 py-1 text-sm shadow ${
            needsAttentionCount > 0
              ? 'bg-error text-error-content'
              : blocked
                ? 'bg-warning text-warning-content'
                : 'bg-info text-info-content'
          }`}
        >
          {needsAttentionCount > 0
            ? (conflictCount > 0
                ? `${conflictCount} άλλαξαν από συνεργάτη`
                : `${needsAttentionCount} χρειάζεται προσοχή`)
            : blocked
              ? 'Ο συγχρονισμός σταμάτησε προσωρινά'
              : `${pendingCount} εκκρεμεί συγχρονισμός`}
        </div>
      )}
    </SyncQueueContext.Provider>
  );
}
