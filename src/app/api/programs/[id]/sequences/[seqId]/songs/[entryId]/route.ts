// src/app/api/programs/[id]/sequences/[seqId]/songs/[entryId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getProgramAccess, getSequenceById, listSongsForSequence, removeSongFromSequence } from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; seqId: string; entryId: string }> }
) {
  const userId = getUserId(request);
  const { id, seqId, entryId } = await params;
  const role = await getProgramAccess(userId, Number(id));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const sequence = await getSequenceById(Number(seqId));
  if (!sequence || sequence.programId !== Number(id)) {
    return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  }
  // removeSongFromSequence deletes by sequenceSongId alone (no sequenceId in its WHERE),
  // so the entry's membership in this sequence must be confirmed here, not just the sequence's
  // membership in the program above — otherwise a caller with access to *some* sequence could
  // delete another sequence's entry by id.
  const entries = await listSongsForSequence(sequence.id);
  if (!entries.some((entry) => entry.sequenceSongId === Number(entryId))) {
    return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  }
  await removeSongFromSequence(Number(entryId));
  return NextResponse.json({ ok: true });
}
