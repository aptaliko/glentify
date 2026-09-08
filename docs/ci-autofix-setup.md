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
