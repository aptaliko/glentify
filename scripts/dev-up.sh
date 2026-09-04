#!/usr/bin/env bash
#
# One command to bring up everything the app needs locally, from a clean slate.
#
#   npm run dev:up            # (re)start the stack, keep existing data
#   npm run dev:up -- --reset # same, but wipe the database and start empty
#
# What it does, in order:
#   1. checks Docker is running
#   2. kills any previous run of this stack (so you always start fresh)
#   3. starts Postgres + the neon-http proxy (docker-compose.yml)
#   4. waits until they're actually ready to accept queries
#   5. runs the full DB setup (migrate -> multiuser backfill -> finalize), idempotently
#   6. makes sure .env.local points `npm run dev` at the local stack
#
# The Next.js dev server itself is NOT started here — run `npm run dev` after this.
# It stays outside Docker on purpose: it's your live-reload process, not a backing service.
set -euo pipefail
cd "$(dirname "$0")/.."

RESET=0
if [[ "${1:-}" == "--reset" ]]; then
  RESET=1
fi

# --- canonical local dev settings (single source of truth for the backing stack) ---
LOCAL_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/glentify"
DEV_ADMIN_EMAIL="admin@local"
DEV_ADMIN_PASSWORD="admin"

export NEON_LOCAL=1
export DATABASE_URL="$LOCAL_DATABASE_URL"

info()  { printf '\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# --- 1. Docker running? ---------------------------------------------------------
if ! docker info >/dev/null 2>&1; then
  echo "Docker doesn't appear to be running. Start Docker Desktop and try again." >&2
  exit 1
fi

# --- 2. kill any previous run ---------------------------------------------------
if [[ $RESET == 1 ]]; then
  warn "Reset requested — removing containers AND wiping the database volume."
  docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
else
  info "Stopping any previous run of the stack (data is kept)."
  docker compose down --remove-orphans >/dev/null 2>&1 || true
fi

# --- 3. start fresh, waiting on Postgres's healthcheck --------------------------
info "Starting Postgres + neon-http proxy…"
docker compose up -d --wait

# --- 4. wait until the proxy actually answers on :4444 --------------------------
info "Waiting for the neon-http proxy to accept connections…"
for i in $(seq 1 30); do
  if (exec 3<>/dev/tcp/localhost/4444) 2>/dev/null; then
    exec 3>&- 3<&-
    ok "Proxy is up."
    break
  fi
  if [[ $i == 30 ]]; then
    echo "Proxy never came up on localhost:4444. Check: docker compose logs neon-proxy" >&2
    exit 1
  fi
  sleep 1
done

# --- 5. full DB setup, in the required order, all idempotent --------------------
info "Applying schema migrations…"
npx tsx scripts/migrate.ts

info "Ensuring local admin + backfilling ownership…"
ADMIN_EMAIL="$DEV_ADMIN_EMAIL" ADMIN_PASSWORD="$DEV_ADMIN_PASSWORD" npx tsx scripts/migrate-to-multiuser.ts

info "Seeding axis types…"
npx tsx scripts/seed-axis-types.ts

info "Seeding development test data…"
npx tsx scripts/seed-dev.ts

# --- 6. make sure `npm run dev` targets the local stack -------------------------
if [[ ! -f .env.local ]]; then
  warn ".env.local not found — creating one from .env.local.example for local dev."
  cp .env.local.example .env.local
elif ! grep -q '^NEON_LOCAL=1' .env.local; then
  warn ".env.local exists but has no NEON_LOCAL=1 line."
  warn "Your \`npm run dev\` may be pointing somewhere other than this local stack —"
  warn "compare it against .env.local.example."
fi

echo
ok "Local stack ready."
echo "   Database : $LOCAL_DATABASE_URL (via neon-http proxy on :4444)"
echo "   Admin    : $DEV_ADMIN_EMAIL / $DEV_ADMIN_PASSWORD"
echo
echo "   Next:  npm run dev      then open http://localhost:3000"
echo "   Stop:  npm run dev:down"
