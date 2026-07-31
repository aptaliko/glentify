import { NextRequest, NextResponse } from 'next/server';
import { getSessionById, getPlayedSongIds } from '@/db/queries/sessions';
import { listSongs, getSongWithAxisValues } from '@/db/queries/songs';
import { listRegions } from '@/db/queries/regions';
import { listRhythms } from '@/db/queries/rhythms';
import { listDromoi } from '@/db/queries/dromoi';
import { listComposers } from '@/db/queries/composers';
import { listAxisTypes, listAllAxisValues } from '@/db/queries/axisValues';
import { listGenres } from '@/db/queries/genres';
import { getSuggestions, type AxisValue, type SongWithAxes } from '@/lib/suggestions';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = Number(id);
  const session = await getSessionById(sessionId);
  if (!session) return NextResponse.json({ error: 'Δεν βρέθηκε session' }, { status: 404 });

  const showPlayed = request.nextUrl.searchParams.get('showPlayed') === 'true';
  const hasActiveParam = request.nextUrl.searchParams.has('activeAxisTypes');
  const requestedActive = new Set(
    (request.nextUrl.searchParams.get('activeAxisTypes') ?? '').split(',').filter(Boolean)
  );

  if (session.currentSongId === null) {
    return NextResponse.json({
      currentSong: null,
      availableAxisTypes: [],
      activeAxisTypes: [],
      mode: 'grouped',
      candidates: [],
      genreGroups: [],
      listTitle: '',
    });
  }

  const [allSongs, regions, rhythms, dromoi, composers, axisTypes, genres, playedSongIdList, currentSongWithAxes, allAxisValues] =
    await Promise.all([
      listSongs(),
      listRegions(),
      listRhythms(),
      listDromoi(),
      listComposers(),
      listAxisTypes(),
      listGenres(),
      getPlayedSongIds(sessionId),
      getSongWithAxisValues(session.currentSongId),
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
  const availableAxisTypeKeys = currentAxisValues.map((v) => v.axisType);
  const effectiveActive = hasActiveParam
    ? new Set([...requestedActive].filter((t) => availableAxisTypeKeys.includes(t)))
    : new Set(availableAxisTypeKeys);

  const lookupNameById: Record<string, Map<number, string>> = {
    region: new Map(regions.map((r) => [r.id, r.name])),
    rhythm: new Map(rhythms.map((r) => [r.id, r.name])),
    dromos: new Map(dromoi.map((d) => [d.id, d.name])),
    composer: new Map(composers.map((c) => [c.id, c.name])),
  };
  const axisLabelByKey = new Map(axisTypes.map((t) => [t.key, t.label]));
  const genreNameById = new Map(genres.map((g) => [g.id, g.name]));

  function labelForAxisValue(v: AxisValue): string {
    if (v.axisType === 'year') return String(v.yearValue);
    const name = v.refId !== null ? lookupNameById[v.axisType]?.get(v.refId) : undefined;
    return name ?? '?';
  }

  const playedSet = new Set(playedSongIdList);
  const toSuggestion = (id: number, title: string) => ({ id, title, played: playedSet.has(id) });

  const result = getSuggestions({
    currentSongId: session.currentSongId,
    currentAxisValues,
    activeAxisTypes: effectiveActive,
    allSongs: songsWithAxes,
    regions,
    playedSongIds: playedSet,
    showPlayed,
  });

  const availableAxisTypes = currentAxisValues.map((v) => ({
    key: v.axisType,
    label: axisLabelByKey.get(v.axisType) ?? v.axisType,
    value: labelForAxisValue(v),
  }));

  if (result.mode === 'grouped') {
    return NextResponse.json({
      currentSong: { id: currentSongWithAxes.id, title: currentSongWithAxes.title, lyrics: currentSongWithAxes.lyrics },
      availableAxisTypes,
      activeAxisTypes: [...effectiveActive],
      mode: 'grouped',
      candidates: [],
      genreGroups: result.genreGroups
        .map((g) => ({
          genreId: g.genreId,
          genreName: genreNameById.get(g.genreId) ?? '?',
          songs: g.songs.map((s) => toSuggestion(s.id, s.title)),
        }))
        .sort((a, b) => a.genreName.localeCompare(b.genreName, 'el')),
      listTitle: '',
    });
  }

  const activeLabels = [...effectiveActive].map((key) => axisLabelByKey.get(key) ?? key);
  return NextResponse.json({
    currentSong: { id: currentSongWithAxes.id, title: currentSongWithAxes.title, lyrics: currentSongWithAxes.lyrics },
    availableAxisTypes,
    activeAxisTypes: [...effectiveActive],
    mode: 'filtered',
    candidates: result.candidates.map((s) => toSuggestion(s.id, s.title)),
    genreGroups: [],
    listTitle: `Άλλα τραγούδια με τα ίδια: ${activeLabels.join(', ')}`,
  });
}
