'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import SongAxisEditor, { type AxisValueEntry } from '@/components/SongAxisEditor';

interface Option {
  id: number;
  name: string;
}

export default function NewSongPage() {
  const router = useRouter();
  const [genres, setGenres] = useState<Option[]>([]);
  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [genreId, setGenreId] = useState('');
  const [notes, setNotes] = useState('');
  const [maleKey, setMaleKey] = useState('');
  const [femaleKey, setFemaleKey] = useState('');
  const [axisValues, setAxisValues] = useState<AxisValueEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creatingGenre, setCreatingGenre] = useState(false);
  const [newGenreName, setNewGenreName] = useState('');

  useEffect(() => {
    fetch('/api/genres').then((r) => r.json()).then(setGenres);
  }, []);

  async function handleCreateGenre() {
    if (!newGenreName.trim()) return;
    const res = await fetch('/api/genres', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newGenreName.trim() }),
    });
    if (!res.ok) return;
    const created: Option = await res.json();
    setGenres((prev) => [...prev, created]);
    setGenreId(String(created.id));
    setCreatingGenre(false);
    setNewGenreName('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/songs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        lyrics: lyrics || null,
        genreId: Number(genreId),
        notes: notes || null,
        maleKey: maleKey || null,
        femaleKey: femaleKey || null,
        axisValues,
      }),
    });
    if (!res.ok) {
      setError('Αποτυχία δημιουργίας τραγουδιού');
      return;
    }
    router.push('/admin/songs');
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Νέο τραγούδι</h1>
      {error && (
        <div role="alert" className="alert alert-error max-w-2xl">
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Τίτλος" className="input input-bordered" required />
        <textarea
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder="Στίχοι (προαιρετικό, μπορούν να προστεθούν αργότερα)"
          className="textarea textarea-bordered h-48"
        />
        <select
          value={creatingGenre ? '__new__' : genreId}
          onChange={(e) => {
            if (e.target.value === '__new__') {
              setCreatingGenre(true);
            } else {
              setCreatingGenre(false);
              setGenreId(e.target.value);
            }
          }}
          className="select select-bordered"
          required
        >
          <option value="">Είδος...</option>
          {genres.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          <option value="__new__">+ Νέο είδος...</option>
        </select>
        {creatingGenre && (
          <div className="flex gap-2">
            <input
              type="text"
              value={newGenreName}
              onChange={(e) => setNewGenreName(e.target.value)}
              placeholder="Όνομα νέου είδους"
              className="input input-bordered flex-1"
            />
            <button type="button" onClick={handleCreateGenre} className="btn btn-secondary">Δημιουργία</button>
          </div>
        )}
        <SongAxisEditor value={axisValues} onChange={setAxisValues} />
        <div className="flex gap-3">
          <input value={maleKey} onChange={(e) => setMaleKey(e.target.value)} placeholder="Τόνος (άντρας)" className="input input-bordered flex-1" />
          <input value={femaleKey} onChange={(e) => setFemaleKey(e.target.value)} placeholder="Τόνος (γυναίκα)" className="input input-bordered flex-1" />
        </div>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Σημειώσεις (προαιρετικό)" className="input input-bordered" />
        <button type="submit" className="btn btn-primary">Αποθήκευση</button>
      </form>
    </div>
  );
}
