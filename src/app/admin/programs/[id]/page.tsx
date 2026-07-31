'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

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

export default function ProgramAdminPage() {
  const params = useParams<{ id: string }>();
  const [title, setTitle] = useState('');
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [newSeqTitle, setNewSeqTitle] = useState('');
  const [expandedSeqId, setExpandedSeqId] = useState<number | null>(null);
  const [seqSongs, setSeqSongs] = useState<SequenceSongEntry[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);

  async function loadProgram() {
    const res = await fetch(`/api/programs/${params.id}`);
    const data = await res.json();
    setTitle(data.title);
    setSequences(data.sequences);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProgram();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

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

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">{title}</h1>

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
              <div className="flex items-center gap-2">
                <button onClick={() => handleToggleExpand(seq.id)} className="btn btn-ghost btn-sm flex-1 justify-start">
                  {expandedSeqId === seq.id ? '▾' : '▸'} {seq.title}
                </button>
                <button onClick={() => handleDeleteSequence(seq.id)} className="btn btn-ghost btn-sm text-error">Διαγραφή σειράς</button>
              </div>

              {expandedSeqId === seq.id && (
                <div className="flex flex-col gap-3 border-t border-base-300 pt-3">
                  <ul className="flex flex-col gap-1">
                    {seqSongs.map((entry, i) => (
                      <li key={entry.sequenceSongId} className="flex items-center gap-2">
                        <span className="badge badge-neutral badge-sm">{i + 1}</span>
                        <span className="flex-1">{entry.song.title}</span>
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
