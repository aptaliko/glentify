import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getActiveSession, createSession } from '@/db/queries/sessions';
import { getSongById } from '@/db/queries/songs';
import { getUserId } from '@/lib/requestUser';

const createSchema = z.object({ label: z.string().nullable().optional(), startingSongId: z.number().int() });

export async function GET(request: NextRequest) {
  const ownerId = getUserId(request);
  const session = await getActiveSession(ownerId);
  return NextResponse.json(session ?? null);
}

export async function POST(request: NextRequest) {
  const ownerId = getUserId(request);
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  // createSession doesn't validate startingSongId ownership, so without this check a caller
  // could start a session referencing another user's song.
  const startingSong = await getSongById(ownerId, parsed.data.startingSongId);
  if (!startingSong) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const session = await createSession(ownerId, parsed.data.label ?? null, parsed.data.startingSongId);
  return NextResponse.json(session, { status: 201 });
}
