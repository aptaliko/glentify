'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { upload } from '@vercel/blob/client';
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
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingGenre, setCreatingGenre] = useState(false);
  const [newGenreName, setNewGenreName] = useState('');

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/songs/image-upload' });
      setImageUrl(blob.url);
    } catch {
      setError('Αποτυχία μεταφόρτωσης εικόνας');
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    fetch('/api/genres').then((r) => r.json()).then(setGenres);
  }, []);

  interface SuggestionSong {
    id: number;
    title: string;
    lyrics: string | null;
    notes: string | null;
    genreId: number | null; // null when the suggested song's genre isn't visible to this user
    maleKey: string | null;
    femaleKey: string | null;
    axisValues: AxisValueEntry[];
  }

  const [suggestions, setSuggestions] = useState<SuggestionSong[]>([]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (title.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      fetch(`/api/songs/suggestions?title=${encodeURIComponent(title.trim())}`)
        .then((r) => r.json())
        .then(setSuggestions);
    }, 300);
    return () => clearTimeout(timeout);
  }, [title]);

  function applySuggestion(s: SuggestionSong) {
    setLyrics(s.lyrics ?? '');
    setNotes(s.notes ?? '');
    if (s.genreId !== null) setGenreId(String(s.genreId));
    setMaleKey(s.maleKey ?? '');
    setFemaleKey(s.femaleKey ?? '');
    setAxisValues(s.axisValues);
    setSuggestions([]);
  }

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
        imageUrl,
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
        {suggestions.length > 0 && (
          <div className="flex flex-col gap-2 rounded-box border border-base-300 bg-base-200 p-3">
            <p className="text-sm font-semibold">Βρέθηκαν παρόμοια τραγούδια — χρησιμοποίησε ένα ως βάση:</p>
            {suggestions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2">
                <span>{s.title}</span>
                <button type="button" onClick={() => applySuggestion(s)} className="btn btn-sm btn-outline">
                  Χρησιμοποίησε ως βάση
                </button>
              </div>
            ))}
          </div>
        )}
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
        <div className="flex flex-col gap-2">
          <label className="label-text">Εικόνα παρτιτούρας (προαιρετικό, εναλλακτικά ή μαζί με τους στίχους)</label>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageChange} className="file-input file-input-bordered" />
          {uploading && <span className="loading loading-spinner loading-sm" />}
          {imageUrl && <img src={imageUrl} alt="Προεπισκόπηση παρτιτούρας" className="max-h-64 rounded-box object-contain" />}
        </div>
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
