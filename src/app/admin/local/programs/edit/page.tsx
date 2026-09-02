'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { preferencesStore } from '@/lib/preferencesStore';
import { getSelectedEditProgramId, clearSelectedEditProgramId } from '@/lib/adminEditStore';
import { enqueue, getQueuedActions } from '@/lib/syncQueue';
import type { QueuedAction } from '@/lib/syncQueue';
import { useSyncQueue } from '@/components/SyncQueueProvider';
import { mergeCollaboratorsWithPending, isCollaboratorQueueActionForProgram } from '@/lib/collaboratorsMerge';
import { mergeSequencesWithPending, type DisplaySequence } from '@/lib/sequencesMerge';
import { mintDraftId } from '@/lib/draftIds';
import { loadReferenceData } from '@/lib/offlineCache';
import { toProgramDetail, toCollaboratorsView, buildSongTitleMap } from '@/lib/offlineProgramView';
import type { CachedProgramDetail, CachedSequenceSong } from '@/lib/referenceData';
import PageNav from '@/components/PageNav';

interface Song {
  id: number;
  title: string;
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
  const [displaySequences, setDisplaySequences] = useState<DisplaySequence[]>([]);
  const [songTitles, setSongTitles] = useState<Map<number, string>>(new Map());
  const [newSeqTitle, setNewSeqTitle] = useState('');
  const [expandedSeqId, setExpandedSeqId] = useState<number | null>(null);
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

  // The pre-overlay base CachedProgramDetail that the most recent loadSequences() call
  // built (fresh from the server when online, from the blob slice when offline) — kept so
  // handleToggleExpand can re-run mergeSequencesWithPending against a base that's at least
  // as fresh as what's on screen, instead of re-reading the (possibly stale) blob.
  const baseSequenceDetailRef = useRef<CachedProgramDetail | null>(null);

  // Online: fetches the program + every sequence's songs and overlays any still-pending
  // queue actions on top before rendering. Offline: falls back to the reference-data blob
  // (also overlaid). Returns the program's role either way so the mount effect can thread
  // it into loadCollaborators without reading back React state in the same tick (which
  // would see the stale pre-update value).
  async function loadSequences(id: number): Promise<'creator' | 'collaborator' | null> {
    const [actions, cached] = await Promise.all([getQueuedActions(), loadReferenceData().catch(() => null)]);
    const titles = buildSongTitleMap(cached?.songs ?? [], cached?.sharedSongs ?? []);
    setSongTitles(titles);
    try {
      const res = await nativeApiFetch(`/api/programs/${id}`);
      if (!res.ok) throw new Error('bad status');
      const data = await res.json();
      setTitle(data.title);
      setRole(data.role);
      const sequences = await Promise.all(
        (data.sequences as { id: number; title: string; position: number }[]).map(async (seq) => {
          const sres = await nativeApiFetch(`/api/programs/${id}/sequences/${seq.id}`);
          if (!sres.ok) throw new Error('bad status');
          const sdata = await sres.json();
          const rawSongs = Array.isArray(sdata.songs)
            ? (sdata.songs as { sequenceSongId: number; song: { id: number; title: string } }[])
            : [];
          const songs: CachedSequenceSong[] = rawSongs.map((e) => ({
            sequenceSongId: e.sequenceSongId,
            songId: e.song.id,
            title: e.song.title,
          }));
          return { id: seq.id, title: seq.title, position: seq.position, songs };
        })
      );
      const detail: CachedProgramDetail = { programId: id, title: data.title, role: data.role, sequences, cachedAt: '' };
      baseSequenceDetailRef.current = detail;
      setSequencesUnavailableOffline(false);
      setDisplaySequences(mergeSequencesWithPending(detail, actions, titles));
      return data.role;
    } catch {
      const program = cached?.programs.find((p) => p.id === id) ?? null;
      if (program && cached && cached.primedAt !== null) {
        const detail = toProgramDetail(program, titles);
        baseSequenceDetailRef.current = detail;
        setTitle(detail.title);
        setRole(detail.role);
        setSequencesUnavailableOffline(false);
        setDisplaySequences(mergeSequencesWithPending(detail, actions, titles));
        return detail.role;
      }
      baseSequenceDetailRef.current = null;
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

  async function loadCollaborators(id: number) {
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
    } catch {
      const cached = await loadReferenceData().catch(() => null);
      const program = cached?.programs.find((p) => p.id === id) ?? null;
      if (program && cached && cached.primedAt !== null) {
        const view = toCollaboratorsView(program, cached.currentUser);
        setRole(view.role);
        setCreator(view.creator);
        setCollaborators(view.collaborators);
        if (view.currentUser) setCurrentUser(view.currentUser);
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
      // loadSequences and loadCurrentUser both catch their own network failures and never
      // reject, so Promise.all is correct here (no need for allSettled).
      await Promise.all([loadSequences(programId), loadCurrentUser()]);
      await loadCollaborators(programId);
    })();
  }, [programId]);

