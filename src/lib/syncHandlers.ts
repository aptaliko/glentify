// src/lib/syncHandlers.ts
import { nativeApiFetch } from './nativeApiFetch';
import { registerHandler } from './syncQueue';
import type { SyncOutcome } from './syncQueue';
import type { AddCollaboratorPayload, RemoveCollaboratorPayload } from './collaboratorsMerge';
import type { CreateProgramPayload, RenameProgramPayload, DeleteProgramPayload } from './programsMerge';
import type { CreateSongPayload, UpdateSongPayload, DeleteSongPayload } from './songsMerge';
import { loadDraftMap, recordResolution, resolveOne, resolveMany, isDraftId, type DraftEntity } from './draftIds';
import { loadSyncedVersionMap, recordSyncedVersion, resolveVersion } from './syncedVersions';
import { upload } from '@vercel/blob/client';
import { apiUrl } from './apiClient';
import { getAuthToken } from './authToken';
import { getLocalImage, deleteLocalImage, recordImageResolution, loadImageResolution } from './localImageStore';

interface TaxonomyCreatePayload { draftId: number; name: string; parentId: number | null }
interface TaxonomyDeletePayload { id: number }

const TAXONOMY_ENTITIES: DraftEntity[] = ['regions', 'genres', 'rhythms', 'dromoi', 'composers'];

