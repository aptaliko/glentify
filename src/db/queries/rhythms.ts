import { db } from '../client';
import { rhythms, songAxisValues } from '../schema';
import { eq, and } from 'drizzle-orm';
import type { RhythmRow } from '../schema';

export async function listRhythms(): Promise<RhythmRow[]> {
  return db.select().from(rhythms);
}

export async function createRhythm(data: { name: string }): Promise<RhythmRow> {
  const rows = await db.insert(rhythms).values(data).returning();
  return rows[0];
}

export async function updateRhythm(id: number, data: { name: string }): Promise<RhythmRow> {
  const rows = await db.update(rhythms).set(data).where(eq(rhythms.id, id)).returning();
  return rows[0];
}

export async function deleteRhythm(id: number): Promise<void> {
  const [songUsage] = await db
    .select({ id: songAxisValues.id })
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'rhythm'), eq(songAxisValues.refId, id)))
    .limit(1);
  if (songUsage) throw new Error('Ο ρυθμός χρησιμοποιείται από τραγούδι');
  await db.delete(rhythms).where(eq(rhythms.id, id));
}
