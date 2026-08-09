import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createUser, getUserByEmail } from '@/db/queries/users';
import { hashPassword } from '@/lib/passwordHash';
import { createSessionToken, getAuthCookieName } from '@/lib/auth';

const registerSchema = z.object({ email: z.email(), password: z.string().min(8) });

export async function POST(request: NextRequest) {
  const parsed = registerSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const existing = await getUserByEmail(parsed.data.email);
  if (existing) return NextResponse.json({ error: 'Υπάρχει ήδη λογαριασμός με αυτό το email' }, { status: 409 });

  const user = await createUser({ email: parsed.data.email, passwordHash: hashPassword(parsed.data.password) });
  const token = createSessionToken(user.id);

  const response = NextResponse.json({ ok: true, token }, { status: 201 });
  response.cookies.set(getAuthCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
