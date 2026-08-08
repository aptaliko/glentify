import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getGenreById, updateGenre, deleteGenre } from '@/db/queries/genres';
import { getUserId } from '@/lib/requestUser';
import { getUserById } from '@/db/queries/users';

const updateSchema = z.object({ name: z.string().min(1) });

async function assertCanModify(request: NextRequest, id: number): Promise<NextResponse | null> {
  const userId = getUserId(request);
  const [user, genre] = await Promise.all([getUserById(userId), getGenreById(id)]);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!genre) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const canModify = user.role === 'admin' ? genre.ownerId === null : genre.ownerId === user.id;
  if (!canModify) return NextResponse.json({ error: 'Δεν έχεις δικαίωμα' }, { status: 403 });
  return null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await assertCanModify(request, Number(id));
  if (denied) return denied;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const genre = await updateGenre(Number(id), parsed.data);
  return NextResponse.json(genre);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await assertCanModify(request, Number(id));
  if (denied) return denied;
  try {
    await deleteGenre(Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}
