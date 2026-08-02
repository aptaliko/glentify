import { buildSuggestionsResponse, type AxisValue, type SongWithAxes, type SuggestionsResponsePayload } from './suggestions';
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

interface LocalSessionState {
  currentSongId: number | null;
  playedSongIds: number[];
}

const SESSION_STATE_KEY = 'glentify:local-session';

export class LocalSessionStore implements SessionStore {
  constructor(private referenceData: ReferenceData, private storage: KeyValueStore) {}

  static async start(startingSongId: number, referenceData: ReferenceData, storage: KeyValueStore): Promise<LocalSessionStore> {
    const state: LocalSessionState = { currentSongId: startingSongId, playedSongIds: [] };
    await storage.set(SESSION_STATE_KEY, state);
    return new LocalSessionStore(referenceData, storage);
  }

  private async getState(): Promise<LocalSessionState> {
    return (await this.storage.get<LocalSessionState>(SESSION_STATE_KEY)) ?? { currentSongId: null, playedSongIds: [] };
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

  private markCurrentPlayed(state: LocalSessionState): number[] {
    if (state.currentSongId !== null && !state.playedSongIds.includes(state.currentSongId)) {
      return [...state.playedSongIds, state.currentSongId];
    }
    return state.playedSongIds;
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
            maleKey: currentEntry.song.maleKey,
            femaleKey: currentEntry.song.femaleKey,
            axisValues: currentEntry.axisValues,
          }
        : null,
      allSongs,
      playedSongIds: new Set(state.playedSongIds),
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
    await this.storage.set(SESSION_STATE_KEY, { currentSongId: songId, playedSongIds: this.markCurrentPlayed(state) });
  }

  async endSequence(): Promise<void> {
    const state = await this.getState();
    await this.storage.set(SESSION_STATE_KEY, { currentSongId: null, playedSongIds: this.markCurrentPlayed(state) });
  }

  async endSession(): Promise<void> {
    await this.storage.set<LocalSessionState>(SESSION_STATE_KEY, null);
  }
}

export async function hasLocalSession(storage: KeyValueStore): Promise<boolean> {
  const state = await storage.get<LocalSessionState>(SESSION_STATE_KEY);
  return state?.currentSongId != null;
}
