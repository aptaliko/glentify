import { NextRequest, NextResponse } from 'next/server';
import { listSongs } from '@/db/queries/songs';
import { listAllAxisValues, listAxisTypes } from '@/db/queries/axisValues';
import { listRegions } from '@/db/queries/regions';
import { listRhythms } from '@/db/queries/rhythms';
import { listDromoi } from '@/db/queries/dromoi';
import { listComposers } from '@/db/queries/composers';
import { listGenres } from '@/db/queries/genres';
import type { ReferenceData } from '@/lib/referenceData';
import { getUserId } from '@/lib/requestUser';

export async function GET(request: NextRequest) {
  const ownerId = getUserId(request);
  const [songs, axisValues, axisTypes, regions, rhythms, dromoi, composers, genres] = await Promise.all([
    listSongs(ownerId),
    listAllAxisValues(),
    listAxisTypes(),
    listRegions(ownerId),
    listRhythms(ownerId),
    listDromoi(ownerId),
    listComposers(ownerId),
    listGenres(ownerId),
  ]);
  const payload: ReferenceData = { songs, axisValues, axisTypes, regions, rhythms, dromoi, composers, genres };
  return NextResponse.json(payload);
}
