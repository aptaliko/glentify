# Assisted CI/Deploy auto-fix responder — design

**Status:** Design approved 2026-09-08. Not yet implemented.
**Author:** George + Claude
**Related:** the `Deploy` workflow (`.github/workflows/deploy.yml`), `CI` workflow
(`.github/workflows/ci.yml`), and the earlier TODO note that seeded this idea.

## Problem

When a pipeline run goes red — most memorably a chain of `npm ci` lockfile failures in the
`Deploy` workflow — fixing it meant George pasting failed logs into a Claude session by hand,
one round-trip per failure. We want the failure to feed back to Claude automatically: Claude
diagnoses, and for the fixable classes commits a fix and lets CI re-validate, with no human
copy-paste.

Two realities shape the solution:

1. **Off-hours failures.** A bot in this project (Dependabot-style) periodically opens PRs to
   `main` (library version bumps) that trigger CI without George pushing anything. Those can
   fail at any hour. A watcher that only runs inside a live local Claude session on George's
   machine cannot catch them. This forces a **cloud, event-driven** responder that lives in
   GitHub, not on the laptop.
2. **Cost.** The responder draws on George's Claude **Pro subscription** (verified: the
   `CLAUDE_CODE_OAUTH_TOKEN` OAuth-token auth is available on Pro, Max, Team, and Enterprise —
   [docs](https://code.claude.com/docs/en/github-actions)). Subscription tokens share the same
   usage window as George's interactive work, so token spend must be deliberate, not
   per-failure.

## Scope (v1)

**In:** a cloud responder — one GitHub Actions workflow plus a small triage script — that
reacts to CI/Deploy failures on **all PRs + `main`**, gates spend behind a cheap pre-Claude
triage step, and for allow-listed failure classes has Claude push a fix onto the failing PR's
branch (or open a new fix PR when there is no branch).

**Out (deferred):** an in-session local `/watch-ci` watcher for when George is actively
pushing and wants the richer, full-repo-context fix loop. Nice-to-have; not needed once the
cloud responder covers every case. May become a follow-up spec. Because v1 is cloud-only, a
local `gh` install is **not** a prerequisite.

## Decisions (settled during brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Watch scope | CI **and** Deploy | Cover the whole push→prod chain. |
| Host / trigger | Cloud, event-driven (`workflow_run` off CI completion) | Only model that catches off-hours bot PRs; runs with full secrets even for Dependabot PRs. |
| Auth | Claude **Pro** subscription OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`) | No extra bill; verified available on Pro. |
| Which runs trigger it | **All PRs + `main`** | Maximum coverage; cost held by the triage gate instead. |
| Fix authority | Push fix onto the **failing PR's branch**; open a **new fix PR** when there is no PR. Never commit to `main` directly. | Existing CI re-validates the fix; `main` stays protected. |
| `check:skills` failures | Treated like other fixes (fix pushed to branch) | George's explicit call, accepting that it auto-edits `.claude/skills/` docs. |
| Deploy-stage failures | **Diagnose-only, never auto-fixed** | A migrate failure may have partially applied migrations to prod; re-running can compound damage. Also has no PR to push onto. |

## Architecture

One new workflow, `.github/workflows/autofix.yml`, chained off CI the same way `deploy.yml`
is:

```
push / bot PR -> [CI: lint/typecheck/test/check:skills]
                     |
                     | workflow_run: completed, conclusion == 'failure'
                     v
                [autofix responder]
                   1. checkout the failing head (workflow_run.head_branch / head_sha)
                   2. fetch the failed-step log
                   3. TRIAGE (plain shell, no Claude) -> classify the failure
                   4. if class in ALLOW-LIST: run claude-code-action (automation mode)
                      else: post a short diagnostic comment (or skip) — no Claude fix
```

### Why `workflow_run`, not `pull_request`

A workflow triggered by a **Dependabot** `pull_request` event runs with a **read-only
`GITHUB_TOKEN` and no access to normal repo secrets** — it could neither read
`CLAUDE_CODE_OAUTH_TOKEN` nor push. Chaining off **CI completion** via `workflow_run` runs in
the **default-branch context with full secrets and write access**, regardless of what
triggered the underlying CI run. This is the exact pattern `deploy.yml` already uses.

Caveats carried from `deploy.yml`:
- `workflow_run` uses the workflow file **as it exists on the default branch**, so it must be
  merged to `main` before it takes effect.
- The checkout must set an explicit `ref` — the failing run's `head_sha` /
  `head_branch` from the `workflow_run` event payload — not the default branch head.
- Fire **only** on `conclusion == 'failure'`. CI has `cancel-in-progress: true`, so
  superseded runs conclude as `cancelled`; the responder must ignore those (and `success`).

### The triage gate (the cost control)

A plain-shell step runs **before** any Claude invocation. It downloads the failed-step log
and matches it against known signatures. Claude is invoked **only** when the failure is on the
allow-list. This is what makes token spend opt-in *per failure-class*, not per failure —
George's explicit requirement.

**Allow-list — earns a Claude run, fix pushed to the branch:**

- **Lockfile drift** — `npm ci` reports `package.json` / `package-lock.json` out of sync
  (the Dependabot bread-and-butter case).
- **Lint** — `npm run lint` failures.
- **Typecheck** — `npm run typecheck` errors.
- **Test** — `npm test` failures.
- **Skill drift** — `npm run check:skills` failures. (Higher-stakes: auto-edits
  `.claude/skills/`. George opted to treat it like the others.)

**Deny-list — no Claude fix:**

- **Config / secret failures** — Vercel token, `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`,
  `PROD_DATABASE_URL`, etc. → short diagnostic comment naming the dashboard knob to change.
  Never a fix (Claude cannot touch GitHub/Vercel dashboards).
- **Any Deploy-stage failure** — diagnose-only per the decision above. In particular the
  original `npm ci` / `vercel` Deploy pain gets the **slowest** path: because Deploy has no PR
  to push onto, a genuine code/lockfile fix there means a **new fix PR → review → merge → CI →
  Deploy**, not a fast in-place push. Expectation set deliberately.
- **Unrecognized signature** → skip (optionally a neutral "unclassified failure" comment). No
  Claude spend on failures we cannot categorize.

### The Claude step

`anthropics/claude-code-action@v1` in **automation mode** (a `prompt` input is supplied, so it
runs without waiting for an `@claude` mention).

- **Auth:** `claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`.
- **Push identity:** do **not** pass `github_token`. The default `GITHUB_TOKEN` does not
  re-trigger workflows (GitHub's recursion guard), which would leave the fix sitting on a
  never-re-validated branch. Omitting `github_token` makes the action authenticate as the
  **Claude GitHub App**, whose pushes *do* trigger CI. Requires the Claude GitHub App to be
  installed on the repo (Contents / Issues / Pull requests read-write).
- **Prompt:** instruct Claude to fix the specific classified failure on the checked-out
  branch, run the relevant local check to confirm, commit, and push; if it cannot produce a
  confident fix, comment the diagnosis instead of pushing.
- **Cost/turn guards (`claude_args`):** `--max-turns` capped low, plus a workflow-level
  `timeout-minutes`.

### Loop guard (defense in depth)

The fix commit produces a **new head SHA**, so "fire once per SHA" would not prevent a loop —
the re-run failure looks like a fresh event. Guards, layered:

1. **Per-PR bot-commit cap.** Before invoking Claude, count commits on the branch already
   authored by the responder/Claude App identity; if ≥ 2, **stop** and post a comment instead
   of attempting another fix.
2. **`allowed_bots`.** The action rejects bot actors by default (its built-in anti-loop
   rule). Dependabot is allow-listed deliberately (we *want* to fix its PRs); the Claude App's
   own pushes are handled by cap #1.
3. **`concurrency`.** A `concurrency` group keyed on the PR/branch cancels or serializes
   overlapping responder runs so a burst cannot fan out.

## Prerequisites / setup steps

1. **Verify Pro eligibility in practice** — generate `CLAUDE_CODE_OAUTH_TOKEN` via
   `claude setup-token` and confirm it authenticates. (Docs say Pro is supported; confirm on
   George's actual account before relying on it.)
2. **Install the Claude GitHub App** on the repo (needed for the App-identity push that
   re-triggers CI).
3. **Add repo secret** `CLAUDE_CODE_OAUTH_TOKEN`.
4. **Schedule Dependabot 1–5 AM.** In `.github/dependabot.yml` set
   `schedule.interval: daily`, `schedule.time: "01:00"`, `schedule.timezone: <George's tz>`.
   Note this sets a **start time**, not a hard window; PRs open at/around 01:00. Since
   subscription limits reset on a rolling ~5-hour window, a 1 AM burst resets well before
   working hours. (If, contrary to the docs, Pro subscription auth turns out unavailable, this
   scheduling loses its reset rationale and cost control leans entirely on the triage gate.)
5. **Merge `autofix.yml` to `main`** — `workflow_run` only honors the default-branch copy.

## Cost model

- Spend only occurs when a failure matches the allow-list (triage gate).
- Each allowed run is capped by `--max-turns` and `timeout-minutes`.
- Bursts are bounded by `concurrency` and the per-PR bot-commit cap.
- Spend draws on the Pro subscription's usage window; overnight Dependabot scheduling keeps
  any exhaustion away from working hours.
- GitHub Actions minutes are also consumed per run (standard runner billing).

## Testing / verification

Consistent with the repo convention (Vitest covers pure logic only; CI/Actions and anything
external is verified manually), the responder is verified by **deliberately triggering each
failure class** on a throwaway PR and confirming the right branch:

- **Lockfile drift** → responder pushes a lockfile fix, CI re-runs green.
- **Lint / typecheck / test** → responder pushes a fix, CI re-runs green.
- **Config/secret (simulated)** → diagnostic comment only, no fix commit.
- **Deploy-stage failure** → diagnostic comment only.
- **Loop guard** → force two consecutive failed fixes, confirm it stops at the 2nd and
  comments.
- **Cancelled run** → push twice quickly, confirm the superseded (`cancelled`) run does **not**
  wake the responder.

The plain-shell **triage classifier** is the one piece with extractable pure logic; its
signature-matching (log text → class) can be unit-tested with captured log fixtures.

## Explicitly out of scope for v1

- The local in-session `/watch-ci` watcher.
- Auto-fixing Deploy-stage or config/secret failures.
- Committing directly to `main`.
- Any change to app code or the DB schema.
