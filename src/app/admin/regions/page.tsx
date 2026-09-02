'use client';

import { useEffect, useState } from 'react';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { loadReferenceData } from '@/lib/offlineCache';
import { enqueue, getQueuedActions } from '@/lib/syncQueue';
import { mergeTaxonomyWithPending, type DisplayTaxonomyValue } from '@/lib/taxonomyMerge';
import { mintDraftId } from '@/lib/draftIds';
import { useSyncQueue } from '@/components/SyncQueueProvider';

const ENTITY = 'regions' as const;

export default function RegionsAdminPage() {
  const { pendingCount, notifyQueueChanged } = useSyncQueue();
  const [regions, setRegions] = useState<DisplayTaxonomyValue[]>([]);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  async function load() {
    const actions = await getQueuedActions();
    try {
      const res = await nativeApiFetch('/api/regions');
      if (!res.ok) throw new Error('bad status');
      const base = await res.json();
      setRegions(mergeTaxonomyWithPending(base, actions, ENTITY));
      setOffline(false);
    } catch {
      const data = await loadReferenceData();
      setRegions(mergeTaxonomyWithPending(data?.regions ?? [], actions, ENTITY));
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
      await enqueue('regions-create', {
        draftId: mintDraftId(),
        name,
        parentId: parentId ? Number(parentId) : null,
      });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    setName('');
    setParentId('');
    await notifyQueueChanged();
  }

  async function handleDelete(id: number) {
    setError(null);
    try {
      await enqueue('regions-delete', { id });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    await notifyQueueChanged();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Περιοχές</h1>
      {offline && <p className="text-sm text-warning">Χωρίς σύνδεση — οι αλλαγές θα συγχρονιστούν αργότερα.</p>}
      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={handleCreate} className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Όνομα περιοχής" className="input input-bordered flex-1" required />
        <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="select select-bordered">
          <option value="">Χωρίς γονική περιοχή</option>
          {regions.filter((r) => r.id >= 0).map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary">Προσθήκη</button>
      </form>
      <ul className="list rounded-box bg-base-100 shadow">
        {regions.map((r) => (
          <li key={r.id} className="list-row items-center">
            <span>
              {r.name}
              {r.parentId ? ` (γονική: ${regions.find((p) => p.id === r.parentId)?.name ?? '?'})` : ''}
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
