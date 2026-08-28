'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PageNav from '@/components/PageNav';

interface SongEntry {
  id: number;
  title: string;
}

interface SequenceGroup {
  songs: SongEntry[];
}

interface AccessibleProgram {
  id: number;
  title: string;
}

type Destination = 'new' | 'existing';

function todayLabel(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export default function SaveSessionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [sequences, setSequences] = useState<SequenceGroup[] | null>(null);
  const [titles, setTitles] = useState<string[]>([]);
  const [destination, setDestination] = useState<Destination>('new');
  const [newTitle, setNewTitle] = useState('');
  const [programs, setPrograms] = useState<AccessibleProgram[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/sessions/${params.id}/played-grouped`)
      .then((r) => r.json())
      .then((data: { sequences: SequenceGroup[] }) => {
        if (data.sequences.length === 0) {
          router.replace('/');
          return;
        }
        setSequences(data.sequences);
        setTitles(data.sequences.map((_, i) => `Σειρά ${i + 1}`));
        setNewTitle(`Γλέντι ${todayLabel()}`);
      });
    fetch('/api/programs')
      .then((r) => r.json())
      .then(setPrograms);
  }, [params.id, router]);

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

  const hasBlankTitle = titles.some((t) => !t.trim()) || (destination === 'new' && !newTitle.trim());

  async function handleSave() {
    if (!sequences) return;
    if (destination === 'existing' && selectedProgramId === null) return;
    setSaving(true);
    setError(null);
    const body =
      destination === 'new'
        ? { destination: 'new' as const, title: newTitle, sequenceTitles: titles }
        : { destination: 'existing' as const, programId: selectedProgramId as number, sequenceTitles: titles };
    const res = await fetch(`/api/sessions/${params.id}/save-as-program`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      setError('Κάτι πήγε στραβά κατά την αποθήκευση.');
      return;
    }
    router.replace('/');
  }

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

          {error && <p className="text-sm text-error">{error}</p>}

          <button
            className="btn btn-primary w-full"
            disabled={saving || (destination === 'existing' && selectedProgramId === null) || hasBlankTitle}
            onClick={handleSave}
          >
            Αποθήκευση
          </button>
          <button className="btn btn-ghost w-full" onClick={() => router.push('/')}>
            Παράλειψη
          </button>
        </div>
      </div>
    </main>
  );
}
