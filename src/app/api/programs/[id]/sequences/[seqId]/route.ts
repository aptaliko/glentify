// src/app/api/programs/[id]/sequences/[seqId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getProgramById, getSequenceById, updateSequence, deleteSequence, listSongsForSequence } from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';

const updateSchema = z.object({ title: z.string().min(1) });

async function assertOwnsSequence(ownerId: number, programId: number, seqId: number) {
  const program = await getProgramById(ownerId, programId);
  if (!program) return undefined;
  const sequence = await getSequenceById(seqId);
  if (!sequence || sequence.programId !== programId) return undefined;
  return sequence;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; seqId: string }> }) {
  const ownerId = getUserId(request);
  const { id, seqId } = await params;
  const sequence = await assertOwnsSequence(ownerId, Number(id), Number(seqId));
  if (!sequence) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const songs = await listSongsForSequence(sequence.id);
  return NextResponse.json({ ...sequence, songs });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; seqId: string }> }) {
  const ownerId = getUserId(request);
  const { id, seqId } = await params;
  const sequence = await assertOwnsSequence(ownerId, Number(id), Number(seqId));
  if (!sequence) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const updated = await updateSequence(Number(seqId), parsed.data.title);
  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; seqId: string }> }) {
  const ownerId = getUserId(request);
  const { id, seqId } = await params;
  const sequence = await assertOwnsSequence(ownerId, Number(id), Number(seqId));
  if (!sequence) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  await deleteSequence(Number(seqId));
  return NextResponse.json({ ok: true });
}
