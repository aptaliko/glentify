import { db } from '../client';
import { programs, programSequences, sequenceSongs, songs, programCollaborators } from '../schema';
import { eq, and, asc, max, inArray, sql } from 'drizzle-orm';
import type { ProgramRow, ProgramSequenceRow, SongRow } from '../schema';
import type { OfflineProgram } from '@/lib/referenceData';
import { getUserById } from './users';

export type ProgramAccessRole = 'creator' | 'collaborator' | null;

export async function getProgramById(id: number): Promise<ProgramRow | undefined> {
  const rows = await db.select().from(programs).where(eq(programs.id, id));
  return rows[0];
}

export async function getProgramAccess(userId: number, programId: number): Promise<ProgramAccessRole> {
  const program = await getProgramById(programId);
  if (!program) return null;
  if (program.ownerId === userId) return 'creator';
  const rows = await db
    .select()
    .from(programCollaborators)
    .where(and(eq(programCollaborators.programId, programId), eq(programCollaborators.userId, userId)));
  return rows[0] ? 'collaborator' : null;
}

export async function listPrograms(ownerId: number): Promise<ProgramRow[]> {
  return db.select().from(programs).where(eq(programs.ownerId, ownerId));
}

export async function createProgram(ownerId: number, title: string): Promise<ProgramRow> {
  const rows = await db.insert(programs).values({ ownerId, title }).returning();
  return rows[0];
}

export async function updateProgram(id: number, title: string): Promise<ProgramRow | undefined> {
  const rows = await db
    .update(programs)
    .set({ title, version: sql`${programs.version} + 1` })
    .where(eq(programs.id, id))
    .returning();
  return rows[0];
}

