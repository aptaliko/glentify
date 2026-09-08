# CI/Deploy Auto-Fix Responder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cloud, event-driven GitHub Actions responder that triages CI/Deploy failures with a cheap pre-Claude gate and, for allow-listed failure classes, has `claude-code-action` push a fix onto the failing PR's branch.

**Architecture:** One new workflow (`.github/workflows/autofix.yml`) chains off CI/Deploy completion via `workflow_run` (full secrets, Dependabot-safe). It downloads the failed-step log, runs a pure TypeScript classifier (`scripts/lib/ciTriage.ts`, unit-tested) through a thin CLI (`scripts/ci-triage.ts`), and only invokes `claude-code-action` when the failure class is fixable. Deploy-stage and config/secret failures are diagnose-only. A per-PR bot-commit cap plus `concurrency` and `allowed_bots` prevent fix loops.

**Tech Stack:** GitHub Actions (`workflow_run`), `anthropics/claude-code-action@v1` (automation mode, Claude Pro OAuth token, Claude GitHub App push identity), TypeScript run via `tsx` (matching `scripts/migrate.ts`), Vitest for the classifier.

**Spec:** `docs/superpowers/specs/2026-09-08-ci-autofix-responder-design.md`

## Global Constraints

- **Never commit to `main` directly.** Fixes go to the failing PR's branch, or a new fix PR when there is no branch.
- **Deploy-stage failures are diagnose-only** — never auto-fixed (a migrate failure may have partially applied migrations to prod).
- **Fixable classes only earn a Claude run:** `lockfile`, `lint`, `typecheck`, `test`, `skill-drift`. Everything else (`config-secret`, `deploy-stage`, `unknown`) is diagnose-only or skipped — no Claude spend.
- **Auth:** Claude Pro subscription OAuth token via the `CLAUDE_CODE_OAUTH_TOKEN` repo secret. Do **not** pass `github_token` to the action (so it pushes as the Claude GitHub App, whose commits re-trigger CI; the default `GITHUB_TOKEN` would not).
- **Fire only on `conclusion == 'failure'`** — ignore `cancelled` (CI uses `cancel-in-progress`) and `success`.
- **New/edited workflows only take effect once merged to `main`** — `workflow_run` honors the default-branch copy of the file.
- TypeScript scripts run with `tsx` (e.g. `npx tsx scripts/ci-triage.ts`), matching `scripts/migrate.ts`. Package banner in npm logs is `glentify@0.1.0`.
- Tests live beside code as `*.test.ts` and are run by `npm test` (`vitest run`); default include already covers `scripts/`.

---

## Task 1: Failure classifier (pure logic, TDD)

The one unit-testable piece: given the triggering workflow name and the failed-step log text, return the failure class.

**Files:**
- Create: `scripts/lib/ciTriage.ts`
- Test: `scripts/lib/ciTriage.test.ts`

