import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listAccessiblePrograms, createProgram } from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';

const createSchema = z.object({ title: z.string().min(1) });

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  return NextResponse.json(await listAccessiblePrograms(userId));
}

export async function POST(request: NextRequest) {
  const ownerId = getUserId(request);
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const program = await createProgram(ownerId, parsed.data.title);
  return NextResponse.json(program, { status: 201 });
}
