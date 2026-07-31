import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { advanceToSong } from '@/db/queries/sessions';

const schema = z.object({ nextSongId: z.number().int() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  await advanceToSong(Number(id), parsed.data.nextSongId);
  return NextResponse.json({ ok: true });
}
