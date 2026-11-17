import { db } from '../client';
import { dromoi, songAxisValues } from '../schema';
import { eq, and, or, isNull } from 'drizzle-orm';
import type { DromosRow } from '../schema';

export async function listDromoi(userId: number): Promise<DromosRow[]> {
  return db.select().from(dromoi).where(or(isNull(dromoi.ownerId), eq(dromoi.ownerId, userId)));
}

export async function getDromosById(id: number): Promise<DromosRow | undefined> {
  const rows = await db.select().from(dromoi).where(eq(dromoi.id, id));
  return rows[0];
}

export async function createDromos(data: { name: string; ownerId: number | null }): Promise<DromosRow> {
  const rows = await db.insert(dromoi).values(data).returning();
  return rows[0];
}

export async function updateDromos(id: number, data: { name: string }): Promise<DromosRow> {
  const rows = await db.update(dromoi).set(data).where(eq(dromoi.id, id)).returning();
  return rows[0];
}

export async function deleteDromos(id: number): Promise<void> {
  // Songs that used this value lose it; the songs themselves stay. One batch = one transaction.
  await db.batch([
    db.delete(songAxisValues).where(and(eq(songAxisValues.axisType, 'dromos'), eq(songAxisValues.refId, id))),
    db.delete(dromoi).where(eq(dromoi.id, id)),
  ]);
}
