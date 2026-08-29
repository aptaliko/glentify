import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Guarantees the DejaVu Sans font files (see src/lib/programPdf.ts) are included in the
  // deployed Vercel Function for this route, since they're referenced via a runtime-built
  // path (process.cwd() + ...) rather than a require()/import() call that Next's automatic
  // file-tracing (@vercel/nft) could detect on its own.
  outputFileTracingIncludes: {
    '/api/programs/*/pdf': [
      'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf',
      'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf',
    ],
  },
};

export default nextConfig;
