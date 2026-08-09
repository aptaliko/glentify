import { NextRequest, NextResponse } from 'next/server';
import { getUserById, countAdmins } from '@/db/queries/users';
import { deleteUserCascade } from '@/db/queries/accountDeletion';
import { getUserId } from '@/lib/requestUser';
import { getAuthCookieName } from '@/lib/auth';

export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (user.role === 'admin') {
    const admins = await countAdmins();
    if (admins <= 1) {
      return NextResponse.json({ error: 'Δεν μπορείς να διαγράψεις τον μοναδικό admin λογαριασμό' }, { status: 409 });
    }
  }

  await deleteUserCascade(userId);
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(getAuthCookieName());
  return response;
}
