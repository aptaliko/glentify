import { describe, it, expect } from 'vitest';
import { classifyFailure, isFixable, FIXABLE } from './ciTriage';

describe('classifyFailure', () => {
  it('any Deploy-workflow failure is deploy-stage regardless of log', () => {
    expect(classifyFailure({ workflow: 'Deploy', log: '> glentify@0.1.0 lint\nfoo' }))
      .toBe('deploy-stage');
  });

  it('detects config/secret failures (Vercel token)', () => {
    const log = 'Error: No existing credentials found. Please provide `--token`';
    expect(classifyFailure({ workflow: 'Deploy', log })).toBe('deploy-stage'); // deploy wins
    expect(classifyFailure({ workflow: 'CI', log })).toBe('config-secret');
  });

  it('detects config/secret from a missing DATABASE_URL', () => {
    const log = 'neon() error: DATABASE_URL is not set';
    expect(classifyFailure({ workflow: 'CI', log })).toBe('config-secret');
  });

  it('detects npm ci lockfile drift', () => {
    const log = [
      'npm error code EUSAGE',
      'npm error `npm ci` can only install packages when your package.json and',
      'npm error package-lock.json or npm-shrinkwrap.json are in sync.',
    ].join('\n');
    expect(classifyFailure({ workflow: 'CI', log })).toBe('lockfile');
  });

  it('classifies by the last CI script banner: lint', () => {
    const log = '> glentify@0.1.0 lint\n> eslint\n\n/src/x.ts\n  1:1  error  Unexpected';
    expect(classifyFailure({ workflow: 'CI', log })).toBe('lint');
  });

  it('classifies typecheck when lint passed and typecheck banner is last', () => {
    const log = [
      '> glentify@0.1.0 lint', '> eslint', '',
      '> glentify@0.1.0 typecheck', '> tsc --noEmit',
      "src/a.ts(3,5): error TS2322: Type 'x' is not assignable",
    ].join('\n');
    expect(classifyFailure({ workflow: 'CI', log })).toBe('typecheck');
  });

  it('classifies test failures', () => {
    const log = '> glentify@0.1.0 test\n> vitest run\n\nFAIL src/lib/suggestions.test.ts';
    expect(classifyFailure({ workflow: 'CI', log })).toBe('test');
  });

  it('classifies skill-drift (check:skills)', () => {
    const log = '> glentify@0.1.0 check:skills\n> tsx scripts/check-skill-accuracy.ts\n\nSkill anchor mismatch';
    expect(classifyFailure({ workflow: 'CI', log })).toBe('skill-drift');
  });

  it('returns unknown when nothing matches', () => {
    expect(classifyFailure({ workflow: 'CI', log: 'segfault in runner' })).toBe('unknown');
  });

  it('isFixable matches FIXABLE membership', () => {
    for (const c of FIXABLE) expect(isFixable(c)).toBe(true);
    expect(isFixable('config-secret')).toBe(false);
    expect(isFixable('deploy-stage')).toBe(false);
    expect(isFixable('unknown')).toBe(false);
  });
});
