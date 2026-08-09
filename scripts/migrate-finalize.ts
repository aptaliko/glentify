import { drizzle } from 'drizzle-orm/neon-http';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { migrate } from 'drizzle-orm/neon-http/migrator';

// Applies migration 0008 (owner_id NOT NULL tightening on programs/sessions/songs), which is kept
// out of the normal `./drizzle` folder / `db:migrate` run on purpose. On a database with
// pre-existing rows, 0008 must only run AFTER `db:migrate-to-multiuser` has backfilled owner_id on
// every row — running it any earlier fails the NOT NULL constraint. See README.md for the required
// setup order: db:migrate -> db:migrate-to-multiuser -> db:migrate:finalize.
//
// Note for whoever next runs `db:generate`: it will write a fresh `drizzle/meta/0008_snapshot.json`
// (idx = last journal entry's idx + 1 = 8), which overwrites the one deliberately left behind here
// to keep drizzle-kit's diff base in sync with `owner_id` already being NOT NULL in schema.ts. The
// new snapshot still encodes NOT NULL (it's diffed off schema.ts), so future diffs stay correct —
// but if a real `0008_*.sql` reappears in `./drizzle` alongside this folder's `0008_misty_sersi.sql`,
// don't be alarmed by the duplicate index: `drizzle-orm`'s migrator orders/dedupes by each
// migration's recorded timestamp, not by the numeric prefix, so both apply correctly regardless.
//
// Guard below: the shared `drizzle.__drizzle_migrations` table (not the folder split) is what the
// migrator actually uses to decide whether to (re)apply 0008 — it skips any migration whose
// timestamp is <= the latest already-recorded row's timestamp. If a future `./drizzle` migration
// (e.g. 0009) is applied by `db:migrate` before this script runs, its later timestamp becomes the
// new "latest", which would make the migrator skip 0008 as already-superseded even on a fresh
// database that never actually got the NOT NULL constraint applied. Fail loudly instead of leaving
// silent nullable columns on a fresh database.
async function assertOwnerIdNotNull(sql: NeonQueryFunction<false, false>): Promise<void> {
  const rows = (await sql`
    SELECT table_name, is_nullable FROM information_schema.columns
    WHERE table_name IN ('songs', 'programs', 'sessions') AND column_name = 'owner_id'
  `) as { table_name: string; is_nullable: string }[];
  const stillNullable = rows.filter((r) => r.is_nullable === 'YES').map((r) => r.table_name);
  if (stillNullable.length > 0) {
    throw new Error(
      `owner_id is still nullable on: ${stillNullable.join(', ')}. The finalize migration did not ` +
        `apply (likely skipped as already-superseded by a later migration's timestamp — see comment ` +
        `above). Investigate drizzle.__drizzle_migrations before proceeding.`
    );
  }
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: './drizzle-finalize' });
  await assertOwnerIdNotNull(sql);
  console.log('Finalize migration applied successfully');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
