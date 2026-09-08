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
