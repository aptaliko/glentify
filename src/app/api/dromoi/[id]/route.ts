import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { updateDromos, deleteDromos } from '@/db/queries/dromoi';

const updateSchema = z.object({ name: z.string().min(1) });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const dromos = await updateDromos(Number(id), parsed.data);
  return NextResponse.json(dromos);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteDromos(Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}