function makeTaxonomyCreateHandler(entity: DraftEntity) {
  return async function (payload: unknown): Promise<SyncOutcome> {
    const { draftId, name, parentId } = payload as TaxonomyCreatePayload;
    // Regions can have a draft parent created earlier in the same offline session.
    let resolvedParent: number | null = parentId;
    if (parentId !== null && isDraftId(parentId)) {
      const map = await loadDraftMap();
      const r = resolveOne(map, 'regions', parentId);
      if (r === null) return 'item-error'; // parent create hasn't synced yet — wait
      resolvedParent = r;
    }
    const body = entity === 'regions' ? { name, parentId: resolvedParent } : { name };
    const res = await nativeApiFetch(
      `/api/${entity}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      undefined,
      { redirectOn401: false }
    );
    if (res.ok) {
      const created = await res.json();
      if (created && typeof created.id === 'number') await recordResolution(entity, draftId, created.id);
      return 'success';
    }
    if (res.status === 401 || res.status >= 500) return 'systemic-error';
    return 'item-error';
  };
}

function makeTaxonomyDeleteHandler(entity: DraftEntity) {
  return async function (payload: unknown): Promise<SyncOutcome> {
    const { id } = payload as TaxonomyDeletePayload;
    // A draft created and deleted in the same session: the create synced first and recorded
    // its real id; resolve to it. If unresolved, the create is still queued ahead — wait.
    let realId = id;
    if (isDraftId(id)) {
      const map = await loadDraftMap();
      const r = resolveOne(map, entity, id);
      if (r === null) return 'item-error';
      realId = r;
    }
    const res = await nativeApiFetch(
      `/api/${entity}/${encodeURIComponent(realId)}`,
      { method: 'DELETE' },
      undefined,
      { redirectOn401: false }
    );
    if (res.ok) return 'success';
    if (res.status === 404) return 'success'; // already gone
    if (res.status === 401 || res.status >= 500) return 'systemic-error';
    // 403 (non-owner) and 409 (still referenced by a song axis value / has child regions)
    // are both permanent — item-error retries to the cap, then surfaces via needsAttention.
    return 'item-error';
  };
}

export type SessionSavePayload =
  | { destination: 'new'; title: string; sequences: { title: string; songIds: number[] }[] }
  | { destination: 'existing'; programId: number; fallbackTitle: string; sequences: { title: string; songIds: number[] }[] };

async function handleSessionSaveSync(payload: unknown): Promise<SyncOutcome> {
  const data = payload as SessionSavePayload;
  const res = await nativeApiFetch(
    '/api/programs/save-sequences',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  // The target program is gone by the time this synced (deleted, or the user's access to
  // it was revoked — e.g. a queued program-delete for the same program synced first). The
  // desired end state can't be reached as originally requested, but unlike a collaborator
  // add/remove (where "nothing left to accomplish" makes 404-as-success correct), the
  // user's actual session content is real data that would otherwise be silently lost
  // forever in a permanently-stuck needsAttention item with no v1 recovery UI. Fall back
  // to creating a brand-new program with the same content instead of losing it.
  if (data.destination === 'existing' && res.status === 404) {
    const fallbackRes = await nativeApiFetch(
      '/api/programs/save-sequences',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: 'new', title: data.fallbackTitle, sequences: data.sequences }),
      },
      undefined,
      { redirectOn401: false }
    );
    if (fallbackRes.ok) return 'success';
    if (fallbackRes.status === 401 || fallbackRes.status >= 500) return 'systemic-error';
    return 'item-error';
  }
  return 'item-error';
}

async function handleAddCollaboratorSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, email } = payload as AddCollaboratorPayload;
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(programId)}/collaborators`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  // Already a collaborator by the time this synced (added by someone else, or by the
  // same offline actor twice) — the intent was already satisfied, nothing to retry.
  if (res.status === 409) return 'success';
  // The program (or the user's access to it) is already gone — e.g. a queued
  // program-delete for the same program synced first — so there's nothing left for this
  // queued add to accomplish, matching handleDeleteProgramSync's and
  // handleRemoveCollaboratorSync's 404-as-success precedent.
  if (res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleRemoveCollaboratorSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, userId } = payload as RemoveCollaboratorPayload;
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(programId)}/collaborators/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  // 404 covers two server-side causes (no program access at all, or the target isn't
  // currently a collaborator) that the client can't tell apart from the response —
  // both mean there's nothing left for this queued removal to accomplish.
  if (res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleCreateProgramSync(payload: unknown): Promise<SyncOutcome> {
  const { title } = payload as CreateProgramPayload;
  const res = await nativeApiFetch(
    '/api/programs',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleRenameProgramSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, title, baseVersion } = payload as RenameProgramPayload & { baseVersion?: number };
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(programId)}`,
    { method: 'PATCH', headers: await guardedHeaders('program', programId, baseVersion), body: JSON.stringify({ title }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body.version === 'number') await recordSyncedVersion('program', programId, body.version);
    return 'success';
  }
  if (res.status === 409 || res.status === 404) return 'conflict';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleDeleteProgramSync(payload: unknown): Promise<SyncOutcome> {
  const { programId } = payload as DeleteProgramPayload;
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(programId)}`,
    { method: 'DELETE' },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  // Already gone (someone else deleted it, or access is already gone) — the desired end
  // state is already true, matching sub-project #4's remove-collaborator 404-as-success
  // precedent.
  if (res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

// Resolves a pending offline image to a public URL for a song write.
//   - returns null when there is no pending image (caller sends payload.imageUrl as-is:
//     a real URL for an untouched image, or null for an untouched-empty / removed image)
//   - returns 'item-error' when bytes are missing AND unresolved (defensive; normally the
//     same submit that set pendingImageBlobId also stored the bytes)
//   - returns the URL when resolved from the map (skips re-upload) or after a fresh upload()
// A thrown/rejected upload() propagates out to processQueueWith, which maps it to
// systemic-error (pass stops, no attempt consumed) — correct for the offline case.
async function resolvePendingImageUrl(pendingImageBlobId: number | null | undefined): Promise<string | null | 'item-error'> {
  if (pendingImageBlobId === null || pendingImageBlobId === undefined) return null;
  const alreadyUploaded = await loadImageResolution(pendingImageBlobId);
  if (alreadyUploaded !== null) return alreadyUploaded;
  const local = await getLocalImage(pendingImageBlobId);
  if (local === null) return 'item-error';
  const token = await getAuthToken();
  const blob = await upload(local.filename, local.blob, {
    access: 'public',
    handleUploadUrl: apiUrl('/api/songs/image-upload'),
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  await recordImageResolution(pendingImageBlobId, blob.url);
  return blob.url;
}

async function handleCreateSongSync(payload: unknown): Promise<SyncOutcome> {
  const { pendingImageBlobId, ...rest } = payload as CreateSongPayload;
  const resolvedImage = await resolvePendingImageUrl(pendingImageBlobId);
  if (resolvedImage === 'item-error') return 'item-error';
  const body = { ...rest, imageUrl: resolvedImage ?? rest.imageUrl };
  const res = await nativeApiFetch(
    '/api/songs',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) {
    if (pendingImageBlobId != null) await deleteLocalImage(pendingImageBlobId);
    return 'success';
  }
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleUpdateSongSync(payload: unknown): Promise<SyncOutcome> {
  const { songId, pendingImageBlobId, ...rest } = payload as UpdateSongPayload;
  const resolvedImage = await resolvePendingImageUrl(pendingImageBlobId);
  if (resolvedImage === 'item-error') return 'item-error';
  const body = { ...rest, imageUrl: resolvedImage ?? rest.imageUrl };
  const res = await nativeApiFetch(
    `/api/songs/${encodeURIComponent(songId)}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    undefined,
    { redirectOn401: false }
  );
  // Already gone (deleted elsewhere before this update synced) — the desired end state
  // can't be reached, but there's nothing left to update either; matches
  // handleDeleteProgramSync's 404-as-success precedent.
  if (res.ok || res.status === 404) {
    if (pendingImageBlobId != null) await deleteLocalImage(pendingImageBlobId);
    return 'success';
  }
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleDeleteSongSync(payload: unknown): Promise<SyncOutcome> {
  const { songId } = payload as DeleteSongPayload;
  const res = await nativeApiFetch(
    `/api/songs/${encodeURIComponent(songId)}`,
    { method: 'DELETE' },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  // Already gone — the desired end state is already true. Reachable as a genuine 404
  // since Task 1 fixed the route to distinguish "not found" from a real conflict.
  if (res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  // 409: a real, permanent conflict (song already played in a session, or is a session's
  // current song — deleteSong's own documented conflict cases). item-error, retried up
  // to the existing cap, then needsAttention; mergeSongsWithPending's needs-attention
  // delete case makes the row reappear rather than staying hidden once this happens.
  return 'item-error';
}

interface SeqCreatePayload { draftId: number; programId: number; title: string }
interface SeqRenamePayload { programId: number; sequenceId: number; title: string; baseVersion?: number }
interface SeqDeletePayload { programId: number; sequenceId: number }
interface SeqAddSongPayload { draftId: number; programId: number; sequenceId: number; songId: number }
interface SeqRemoveSongPayload { programId: number; sequenceId: number; sequenceSongId: number }
interface SeqReorderPayload { programId: number; sequenceId: number; orderedIds: number[]; baseVersion?: number }

// Resolves a possibly-draft id against the current draft map; returns null if still
// unresolved (caller returns item-error to wait for the create ahead in the queue).
async function resolveSeqId(entity: 'sequence' | 'sequence-song' | 'song', id: number): Promise<number | null> {
  if (!isDraftId(id)) return id;
  const map = await loadDraftMap();
  return resolveOne(map, entity, id);
}

// Builds headers for a guarded write: attaches If-Match only when a baseVersion is present,
// forwarding it past the device's own already-synced writes so a user's consecutive offline
// edits to one resource don't 409 against themselves.
async function guardedHeaders(resource: 'sequence' | 'program', id: number, baseVersion: number | undefined): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof baseVersion === 'number') {
    const map = await loadSyncedVersionMap();
    const resolved = resolveVersion(map, resource, id, baseVersion);
    // Only guard with a real version (>= 1). A resolved 0 means the base came from a pre-feature
    // cache blob and the device has no recorded version for this resource, so send no If-Match
    // (last-write-wins) rather than a guard that could never legitimately match.
    if (resolved >= 1) headers['If-Match'] = String(resolved);
  }
  return headers;
}

async function handleSequenceCreateSync(payload: unknown): Promise<SyncOutcome> {
  const { draftId, programId, title } = payload as SeqCreatePayload;
  const pid = await resolveSeqId('sequence', programId); // program may itself be a draft
  if (pid === null) return 'item-error';
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(pid)}/sequences`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) {
    const created = await res.json();
    if (created && typeof created.id === 'number') await recordResolution('sequence', draftId, created.id);
    return 'success';
  }
  if (res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleSequenceRenameSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, sequenceId, title, baseVersion } = payload as SeqRenamePayload;
  const pid = await resolveSeqId('sequence', programId);
  const sid = await resolveSeqId('sequence', sequenceId);
  if (pid === null || sid === null) return 'item-error';
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(pid)}/sequences/${encodeURIComponent(sid)}`,
    { method: 'PATCH', headers: await guardedHeaders('sequence', sid, baseVersion), body: JSON.stringify({ title }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body.version === 'number') await recordSyncedVersion('sequence', sid, body.version);
    return 'success';
  }
  if (res.status === 409 || res.status === 404) return 'conflict';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleSequenceDeleteSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, sequenceId } = payload as SeqDeletePayload;
  const pid = await resolveSeqId('sequence', programId);
  const sid = await resolveSeqId('sequence', sequenceId);
  if (pid === null || sid === null) return 'item-error';
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(pid)}/sequences/${encodeURIComponent(sid)}`,
    { method: 'DELETE' },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok || res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleSequenceAddSongSync(payload: unknown): Promise<SyncOutcome> {
  const { draftId, programId, sequenceId, songId } = payload as SeqAddSongPayload;
  const pid = await resolveSeqId('sequence', programId);
  const sid = await resolveSeqId('sequence', sequenceId);
  const song = await resolveSeqId('song', songId);
  if (pid === null || sid === null || song === null) return 'item-error';
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(pid)}/sequences/${encodeURIComponent(sid)}/songs`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ songId: song }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) {
    const body = await res.json().catch(() => null);
    // The route returns { ok: true }; if it also returns the join-row id, record it so a
    // later reorder/remove referencing this draft entry can resolve. When absent, a draft
    // remove/reorder of this brand-new entry can't resolve and will surface via needsAttention
    // — acceptable v1 (the common flow adds then syncs before reordering).
    if (body && typeof body.sequenceSongId === 'number') await recordResolution('sequence-song', draftId, body.sequenceSongId);
    // add-song bumps the sequence version server-side; record it so a following guarded
    // reorder/rename on this sequence forwards past it instead of false-conflicting.
    if (body && typeof body.version === 'number') await recordSyncedVersion('sequence', sid, body.version);
    return 'success';
  }
  if (res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleSequenceRemoveSongSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, sequenceId, sequenceSongId } = payload as SeqRemoveSongPayload;
  const pid = await resolveSeqId('sequence', programId);
  const sid = await resolveSeqId('sequence', sequenceId);
  const entry = await resolveSeqId('sequence-song', sequenceSongId);
  if (pid === null || sid === null || entry === null) return 'item-error';
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(pid)}/sequences/${encodeURIComponent(sid)}/songs/${encodeURIComponent(entry)}`,
    { method: 'DELETE' },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) {
    const body = await res.json().catch(() => null);
    // remove-song bumps the sequence version too — record it for the same reason as add-song.
    if (body && typeof body.version === 'number') await recordSyncedVersion('sequence', sid, body.version);
    return 'success';
  }
  if (res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleSequenceReorderSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, sequenceId, orderedIds, baseVersion } = payload as SeqReorderPayload;
  const pid = await resolveSeqId('sequence', programId);
  const sid = await resolveSeqId('sequence', sequenceId);
  if (pid === null || sid === null) return 'item-error';
  const map = await loadDraftMap();
  const resolved = resolveMany(map, 'sequence-song', orderedIds);
  if (!resolved.allResolved) return 'item-error';
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(pid)}/sequences/${encodeURIComponent(sid)}/songs`,
    { method: 'PATCH', headers: await guardedHeaders('sequence', sid, baseVersion), body: JSON.stringify({ orderedIds: resolved.ids }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body.version === 'number') await recordSyncedVersion('sequence', sid, body.version);
    return 'success';
  }
  if (res.status === 409 || res.status === 404) return 'conflict';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

// The single place every sync-queue action type gets registered. Called once per app
// load by SyncQueueProvider; the `initialized` guard makes a second call (e.g. from a
// React effect re-running) a harmless no-op instead of double-registering.
let initialized = false;

export function initSyncHandlers(): void {
  if (initialized) return;
  initialized = true;
  registerHandler('session-save', handleSessionSaveSync);
  registerHandler('program-add-collaborator', handleAddCollaboratorSync);
  registerHandler('program-remove-collaborator', handleRemoveCollaboratorSync);
  registerHandler('program-create', handleCreateProgramSync);
  registerHandler('program-rename', handleRenameProgramSync);
  registerHandler('program-delete', handleDeleteProgramSync);
  registerHandler('song-create', handleCreateSongSync);
  registerHandler('song-update', handleUpdateSongSync);
  registerHandler('song-delete', handleDeleteSongSync);
  for (const entity of TAXONOMY_ENTITIES) {
    registerHandler(`${entity}-create`, makeTaxonomyCreateHandler(entity));
    registerHandler(`${entity}-delete`, makeTaxonomyDeleteHandler(entity));
  }
  registerHandler('sequence-create', handleSequenceCreateSync);
  registerHandler('sequence-rename', handleSequenceRenameSync);
  registerHandler('sequence-delete', handleSequenceDeleteSync);
  registerHandler('sequence-add-song', handleSequenceAddSongSync);
  registerHandler('sequence-remove-song', handleSequenceRemoveSongSync);
  registerHandler('sequence-reorder', handleSequenceReorderSync);
}
