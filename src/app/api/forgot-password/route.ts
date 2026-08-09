import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserByEmail } from '@/db/queries/users';
import { createResetToken } from '@/db/queries/passwordResetTokens';
import { generateResetToken } from '@/lib/resetToken';
import { sendPasswordResetEmail } from '@/lib/email';

const schema = z.object({ email: z.email() });

// Minimum wall-clock time (ms) the handler takes before responding, regardless of whether the
// email is registered. Without this, the "user exists" branch below awaits a DB insert and a
// live Resend API call (commonly 100ms+), while the "user doesn't exist" branch returns almost
// immediately — letting an attacker distinguish registered emails purely by response latency,
// even though both branches already return an identical status/body. Padding every response out
// to a fixed floor closes that timing side-channel. 400ms comfortably masks a real Resend round
// trip without making the form feel unresponsive.
const MIN_RESPONSE_MS = 400;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
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

  // Normalize response timing so the elapsed time before we respond can't be used to infer
  // whether the email was registered (see MIN_RESPONSE_MS above).
  const elapsed = Date.now() - startedAt;
  if (elapsed < MIN_RESPONSE_MS) await sleep(MIN_RESPONSE_MS - elapsed);

  // Same response whether or not the email exists, to avoid leaking which emails are registered.
  return NextResponse.json({ ok: true });
}
