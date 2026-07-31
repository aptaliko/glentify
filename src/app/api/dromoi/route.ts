import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listDromoi, createDromos } from '@/db/queries/dromoi';

const createSchema = z.object({ name: z.string().min(1) });

export async function GET() {
  return NextResponse.json(await listDromoi());
}

export async function POST(request: NextRequest) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const dromos = await createDromos(parsed.data);
  return NextResponse.json(dromos, { status: 201 });
}
