'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { upload } from '@vercel/blob/client';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { apiUrl } from '@/lib/apiClient';
import { getAuthToken } from '@/lib/authToken';
import { preferencesStore } from '@/lib/preferencesStore';
import { getSelectedEditSongId } from '@/lib/adminEditStore';
import SongAxisEditor, { type AxisValueEntry } from '@/components/SongAxisEditor';

interface Option {
  id: number;
  name: string;
}

export default function LocalEditSongPage() {
  const router = useRouter();
  const [songId, setSongId] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
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

  useEffect(() => {
    getSelectedEditSongId(preferencesStore)
      .then(setSongId)
      .finally(() => setChecked(true));
  }, []);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: apiUrl('/api/songs/image-upload'),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      setImageUrl(blob.url);
    } catch {
      setError('Αποτυχία μεταφόρτωσης εικόνας');
    } finally {
      setUploading(false);
    }
  }

  async function handleCreateGenre() {
    if (!newGenreName.trim()) return;
    const res = await nativeApiFetch('/api/genres', {
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

  useEffect(() => {
    if (songId === null) return;
    nativeApiFetch('/api/genres').then((r) => r.json()).then(setGenres);
    nativeApiFetch(`/api/songs/${songId}`).then((r) => r.json()).then((song) => {
      setTitle(song.title);
      setLyrics(song.lyrics ?? '');
      setGenreId(String(song.genreId));
      setNotes(song.notes ?? '');
      setMaleKey(song.maleKey ?? '');
      setFemaleKey(song.femaleKey ?? '');
      setImageUrl(song.imageUrl ?? null);
      setAxisValues(
        song.axisValues.map((v: { axisType: string; refId: number | null; yearValue: number | null }) => ({
          axisType: v.axisType,
          refId: v.refId,
          yearValue: v.yearValue,
        }))
      );
    });
  }, [songId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (songId === null) return;
    setError(null);
    const res = await nativeApiFetch(`/api/songs/${songId}`, {
      method: 'PATCH',
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
      setError('Αποτυχία ενημέρωσης τραγουδιού');
      return;
    }
    router.push('/admin/songs');
  }

  async function handleDelete() {
    if (songId === null) return;
    setError(null);
    const res = await nativeApiFetch(`/api/songs/${songId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error);
      return;
    }
    router.push('/admin/songs');
  }

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  if (songId === null) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <p className="text-lg">Δεν έχει επιλεγεί τραγούδι.</p>
        <button onClick={() => router.push('/admin/songs')} className="btn btn-primary">← Πίσω στα τραγούδια</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Επεξεργασία τραγουδιού</h1>
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
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary">Αποθήκευση</button>
          <button type="button" onClick={handleDelete} className="btn btn-outline btn-error">Διαγραφή</button>
        </div>
      </form>
    </div>
  );
}