  // Tracks this program's own count of queued add/remove-collaborator actions across
  // renders, so we can detect the >0 -> 0 transition (this program's last queued action
  // just synced) and refresh the base list from the server — otherwise a just-synced add
  // leaves no active row in its place, and a just-synced remove leaves the removed person
  // showing as an active row with a live (404-bound) remove button. Keyed by programId so
  // switching programs doesn't spuriously read the previous program's last-known count.
  const prevPendingCollaboratorInfoRef = useRef<{ programId: number; count: number } | null>(null);

  useEffect(() => {
    if (programId === null) return;
    getQueuedActions()
      .then((actions) => {
        setPendingActions(actions);
        const thisProgramCount = actions.filter((a) =>
          isCollaboratorQueueActionForProgram(a, programId)
        ).length;
        const prevInfo = prevPendingCollaboratorInfoRef.current;
        const prevCount = prevInfo && prevInfo.programId === programId ? prevInfo.count : null;
        prevPendingCollaboratorInfoRef.current = { programId, count: thisProgramCount };
        if (prevCount !== null && prevCount > 0 && thisProgramCount === 0) {
          loadCollaborators(programId);
        }
      })
      .catch(() => {});
  }, [programId, pendingCount, role, currentUser]);

  // Re-runs the sequences overlay whenever the queue's pendingCount actually changes for
  // this program (e.g. a background sync completing after network restore), but not on
  // the initial mount — the [programId] effect above already performs that first load.
  const prevPendingSeqCountRef = useRef<{ programId: number; count: number } | null>(null);

  useEffect(() => {
    if (programId === null) return;
    const prevInfo = prevPendingSeqCountRef.current;
    const isSameProgram = prevInfo !== null && prevInfo.programId === programId;
    const prevCount = isSameProgram ? prevInfo.count : null;
    prevPendingSeqCountRef.current = { programId, count: pendingCount };
    if (prevCount !== null && prevCount !== pendingCount) {
      loadSequences(programId);
    }
  }, [programId, pendingCount]);

  async function handleAddSequence(e: React.FormEvent) {
    e.preventDefault();
    if (programId === null) return;
    await enqueue('sequence-create', { draftId: mintDraftId(), programId, title: newSeqTitle });
    setNewSeqTitle('');
    await notifyQueueChanged();
    await loadSequences(programId);
  }

  async function handleDeleteSequence(seqId: number) {
    if (programId === null) return;
    await enqueue('sequence-delete', { programId, sequenceId: seqId });
    if (expandedSeqId === seqId) setExpandedSeqId(null);
    await notifyQueueChanged();
    await loadSequences(programId);
  }

  function startEditingSequence(seq: DisplaySequence) {
    setEditingSeqId(seq.id);
    setEditingSeqTitle(seq.title);
  }

  async function handleRenameSequence(e: React.FormEvent, seqId: number) {
    e.preventDefault();
    if (programId === null) return;
    await enqueue('sequence-rename', { programId, sequenceId: seqId, title: editingSeqTitle });
    setEditingSeqId(null);
    await notifyQueueChanged();
    await loadSequences(programId);
  }

