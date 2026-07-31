import { NextResponse } from 'next/server';
import { listAxisTypes } from '@/db/queries/axisValues';

export async function GET() {
  return NextResponse.json(await listAxisTypes());
}
