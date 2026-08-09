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
