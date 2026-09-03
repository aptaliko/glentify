'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { upload } from '@vercel/blob/client';
import PageNav from '@/components/PageNav';
import SongAxisEditor, { type AxisValueEntry } from '@/components/SongAxisEditor';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { apiUrl } from '@/lib/apiClient';
import { getAuthToken } from '@/lib/authToken';
import { isNativeApp } from '@/lib/platform';
import { enqueue } from '@/lib/syncQueue';
import { useSyncQueue } from '@/components/SyncQueueProvider';
import { validateImageFile, IMAGE_ACCEPT_ATTR } from '@/lib/imageValidation';
import { putLocalImage, deleteLocalImage } from '@/lib/localImageStore';
import { mintDraftId } from '@/lib/draftIds';

export default function NewSongPage() {
  const router = useRouter();
  const native = isNativeApp();
  const { notifyQueueChanged } = useSyncQueue();
  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [notes, setNotes] = useState('');
  const [maleKey, setMaleKey] = useState('');
  const [femaleKey, setFemaleKey] = useState('');
  const [axisValues, setAxisValues] = useState<AxisValueEntry[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pendingImageBlobId, setPendingImageBlobId] = useState<number | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (native) {
      const validation = validateImageFile(file);
      if (!validation.ok) {
        setError(validation.reason);
        e.target.value = '';
        return;
      }
      const draftId = mintDraftId();
      try {
        await putLocalImage(draftId, { blob: file, contentType: file.type, filename: file.name });
      } catch {
        setError('Αποτυχία αποθήκευσης εικόνας.');
        return;
      }
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
      setPendingImageBlobId(draftId);
      setLocalPreviewUrl(URL.createObjectURL(file));
      setImageUrl(null); // a fresh pending image supersedes any prior real URL
      return;
    }
    // Web: eager direct upload, unchanged.
    setUploading(true);
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

  async function handleRemoveImage() {
    if (native && pendingImageBlobId != null) {
      try {
        await deleteLocalImage(pendingImageBlobId);
      } catch {
        // best-effort cleanup; clearing the form state below is what matters
      }
    }
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    setLocalPreviewUrl(null);
    setPendingImageBlobId(null);
    setImageUrl(null);
  }

  interface SuggestionSong {
    id: number;
    title: string;
    lyrics: string | null;
    notes: string | null;
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
      nativeApiFetch(`/api/songs/suggestions?title=${encodeURIComponent(title.trim())}`)
        .then((r) => (r.ok ? r.json() : []))
        .then(setSuggestions)
        // No connectivity (most commonly: native, offline) or any other fetch/parse
        // failure — this is a convenience ("maybe you meant an existing song"), not
        // something the create flow depends on, so fail silently to no suggestions
        // rather than an unhandled promise rejection.
        .catch(() => setSuggestions([]));
    }, 300);
    return () => clearTimeout(timeout);
  }, [title]);

  function applySuggestion(s: SuggestionSong) {
    setLyrics(s.lyrics ?? '');
    setNotes(s.notes ?? '');
    setMaleKey(s.maleKey ?? '');
    setFemaleKey(s.femaleKey ?? '');
    setAxisValues(s.axisValues);
    setSuggestions([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body = {
      title,
      lyrics: lyrics || null,
      notes: notes || null,
      maleKey: maleKey || null,
      femaleKey: femaleKey || null,
      axisValues,
      imageUrl,
      pendingImageBlobId: native ? pendingImageBlobId : null,
    };
    if (native) {
      try {
        await enqueue('song-create', body);
      } catch {
        setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
        return;
      }
      await notifyQueueChanged();
      router.push('/admin/songs');
      return;
    }
    const res = await nativeApiFetch('/api/songs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError('Αποτυχία δημιουργίας τραγουδιού');
      return;
    }
    router.push('/admin/songs');
  }

  return (
    <div className="flex flex-col gap-4">
      <PageNav backHref="/admin/songs" showHome={false} />
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
        <div className="flex flex-col gap-2">
          <label className="label-text">Εικόνα παρτιτούρας (προαιρετικό, εναλλακτικά ή μαζί με τους στίχους)</label>
          <input type="file" accept={IMAGE_ACCEPT_ATTR} onChange={handleImageChange} className="file-input file-input-bordered" />
          {uploading && <span className="loading loading-spinner loading-sm" />}
          {(localPreviewUrl || imageUrl) && (
            <>
              <img src={localPreviewUrl ?? imageUrl ?? undefined} alt="Προεπισκόπηση παρτιτούρας" className="max-h-64 rounded-box object-contain" />
              <button type="button" onClick={handleRemoveImage} className="btn btn-sm btn-outline btn-error self-start">Αφαίρεση εικόνας</button>
            </>
          )}
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
