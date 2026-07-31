import { NextRequest, NextResponse } from 'next/server';
import { removeSongFromSequence } from '@/db/queries/programs';

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await params;
  await removeSongFromSequence(Number(entryId));
  return NextResponse.json({ ok: true });
}
