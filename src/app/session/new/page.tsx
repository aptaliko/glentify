'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageNav from '@/components/PageNav';
import SongPicker from '@/components/SongPicker';
import { isNativeApp } from '@/lib/platform';
import { LocalSessionStore } from '@/lib/sessionStore';
import { preferencesStore } from '@/lib/preferencesStore';
import { loadReferenceData } from '@/lib/offlineCache';
import { createLocalSongPickerDataSource } from '@/lib/songPickerData';
import type { ReferenceData } from '@/lib/referenceData';

export default function NewSessionPage() {
  const router = useRouter();
  // Resolved during render (not in an effect) so the native branch is chosen before
  // SongPicker can mount with its web/remote data source. See isNativeApp().
  const native = isNativeApp();
  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  const [checkedCache, setCheckedCache] = useState(false);

  useEffect(() => {
    if (!native) return;
    loadReferenceData()
      .then(setReferenceData)
      .finally(() => setCheckedCache(true));
  }, [native]);

  async function handleSelect(songId: number) {
    if (native) {
      if (!referenceData) return;
      await LocalSessionStore.start(songId, referenceData, preferencesStore);
      router.push('/session/local');
      return;
    }
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startingSongId: songId }),
    });
    const session = await res.json();
    router.push(`/session/${session.id}`);
  }

  if (native && !checkedCache) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref="/" />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  if (native && !referenceData) {
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

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
      <PageNav backHref="/" />
      <h1 className="text-2xl font-bold">Ξεκίνα γλέντι — διάλεξε πρώτο τραγούδι</h1>
      <SongPicker onSelect={handleSelect} dataSource={native && referenceData ? createLocalSongPickerDataSource(referenceData) : undefined} />
    </main>
  );
}
