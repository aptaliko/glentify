// Local-only development seed data. Run by `npm run dev:up` after the DB is set up,
// or on its own with `npm run db:seed:dev`.
//
// Safety: refuses to run unless NEON_LOCAL=1, so it can never seed a real database.
// Idempotent: if any songs already exist it does nothing, so re-running dev:up is safe.
import '../src/db/neonConfig';
import { db } from '../src/db/client';
import {
  songs,
  songAxisValues,
  regions,
  rhythms,
  dromoi,
  programs,
  programSequences,
  sequenceSongs,
} from '../src/db/schema';
import { getUserByEmail } from '../src/db/queries/users';

const DEV_ADMIN_EMAIL = 'admin@local';

async function main() {
  if (process.env.NEON_LOCAL !== '1') {
    console.error('Refusing to seed: NEON_LOCAL is not 1. This script is for the local dev DB only.');
    process.exit(1);
  }

  const existing = await db.select({ id: songs.id }).from(songs).limit(1);
  if (existing.length > 0) {
    console.log('Songs already present — skipping dev seed.');
    return;
  }

  const admin = await getUserByEmail(DEV_ADMIN_EMAIL);
  if (!admin) {
    console.error(`No ${DEV_ADMIN_EMAIL} user found — run the migrate steps first.`);
    process.exit(1);
  }

  // Shared-baseline taxonomy rows (ownerId null = the admin-editable baseline list).
  const [makedonia, kriti, smyrni, ipiros] = await db
    .insert(regions)
    .values([
      { name: 'Μακεδονία', ownerId: null },
      { name: 'Κρήτη', ownerId: null },
      { name: 'Σμύρνη', ownerId: null },
      { name: 'Ήπειρος', ownerId: null },
    ])
    .returning();

  const [xasapiko, zeibekiko, kalamatiano, tsifteteli, syrtos] = await db
    .insert(rhythms)
    .values([
      { name: 'Χασάπικο', ownerId: null },
      { name: 'Ζεϊμπέκικο', ownerId: null },
      { name: 'Καλαματιανό', ownerId: null },
      { name: 'Τσιφτετέλι', ownerId: null },
      { name: 'Συρτός', ownerId: null },
    ])
    .returning();

  const [ousak, hitzaz, rast] = await db
    .insert(dromoi)
    .values([
      { name: 'Ουσάκ', ownerId: null },
      { name: 'Χιτζάζ', ownerId: null },
      { name: 'Ραστ', ownerId: null },
    ])
    .returning();

  // Songs (owned by the local admin) with a few axis values each. refId points into the
  // lookup table named by the axis; the `year` axis uses yearValue instead of refId.
  const seed: {
    title: string;
    lyrics: string;
    axes: { axisType: string; refId?: number; yearValue?: number }[];
  }[] = [
    {
      title: 'Φραγκοσυριανή',
      lyrics: 'Μια φούντωση, μια φλόγα\nέχω μέσα στην καρδιά…',
      axes: [
        { axisType: 'region', refId: smyrni.id },
        { axisType: 'rhythm', refId: xasapiko.id },
        { axisType: 'dromos', refId: rast.id },
        { axisType: 'year', yearValue: 1935 },
      ],
    },
    {
      title: 'Συννεφιασμένη Κυριακή',
      lyrics: 'Συννεφιασμένη Κυριακή,\nμοιάζεις με την καρδιά μου…',
      axes: [
        { axisType: 'rhythm', refId: zeibekiko.id },
        { axisType: 'dromos', refId: hitzaz.id },
        { axisType: 'year', yearValue: 1948 },
      ],
    },
    {
      title: 'Μενεξεδένια τα βουνά',
      lyrics: 'Μενεξεδένια τα βουνά\nκι ολομενεξεδένια…',
      axes: [
        { axisType: 'region', refId: ipiros.id },
        { axisType: 'rhythm', refId: syrtos.id },
      ],
    },
    {
      title: 'Χαρωπά τα δυο μου χέρια',
      lyrics: 'Χαρωπά τα δυο μου χέρια\nτα χτυπώ…',
      axes: [
        { axisType: 'region', refId: kriti.id },
        { axisType: 'rhythm', refId: kalamatiano.id },
      ],
    },
    {
      title: 'Από ξένο τόπο',
      lyrics: 'Από ξένο τόπο\nκι απ’ αλαργινό…',
      axes: [
        { axisType: 'region', refId: smyrni.id },
        { axisType: 'rhythm', refId: tsifteteli.id },
        { axisType: 'dromos', refId: ousak.id },
      ],
    },
    {
      title: 'Γεννήθηκα για να πονώ',
      lyrics: 'Γεννήθηκα για να πονώ\nκαι πίνω για να ξεχνώ…',
      axes: [
        { axisType: 'region', refId: makedonia.id },
        { axisType: 'rhythm', refId: zeibekiko.id },
        { axisType: 'dromos', refId: hitzaz.id },
        { axisType: 'year', yearValue: 1960 },
      ],
    },
  ];

  const insertedIds: number[] = [];
  for (const s of seed) {
    const [row] = await db
      .insert(songs)
      .values({ title: s.title, lyrics: s.lyrics, ownerId: admin.id })
      .returning({ id: songs.id });
    insertedIds.push(row.id);
    await db.insert(songAxisValues).values(
      s.axes.map((a) => ({
        songId: row.id,
        axisType: a.axisType,
        refId: a.refId ?? null,
        yearValue: a.yearValue ?? null,
      }))
    );
  }

  // One small program so the program/sequence screens have something too.
  const [program] = await db
    .insert(programs)
    .values({ title: 'Δείγμα προγράμματος', ownerId: admin.id })
    .returning();
  const [sequence] = await db
    .insert(programSequences)
    .values({ programId: program.id, title: 'Πρώτη σειρά', position: 0 })
    .returning();
  await db.insert(sequenceSongs).values(
    insertedIds.slice(0, 3).map((songId, i) => ({ sequenceId: sequence.id, songId, position: i }))
  );

  console.log(
    `Seeded ${insertedIds.length} songs, taxonomy rows, and 1 program for ${DEV_ADMIN_EMAIL}.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
