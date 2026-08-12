import { NextRequest, NextResponse } from 'next/server';
import { searchSuggestionSongs } from '@/db/queries/songs';
import { getAxisValuesForSongIds, getVisibleAxisRefIds } from '@/db/queries/axisValues';
import { getUserId } from '@/lib/requestUser';

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const title = request.nextUrl.searchParams.get('title')?.trim();
  if (!title) return NextResponse.json([]);

  const candidates = await searchSuggestionSongs(title);
  const [axisRows, visible] = await Promise.all([
    getAxisValuesForSongIds(candidates.map((s) => s.id)),
    getVisibleAxisRefIds(userId),
  ]);

  const result = candidates.map((song) => ({
    id: song.id,
    title: song.title,
    lyrics: song.lyrics,
    notes: song.notes,
    maleKey: song.maleKey,
    femaleKey: song.femaleKey,
    axisValues: axisRows
      .filter(
        (a) =>
          a.songId === song.id &&
          (a.axisType === 'year' || (a.refId !== null && visible.get(a.axisType)?.has(a.refId)))
      )
      // Reshape rather than pass the raw row through: the raw row carries `id`/`songId`
      // pointing at the *source* song, and the client stashes this array directly into new-song
      // form state. Stripping those keeps a stray `songId` from ever reaching the create payload.
      .map(({ axisType, refId, yearValue }) => ({ axisType, refId, yearValue })),
  }));
  return NextResponse.json(result);
}
