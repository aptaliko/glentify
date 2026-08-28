import { NextRequest, NextResponse } from 'next/server';
import { getSessionById, getPlayedSongsGrouped } from '@/db/queries/sessions';
import { getUserId } from '@/lib/requestUser';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(request);
  const { id } = await params;
  const sessionId = Number(id);
  const session = await getSessionById(userId, sessionId);
  if (!session) return NextResponse.json({ error: 'Δεν βρέθηκε session' }, { status: 404 });
  if (session.endedAt === null) {
    return NextResponse.json({ error: 'Το session δεν έχει λήξει ακόμα' }, { status: 400 });
  }
  const groups = await getPlayedSongsGrouped(sessionId);
  return NextResponse.json({ sequences: groups.map((songs) => ({ songs })) });
}
