// Freshness canary for project skills under .claude/skills/.
//
// A skill goes stale exactly in the sessions least likely to have it loaded (see the
// "will Claude spot it" reasoning that prompted this). This is the *mechanical* half of
// the defence: it can't judge whether a skill's advice is still correct, but it can prove
// every file, path, and identifier the skill leans on still exists. When someone renames
// `registerHandler` or deletes an anchor file, this goes red the same commit — no reliance
// on anyone remembering to re-read the skill.
//
// The *judgment* half — "is the guidance still right?" — is the Stop hook in
// .claude/settings.json, which nudges a human/agent re-read when an anchorFile changes.
//
// Source of truth for both: .claude/skills/skill-anchors.json.
//
// Run standalone:  npx tsx scripts/check-skill-accuracy.ts   (exit 1 on any drift)
// Runs in CI/test: scripts/check-skill-accuracy.test.ts asserts checkSkillAccuracy() is clean.

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, '.claude/skills/skill-anchors.json');
const SEARCH_DIRS = ['src', 'scripts'];
const SEARCH_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.sh']);

export interface SkillFailure {
  skill: string;
  kind: 'skill-missing' | 'anchor-missing' | 'path-missing' | 'symbol-missing';
  detail: string;
}

interface SkillAnchors {
  anchorFiles?: string[];
  paths?: string[];
  symbols?: string[];
}
interface Manifest {
  skills: Record<string, SkillAnchors>;
}

// One flat blob of every searchable source file, read once. Repo-sized; no need for a real
// parser — `includes` on a distinctive identifier is enough, and the manifest is curated to
// keep symbols distinctive so a common word can't false-match.
function loadCorpus(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.mobile-build') continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (SEARCH_EXTS.has(extname(entry))) parts.push(readFileSync(full, 'utf8'));
    }
  };
  for (const d of SEARCH_DIRS) {
    const abs = join(ROOT, d);
    if (existsSync(abs)) walk(abs);
  }
  return parts.join('\n');
}

export function checkSkillAccuracy(): SkillFailure[] {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
  const corpus = loadCorpus();
  const failures: SkillFailure[] = [];

  for (const [skill, anchors] of Object.entries(manifest.skills)) {
    if (!existsSync(join(ROOT, '.claude/skills', skill, 'SKILL.md'))) {
      failures.push({ skill, kind: 'skill-missing', detail: `.claude/skills/${skill}/SKILL.md not found` });
      continue; // no point checking anchors for a skill that's gone
    }
    for (const f of anchors.anchorFiles ?? []) {
      if (!existsSync(join(ROOT, f))) failures.push({ skill, kind: 'anchor-missing', detail: f });
    }
    for (const p of anchors.paths ?? []) {
      if (!existsSync(join(ROOT, p))) failures.push({ skill, kind: 'path-missing', detail: p });
    }
    for (const s of anchors.symbols ?? []) {
      if (!corpus.includes(s)) failures.push({ skill, kind: 'symbol-missing', detail: s });
    }
  }
  return failures;
}

// CLI entry: run directly with tsx. Vitest imports checkSkillAccuracy instead of this block.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const failures = checkSkillAccuracy();
  if (failures.length === 0) {
    console.log('✓ All project skills reference live files, paths, and symbols.');
    process.exit(0);
  }
  console.error(`✗ ${failures.length} skill-accuracy problem(s) — a referenced anchor no longer exists.`);
  console.error('  Fix the skill under .claude/skills/, or update .claude/skills/skill-anchors.json if the rename was intentional.\n');
  for (const f of failures) {
    console.error(`  [${f.skill}] ${f.kind}: ${f.detail}`);
  }
  process.exit(1);
}
