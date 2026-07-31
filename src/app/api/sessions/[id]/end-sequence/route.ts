import { NextRequest, NextResponse } from 'next/server';
import { endSequence } from '@/db/queries/sessions';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await endSequence(Number(id));
  return NextResponse.json({ ok: true });
}
