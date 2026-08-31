// src/lib/sessionStore.ts
import {
  buildSuggestionsResponse,
  type AxisValue,
  type SongWithAxes,
  type SuggestionsResponsePayload,
  type CurrentSongPayload,
  type ReferenceLookups,
} from './suggestions';
import { groupBySequenceIndex } from './sessionGrouping';
import type { ReferenceData } from './referenceData';
import type { KeyValueStore } from './preferencesStore';

export interface SessionStore {
  load(showPlayed: boolean, activeAxisTypes: string[] | null): Promise<SuggestionsResponsePayload>;
  pickSong(songId: number): Promise<void>;
  endSequence(): Promise<void>;
  endSession(): Promise<void>;
}

export class RemoteSessionStore implements SessionStore {
  constructor(private sessionId: string) {}

  async load(showPlayed: boolean, activeAxisTypes: string[] | null): Promise<SuggestionsResponsePayload> {
    const searchParams = new URLSearchParams({ showPlayed: String(showPlayed) });
    if (activeAxisTypes !== null) searchParams.set('activeAxisTypes', activeAxisTypes.join(','));
    const res = await fetch(`/api/sessions/${this.sessionId}/suggestions?${searchParams.toString()}`);
    return res.json();
  }

  async pickSong(songId: number): Promise<void> {
    await fetch(`/api/sessions/${this.sessionId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nextSongId: songId }),
    });
  }

  async endSequence(): Promise<void> {
    await fetch(`/api/sessions/${this.sessionId}/end-sequence`, { method: 'POST' });
  }

  async endSession(): Promise<void> {
    await fetch(`/api/sessions/${this.sessionId}/end`, { method: 'POST' });
  }
}

interface PlayedEntry {
  songId: number;
  sequenceIndex: number;
}

interface LocalSessionState {
  currentSongId: number | null;
  currentSequenceIndex: number;
  playedEntries: PlayedEntry[];
}

export interface LastEndedSessionSequence {
  songIds: number[];
}

export interface LastEndedSession {
  sequences: LastEndedSessionSequence[];
}

const SESSION_STATE_KEY = 'glentify:local-session';
const LAST_ENDED_SESSION_KEY = 'glentify:local-session-last-ended';

// Shared by every local (in-browser/on-device) suggestion computation — `LocalSessionStore`,
// `ExplorationSessionStore`, and `getSequenceSuggestions` — so there's exactly one place that
// turns a `ReferenceData` blob into the shape `buildSuggestionsResponse` needs. Deliberately
// scoped to `referenceData.songs` only, never merged with `sharedSongs`: a collaborator's songs
// must never leak into a suggestion/candidate pool, matching the same boundary already
// established for the offline song picker (see `songPickerData.ts`) and the live-session
// suggestions route (both scope axis/song data to the caller's own ownership).
export function songsWithAxes(referenceData: ReferenceData): SongWithAxes[] {
  const axisValuesBySong = new Map<number, AxisValue[]>();
  for (const av of referenceData.axisValues) {
    const list = axisValuesBySong.get(av.songId) ?? [];
    list.push({ axisType: av.axisType, refId: av.refId, yearValue: av.yearValue });
    axisValuesBySong.set(av.songId, list);
  }
  return referenceData.songs.map((song) => ({ song, axisValues: axisValuesBySong.get(song.id) ?? [] }));
}

// The `currentSongWithAxes`/`lookups` shapes `buildSuggestionsResponse` expects, shared by
// every caller below so a change to either shape only needs updating in one place.
function toCurrentSongPayload(entry: SongWithAxes): CurrentSongPayload & { axisValues: AxisValue[] } {
  return {
    id: entry.song.id,
    title: entry.song.title,
    lyrics: entry.song.lyrics,
    imageUrl: entry.song.imageUrl,
    maleKey: entry.song.maleKey,
    femaleKey: entry.song.femaleKey,
    axisValues: entry.axisValues,
  };
}

function toReferenceLookups(referenceData: ReferenceData): ReferenceLookups {
  return {
    regions: referenceData.regions,
    rhythms: referenceData.rhythms,
    dromoi: referenceData.dromoi,
    composers: referenceData.composers,
    axisTypes: referenceData.axisTypes,
    genres: referenceData.genres,
  };
}

// Powers the always-visible "Προτάσεις" sidebar on a fixed program's sequence-viewing pages
// (native and web alike, both of which have a `ReferenceData` blob in hand by the time this is
// called — native from its offline cache, web from a plain `/api/reference-data` fetch). Pure
// and synchronous: given the sequence's current song and the set of song ids already in that
// sequence (excluded so the sidebar never suggests a song already visible in "Λίστα σειράς"),
// returns the same `SuggestionsResponsePayload` shape Live sessions use, reusing
// `buildSuggestionsResponse` as-is. If the current song isn't in the caller's own owner-scoped
// song list (e.g. viewing a shared program's song owned by someone else, whose axis data this
// caller has no visibility into), degrades gracefully to the same empty/no-suggestions payload
// `buildSuggestionsResponse` already returns for "no current song" — never throws.
export function getSequenceSuggestions(
  referenceData: ReferenceData,
  currentSongId: number,
  excludeSongIds: Set<number>,
  activeAxisTypes: string[] | null
): SuggestionsResponsePayload {
  const allSongs = songsWithAxes(referenceData);
  const currentEntry = allSongs.find((s) => s.song.id === currentSongId);

  return buildSuggestionsResponse({
    currentSongWithAxes: currentEntry ? toCurrentSongPayload(currentEntry) : null,
    allSongs,
    playedSongIds: excludeSongIds,
    showPlayed: false,
    requestedActive: activeAxisTypes !== null ? new Set(activeAxisTypes) : null,
    lookups: toReferenceLookups(referenceData),
  });
}

// A one-level "side trip" from a fixed program's sequence view: seeded at a tapped suggestion,
// behaves exactly like a real Live session (drill through further suggestions, toggle axes,
// Τέλος σειράς to jump to an unrelated song via the picker) but purely in memory — nothing is
// ever written to `storage`, nothing is resumable, and `endSession` intentionally does nothing:
// the page that owns this store is responsible for discarding it and navigating back to the
// fixed program on its `onEnded` callback (see `LiveSessionView`'s `sameRouteExit`/
// `endSessionLabel` props). This never touches or reflects back onto the fixed program's own
// sequence/song list.
export class ExplorationSessionStore implements SessionStore {
  private currentSongId: number | null;
  private playedSongIds = new Set<number>();

  constructor(private referenceData: ReferenceData, startingSongId: number) {
    this.currentSongId = startingSongId;
  }

  private markCurrentPlayed(): void {
    if (this.currentSongId !== null) this.playedSongIds.add(this.currentSongId);
  }

  async load(showPlayed: boolean, activeAxisTypes: string[] | null): Promise<SuggestionsResponsePayload> {
    const allSongs = songsWithAxes(this.referenceData);
    const currentEntry = this.currentSongId !== null ? allSongs.find((s) => s.song.id === this.currentSongId) : undefined;

    return buildSuggestionsResponse({
      currentSongWithAxes: currentEntry ? toCurrentSongPayload(currentEntry) : null,
      allSongs,
      playedSongIds: this.playedSongIds,
      showPlayed,
      requestedActive: activeAxisTypes !== null ? new Set(activeAxisTypes) : null,
      lookups: toReferenceLookups(this.referenceData),
    });
  }

  async pickSong(songId: number): Promise<void> {
    this.markCurrentPlayed();
    this.currentSongId = songId;
  }

  async endSequence(): Promise<void> {
    this.markCurrentPlayed();
    this.currentSongId = null;
  }

  // Deliberately does nothing — see the class comment above.
  async endSession(): Promise<void> {}
}

export class LocalSessionStore implements SessionStore {
  constructor(private referenceData: ReferenceData, private storage: KeyValueStore) {}

  static async start(startingSongId: number, referenceData: ReferenceData, storage: KeyValueStore): Promise<LocalSessionStore> {
    const state: LocalSessionState = { currentSongId: startingSongId, currentSequenceIndex: 0, playedEntries: [] };
    await storage.set(SESSION_STATE_KEY, state);
    return new LocalSessionStore(referenceData, storage);
  }

  private async getState(): Promise<LocalSessionState> {
    const defaultState: LocalSessionState = { currentSongId: null, currentSequenceIndex: 0, playedEntries: [] };
    const stored = await this.storage.get<LocalSessionState>(SESSION_STATE_KEY);
    // Defensive guard against a legacy-shaped record (from before playedEntries/currentSequenceIndex
    // existed) surviving an app update on a device with an in-flight local session. There's no
    // sequenceIndex to backfill for old play history, so there's nothing meaningful to recover —
    // treating it as "no session" (same as storage.get returning null) is safe: the user just
    // starts a new local session, rather than the app crashing on every subsequent read.
    if (stored && !Array.isArray(stored.playedEntries)) return defaultState;
    return stored ?? defaultState;
  }

  private markCurrentPlayed(state: LocalSessionState): PlayedEntry[] {
    if (state.currentSongId !== null && !state.playedEntries.some((e) => e.songId === state.currentSongId)) {
      return [...state.playedEntries, { songId: state.currentSongId, sequenceIndex: state.currentSequenceIndex }];
    }
    return state.playedEntries;
  }

  async load(showPlayed: boolean, activeAxisTypes: string[] | null): Promise<SuggestionsResponsePayload> {
    const state = await this.getState();
    const allSongs = songsWithAxes(this.referenceData);
    const currentEntry = state.currentSongId !== null ? allSongs.find((s) => s.song.id === state.currentSongId) : undefined;

    return buildSuggestionsResponse({
      currentSongWithAxes: currentEntry ? toCurrentSongPayload(currentEntry) : null,
      allSongs,
      playedSongIds: new Set(state.playedEntries.map((e) => e.songId)),
      showPlayed,
      requestedActive: activeAxisTypes !== null ? new Set(activeAxisTypes) : null,
      lookups: toReferenceLookups(this.referenceData),
    });
  }

  async pickSong(songId: number): Promise<void> {
    const state = await this.getState();
    await this.storage.set(SESSION_STATE_KEY, {
      currentSongId: songId,
      currentSequenceIndex: state.currentSequenceIndex,
      playedEntries: this.markCurrentPlayed(state),
    });
  }

  async endSequence(): Promise<void> {
    const state = await this.getState();
    await this.storage.set(SESSION_STATE_KEY, {
      currentSongId: null,
      currentSequenceIndex: state.currentSequenceIndex + 1,
      playedEntries: this.markCurrentPlayed(state),
    });
  }

  async endSession(): Promise<void> {
    const state = await this.getState();
    const finalEntries = this.markCurrentPlayed(state);
    const groups = groupBySequenceIndex(finalEntries).map((group) => ({ songIds: group.map((e) => e.songId) }));
    await this.storage.set<LastEndedSession>(LAST_ENDED_SESSION_KEY, { sequences: groups });
    await this.storage.set<LocalSessionState>(SESSION_STATE_KEY, null);
  }
}

export async function getLastEndedSession(storage: KeyValueStore): Promise<LastEndedSession | null> {
  return storage.get<LastEndedSession>(LAST_ENDED_SESSION_KEY);
}

export async function clearLastEndedSession(storage: KeyValueStore): Promise<void> {
  await storage.set<LastEndedSession>(LAST_ENDED_SESSION_KEY, null);
}

export async function hasLocalSession(storage: KeyValueStore): Promise<boolean> {
  const state = await storage.get<LocalSessionState>(SESSION_STATE_KEY);
  return state !== null;
}
