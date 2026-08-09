// src/app/api/programs/[id]/sequences/[seqId]/songs/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getProgramById, getSequenceById, addSongToSequence, reorderSequenceSongs } from '@/db/queries/programs';
import { getSongById } from '@/db/queries/songs';
import { getUserId } from '@/lib/requestUser';

const addSchema = z.object({ songId: z.number().int() });
const reorderSchema = z.object({ orderedIds: z.array(z.number().int()) });

async function assertOwnsSequence(ownerId: number, programId: number, seqId: number): Promise<boolean> {
  const program = await getProgramById(ownerId, programId);
  if (!program) return false;
  const sequence = await getSequenceById(seqId);
  return sequence !== undefined && sequence.programId === programId;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; seqId: string }> }) {
  const ownerId = getUserId(request);
  const { id, seqId } = await params;
  if (!(await assertOwnsSequence(ownerId, Number(id), Number(seqId)))) {
    return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  }
  const parsed = addSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  // addSongToSequence doesn't validate songId ownership, so without this check a caller could
  // graft another user's song into their own sequence and read it back via GET on the sequence.
  const song = await getSongById(ownerId, parsed.data.songId);
  if (!song) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  await addSongToSequence(Number(seqId), parsed.data.songId);
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; seqId: string }> }) {
  const ownerId = getUserId(request);
  const { id, seqId } = await params;
  if (!(await assertOwnsSequence(ownerId, Number(id), Number(seqId)))) {
    return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  }
  const parsed = reorderSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  await reorderSequenceSongs(Number(seqId), parsed.data.orderedIds);
  return NextResponse.json({ ok: true });
}
