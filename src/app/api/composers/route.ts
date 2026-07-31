import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listComposers, createComposer } from '@/db/queries/composers';

const createSchema = z.object({ name: z.string().min(1) });

export async function GET() {
  return NextResponse.json(await listComposers());
}

export async function POST(request: NextRequest) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const composer = await createComposer(parsed.data);
  return NextResponse.json(composer, { status: 201 });
}
