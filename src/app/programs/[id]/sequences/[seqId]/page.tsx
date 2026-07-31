'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Song {
  id: number;
  title: string;
  lyrics: string | null;
  maleKey: string | null;
  femaleKey: string | null;
}

interface SequenceSongEntry {
  sequenceSongId: number;
  song: Song;
}

interface SequenceWithSongs {
  id: number;
  title: string;
  songs: SequenceSongEntry[];
}

export default function SequencePlaybackPage() {
  const params = useParams<{ id: string; seqId: string }>();
  const [sequence, setSequence] = useState<SequenceWithSongs | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    fetch(`/api/programs/${params.id}/sequences/${params.seqId}`)
      .then((r) => r.json())
      .then((data) => {
        setSequence(data);
        setIndex(0);
      });
  }, [params.id, params.seqId]);

  if (!sequence) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  if (sequence.songs.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
        <h1 className="text-2xl font-bold">{sequence.title}</h1>
        <p className="text-base-content/60">Δεν έχουν προστεθεί τραγούδια σε αυτή τη σειρά.</p>
        <Link href={`/programs/${params.id}`} className="btn btn-outline">← Πίσω στις σειρές</Link>
      </main>
    );
  }

  const current = sequence.songs[index];
  const hasPrevious = index > 0;
  const hasNext = index < sequence.songs.length - 1;

  return (
    <main className="flex min-h-screen flex-col bg-base-200">
      <header className="sticky top-0 z-10 flex flex-col items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link href={`/programs/${params.id}`} className="btn btn-sm btn-outline">
            ← Σειρές προγράμματος
          </Link>
          <span className="badge badge-neutral">{index + 1} / {sequence.songs.length}</span>
        </div>
        <h1 className="text-center text-xl font-bold sm:text-2xl">{current.song.title}</h1>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 lg:flex-row lg:items-start lg:justify-center">
        <div className="flex flex-1 flex-col items-center gap-4 lg:max-w-3xl">
          <div className="card flex w-full flex-col gap-3 bg-base-100 p-6 shadow sm:p-8">
            {(current.song.maleKey || current.song.femaleKey) && (
              <div className="flex justify-center gap-2">
                {current.song.maleKey && <span className="badge badge-outline">♂ {current.song.maleKey}</span>}
                {current.song.femaleKey && <span className="badge badge-outline">♀ {current.song.femaleKey}</span>}
              </div>
            )}
            {current.song.lyrics ? (
              <pre className="whitespace-pre-wrap text-center font-sans text-xl sm:text-2xl leading-relaxed text-base-content">
                {current.song.lyrics}
              </pre>
            ) : (
              <p className="text-lg italic text-base-content/50">Δεν έχουν προστεθεί ακόμη στίχοι για αυτό το τραγούδι.</p>
            )}
          </div>

          <div className="flex w-full gap-3">
            {hasPrevious && (
              <button onClick={() => setIndex((i) => i - 1)} className="btn btn-lg flex-1">
                ← Προηγούμενο
              </button>
            )}
            {hasNext && (
              <button onClick={() => setIndex((i) => i + 1)} className="btn btn-primary btn-lg flex-1">
                Επόμενο →
              </button>
            )}
          </div>
        </div>

        <div className="card w-full bg-base-100 shadow lg:w-72 lg:shrink-0">
          <div className="card-body gap-1 p-4">
            <h2 className="text-sm font-semibold text-base-content/60">Λίστα σειράς</h2>
            <ul className="flex flex-col gap-1">
              {sequence.songs.map((entry, i) => (
                <li key={entry.sequenceSongId}>
                  <button
                    onClick={() => setIndex(i)}
                    className={`btn btn-ghost btn-sm w-full justify-start text-left ${i === index ? 'btn-active' : ''}`}
                  >
                    <span className="badge badge-neutral badge-sm">{i + 1}</span>
                    {entry.song.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
