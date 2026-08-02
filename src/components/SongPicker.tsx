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

type Step = 'genre' | 'region' | 'songs';

export default function SongPicker({
  onSelect,
  dataSource = remoteSongPickerDataSource,
}: {
  onSelect: (songId: number) => void;
  dataSource?: SongPickerDataSource;
}) {
  const [step, setStep] = useState<Step>('genre');
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<Genre | null>(null);
  const [regionOptions, setRegionOptions] = useState<Region[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [search, setSearch] = useState('');
  const [songs, setSongs] = useState<Song[]>([]);

  useEffect(() => {
    dataSource.listGenres().then(setGenres);
  }, [dataSource]);

  async function loadSongs(genreId: number, regionId: number | null, q: string) {
    const results = await dataSource.listSongs({ genreId, regionId: regionId ?? undefined, search: q || undefined });
    setSongs(results);
  }

  async function handlePickGenre(genre: Genre) {
    setSelectedGenre(genre);
    setSelectedRegion(null);
    setSearch('');
    const regionsForGenre = await dataSource.listRegionsForGenre(genre.id);
    if (regionsForGenre.length > 0) {
      setRegionOptions(regionsForGenre);
      setStep('region');
    } else {
      setRegionOptions([]);
      await loadSongs(genre.id, null, '');
      setStep('songs');
    }
  }

  async function handlePickRegion(region: Region | null) {
    if (!selectedGenre) return;
    setSelectedRegion(region);
    await loadSongs(selectedGenre.id, region?.id ?? null, '');
    setStep('songs');
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedGenre) return;
    loadSongs(selectedGenre.id, selectedRegion?.id ?? null, search);
  }

  function handleBack() {
    if (step === 'songs') {
      setStep(regionOptions.length > 0 ? 'region' : 'genre');
      setSearch('');
    } else if (step === 'region') {
      setStep('genre');
    }
  }

  return (
    <div className="card w-full max-w-md bg-base-100 shadow">
      <div className="card-body gap-3">
        {step !== 'genre' && (
          <button onClick={handleBack} className="btn btn-ghost btn-sm self-start">
            ← Πίσω
          </button>
        )}

        {step === 'genre' && (
          <>
            <h2 className="card-title text-lg">Διάλεξε κατηγορία</h2>
            <ul className="flex flex-col gap-1">
              {genres.map((g) => (
                <li key={g.id}>
                  <button onClick={() => handlePickGenre(g)} className="btn btn-outline btn-lg w-full">
                    {g.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {step === 'region' && (
          <>
            <h2 className="card-title text-lg">{selectedGenre?.name} — διάλεξε περιοχή</h2>
            <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
              {regionOptions.map((r) => (
                <li key={r.id}>
                  <button onClick={() => handlePickRegion(r)} className="btn btn-outline btn-lg w-full">
                    {r.name}
                  </button>
                </li>
              ))}
              <li>
                <button onClick={() => handlePickRegion(null)} className="btn btn-ghost btn-lg w-full">
                  Όλες οι περιοχές
                </button>
              </li>
            </ul>
          </>
        )}

        {step === 'songs' && (
          <>
            <h2 className="card-title text-lg">
              {selectedGenre?.name}
              {selectedRegion ? ` — ${selectedRegion.name}` : ''}
            </h2>
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Αναζήτηση τραγουδιού"
                className="input input-bordered flex-1"
                autoFocus
              />
              <button type="submit" className="btn">Αναζήτηση</button>
            </form>
            <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
              {songs.length === 0 && <li className="p-3 text-center text-sm text-base-content/50">Καμία πρόταση</li>}
              {songs.map((s) => (
                <li key={s.id}>
                  <button onClick={() => onSelect(s.id)} className="btn btn-ghost h-auto w-full justify-center py-3 text-center font-normal">
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
