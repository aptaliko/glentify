import { NextRequest, NextResponse } from 'next/server';
import { getSequenceById, deleteSequence, listSongsForSequence } from '@/db/queries/programs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ seqId: string }> }) {
  const { seqId } = await params;
  const sequence = await getSequenceById(Number(seqId));
  if (!sequence) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const songs = await listSongsForSequence(sequence.id);
  return NextResponse.json({ ...sequence, songs });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ seqId: string }> }) {
  const { seqId } = await params;
  await deleteSequence(Number(seqId));
  return NextResponse.json({ ok: true });
}
