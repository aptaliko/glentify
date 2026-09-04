// PostToolUse(Write|Edit) hook: when an edited file is an anchor for a project skill, nudge a
// re-read of that skill so its guidance is re-checked against the change. This is the *judgment*
// half of skill-freshness (the mechanical half is check-skill-accuracy.ts).
//
// Reads the hook JSON on stdin, extracts tool_input.file_path, and if that file is listed as an
// anchorFile in .claude/skills/skill-anchors.json, prints a PostToolUse additionalContext payload
// naming the skill(s). Silent for any other file — the common case — so it adds nothing to
// ordinary edits.
//
// Plain Node ESM (no tsx/build step) so it runs from a hook with just `node`. Wired from
// .claude/settings.json. Fails open: any error exits 0 with no output.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function main() {
  let filePath;
  try {
    filePath = JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.file_path;
  } catch {
    return; // no/invalid stdin
  }
  if (!filePath) return;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, '.claude/skills/skill-anchors.json'), 'utf8'));
  } catch {
    return;
  }

  // Suffix-match: manifest paths are repo-relative; the hook's file_path is absolute.
  const hits = [];
  for (const [skill, anchors] of Object.entries(manifest.skills ?? {})) {
    const anchorFiles = anchors.anchorFiles ?? [];
    if (anchorFiles.some((a) => filePath.endsWith('/' + a) || filePath === join(ROOT, a))) {
      hits.push(skill);
    }
  }
  if (hits.length === 0) return;

  const list = hits.map((s) => `.claude/skills/${s}`).join(', ');
  const context =
    `You edited an anchor file for the project skill(s): ${list}. ` +
    `That skill documents the multi-step procedure this file participates in. Re-read it and confirm the ` +
    `guidance still matches the change you just made — update the SKILL.md (and its entry in ` +
    `.claude/skills/skill-anchors.json) if the structure it describes has shifted. If nothing structural ` +
    `changed, ignore this.`;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context },
      suppressOutput: true,
    })
  );
}

main();
