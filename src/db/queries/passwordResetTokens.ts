import { db } from '../client';
import { passwordResetTokens } from '../schema';
import { eq, and, isNull, gt } from 'drizzle-orm';
import type { PasswordResetTokenRow } from '../schema';

export async function createResetToken(userId: number, tokenHash: string, expiresAt: Date): Promise<PasswordResetTokenRow> {
  const rows = await db.insert(passwordResetTokens).values({ userId, tokenHash, expiresAt }).returning();
  return rows[0];
}

export async function findValidResetToken(tokenHash: string): Promise<PasswordResetTokenRow | undefined> {
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date())
      )
    );
  return rows[0];
}

export async function markResetTokenUsed(id: number): Promise<void> {
  await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, id));
}

// Throwaway query with no side effects, used only to burn a second Neon HTTP round trip on the
// "email not registered" path of /api/forgot-password. That path otherwise makes one round trip
// (getUserByEmail) versus the "email registered" path's two (getUserByEmail + createResetToken),
// and on the neon-http driver (no connection pooling — every query is its own network round
// trip) that missing round trip, not query complexity, is what made the two paths distinguishable
// by timing. Always resolves to zero rows; the result is discarded by the caller.
export async function dummyRoundtrip(): Promise<void> {
  await db.select({ id: passwordResetTokens.id }).from(passwordResetTokens).where(eq(passwordResetTokens.id, -1));
}