export async function updateProgramIfMatch(
  id: number,
  title: string,
  expectedVersion: number
): Promise<ProgramRow | null> {
  const rows = await db
    .update(programs)
    .set({ title, version: sql`${programs.version} + 1` })
    .where(and(eq(programs.id, id), eq(programs.version, expectedVersion)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteProgram(id: number): Promise<void> {
  const sequences = await db.select({ id: programSequences.id }).from(programSequences).where(eq(programSequences.programId, id));
  const sequenceIds = sequences.map((s) => s.id);
  if (sequenceIds.length) await db.delete(sequenceSongs).where(inArray(sequenceSongs.sequenceId, sequenceIds));
  await db.delete(programSequences).where(eq(programSequences.programId, id));
  await db.delete(programCollaborators).where(eq(programCollaborators.programId, id));
  await db.delete(programs).where(eq(programs.id, id));
}

export async function listSequencesForProgram(programId: number): Promise<ProgramSequenceRow[]> {
  return db.select().from(programSequences).where(eq(programSequences.programId, programId)).orderBy(asc(programSequences.position));
}

export async function getSequenceById(id: number): Promise<ProgramSequenceRow | undefined> {
  const rows = await db.select().from(programSequences).where(eq(programSequences.id, id));
  return rows[0];
}

export async function createSequence(programId: number, title: string): Promise<ProgramSequenceRow> {
  const [{ value }] = await db
    .select({ value: max(programSequences.position) })
    .from(programSequences)
    .where(eq(programSequences.programId, programId));
  const nextPosition = (value ?? -1) + 1;
  const rows = await db.insert(programSequences).values({ programId, title, position: nextPosition }).returning();
  return rows[0];
}

export async function updateSequence(id: number, title: string): Promise<ProgramSequenceRow> {
  const rows = await db
    .update(programSequences)
    .set({ title, version: sql`${programSequences.version} + 1` })
    .where(eq(programSequences.id, id))
    .returning();
  return rows[0];
}

export async function updateSequenceIfMatch(
  id: number,
  title: string,
  expectedVersion: number
): Promise<ProgramSequenceRow | null> {
  const rows = await db
    .update(programSequences)
    .set({ title, version: sql`${programSequences.version} + 1` })
    .where(and(eq(programSequences.id, id), eq(programSequences.version, expectedVersion)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteSequence(id: number): Promise<void> {
  await db.delete(sequenceSongs).where(eq(sequenceSongs.sequenceId, id));
  await db.delete(programSequences).where(eq(programSequences.id, id));
}

export interface SequenceSongEntry {
  sequenceSongId: number;
  song: SongRow;
}

export async function listSongsForSequence(sequenceId: number): Promise<SequenceSongEntry[]> {
  const rows = await db
    .select({ sequenceSongId: sequenceSongs.id, song: songs })
    .from(sequenceSongs)
    .innerJoin(songs, eq(sequenceSongs.songId, songs.id))
    .where(eq(sequenceSongs.sequenceId, sequenceId))
    .orderBy(asc(sequenceSongs.position));
  return rows;
}

export async function bumpSequenceVersion(sequenceId: number): Promise<void> {
  await db
    .update(programSequences)
    .set({ version: sql`${programSequences.version} + 1` })
    .where(eq(programSequences.id, sequenceId));
}

export async function bumpSequenceVersionIfMatch(
  sequenceId: number,
  expectedVersion: number
): Promise<number | null> {
  const rows = await db
    .update(programSequences)
    .set({ version: sql`${programSequences.version} + 1` })
    .where(and(eq(programSequences.id, sequenceId), eq(programSequences.version, expectedVersion)))
    .returning({ version: programSequences.version });
  return rows[0]?.version ?? null;
}

export async function addSongToSequence(sequenceId: number, songId: number): Promise<void> {
  const [{ value }] = await db
    .select({ value: max(sequenceSongs.position) })
    .from(sequenceSongs)
    .where(eq(sequenceSongs.sequenceId, sequenceId));
  const nextPosition = (value ?? -1) + 1;
  await db.insert(sequenceSongs).values({ sequenceId, songId, position: nextPosition });
  await bumpSequenceVersion(sequenceId);
}

export async function removeSongFromSequence(sequenceId: number, sequenceSongId: number): Promise<void> {
  await db.delete(sequenceSongs).where(eq(sequenceSongs.id, sequenceSongId));
  await bumpSequenceVersion(sequenceId);
}

// Applies the positional updates without touching the sequence version. Used by the
// guarded reorder branch, where the If-Match gate has already bumped the version — so
// the response's version stays consistent with the DB and a user's own consecutive
// offline reorders don't false-conflict.
export async function applySequenceSongOrder(sequenceId: number, orderedSequenceSongIds: number[]): Promise<void> {
  for (const [position, sequenceSongId] of orderedSequenceSongIds.entries()) {
    await db
      .update(sequenceSongs)
      .set({ position })
      .where(and(eq(sequenceSongs.id, sequenceSongId), eq(sequenceSongs.sequenceId, sequenceId)));
  }
}

export async function reorderSequenceSongs(sequenceId: number, orderedSequenceSongIds: number[]): Promise<void> {
  await applySequenceSongOrder(sequenceId, orderedSequenceSongIds);
  await bumpSequenceVersion(sequenceId);
}

export async function listProgramsWithSequencesAndSongs(userId: number): Promise<OfflineProgram[]> {
  const programList = await listAccessiblePrograms(userId);
  return Promise.all(
    programList.map(async (program) => {
      const sequenceList = await listSequencesForProgram(program.id);
      const sequences = await Promise.all(
        sequenceList.map(async (sequence) => {
          const seqEntries = await listSongsForSequence(sequence.id);
          return {
            id: sequence.id,
            title: sequence.title,
            songIds: seqEntries.map((e) => e.song.id),
            entries: seqEntries.map((e) => ({ sequenceSongId: e.sequenceSongId, songId: e.song.id })),
          };
        })
      );
      return {
        id: program.id,
        title: program.title,
        role: program.role,
        sharedWithEmails: program.sharedWithEmails,
        creator: program.creator,
        collaborators: program.collaborators,
        sequences,
      };
    })
  );
}

export interface AccessibleProgram {
  id: number;
  title: string;
  role: 'creator' | 'collaborator';
  sharedWithEmails: string[];
  creator: { id: number; email: string } | null;
  collaborators: { id: number; email: string }[];
}

export async function listCollaborators(programId: number): Promise<{ id: number; email: string }[]> {
  const rows = await db
    .select({ userId: programCollaborators.userId })
    .from(programCollaborators)
    .where(eq(programCollaborators.programId, programId));
  const users = await Promise.all(rows.map((r) => getUserById(r.userId)));
  return users.filter((u): u is NonNullable<typeof u> => u !== undefined).map((u) => ({ id: u.id, email: u.email }));
}

export async function isCollaborator(programId: number, userId: number): Promise<boolean> {
  const rows = await db
    .select()
    .from(programCollaborators)
    .where(and(eq(programCollaborators.programId, programId), eq(programCollaborators.userId, userId)));
  return rows.length > 0;
}

export async function addCollaborator(programId: number, userId: number): Promise<void> {
  await db.insert(programCollaborators).values({ programId, userId });
}

export async function removeCollaboratorContent(programId: number, userId: number): Promise<void> {
  const sequences = await db.select({ id: programSequences.id }).from(programSequences).where(eq(programSequences.programId, programId));
  const sequenceIds = sequences.map((s) => s.id);
  if (sequenceIds.length === 0) return;
  const userSongs = await db.select({ id: songs.id }).from(songs).where(eq(songs.ownerId, userId));
  const userSongIds = userSongs.map((s) => s.id);
  if (userSongIds.length === 0) return;
  await db
    .delete(sequenceSongs)
    .where(and(inArray(sequenceSongs.sequenceId, sequenceIds), inArray(sequenceSongs.songId, userSongIds)));
}

export async function removeCollaborator(programId: number, userId: number): Promise<void> {
  await removeCollaboratorContent(programId, userId);
  await db
    .delete(programCollaborators)
    .where(and(eq(programCollaborators.programId, programId), eq(programCollaborators.userId, userId)));
}

export async function listAccessiblePrograms(userId: number): Promise<AccessibleProgram[]> {
  const owned = await listPrograms(userId);
  const collabRows = await db
    .select({ program: programs })
    .from(programCollaborators)
    .innerJoin(programs, eq(programCollaborators.programId, programs.id))
    .where(eq(programCollaborators.userId, userId));
  const collaborated = collabRows.map((r) => r.program);

  async function summarize(program: ProgramRow, role: 'creator' | 'collaborator'): Promise<AccessibleProgram> {
    const collaborators = await listCollaborators(program.id);
    const creator = program.ownerId === userId ? null : await getUserById(program.ownerId);
    const emails = [
      ...(creator ? [creator.email] : []),
      ...collaborators.filter((c) => c.id !== userId).map((c) => c.email),
    ];
    return {
      id: program.id,
      title: program.title,
      role,
      sharedWithEmails: emails,
      creator: creator ? { id: creator.id, email: creator.email } : null,
      collaborators,
    };
  }

  return Promise.all([
    ...owned.map((p) => summarize(p, 'creator' as const)),
    ...collaborated.map((p) => summarize(p, 'collaborator' as const)),
  ]);
}

export async function appendSequencesToProgram(
  programId: number,
  groups: { title: string; songIds: number[] }[]
): Promise<void> {
  for (const group of groups) {
    const sequence = await createSequence(programId, group.title);
    for (const songId of group.songIds) {
      await addSongToSequence(sequence.id, songId);
    }
  }
}

export async function createProgramFromGroups(
  ownerId: number,
  title: string,
  groups: { title: string; songIds: number[] }[]
): Promise<ProgramRow> {
  const program = await createProgram(ownerId, title);
  await appendSequencesToProgram(program.id, groups);
  return program;
}
