import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionById, advanceToSong } from '@/db/queries/sessions';
import { getSongById } from '@/db/queries/songs';
import { getUserId } from '@/lib/requestUser';

const schema = z.object({ nextSongId: z.number().int() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = getUserId(request);
  const { id } = await params;
  const sessionId = Number(id);
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const session = await getSessionById(ownerId, sessionId);
  if (!session) return NextResponse.json({ error: 'Δεν βρέθηκε session' }, { status: 404 });
  // advanceToSong doesn't validate nextSongId ownership, so without this check a caller could
  // advance their own session onto another user's song.
  const nextSong = await getSongById(ownerId, parsed.data.nextSongId);
  if (!nextSong) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  await advanceToSong(sessionId, parsed.data.nextSongId);
  return NextResponse.json({ ok: true });
}
