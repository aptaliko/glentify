// Parses an optional If-Match header as an integer version. Returns null for a missing,
// empty, non-numeric, or below-1 value — all of which callers treat as "no guard"
// (last-write-wins). Versions start at 1, so 0 (incl. the pre-upgrade-cache sentinel a
// device with no known base sends) and negatives fall through to last-write-wins rather
// than becoming a guard that can never match.
export function parseIfMatch(request: { headers: { get(name: string): string | null } }): number | null {
  const raw = request.headers.get('if-match');
  if (raw === null) return null;
  // Tolerate a standards-shaped ETag wrapper (`"3"` or a weak `W/"3"`) some proxies/clients add.
  const unwrapped = raw.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1').trim();
  if (unwrapped === '') return null;
  const n = Number(unwrapped);
  return Number.isInteger(n) && n >= 1 ? n : null;
}
