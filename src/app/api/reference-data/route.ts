import { NextRequest, NextResponse } from 'next/server';
import { listSongs, getSongsByIds } from '@/db/queries/songs';
import { getAxisValuesForOwner, listAxisTypes } from '@/db/queries/axisValues';
import { listRegions } from '@/db/queries/regions';
import { listRhythms } from '@/db/queries/rhythms';
import { listDromoi } from '@/db/queries/dromoi';
import { listComposers } from '@/db/queries/composers';
import { listGenres } from '@/db/queries/genres';
import { listProgramsWithSequencesAndSongs } from '@/db/queries/programs';
import { collectReferencedSongIds } from '@/lib/referenceData';
import type { ReferenceData } from '@/lib/referenceData';
import { getUserId } from '@/lib/requestUser';

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const [ownSongs, axisValues, axisTypes, regions, rhythms, dromoi, composers, genres, programs] = await Promise.all([
    listSongs(userId),
    getAxisValuesForOwner(userId),
    listAxisTypes(),
    listRegions(userId),
    listRhythms(userId),
    listDromoi(userId),
    listComposers(userId),
    listGenres(userId),
    listProgramsWithSequencesAndSongs(userId),
  ]);

  // Shared programs can reference songs owned by a collaborator, not just the requester —
  // those ids won't be in `ownSongs` (listSongs is strictly owner-scoped), so the client-side
  // songId -> song lookup used by the offline program views would otherwise silently fail for
  // them. Fetch just the missing ones and return them as a separate `sharedSongs` field, kept
  // out of `songs` so the offline song picker and session suggestions never surface them as
  // if they were the requester's own.
  const referencedIds = collectReferencedSongIds(programs);
  const ownIds = new Set(ownSongs.map((s) => s.id));
  const missingIds = referencedIds.filter((id) => !ownIds.has(id));
  const sharedSongs = missingIds.length ? await getSongsByIds(missingIds) : [];

  const payload: ReferenceData = { songs: ownSongs, sharedSongs, axisValues, axisTypes, regions, rhythms, dromoi, composers, genres, programs };
  return NextResponse.json(payload);
}
