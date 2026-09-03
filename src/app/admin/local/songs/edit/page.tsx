'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { preferencesStore } from '@/lib/preferencesStore';
import { getSelectedEditSongId, clearSelectedEditSongId } from '@/lib/adminEditStore';
import { loadReferenceData } from '@/lib/offlineCache';
import type { CachedSong } from '@/lib/referenceData';
import { getQueuedActions, enqueue } from '@/lib/syncQueue';
import { resolveSongForEdit } from '@/lib/songsMerge';
import { useSyncQueue } from '@/components/SyncQueueProvider';
import SongAxisEditor, { type AxisValueEntry } from '@/components/SongAxisEditor';
import PageNav from '@/components/PageNav';
import { validateImageFile, IMAGE_ACCEPT_ATTR } from '@/lib/imageValidation';
import { putLocalImage, deleteLocalImage, getLocalImage } from '@/lib/localImageStore';
import { mintDraftId } from '@/lib/draftIds';

// Attempts a live GET of the song first, so axis values (which the offline reference-data
// cache only ever refreshes on a manual sync tap, unlike the songs-list cache which
// refreshes on every visit to admin/songs) are never stale or missing when this page opens.
// Returns null on any failure (offline, network error, non-ok response — 404 included, since
// a pending-edit overlay or the cache fallback still needs a chance to resolve this song) so
// the caller can fall back to the cached data exactly as it did before this existed.
async function fetchLiveSong(
  id: number
): Promise<{ base: CachedSong; baseAxisValues: AxisValueEntry[] } | null> {
  try {
    const liveRes = await nativeApiFetch(`/api/songs/${id}`);
    if (!liveRes.ok) return null;
    const data = await liveRes.json();
    const base: CachedSong = {
      id: data.id,
      title: data.title,
      lyrics: data.lyrics,
      imageUrl: data.imageUrl,
      notes: data.notes,
      maleKey: data.maleKey,
      femaleKey: data.femaleKey,
    };
    const baseAxisValues: AxisValueEntry[] = (data.axisValues ?? []).map(
      (v: { axisType: string; refId: number | null; yearValue: number | null }) => ({
        axisType: v.axisType,
        refId: v.refId,
        yearValue: v.yearValue,
      })
    );
    return { base, baseAxisValues };
  } catch {
    return null;
  }
}

