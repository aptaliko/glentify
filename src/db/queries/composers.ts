import { db } from '../client';
import { composers, songAxisValues } from '../schema';
import { eq, and } from 'drizzle-orm';
import type { ComposerRow } from '../schema';

export async function listComposers(): Promise<ComposerRow[]> {
  return db.select().from(composers);
}

export async function createComposer(data: { name: string }): Promise<ComposerRow> {
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
