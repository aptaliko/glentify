import { db } from '../src/db/client';
import { songs, songAxisValues } from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const allSongs = await db.select({ id: songs.id, genreId: songs.genreId }).from(songs);
  let created = 0;
  let skipped = 0;

  for (const song of allSongs) {
    const existing = await db
      .select({ id: songAxisValues.id })
      .from(songAxisValues)
      .where(eq(songAxisValues.songId, song.id));
    const hasGenreAxis = existing.length > 0
      ? (await db.select().from(songAxisValues).where(eq(songAxisValues.songId, song.id))).some(
          (row) => row.axisType === 'genre'
        )
      : false;
    if (hasGenreAxis) {
      skipped++;
      continue;
    }
    await db.insert(songAxisValues).values({ songId: song.id, axisType: 'genre', refId: song.genreId, yearValue: null });
    created++;
  }

  console.log(`Backfilled genre axis for ${created} songs, skipped ${skipped} that already had one.`);

  const [{ count: totalSongs }] = await db.select({ count: songs.id }).from(songs).then((rows) => [{ count: rows.length }]);
  const genreAxisRows = await db.select({ songId: songAxisValues.songId }).from(songAxisValues).where(eq(songAxisValues.axisType, 'genre'));
  const distinctSongsWithGenre = new Set(genreAxisRows.map((r) => r.songId)).size;
  console.log(`Verification: ${totalSongs} total songs, ${distinctSongsWithGenre} now have a genre axis value.`);
  if (totalSongs !== distinctSongsWithGenre) {
    console.error('MISMATCH — do not proceed to drop the songs.genreId column until this is 0.');
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