export default function LocalEditSongPage() {
  const router = useRouter();
  const { notifyQueueChanged } = useSyncQueue();
  const [songId, setSongId] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [hasPendingEdit, setHasPendingEdit] = useState(false);

  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [notes, setNotes] = useState('');
  const [maleKey, setMaleKey] = useState('');
  const [femaleKey, setFemaleKey] = useState('');
  const [axisValues, setAxisValues] = useState<AxisValueEntry[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pendingImageBlobId, setPendingImageBlobId] = useState<number | null>(null);
  // The pendingImageBlobId seeded from resolveSongForEdit (an earlier queued update owns
  // those bytes). Never delete this id from the local store — doing so would make that
  // queued update unresolvable on reconnect. null when this session picked the image.
  const [loadedBlobId, setLoadedBlobId] = useState<number | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  useEffect(() => {
    getSelectedEditSongId(preferencesStore)
      .then(setSongId)
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    if (songId === null) return;
    Promise.all([fetchLiveSong(songId), loadReferenceData(), getQueuedActions()])
      .then(([live, referenceData, actions]) => {
        const cachedBase: CachedSong | null =
          referenceData?.songs.find((s) => s.id === songId) ?? null;
        const base = live?.base ?? cachedBase;
        const baseAxisValues: AxisValueEntry[] =
          live?.baseAxisValues ??
          (referenceData?.axisValues ?? [])
            .filter((v) => v.songId === songId)
            .map((v) => ({ axisType: v.axisType, refId: v.refId, yearValue: v.yearValue }));
        const result = resolveSongForEdit(songId, base, baseAxisValues, actions);
        setHasPendingEdit(result.hasPendingEdit);
        if (result.song) {
          setTitle(result.song.title);
          setLyrics(result.song.lyrics ?? '');
          setNotes(result.song.notes ?? '');
          setMaleKey(result.song.maleKey ?? '');
          setFemaleKey(result.song.femaleKey ?? '');
          setImageUrl(result.song.imageUrl);
          setAxisValues(result.song.axisValues);
          setNotFound(false);
          const pendingId = result.song.pendingImageBlobId;
          setPendingImageBlobId(pendingId);
          setLoadedBlobId(pendingId);
          if (pendingId != null) {
            getLocalImage(pendingId)
              .then((local) => {
                if (local) setLocalPreviewUrl(URL.createObjectURL(local.blob));
              })
              .catch(() => {/* no preview if bytes are gone; imageUrl still shows if any */});
          }
        } else {
          setNotFound(true);
        }
        setResolved(true);
      })
      .catch(() => {
        setNotFound(true);
        setResolved(true);
      });
  }, [songId]);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setError(null);
    const validation = validateImageFile(file);
    if (!validation.ok) {
      setError(validation.reason);
      input.value = '';
      return;
    }
    const draftId = mintDraftId();
    try {
      await putLocalImage(draftId, { blob: file, contentType: file.type, filename: file.name });
    } catch {
      setError('Αποτυχία αποθήκευσης εικόνας.');
      return;
    }
    // A re-pick supersedes a blob picked earlier this session — delete its bytes so they
    // don't leak. Never delete loadedBlobId: an earlier still-queued update owns it.
    if (pendingImageBlobId != null && pendingImageBlobId !== loadedBlobId) {
      try { await deleteLocalImage(pendingImageBlobId); } catch { /* best-effort */ }
    }
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    setPendingImageBlobId(draftId);
    setLocalPreviewUrl(URL.createObjectURL(file));
    setImageUrl(null); // a fresh pending image supersedes the existing real URL
    input.value = ''; // let the same filename be re-picked later (e.g. after Remove)
  }

  async function handleRemoveImage() {
    // Only delete bytes picked in *this* session. A pendingImageBlobId seeded from
    // resolveSongForEdit belongs to an earlier still-queued update; deleting it would make
    // that update unresolvable (item-error -> needsAttention) once connectivity returns.
    if (pendingImageBlobId != null && pendingImageBlobId !== loadedBlobId) {
      try {
        await deleteLocalImage(pendingImageBlobId);
      } catch {
        // best-effort
      }
    }
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    setLocalPreviewUrl(null);
    setPendingImageBlobId(null);
    setImageUrl(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (songId === null) return;
    setError(null);
    try {
      await enqueue('song-update', {
        songId,
        title,
        lyrics: lyrics || null,
        notes: notes || null,
        maleKey: maleKey || null,
        femaleKey: femaleKey || null,
        axisValues,
        imageUrl,
        pendingImageBlobId,
      });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    await notifyQueueChanged();
    router.push('/admin/songs');
  }

  async function handleDelete() {
    if (songId === null) return;
    setError(null);
    try {
      await enqueue('song-delete', { songId });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    await clearSelectedEditSongId(preferencesStore);
    await notifyQueueChanged();
    router.push('/admin/songs');
  }

  if (!checked || (songId !== null && !resolved)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <PageNav backHref="/admin/songs" showHome={false} />
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  if (songId === null) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <PageNav backHref="/admin/songs" showHome={false} />
        <p className="text-lg">Δεν έχει επιλεγεί τραγούδι.</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <PageNav backHref="/admin/songs" showHome={false} />
        <p className="text-lg">Το τραγούδι δεν βρέθηκε στα αποθηκευμένα δεδομένα.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageNav backHref="/admin/songs" showHome={false} />
      <h1 className="text-xl font-bold">Επεξεργασία τραγουδιού</h1>
      {hasPendingEdit && (
        <p className="text-sm text-base-content/50">Δείχνονται οι μη συγχρονισμένες αλλαγές.</p>
      )}
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
        <div className="flex flex-col gap-2">
          <label className="label-text">Εικόνα παρτιτούρας (προαιρετικό, εναλλακτικά ή μαζί με τους στίχους)</label>
          <input type="file" accept={IMAGE_ACCEPT_ATTR} onChange={handleImageChange} className="file-input file-input-bordered" />
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
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary">Αποθήκευση</button>
          <button type="button" onClick={handleDelete} className="btn btn-outline btn-error">Διαγραφή</button>
        </div>
      </form>
    </div>
  );
}
