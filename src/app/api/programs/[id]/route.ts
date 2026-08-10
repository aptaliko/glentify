import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getProgramById, getProgramAccess, updateProgram, deleteProgram, listSequencesForProgram } from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';

const updateSchema = z.object({ title: z.string().min(1) });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(request);
  const { id } = await params;
  const role = await getProgramAccess(userId, Number(id));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const program = await getProgramById(Number(id));
  const sequences = await listSequencesForProgram(Number(id));
  return NextResponse.json({ ...program, role, sequences });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(request);
  const { id } = await params;
  const role = await getProgramAccess(userId, Number(id));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const program = await updateProgram(Number(id), parsed.data.title);
  return NextResponse.json(program);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(request);
  const { id } = await params;
  const role = await getProgramAccess(userId, Number(id));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  if (role !== 'creator') {
    return NextResponse.json({ error: 'Μόνο ο δημιουργός μπορεί να διαγράψει το πρόγραμμα' }, { status: 403 });
  }
  await deleteProgram(Number(id));
  return NextResponse.json({ ok: true });
}
