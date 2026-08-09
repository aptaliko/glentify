'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loadReferenceData } from '@/lib/offlineCache';
import { preferencesStore } from '@/lib/preferencesStore';
import { getSelectedProgramId, setSelectedSequenceId } from '@/lib/localProgramsStore';
import type { ReferenceData, OfflineSequence } from '@/lib/referenceData';
import type { SongRow } from '@/db/schema';

const PREVIEW_COUNT = 7;

export default function LocalProgramPage() {
  const router = useRouter();
  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  const [programId, setProgramId] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    Promise.all([loadReferenceData(), getSelectedProgramId(preferencesStore)])
      .then(([data, id]) => {
        setReferenceData(data);
        setProgramId(id);
      })
      .finally(() => setChecked(true));
  }, []);

  async function handleSelectSequence(sequence: OfflineSequence) {
    await setSelectedSequenceId(preferencesStore, sequence.id);
    router.push('/programs/local/sequence');
  }

  if (!checked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  const program = referenceData?.programs.find((p) => p.id === programId) ?? null;

  if (!referenceData || !program) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <p className="text-lg">Το πρόγραμμα δεν βρέθηκε.</p>
        <Link href="/programs/local" className="btn btn-primary">← Όλα τα προγράμματα</Link>
      </main>
    );
  }

  const songsById = new Map<number, SongRow>(referenceData.songs.map((s) => [s.id, s]));

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <h1 className="text-2xl font-bold">{program.title}</h1>
      <div className="grid w-full max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
        {program.sequences.map((seq) => {
          const songs = seq.songIds.map((id) => songsById.get(id)).filter((s): s is SongRow => s !== undefined);
          const remaining = songs.length - PREVIEW_COUNT;
          return (
            <div key={seq.id} className="card flex h-72 flex-col bg-base-100 shadow">
              <div className="card-body flex flex-1 flex-col gap-2 overflow-hidden p-4">
                <button onClick={() => handleSelectSequence(seq)} className="btn btn-outline btn-sm w-full shrink-0">
                  {seq.title}
                </button>
                <div className="flex-1 overflow-y-auto">
                  <ul className="flex flex-col gap-1 text-sm text-base-content/60">
                    {songs.slice(0, PREVIEW_COUNT).map((s, i) => (
                      <li key={s.id}>{i + 1}. {s.title}</li>
                    ))}
                  </ul>
                  {remaining > 0 && (
                    <p className="pt-1 text-xs italic text-base-content/40">+{remaining} ακόμα…</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {program.sequences.length === 0 && (
          <p className="col-span-full p-3 text-center text-sm text-base-content/50">Καμία σειρά ακόμη</p>
        )}
      </div>
      <Link href="/programs/local" className="link">← Όλα τα προγράμματα</Link>
    </main>
  );
}
