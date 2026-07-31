import { db } from '../client';
import { songAxisValues, axisTypes } from '../schema';
import { eq, inArray } from 'drizzle-orm';
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
