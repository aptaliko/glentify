import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSongWithAxisValues, getSongById, updateSong, deleteSong } from '@/db/queries/songs';
import { getUserId } from '@/lib/requestUser';

const axisValueSchema = z.object({
  axisType: z.enum(['genre', 'region', 'rhythm', 'dromos', 'composer', 'year']),
  refId: z.number().int().nullable(),
  yearValue: z.number().int().nullable(),
});

const updateSchema = z.object({
  title: z.string().min(1),
  lyrics: z.string().nullable(),
  imageUrl: z.string().nullable(),
  notes: z.string().nullable(),
  maleKey: z.string().nullable(),
  femaleKey: z.string().nullable(),
  axisValues: z.array(axisValueSchema),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = getUserId(request);
  const { id } = await params;
  const song = await getSongWithAxisValues(ownerId, Number(id));
  if (!song) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  return NextResponse.json(song);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = getUserId(request);
  const { id } = await params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const song = await updateSong(ownerId, Number(id), parsed.data);
  if (!song) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  return NextResponse.json(song);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = getUserId(request);
  const { id } = await params;
  // Check existence first (mirroring admin/programs's DELETE route) so "already gone" is
  // a real 404, distinct from the two genuine conflicts deleteSong() can still throw for
  // (played in a session; is a session's current song), which stay 409. Without this, a
  // sync-queue delete that lands after the song was already removed elsewhere gets
  // misclassified as a permanent conflict instead of the no-op success it actually is.
  const song = await getSongById(ownerId, Number(id));
  if (!song) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  try {
    await deleteSong(ownerId, Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}
