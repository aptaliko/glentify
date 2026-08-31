'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { isNativeApp } from '@/lib/platform';
import { preferencesStore } from '@/lib/preferencesStore';
import { setSelectedEditProgramId } from '@/lib/adminEditStore';
import { sharedBadgeText } from '@/lib/programBadge';
import { enqueue, getQueuedActions } from '@/lib/syncQueue';
import type { QueuedAction } from '@/lib/syncQueue';
import { useSyncQueue } from '@/components/SyncQueueProvider';
import { saveProgramsListCache, loadProgramsListCache } from '@/lib/programsListCache';
import type { CachedProgram } from '@/lib/programsListCache';
import { mergeProgramsWithPending, isProgramQueueAction } from '@/lib/programsMerge';

export default function ProgramsAdminPage() {
  const native = isNativeApp();
  const router = useRouter();
  const [programs, setPrograms] = useState<CachedProgram[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [offlinePrograms, setOfflinePrograms] = useState(false);
  const [programsUnavailable, setProgramsUnavailable] = useState(false);
  const [pendingActions, setPendingActions] = useState<QueuedAction[]>([]);
  const { pendingCount, notifyQueueChanged } = useSyncQueue();

  async function load() {
    if (!native) {
      const res = await nativeApiFetch('/api/programs');
      setPrograms(await res.json());
      return;
    }
    try {
      const res = await nativeApiFetch('/api/programs');
      const data: CachedProgram[] = await res.json();
      setPrograms(data);
      setOfflinePrograms(false);
      setProgramsUnavailable(false);
      try {
        await saveProgramsListCache(data);
      } catch {
        // A cache-write failure must not affect the already-successful state above,
        // nor trigger the offline-UI logic below — the fetch just succeeded.
      }
    } catch {
      const cached = await loadProgramsListCache().catch(() => null);
      if (cached) {
        setPrograms(cached);
        setOfflinePrograms(true);
        setProgramsUnavailable(false);
      } else {
        setProgramsUnavailable(true);
      }
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tracks this feature's own count of queued create/rename/delete actions across
  // renders, so we can detect the >0 -> 0 transition (this list's last queued action just
  // synced) and refresh the base list from the server — otherwise a just-synced create
  // leaves no active row in its place, and a just-synced delete could leave a stale row
  // around. There's only one programs list (unlike sub-project #4's per-program cache),
  // so this ref just needs a plain count, no keying by id.
  const prevPendingProgramCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (!native) return;
    getQueuedActions()
      .then((actions) => {
        setPendingActions(actions);
        const thisFeatureCount = actions.filter(isProgramQueueAction).length;
        const prevCount = prevPendingProgramCountRef.current;
        prevPendingProgramCountRef.current = thisFeatureCount;
        if (prevCount !== null && prevCount > 0 && thisFeatureCount === 0) {
          load();
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCount]);

  // Explicit post-enqueue refresh for this page's own three handlers. notifyQueueChanged()
  // drains the queue synchronously when the network is up, which means the pendingCount
  // used by the effect above can go N -> N (e.g. 0 -> 0 for a create with nothing else
  // queued) and never re-fire. Each handler below awaits this directly instead of relying
  // on that effect, which stays in place for the reconnect-later case (queue draining on
  // its own, after this page's handler already returned).
  async function refreshAfterProgramSync() {
    await notifyQueueChanged();
    const actions = await getQueuedActions();
    setPendingActions(actions);
    const n = actions.filter(isProgramQueueAction).length;
    prevPendingProgramCountRef.current = n;
    if (n === 0) await load();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!native) {
      const res = await nativeApiFetch('/api/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        setError('Αποτυχία δημιουργίας προγράμματος');
        return;
      }
      setTitle('');
      await load();
      return;
    }
    try {
      await enqueue('program-create', { title });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    setTitle('');
    await refreshAfterProgramSync();
  }

  async function handleDelete(id: number) {
    setError(null);
    if (!native) {
      await nativeApiFetch(`/api/programs/${id}`, { method: 'DELETE' });
      await load();
      return;
    }
    try {
      await enqueue('program-delete', { programId: id });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    await refreshAfterProgramSync();
  }

  function startEditing(p: { id: number; title: string }) {
    setEditingId(p.id);
    setEditingTitle(p.title);
  }

  async function handleRename(e: React.FormEvent, id: number) {
    e.preventDefault();
    setError(null);
    if (!native) {
      await nativeApiFetch(`/api/programs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editingTitle }),
      });
      setEditingId(null);
      await load();
      return;
    }
    try {
      await enqueue('program-rename', { programId: id, title: editingTitle });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    setEditingId(null);
    await refreshAfterProgramSync();
  }

  async function handleOpenProgram(id: number) {
    await setSelectedEditProgramId(preferencesStore, id);
    router.push('/admin/local/programs/edit');
  }

  const displayPrograms = mergeProgramsWithPending(programs, pendingActions);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Προγράμματα</h1>
      {programsUnavailable && (
        <p className="text-sm text-base-content/50">Άγνωστο χωρίς σύνδεση.</p>
      )}
      {offlinePrograms && (
        <p className="text-sm text-warning">Χωρίς σύνδεση — τελευταία γνωστά δεδομένα.</p>
      )}
      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      {!programsUnavailable && (
        <>
          <form onSubmit={handleCreate} className="flex gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Τίτλος προγράμματος"
              className="input input-bordered flex-1"
              required
            />
            <button type="submit" className="btn btn-primary">Προσθήκη</button>
          </form>
          <ul className="list rounded-box bg-base-100 shadow">
            {displayPrograms.map((p, i) => (
              <li key={p.id ?? `pending-${i}-${p.title}`} className="list-row items-center gap-2">
                {editingId === p.id && p.id !== null ? (
                  <form onSubmit={(e) => handleRename(e, p.id as number)} className="flex flex-1 gap-2">
                    <input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      className="input input-bordered input-sm flex-1"
                      autoFocus
                      required
                    />
                    <button type="submit" className="btn btn-primary btn-sm">Αποθήκευση</button>
                    <button type="button" onClick={() => setEditingId(null)} className="btn btn-ghost btn-sm">Άκυρο</button>
                  </form>
                ) : (
                  <>
                    <div className="flex flex-1 flex-col gap-1">
                      {p.id === null ? (
                        <span className="text-base-content/50">{p.title}</span>
                      ) : native ? (
                        <button onClick={() => handleOpenProgram(p.id as number)} className="link link-hover text-left">{p.title}</button>
                      ) : (
                        <Link href={`/admin/programs/${p.id}`} className="link link-hover">{p.title}</Link>
                      )}
                      {p.sharedWithEmails.length > 0 && (
                        <span className="badge badge-ghost badge-xs w-fit">{sharedBadgeText(p.sharedWithEmails)}</span>
                      )}
                      {p.status === 'pending-create' && (
                        <span className="text-xs text-base-content/50">Θα είναι διαθέσιμο μόλις συγχρονιστεί.</span>
                      )}
                      {p.status === 'needs-attention-create' && (
                        <span className="text-xs text-error">Απέτυχε η δημιουργία.</span>
                      )}
                      {p.status === 'renamed' && (
                        <span className="text-xs text-base-content/50">Θα μετονομαστεί μόλις υπάρξει σύνδεση.</span>
                      )}
                      {p.status === 'needs-attention-rename' && (
                        <span className="text-xs text-error">Απέτυχε η μετονομασία.</span>
                      )}
                    </div>
                    {p.id !== null && (
                      <>
                        <button
                          onClick={() => startEditing({ id: p.id as number, title: p.title })}
                          className="btn btn-ghost btn-sm"
                        >
                          Μετονομασία
                        </button>
                        {p.role === 'creator' && (
                          <button onClick={() => handleDelete(p.id as number)} className="btn btn-ghost btn-sm text-error">
                            Διαγραφή
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
            {displayPrograms.length === 0 && <li className="list-row text-base-content/50">Κανένα πρόγραμμα ακόμη</li>}
          </ul>
        </>
      )}
    </div>
  );
}
