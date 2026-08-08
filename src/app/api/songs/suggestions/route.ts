import { NextRequest, NextResponse } from 'next/server';
import { searchSuggestionSongs } from '@/db/queries/songs';
import { getAxisValuesForSongIds, getVisibleAxisRefIds } from '@/db/queries/axisValues';
import { listGenres } from '@/db/queries/genres';
import { getUserId } from '@/lib/requestUser';

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const title = request.nextUrl.searchParams.get('title')?.trim();
  if (!title) return NextResponse.json([]);

  const candidates = await searchSuggestionSongs(title);
  const [axisRows, visible, visibleGenres] = await Promise.all([
    getAxisValuesForSongIds(candidates.map((s) => s.id)),
    getVisibleAxisRefIds(userId),
    listGenres(userId),
  ]);
  const visibleGenreIds = new Set(visibleGenres.map((g) => g.id));

  const result = candidates.map((song) => ({
    id: song.id,
    title: song.title,
    lyrics: song.lyrics,
    notes: song.notes,
    // genreId is a direct FK, not an axis value — filter it against the requester's visible
    // genres the same way axis refs are filtered, so a genre the requester can't see never
    // reaches the client (e.g. a personal genre owned by an admin who created it before an
    // eventual promotion, or any future admin-role-management path).
    genreId: visibleGenreIds.has(song.genreId) ? song.genreId : null,
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
