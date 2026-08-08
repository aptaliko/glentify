import { NextRequest, NextResponse } from 'next/server';
import { getSessionById, getPlayedSongIds } from '@/db/queries/sessions';
import { listSongs, getSongWithAxisValues } from '@/db/queries/songs';
import { listRegions } from '@/db/queries/regions';
import { listRhythms } from '@/db/queries/rhythms';
import { listDromoi } from '@/db/queries/dromoi';
import { listComposers } from '@/db/queries/composers';
import { listAxisTypes, listAllAxisValues } from '@/db/queries/axisValues';
import { listGenres } from '@/db/queries/genres';
import { buildSuggestionsResponse, type AxisValue, type SongWithAxes } from '@/lib/suggestions';
import { getUserId } from '@/lib/requestUser';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = getUserId(request);
  const { id } = await params;
  const sessionId = Number(id);
  const session = await getSessionById(sessionId);
  if (!session) return NextResponse.json({ error: 'Δεν βρέθηκε session' }, { status: 404 });

  const showPlayed = request.nextUrl.searchParams.get('showPlayed') === 'true';
  const hasActiveParam = request.nextUrl.searchParams.has('activeAxisTypes');
  const requestedActive = hasActiveParam
    ? new Set((request.nextUrl.searchParams.get('activeAxisTypes') ?? '').split(',').filter(Boolean))
    : null;

  if (session.currentSongId === null) {
    return NextResponse.json(
      buildSuggestionsResponse({
        currentSongWithAxes: null,
        allSongs: [],
        playedSongIds: new Set(),
        showPlayed,
        requestedActive,
        lookups: { regions: [], rhythms: [], dromoi: [], composers: [], axisTypes: [], genres: [] },
      })
    );
  }

  const [allSongs, regions, rhythms, dromoi, composers, axisTypes, genres, playedSongIdList, currentSongWithAxes, allAxisValues] =
    await Promise.all([
      listSongs(ownerId),
      listRegions(),
      listRhythms(),
      listDromoi(),
      listComposers(),
      listAxisTypes(),
      listGenres(),
      getPlayedSongIds(sessionId),
      getSongWithAxisValues(ownerId, session.currentSongId),
      listAllAxisValues(),
    ]);

  if (!currentSongWithAxes) return NextResponse.json({ error: 'Το τρέχον τραγούδι δεν βρέθηκε' }, { status: 500 });

  const axisValuesBySong = new Map<number, AxisValue[]>();
  for (const av of allAxisValues) {
    const list = axisValuesBySong.get(av.songId) ?? [];
    list.push({ axisType: av.axisType, refId: av.refId, yearValue: av.yearValue });
    axisValuesBySong.set(av.songId, list);
  }
  const songsWithAxes: SongWithAxes[] = allSongs.map((song) => ({
    song,
    axisValues: axisValuesBySong.get(song.id) ?? [],
  }));
  const currentAxisValues: AxisValue[] = currentSongWithAxes.axisValues.map((v) => ({
    axisType: v.axisType,
    refId: v.refId,
    yearValue: v.yearValue,
  }));

  return NextResponse.json(
    buildSuggestionsResponse({
      currentSongWithAxes: {
        id: currentSongWithAxes.id,
        title: currentSongWithAxes.title,
        lyrics: currentSongWithAxes.lyrics,
        maleKey: currentSongWithAxes.maleKey,
        femaleKey: currentSongWithAxes.femaleKey,
        axisValues: currentAxisValues,
      },
      allSongs: songsWithAxes,
      playedSongIds: new Set(playedSongIdList),
      showPlayed,
      requestedActive,
      lookups: { regions, rhythms, dromoi, composers, axisTypes, genres },
    })
  );
}
