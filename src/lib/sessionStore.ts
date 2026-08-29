// src/lib/sessionStore.ts
import { buildSuggestionsResponse, type AxisValue, type SongWithAxes, type SuggestionsResponsePayload } from './suggestions';
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

  private songsWithAxes(): SongWithAxes[] {
    const axisValuesBySong = new Map<number, AxisValue[]>();
    for (const av of this.referenceData.axisValues) {
      const list = axisValuesBySong.get(av.songId) ?? [];
      list.push({ axisType: av.axisType, refId: av.refId, yearValue: av.yearValue });
      axisValuesBySong.set(av.songId, list);
    }
    return this.referenceData.songs.map((song) => ({ song, axisValues: axisValuesBySong.get(song.id) ?? [] }));
  }

  private markCurrentPlayed(state: LocalSessionState): PlayedEntry[] {
    if (state.currentSongId !== null && !state.playedEntries.some((e) => e.songId === state.currentSongId)) {
      return [...state.playedEntries, { songId: state.currentSongId, sequenceIndex: state.currentSequenceIndex }];
    }
    return state.playedEntries;
  }

  async load(showPlayed: boolean, activeAxisTypes: string[] | null): Promise<SuggestionsResponsePayload> {
    const state = await this.getState();
    const allSongs = this.songsWithAxes();
    const currentEntry = state.currentSongId !== null ? allSongs.find((s) => s.song.id === state.currentSongId) : undefined;

    return buildSuggestionsResponse({
      currentSongWithAxes: currentEntry
        ? {
            id: currentEntry.song.id,
            title: currentEntry.song.title,
            lyrics: currentEntry.song.lyrics,
            imageUrl: currentEntry.song.imageUrl,
            maleKey: currentEntry.song.maleKey,
            femaleKey: currentEntry.song.femaleKey,
            axisValues: currentEntry.axisValues,
          }
        : null,
      allSongs,
      playedSongIds: new Set(state.playedEntries.map((e) => e.songId)),
      showPlayed,
      requestedActive: activeAxisTypes !== null ? new Set(activeAxisTypes) : null,
      lookups: {
        regions: this.referenceData.regions,
        rhythms: this.referenceData.rhythms,
        dromoi: this.referenceData.dromoi,
        composers: this.referenceData.composers,
        axisTypes: this.referenceData.axisTypes,
        genres: this.referenceData.genres,
      },
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
