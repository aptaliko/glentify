import { db } from '../client';
import { dances, songAxisValues } from '../schema';
import { eq, and, or, isNull } from 'drizzle-orm';
import type { DanceRow } from '../schema';

export async function listDances(userId: number): Promise<DanceRow[]> {
  return db.select().from(dances).where(or(isNull(dances.ownerId), eq(dances.ownerId, userId)));
}

export async function getDanceById(id: number): Promise<DanceRow | undefined> {
  const rows = await db.select().from(dances).where(eq(dances.id, id));
  return rows[0];
}

export async function createDance(data: { name: string; ownerId: number | null }): Promise<DanceRow> {
  const rows = await db.insert(dances).values(data).returning();
  return rows[0];
}

export async function updateDance(id: number, data: { name: string }): Promise<DanceRow> {
  const rows = await db.update(dances).set(data).where(eq(dances.id, id)).returning();
  return rows[0];
}

export async function deleteDance(id: number): Promise<void> {
  const [songUsage] = await db
    .select({ id: songAxisValues.id })
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'dance'), eq(songAxisValues.refId, id)))
    .limit(1);
  if (songUsage) throw new Error('Ο χορός χρησιμοποιείται από τραγούδι');
  await db.delete(dances).where(eq(dances.id, id));
}
