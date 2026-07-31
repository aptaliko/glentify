import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listRhythms, createRhythm } from '@/db/queries/rhythms';

const createSchema = z.object({ name: z.string().min(1) });

export async function GET() {
  return NextResponse.json(await listRhythms());
}

export async function POST(request: NextRequest) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const rhythm = await createRhythm(parsed.data);
  return NextResponse.json(rhythm, { status: 201 });
}
