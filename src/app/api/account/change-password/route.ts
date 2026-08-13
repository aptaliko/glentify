import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserById, updateUserPassword } from '@/db/queries/users';
import { hashPassword, verifyPassword } from '@/lib/passwordHash';
import { getUserId } from '@/lib/requestUser';

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
    return NextResponse.json({ error: 'Ο τρέχων κωδικός δεν είναι σωστός' }, { status: 400 });
  }

  await updateUserPassword(user.id, hashPassword(parsed.data.newPassword));
  return NextResponse.json({ ok: true });
}
