'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { preferencesStore } from '@/lib/preferencesStore';
import { getSelectedEditProgramId, clearSelectedEditProgramId } from '@/lib/adminEditStore';
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

  useEffect(() => {
    getSelectedEditProgramId(preferencesStore)
      .then(setProgramId)
      .finally(() => setChecked(true));
  }, []);

  async function loadProgram(id: number) {
    const res = await nativeApiFetch(`/api/programs/${id}`);
    const data = await res.json();
    setTitle(data.title);
    setSequences(data.sequences);
    setRole(data.role);
  }

  async function loadCollaborators(id: number) {
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
  }

  useEffect(() => {
    if (programId === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProgram(programId);
    loadCollaborators(programId);
  }, [programId]);

  useEffect(() => {
    nativeApiFetch('/api/account').then((r) => r.json()).then(setCurrentUser);
  }, []);

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
    const res = await nativeApiFetch(`/api/programs/${programId}/collaborators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newCollaboratorEmail }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setCollaboratorError(typeof body?.error === 'string' ? body.error : 'Αποτυχία προσθήκης συνεργάτη');
      return;
    }
    setNewCollaboratorEmail('');
    await loadCollaborators(programId);
  }

  async function handleRemoveCollaborator(userId: number) {
    if (programId === null) return;
    setCollaboratorError(null);
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

  return (
    <div className="flex flex-col gap-4">
      <PageNav backHref="/admin/programs" showHome={false} />
      <h1 className="text-xl font-bold">{title}</h1>

      {role && (
        <div className="card border border-base-300 bg-base-100">
          <div className="card-body gap-3 p-4">
            <h2 className="font-semibold">Συνεργάτες</h2>
            {collaboratorError && (
              <div role="alert" className="alert alert-error alert-sm">
                <span>{collaboratorError}</span>
              </div>
            )}
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
              {collaborators.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span className="flex-1">
                    {c.email}
                    {currentUser?.id === c.id && ' (εσύ)'}
                  </span>
                  {role === 'creator' && (
                    <button onClick={() => handleRemoveCollaborator(c.id)} className="btn btn-ghost btn-xs text-error">
                      Αφαίρεση
                    </button>
                  )}
                </li>
              ))}
              {collaborators.length === 0 && !creator && <li className="text-sm text-base-content/50">Κανένας συνεργάτης ακόμη</li>}
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
          </div>
        </div>
      )}

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
    </div>
  );
}
