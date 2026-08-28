import { describe, it, expect } from 'vitest';
import { groupBySequenceIndex } from './sessionGrouping';

interface Row {
  songId: number;
  sequenceIndex: number;
}

describe('groupBySequenceIndex', () => {
  it('returns an empty array for no rows', () => {
    expect(groupBySequenceIndex<Row>([])).toEqual([]);
  });

  it('puts a single sequenceIndex run into one group', () => {
    const rows: Row[] = [
      { songId: 1, sequenceIndex: 0 },
      { songId: 2, sequenceIndex: 0 },
    ];
    expect(groupBySequenceIndex(rows)).toEqual([[
      { songId: 1, sequenceIndex: 0 },
      { songId: 2, sequenceIndex: 0 },
    ]]);
  });

  it('splits into a new group whenever sequenceIndex changes', () => {
    const rows: Row[] = [
      { songId: 1, sequenceIndex: 0 },
      { songId: 2, sequenceIndex: 0 },
      { songId: 3, sequenceIndex: 1 },
      { songId: 4, sequenceIndex: 2 },
      { songId: 5, sequenceIndex: 2 },
    ];
    expect(groupBySequenceIndex(rows)).toEqual([
      [{ songId: 1, sequenceIndex: 0 }, { songId: 2, sequenceIndex: 0 }],
      [{ songId: 3, sequenceIndex: 1 }],
      [{ songId: 4, sequenceIndex: 2 }, { songId: 5, sequenceIndex: 2 }],
    ]);
  });

  it('skips a gap in sequenceIndex without producing an empty group (an empty σειρά on stage never inserts a row, so this is what that case looks like)', () => {
    const rows: Row[] = [
      { songId: 1, sequenceIndex: 0 },
      { songId: 2, sequenceIndex: 2 },
    ];
    expect(groupBySequenceIndex(rows)).toEqual([
      [{ songId: 1, sequenceIndex: 0 }],
      [{ songId: 2, sequenceIndex: 2 }],
    ]);
  });
});
