// Groups consecutive rows sharing the same sequenceIndex into their own array, preserving
// input order. Assumes rows already arrive ordered by play sequence (e.g. by `id` ascending) —
// it does not sort. A session's sequenceIndex only ever increases (see queries/sessions.ts's
// endSequence), so a "run" of equal values is always contiguous in practice; this never needs
// to merge two separate runs that happen to share a value.
export function groupBySequenceIndex<T extends { sequenceIndex: number }>(rows: T[]): T[][] {
  const groups: T[][] = [];
  let lastIndex: number | null = null;
  for (const row of rows) {
    if (lastIndex === null || row.sequenceIndex !== lastIndex) {
      groups.push([]);
      lastIndex = row.sequenceIndex;
    }
    groups[groups.length - 1].push(row);
  }
  return groups;
}
