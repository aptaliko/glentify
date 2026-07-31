import { db } from '../client';
import { dromoi, songAxisValues } from '../schema';
import { eq, and } from 'drizzle-orm';
import type { DromosRow } from '../schema';

export async function listDromoi(): Promise<DromosRow[]> {
  return db.select().from(dromoi);
}

export async function createDromos(data: { name: string }): Promise<DromosRow> {
  const rows = await db.insert(dromoi).values(data).returning();
  return rows[0];
}

export async function updateDromos(id: number, data: { name: string }): Promise<DromosRow> {
  const rows = await db.update(dromoi).set(data).where(eq(dromoi.id, id)).returning();
  return rows[0];
}

export async function deleteDromos(id: number): Promise<void> {
  const [songUsage] = await db
    .select({ id: songAxisValues.id })
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'dromos'), eq(songAxisValues.refId, id)))
    .limit(1);
  if (songUsage) throw new Error('Ο δρόμος χρησιμοποιείται από τραγούδι');
  await db.delete(dromoi).where(eq(dromoi.id, id));
}
