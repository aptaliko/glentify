import { db } from '../client';
import { users } from '../schema';
import { eq } from 'drizzle-orm';
import type { UserRow } from '../schema';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  role?: 'admin' | 'user';
}

export async function createUser(data: CreateUserInput): Promise<UserRow> {
  const rows = await db
    .insert(users)
    .values({ email: data.email, passwordHash: data.passwordHash, role: data.role ?? 'user' })
    .returning();
  return rows[0];
}

export async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  const rows = await db.select().from(users).where(eq(users.email, email));
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
