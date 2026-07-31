import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSequenceById, updateSequence, deleteSequence, listSongsForSequence } from '@/db/queries/programs';

const updateSchema = z.object({ title: z.string().min(1) });

export async function GET(_request: NextRequest, { params }: { params: Promise<{ seqId: string }> }) {
  const { seqId } = await params;
  const sequence = await getSequenceById(Number(seqId));
  if (!sequence) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const songs = await listSongsForSequence(sequence.id);
  return NextResponse.json({ ...sequence, songs });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ seqId: string }> }) {
  const { seqId } = await params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const sequence = await updateSequence(Number(seqId), parsed.data.title);
  return NextResponse.json(sequence);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ seqId: string }> }) {
  const { seqId } = await params;
  await deleteSequence(Number(seqId));
  return NextResponse.json({ ok: true });
}
