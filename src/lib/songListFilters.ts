// Filtering and pagination for the admin songs list. Pure: the page loads the owner's songs and
// their axis values once (web and native alike), then filters and pages them in memory.

export interface SongListFilters {
  search: string;
  regionId: number | null;
  genreId: number | null;
  rhythmId: number | null;
  dromosId: number | null;
  danceId: number | null;
  composerId: number | null;
  year: number | null;
}

export const EMPTY_SONG_FILTERS: SongListFilters = {
  search: '',
  regionId: null,
  genreId: null,
  rhythmId: null,
  dromosId: null,
  danceId: null,
  composerId: null,
  year: null,
};

export const ADMIN_SONGS_PAGE_SIZE = 20;

export interface SongAxisRow {
  songId: number;
  axisType: string;
  refId: number | null;
  yearValue: number | null;
}

// Lookup-backed filters: each one matches a song's refId on the named axis. Year is separate (yearValue).
const AXIS_FILTERS = [
  { filter: 'regionId', axisType: 'region' },
  { filter: 'genreId', axisType: 'genre' },
  { filter: 'rhythmId', axisType: 'rhythm' },
  { filter: 'dromosId', axisType: 'dromos' },
  { filter: 'danceId', axisType: 'dance' },
  { filter: 'composerId', axisType: 'composer' },
] as const;

export function hasAxisFilter(f: SongListFilters): boolean {
  return f.year !== null || AXIS_FILTERS.some(({ filter }) => f[filter] !== null);
}

// Every chosen axis must be held by the song (AND across axes); one value per axis.
function songMatchesAxes(axes: SongAxisRow[], f: SongListFilters): boolean {
  for (const { filter, axisType } of AXIS_FILTERS) {
    const wanted = f[filter];
    if (wanted === null) continue;
    if (!axes.some((a) => a.axisType === axisType && a.refId === wanted)) return false;
  }
  if (f.year !== null && !axes.some((a) => a.axisType === 'year' && a.yearValue === f.year)) return false;
  return true;
}

// Title match is a case-insensitive substring. A song that is still a queued create (id null)
// has no axis values yet, so it only ever matches a title search, never an axis filter.
export function filterAdminSongs<T extends { id: number | null; title: string }>(
  songs: T[],
  axisRows: SongAxisRow[],
  f: SongListFilters
): T[] {
  const term = f.search.trim().toLowerCase();
  const axesBySong = new Map<number, SongAxisRow[]>();
  for (const row of axisRows) {
    const list = axesBySong.get(row.songId) ?? [];
    list.push(row);
    axesBySong.set(row.songId, list);
  }
  const axisFiltered = hasAxisFilter(f);
  return songs.filter((s) => {
    if (term && !s.title.toLowerCase().includes(term)) return false;
    if (!axisFiltered) return true;
    if (s.id === null) return false;
    return songMatchesAxes(axesBySong.get(s.id) ?? [], f);
  });
}

// Clamps the page into range, so a filter that shrinks the list never leaves an empty page.
export function paginate<T>(items: T[], page: number, pageSize: number): { items: T[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: current, totalPages };
}

// Distinct years held by any song, newest first, for the year dropdown.
export function yearsInUse(axisRows: SongAxisRow[]): number[] {
  const years = new Set<number>();
  for (const row of axisRows) {
    if (row.axisType === 'year' && row.yearValue !== null) years.add(row.yearValue);
  }
  return [...years].sort((a, b) => b - a);
}
