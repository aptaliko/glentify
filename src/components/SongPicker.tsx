'use client';

import { useEffect, useState } from 'react';
import { remoteSongPickerDataSource, type SongPickerDataSource, type SongPickerFilters } from '@/lib/songPickerData';

interface Option {
  id: number;
  name: string;
}

interface Song {
  id: number;
  title: string;
}

const PAGE_SIZE = 30;

export default function SongPicker({
  onSelect,
  dataSource = remoteSongPickerDataSource,
}: {
  onSelect: (songId: number) => void;
  dataSource?: SongPickerDataSource;
}) {
  const [regions, setRegions] = useState<Option[]>([]);
  const [genres, setGenres] = useState<Option[]>([]);
  const [rhythms, setRhythms] = useState<Option[]>([]);
  const [dromoi, setDromoi] = useState<Option[]>([]);
  const [composers, setComposers] = useState<Option[]>([]);

  const [regionId, setRegionId] = useState('');
  const [genreId, setGenreId] = useState('');
  const [rhythmId, setRhythmId] = useState('');
  const [dromosId, setDromosId] = useState('');
  const [composerId, setComposerId] = useState('');
  const [year, setYear] = useState('');
  const [search, setSearch] = useState('');

  const [allSongs, setAllSongs] = useState<Song[]>([]);
  const [filteredResults, setFilteredResults] = useState<Song[]>([]);
  const [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      dataSource.listRegions(),
      dataSource.listGenres(),
      dataSource.listRhythms(),
      dataSource.listDromoi(),
      dataSource.listComposers(),
      dataSource.listAllSongs(),
    ]).then(([r, g, rh, d, c, s]) => {
      setRegions(r);
      setGenres(g);
      setRhythms(rh);
      setDromoi(d);
      setComposers(c);
      setAllSongs(s);
      setLoaded(true);
    });
  }, [dataSource]);

  const hasFilters = !!regionId || !!genreId || !!rhythmId || !!dromosId || !!composerId || !!year || !!search;

  useEffect(() => {
    if (!loaded || !hasFilters) return;
    let cancelled = false;
    const filters: SongPickerFilters = {
      regionId: regionId ? Number(regionId) : undefined,
      genreId: genreId ? Number(genreId) : undefined,
      rhythmId: rhythmId ? Number(rhythmId) : undefined,
      dromosId: dromosId ? Number(dromosId) : undefined,
      composerId: composerId ? Number(composerId) : undefined,
      year: year ? Number(year) : undefined,
      search: search || undefined,
    };
    dataSource.listSongs(filters).then((results) => {
      if (!cancelled) setFilteredResults(results);
    });
    return () => {
      cancelled = true;
    };
  }, [dataSource, loaded, hasFilters, regionId, genreId, rhythmId, dromosId, composerId, year, search]);

  function handleRegionChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setRegionId(e.target.value);
    setPage(0);
  }

  function handleGenreChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setGenreId(e.target.value);
    setPage(0);
  }

  function handleRhythmChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setRhythmId(e.target.value);
    setPage(0);
  }

  function handleDromosChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setDromosId(e.target.value);
    setPage(0);
  }

  function handleComposerChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setComposerId(e.target.value);
    setPage(0);
  }

  function handleYearChange(e: React.ChangeEvent<HTMLInputElement>) {
    setYear(e.target.value);
    setPage(0);
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(0);
  }

  const filtered = hasFilters ? filteredResults : allSongs;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSongs = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="card w-full max-w-md bg-base-100 shadow">
      <div className="card-body gap-3">
        <h2 className="card-title text-lg">Διάλεξε τραγούδι</h2>

        <form onSubmit={(e) => e.preventDefault()} className="flex gap-2">
          <input
            value={search}
            onChange={handleSearchChange}
            placeholder="Αναζήτηση τραγουδιού"
            className="input input-bordered flex-1"
            autoFocus
          />
        </form>

        <div className="flex flex-wrap gap-2">
          <select value={regionId} onChange={handleRegionChange} className="select select-bordered select-sm">
            <option value="">Όλες οι περιοχές</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <select value={genreId} onChange={handleGenreChange} className="select select-bordered select-sm">
            <option value="">Όλα τα είδη</option>
            {genres.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <select value={rhythmId} onChange={handleRhythmChange} className="select select-bordered select-sm">
            <option value="">Όλοι οι ρυθμοί</option>
            {rhythms.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <select value={dromosId} onChange={handleDromosChange} className="select select-bordered select-sm">
            <option value="">Όλοι οι δρόμοι</option>
            {dromoi.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select value={composerId} onChange={handleComposerChange} className="select select-bordered select-sm">
            <option value="">Όλοι οι συνθέτες</option>
            {composers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            type="number"
            value={year}
            onChange={handleYearChange}
            placeholder="Έτος"
            className="input input-bordered input-sm w-24"
          />
        </div>

        <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
          {!loaded && <li className="p-3 text-center text-sm text-base-content/50">Φόρτωση...</li>}
          {loaded && pageSongs.length === 0 && <li className="p-3 text-center text-sm text-base-content/50">Καμία πρόταση</li>}
          {pageSongs.map((s) => (
            <li key={s.id}>
              <button onClick={() => onSelect(s.id)} className="btn btn-ghost h-auto w-full justify-center py-3 text-center font-normal">
                {s.title}
              </button>
            </li>
          ))}
        </ul>

        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn btn-sm">← Προηγούμενα</button>
            <span className="text-sm text-base-content/60">{page + 1} / {pageCount}</span>
            <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} className="btn btn-sm">Επόμενα →</button>
          </div>
        )}
      </div>
    </div>
  );
}
