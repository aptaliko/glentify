import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getActiveSession, createSession } from '@/db/queries/sessions';

const createSchema = z.object({ label: z.string().nullable().optional(), startingSongId: z.number().int() });

export async function GET() {
  const session = await getActiveSession();
  return NextResponse.json(session ?? null);
}

export async function POST(request: NextRequest) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const session = await createSession(parsed.data.label ?? null, parsed.data.startingSongId);
  return NextResponse.json(session, { status: 201 });
}
