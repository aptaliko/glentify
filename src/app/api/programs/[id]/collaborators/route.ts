import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getProgramAccess, getProgramById, listCollaborators, addCollaborator, isCollaborator } from '@/db/queries/programs';
import { getUserByEmail, getUserById } from '@/db/queries/users';
import { getUserId } from '@/lib/requestUser';

const addSchema = z.object({ email: z.email() });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(request);
  const { id } = await params;
  const role = await getProgramAccess(userId, Number(id));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const program = await getProgramById(Number(id));
  const creator = program ? await getUserById(program.ownerId) : undefined;
  const collaborators = await listCollaborators(Number(id));
  return NextResponse.json({
    creator: creator ? { id: creator.id, email: creator.email } : null,
    collaborators,
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(request);
  const { id } = await params;
  const role = await getProgramAccess(userId, Number(id));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  if (role !== 'creator') {
    return NextResponse.json({ error: 'Μόνο ο δημιουργός μπορεί να προσθέσει συνεργάτες' }, { status: 403 });
  }

  const parsed = addSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const target = await getUserByEmail(parsed.data.email);
  if (!target) return NextResponse.json({ error: 'Δεν βρέθηκε χρήστης με αυτό το email' }, { status: 404 });
  if (target.id === userId) {
    return NextResponse.json({ error: 'Είσαι ήδη ο δημιουργός αυτού του προγράμματος' }, { status: 400 });
  }
  if (await isCollaborator(Number(id), target.id)) {
    return NextResponse.json({ error: 'Είναι ήδη συνεργάτης' }, { status: 409 });
  }

  await addCollaborator(Number(id), target.id);
  const program = await getProgramById(Number(id));
  const creator = program ? await getUserById(program.ownerId) : undefined;
  return NextResponse.json({
    creator: creator ? { id: creator.id, email: creator.email } : null,
    collaborators: await listCollaborators(Number(id)),
  }, { status: 201 });
}
