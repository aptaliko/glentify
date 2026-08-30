#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf .mobile-build out
mkdir -p .mobile-build

rsync -a \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  --exclude .mobile-build \
  --exclude out \
  --exclude ios \
  --exclude android \
  . .mobile-build/

ln -s ../node_modules .mobile-build/node_modules

rm -rf .mobile-build/src/app/api
rm -rf ".mobile-build/src/app/admin/songs/[id]"
rm -rf ".mobile-build/src/app/admin/programs/[id]"
rm -rf ".mobile-build/src/app/programs/[id]"
rm -f ".mobile-build/src/app/programs/page.tsx"
rm -rf .mobile-build/src/app/session/\[id\]
rm -f .mobile-build/src/proxy.ts

if [ -d .mobile-build/src/app/api ]; then
  echo "build-mobile: src/app/api survived staging, aborting" >&2
  exit 1
fi

if [ -d .mobile-build/src/app/session/\[id\] ]; then
  echo "build-mobile: src/app/session/[id] survived staging, aborting" >&2
  exit 1
fi

if [ -d ".mobile-build/src/app/admin/songs/[id]" ] || [ -d ".mobile-build/src/app/admin/programs/[id]" ]; then
  echo "build-mobile: a dynamic admin route survived staging, aborting" >&2
  exit 1
fi

# Offline PDF export (src/lib/programPdfLocal.ts) fetches these at runtime from the app's own
# local static-asset origin — not committed as static files so they don't also bloat the web
# bundle (the web PDF route reads the same font package directly from node_modules instead).
mkdir -p .mobile-build/public/fonts
cp node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf .mobile-build/public/fonts/
cp node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf .mobile-build/public/fonts/

cat > .mobile-build/next.config.ts <<'CONFIG'
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
};

export default nextConfig;
CONFIG

# NEXT_PUBLIC_MOBILE_BUILD marks this bundle as the native/Capacitor one, so pages can
# resolve the platform during render (prerender included) instead of after hydration.
# NEXT_PUBLIC_API_BASE_URL points fetch calls at the deployed API, since the on-device
# origin (capacitor://localhost) serves only the static bundle, not the API routes.
# No dotenv wrapper: nothing left in this bundle after staging (api/, admin/songs/[id],
# admin/programs/[id], programs/page.tsx, programs/[id]/ removed above) reads AUTH_SECRET/APP_PASSWORD/DATABASE_URL,
# so .env.local's contents aren't needed here. Next's own build still auto-loads .mobile-build/.env.local if
# present (see environment-variables docs' load order) - this line never controlled
# that, it only wrapped the invocation redundantly.
(cd .mobile-build && NEXT_PUBLIC_MOBILE_BUILD=1 NEXT_PUBLIC_API_BASE_URL=https://glentify-kohl.vercel.app npx next build)

cp -R .mobile-build/out out
echo "Mobile static export written to ./out"

npx cap sync
