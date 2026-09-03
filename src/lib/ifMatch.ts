// Parses an optional If-Match header as an integer version. Returns null for a
// missing or non-numeric value, which callers treat as "no guard" (last-write-wins).
export function parseIfMatch(request: { headers: { get(name: string): string | null } }): number | null {
  const raw = request.headers.get('if-match');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}
