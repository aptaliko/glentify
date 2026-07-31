import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { addSongToSequence } from '@/db/queries/programs';

const addSchema = z.object({ songId: z.number().int() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ seqId: string }> }) {
  const { seqId } = await params;
  const parsed = addSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  await addSongToSequence(Number(seqId), parsed.data.songId);
  return NextResponse.json({ ok: true }, { status: 201 });
}