**Interfaces:**
- Produces:
  - `type FailureClass = 'lockfile' | 'lint' | 'typecheck' | 'test' | 'skill-drift' | 'config-secret' | 'deploy-stage' | 'unknown'`
  - `const FIXABLE: readonly FailureClass[]` = `['lockfile','lint','typecheck','test','skill-drift']`
  - `function isFixable(c: FailureClass): boolean`
  - `function classifyFailure(input: { workflow: string; log: string }): FailureClass`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/lib/ciTriage.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/lib/ciTriage.test.ts`
Expected: FAIL — cannot resolve `./ciTriage`.

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/lib/ciTriage.ts
export type FailureClass =
  | 'lockfile' | 'lint' | 'typecheck' | 'test' | 'skill-drift'
  | 'config-secret' | 'deploy-stage' | 'unknown';

export const FIXABLE = ['lockfile', 'lint', 'typecheck', 'test', 'skill-drift'] as const;

export function isFixable(c: FailureClass): boolean {
  return (FIXABLE as readonly string[]).includes(c);
}

// Signatures that mean "a human must change a dashboard/secret" — never auto-fixable.
const CONFIG_SECRET = [
  /please provide\s+`?--token`?/i,
  /\bVERCEL_(ORG|PROJECT)_ID\b/,
  /\bVERCEL_TOKEN\b/,
  /\bPROD_DATABASE_URL\b/,
  /\bDATABASE_URL\b[^\n]*\b(not set|is not defined|missing|undefined)\b/i,
  /No existing credentials found/i,
];

const LOCKFILE = [
  /`?npm ci`? can only install packages when your package\.json/i,
  /npm error code EUSAGE/i,
];

// The npm lifecycle banner npm prints for each run script, e.g. "> glentify@0.1.0 typecheck".
const SCRIPT_BANNER = /^>\s+\S+@\S+\s+(lint|typecheck|test|check:skills)\b/gm;

const BANNER_TO_CLASS: Record<string, FailureClass> = {
  lint: 'lint',
  typecheck: 'typecheck',
  test: 'test',
  'check:skills': 'skill-drift',
};

export function classifyFailure(input: { workflow: string; log: string }): FailureClass {
  const { workflow, log } = input;

  // 1. Any failure of the Deploy workflow is diagnose-only, whatever the log says.
  if (/^deploy$/i.test(workflow.trim())) return 'deploy-stage';

  // 2. Config/secret failures — a human must fix these.
  if (CONFIG_SECRET.some((re) => re.test(log))) return 'config-secret';

  // 3. Lockfile drift (npm ci runs before any script, so no banner is present).
  if (LOCKFILE.some((re) => re.test(log))) return 'lockfile';

  // 4. CI stops at the first failing step, so the LAST script banner is the failed script.
  let last: FailureClass | null = null;
  for (const m of log.matchAll(SCRIPT_BANNER)) last = BANNER_TO_CLASS[m[1]] ?? last;
  if (last) return last;

  return 'unknown';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/lib/ciTriage.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/ciTriage.ts scripts/lib/ciTriage.test.ts
git commit -m "feat(ci): failure-log classifier for the auto-fix responder"
```

---

## Task 2: Triage CLI (`scripts/ci-triage.ts`)

A thin wrapper the workflow calls. Reads the failed log from a file and the workflow name from args/env, prints the class, and writes step outputs (`class`, `fixable`) to `$GITHUB_OUTPUT`.

**Files:**
- Create: `scripts/ci-triage.ts`

