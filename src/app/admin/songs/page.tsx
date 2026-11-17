'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { isNativeApp } from '@/lib/platform';
import { preferencesStore } from '@/lib/preferencesStore';
import { setSelectedEditSongId } from '@/lib/adminEditStore';
import { getQueuedActions } from '@/lib/syncQueue';
import type { QueuedAction } from '@/lib/syncQueue';
import { useSyncQueue } from '@/components/SyncQueueProvider';
import { loadReferenceData } from '@/lib/offlineCache';
import type { ReferenceData } from '@/lib/referenceData';
import { mergeSongsWithPending, isSongQueueAction } from '@/lib/songsMerge';
import {
  ADMIN_SONGS_PAGE_SIZE,
  EMPTY_SONG_FILTERS,
  filterAdminSongs,
  hasAxisFilter,
  paginate,
  yearsInUse,
  type SongListFilters,
} from '@/lib/songListFilters';

type Option = { id: number; name: string };

// One dropdown per filter. An empty value means "all", which is the same as no filter.
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number | null;
  options: Option[];
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-base-content/70">
      {label}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="select select-bordered select-sm font-normal"
      >
        <option value="">Όλα</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

const byName = (a: Option, b: Option) => a.name.localeCompare(b.name, 'el');

export default function SongsAdminPage() {
  const native = isNativeApp();
  const router = useRouter();
  const [data, setData] = useState<ReferenceData | null>(null);
  const [filters, setFilters] = useState<SongListFilters>(EMPTY_SONG_FILTERS);
  const [page, setPage] = useState(1);
  const [offlineSongs, setOfflineSongs] = useState(false);
  const [songsUnavailable, setSongsUnavailable] = useState(false);
  const [neverPrimed, setNeverPrimed] = useState(false);
  const [pendingActions, setPendingActions] = useState<QueuedAction[]>([]);
  const { pendingCount } = useSyncQueue();

  // Loads the owner's songs with their axis values and lookup lists in one go. Filtering and
  // paging then happen in memory, so the same code serves web and offline native.
  async function load() {
    if (!native) {
      const res = await nativeApiFetch('/api/reference-data');
      setData(await res.json());
      return;
    }
    try {
      const res = await nativeApiFetch('/api/reference-data');
      setData(await res.json());
      setOfflineSongs(false);
      setSongsUnavailable(false);
      setNeverPrimed(false);
    } catch {
      const cached = await loadReferenceData().catch(() => null);
      if (cached && cached.primedAt !== null) {
        setData(cached);
        setOfflineSongs(true);
        setSongsUnavailable(false);
        setNeverPrimed(false);
      } else {
        setSongsUnavailable(true);
        setNeverPrimed(!cached || cached.primedAt === null);
      }
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          load();
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCount]);

  const axisRows = useMemo(() => data?.axisValues ?? [], [data]);
  const displaySongs = useMemo(() => (data ? mergeSongsWithPending(data.songs, pendingActions) : []), [data, pendingActions]);
  const matching = useMemo(() => filterAdminSongs(displaySongs, axisRows, filters), [displaySongs, axisRows, filters]);
  const { items, page: currentPage, totalPages } = paginate(matching, page, ADMIN_SONGS_PAGE_SIZE);

  // Any change to a filter starts again from the first page.
  function update(patch: Partial<SongListFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  const years = useMemo(() => yearsInUse(axisRows).map((y) => ({ id: y, name: String(y) })), [axisRows]);
  const lookups = useMemo(
    () => ({
      regions: (data?.regions ?? []).map((r) => ({ id: r.id, name: r.name })).sort(byName),
      genres: (data?.genres ?? []).map((r) => ({ id: r.id, name: r.name })).sort(byName),
      rhythms: (data?.rhythms ?? []).map((r) => ({ id: r.id, name: r.name })).sort(byName),
      dromoi: (data?.dromoi ?? []).map((r) => ({ id: r.id, name: r.name })).sort(byName),
      dances: (data?.dances ?? []).map((r) => ({ id: r.id, name: r.name })).sort(byName),
      composers: (data?.composers ?? []).map((r) => ({ id: r.id, name: r.name })).sort(byName),
    }),
    [data]
  );

  const anyFilter = filters.search.trim() !== '' || hasAxisFilter(filters);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Τραγούδια</h1>
        <Link href="/admin/songs/new" className="btn btn-primary">Νέο τραγούδι</Link>
      </div>
      {songsUnavailable && (
        <p className="text-sm text-base-content/50">
          {neverPrimed
            ? 'Δεν έχει προετοιμαστεί για offline χρήση. '
            : 'Άγνωστο χωρίς σύνδεση. '}
          <Link href="/" className="link">Προετοιμασία για offline</Link>
        </p>
      )}
      {offlineSongs && <p className="text-sm text-warning">Χωρίς σύνδεση — τελευταία γνωστά δεδομένα.</p>}
      {!songsUnavailable && (
        <>
          <input
            value={filters.search}
            onChange={(e) => update({ search: e.target.value })}
            placeholder="Αναζήτηση τίτλου"
            className="input input-bordered w-full"
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <FilterSelect label="Περιοχή" value={filters.regionId} options={lookups.regions} onChange={(v) => update({ regionId: v })} />
            <FilterSelect label="Είδος" value={filters.genreId} options={lookups.genres} onChange={(v) => update({ genreId: v })} />
            <FilterSelect label="Ρυθμός" value={filters.rhythmId} options={lookups.rhythms} onChange={(v) => update({ rhythmId: v })} />
            <FilterSelect label="Δρόμος" value={filters.dromosId} options={lookups.dromoi} onChange={(v) => update({ dromosId: v })} />
            <FilterSelect label="Χορός" value={filters.danceId} options={lookups.dances} onChange={(v) => update({ danceId: v })} />
            <FilterSelect label="Συνθέτης" value={filters.composerId} options={lookups.composers} onChange={(v) => update({ composerId: v })} />
            <FilterSelect label="Έτος" value={filters.year} options={years} onChange={(v) => update({ year: v })} />
          </div>
          <div className="flex items-center justify-between text-sm text-base-content/60">
            <span>{matching.length} τραγούδια</span>
            {anyFilter && (
              <button type="button" className="link link-hover" onClick={() => update({ ...EMPTY_SONG_FILTERS })}>
                Καθαρισμός φίλτρων
              </button>
            )}
          </div>
          <ul className="list rounded-box bg-base-100 shadow">
            {items.map((s, i) => (
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
            {displaySongs.length > 0 && matching.length === 0 && (
              <li className="list-row text-base-content/50">Κανένα τραγούδι με αυτά τα φίλτρα</li>
            )}
          </ul>
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <button type="button" className="btn btn-sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                Προηγούμενη
              </button>
              <span className="text-sm">Σελίδα {currentPage} από {totalPages}</span>
              <button type="button" className="btn btn-sm" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>
                Επόμενη
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
