'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PageNav from '@/components/PageNav';
import { loadReferenceData } from '@/lib/offlineCache';
import { preferencesStore } from '@/lib/preferencesStore';
import { getLastEndedSession, clearLastEndedSession } from '@/lib/sessionStore';
import { mergeReferencedSongs } from '@/lib/referenceData';
import { enqueue } from '@/lib/syncQueue';
import { useSyncQueue } from '@/components/SyncQueueProvider';
import type { OfflineProgram } from '@/lib/referenceData';
import type { SongRow } from '@/db/schema';

interface SongEntry {
  id: number;
  title: string;
}

interface SequenceGroup {
  songs: SongEntry[];
}

type Destination = 'new' | 'existing';

function todayLabel(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export default function LocalSaveSessionPage() {
  const router = useRouter();
  const { notifyQueueChanged } = useSyncQueue();
  const [sequences, setSequences] = useState<SequenceGroup[] | null>(null);
  const [titles, setTitles] = useState<string[]>([]);
  const [destination, setDestination] = useState<Destination>('new');
  const [newTitle, setNewTitle] = useState('');
  const [programs, setPrograms] = useState<OfflineProgram[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getLastEndedSession(preferencesStore), loadReferenceData()])
      .then(([lastEnded, referenceData]) => {
        if (!lastEnded || lastEnded.sequences.length === 0 || !referenceData) {
          router.replace('/');
          return;
        }
        const songsById = new Map<number, SongRow>(
          mergeReferencedSongs(referenceData.songs, referenceData.sharedSongs).map((s) => [s.id, s])
        );
        const resolved: SequenceGroup[] = lastEnded.sequences.map((seq) => ({
          songs: seq.songIds
            .map((id) => songsById.get(id))
            .filter((s): s is SongRow => s !== undefined)
            .map((s) => ({ id: s.id, title: s.title })),
        }));
        setSequences(resolved);
        setTitles(resolved.map((_, i) => `Σειρά ${i + 1}`));
        setNewTitle(`Γλέντι ${todayLabel()}`);
        setPrograms(referenceData.programs);
      })
      .catch(() => router.replace('/'));
  }, [router]);

  useEffect(() => {
    if (!sequences) return;
    const today = todayLabel();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitles(sequences.map((_, i) => (destination === 'existing' ? `${today} — Σειρά ${i + 1}` : `Σειρά ${i + 1}`)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination]);

  function updateTitle(index: number, value: string) {
    setTitles((prev) => prev.map((t, i) => (i === index ? value : t)));
  }

  async function handleSave() {
    if (!sequences) return;
    if (destination === 'existing' && selectedProgramId === null) return;
    setSaving(true);
    setSaveError(null);
    const sequencePayload = sequences.map((seq, i) => ({ title: titles[i], songIds: seq.songs.map((s) => s.id) }));
    const payload =
      destination === 'new'
        ? { destination: 'new' as const, title: newTitle, sequences: sequencePayload }
        : { destination: 'existing' as const, programId: selectedProgramId as number, sequences: sequencePayload };
    try {
      await enqueue('session-save', payload);
      await clearLastEndedSession(preferencesStore);
      notifyQueueChanged();
      router.replace('/');
    } catch {
      setSaving(false);
      setSaveError('Κάτι πήγε στραβά κατά την αποθήκευση.');
    }
  }

  async function handleSkip() {
    await clearLastEndedSession(preferencesStore);
    router.replace('/');
  }

  const hasBlankTitle = titles.some((t) => !t.trim()) || (destination === 'new' && !newTitle.trim());

  if (!sequences) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref="/" />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <PageNav backHref="/" />
      <h1 className="text-2xl font-bold">Αποθήκευση γλεντιού</h1>

      <div className="card w-full max-w-md bg-base-100 shadow">
        <div className="card-body gap-3">
          {sequences.map((seq, i) => (
            <div key={i} className="flex flex-col gap-1">
              <input
                className="input input-bordered input-sm w-full"
                value={titles[i] ?? ''}
                onChange={(e) => updateTitle(i, e.target.value)}
              />
              <p className="text-xs text-base-content/50">{seq.songs.map((s) => s.title).join(' · ')}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card w-full max-w-md bg-base-100 shadow">
        <div className="card-body gap-3">
          <div className="flex gap-2">
            <button
              className={`btn btn-sm flex-1 ${destination === 'new' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setDestination('new')}
            >
              Νέο Σταθερό Πρόγραμμα
            </button>
            <button
              className={`btn btn-sm flex-1 ${destination === 'existing' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setDestination('existing')}
            >
              Πρόσθεση σε υπάρχον πρόγραμμα
            </button>
          </div>

          {destination === 'new' ? (
            <input className="input input-bordered w-full" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          ) : (
            <select
              className="select select-bordered w-full"
              value={selectedProgramId ?? ''}
              onChange={(e) => setSelectedProgramId(Number(e.target.value))}
            >
              <option value="" disabled>
                Διάλεξε πρόγραμμα
              </option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}

          {saveError && <p className="text-sm text-error">{saveError}</p>}

          <button
            className="btn btn-primary w-full"
            disabled={(destination === 'existing' && selectedProgramId === null) || hasBlankTitle || saving}
            onClick={handleSave}
          >
            {saving ? 'Αποθήκευση...' : 'Αποθήκευση (θα σταλεί μόλις υπάρξει σύνδεση)'}
          </button>
          <button className="btn btn-ghost w-full" onClick={handleSkip}>
            Παράλειψη
          </button>
        </div>
      </div>
    </main>
  );
}
