import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionById, getPlayedSongsGrouped } from '@/db/queries/sessions';
import { getProgramAccess, createProgramFromGroups, appendSequencesToProgram } from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';

const schema = z.discriminatedUnion('destination', [
  z.object({ destination: z.literal('new'), title: z.string().min(1), sequenceTitles: z.array(z.string().min(1)) }),
  z.object({ destination: z.literal('existing'), programId: z.number().int(), sequenceTitles: z.array(z.string().min(1)) }),
]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(request);
  const { id } = await params;
  const sessionId = Number(id);
  const session = await getSessionById(userId, sessionId);
  if (!session) return NextResponse.json({ error: 'Δεν βρέθηκε session' }, { status: 404 });
  if (session.endedAt === null) {
    return NextResponse.json({ error: 'Το session δεν έχει λήξει ακόμα' }, { status: 400 });
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const groupedSongs = await getPlayedSongsGrouped(sessionId);
  if (groupedSongs.length === 0) {
    return NextResponse.json({ error: 'Δεν παίχτηκαν τραγούδια σε αυτό το session' }, { status: 400 });
  }
  if (groupedSongs.length !== parsed.data.sequenceTitles.length) {
    return NextResponse.json({ error: 'Ο αριθμός τίτλων σειράς δεν ταιριάζει με τις σειρές του session' }, { status: 400 });
  }

  const groups = groupedSongs.map((songsInGroup, i) => ({
    title: parsed.data.sequenceTitles[i],
    songIds: songsInGroup.map((s) => s.id),
  }));

  if (parsed.data.destination === 'new') {
    const program = await createProgramFromGroups(userId, parsed.data.title, groups);
    return NextResponse.json({ programId: program.id }, { status: 201 });
  }

  const role = await getProgramAccess(userId, parsed.data.programId);
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  await appendSequencesToProgram(parsed.data.programId, groups);
  return NextResponse.json({ programId: parsed.data.programId });
}
