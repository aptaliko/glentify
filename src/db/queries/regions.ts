import { db } from '../client';
import { regions, songAxisValues } from '../schema';
import { eq, and, or, isNull } from 'drizzle-orm';
import type { RegionRow } from '../schema';

export async function listRegions(userId: number): Promise<RegionRow[]> {
  return db.select().from(regions).where(or(isNull(regions.ownerId), eq(regions.ownerId, userId)));
}

export async function getRegionById(id: number): Promise<RegionRow | undefined> {
  const rows = await db.select().from(regions).where(eq(regions.id, id));
  return rows[0];
}

export async function createRegion(data: { name: string; parentId: number | null; ownerId: number | null }): Promise<RegionRow> {
  const rows = await db.insert(regions).values(data).returning();
  return rows[0];
}

export async function updateRegion(id: number, data: { name: string; parentId: number | null }): Promise<RegionRow> {
  const rows = await db.update(regions).set(data).where(eq(regions.id, id)).returning();
  return rows[0];
}

export async function deleteRegion(id: number): Promise<void> {
  const [songUsage] = await db
    .select({ id: songAxisValues.id })
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'region'), eq(songAxisValues.refId, id)))
    .limit(1);
  if (songUsage) throw new Error('Η περιοχή χρησιμοποιείται από τραγούδι');
  const [childRegion] = await db.select({ id: regions.id }).from(regions).where(eq(regions.parentId, id)).limit(1);
  if (childRegion) throw new Error('Η περιοχή έχει θυγατρικές περιοχές');
  await db.delete(regions).where(eq(regions.id, id));
}
