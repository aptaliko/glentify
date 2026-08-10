// src/app/api/programs/[id]/sequences/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getProgramAccess, createSequence } from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';

const createSchema = z.object({ title: z.string().min(1) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(request);
  const { id } = await params;
  const role = await getProgramAccess(userId, Number(id));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const sequence = await createSequence(Number(id), parsed.data.title);
  return NextResponse.json(sequence, { status: 201 });
}
