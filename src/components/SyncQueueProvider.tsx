// src/components/SyncQueueProvider.tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Network } from '@capacitor/network';
import { isNativeApp } from '@/lib/platform';
import { processQueue } from '@/lib/syncQueue';
import { initSyncHandlers } from '@/lib/syncHandlers';

interface SyncQueueContextValue {
  pendingCount: number;
  needsAttentionCount: number;
  notifyQueueChanged: () => void;
}

const SyncQueueContext = createContext<SyncQueueContextValue>({
  pendingCount: 0,
  needsAttentionCount: 0,
  notifyQueueChanged: () => {},
});

export function useSyncQueue(): SyncQueueContextValue {
  return useContext(SyncQueueContext);
}

export default function SyncQueueProvider({ children }: { children: ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);
  const [needsAttentionCount, setNeedsAttentionCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!isNativeApp()) return;
    const result = await processQueue();
    setPendingCount(result.remaining);
    setNeedsAttentionCount(result.needsAttention);
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;
    initSyncHandlers();
    refresh();
    const listenerPromise = Network.addListener('networkStatusChange', (status) => {
      if (status.connected) refresh();
    });
    return () => {
      listenerPromise.then((listener) => listener.remove());
    };
  }, [refresh]);

  return (
    <SyncQueueContext.Provider value={{ pendingCount, needsAttentionCount, notifyQueueChanged: refresh }}>
      {children}
      {isNativeApp() && pendingCount > 0 && (
        <div
          className={`fixed bottom-4 right-4 z-50 rounded-full px-3 py-1 text-sm shadow ${
            needsAttentionCount > 0 ? 'bg-error text-error-content' : 'bg-info text-info-content'
          }`}
        >
          {needsAttentionCount > 0 ? `${needsAttentionCount} χρειάζεται προσοχή` : `${pendingCount} εκκρεμεί συγχρονισμός`}
        </div>
      )}
    </SyncQueueContext.Provider>
  );
}
