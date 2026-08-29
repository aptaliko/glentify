import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSongsByIds } from '@/db/queries/songs';
import { getProgramAccess, createProgramFromGroups, appendSequencesToProgram } from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';

const sequenceSchema = z.object({
  title: z.string().min(1),
  songIds: z.array(z.number().int()).min(1),
});

const schema = z.discriminatedUnion('destination', [
  z.object({ destination: z.literal('new'), title: z.string().min(1), sequences: z.array(sequenceSchema).min(1) }),
  z.object({ destination: z.literal('existing'), programId: z.number().int(), sequences: z.array(sequenceSchema).min(1) }),
]);

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // The server has no session row to re-derive these song IDs from (unlike the old
  // save-as-program route) — they come straight from the client, so every one must be
  // verified to actually belong to the caller before anything is created.
  const allSongIds = [...new Set(parsed.data.sequences.flatMap((s) => s.songIds))];
  const songs = await getSongsByIds(allSongIds);
  const ownedIds = new Set(songs.filter((s) => s.ownerId === userId).map((s) => s.id));
  if (allSongIds.some((id) => !ownedIds.has(id))) {
    return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 400 });
  }

  const groups = parsed.data.sequences;

  if (parsed.data.destination === 'new') {
    const program = await createProgramFromGroups(userId, parsed.data.title, groups);
    return NextResponse.json({ programId: program.id }, { status: 201 });
  }

  const role = await getProgramAccess(userId, parsed.data.programId);
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  await appendSequencesToProgram(parsed.data.programId, groups);
  return NextResponse.json({ programId: parsed.data.programId });
}
