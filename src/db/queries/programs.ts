import { db } from '../client';
import { programs, programSequences, sequenceSongs, songs } from '../schema';
import { eq, and, asc, max } from 'drizzle-orm';
import type { ProgramRow, ProgramSequenceRow, SongRow } from '../schema';
import type { OfflineProgram } from '@/lib/referenceData';

export async function listPrograms(ownerId: number): Promise<ProgramRow[]> {
  return db.select().from(programs).where(eq(programs.ownerId, ownerId));
}

export async function getProgramById(ownerId: number, id: number): Promise<ProgramRow | undefined> {
  const rows = await db.select().from(programs).where(and(eq(programs.id, id), eq(programs.ownerId, ownerId)));
  return rows[0];
}

export async function createProgram(ownerId: number, title: string): Promise<ProgramRow> {
  const rows = await db.insert(programs).values({ ownerId, title }).returning();
  return rows[0];
}

export async function updateProgram(ownerId: number, id: number, title: string): Promise<ProgramRow | undefined> {
  const rows = await db
    .update(programs)
    .set({ title })
    .where(and(eq(programs.id, id), eq(programs.ownerId, ownerId)))
    .returning();
  return rows[0];
}

export async function deleteProgram(ownerId: number, id: number): Promise<void> {
  const program = await getProgramById(ownerId, id);
  if (!program) throw new Error('Το πρόγραμμα δεν βρέθηκε');
  const sequences = await db.select({ id: programSequences.id }).from(programSequences).where(eq(programSequences.programId, id));
  for (const seq of sequences) {
    await db.delete(sequenceSongs).where(eq(sequenceSongs.sequenceId, seq.id));
  }
  await db.delete(programSequences).where(eq(programSequences.programId, id));
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
  const rows = await db.update(programSequences).set({ title }).where(eq(programSequences.id, id)).returning();
  return rows[0];
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

export async function addSongToSequence(sequenceId: number, songId: number): Promise<void> {
  const [{ value }] = await db
    .select({ value: max(sequenceSongs.position) })
    .from(sequenceSongs)
    .where(eq(sequenceSongs.sequenceId, sequenceId));
  const nextPosition = (value ?? -1) + 1;
  await db.insert(sequenceSongs).values({ sequenceId, songId, position: nextPosition });
}

export async function removeSongFromSequence(sequenceSongId: number): Promise<void> {
  await db.delete(sequenceSongs).where(eq(sequenceSongs.id, sequenceSongId));
}

export async function reorderSequenceSongs(sequenceId: number, orderedSequenceSongIds: number[]): Promise<void> {
  for (const [position, sequenceSongId] of orderedSequenceSongIds.entries()) {
    await db
      .update(sequenceSongs)
      .set({ position })
      .where(and(eq(sequenceSongs.id, sequenceSongId), eq(sequenceSongs.sequenceId, sequenceId)));
  }
}

export async function listProgramsWithSequencesAndSongs(ownerId: number): Promise<OfflineProgram[]> {
  const programList = await listPrograms(ownerId);
  return Promise.all(
    programList.map(async (program) => {
      const sequenceList = await listSequencesForProgram(program.id);
      const sequences = await Promise.all(
        sequenceList.map(async (sequence) => {
          const entries = await listSongsForSequence(sequence.id);
          return { id: sequence.id, title: sequence.title, songIds: entries.map((e) => e.song.id) };
        })
      );
      return { id: program.id, title: program.title, sequences };
    })
  );
}
