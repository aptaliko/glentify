'use client';

import { useEffect, useState } from 'react';
import { remoteSongPickerDataSource, type SongPickerDataSource } from '@/lib/songPickerData';

interface Genre {
  id: number;
  name: string;
}

interface Region {
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
  const [genres, setGenres] = useState<Genre[]>([]);
  const [regionOptions, setRegionOptions] = useState<Region[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<Genre | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [search, setSearch] = useState('');
  const [allSongs, setAllSongs] = useState<Song[]>([]);
  const [filteredResults, setFilteredResults] = useState<Song[]>([]);
  const [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([dataSource.listGenres(), dataSource.listAllSongs()]).then(([g, s]) => {
      setGenres(g);
      setAllSongs(s);
      setLoaded(true);
    });
  }, [dataSource]);

  const hasFilters = !!selectedGenre || !!selectedRegion || !!search;

  useEffect(() => {
    if (!loaded || !hasFilters) return;
    let cancelled = false;
    dataSource
      .listSongs({ genreId: selectedGenre?.id, regionId: selectedRegion?.id, search: search || undefined })
      .then((results) => {
        if (!cancelled) setFilteredResults(results);
      });
    return () => {
      cancelled = true;
    };
  }, [dataSource, loaded, hasFilters, selectedGenre, selectedRegion, search]);

  function handleGenreChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const genre = genres.find((g) => g.id === Number(e.target.value)) ?? null;
    setSelectedGenre(genre);
    setSelectedRegion(null);
    setPage(0);
    if (genre) {
      dataSource.listRegionsForGenre(genre.id).then(setRegionOptions);
    } else {
      setRegionOptions([]);
    }
  }

  function handleRegionChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const region = regionOptions.find((r) => r.id === Number(e.target.value)) ?? null;
    setSelectedRegion(region);
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
          <select
            value={selectedGenre?.id ?? ''}
            onChange={handleGenreChange}
            className="select select-bordered select-sm"
          >
            <option value="">Όλα τα είδη</option>
            {genres.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          {regionOptions.length > 0 && (
            <select
              value={selectedRegion?.id ?? ''}
              onChange={handleRegionChange}
              className="select select-bordered select-sm"
            >
              <option value="">Όλες οι περιοχές</option>
              {regionOptions.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
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
