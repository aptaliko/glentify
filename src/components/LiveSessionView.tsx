'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import PageNav from '@/components/PageNav';
import SongPicker from '@/components/SongPicker';
import SuggestionFilters from '@/components/SuggestionFilters';
import type { SessionStore } from '@/lib/sessionStore';
import type { SuggestionsResponsePayload, SuggestedSong, FilterValue } from '@/lib/suggestions';
import type { SongPickerDataSource } from '@/lib/songPickerData';
import { preferencesStore } from '@/lib/preferencesStore';
import {
  loadFontScale,
  saveFontScale,
  stepFontScale,
  loadStageMode,
  saveStageMode,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
} from '@/lib/lyricsReaderSettings';
import { useKeepScreenAwake } from '@/lib/useKeepScreenAwake';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { selectStackBlocks, type StackBlock } from '@/lib/stackBlocks';

// pdf.js needs the browser and its worker file; load it only on the client.
const PdfPages = dynamic(() => import('@/components/PdfPages'), { ssr: false });

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

const VIEW_OPTIONS: Record<StackBlock, { icon: string; label: string }> = {
  image: { icon: '🎼', label: 'Παρτιτούρα' },
  pdf: { icon: '📄', label: 'PDF' },
  lyrics: { icon: '📝', label: 'Στίχοι' },
};

