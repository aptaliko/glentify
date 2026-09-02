import { describe, it, expect } from 'vitest';
import { toProgramDetail, toCollaboratorsView, buildSongTitleMap } from './offlineProgramView';
import type { OfflineProgram } from './referenceData';
import type { SongRow } from '@/db/schema';

const FIXED = new Date('2026-01-01T00:00:00.000Z');
function song(id: number, title: string): SongRow {
  return { id, title, lyrics: null, imageUrl: null, notes: null, maleKey: null, femaleKey: null, ownerId: 1, createdAt: FIXED, updatedAt: FIXED };
}

const program: OfflineProgram = {
  id: 7, title: 'Πρόγραμμα', role: 'collaborator', sharedWithEmails: ['a@b.gr'],
  creator: { id: 2, email: 'a@b.gr' }, collaborators: [{ id: 3, email: 'c@d.gr' }],
  sequences: [{
    id: 10, title: 'Σειρά 1', songIds: [1, 2],
    entries: [{ sequenceSongId: 100, songId: 1 }, { sequenceSongId: 101, songId: 2 }],
  }],
};

describe('buildSongTitleMap', () => {
  it('maps ids to titles across owned and shared songs', () => {
    const m = buildSongTitleMap([song(1, 'Ένα')], [song(2, 'Δύο')]);
    expect(m.get(1)).toBe('Ένα');
    expect(m.get(2)).toBe('Δύο');
  });
});

describe('toProgramDetail', () => {
  it('reshapes a program into CachedProgramDetail with per-entry sequenceSongId and resolved titles', () => {
    const detail = toProgramDetail(program, buildSongTitleMap([song(1, 'Ένα'), song(2, 'Δύο')], []));
    expect(detail.programId).toBe(7);
    expect(detail.title).toBe('Πρόγραμμα');
    expect(detail.role).toBe('collaborator');
    expect(detail.sequences[0].songs).toEqual([
      { sequenceSongId: 100, songId: 1, title: 'Ένα' },
      { sequenceSongId: 101, songId: 2, title: 'Δύο' },
    ]);
  });

  it('falls back to em-dash for an unresolved song title', () => {
    const detail = toProgramDetail(program, new Map());
    expect(detail.sequences[0].songs[0].title).toBe('—');
  });

  it('assigns sequence positions by array order', () => {
    const detail = toProgramDetail(program, new Map());
    expect(detail.sequences[0].position).toBe(0);
  });
});

describe('toCollaboratorsView', () => {
  it('passes role, creator, collaborators, and currentUser through from the blob', () => {
    const cu = { id: 3, email: 'c@d.gr' };
    const view = toCollaboratorsView(program, cu);
    expect(view).toEqual({
      role: 'collaborator',
      creator: { id: 2, email: 'a@b.gr' },
      collaborators: [{ id: 3, email: 'c@d.gr' }],
      currentUser: cu,
    });
  });
});
