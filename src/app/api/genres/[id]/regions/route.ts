import { NextRequest, NextResponse } from 'next/server';
import { getUsedTopLevelRegionsForGenre } from '@/db/queries/regions';
import { getUserId } from '@/lib/requestUser';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = getUserId(request);
  const { id } = await params;
  const regions = await getUsedTopLevelRegionsForGenre(ownerId, Number(id));
  return NextResponse.json(regions);
}
