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

export default function ProgramSequencesPage() {
  const params = useParams<{ id: string }>();
  const [program, setProgram] = useState<ProgramWithSequences | null>(null);

  useEffect(() => {
    fetch(`/api/programs/${params.id}`).then((r) => r.json()).then(setProgram);
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
          <ul className="flex flex-col gap-1">
            {program.sequences.map((seq) => (
              <li key={seq.id}>
                <Link href={`/programs/${program.id}/sequences/${seq.id}`} className="btn btn-outline btn-lg w-full">
                  {seq.title}
                </Link>
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
