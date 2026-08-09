import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserByEmail } from '@/db/queries/users';
import { createResetToken } from '@/db/queries/passwordResetTokens';
import { generateResetToken } from '@/lib/resetToken';
import { sendPasswordResetEmail } from '@/lib/email';

const schema = z.object({ email: z.email() });

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await getUserByEmail(parsed.data.email);
  if (user) {
    // Swallow any failure here (token creation or email send) so this branch can never produce a
    // different HTTP outcome than the "email not registered" branch below — see email.ts for why
    // sendPasswordResetEmail itself can still fail without throwing when RESEND_API_KEY is unset.
    try {
      const { token, tokenHash } = generateResetToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await createResetToken(user.id, tokenHash, expiresAt);
      const origin = request.nextUrl.origin;
      await sendPasswordResetEmail(user.email, `${origin}/reset-password?token=${token}`);
    } catch (error) {
      console.error('Failed to process password reset request', error);
    }
  }
  // Same response whether or not the email exists, to avoid leaking which emails are registered.
  return NextResponse.json({ ok: true });
}
