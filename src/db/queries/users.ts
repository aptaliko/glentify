import { db } from '../client';
import { users } from '../schema';
import { eq } from 'drizzle-orm';
import type { UserRow } from '../schema';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  role?: 'admin' | 'user';
}

// Emails are case-insensitive in practice (virtually every provider treats `Foo@x.com` and
// `foo@x.com` as the same mailbox). Normalizing here — the single choke point every caller
// (register/login/forgot-password routes, migrate-to-multiuser script) already goes through —
// means `Foo@x.com` and `foo@x.com` always resolve to the same row, so the duplicate-email check
// on registration actually catches case variants, and a user who registered with different casing
// than they later type into forgot-password doesn't get silently, permanently locked out.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createUser(data: CreateUserInput): Promise<UserRow> {
  const rows = await db
    .insert(users)
    .values({ email: normalizeEmail(data.email), passwordHash: data.passwordHash, role: data.role ?? 'user' })
    .returning();
  return rows[0];
}

export async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  const rows = await db.select().from(users).where(eq(users.email, normalizeEmail(email)));
  return rows[0];
}

export async function getUserById(id: number): Promise<UserRow | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, id));
  return rows[0];
}

export async function updateUserPassword(id: number, passwordHash: string): Promise<void> {
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
}

export async function countAdmins(): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
  return rows.length;
}
