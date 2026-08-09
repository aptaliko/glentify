import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserByEmail } from '@/db/queries/users';
import { createResetToken, dummyRoundtrip } from '@/db/queries/passwordResetTokens';
import { generateResetToken } from '@/lib/resetToken';
import { sendPasswordResetEmail } from '@/lib/email';

const schema = z.object({ email: z.email() });

// The real fix for the timing side-channel is the round-trip equalization in the `else` branch
// below, not this floor — see dummyRoundtrip's doc comment. A first attempt (a flat floor with
// no DB-work equalization) was measured live against real Neon Postgres and found ineffective:
// the "user exists" branch's real work (getUserByEmail SELECT + createResetToken INSERT)
// measured ~1.2-2.1s on the neon-http driver, while the "user doesn't exist" branch's real work
// (SELECT only) measured ~0.5-0.7s — both already well above a 400ms floor, so the floor only
// padded the fast branch and the two remained trivially distinguishable by latency.
//
// Honest accounting for THIS floor, post-equalization: with both branches now making the same
// number of round trips (2 each), elapsed time on this Neon HTTP driver is typically well above
// 600ms on both branches already (by the same measurements above, ~1.0-1.4s vs ~1.2-2.1s) — so in
// practice this floor is usually a no-op, not active padding. It's kept as a cheap guard for
// cases where round-trip latency drops below 600ms (e.g. a faster driver/network, or Neon
// connection reuse in some deployment) so the two branches don't suddenly re-diverge for free.
// It is NOT sufficient to mask the one asymmetry equalization doesn't touch: when
// RESEND_API_KEY is configured, the "user exists" branch alone makes a live Resend API call
// (typically 100-400ms) that the "user doesn't exist" branch has no equivalent for. That gap is
// a known, unaddressed residual — see the task report — not something this floor reliably
// covers, since the floor has usually already been exceeded by DB round-trip time alone before
// the Resend call even starts.
const MIN_RESPONSE_MS = 600;

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
  } else {
    // Perform a throwaway second DB round trip so this branch pays the same number of Neon HTTP
    // round trips as the "user exists" branch above (getUserByEmail + createResetToken vs
    // getUserByEmail + dummyRoundtrip). See dummyRoundtrip's doc comment and MIN_RESPONSE_MS above
    // for why matching round-trip *count*, not just padding elapsed time, is what actually closes
    // the timing side-channel on this driver.
    try {
      await dummyRoundtrip();
    } catch (error) {
      console.error('Timing-equalization query failed', error);
    }
  }

  // Floor guard: only fires if total elapsed came in under MIN_RESPONSE_MS, which is rare on this
  // driver (see the comment above). The round-trip equalization in the branches above — not this
  // sleep — is what actually normalizes timing between the two cases in the common case.
  const elapsed = Date.now() - startedAt;
  if (elapsed < MIN_RESPONSE_MS) await sleep(MIN_RESPONSE_MS - elapsed);

  // Same response whether or not the email exists, to avoid leaking which emails are registered.
  return NextResponse.json({ ok: true });
}
