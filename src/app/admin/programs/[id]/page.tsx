'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

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

export default function ProgramAdminPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
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
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [newCollaboratorEmail, setNewCollaboratorEmail] = useState('');
  const [collaboratorError, setCollaboratorError] = useState<string | null>(null);

  async function loadProgram() {
    const res = await fetch(`/api/programs/${params.id}`);
    const data = await res.json();
    setTitle(data.title);
    setSequences(data.sequences);
    setRole(data.role);
  }

  async function loadCollaborators() {
    const res = await fetch(`/api/programs/${params.id}/collaborators`);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setCollaboratorError(
        typeof body?.error === 'string' ? body.error : 'Αποτυχία φόρτωσης συνεργατών'
      );
      return;
    }
    setCollaborators(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProgram();
    loadCollaborators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    fetch('/api/account').then((r) => r.json()).then(setCurrentUser);
  }, []);

  async function refreshSequenceSongs(seqId: number) {
    const res = await fetch(`/api/programs/${params.id}/sequences/${seqId}`);
    const data = await res.json();
    setSeqSongs(data.songs);
  }

  async function handleAddSequence(e: React.FormEvent) {
    e.preventDefault();
    await fetch(`/api/programs/${params.id}/sequences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newSeqTitle }),
    });
    setNewSeqTitle('');
    await loadProgram();
  }

  async function handleDeleteSequence(seqId: number) {
    await fetch(`/api/programs/${params.id}/sequences/${seqId}`, { method: 'DELETE' });
    if (expandedSeqId === seqId) setExpandedSeqId(null);
    await loadProgram();
  }

  function startEditingSequence(seq: Sequence) {
    setEditingSeqId(seq.id);
    setEditingSeqTitle(seq.title);
  }

  async function handleRenameSequence(e: React.FormEvent, seqId: number) {
    e.preventDefault();
    await fetch(`/api/programs/${params.id}/sequences/${seqId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editingSeqTitle }),
    });
    setEditingSeqId(null);
    await loadProgram();
  }

  async function handleMoveSong(fromIndex: number, direction: -1 | 1) {
    if (expandedSeqId === null) return;
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= seqSongs.length) return;
    const reordered = [...seqSongs];
    [reordered[fromIndex], reordered[toIndex]] = [reordered[toIndex], reordered[fromIndex]];
    setSeqSongs(reordered);
    await fetch(`/api/programs/${params.id}/sequences/${expandedSeqId}/songs`, {
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
    const res = await fetch(`/api/songs?search=${encodeURIComponent(search)}`);
    setSearchResults(await res.json());
  }

  async function handleAddSong(songId: number) {
    if (expandedSeqId === null) return;
    await fetch(`/api/programs/${params.id}/sequences/${expandedSeqId}/songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId }),
    });
    await refreshSequenceSongs(expandedSeqId);
  }

  async function handleRemoveSong(entryId: number) {
    if (expandedSeqId === null) return;
    await fetch(`/api/programs/${params.id}/sequences/${expandedSeqId}/songs/${entryId}`, { method: 'DELETE' });
    await refreshSequenceSongs(expandedSeqId);
  }

  async function handleAddCollaborator(e: React.FormEvent) {
    e.preventDefault();
    setCollaboratorError(null);
    const res = await fetch(`/api/programs/${params.id}/collaborators`, {
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
    await loadCollaborators();
  }

  async function handleRemoveCollaborator(userId: number) {
    setCollaboratorError(null);
    const res = await fetch(`/api/programs/${params.id}/collaborators/${userId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setCollaboratorError(typeof body?.error === 'string' ? body.error : 'Αποτυχία αφαίρεσης συνεργάτη');
      return;
    }
    if (userId === currentUser?.id) {
      // Self-leave: this user no longer has access to this program, so its
      // data (including the collaborators list) is no longer fetchable.
      router.push('/admin/programs');
      return;
    }
    await loadCollaborators();
  }

  return (
    <div className="flex flex-col gap-4">
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
              {collaborators.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span className="flex-1">{c.email}</span>
                  {role === 'creator' && (
                    <button onClick={() => handleRemoveCollaborator(c.id)} className="btn btn-ghost btn-xs text-error">
                      Αφαίρεση
                    </button>
                  )}
                </li>
              ))}
              {collaborators.length === 0 && <li className="text-sm text-base-content/50">Κανένας συνεργάτης ακόμη</li>}
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
