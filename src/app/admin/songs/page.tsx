'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { isNativeApp } from '@/lib/platform';
import { preferencesStore } from '@/lib/preferencesStore';
import { setSelectedEditSongId } from '@/lib/adminEditStore';
import { getQueuedActions } from '@/lib/syncQueue';
import type { QueuedAction } from '@/lib/syncQueue';
import { useSyncQueue } from '@/components/SyncQueueProvider';
import { saveSongsListCache, loadSongsListCache } from '@/lib/songsListCache';
import type { CachedSong } from '@/lib/songsListCache';
import { mergeSongsWithPending, isSongQueueAction } from '@/lib/songsMerge';

export default function SongsAdminPage() {
  const native = isNativeApp();
  const router = useRouter();
  const [songs, setSongs] = useState<CachedSong[]>([]);
  const [search, setSearch] = useState('');
  const [offlineSongs, setOfflineSongs] = useState(false);
  const [songsUnavailable, setSongsUnavailable] = useState(false);
  const [pendingActions, setPendingActions] = useState<QueuedAction[]>([]);
  const { pendingCount } = useSyncQueue();

  async function load(q: string) {
    const url = q ? `/api/songs?search=${encodeURIComponent(q)}` : '/api/songs';
    if (!native) {
      const res = await nativeApiFetch(url);
      setSongs(await res.json());
      return;
    }
    try {
      const res = await nativeApiFetch(url);
      const data: CachedSong[] = await res.json();
      setSongs(data);
      setOfflineSongs(false);
      setSongsUnavailable(false);
      // Only the unfiltered list is a safe base to cache — caching a search result would
      // silently truncate the offline list to whatever was last searched for.
      if (!q) {
        try {
          await saveSongsListCache(data);
        } catch {
          // A cache-write failure must not affect the already-successful state above.
        }
      }
    } catch {
      const cached = await loadSongsListCache().catch(() => null);
      if (cached) {
        const filtered = q ? cached.filter((s) => s.title.toLowerCase().includes(q.toLowerCase())) : cached;
        setSongs(filtered);
        setOfflineSongs(true);
        setSongsUnavailable(false);
      } else {
        setSongsUnavailable(true);
      }
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    load(search);
  }

  async function handleOpenSong(id: number) {
    await setSelectedEditSongId(preferencesStore, id);
    router.push('/admin/local/songs/edit');
  }

  // Tracks this feature's own count of currently-queued, still-retryable song actions
  // (needsAttention ones excluded — those never leave the queue, so counting them would
  // mean the >0 -> 0 transition below could never fire again once one gets stuck) so we
  // can detect "this list's queue just drained" and refresh the base list from the
  // server. This exclusion is the explicit re-check baked in from the start — sub-project
  // #6's equivalent programs-list effect shipped without it.
  const prevPendingSongCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (!native) return;
    getQueuedActions()
      .then((actions) => {
        setPendingActions(actions);
        const thisFeatureCount = actions.filter((a) => isSongQueueAction(a) && !a.needsAttention).length;
        const prevCount = prevPendingSongCountRef.current;
        prevPendingSongCountRef.current = thisFeatureCount;
        if (prevCount !== null && prevCount > 0 && thisFeatureCount === 0) {
          load(search);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCount]);

  const displaySongs = mergeSongsWithPending(songs, pendingActions);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Τραγούδια</h1>
        <Link href="/admin/songs/new" className="btn btn-primary">Νέο τραγούδι</Link>
      </div>
      {songsUnavailable && <p className="text-sm text-base-content/50">Άγνωστο χωρίς σύνδεση.</p>}
      {offlineSongs && <p className="text-sm text-warning">Χωρίς σύνδεση — τελευταία γνωστά δεδομένα.</p>}
      {!songsUnavailable && (
        <>
          <form onSubmit={handleSearch} className="flex gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Αναζήτηση τίτλου" className="input input-bordered flex-1" />
            <button type="submit" className="btn">Αναζήτηση</button>
          </form>
          <ul className="list rounded-box bg-base-100 shadow">
            {displaySongs.map((s, i) => (
              <li key={s.id ?? `pending-${i}-${s.title}`} className="list-row items-center gap-2">
                {s.id === null ? (
                  <span className="text-base-content/50">{s.title}</span>
                ) : native ? (
                  <button onClick={() => handleOpenSong(s.id as number)} className="link link-hover text-left">{s.title}</button>
                ) : (
                  <Link href={`/admin/songs/${s.id}`} className="link link-hover">{s.title}</Link>
                )}
                {!s.lyrics && <span className="badge badge-warning badge-sm">λείπουν στίχοι</span>}
                {s.status === 'pending-create' && <span className="text-xs text-base-content/50">Θα είναι διαθέσιμο μόλις συγχρονιστεί.</span>}
                {s.status === 'needs-attention-create' && <span className="text-xs text-error">Απέτυχε η δημιουργία.</span>}
                {s.status === 'edited' && <span className="text-xs text-base-content/50">Θα ενημερωθεί μόλις υπάρξει σύνδεση.</span>}
                {s.status === 'needs-attention-edit' && <span className="text-xs text-error">Απέτυχε η ενημέρωση.</span>}
              </li>
            ))}
            {displaySongs.length === 0 && <li className="list-row text-base-content/50">Κανένα τραγούδι ακόμη</li>}
          </ul>
        </>
      )}
    </div>
  );
}
