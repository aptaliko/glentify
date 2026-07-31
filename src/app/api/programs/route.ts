import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listPrograms, createProgram } from '@/db/queries/programs';

const createSchema = z.object({ title: z.string().min(1) });

export async function GET() {
  return NextResponse.json(await listPrograms());
}

export async function POST(request: NextRequest) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const program = await createProgram(parsed.data.title);
  return NextResponse.json(program, { status: 201 });
}
