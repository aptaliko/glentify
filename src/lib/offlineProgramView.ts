import type { SongRow } from '@/db/schema';
import type { OfflineProgram, OfflineCollaborator, CachedProgramDetail } from './referenceData';

export function buildSongTitleMap(songs: SongRow[], sharedSongs: SongRow[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const s of songs) map.set(s.id, s.title);
  for (const s of sharedSongs) if (!map.has(s.id)) map.set(s.id, s.title);
  return map;
}

// Reshapes one blob program into the CachedProgramDetail that mergeSequencesWithPending
// already consumes, so the merge function and its tests stay untouched. cachedAt carries
// no meaning here (the blob's freshness is its primedAt) — set to empty string.
export function toProgramDetail(
  program: OfflineProgram,
  songTitleById: Map<number, string>
): CachedProgramDetail {
  return {
    programId: program.id,
    title: program.title,
    role: program.role,
    version: program.version,
    cachedAt: '',
    sequences: program.sequences.map((seq, position) => ({
      id: seq.id,
      title: seq.title,
      position,
      songs: seq.entries.map((e) => ({
        sequenceSongId: e.sequenceSongId,
        songId: e.songId,
        title: songTitleById.get(e.songId) ?? '—',
      })),
      version: seq.version,
    })),
  };
}

export function toCollaboratorsView(
  program: OfflineProgram,
  currentUser: OfflineCollaborator | null
): { role: 'creator' | 'collaborator'; creator: OfflineCollaborator | null; collaborators: OfflineCollaborator[]; currentUser: OfflineCollaborator | null } {
  return {
    role: program.role,
    creator: program.creator,
    collaborators: program.collaborators,
    currentUser,
  };
}
