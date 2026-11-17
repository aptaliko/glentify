import { db } from '../client';
import { genres, songAxisValues } from '../schema';
import { eq, or, isNull, and } from 'drizzle-orm';
import type { GenreRow } from '../schema';

export async function listGenres(userId: number): Promise<GenreRow[]> {
  return db.select().from(genres).where(or(isNull(genres.ownerId), eq(genres.ownerId, userId)));
}

export async function getGenreById(id: number): Promise<GenreRow | undefined> {
  const rows = await db.select().from(genres).where(eq(genres.id, id));
  return rows[0];
}

export async function createGenre(data: { name: string; ownerId: number | null }): Promise<GenreRow> {
  const rows = await db.insert(genres).values(data).returning();
  return rows[0];
}

export async function updateGenre(id: number, data: { name: string }): Promise<GenreRow> {
  const rows = await db.update(genres).set(data).where(eq(genres.id, id)).returning();
  return rows[0];
}

export async function deleteGenre(id: number): Promise<void> {
  // Songs that used this value lose it; the songs themselves stay. One batch = one transaction.
  await db.batch([
    db.delete(songAxisValues).where(and(eq(songAxisValues.axisType, 'genre'), eq(songAxisValues.refId, id))),
    db.delete(genres).where(eq(genres.id, id)),
  ]);
}
