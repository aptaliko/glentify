// scripts/migrate-to-multiuser.ts
import { db } from '../src/db/client';
import { songs, programs, sessions } from '../src/db/schema';
import { isNull, eq } from 'drizzle-orm';
import { createUser, getUserByEmail } from '../src/db/queries/users';
import { hashPassword } from '../src/lib/passwordHash';

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD env vars before running this script.');
    process.exit(1);
  }

  let admin = await getUserByEmail(email);
  if (!admin) {
    admin = await createUser({ email, passwordHash: hashPassword(password), role: 'admin' });
    console.log(`Created admin user #${admin.id} (${admin.email})`);
  } else {
    console.log(`Admin user #${admin.id} (${admin.email}) already exists, reusing it`);
  }

  const [songsUpdated, programsUpdated, sessionsUpdated] = await Promise.all([
    db.update(songs).set({ ownerId: admin.id }).where(isNull(songs.ownerId)).returning({ id: songs.id }),
    db.update(programs).set({ ownerId: admin.id }).where(isNull(programs.ownerId)).returning({ id: programs.id }),
    db.update(sessions).set({ ownerId: admin.id }).where(isNull(sessions.ownerId)).returning({ id: sessions.id }),
  ]);

  console.log(`Backfilled ownerId on ${songsUpdated.length} songs, ${programsUpdated.length} programs, ${sessionsUpdated.length} sessions`);
  // Explicit no-op read to keep eq imported for future targeted backfills without an unused-import lint error.
  void eq;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