function LyricsCard({
  lyrics,
  imageUrl,
  pdfUrl,
  maleKey,
  femaleKey,
  scrollRef,
  stageMode,
  onToggleStageMode,
}: {
  lyrics: string | null;
  imageUrl: string | null;
  pdfUrl: string | null;
  maleKey: string | null;
  femaleKey: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  stageMode: boolean;
  onToggleStageMode: () => void;
}) {
  // null until the persisted scale resolves — avoids a first-paint size jump on stage
  const [scale, setScale] = useState<number | null>(null);
  const [chosenView, setChosenView] = useState<StackBlock | null>(null);

  useEffect(() => {
    let alive = true;
    loadFontScale(preferencesStore).then((s) => {
      if (alive) setScale(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  function adjust(direction: 1 | -1) {
    setScale((current) => {
      const next = stepFontScale(current ?? 1, direction);
      void saveFontScale(preferencesStore, next);
      return next;
    });
  }

  function page(direction: 1 | -1) {
    const el = scrollRef.current;
    if (!el) return;
    // 0.85 of the visible height overlaps pages by ~15% so no line is bisected across a turn
    el.scrollBy({ top: direction * el.clientHeight * 0.85, behavior: 'smooth' });
  }

  const blocks = selectStackBlocks({ imageUrl, pdfUrl, lyrics });
  // One view at a time. The chosen view carries over to the next song when that song has it;
  // otherwise the first available view (image, PDF, lyrics) shows.
  const selected: StackBlock | null = blocks.length === 0 ? null : chosenView && blocks.includes(chosenView) ? chosenView : blocks[0];

  function renderBlock(block: StackBlock) {
    if (block === 'image') {
      // Pinch/wheel to zoom, drag to pan; double-tap resets. `touch-none` keeps
      // the WebView from hijacking the pinch/pan gesture for page scroll.
      return (
        <TransformWrapper doubleClick={{ mode: 'reset' }} minScale={1} centerOnInit>
          <TransformComponent wrapperClass="!w-full !max-h-[70vh] touch-none" contentClass="!w-full !justify-center">
            <img src={imageUrl ?? undefined} alt="Παρτιτούρα" className="max-h-[70vh] w-auto object-contain" />
          </TransformComponent>
        </TransformWrapper>
      );
    }
    if (block === 'pdf') {
      return (
        <div className="max-h-[70vh] overflow-y-auto">
          <PdfPages url={pdfUrl ?? ''} />
        </div>
      );
    }
    // lyrics
    return (
      <>
        <div className="absolute right-2 top-2 z-10 flex gap-1">
          <button
            type="button"
            aria-label={stageMode ? 'Έξοδος από τη λειτουργία σκηνής' : 'Λειτουργία σκηνής'}
            aria-pressed={stageMode}
            onClick={onToggleStageMode}
            className={`btn btn-circle btn-sm ${stageMode ? 'btn-primary' : 'btn-outline'}`}
          >
            🎤
          </button>
          <button
            type="button"
            aria-label="Μικρότερα γράμματα"
            onClick={() => adjust(-1)}
            disabled={scale !== null && scale <= FONT_SCALE_MIN}
            className="btn btn-circle btn-sm btn-outline"
          >
            A−
          </button>
          <button
            type="button"
            aria-label="Μεγαλύτερα γράμματα"
            onClick={() => adjust(1)}
            disabled={scale !== null && scale >= FONT_SCALE_MAX}
            className="btn btn-circle btn-sm btn-outline"
          >
            A+
          </button>
        </div>
        <div ref={scrollRef} className={stageMode ? 'max-h-[86vh] overflow-y-auto' : 'max-h-[70vh] overflow-y-auto'}>
          {scale === null ? (
            <div className="min-h-[8rem]" aria-hidden />
          ) : (
            <pre
              className={`mx-auto max-w-[50ch] whitespace-pre-wrap text-left font-sans leading-relaxed text-base-content ${
                stageMode ? 'font-semibold' : ''
              }`}
              style={{ fontSize: `${scale * 1.5}rem` }}
            >
              {lyrics}
            </pre>
          )}
        </div>
        <button
          type="button"
          aria-label="Προηγούμενη σελίδα στίχων"
          onClick={() => page(-1)}
          className="absolute inset-x-0 top-0 h-[20%] cursor-pointer bg-transparent"
        />
        <button
          type="button"
          aria-label="Επόμενη σελίδα στίχων"
          onClick={() => page(1)}
          className="absolute inset-x-0 bottom-0 h-[20%] cursor-pointer bg-transparent"
        />
      </>
    );
  }

  return (
    <div
      className={`relative flex flex-col gap-3 bg-base-100 ${
        stageMode ? 'p-2' : 'card p-6 shadow sm:p-8'
      }`}
    >
      {!stageMode && <KeyBadges maleKey={maleKey} femaleKey={femaleKey} />}
      {/* Icon row only when more than one view exists; a single view needs no switcher. */}
      {blocks.length > 1 && (
        <div role="group" aria-label="Προβολή" className="relative z-10 flex justify-center gap-2">
          {blocks.map((block) => (
            <button
              key={block}
              type="button"
              aria-label={VIEW_OPTIONS[block].label}
              title={VIEW_OPTIONS[block].label}
              aria-pressed={selected === block}
              onClick={() => setChosenView(block)}
              className={`btn btn-circle btn-sm text-base ${selected === block ? 'btn-primary' : 'btn-outline'}`}
            >
              <span aria-hidden="true">{VIEW_OPTIONS[block].icon}</span>
            </button>
          ))}
        </div>
      )}
      {selected && renderBlock(selected)}
      {blocks.length === 0 && (
        <p className="text-lg italic text-base-content/50">Δεν έχουν προστεθεί ακόμη στίχοι ή παρτιτούρα για αυτό το τραγούδι.</p>
      )}
    </div>
  );
}

export default function LiveSessionView({
  store,
  onEnded,
  songPickerDataSource,
  endSessionLabel = 'Λήξη session',
  sameRouteExit = false,
}: {
  store: SessionStore;
  onEnded: () => void;
  songPickerDataSource?: SongPickerDataSource;
  /** Label for the header's end-of-session button. Defaults to "Λήξη session"; a fixed-program
   * exploration overrides this to "Πίσω στο πρόγραμμα" since there's no real session to end
   * there — `onEnded` still fires exactly the same either way. */
  endSessionLabel?: string;
  /** True when this view is rendered inline at the caller's own route (e.g. a fixed program's
   * "explore from a suggestion" mode) rather than a dedicated session page — there is no
   * different route to go "back" to. Makes the header's back arrow act exactly like the
   * end-session button instead of a Link to "/", which would be a no-op at the same URL and
   * could otherwise strand the user with no way out once `data.currentSong` is null. */
  sameRouteExit?: boolean;
}) {
  useKeepScreenAwake();

  const [data, setData] = useState<SuggestionsResponsePayload | null>(null);
  const [showPlayed, setShowPlayed] = useState(false);
  // null until the user changes a chip; then the user's list replaces the song's defaults.
  const [filterOverride, setFilterOverride] = useState<FilterValue[] | null>(null);
  const [openAxes, setOpenAxes] = useState<string[]>([]);
  const [stageMode, setStageMode] = useState(false);
  const lyricsScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    loadStageMode(preferencesStore).then((on) => {
      if (alive) setStageMode(on);
    });
    return () => {
      alive = false;
    };
  }, []);

  function toggleStageMode() {
    setStageMode((current) => {
      const next = !current;
      void saveStageMode(preferencesStore, next);
      return next;
    });
  }

  const load = useCallback(async () => {
    setData(await store.load(showPlayed, filterOverride));
  }, [store, showPlayed, filterOverride]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function handleFiltersChange(filters: FilterValue[], nextOpenAxes: string[]) {
    setFilterOverride(filters);
    setOpenAxes(nextOpenAxes);
  }

  async function handlePick(songId: number) {
    await store.pickSong(songId);
    setFilterOverride(null);
    setOpenAxes([]);
    await load();
  }

  async function handleEndSequence() {
    await store.endSequence();
    setFilterOverride(null);
    setOpenAxes([]);
    await load();
  }

  async function handleEndSession() {
    await store.endSession();
    onEnded();
  }

  if (!data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref="/" onBack={sameRouteExit ? handleEndSession : undefined} />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  if (!data.currentSong) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
        <PageNav backHref="/" onBack={sameRouteExit ? handleEndSession : undefined} />
        <h1 className="text-2xl font-bold">Διάλεξε τραγούδι για να συνεχίσεις</h1>
        <SongPicker onSelect={handlePick} dataSource={songPickerDataSource} />
      </main>
    );
  }

  const currentSong = data.currentSong;

  return (
    <main className="flex min-h-screen flex-col bg-base-200">
      <header className="sticky top-0 z-10 flex flex-col items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-3 sm:px-6">
        <PageNav backHref="/" onBack={sameRouteExit ? handleEndSession : undefined} />
        <div className="flex flex-wrap items-center justify-center gap-2">
          {!stageMode && (
            <>
              <label className="label cursor-pointer gap-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={showPlayed}
                  onChange={(e) => setShowPlayed(e.target.checked)}
                />
                <span className="label-text">Δείξε τα ειπωμένα</span>
              </label>
              <SuggestionFilters
                axes={data.axes}
                appliedFilters={filterOverride ?? data.appliedFilters}
                openAxes={openAxes}
                onChange={handleFiltersChange}
              />
            </>
          )}
          <button onClick={handleEndSequence} className="btn btn-sm btn-outline">
            Τέλος σειράς
          </button>
          <button onClick={handleEndSession} className="btn btn-sm btn-error">
            {endSessionLabel}
          </button>
        </div>
        <h1 className="text-center text-xl font-bold sm:text-2xl">{currentSong.title}</h1>
      </header>

      <div className={`flex-1 ${stageMode ? 'p-0' : 'p-4 sm:p-6'}`}>
        <div
          className={`grid grid-cols-1 items-start gap-4 ${
            stageMode ? '' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]'
          }`}
        >
          <LyricsCard
            lyrics={currentSong.lyrics}
            imageUrl={currentSong.imageUrl}
            pdfUrl={currentSong.pdfUrl ?? null}
            maleKey={currentSong.maleKey}
            femaleKey={currentSong.femaleKey}
            scrollRef={lyricsScrollRef}
            stageMode={stageMode}
            onToggleStageMode={toggleStageMode}
          />
          {!stageMode && (
          <div className="card overflow-hidden bg-base-100 shadow">
            <h2 className="border-b border-base-300 bg-base-200 px-4 py-2 text-sm font-semibold tracking-wide text-base-content/70 uppercase">
              {data.mode === 'filtered' ? 'Προτάσεις' : 'Όλα τα τραγούδια'}
            </h2>
            <div className="flex max-h-[36rem] flex-col gap-1 overflow-y-auto p-2">
              {data.candidates.length === 0 ? (
                <p className="px-3 py-4 text-sm text-base-content/50">
                  {data.mode === 'filtered' ? 'Καμία πρόταση' : 'Κανένα τραγούδι'}
                </p>
              ) : (
                data.candidates.map((s) => <SongButton key={s.id} song={s} onPick={handlePick} />)
              )}
            </div>
          </div>
          )}
        </div>
      </div>
    </main>
  );
}
