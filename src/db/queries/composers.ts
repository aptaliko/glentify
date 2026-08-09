import { db } from '../client';
import { composers, songAxisValues } from '../schema';
import { eq, and, or, isNull } from 'drizzle-orm';
import type { ComposerRow } from '../schema';

export async function listComposers(userId: number): Promise<ComposerRow[]> {
  return db.select().from(composers).where(or(isNull(composers.ownerId), eq(composers.ownerId, userId)));
}

export async function getComposerById(id: number): Promise<ComposerRow | undefined> {
  const rows = await db.select().from(composers).where(eq(composers.id, id));
  return rows[0];
}

export async function createComposer(data: { name: string; ownerId: number | null }): Promise<ComposerRow> {
  const rows = await db.insert(composers).values(data).returning();
  return rows[0];
}

export async function updateComposer(id: number, data: { name: string }): Promise<ComposerRow> {
  const rows = await db.update(composers).set(data).where(eq(composers.id, id)).returning();
  return rows[0];
}

export async function deleteComposer(id: number): Promise<void> {
  const [usage] = await db
    .select({ id: songAxisValues.id })
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'composer'), eq(songAxisValues.refId, id)))
    .limit(1);
  if (usage) throw new Error('Ο συνθέτης χρησιμοποιείται από τραγούδι');
  await db.delete(composers).where(eq(composers.id, id));
}
