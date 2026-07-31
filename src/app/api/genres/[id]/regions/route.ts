import { NextRequest, NextResponse } from 'next/server';
import { getUsedTopLevelRegionsForGenre } from '@/db/queries/regions';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const regions = await getUsedTopLevelRegionsForGenre(Number(id));
  return NextResponse.json(regions);
}