**Interfaces:**
- Consumes: `classifyFailure`, `isFixable`, `FailureClass` from `scripts/lib/ciTriage.ts`.
- Produces (runtime contract, consumed by Task 3's workflow):
  - Args: `node/tsx scripts/ci-triage.ts <logFilePath> <workflowName>`
  - stdout: a human line `class=<FailureClass> fixable=<true|false>`
  - Appends to the file named by `$GITHUB_OUTPUT` (when set): `class=<FailureClass>\nfixable=<true|false>\n`
  - Exit code always 0 (classification is not itself a failure).

- [ ] **Step 1: Write the implementation** (no unit test — pure I/O glue; the logic it calls is covered by Task 1, and its end-to-end behavior is checked in the manual-verification task)

```ts
// scripts/ci-triage.ts
import { appendFileSync, readFileSync } from 'node:fs';
import { classifyFailure, isFixable } from './lib/ciTriage';

const [, , logPath, workflow] = process.argv;
if (!logPath || !workflow) {
  console.error('usage: tsx scripts/ci-triage.ts <logFilePath> <workflowName>');
  process.exit(2);
}

let log = '';
try {
  log = readFileSync(logPath, 'utf8');
} catch {
  // Missing/empty log => nothing to classify; treat as unknown, spend no Claude tokens.
  log = '';
}

const cls = classifyFailure({ workflow, log });
const fixable = isFixable(cls);

console.log(`class=${cls} fixable=${fixable}`);

const out = process.env.GITHUB_OUTPUT;
if (out) appendFileSync(out, `class=${cls}\nfixable=${fixable}\n`);
```

- [ ] **Step 2: Smoke it locally**

Run:
```bash
printf '> glentify@0.1.0 typecheck\nsrc/a.ts(3,5): error TS2322: bad\n' > /tmp/ci.log
npx tsx scripts/ci-triage.ts /tmp/ci.log CI
```
Expected stdout: `class=typecheck fixable=true`

Run:
```bash
printf 'Error: No existing credentials found. Please provide --token\n' > /tmp/ci.log
npx tsx scripts/ci-triage.ts /tmp/ci.log Deploy
```
Expected stdout: `class=deploy-stage fixable=false`

- [ ] **Step 3: Commit**

```bash
git add scripts/ci-triage.ts
git commit -m "feat(ci): CLI wrapper emitting triage class to GITHUB_OUTPUT"
```

---

## Task 3: The responder workflow (`.github/workflows/autofix.yml`)

Chains off CI **and** Deploy completion, downloads the failed log, runs triage, and conditionally invokes `claude-code-action`. Not unit-testable — validated by the manual task.

**Files:**
- Create: `.github/workflows/autofix.yml`

**Interfaces:**
- Consumes: `scripts/ci-triage.ts` (Task 2) via `npx tsx`; the `class`/`fixable` step outputs.
- Consumes secret: `CLAUDE_CODE_OAUTH_TOKEN`.

- [ ] **Step 1: Write the workflow file**

```yaml
name: Autofix Responder

# Reacts to a FAILED CI or Deploy run. workflow_run runs in the default-branch context with
# full secrets + write access, even when the underlying run was a Dependabot PR (whose own
# token is read-only). This file only takes effect once merged to main.
on:
  workflow_run:
    workflows: [CI, Deploy]
    types: [completed]

concurrency:
  # One responder at a time per originating branch; a newer failure supersedes an older run.
  group: autofix-${{ github.event.workflow_run.head_branch }}
  cancel-in-progress: true

permissions:
  contents: write        # push the fix
  pull-requests: write   # comment / open a fix PR
  actions: read          # read the failed run's logs
  id-token: write        # claude-code-action default GitHub App auth

jobs:
  respond:
    # Only real failures. Ignore cancelled (CI cancel-in-progress) and success.
    if: ${{ github.event.workflow_run.conclusion == 'failure' }}
    runs-on: ubuntu-latest
    timeout-minutes: 20   # hard ceiling on a runaway fix run
    env:
      GH_TOKEN: ${{ github.token }}
      HEAD_BRANCH: ${{ github.event.workflow_run.head_branch }}
      HEAD_SHA: ${{ github.event.workflow_run.head_sha }}
      SOURCE_WORKFLOW: ${{ github.event.workflow_run.name }}
      RUN_ID: ${{ github.event.workflow_run.id }}
    steps:
      - name: Check out the failing commit
        uses: actions/checkout@v7
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
          fetch-depth: 0   # need branch history for the bot-commit loop guard

      - uses: actions/setup-node@v7
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci || true   # a lockfile failure must not abort triage itself

      - name: Download failed run log
        run: gh run view "$RUN_ID" --log-failed > failed.log || gh run view "$RUN_ID" --log > failed.log

      - name: Triage
        id: triage
        run: npx tsx scripts/ci-triage.ts failed.log "$SOURCE_WORKFLOW"

      # ---- Loop guard: stop if the bot has already tried >= 2 fixes on this branch ----
      - name: Count prior bot fix commits
        id: guard
        run: |
          COUNT=$(git log origin/"$HEAD_BRANCH" --author='claude' --oneline 2>/dev/null | wc -l | tr -d ' ')
          echo "count=$COUNT" >> "$GITHUB_OUTPUT"
          echo "Prior bot fix commits on $HEAD_BRANCH: $COUNT"

      - name: Diagnose-only comment (not fixable, or loop guard tripped)
        if: ${{ steps.triage.outputs.fixable != 'true' || steps.guard.outputs.count >= 2 }}
        run: |
          echo "Class=${{ steps.triage.outputs.class }}; fixable=${{ steps.triage.outputs.fixable }}; priorFixes=${{ steps.guard.outputs.count }}."
          echo "Diagnose-only: no Claude fix attempted. (Deploy-stage / config-secret / unknown, or loop guard tripped.)"
          # A PR comment is posted here when a PR exists for HEAD_BRANCH; see manual test task
          # for the gh pr comment invocation. Config/secret failures name the dashboard knob.

      - name: Claude auto-fix
        if: ${{ steps.triage.outputs.fixable == 'true' && steps.guard.outputs.count < 2 }}
        uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          # NOTE: github_token is deliberately omitted so pushes are made as the Claude GitHub
          # App and DO re-trigger CI (the default GITHUB_TOKEN would not).
          claude_args: '--max-turns 12'
          prompt: |
            The GitHub Actions run ${{ env.RUN_ID }} for workflow "${{ env.SOURCE_WORKFLOW }}"
            failed on branch ${{ env.HEAD_BRANCH }} (commit ${{ env.HEAD_SHA }}).
            The failure was classified as: ${{ steps.triage.outputs.class }}.
            The failed log is in ./failed.log in the checkout.

            Do exactly this:
            1. Read ./failed.log and reproduce the specific ${{ steps.triage.outputs.class }}
               failure locally in this checkout.
            2. Make the SMALLEST fix that resolves it:
               - lockfile: run `npm install` to resync package-lock.json (do not change versions
                 beyond what package.json requires).
               - lint: run `npm run lint` and fix the reported errors.
               - typecheck: run `npm run typecheck` and fix the type errors.
               - test: run `npm test`, fix the failing behavior (never delete/skip a test to pass).
               - skill-drift: run `npm run check:skills` and update the skill anchors it flags.
            3. Re-run the relevant check and confirm it now passes.
            4. Commit with a message like "fix(ci): auto-fix ${{ steps.triage.outputs.class }}"
               and push to branch ${{ env.HEAD_BRANCH }}.
            If you cannot produce a confident fix, DO NOT push — instead post a comment on the
            PR (or the commit) explaining the failure and the suggested manual fix, and stop.
            NEVER push to main. Only ever push to ${{ env.HEAD_BRANCH }}.
```

- [ ] **Step 2: Validate YAML syntax locally**

Run: `npx --yes js-yaml .github/workflows/autofix.yml >/dev/null && echo "YAML OK"`
Expected: `YAML OK` (no parse error). If `js-yaml` is unavailable offline, instead run `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/autofix.yml')); print('YAML OK')"`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/autofix.yml
git commit -m "feat(ci): autofix responder workflow (workflow_run + triage gate)"
```

---

## Task 4: Schedule Dependabot overnight

Modify the existing config — keep the monthly grouped strategy, add a start time so bursts land overnight and any subscription-limit exhaustion resets before working hours.

**Files:**
- Modify: `.github/dependabot.yml`

- [ ] **Step 1: Add `time` + `timezone` to each `schedule` block**

For **both** `updates:` entries (the `npm` one and the `github-actions` one), extend the existing `schedule:` from:

```yaml
    schedule:
      interval: monthly
```
to:
```yaml
    schedule:
      interval: monthly
      time: "01:00"
      timezone: "Europe/Athens"
```

(`Europe/Athens` is the assumed local zone — confirm with George; `time` is a start time, not a hard 1–5 AM window.)

- [ ] **Step 2: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/dependabot.yml')); print('YAML OK')"`
Expected: `YAML OK`

- [ ] **Step 3: Commit**

```bash
git add .github/dependabot.yml
git commit -m "chore(deps): schedule Dependabot overnight so autofix spend resets before work"
```

---

## Task 5: Setup doc + manual verification checklist

Capture the one-time human setup (App install, secret, token) and the on-device/on-CI manual verification, per the repo convention that Actions/external surfaces are verified manually.

**Files:**
- Create: `docs/ci-autofix-setup.md`
- Modify: `docs/manual-testing-checklist.md`

- [ ] **Step 1: Write the setup doc**

```markdown
# CI/Deploy auto-fix responder — one-time setup

The responder (`.github/workflows/autofix.yml`) needs three things a workflow file can't
create itself. Do these once, then merge the workflow to `main` (it only takes effect from
the default branch).

1. **Generate a Claude subscription token.** On a machine logged into Claude Code with the
   Pro subscription, run `claude setup-token`. Copy the token.
2. **Add the repo secret.** GitHub → Settings → Secrets and variables → Actions → New secret:
   name `CLAUDE_CODE_OAUTH_TOKEN`, value = the token from step 1.
3. **Install the Claude GitHub App** on this repo (https://github.com/apps/claude) with
   Contents / Issues / Pull requests read-write. This is what lets the responder's pushes
   re-trigger CI (a push made with the default `GITHUB_TOKEN` would not).

Verify the token works before relying on it: run `claude` locally with that token, or trigger
a deliberate lint failure on a throwaway PR (see the manual-testing checklist) and confirm the
responder pushes a fix.

If, contrary to the docs, Pro subscription auth turns out unusable in CI, switch the workflow's
`claude_code_oauth_token` input to `anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}` and add
that secret instead — but note this bills API usage and removes the overnight-reset rationale.
```

