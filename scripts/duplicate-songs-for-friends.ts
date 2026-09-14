// One-off data script: duplicate the admin account's own Παραδοσιακό (genre id 21) + Έντεχνο
// (genre id 23) songs (~502), giving each FRIEND_EMAILS account its own independent copy (new song
// rows + copied axis values), the same way the songs are currently associated with the admin (id 2).
// Only the admin's own songs are duplicated — previous friends already hold copies. Run once, then discard.

import { db } from '../src/db/client';
import { songs, songAxisValues, users } from '../src/db/schema';
import { inArray, eq } from 'drizzle-orm';

const TARGET_GENRE_REF_IDS = [21, 23]; // Παραδοσιακό, Έντεχνο
const FRIEND_EMAILS = ['giorgkots@gmail.com'];
const ADMIN_ID = 2; // farantosgeo@gmail.com — the account whose songs are being shared

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const friends = await db.select().from(users).where(inArray(users.email, FRIEND_EMAILS.map(e => e.toLowerCase())));
  if (friends.length !== FRIEND_EMAILS.length) throw new Error(`Expected ${FRIEND_EMAILS.length} friend account(s), found ${friends.length}`);

  // Safety guard: abort if a friend already owns songs (avoid double-running this script).
  for (const friend of friends) {
    const existing = await db.select({ id: songs.id }).from(songs).where(eq(songs.ownerId, friend.id));
    if (existing.length > 0) {
      throw new Error(`Friend ${friend.email} (id ${friend.id}) already owns ${existing.length} songs — aborting to avoid duplicating the duplication.`);
    }
  }

  // Find target song ids: tagged genre = Παραδοσιακό or Έντεχνο.
  const genreRows = await db
    .select({ songId: songAxisValues.songId, refId: songAxisValues.refId })
    .from(songAxisValues)
    .where(eq(songAxisValues.axisType, 'genre'));
  const genreSongIds = [...new Set(
    genreRows.filter(r => r.refId != null && TARGET_GENRE_REF_IDS.includes(r.refId)).map(r => r.songId)
  )];

  // CRITICAL: restrict to the admin's OWN songs. Other accounts (previous friends) now hold their
  // own copies carrying the same genre tags, so filtering by genre alone would multiply the set.
  const originalSongs = (await db.select().from(songs).where(inArray(songs.id, genreSongIds)))
    .filter(s => s.ownerId === ADMIN_ID);
  const adminSongIds = originalSongs.map(s => s.id);

  const EXPECTED_TARGET_SONGS = 502;
  console.log(`Target songs (Παραδοσιακό + Έντεχνο, owned by admin ${ADMIN_ID}): ${originalSongs.length}`);
  if (originalSongs.length !== EXPECTED_TARGET_SONGS) {
    throw new Error(`Expected ${EXPECTED_TARGET_SONGS} admin-owned target songs, found ${originalSongs.length} — aborting.`);
  }

  const originalAxisValues = await db.select().from(songAxisValues).where(inArray(songAxisValues.songId, adminSongIds));

  for (const friend of friends) {
    console.log(`\n--- Duplicating for ${friend.email} (id ${friend.id}) ---`);
    const idMap = new Map<number, number>(); // old song id -> new song id

    for (const batch of chunk(originalSongs, 100)) {
      const inserted = await db
        .insert(songs)
        .values(batch.map(s => ({
          title: s.title,
          lyrics: s.lyrics,
          imageUrl: s.imageUrl,
          notes: s.notes,
          maleKey: s.maleKey,
          femaleKey: s.femaleKey,
          ownerId: friend.id,
        })))
        .returning({ id: songs.id, title: songs.title });

      if (inserted.length !== batch.length) {
        throw new Error(`Batch insert mismatch: sent ${batch.length}, got back ${inserted.length}`);
      }
      for (let i = 0; i < batch.length; i++) {
        if (inserted[i].title !== batch[i].title) {
          throw new Error(`Order mismatch at index ${i}: expected "${batch[i].title}" got "${inserted[i].title}"`);
        }
        idMap.set(batch[i].id, inserted[i].id);
      }
    }
    console.log(`  Inserted ${idMap.size} song rows.`);

    const newAxisValues = originalAxisValues
      .filter(v => idMap.has(v.songId))
      .map(v => ({
        songId: idMap.get(v.songId)!,
        axisType: v.axisType,
        refId: v.refId,
        yearValue: v.yearValue,
      }));

    let axisInserted = 0;
    for (const batch of chunk(newAxisValues, 200)) {
      await db.insert(songAxisValues).values(batch);
      axisInserted += batch.length;
    }
    console.log(`  Inserted ${axisInserted} axis value rows.`);
  }

  console.log('\nDone.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
