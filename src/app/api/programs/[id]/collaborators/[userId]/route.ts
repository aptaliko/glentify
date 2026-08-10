import { NextRequest, NextResponse } from 'next/server';
import { getProgramAccess, isCollaborator, removeCollaborator } from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const requesterId = getUserId(request);
  const { id, userId: targetUserIdStr } = await params;
  const programId = Number(id);
  const targetUserId = Number(targetUserIdStr);

  const role = await getProgramAccess(requesterId, programId);
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  if (role !== 'creator' && requesterId !== targetUserId) {
    return NextResponse.json({ error: 'Μπορείς να αφαιρέσεις μόνο τον εαυτό σου' }, { status: 403 });
  }
  if (!(await isCollaborator(programId, targetUserId))) {
    return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  }

  await removeCollaborator(programId, targetUserId);
  return NextResponse.json({ ok: true });
}
