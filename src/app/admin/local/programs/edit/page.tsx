'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { preferencesStore } from '@/lib/preferencesStore';
import { getSelectedEditProgramId, clearSelectedEditProgramId } from '@/lib/adminEditStore';
import { enqueue, getQueuedActions } from '@/lib/syncQueue';
import type { QueuedAction } from '@/lib/syncQueue';
import { useSyncQueue } from '@/components/SyncQueueProvider';
import { saveCollaboratorsCache, loadCollaboratorsCache } from '@/lib/collaboratorsCache';
import { mergeCollaboratorsWithPending } from '@/lib/collaboratorsMerge';
import PageNav from '@/components/PageNav';

interface Sequence {
  id: number;
  title: string;
  position: number;
}

interface Song {
  id: number;
  title: string;
}

interface SequenceSongEntry {
  sequenceSongId: number;
  song: Song;
}

interface CurrentUser {
  id: number;
  email: string;
}

interface Collaborator {
  id: number;
  email: string;
}

export default function LocalEditProgramPage() {
  const router = useRouter();
  const [programId, setProgramId] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [title, setTitle] = useState('');
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [newSeqTitle, setNewSeqTitle] = useState('');
  const [expandedSeqId, setExpandedSeqId] = useState<number | null>(null);
  const [seqSongs, setSeqSongs] = useState<SequenceSongEntry[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [editingSeqId, setEditingSeqId] = useState<number | null>(null);
  const [editingSeqTitle, setEditingSeqTitle] = useState('');
  const [role, setRole] = useState<'creator' | 'collaborator' | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [creator, setCreator] = useState<Collaborator | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [newCollaboratorEmail, setNewCollaboratorEmail] = useState('');
  const [collaboratorError, setCollaboratorError] = useState<string | null>(null);
  const [collaboratorNotice, setCollaboratorNotice] = useState<string | null>(null);
  const [offlineCollaborators, setOfflineCollaborators] = useState(false);
  const [collaboratorsUnavailable, setCollaboratorsUnavailable] = useState(false);
  const [sequencesUnavailableOffline, setSequencesUnavailableOffline] = useState(false);
  const [pendingActions, setPendingActions] = useState<QueuedAction[]>([]);
  const { pendingCount, notifyQueueChanged } = useSyncQueue();

  useEffect(() => {
    getSelectedEditProgramId(preferencesStore)
      .then(setProgramId)
      .finally(() => setChecked(true));
  }, []);

  async function loadProgram(id: number): Promise<{ role: 'creator' | 'collaborator' } | null> {
    try {
      const res = await nativeApiFetch(`/api/programs/${id}`);
      const data = await res.json();
      setTitle(data.title);
      setSequences(data.sequences);
      setRole(data.role);
      setSequencesUnavailableOffline(false);
      return { role: data.role };
    } catch {
      setSequencesUnavailableOffline(true);
      return null;
    }
  }

  async function loadCurrentUser(): Promise<CurrentUser | null> {
    try {
      const res = await nativeApiFetch('/api/account');
      const data = await res.json();
      setCurrentUser(data);
      return data;
    } catch {
      return null;
    }
  }

  async function loadCollaborators(
    id: number,
    roleForCache: 'creator' | 'collaborator' | null,
    userForCache: CurrentUser | null
  ) {
    try {
      const res = await nativeApiFetch(`/api/programs/${id}/collaborators`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setCollaboratorError(
          typeof body?.error === 'string' ? body.error : 'Αποτυχία φόρτωσης συνεργατών'
        );
        return;
      }
      const data = await res.json();
      setCreator(data.creator);
      setCollaborators(data.collaborators);
      setOfflineCollaborators(false);
      setCollaboratorsUnavailable(false);
      if (roleForCache && userForCache) {
        await saveCollaboratorsCache({
          programId: id,
          role: roleForCache,
          creator: data.creator,
          collaborators: data.collaborators,
          currentUser: userForCache,
          cachedAt: new Date().toISOString(),
        });
      }
    } catch {
      const cached = await loadCollaboratorsCache(id);
      if (cached) {
        setRole(cached.role);
        setCreator(cached.creator);
        setCollaborators(cached.collaborators);
        setCurrentUser(cached.currentUser);
        setOfflineCollaborators(true);
        setCollaboratorsUnavailable(false);
      } else {
        setCollaboratorsUnavailable(true);
      }
    }
  }

  useEffect(() => {
    if (programId === null) return;
    (async () => {
      // loadProgram and loadCurrentUser both catch their own network failures and never
      // reject, so Promise.all is correct here (no need for allSettled). Their return
      // values are threaded into loadCollaborators explicitly rather than read back from
      // React state in the same tick, which would see the pre-update, stale value.
      const [programResult, user] = await Promise.all([loadProgram(programId), loadCurrentUser()]);
      await loadCollaborators(programId, programResult?.role ?? null, user);
    })();
  }, [programId]);

  useEffect(() => {
    if (programId === null) return;
    getQueuedActions().then(setPendingActions);
  }, [programId, pendingCount]);

  async function refreshSequenceSongs(seqId: number) {
    if (programId === null) return;
    const res = await nativeApiFetch(`/api/programs/${programId}/sequences/${seqId}`);
    const data = await res.json();
    setSeqSongs(data.songs);
  }

  async function handleAddSequence(e: React.FormEvent) {
    e.preventDefault();
    if (programId === null) return;
    await nativeApiFetch(`/api/programs/${programId}/sequences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newSeqTitle }),
    });
    setNewSeqTitle('');
    await loadProgram(programId);
  }

  async function handleDeleteSequence(seqId: number) {
    if (programId === null) return;
    await nativeApiFetch(`/api/programs/${programId}/sequences/${seqId}`, { method: 'DELETE' });
    if (expandedSeqId === seqId) setExpandedSeqId(null);
    await loadProgram(programId);
  }

  function startEditingSequence(seq: Sequence) {
    setEditingSeqId(seq.id);
    setEditingSeqTitle(seq.title);
  }

  async function handleRenameSequence(e: React.FormEvent, seqId: number) {
    e.preventDefault();
    if (programId === null) return;
    await nativeApiFetch(`/api/programs/${programId}/sequences/${seqId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editingSeqTitle }),
    });
    setEditingSeqId(null);
    await loadProgram(programId);
  }

  async function handleMoveSong(fromIndex: number, direction: -1 | 1) {
    if (expandedSeqId === null || programId === null) return;
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= seqSongs.length) return;
    const reordered = [...seqSongs];
    [reordered[fromIndex], reordered[toIndex]] = [reordered[toIndex], reordered[fromIndex]];
    setSeqSongs(reordered);
    await nativeApiFetch(`/api/programs/${programId}/sequences/${expandedSeqId}/songs`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: reordered.map((entry) => entry.sequenceSongId) }),
    });
  }

  async function handleToggleExpand(seqId: number) {
    if (expandedSeqId === seqId) {
      setExpandedSeqId(null);
      return;
    }
    setExpandedSeqId(seqId);
    setSearch('');
    setSearchResults([]);
    await refreshSequenceSongs(seqId);
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const res = await nativeApiFetch(`/api/songs?search=${encodeURIComponent(search)}`);
    setSearchResults(await res.json());
  }

  async function handleAddSong(songId: number) {
    if (expandedSeqId === null || programId === null) return;
    await nativeApiFetch(`/api/programs/${programId}/sequences/${expandedSeqId}/songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId }),
    });
    await refreshSequenceSongs(expandedSeqId);
  }

  async function handleRemoveSong(entryId: number) {
    if (expandedSeqId === null || programId === null) return;
    await nativeApiFetch(`/api/programs/${programId}/sequences/${expandedSeqId}/songs/${entryId}`, { method: 'DELETE' });
    await refreshSequenceSongs(expandedSeqId);
  }

  async function handleAddCollaborator(e: React.FormEvent) {
    e.preventDefault();
    if (programId === null) return;
    setCollaboratorError(null);
    setCollaboratorNotice(null);
    const email = newCollaboratorEmail;
    try {
      const res = await nativeApiFetch(`/api/programs/${programId}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setCollaboratorError(typeof body?.error === 'string' ? body.error : 'Αποτυχία προσθήκης συνεργάτη');
        return;
      }
      setNewCollaboratorEmail('');
      await loadCollaborators(programId, role, currentUser);
    } catch {
      await enqueue('program-add-collaborator', { programId, email });
      setNewCollaboratorEmail('');
      setCollaboratorNotice('Θα προστεθεί μόλις υπάρξει σύνδεση.');
      notifyQueueChanged();
    }
  }

  async function handleRemoveCollaborator(userId: number) {
    if (programId === null) return;
    setCollaboratorError(null);
    setCollaboratorNotice(null);
    try {
      const res = await nativeApiFetch(`/api/programs/${programId}/collaborators/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setCollaboratorError(typeof body?.error === 'string' ? body.error : 'Αποτυχία αφαίρεσης συνεργάτη');
        return;
      }
      if (userId === currentUser?.id) {
        await clearSelectedEditProgramId(preferencesStore);
        router.push('/admin/programs');
        return;
      }
      await loadCollaborators(programId, role, currentUser);
    } catch {
      await enqueue('program-remove-collaborator', { programId, userId });
      notifyQueueChanged();
      if (userId === currentUser?.id) {
        await clearSelectedEditProgramId(preferencesStore);
        router.push('/admin/programs');
        return;
      }
      setCollaboratorNotice('Θα αφαιρεθεί μόλις υπάρξει σύνδεση.');
    }
  }

  if (!checked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <PageNav backHref="/admin/programs" showHome={false} />
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  if (programId === null) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <PageNav backHref="/admin/programs" showHome={false} />
        <p className="text-lg">Δεν έχει επιλεγεί πρόγραμμα.</p>
      </div>
    );
  }

  const displayCollaborators =
    programId !== null ? mergeCollaboratorsWithPending(collaborators, pendingActions, programId) : [];

  return (
    <div className="flex flex-col gap-4">
      <PageNav backHref="/admin/programs" showHome={false} />
      <h1 className="text-xl font-bold">{title}</h1>

      {(role !== null || collaboratorsUnavailable) && (
        <div className="card border border-base-300 bg-base-100">
          <div className="card-body gap-3 p-4">
            <h2 className="font-semibold">Συνεργάτες</h2>
            {collaboratorsUnavailable && (
              <p className="text-sm text-base-content/50">Άγνωστο χωρίς σύνδεση.</p>
            )}
            {offlineCollaborators && (
              <p className="text-sm text-warning">Χωρίς σύνδεση — τελευταία γνωστά δεδομένα.</p>
            )}
            {collaboratorError && (
              <div role="alert" className="alert alert-error alert-sm">
                <span>{collaboratorError}</span>
              </div>
            )}
            {collaboratorNotice && (
              <div role="status" className="alert alert-info alert-sm">
                <span>{collaboratorNotice}</span>
              </div>
            )}
            {!collaboratorsUnavailable && (
              <>
                <ul className="flex flex-col gap-1">
                  {creator && (
                    <li className="flex items-center gap-2">
                      <span className="flex-1">
                        {creator.email}
                        {currentUser?.id === creator.id && ' (εσύ)'}
                        {' — δημιουργός'}
                      </span>
                    </li>
                  )}
                  {displayCollaborators.map((c, i) => (
                    <li key={c.id ?? `pending-${i}-${c.email}`} className="flex items-center gap-2">
                      <span className="flex-1">
                        {c.email}
                        {currentUser?.id === c.id && ' (εσύ)'}
                        {c.status === 'pending-add' && ' (εκκρεμεί)'}
                        {c.status === 'needs-attention-add' && ' (απέτυχε η προσθήκη)'}
                        {c.status === 'needs-attention-remove' && ' (απέτυχε η αφαίρεση)'}
                      </span>
                      {role === 'creator' && c.id !== null && (
                        <button
                          onClick={() => handleRemoveCollaborator(c.id as number)}
                          className="btn btn-ghost btn-xs text-error"
                        >
                          Αφαίρεση
                        </button>
                      )}
                    </li>
                  ))}
                  {displayCollaborators.length === 0 && !creator && (
                    <li className="text-sm text-base-content/50">Κανένας συνεργάτης ακόμη</li>
                  )}
                </ul>
                {role === 'creator' && (
                  <form onSubmit={handleAddCollaborator} className="flex gap-2">
                    <input
                      type="email"
                      value={newCollaboratorEmail}
                      onChange={(e) => setNewCollaboratorEmail(e.target.value)}
                      placeholder="Email συνεργάτη"
                      className="input input-bordered input-sm flex-1"
                      required
                    />
                    <button type="submit" className="btn btn-primary btn-sm">Προσθήκη</button>
                  </form>
                )}
                {role === 'collaborator' && currentUser && (
                  <button
                    onClick={() => handleRemoveCollaborator(currentUser.id)}
                    className="btn btn-outline btn-error btn-sm self-start"
                  >
                    Αποχώρηση από το πρόγραμμα
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {sequencesUnavailableOffline ? (
        <p className="text-sm text-base-content/50">
          Η επεξεργασία σειρών δεν είναι διαθέσιμη χωρίς σύνδεση.
        </p>
      ) : (
        <>
          <form onSubmit={handleAddSequence} className="flex gap-2">
            <input
              value={newSeqTitle}
              onChange={(e) => setNewSeqTitle(e.target.value)}
              placeholder="Τίτλος νέας σειράς"
              className="input input-bordered flex-1"
              required
            />
            <button type="submit" className="btn btn-primary">Προσθήκη σειράς</button>
          </form>

          <ul className="flex flex-col gap-3">
            {sequences.map((seq) => (
              <li key={seq.id} className="card border border-base-300 bg-base-100">
                <div className="card-body gap-3 p-4">
                  {editingSeqId === seq.id ? (
                    <form onSubmit={(e) => handleRenameSequence(e, seq.id)} className="flex items-center gap-2">
                      <input
                        value={editingSeqTitle}
                        onChange={(e) => setEditingSeqTitle(e.target.value)}
                        className="input input-bordered input-sm flex-1"
                        autoFocus
                        required
                      />
                      <button type="submit" className="btn btn-primary btn-sm">Αποθήκευση</button>
                      <button type="button" onClick={() => setEditingSeqId(null)} className="btn btn-ghost btn-sm">Άκυρο</button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleToggleExpand(seq.id)} className="btn btn-ghost btn-sm flex-1 justify-start">
                        {expandedSeqId === seq.id ? '▾' : '▸'} {seq.title}
                      </button>
                      <button onClick={() => startEditingSequence(seq)} className="btn btn-ghost btn-sm">Μετονομασία</button>
                      <button onClick={() => handleDeleteSequence(seq.id)} className="btn btn-ghost btn-sm text-error">Διαγραφή σειράς</button>
                    </div>
                  )}

                  {expandedSeqId === seq.id && (
                    <div className="flex flex-col gap-3 border-t border-base-300 pt-3">
                      <ul className="flex flex-col gap-1">
                        {seqSongs.map((entry, i) => (
                          <li key={entry.sequenceSongId} className="flex items-center gap-2">
                            <span className="badge badge-neutral badge-sm">{i + 1}</span>
                            <span className="flex-1">{entry.song.title}</span>
                            <button onClick={() => handleMoveSong(i, -1)} disabled={i === 0} className="btn btn-ghost btn-xs">↑</button>
                            <button onClick={() => handleMoveSong(i, 1)} disabled={i === seqSongs.length - 1} className="btn btn-ghost btn-xs">↓</button>
                            <button onClick={() => handleRemoveSong(entry.sequenceSongId)} className="btn btn-ghost btn-xs text-error">Αφαίρεση</button>
                          </li>
                        ))}
                        {seqSongs.length === 0 && <li className="text-sm text-base-content/50">Κανένα τραγούδι ακόμη</li>}
                      </ul>

                      <form onSubmit={handleSearch} className="flex gap-2">
                        <input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Αναζήτηση τραγουδιού για προσθήκη"
                          className="input input-bordered input-sm flex-1"
                        />
                        <button type="submit" className="btn btn-sm">Αναζήτηση</button>
                      </form>
                      {searchResults.length > 0 && (
                        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                          {searchResults.map((s) => (
                            <li key={s.id} className="flex items-center gap-2">
                              <span className="flex-1">{s.title}</span>
                              <button onClick={() => handleAddSong(s.id)} className="btn btn-primary btn-xs">+ Προσθήκη</button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
            {sequences.length === 0 && <li className="text-sm text-base-content/50">Καμία σειρά ακόμη</li>}
          </ul>
        </>
      )}
    </div>
  );
}
