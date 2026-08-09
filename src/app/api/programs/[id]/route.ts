import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getProgramById, updateProgram, deleteProgram, listSequencesForProgram } from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';

const updateSchema = z.object({ title: z.string().min(1) });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = getUserId(request);
  const { id } = await params;
  const program = await getProgramById(ownerId, Number(id));
  if (!program) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const sequences = await listSequencesForProgram(program.id);
  return NextResponse.json({ ...program, sequences });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = getUserId(request);
  const { id } = await params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const program = await updateProgram(ownerId, Number(id), parsed.data.title);
  if (!program) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  return NextResponse.json(program);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = getUserId(request);
  const { id } = await params;
  try {
    await deleteProgram(ownerId, Number(id));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  }
}
