'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import PageNav from '@/components/PageNav';
import { loadReferenceData } from '@/lib/offlineCache';
import { preferencesStore } from '@/lib/preferencesStore';
import { getSelectedProgramId, setSelectedSequenceId } from '@/lib/localProgramsStore';
import { sanitizeFilename } from '@/lib/pdfFilename';
import { generateProgramPdfLocal } from '@/lib/programPdfLocal';
import { getQueuedActions } from '@/lib/syncQueue';
import type { QueuedAction } from '@/lib/syncQueue';
import { buildSongTitleMap, toProgramDetail } from '@/lib/offlineProgramView';
import { mergeSequencesWithPending } from '@/lib/sequencesMerge';
import type { DisplaySequence } from '@/lib/sequencesMerge';
import type { CachedReferenceData } from '@/lib/referenceData';

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
  const [referenceData, setReferenceData] = useState<CachedReferenceData | null>(null);
  const [programId, setProgramId] = useState<number | null>(null);
  const [pendingActions, setPendingActions] = useState<QueuedAction[]>([]);
  const [checked, setChecked] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [data, id, actions] = await Promise.all([
      loadReferenceData(),
      getSelectedProgramId(preferencesStore),
      getQueuedActions(),
    ]);
    setReferenceData(data);
    setProgramId(id);
    setPendingActions(actions);
    setChecked(true);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // Post-sync freshness: the overlay is computed at read time, but if the queue drains and
    // the blob re-primes (SyncQueueProvider, on reconnect) while this page is open, the page
    // keeps showing the read-time snapshot. Re-read whenever the app returns to the foreground
    // so a just-synced change appears without a manual "Προετοιμασία για offline". Scoped to
    // this overview only — the sequence viewer holds live index/exploration state a refresh
    // would reset, so it stays mount-only per the spec.
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  async function handleSelectSequence(sequence: DisplaySequence) {
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
    } catch (err) {
      // The generic Greek message is what the user sees; the real cause (this is the first
      // on-device execution of pdfkit's browser build + Filesystem/Share — see
      // programPdfLocal.ts and the mobile-roadmap's "sharper on-device risk framing") goes to
      // the console so it's visible via chrome://inspect or logcat while diagnosing.
      console.error('PDF export failed:', err);
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

  // A blob primed before the `entries` field existed carries `primedAt === null` and empty
  // `entries` (backfilled by normalizeReferenceData); rendering the overlay off those empty
  // entries would show empty σειρές. Match the editor's contract and ask for a re-prime
  // instead — the next prime rewrites the blob with real entries + primedAt.
  if (referenceData.primedAt === null) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <PageNav backHref="/programs/local" />
        <p className="text-lg">
          Απαιτείται προετοιμασία για offline για να εμφανιστεί αυτό το πρόγραμμα.{' '}
          <Link href="/" className="link">Προετοιμασία για offline</Link>
        </p>
      </main>
    );
  }

  const songTitles = buildSongTitleMap(referenceData.songs, referenceData.sharedSongs);
  const displaySequences: DisplaySequence[] = mergeSequencesWithPending(
    toProgramDetail(program, songTitles),
    pendingActions,
    songTitles,
  );

  const pdfSequences = displaySequences.map((seq) => ({
    title: seq.title,
    songs: seq.songs.map((s) => s.title),
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
        {displaySequences.map((seq) => {
          const isPending = seq.status === 'pending-create';
          const songs = seq.songs;
          const remaining = songs.length - PREVIEW_COUNT;
          return (
            <div key={seq.id} className="card flex h-72 flex-col bg-base-100 shadow">
              <div className="card-body flex flex-1 flex-col gap-2 overflow-hidden p-4">
                {isPending ? (
                  <span className="btn btn-outline btn-sm w-full shrink-0 no-animation pointer-events-none opacity-70">
                    {seq.title} (εκκρεμεί)
                  </span>
                ) : (
                  <button onClick={() => handleSelectSequence(seq)} className="btn btn-outline btn-sm w-full shrink-0">
                    {seq.title}
                  </button>
                )}
                <div className="flex-1 overflow-y-auto">
                  <ul className="flex flex-col gap-1 text-sm text-base-content/60">
                    {songs.slice(0, PREVIEW_COUNT).map((s, i) => (
                      <li key={s.sequenceSongId}>{i + 1}. {s.title}</li>
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
        {displaySequences.length === 0 && (
          <p className="col-span-full p-3 text-center text-sm text-base-content/50">Καμία σειρά ακόμη</p>
        )}
      </div>
    </main>
  );
}
