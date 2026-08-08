import { db } from '../client';
import { songs, sessionPlayedSongs, sessions, songAxisValues, regions } from '../schema';
import { eq, ilike, and, inArray, type SQL } from 'drizzle-orm';
import type { SongRow, SongAxisValueRow } from '../schema';
import { replaceSongAxisValues, getAxisValuesForSong, type AxisValueInput } from './axisValues';
import { getRegionDescendantIds } from '@/lib/suggestions';

export interface SongFilters {
  search?: string;
  genreId?: number;
  regionId?: number;
}

export async function listSongs(ownerId: number, filters: SongFilters = {}): Promise<SongRow[]> {
  const conditions: SQL[] = [eq(songs.ownerId, ownerId)];
  if (filters.search) conditions.push(ilike(songs.title, `%${filters.search}%`));
  if (filters.genreId) conditions.push(eq(songs.genreId, filters.genreId));

  const results = await db.select().from(songs).where(and(...conditions));

  if (!filters.regionId) return results;

  const allRegions = await db.select().from(regions);
  const allowedRegionIds = new Set([filters.regionId, ...getRegionDescendantIds(filters.regionId, allRegions)]);
  const songIds = results.map((s) => s.id);
  if (songIds.length === 0) return [];
  const regionAxisRows = await db
    .select()
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'region'), inArray(songAxisValues.songId, songIds)));
  const matchingSongIds = new Set(
    regionAxisRows.filter((r) => r.refId !== null && allowedRegionIds.has(r.refId)).map((r) => r.songId)
  );
  return results.filter((s) => matchingSongIds.has(s.id));
}

export async function getSongById(ownerId: number, id: number): Promise<SongRow | undefined> {
  const rows = await db.select().from(songs).where(and(eq(songs.id, id), eq(songs.ownerId, ownerId)));
  return rows[0];
}

export interface SongWithAxisValues extends SongRow {
  axisValues: SongAxisValueRow[];
}

export async function getSongWithAxisValues(ownerId: number, id: number): Promise<SongWithAxisValues | undefined> {
  const song = await getSongById(ownerId, id);
  if (!song) return undefined;
  const axisValues = await getAxisValuesForSong(id);
  return { ...song, axisValues };
}

export interface SongInput {
  title: string;
  lyrics: string | null;
  imageUrl: string | null;
  genreId: number;
  notes: string | null;
  maleKey: string | null;
  femaleKey: string | null;
  axisValues: AxisValueInput[];
}

export async function createSong(ownerId: number, data: SongInput): Promise<SongRow> {
  const rows = await db
    .insert(songs)
    .values({
      ownerId,
      title: data.title,
      lyrics: data.lyrics,
      imageUrl: data.imageUrl,
      genreId: data.genreId,
      notes: data.notes,
      maleKey: data.maleKey,
      femaleKey: data.femaleKey,
    })
    .returning();
  const song = rows[0];
  await replaceSongAxisValues(song.id, data.axisValues);
  return song;
}

export async function updateSong(ownerId: number, id: number, data: SongInput): Promise<SongRow | undefined> {
  const rows = await db
    .update(songs)
    .set({
      title: data.title,
      lyrics: data.lyrics,
      imageUrl: data.imageUrl,
      genreId: data.genreId,
      notes: data.notes,
      maleKey: data.maleKey,
      femaleKey: data.femaleKey,
      updatedAt: new Date(),
    })
    .where(and(eq(songs.id, id), eq(songs.ownerId, ownerId)))
    .returning();
  if (rows.length === 0) return undefined;
  await replaceSongAxisValues(id, data.axisValues);
  return rows[0];
}

export async function deleteSong(ownerId: number, id: number): Promise<void> {
  const song = await getSongById(ownerId, id);
  if (!song) throw new Error('Το τραγούδι δεν βρέθηκε');
  const [playedUsage] = await db.select({ id: sessionPlayedSongs.id }).from(sessionPlayedSongs).where(eq(sessionPlayedSongs.songId, id)).limit(1);
  if (playedUsage) throw new Error('Το τραγούδι έχει παιχτεί σε κάποιο session και δεν μπορεί να διαγραφεί');
  const [currentUsage] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.currentSongId, id)).limit(1);
  if (currentUsage) throw new Error('Το τραγούδι είναι το τρέχον τραγούδι ενός ενεργού session');
  await db.delete(songAxisValues).where(eq(songAxisValues.songId, id));
  await db.delete(songs).where(eq(songs.id, id));
}
