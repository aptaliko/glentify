import { readFileSync } from 'fs';
import { join } from 'path';
import { eq, and } from 'drizzle-orm';
import { db } from '../src/db/client';
import { songs, songAxisValues, users } from '../src/db/schema';
import { findOrCreateGenre, findOrCreateRhythm, findOrCreateComposer } from './lib/seed-helpers';

interface ImportRow {
  title: string;
  lyrics: string | null;
  rhythm: string | null;
  composer: string | null;
  year: number | null;
}

function normalizeTitle(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[’‘]/g, "'") // curly quotes -> straight
    .replace(/_/g, "'")
    .replace(/[^a-z0-9Ͱ-Ͽ' ]/g, ' ') // keep basic Greek block
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const fileName = process.argv[2] || 'rebetika-import.json';
  const dataPath = join(__dirname, 'data', fileName);
  const rows: ImportRow[] = JSON.parse(readFileSync(dataPath, 'utf-8'));
  console.log(`Reading ${rows.length} rows from ${fileName}`);

  // Multi-user import: attribute everything this script inserts to the admin account, so it
  // joins the shared suggestion-pool repertoire like the rest of the pre-existing songs (see
  // scripts/migrate-to-multiuser.ts). Requires exactly one admin to exist already.
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).limit(1);
  if (!admin) {
    console.error('No admin user found. Run scripts/migrate-to-multiuser.ts first.');
    process.exit(1);
  }

  const genreId = await findOrCreateGenre('Ρεμπέτικο');

  const existing = await db
    .select({ title: songs.title })
    .from(songs)
    .where(and(eq(songs.genreId, genreId), eq(songs.ownerId, admin.id)));
  const existingNorm = new Set(existing.map((s) => normalizeTitle(s.title)));

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const key = normalizeTitle(row.title);
    if (existingNorm.has(key)) {
      skipped++;
      continue;
    }
    try {
      const [song] = await db
        .insert(songs)
        .values({ ownerId: admin.id, title: row.title, lyrics: row.lyrics, genreId })
        .returning();

      if (row.rhythm) {
        const rhythmId = await findOrCreateRhythm(row.rhythm);
        await db.insert(songAxisValues).values({ songId: song.id, axisType: 'rhythm', refId: rhythmId, yearValue: null });
      }
      if (row.composer) {
        const composerId = await findOrCreateComposer(row.composer);
        await db.insert(songAxisValues).values({ songId: song.id, axisType: 'composer', refId: composerId, yearValue: null });
      }
      if (row.year) {
        await db.insert(songAxisValues).values({ songId: song.id, axisType: 'year', refId: null, yearValue: row.year });
      }

      existingNorm.add(key);
      inserted++;
    } catch (err) {
      failed++;
      console.error('FAILED:', row.title, err);
    }
  }

  console.log(`Inserted: ${inserted}`);
  console.log(`Skipped (already existed): ${skipped}`);
  console.log(`Failed: ${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
