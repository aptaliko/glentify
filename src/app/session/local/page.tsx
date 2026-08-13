'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageNav from '@/components/PageNav';
import LiveSessionView from '@/components/LiveSessionView';
import { LocalSessionStore } from '@/lib/sessionStore';
import { preferencesStore } from '@/lib/preferencesStore';
import { loadReferenceData } from '@/lib/offlineCache';
import { createLocalSongPickerDataSource } from '@/lib/songPickerData';
import type { ReferenceData } from '@/lib/referenceData';

export default function LocalSessionPage() {
  const router = useRouter();
  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  const [checkedCache, setCheckedCache] = useState(false);

  useEffect(() => {
    loadReferenceData()
      .then(setReferenceData)
      .finally(() => setCheckedCache(true));
  }, []);

  if (!checkedCache) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref="/" />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  if (!referenceData) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <PageNav backHref="/" />
        <p className="text-lg">Δεν υπάρχουν αποθηκευμένα τραγούδια στη συσκευή.</p>
        <Link href="/" className="btn btn-primary">
          Πήγαινε στην αρχική για συγχρονισμό
        </Link>
      </main>
    );
  }

  const store = new LocalSessionStore(referenceData, preferencesStore);

  return (
    <LiveSessionView
      store={store}
      onEnded={() => router.push('/')}
      songPickerDataSource={createLocalSongPickerDataSource(referenceData)}
    />
  );
}
