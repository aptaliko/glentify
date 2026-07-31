import { readFileSync } from 'fs';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { songs } from '../src/db/schema';

interface ImportRow {
  title: string;
  lyrics: string;
}

async function main() {
  const dataPath = join(__dirname, 'data', 'nisia-import.json');
  const rows: ImportRow[] = JSON.parse(readFileSync(dataPath, 'utf-8'));

  let updated = 0;
  let notFound = 0;

  for (const row of rows) {
    const existing = await db.select().from(songs).where(eq(songs.title, row.title));
    if (!existing[0]) {
      notFound++;
      console.log('NOT FOUND:', row.title);
      continue;
    }
    if (existing[0].lyrics === row.lyrics) continue;
    await db.update(songs).set({ lyrics: row.lyrics, updatedAt: new Date() }).where(eq(songs.id, existing[0].id));
    updated++;
  }

  console.log(`Lyrics updated: ${updated}`);
  console.log(`Not found: ${notFound}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
