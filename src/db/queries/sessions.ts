import { db } from '../client';
import { sessions, sessionPlayedSongs } from '../schema';
import { eq, isNull, desc, and } from 'drizzle-orm';
import type { SessionRow } from '../schema';

export async function getActiveSession(ownerId: number): Promise<SessionRow | undefined> {
  const rows = await db
    .select()
    .from(sessions)
    .where(and(isNull(sessions.endedAt), eq(sessions.ownerId, ownerId)))
    .orderBy(desc(sessions.startedAt));
  return rows[0];
}

async function endAllActiveSessionsForOwner(ownerId: number): Promise<void> {
  const openSessions = await db
    .select({ id: sessions.id, currentSongId: sessions.currentSongId })
    .from(sessions)
    .where(and(isNull(sessions.endedAt), eq(sessions.ownerId, ownerId)));
  for (const session of openSessions) {
    await markCurrentAsPlayedIfAny(session.id, session.currentSongId);
  }
  await db
    .update(sessions)
    .set({ currentSongId: null, endedAt: new Date() })
    .where(and(isNull(sessions.endedAt), eq(sessions.ownerId, ownerId)));
}

export async function createSession(ownerId: number, label: string | null, startingSongId: number): Promise<SessionRow> {
  // Guarantee at most one active session per owner: starting a new one implicitly ends any
  // previous one still open, so sessions never silently pile up. getActiveSession already
  // assumes single-active-session semantics (it just returns the most recent open one), and
  // the home page's "active session" banner only ever shows one — this keeps that assumption
  // true in the data, not just in the UI.
  await endAllActiveSessionsForOwner(ownerId);
  const rows = await db.insert(sessions).values({ ownerId, label, currentSongId: startingSongId }).returning();
  return rows[0];
}

export async function getSessionById(ownerId: number, id: number): Promise<SessionRow | undefined> {
  const rows = await db.select().from(sessions).where(and(eq(sessions.id, id), eq(sessions.ownerId, ownerId)));
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

// Unscoped internal lookup: callers of advanceToSong/endSequence/endSession are expected to have
// already verified ownership via the exported, owner-scoped getSessionById (see route handlers),
// so these helpers only need the row's currentSongId and must not duplicate that check.
async function getSessionByIdUnscoped(id: number): Promise<SessionRow | undefined> {
  const rows = await db.select().from(sessions).where(eq(sessions.id, id));
  return rows[0];
}

export async function advanceToSong(sessionId: number, nextSongId: number): Promise<void> {
  const session = await getSessionByIdUnscoped(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  await markCurrentAsPlayedIfAny(sessionId, session.currentSongId);
  await db.update(sessions).set({ currentSongId: nextSongId }).where(eq(sessions.id, sessionId));
}

export async function endSequence(sessionId: number): Promise<void> {
  const session = await getSessionByIdUnscoped(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  await markCurrentAsPlayedIfAny(sessionId, session.currentSongId);
  await db.update(sessions).set({ currentSongId: null }).where(eq(sessions.id, sessionId));
}

export async function endSession(sessionId: number): Promise<void> {
  const session = await getSessionByIdUnscoped(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  await markCurrentAsPlayedIfAny(sessionId, session.currentSongId);
  await db.update(sessions).set({ currentSongId: null, endedAt: new Date() }).where(eq(sessions.id, sessionId));
}
