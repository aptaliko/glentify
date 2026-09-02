'use client';

import { useEffect, useState } from 'react';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { loadReferenceData } from '@/lib/offlineCache';
import { enqueue, getQueuedActions } from '@/lib/syncQueue';
import { mergeTaxonomyWithPending, type DisplayTaxonomyValue } from '@/lib/taxonomyMerge';
import { mintDraftId } from '@/lib/draftIds';
import { useSyncQueue } from '@/components/SyncQueueProvider';

const ENTITY = 'dromoi' as const;

export default function DromoiAdminPage() {
  const { pendingCount, notifyQueueChanged } = useSyncQueue();
  const [dromoi, setDromoi] = useState<DisplayTaxonomyValue[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  async function load() {
    const actions = await getQueuedActions();
    try {
      const res = await nativeApiFetch('/api/dromoi');
      if (!res.ok) throw new Error('bad status');
      const base = await res.json();
      setDromoi(mergeTaxonomyWithPending(base, actions, ENTITY));
      setOffline(false);
    } catch {
      const data = await loadReferenceData();
      setDromoi(mergeTaxonomyWithPending(data?.dromoi ?? [], actions, ENTITY));
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
      await enqueue('dromoi-create', { draftId: mintDraftId(), name, parentId: null });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    setName('');
    await notifyQueueChanged();
  }

  async function handleDelete(id: number) {
    setError(null);
    try {
      await enqueue('dromoi-delete', { id });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    await notifyQueueChanged();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Δρόμοι</h1>
      {offline && <p className="text-sm text-warning">Χωρίς σύνδεση — οι αλλαγές θα συγχρονιστούν αργότερα.</p>}
      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={handleCreate} className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Όνομα δρόμου" className="input input-bordered flex-1" required />
        <button type="submit" className="btn btn-primary">Προσθήκη</button>
      </form>
      <ul className="list rounded-box bg-base-100 shadow">
        {dromoi.map((d) => (
          <li key={d.id} className="list-row items-center">
            <span>
              {d.name}
              {d.status === 'pending-create' && ' (εκκρεμεί)'}
              {d.status === 'needs-attention-create' && ' (απέτυχε)'}
            </span>
            <button onClick={() => handleDelete(d.id)} className="btn btn-ghost btn-sm text-error">Διαγραφή</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
