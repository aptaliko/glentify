'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import PageNav from '@/components/PageNav';
import { loadReferenceData } from '@/lib/offlineCache';
import { preferencesStore } from '@/lib/preferencesStore';
import { getSelectedProgramId, setSelectedSequenceId } from '@/lib/localProgramsStore';
import { mergeReferencedSongs } from '@/lib/referenceData';
import { sanitizeFilename } from '@/lib/pdfFilename';
import { generateProgramPdfLocal } from '@/lib/programPdfLocal';
import type { ReferenceData, OfflineSequence } from '@/lib/referenceData';
import type { SongRow } from '@/db/schema';

const PREVIEW_COUNT = 7;

// Filesystem.writeFile takes base64 data, not a raw Blob — this is the standard
// browser-side conversion.
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string; // "data:application/pdf;base64,XXXX"
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export default function LocalProgramPage() {
  const router = useRouter();
  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  const [programId, setProgramId] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadReferenceData(), getSelectedProgramId(preferencesStore)])
      .then(([data, id]) => {
        setReferenceData(data);
        setProgramId(id);
      })
      .finally(() => setChecked(true));
  }, []);

  async function handleSelectSequence(sequence: OfflineSequence) {
    await setSelectedSequenceId(preferencesStore, sequence.id);
    router.push('/programs/local/sequence');
  }

  async function handleExportPdf(title: string, sequences: { title: string; songs: string[] }[]) {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await generateProgramPdfLocal(title, sequences);
      const base64 = await blobToBase64(blob);
      const filename = sanitizeFilename(title);
      await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
      const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
      await Share.share({ url: uri, title });
    } catch {
      setExportError('Η εξαγωγή απέτυχε.');
    } finally {
      setExporting(false);
    }
  }

  if (!checked) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref="/programs/local" />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  const program = referenceData?.programs.find((p) => p.id === programId) ?? null;

  if (!referenceData || !program) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <PageNav backHref="/programs/local" />
        <p className="text-lg">Το πρόγραμμα δεν βρέθηκε.</p>
      </main>
    );
  }

  const songsById = new Map<number, SongRow>(
    mergeReferencedSongs(referenceData.songs, referenceData.sharedSongs).map((s) => [s.id, s])
  );

  const pdfSequences = program.sequences.map((seq) => ({
    title: seq.title,
    songs: seq.songIds
      .map((id) => songsById.get(id))
      .filter((s): s is SongRow => s !== undefined)
      .map((s) => s.title),
  }));

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <PageNav backHref="/programs/local" />
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-bold">{program.title}</h1>
        <button
          onClick={() => handleExportPdf(program.title, pdfSequences)}
          disabled={exporting}
          className="btn btn-outline btn-sm"
        >
          {exporting ? 'Εξαγωγή...' : 'Εξαγωγή PDF'}
        </button>
        {exportError && <p className="text-sm text-error">{exportError}</p>}
      </div>
      <div className="grid w-full max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
        {program.sequences.map((seq) => {
          const songs = seq.songIds.map((id) => songsById.get(id)).filter((s): s is SongRow => s !== undefined);
          const remaining = songs.length - PREVIEW_COUNT;
          return (
            <div key={seq.id} className="card flex h-72 flex-col bg-base-100 shadow">
              <div className="card-body flex flex-1 flex-col gap-2 overflow-hidden p-4">
                <button onClick={() => handleSelectSequence(seq)} className="btn btn-outline btn-sm w-full shrink-0">
                  {seq.title}
                </button>
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
