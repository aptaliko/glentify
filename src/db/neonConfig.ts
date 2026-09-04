// Side-effect module: import this FIRST, before anything calls `neon()`.
//
// In production this is a no-op — the app hits Neon's cloud over neon-http exactly
// as before. For local development (`NEON_LOCAL=1`, set by `npm run dev:up`) it
// redirects the neon-http driver at the local proxy container from docker-compose.yml,
// so the SAME driver runs against a Postgres on your machine. See docker-compose.yml
// for why we proxy instead of swapping drivers.
//
// Imported for its side effect by src/db/client.ts and scripts/migrate.ts (the entry
// points that construct a neon() client); other scripts get it transitively via client.ts.
import { neonConfig } from '@neondatabase/serverless';

if (process.env.NEON_LOCAL === '1') {
  // Where the local-neon-http-proxy container listens. Override with NEON_LOCAL_PROXY
  // if you remap the port in docker-compose.yml.
  const proxy = process.env.NEON_LOCAL_PROXY ?? 'http://localhost:4444/sql';

  // The neon() HTTP driver only ever fetches this endpoint; it never opens a raw
  // Postgres socket, so pointing it at the plaintext local proxy is all that's needed.
  neonConfig.fetchEndpoint = proxy;

  // Belt-and-suspenders for any code path that uses the pooled/WS transport instead
  // of the one-shot HTTP one. Harmless for the HTTP driver the app actually uses.
  neonConfig.poolQueryViaFetch = true;
  neonConfig.useSecureWebSocket = false;
  neonConfig.wsProxy = (host) => `${host}:4444/v2`;
}
