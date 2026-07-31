import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { updateRhythm, deleteRhythm } from '@/db/queries/rhythms';

const updateSchema = z.object({ name: z.string().min(1) });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const rhythm = await updateRhythm(Number(id), parsed.data);
  return NextResponse.json(rhythm);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteRhythm(Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}
