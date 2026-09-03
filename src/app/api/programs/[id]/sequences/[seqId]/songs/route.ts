// src/app/api/programs/[id]/sequences/[seqId]/songs/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getProgramAccess, getSequenceById, addSongToSequence, reorderSequenceSongs, applySequenceSongOrder, bumpSequenceVersionIfMatch } from '@/db/queries/programs';
import { getSongById } from '@/db/queries/songs';
import { getUserId } from '@/lib/requestUser';
import { parseIfMatch } from '@/lib/ifMatch';

const addSchema = z.object({ songId: z.number().int() });
const reorderSchema = z.object({ orderedIds: z.array(z.number().int()) });

async function assertSequenceAccess(userId: number, programId: number, seqId: number): Promise<boolean> {
  const role = await getProgramAccess(userId, programId);
  if (!role) return false;
  const sequence = await getSequenceById(seqId);
  return sequence !== undefined && sequence.programId === programId;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; seqId: string }> }) {
  const userId = getUserId(request);
  const { id, seqId } = await params;
  if (!(await assertSequenceAccess(userId, Number(id), Number(seqId)))) {
    return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  }
  const parsed = addSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  // addSongToSequence doesn't validate songId ownership, so without this check a caller could
  // graft another user's song into a sequence and read it back via GET on the sequence. Scoped
  // to the requester's own songs, not the program creator's — each collaborator adds from their
  // own library only (per design: reading songs already in the program is shared, picking new
  // ones to add is not).
  const song = await getSongById(userId, parsed.data.songId);
  if (!song) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const version = await addSongToSequence(Number(seqId), parsed.data.songId);
  return NextResponse.json({ ok: true, version }, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; seqId: string }> }) {
  const userId = getUserId(request);
  const { id, seqId } = await params;
  if (!(await assertSequenceAccess(userId, Number(id), Number(seqId)))) {
    return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  }
  const parsed = reorderSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const expected = parseIfMatch(request);
  if (expected !== null) {
    const newVersion = await bumpSequenceVersionIfMatch(Number(seqId), expected);
    if (newVersion === null) {
      const current = await getSequenceById(Number(seqId));
      return NextResponse.json({ error: 'Άλλαξε από συνεργάτη', version: current?.version ?? null }, { status: 409 });
    }
    await applySequenceSongOrder(Number(seqId), parsed.data.orderedIds);
    return NextResponse.json({ ok: true, version: newVersion });
  }
  await reorderSequenceSongs(Number(seqId), parsed.data.orderedIds);
  return NextResponse.json({ ok: true });
}