  async function handleMoveSong(fromIndex: number, direction: -1 | 1) {
    if (expandedSeqId === null || programId === null) return;
    const current = displaySequences.find((s) => s.id === expandedSeqId)?.songs ?? [];
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= current.length) return;
    const reordered = [...current];
    [reordered[fromIndex], reordered[toIndex]] = [reordered[toIndex], reordered[fromIndex]];
    await enqueue('sequence-reorder', {
      programId,
      sequenceId: expandedSeqId,
      orderedIds: reordered.map((entry) => entry.sequenceSongId),
    });
    await notifyQueueChanged();
    await loadSequences(programId);
  }

  async function handleToggleExpand(seqId: number) {
    if (expandedSeqId === seqId) {
      setExpandedSeqId(null);
      return;
    }
    setExpandedSeqId(seqId);
    setSearch('');
    setSearchResults([]);
    if (programId === null) return;
    // Best-effort online refresh of this sequence's songs into React state; offline this
    // throws and we keep the already-merged cached/overlaid songs.
    try {
      const res = await nativeApiFetch(`/api/programs/${programId}/sequences/${seqId}`);
      if (!res.ok) throw new Error('bad status');
      const data = await res.json();
      const rawSongs = Array.isArray(data.songs)
        ? (data.songs as { sequenceSongId: number; song: { id: number; title: string } }[])
        : [];
      const freshSongs: CachedSequenceSong[] = rawSongs.map((e) => ({
        sequenceSongId: e.sequenceSongId,
        songId: e.song.id,
        title: e.song.title,
      }));
      const base = baseSequenceDetailRef.current;
      if (base && base.programId === programId) {
        // Overlay the just-fetched songs onto the server-fresh base that loadSequences
        // last built — never the (possibly stale) blob — then re-apply the pending-queue
        // overlay via mergeSequencesWithPending so a draft add/remove for this sequence
        // isn't lost.
        const withFresh: CachedProgramDetail = {
          ...base,
          sequences: base.sequences.map((s) => (s.id === seqId ? { ...s, songs: freshSongs } : s)),
        };
        baseSequenceDetailRef.current = withFresh; // keep base current so a later expand compounds correctly
        const actions = await getQueuedActions();
        setDisplaySequences(mergeSequencesWithPending(withFresh, actions, songTitles));
      }
    } catch {
      // offline — displaySequences already holds the cached+overlaid songs
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await nativeApiFetch(`/api/songs?search=${encodeURIComponent(search)}`);
      setSearchResults(await res.json());
    } catch {
      const cached = await loadReferenceData().catch(() => null);
      const q = search.toLowerCase();
      setSearchResults(
        (cached?.songs ?? []).filter((s) => s.title.toLowerCase().includes(q)).map((s) => ({ id: s.id, title: s.title }))
      );
    }
  }

  async function handleAddSong(songId: number) {
    if (expandedSeqId === null || programId === null) return;
    await enqueue('sequence-add-song', { draftId: mintDraftId(), programId, sequenceId: expandedSeqId, songId });
    setSearch('');
    setSearchResults([]);
    await notifyQueueChanged();
    await loadSequences(programId);
  }

  async function handleRemoveSong(entryId: number) {
    if (expandedSeqId === null || programId === null) return;
    await enqueue('sequence-remove-song', { programId, sequenceId: expandedSeqId, sequenceSongId: entryId });
    await notifyQueueChanged();
    await loadSequences(programId);
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
      await loadCollaborators(programId);
    } catch {
      try {
        await enqueue('program-add-collaborator', { programId, email });
      } catch {
        setCollaboratorError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
        return;
      }
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
      await loadCollaborators(programId);
    } catch {
      try {
        await enqueue('program-remove-collaborator', { programId, userId });
      } catch {
        setCollaboratorError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
        return;
      }
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
  const expandedSongs = displaySequences.find((s) => s.id === expandedSeqId)?.songs ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageNav backHref="/admin/programs" showHome={false} />
      <h1 className="text-xl font-bold">{title}</h1>

      {(role !== null || collaboratorsUnavailable) && (
        <div className="card border border-base-300 bg-base-100">
          <div className="card-body gap-3 p-4">
            <h2 className="font-semibold">Συνεργάτες</h2>
            {collaboratorsUnavailable && (
              <p className="text-sm text-base-content/50">
                Άγνωστο χωρίς σύνδεση.{' '}
                <Link href="/" className="link">Προετοιμασία για offline</Link>
              </p>
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
          Η επεξεργασία σειρών δεν είναι διαθέσιμη χωρίς σύνδεση.{' '}
          <Link href="/" className="link">Προετοιμασία για offline</Link>
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
            {displaySequences.map((seq) => {
              const isPending = seq.status === 'pending-create';
              return (
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
                        {isPending ? (
                          <span className="flex-1">{seq.title} (εκκρεμεί)</span>
                        ) : (
                          <button onClick={() => handleToggleExpand(seq.id)} className="btn btn-ghost btn-sm flex-1 justify-start">
                            {expandedSeqId === seq.id ? '▾' : '▸'} {seq.title}
                          </button>
                        )}
                        {!isPending && (
                          <button onClick={() => startEditingSequence(seq)} className="btn btn-ghost btn-sm">Μετονομασία</button>
                        )}
                        <button onClick={() => handleDeleteSequence(seq.id)} className="btn btn-ghost btn-sm text-error">Διαγραφή σειράς</button>
                      </div>
                    )}

                    {!isPending && expandedSeqId === seq.id && (
                      <div className="flex flex-col gap-3 border-t border-base-300 pt-3">
                        <ul className="flex flex-col gap-1">
                          {expandedSongs.map((entry, i) => (
                            <li key={entry.sequenceSongId} className="flex items-center gap-2">
                              <span className="badge badge-neutral badge-sm">{i + 1}</span>
                              <span className="flex-1">{entry.title}</span>
                              <button onClick={() => handleMoveSong(i, -1)} disabled={i === 0} className="btn btn-ghost btn-xs">↑</button>
                              <button onClick={() => handleMoveSong(i, 1)} disabled={i === expandedSongs.length - 1} className="btn btn-ghost btn-xs">↓</button>
                              <button onClick={() => handleRemoveSong(entry.sequenceSongId)} className="btn btn-ghost btn-xs text-error">Αφαίρεση</button>
                            </li>
                          ))}
                          {expandedSongs.length === 0 && <li className="text-sm text-base-content/50">Κανένα τραγούδι ακόμη</li>}
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
              );
            })}
            {displaySequences.length === 0 && <li className="text-sm text-base-content/50">Καμία σειρά ακόμη</li>}
          </ul>
        </>
      )}
    </div>
  );
}
