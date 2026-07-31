import { db } from '../client';
import { sessions, sessionPlayedSongs } from '../schema';
import { eq, isNull, desc } from 'drizzle-orm';
import type { SessionRow } from '../schema';

export async function getActiveSession(): Promise<SessionRow | undefined> {
  const rows = await db.select().from(sessions).where(isNull(sessions.endedAt)).orderBy(desc(sessions.startedAt));
  return rows[0];
}

export async function createSession(label: string | null, startingSongId: number): Promise<SessionRow> {
  const rows = await db.insert(sessions).values({ label, currentSongId: startingSongId }).returning();
  return rows[0];
}

export async function getSessionById(id: number): Promise<SessionRow | undefined> {
  const rows = await db.select().from(sessions).where(eq(sessions.id, id));
  return rows[0];
}

export async function getPlayedSongIds(sessionId: number): Promise<number[]> {
  const rows = await db
    .select({ songId: sessionPlayedSongs.songId })
    .from(sessionPlayedSongs)
    .where(eq(sessionPlayedSongs.sessionId, sessionId));
  return rows.map((r) => r.songId);
}

async function markCurrentAsPlayedIfAny(sessionId: number, currentSongId: number | null): Promise<void> {
  if (currentSongId !== null) {
    await db.insert(sessionPlayedSongs).values({ sessionId, songId: currentSongId });
  }
}

export async function advanceToSong(sessionId: number, nextSongId: number): Promise<void> {
  const session = await getSessionById(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  await markCurrentAsPlayedIfAny(sessionId, session.currentSongId);
  await db.update(sessions).set({ currentSongId: nextSongId }).where(eq(sessions.id, sessionId));
}

export async function endSequence(sessionId: number): Promise<void> {
  const session = await getSessionById(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  await markCurrentAsPlayedIfAny(sessionId, session.currentSongId);
  await db.update(sessions).set({ currentSongId: null }).where(eq(sessions.id, sessionId));
}

export async function endSession(sessionId: number): Promise<void> {
  const session = await getSessionById(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  await markCurrentAsPlayedIfAny(sessionId, session.currentSongId);
  await db.update(sessions).set({ currentSongId: null, endedAt: new Date() }).where(eq(sessions.id, sessionId));
}
