import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSongWithAxisValues, updateSong, deleteSong } from '@/db/queries/songs';

const axisValueSchema = z.object({
  axisType: z.enum(['region', 'rhythm', 'dromos', 'composer', 'year']),
  refId: z.number().int().nullable(),
  yearValue: z.number().int().nullable(),
});

const updateSchema = z.object({
  title: z.string().min(1),
  lyrics: z.string().nullable(),
  genreId: z.number().int(),
  notes: z.string().nullable(),
  maleKey: z.string().nullable(),
  femaleKey: z.string().nullable(),
  axisValues: z.array(axisValueSchema),
});

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const song = await getSongWithAxisValues(Number(id));
  if (!song) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  return NextResponse.json(song);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const song = await updateSong(Number(id), parsed.data);
  return NextResponse.json(song);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteSong(Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}
