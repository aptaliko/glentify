import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { findValidResetToken, markResetTokenUsed } from '@/db/queries/passwordResetTokens';
import { updateUserPassword } from '@/db/queries/users';
import { hashResetToken } from '@/lib/resetToken';
import { hashPassword } from '@/lib/passwordHash';

const schema = z.object({ token: z.string().min(1), password: z.string().min(8) });

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const record = await findValidResetToken(hashResetToken(parsed.data.token));
  if (!record) return NextResponse.json({ error: 'Ο σύνδεσμος έληξε ή δεν είναι έγκυρος' }, { status: 400 });

  // Mark the token used before updating the password: if marking fails, the token is already
  // burned and the password is untouched (the user just requests a new link). The reverse order
  // would risk a changed password with a still-valid, replayable token if the mark step failed.
  await markResetTokenUsed(record.id);
  await updateUserPassword(record.userId, hashPassword(parsed.data.password));
  return NextResponse.json({ ok: true });
}
