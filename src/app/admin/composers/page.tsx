'use client';

import { useEffect, useState } from 'react';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { loadReferenceData } from '@/lib/offlineCache';
import { enqueue, getQueuedActions } from '@/lib/syncQueue';
import { mergeTaxonomyWithPending, type DisplayTaxonomyValue } from '@/lib/taxonomyMerge';
import { mintDraftId } from '@/lib/draftIds';
import { useSyncQueue } from '@/components/SyncQueueProvider';

const ENTITY = 'composers' as const;

export default function ComposersAdminPage() {
  const { pendingCount, notifyQueueChanged } = useSyncQueue();
  const [composers, setComposers] = useState<DisplayTaxonomyValue[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  async function load() {
    const actions = await getQueuedActions();
    try {
      const res = await nativeApiFetch('/api/composers');
      if (!res.ok) throw new Error('bad status');
      const base = await res.json();
      setComposers(mergeTaxonomyWithPending(base, actions, ENTITY));
      setOffline(false);
    } catch {
      const data = await loadReferenceData();
      setComposers(mergeTaxonomyWithPending(data?.composers ?? [], actions, ENTITY));
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
      await enqueue('composers-create', { draftId: mintDraftId(), name, parentId: null });
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
      await enqueue('composers-delete', { id });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    await notifyQueueChanged();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Συνθέτες</h1>
      {offline && <p className="text-sm text-warning">Χωρίς σύνδεση — οι αλλαγές θα συγχρονιστούν αργότερα.</p>}
      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={handleCreate} className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Όνομα συνθέτη" className="input input-bordered flex-1" required />
        <button type="submit" className="btn btn-primary">Προσθήκη</button>
      </form>
      <ul className="list rounded-box bg-base-100 shadow">
        {composers.map((c) => (
          <li key={c.id} className="list-row items-center">
            <span>
              {c.name}
              {c.status === 'pending-create' && ' (εκκρεμεί)'}
              {c.status === 'needs-attention-create' && ' (απέτυχε)'}
            </span>
            <button onClick={() => handleDelete(c.id)} className="btn btn-ghost btn-sm text-error">Διαγραφή</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
