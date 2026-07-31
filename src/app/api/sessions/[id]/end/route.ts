import { NextRequest, NextResponse } from 'next/server';
import { endSession } from '@/db/queries/sessions';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await endSession(Number(id));
  return NextResponse.json({ ok: true });
}
