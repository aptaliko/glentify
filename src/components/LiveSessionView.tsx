'use client';

import { useCallback, useEffect, useState } from 'react';
import PageNav from '@/components/PageNav';
import SongPicker from '@/components/SongPicker';
import type { SessionStore } from '@/lib/sessionStore';
import type { SuggestionsResponsePayload, SuggestedSong } from '@/lib/suggestions';
import type { SongPickerDataSource } from '@/lib/songPickerData';

function SongButton({ song, onPick }: { song: SuggestedSong; onPick: (songId: number) => void }) {
  return (
    <button
      onClick={() => onPick(song.id)}
      className={`btn btn-ghost h-auto w-full justify-center py-3 text-center text-base font-normal ${
        song.played ? 'text-base-content/40 italic' : ''
      }`}
    >
      {song.title}
      {song.played ? ' · ειπωμένο' : ''}
    </button>
  );
}

function KeyBadges({ maleKey, femaleKey }: { maleKey: string | null; femaleKey: string | null }) {
  if (!maleKey && !femaleKey) return null;
  return (
    <div className="flex justify-center gap-2">
      {maleKey && <span className="badge badge-outline">♂ {maleKey}</span>}
      {femaleKey && <span className="badge badge-outline">♀ {femaleKey}</span>}
    </div>
  );
}

function LyricsCard({
  lyrics,
  imageUrl,
  maleKey,
  femaleKey,
}: {
  lyrics: string | null;
  imageUrl: string | null;
  maleKey: string | null;
  femaleKey: string | null;
}) {
  return (
    <div className="card flex flex-col gap-3 bg-base-100 p-6 shadow sm:p-8">
      <KeyBadges maleKey={maleKey} femaleKey={femaleKey} />
      {imageUrl ? (
        <img src={imageUrl} alt="Παρτιτούρα" className="mx-auto max-h-[70vh] w-auto object-contain" />
      ) : lyrics ? (
        <pre className="whitespace-pre-wrap text-center font-sans text-xl sm:text-2xl leading-relaxed text-base-content">{lyrics}</pre>
      ) : (
        <p className="text-lg italic text-base-content/50">Δεν έχουν προστεθεί ακόμη στίχοι ή παρτιτούρα για αυτό το τραγούδι.</p>
      )}
    </div>
  );
}

export default function LiveSessionView({
  store,
  onEnded,
  songPickerDataSource,
}: {
  store: SessionStore;
  onEnded: () => void;
  songPickerDataSource?: SongPickerDataSource;
}) {
  const [data, setData] = useState<SuggestionsResponsePayload | null>(null);
  const [showPlayed, setShowPlayed] = useState(false);
  const [manualActiveAxisTypes, setManualActiveAxisTypes] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setData(await store.load(showPlayed, manualActiveAxisTypes));
  }, [store, showPlayed, manualActiveAxisTypes]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function toggleAxis(key: string) {
    const current = manualActiveAxisTypes ?? data?.activeAxisTypes ?? [];
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    setManualActiveAxisTypes(next);
  }

  async function handlePick(songId: number) {
    await store.pickSong(songId);
    setManualActiveAxisTypes(null);
    await load();
  }

  async function handleEndSequence() {
    await store.endSequence();
    setManualActiveAxisTypes(null);
    await load();
  }

  async function handleEndSession() {
    await store.endSession();
    onEnded();
  }

  if (!data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref="/" />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  if (!data.currentSong) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
        <PageNav backHref="/" />
        <h1 className="text-2xl font-bold">Διάλεξε τραγούδι για να συνεχίσεις</h1>
        <SongPicker onSelect={handlePick} dataSource={songPickerDataSource} />
      </main>
    );
  }

  const currentSong = data.currentSong;

  return (
    <main className="flex min-h-screen flex-col bg-base-200">
      <header className="sticky top-0 z-10 flex flex-col items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-3 sm:px-6">
        <PageNav backHref="/" />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <label className="label cursor-pointer gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={showPlayed}
              onChange={(e) => setShowPlayed(e.target.checked)}
            />
            <span className="label-text">Δείξε τα ειπωμένα</span>
          </label>
          {data.availableAxisTypes.map((axis) => {
            const isActive = data.activeAxisTypes.includes(axis.key);
            return (
              <button
                key={axis.key}
                onClick={() => toggleAxis(axis.key)}
                className={`btn btn-sm rounded-full ${isActive ? 'btn-primary' : 'btn-outline'}`}
              >
                {axis.label}: {axis.value}
              </button>
            );
          })}
          <button onClick={handleEndSequence} className="btn btn-sm btn-outline">
            Τέλος σειράς
          </button>
          <button onClick={handleEndSession} className="btn btn-sm btn-error">
            Λήξη session
          </button>
        </div>
        <h1 className="text-center text-xl font-bold sm:text-2xl">{currentSong.title}</h1>
      </header>

      <div className="flex-1 p-4 sm:p-6">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
          <LyricsCard
            lyrics={currentSong.lyrics}
            imageUrl={currentSong.imageUrl}
            maleKey={currentSong.maleKey}
            femaleKey={currentSong.femaleKey}
          />
          <div className="card overflow-hidden bg-base-100 shadow">
            <h2 className="border-b border-base-300 bg-base-200 px-4 py-2 text-sm font-semibold tracking-wide text-base-content/70 uppercase">
              {data.mode === 'filtered' ? data.listTitle : 'Όλα τα τραγούδια'}
            </h2>
            <div className="flex max-h-[36rem] flex-col gap-1 overflow-y-auto p-2">
              {data.mode === 'filtered' &&
                (data.candidates.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-base-content/50">Καμία πρόταση</p>
                ) : (
                  data.candidates.map((s) => <SongButton key={s.id} song={s} onPick={handlePick} />)
                ))}
              {data.mode === 'ungrouped' &&
                (data.songs.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-base-content/50">Κανένα τραγούδι</p>
                ) : (
                  data.songs.map((s) => <SongButton key={s.id} song={s} onPick={handlePick} />)
                ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
