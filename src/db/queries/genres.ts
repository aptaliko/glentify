import { db } from '../client';
import { genres, songs } from '../schema';
import { eq } from 'drizzle-orm';
import type { GenreRow } from '../schema';

export async function listGenres(): Promise<GenreRow[]> {
  return db.select().from(genres);
}

export async function createGenre(data: { name: string }): Promise<GenreRow> {
  const rows = await db.insert(genres).values(data).returning();
  return rows[0];
}

export async function updateGenre(id: number, data: { name: string }): Promise<GenreRow> {
  const rows = await db.update(genres).set(data).where(eq(genres.id, id)).returning();
  return rows[0];
}

export async function deleteGenre(id: number): Promise<void> {
  const [songUsage] = await db.select({ id: songs.id }).from(songs).where(eq(songs.genreId, id)).limit(1);
  if (songUsage) throw new Error('Το είδος χρησιμοποιείται από τραγούδι');
  await db.delete(genres).where(eq(genres.id, id));
}
