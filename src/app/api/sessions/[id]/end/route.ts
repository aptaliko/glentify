import { NextRequest, NextResponse } from 'next/server';
import { getSessionById, endSession } from '@/db/queries/sessions';
import { getUserId } from '@/lib/requestUser';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = getUserId(request);
  const { id } = await params;
  const sessionId = Number(id);
  const session = await getSessionById(ownerId, sessionId);
  if (!session) return NextResponse.json({ error: 'Δεν βρέθηκε session' }, { status: 404 });
  await endSession(sessionId);
  return NextResponse.json({ ok: true });
}
