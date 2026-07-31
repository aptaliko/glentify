import { db } from '../client';
import { regions, songAxisValues, songs } from '../schema';
import { eq, and, inArray } from 'drizzle-orm';
import type { RegionRow } from '../schema';

export async function listRegions(): Promise<RegionRow[]> {
  return db.select().from(regions);
}

function findTopLevelRegionId(regionId: number, byId: Map<number, RegionRow>): number {
  let current = byId.get(regionId);
  while (current && current.parentId !== null) {
    current = byId.get(current.parentId);
  }
  return current ? current.id : regionId;
}

export async function getUsedTopLevelRegionsForGenre(genreId: number): Promise<RegionRow[]> {
  const genreSongs = await db.select({ id: songs.id }).from(songs).where(eq(songs.genreId, genreId));
  const songIds = genreSongs.map((s) => s.id);
  if (songIds.length === 0) return [];

  const [allRegions, axisRows] = await Promise.all([
    db.select().from(regions),
    db
      .select()
      .from(songAxisValues)
      .where(and(eq(songAxisValues.axisType, 'region'), inArray(songAxisValues.songId, songIds))),
  ]);

  const byId = new Map(allRegions.map((r) => [r.id, r]));
  const topLevelIds = new Set<number>();
  for (const row of axisRows) {
    if (row.refId !== null) topLevelIds.add(findTopLevelRegionId(row.refId, byId));
  }
  return allRegions.filter((r) => topLevelIds.has(r.id));
}

export async function createRegion(data: { name: string; parentId: number | null }): Promise<RegionRow> {
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