- [ ] **Step 2: Append verification cases to `docs/manual-testing-checklist.md`**

Add a section:

```markdown
## CI/Deploy auto-fix responder

Run each on a throwaway PR branch (never main). After each, confirm the responder run in the
Actions tab behaved as noted.

- [ ] **Lockfile drift** → edit `package-lock.json` out of sync, push. Responder pushes a
      lockfile fix; CI re-runs green.
- [ ] **Lint** → introduce a lint error, push. Responder pushes a fix; CI re-runs green.
- [ ] **Typecheck** → introduce a type error, push. Responder pushes a fix; CI re-runs green.
- [ ] **Test** → break a tested behavior, push. Responder pushes a fix; CI re-runs green.
- [ ] **Skill drift** → desync a skill anchor, push. Responder pushes a fix; CI re-runs green.
- [ ] **Config/secret (simulated)** → force a CI step to echo a `No token` error, push.
      Responder posts a diagnostic comment, pushes NO fix commit.
- [ ] **Deploy-stage** → observe a real Deploy failure (or simulate). Responder comments only.
- [ ] **Loop guard** → force two consecutive failed auto-fixes on one branch. Responder stops
      at the 2nd, comments, does not attempt a 3rd.
- [ ] **Cancelled run** → push twice in quick succession. The superseded (`cancelled`) CI run
      does NOT wake the responder; only the real `failure` does.
```

