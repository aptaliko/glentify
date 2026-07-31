import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listGenres, createGenre } from '@/db/queries/genres';

const createSchema = z.object({ name: z.string().min(1) });

export async function GET() {
  return NextResponse.json(await listGenres());
}

export async function POST(request: NextRequest) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const genre = await createGenre(parsed.data);
  return NextResponse.json(genre, { status: 201 });
}
