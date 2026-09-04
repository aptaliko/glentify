#!/usr/bin/env bash
# Vercel "Ignored Build Step" — decides whether a push should rebuild the web app.
# Referenced from vercel.json's "ignoreCommand". Vercel's contract:
#   exit 0  -> SKIP the build (nothing code-relevant changed)
#   exit 1  -> BUILD (proceed as normal)
#
# Policy is conservative: BUILD unless EVERY changed file is deploy-irrelevant. A missed
# skip just wastes one build (harmless); a wrong skip ships stale code (harmful), so we
# only skip when we are certain. Runs at the repo root in Vercel's build env, where the
# commit is checked out and git is available.

set -euo pipefail

# First commit, shallow clone with no parent, etc. — can't diff, so build to be safe.
if ! git rev-parse HEAD^ >/dev/null 2>&1; then
  echo "No previous commit to diff against; building."
  exit 1
fi

changed="$(git diff --name-only HEAD^ HEAD)"
if [ -z "$changed" ]; then
  echo "No file changes detected; building to be safe."
  exit 1
fi

# Deploy-IRRELEVANT paths: Claude tooling, CI config, docs, IDE config, and any markdown file.
# Everything else — src/, scripts/, package.json, config, migrations — is code-relevant.
# ^.github/ = CI workflows / dependabot: they run on GitHub, never affect the Vercel web build.
relevant="$(printf '%s\n' "$changed" \
  | grep -vE '^\.claude/|^\.github/|^docs/|^\.idea/|^android/\.idea/|\.md$' || true)"

if [ -z "$relevant" ]; then
  echo "Only deploy-irrelevant files changed; skipping build:"
  printf '  %s\n' $changed
  exit 0
fi

echo "Code-relevant changes detected; building:"
printf '  %s\n' $relevant
exit 1
