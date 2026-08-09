import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRegionById, updateRegion, deleteRegion } from '@/db/queries/regions';
import { getUserId } from '@/lib/requestUser';
import { getUserById } from '@/db/queries/users';

const updateSchema = z.object({ name: z.string().min(1), parentId: z.number().int().nullable() });

async function assertCanModify(request: NextRequest, id: number): Promise<NextResponse | null> {
  const userId = getUserId(request);
  const [user, region] = await Promise.all([getUserById(userId), getRegionById(id)]);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!region) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const canModify = user.role === 'admin' ? region.ownerId === null : region.ownerId === user.id;
  if (!canModify) return NextResponse.json({ error: 'Δεν έχεις δικαίωμα' }, { status: 403 });
  return null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await assertCanModify(request, Number(id));
  if (denied) return denied;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const region = await updateRegion(Number(id), parsed.data);
  return NextResponse.json(region);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await assertCanModify(request, Number(id));
  if (denied) return denied;
  try {
    await deleteRegion(Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}
