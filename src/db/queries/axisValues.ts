import { db } from '../client';
import { songAxisValues, axisTypes, regions, rhythms, dromoi, composers, genres, songs } from '../schema';
import { eq, inArray, or, isNull } from 'drizzle-orm';
import type { SongAxisValueRow, AxisTypeRow } from '../schema';

export async function listAxisTypes(): Promise<AxisTypeRow[]> {
  return db.select().from(axisTypes);
}

export async function getAxisValuesForSong(songId: number): Promise<SongAxisValueRow[]> {
  return db.select().from(songAxisValues).where(eq(songAxisValues.songId, songId));
}

export async function getAxisValuesForSongIds(songIds: number[]): Promise<SongAxisValueRow[]> {
  if (songIds.length === 0) return [];
  return db.select().from(songAxisValues).where(inArray(songAxisValues.songId, songIds));
}

export async function listAllAxisValues(): Promise<SongAxisValueRow[]> {
  return db.select().from(songAxisValues);
}

// Scoped equivalent of listAllAxisValues(): axis values for every song owned by ownerId, in one
// query (join, not a two-step listSongs()-then-getAxisValuesForSongIds() round trip) so callers
// that fetch this alongside several other owner-scoped lists can keep doing so inside a single
// Promise.all instead of serializing on songIds first.
export async function getAxisValuesForOwner(ownerId: number): Promise<SongAxisValueRow[]> {
  const rows = await db
    .select({
      id: songAxisValues.id,
      songId: songAxisValues.songId,
      axisType: songAxisValues.axisType,
      refId: songAxisValues.refId,
      yearValue: songAxisValues.yearValue,
    })
    .from(songAxisValues)
    .innerJoin(songs, eq(songAxisValues.songId, songs.id))
    .where(eq(songs.ownerId, ownerId));
  return rows;
}

export interface AxisValueInput {
  axisType: string;
  refId: number | null;
  yearValue: number | null;
}

export async function replaceSongAxisValues(songId: number, values: AxisValueInput[]): Promise<void> {
  await db.delete(songAxisValues).where(eq(songAxisValues.songId, songId));
  if (values.length === 0) return;
  await db.insert(songAxisValues).values(values.map((v) => ({ songId, ...v })));
}

export async function getVisibleAxisRefIds(userId: number): Promise<Map<string, Set<number>>> {
  const [regionRows, rhythmRows, dromosRows, composerRows, genreRows] = await Promise.all([
    db.select({ id: regions.id }).from(regions).where(or(isNull(regions.ownerId), eq(regions.ownerId, userId))),
    db.select({ id: rhythms.id }).from(rhythms).where(or(isNull(rhythms.ownerId), eq(rhythms.ownerId, userId))),
    db.select({ id: dromoi.id }).from(dromoi).where(or(isNull(dromoi.ownerId), eq(dromoi.ownerId, userId))),
    db.select({ id: composers.id }).from(composers).where(or(isNull(composers.ownerId), eq(composers.ownerId, userId))),
    db.select({ id: genres.id }).from(genres).where(or(isNull(genres.ownerId), eq(genres.ownerId, userId))),
  ]);
  return new Map<string, Set<number>>([
    ['region', new Set(regionRows.map((r) => r.id))],
    ['rhythm', new Set(rhythmRows.map((r) => r.id))],
    ['dromos', new Set(dromosRows.map((r) => r.id))],
    ['composer', new Set(composerRows.map((r) => r.id))],
    ['genre', new Set(genreRows.map((r) => r.id))],
  ]);
}
