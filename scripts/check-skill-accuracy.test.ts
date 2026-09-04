import { describe, it, expect } from 'vitest';
import { checkSkillAccuracy } from './check-skill-accuracy';

// Makes skill drift a red test in `npm test`: if a rename or deletion breaks an anchor a
// project skill relies on, this fails with the exact skill + symbol/path, pointing you at
// the SKILL.md to fix (or the manifest to update, if the rename was intentional).
describe('project skill accuracy', () => {
  it('every skill references only live files, paths, and symbols', () => {
    const failures = checkSkillAccuracy();
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  });
});
