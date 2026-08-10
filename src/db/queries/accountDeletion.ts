import { db } from '../client';
import {
  users,
  songs,
  programs,
  sessions,
  sessionPlayedSongs,
  programSequences,
  sequenceSongs,
  programCollaborators,
  songAxisValues,
  regions,
  rhythms,
  dromoi,
  genres,
  composers,
  passwordResetTokens,
} from '../schema';
import { eq, inArray } from 'drizzle-orm';

export async function deleteUserCascade(userId: number): Promise<void> {
  const ownedSongs = await db.select({ id: songs.id }).from(songs).where(eq(songs.ownerId, userId));
  const songIds = ownedSongs.map((s) => s.id);

  const ownedPrograms = await db.select({ id: programs.id }).from(programs).where(eq(programs.ownerId, userId));
  const programIds = ownedPrograms.map((p) => p.id);
  const sequences = programIds.length
    ? await db.select({ id: programSequences.id }).from(programSequences).where(inArray(programSequences.programId, programIds))
    : [];
  const sequenceIds = sequences.map((s) => s.id);

  const ownedSessions = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.ownerId, userId));
  const sessionIds = ownedSessions.map((s) => s.id);

  // Clear every sequence entry in programs this user owns (their own content AND any
  // collaborator's songs added to those sequences) — required before the programSequences
  // delete below, since sequence_songs has no ON DELETE CASCADE.
  if (sequenceIds.length) await db.delete(sequenceSongs).where(inArray(sequenceSongs.sequenceId, sequenceIds));
  // Also clear this user's own songs out of sequences in *other* users' shared programs
  // where this user was a collaborator — required before the songs delete below, and this
  // is the cross-user cleanup a plain per-owner cascade would otherwise miss.
  if (songIds.length) await db.delete(sequenceSongs).where(inArray(sequenceSongs.songId, songIds));

  if (programIds.length) await db.delete(programSequences).where(inArray(programSequences.programId, programIds));
  if (sessionIds.length) await db.delete(sessionPlayedSongs).where(inArray(sessionPlayedSongs.sessionId, sessionIds));
  if (songIds.length) await db.delete(songAxisValues).where(inArray(songAxisValues.songId, songIds));

  // program_collaborators has no ON DELETE CASCADE either: clear this user's own
  // memberships on other people's programs, and clear anyone else's membership on the
  // programs this user owns — both must go before the `programs` delete below.
  await db.delete(programCollaborators).where(eq(programCollaborators.userId, userId));
  if (programIds.length) await db.delete(programCollaborators).where(inArray(programCollaborators.programId, programIds));

  await db.delete(programs).where(eq(programs.ownerId, userId));
  await db.delete(sessions).where(eq(sessions.ownerId, userId));
  await db.delete(songs).where(eq(songs.ownerId, userId));

  await db.delete(regions).where(eq(regions.ownerId, userId));
  await db.delete(rhythms).where(eq(rhythms.ownerId, userId));
  await db.delete(dromoi).where(eq(dromoi.ownerId, userId));
  await db.delete(genres).where(eq(genres.ownerId, userId));
  await db.delete(composers).where(eq(composers.ownerId, userId));

  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}
