import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listRegions, createRegion } from '@/db/queries/regions';

const createSchema = z.object({ name: z.string().min(1), parentId: z.number().int().nullable() });

export async function GET() {
  return NextResponse.json(await listRegions());
}

export async function POST(request: NextRequest) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const region = await createRegion(parsed.data);
  return NextResponse.json(region, { status: 201 });
}
