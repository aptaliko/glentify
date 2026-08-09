import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listDromoi, createDromos } from '@/db/queries/dromoi';
import { getUserId } from '@/lib/requestUser';
import { getUserById } from '@/db/queries/users';

const createSchema = z.object({ name: z.string().min(1) });

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  return NextResponse.json(await listDromoi(userId));
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const ownerId = user.role === 'admin' ? null : user.id;
  const dromos = await createDromos({ ...parsed.data, ownerId });
  return NextResponse.json(dromos, { status: 201 });
}
