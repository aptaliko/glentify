import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { regions, rhythms, dromoi, genres, composers } from '../../src/db/schema';

export async function findOrCreateRegion(name: string, parentId: number | null): Promise<number> {
  const parentCondition = parentId === null ? isNull(regions.parentId) : eq(regions.parentId, parentId);
  const existing = await db.select().from(regions).where(and(eq(regions.name, name), parentCondition));
  if (existing[0]) return existing[0].id;
  const inserted = await db.insert(regions).values({ name, parentId }).returning();
  return inserted[0].id;
}

export async function ensureRegionPath(path: string[]): Promise<number> {
  let parentId: number | null = null;
  for (const name of path) {
    parentId = await findOrCreateRegion(name, parentId);
  }
  return parentId as number;
}

export async function findOrCreateRhythm(name: string): Promise<number> {
  const existing = await db.select().from(rhythms).where(eq(rhythms.name, name));
  if (existing[0]) return existing[0].id;
  const inserted = await db.insert(rhythms).values({ name }).returning();
  return inserted[0].id;
}

export async function findOrCreateGenre(name: string): Promise<number> {
  const existing = await db.select().from(genres).where(eq(genres.name, name));
  if (existing[0]) return existing[0].id;
  const inserted = await db.insert(genres).values({ name }).returning();
  return inserted[0].id;
}

export async function findOrCreateDromos(name: string): Promise<number> {
  const existing = await db.select().from(dromoi).where(eq(dromoi.name, name));
  if (existing[0]) return existing[0].id;
  const inserted = await db.insert(dromoi).values({ name }).returning();
  return inserted[0].id;
}

export async function findOrCreateComposer(name: string): Promise<number> {
  const existing = await db.select().from(composers).where(eq(composers.name, name));
  if (existing[0]) return existing[0].id;
  const inserted = await db.insert(composers).values({ name }).returning();
  return inserted[0].id;
}
