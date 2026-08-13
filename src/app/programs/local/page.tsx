'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageNav from '@/components/PageNav';
import { loadReferenceData } from '@/lib/offlineCache';
import { preferencesStore } from '@/lib/preferencesStore';
import { setSelectedProgramId } from '@/lib/localProgramsStore';
import type { ReferenceData, OfflineProgram } from '@/lib/referenceData';

export default function LocalProgramsPage() {
  const router = useRouter();
  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  const [checkedCache, setCheckedCache] = useState(false);

  useEffect(() => {
    loadReferenceData()
      .then(setReferenceData)
      .finally(() => setCheckedCache(true));
  }, []);

  async function handleSelect(program: OfflineProgram) {
    await setSelectedProgramId(preferencesStore, program.id);
    router.push('/programs/local/program');
  }

  if (!checkedCache) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref="/" />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  if (!referenceData) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <PageNav backHref="/" />
        <p className="text-lg">Δεν υπάρχουν αποθηκευμένα τραγούδια στη συσκευή.</p>
        <Link href="/" className="btn btn-primary">
          Πήγαινε στην αρχική για συγχρονισμό
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <PageNav backHref="/" />
      <h1 className="text-2xl font-bold">Σταθερά προγράμματα</h1>
      <div className="card w-full max-w-md bg-base-100 shadow">
        <div className="card-body gap-2">
          <ul className="flex flex-col gap-1">
            {referenceData.programs.map((p) => (
              <li key={p.id}>
                <button onClick={() => handleSelect(p)} className="btn btn-outline btn-lg w-full">
                  {p.title}
                </button>
              </li>
            ))}
            {referenceData.programs.length === 0 && (
              <li className="p-3 text-center text-sm text-base-content/50">Κανένα πρόγραμμα ακόμη</li>
            )}
          </ul>
        </div>
      </div>
    </main>
  );
}
