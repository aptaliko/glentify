import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql, { schema });

  const [user] = await db
    .insert(schema.users)
    .values({ email: `smoke-test-${Date.now()}@smoke.invalid`, passwordHash: 'smoke-placeholder', role: 'user' })
    .returning();
  const [genre] = await db.insert(schema.genres).values({ name: 'Smoke Genre' }).returning();
  const [composer] = await db.insert(schema.composers).values({ name: 'Smoke Composer' }).returning();
  const [axisType] = await db
    .insert(schema.axisTypes)
    .values({ key: 'smoke_axis', label: 'Smoke Axis', lookupTable: null, hierarchical: false })
    .returning();

  const [song] = await db
    .insert(schema.songs)
    .values({ title: 'Smoke Song', lyrics: 'la la la', ownerId: user.id })
    .returning();

  const [genreAxisValue] = await db
    .insert(schema.songAxisValues)
    .values({ songId: song.id, axisType: 'genre', refId: genre.id, yearValue: null })
    .returning();

  const [axisValue] = await db
    .insert(schema.songAxisValues)
    .values({ songId: song.id, axisType: axisType.key, refId: null, yearValue: 1950 })
    .returning();

  const [session] = await db
    .insert(schema.sessions)
    .values({ label: 'Smoke Session', currentSongId: song.id, ownerId: user.id })
    .returning();
  const [played] = await db.insert(schema.sessionPlayedSongs).values({ sessionId: session.id, songId: song.id }).returning();

  if (!user.id || !genre.id || !composer.id || !axisType.id || !song.id || !genreAxisValue.id || !axisValue.id || !session.id || !played.id) {
    throw new Error('One or more inserts did not return an id');
  }

  await db.delete(schema.sessionPlayedSongs).where(eq(schema.sessionPlayedSongs.id, played.id));
  await db.delete(schema.sessions).where(eq(schema.sessions.id, session.id));
  await db.delete(schema.songAxisValues).where(eq(schema.songAxisValues.id, axisValue.id));
  await db.delete(schema.songAxisValues).where(eq(schema.songAxisValues.id, genreAxisValue.id));
  await db.delete(schema.songs).where(eq(schema.songs.id, song.id));
  await db.delete(schema.axisTypes).where(eq(schema.axisTypes.id, axisType.id));
  await db.delete(schema.composers).where(eq(schema.composers.id, composer.id));
  await db.delete(schema.genres).where(eq(schema.genres.id, genre.id));
  await db.delete(schema.users).where(eq(schema.users.id, user.id));

  console.log('Schema smoke test passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
