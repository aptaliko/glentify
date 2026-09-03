// src/app/api/programs/[id]/sequences/[seqId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getProgramAccess,
  getSequenceById,
  updateSequence,
  updateSequenceIfMatch,
  deleteSequence,
  listSongsForSequence,
  type ProgramAccessRole,
} from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';
import { parseIfMatch } from '@/lib/ifMatch';

const updateSchema = z.object({ title: z.string().min(1) });

async function assertSequenceAccess(userId: number, programId: number, seqId: number): Promise<ProgramAccessRole> {
  const role = await getProgramAccess(userId, programId);
  if (!role) return null;
  const sequence = await getSequenceById(seqId);
  if (!sequence || sequence.programId !== programId) return null;
  return role;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; seqId: string }> }) {
  const userId = getUserId(request);
  const { id, seqId } = await params;
  const role = await assertSequenceAccess(userId, Number(id), Number(seqId));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const sequence = await getSequenceById(Number(seqId));
  const songs = await listSongsForSequence(Number(seqId));
  return NextResponse.json({ ...sequence, songs });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; seqId: string }> }) {
  const userId = getUserId(request);
  const { id, seqId } = await params;
  const role = await assertSequenceAccess(userId, Number(id), Number(seqId));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const expected = parseIfMatch(request);
  if (expected !== null) {
    const updated = await updateSequenceIfMatch(Number(seqId), parsed.data.title, expected);
    if (!updated) {
      const current = await getSequenceById(Number(seqId));
      return NextResponse.json({ error: 'Άλλαξε από συνεργάτη', version: current?.version ?? null }, { status: 409 });
    }
    return NextResponse.json(updated);
  }
  const updated = await updateSequence(Number(seqId), parsed.data.title);
  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; seqId: string }> }) {
  const userId = getUserId(request);
  const { id, seqId } = await params;
  const role = await assertSequenceAccess(userId, Number(id), Number(seqId));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  await deleteSequence(Number(seqId));
  return NextResponse.json({ ok: true });
}
