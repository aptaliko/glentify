import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSequence } from '@/db/queries/programs';

const createSchema = z.object({ title: z.string().min(1) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const sequence = await createSequence(Number(id), parsed.data.title);
  return NextResponse.json(sequence, { status: 201 });
}
