'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import PageNav from '@/components/PageNav';

interface Sequence {
  id: number;
  title: string;
}

interface ProgramWithSequences {
  id: number;
  title: string;
  sequences: Sequence[];
}

interface Song {
  id: number;
  title: string;
}

const PREVIEW_COUNT = 7;

export default function ProgramSequencesPage() {
  const params = useParams<{ id: string }>();
  const [program, setProgram] = useState<ProgramWithSequences | null>(null);
  const [songsBySequence, setSongsBySequence] = useState<Record<number, Song[]>>({});

  useEffect(() => {
    fetch(`/api/programs/${params.id}`)
      .then((r) => r.json())
      .then(async (data: ProgramWithSequences) => {
        setProgram(data);
        const entries = await Promise.all(
          data.sequences.map(async (seq) => {
            const res = await fetch(`/api/programs/${params.id}/sequences/${seq.id}`);
            const seqData = await res.json();
            return [seq.id, seqData.songs.map((s: { song: Song }) => s.song)] as const;
          })
        );
        setSongsBySequence(Object.fromEntries(entries));
      });
  }, [params.id]);

  if (!program) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref="/programs" />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <PageNav backHref="/programs" />
      <h1 className="text-2xl font-bold">{program.title}</h1>
      <div className="grid w-full max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
        {program.sequences.map((seq) => {
          const songs = songsBySequence[seq.id] ?? [];
          const remaining = songs.length - PREVIEW_COUNT;
          return (
            <div key={seq.id} className="card flex h-72 flex-col bg-base-100 shadow">
              <div className="card-body flex flex-1 flex-col gap-2 overflow-hidden p-4">
                <Link href={`/programs/${program.id}/sequences/${seq.id}`} className="btn btn-outline btn-sm w-full shrink-0">
                  {seq.title}
                </Link>
                <div className="flex-1 overflow-y-auto">
                  <ul className="flex flex-col gap-1 text-sm text-base-content/60">
                    {songs.slice(0, PREVIEW_COUNT).map((s, i) => (
                      <li key={s.id}>{i + 1}. {s.title}</li>
                    ))}
                  </ul>
                  {remaining > 0 && (
                    <p className="pt-1 text-xs italic text-base-content/40">+{remaining} ακόμα…</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {program.sequences.length === 0 && (
          <p className="col-span-full p-3 text-center text-sm text-base-content/50">Καμία σειρά ακόμη</p>
        )}
      </div>
    </main>
  );
}
