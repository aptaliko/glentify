'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

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
      <main className="flex min-h-screen items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <h1 className="text-2xl font-bold">{program.title}</h1>
      <div className="card w-full max-w-md bg-base-100 shadow">
        <div className="card-body gap-2">
          <ul className="flex flex-col gap-3">
            {program.sequences.map((seq) => (
              <li key={seq.id} className="flex flex-col gap-1">
                <Link href={`/programs/${program.id}/sequences/${seq.id}`} className="btn btn-outline btn-lg w-full">
                  {seq.title}
                </Link>
                {songsBySequence[seq.id] && songsBySequence[seq.id].length > 0 && (
                  <ul className="flex flex-wrap gap-x-3 gap-y-1 px-2 text-sm text-base-content/60">
                    {songsBySequence[seq.id].map((s, i) => (
                      <li key={s.id}>{i + 1}. {s.title}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            {program.sequences.length === 0 && <li className="p-3 text-center text-sm text-base-content/50">Καμία σειρά ακόμη</li>}
          </ul>
        </div>
      </div>
      <Link href="/programs" className="link">← Όλα τα προγράμματα</Link>
    </main>
  );
}