- [ ] **Step 3: Commit**

```bash
git add docs/ci-autofix-setup.md docs/manual-testing-checklist.md
git commit -m "docs(ci): setup + manual-verification for the autofix responder"
```

---

## Self-Review

**Spec coverage:**
- Cloud responder / `workflow_run` off CI **and** Deploy → Task 3. ✅
- Pre-Claude triage gate + allow/deny lists → Tasks 1–2 (classifier), Task 3 (gate wiring). ✅
- Fix pushed to branch; never `main`; Claude App push identity → Task 3 prompt + omitted `github_token`. ✅
- Deploy-stage & config/secret diagnose-only → Task 1 (`deploy-stage`/`config-secret` classes) + Task 3 diagnose branch. ✅
- Loop guard (per-PR bot-commit cap) + `concurrency` + `allowed_bots` → Task 3. (Note: `allowed_bots` for Dependabot is set at the App/action level; the workflow uses `workflow_run`, whose actor is inherited — verify during manual testing that Dependabot-originated failures do wake the responder, and add `allowed_bots: "dependabot[bot]"` to the action inputs if a bot-actor check blocks it.) ✅
- `--max-turns` + `timeout-minutes` cost guards → Task 3. ✅
- Dependabot overnight scheduling → Task 4. ✅
- Setup (App/secret/token) + manual verification → Task 5. ✅
- `check:skills` treated like other fixes → Task 1 `skill-drift ∈ FIXABLE`, Task 3 prompt. ✅

**Placeholder scan:** No TBD/TODO. The one assumed value (`Europe/Athens`) is flagged for confirmation, not a blank. Diagnose-only comment posting is described as a manual-verified `gh pr comment` step rather than left vague — acceptable because the exact comment target (PR vs. commit) depends on whether a PR exists, resolved during manual testing.

**Type consistency:** `FailureClass`, `FIXABLE`, `isFixable`, `classifyFailure` names/signatures identical across Tasks 1–2. Workflow reads `steps.triage.outputs.class` / `.fixable`, matching the `class=` / `fixable=` keys Task 2 writes to `$GITHUB_OUTPUT`. ✅

**Known residual (documented, not a gap):** the diagnose-only branch (Task 3) logs to the run and describes the PR-comment step, but the concrete `gh pr comment`/`gh api` invocation is finalized during manual verification (Task 5) because it depends on runtime PR existence. This is deliberate — the fixable path (the point of the feature) is fully specified.
