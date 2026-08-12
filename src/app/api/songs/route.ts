import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listSongs, createSong } from '@/db/queries/songs';
import { getUserId } from '@/lib/requestUser';

const axisValueSchema = z.object({
  axisType: z.enum(['genre', 'region', 'rhythm', 'dromos', 'composer', 'year']),
  refId: z.number().int().nullable(),
  yearValue: z.number().int().nullable(),
});

const createSchema = z.object({
  title: z.string().min(1),
  lyrics: z.string().nullable(),
  imageUrl: z.string().nullable(),
  notes: z.string().nullable(),
  maleKey: z.string().nullable(),
  femaleKey: z.string().nullable(),
  axisValues: z.array(axisValueSchema),
});

export async function GET(request: NextRequest) {
  const ownerId = getUserId(request);
  const params = request.nextUrl.searchParams;
  const songs = await listSongs(ownerId, {
    search: params.get('search') ?? undefined,
    genreId: params.get('genreId') ? Number(params.get('genreId')) : undefined,
    regionId: params.get('regionId') ? Number(params.get('regionId')) : undefined,
  });
  return NextResponse.json(songs);
}

export async function POST(request: NextRequest) {
  const ownerId = getUserId(request);
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const song = await createSong(ownerId, parsed.data);
  return NextResponse.json(song, { status: 201 });
}
