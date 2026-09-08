import { appendFileSync, readFileSync } from 'node:fs';
import { classifyFailure, isFixable } from './lib/ciTriage';

const [, , logPath, workflow] = process.argv;
if (!logPath || !workflow) {
  console.error('usage: tsx scripts/ci-triage.ts <logFilePath> <workflowName>');
  process.exit(2);
}

let log = '';
try {
  log = readFileSync(logPath, 'utf8');
} catch {
  // Missing/empty log => nothing to classify; treat as unknown, spend no Claude tokens.
  log = '';
}

const cls = classifyFailure({ workflow, log });
const fixable = isFixable(cls);

console.log(`class=${cls} fixable=${fixable}`);

const out = process.env.GITHUB_OUTPUT;
if (out) appendFileSync(out, `class=${cls}\nfixable=${fixable}\n`);
