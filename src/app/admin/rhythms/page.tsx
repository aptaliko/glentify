'use client';

import { useEffect, useState } from 'react';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { loadReferenceData } from '@/lib/offlineCache';
import { getQueuedActions } from '@/lib/syncQueue';
import { mergeTaxonomyWithPending, type DisplayTaxonomyValue } from '@/lib/taxonomyMerge';
import { addTaxonomyValue, removeTaxonomyValue, drainWebTaxonomyQueue } from '@/lib/taxonomyActions';
import { useSyncQueue } from '@/components/SyncQueueProvider';

const ENTITY = 'rhythms' as const;

export default function RhythmsAdminPage() {
  const { pendingCount, notifyQueueChanged } = useSyncQueue();
  const [rhythms, setRhythms] = useState<DisplayTaxonomyValue[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  async function load() {
    await drainWebTaxonomyQueue();
    const actions = await getQueuedActions();
    try {
      const res = await nativeApiFetch('/api/rhythms');
      if (!res.ok) throw new Error('bad status');
      const base = await res.json();
      setRhythms(mergeTaxonomyWithPending(base, actions, ENTITY));
      setOffline(false);
    } catch {
      const data = await loadReferenceData();
      setRhythms(mergeTaxonomyWithPending(data?.rhythms ?? [], actions, ENTITY));
      setOffline(true);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [pendingCount]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await addTaxonomyValue(ENTITY, name);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setName('');
    await notifyQueueChanged();
    await load();
  }

  async function handleDelete(id: number) {
    setError(null);
    try {
      await removeTaxonomyValue(ENTITY, id);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    await notifyQueueChanged();
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Ρυθμοί</h1>
      {offline && <p className="text-sm text-warning">Χωρίς σύνδεση — οι αλλαγές θα συγχρονιστούν αργότερα.</p>}
      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={handleCreate} className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Όνομα ρυθμού" className="input input-bordered flex-1" required />
        <button type="submit" className="btn btn-primary">Προσθήκη</button>
      </form>
      <ul className="list rounded-box bg-base-100 shadow">
        {rhythms.map((r) => (
          <li key={r.id} className="list-row items-center">
            <span>
              {r.name}
              {r.status === 'pending-create' && ' (εκκρεμεί)'}
              {r.status === 'needs-attention-create' && ' (απέτυχε)'}
            </span>
            <button onClick={() => handleDelete(r.id)} className="btn btn-ghost btn-sm text-error">Διαγραφή</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
