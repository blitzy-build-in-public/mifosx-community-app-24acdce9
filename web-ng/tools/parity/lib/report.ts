/// <reference types="node" />
import process from 'node:process';
// Rule ids the three gates emit, and only these: endpoint-allowlist, harness-allowlist, allowlist-overlap, demo-host, template-coverage, dead-injectable, dead-component, route-drift, spec-without-expect, write-boundary, credential-literal, internal.
/** One gate finding; any violation makes the gate exit non-zero (AAP 0.10.4). */
export interface Violation { rule: string; file: string; line: number; message: string }
/** What a gate body returns; `scanned` proves coverage on the summary line (AAP 0.8.2). */
export interface CheckOutcome { check: string; violations: Violation[]; notes: string[]; scanned: Record<string, number> }
/** Builds a finding verbatim, so each gate owns the rule id it emits (AAP 0.10.4). */
export function violation(rule: string, file: string, line: number, message: string): Violation {
  return { rule, file, line, message };}
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;}
function byFileThenLine(a: Violation, b: Violation): number {
  return compareText(a.file, b.file) || a.line - b.line;}
const REDACTED = '***';
const AUTHORIZATION_HEADER = /authorization:[^\r\n]*/gi;
const BASIC_CREDENTIAL = /\bbasic\s+[A-Za-z0-9+/=]+/gi;
/** A credential-shaped key and the value assigned to it, quoted or bare, in an assignment or in the JSON body a thrown message stringifies; the key stays readable and only the value is masked, and bare `credential`/`credentials` are absent so "credentials: E2E_PASSWORD is not set" keeps its words. */
const CREDENTIAL_ASSIGNMENT = /\b([A-Za-z0-9_]*(?:password|passwd|secret|authenticationKey|apiKey|token))(["']\s*[:=]\s*["']?|["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^"\r\n]*|[^\s,;]+)/gi;
/** Masks the authentication material a line of gate output can carry — each non-empty supplied secret, an `authorization:` value, a `Basic` credential and a credential-shaped assignment — so nothing printed carries a credential (Rule 1 clause 9 bullet 2). */
export function redactSensitive(text: string, secrets: readonly string[] = []): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret.length > 0) {
      redacted = redacted.split(secret).join(REDACTED);}}
  redacted = redacted.replace(AUTHORIZATION_HEADER, `authorization: ${REDACTED}`);
  redacted = redacted.replace(BASIC_CREDENTIAL, `Basic ${REDACTED}`);
  return redacted.replace(CREDENTIAL_ASSIGNMENT, `$1$2${REDACTED}`);
}
/** Prints one outcome in the format all three gates share (AAP 0.10.4), masking every line through {@link redactSensitive} with the caller's `secrets` so nothing printed carries a credential (Rule 1 clause 9 bullet 2). */
export function printOutcome(outcome: CheckOutcome, secrets: readonly string[] = []): void {
  const write = (line: string): void => { console.log(redactSensitive(line, secrets)); };
  write('▶ ' + outcome.check);
  for (const note of outcome.notes) {
    write('note: ' + note);
  }
  const groups = new Map<string, Violation[]>();
  for (const found of outcome.violations) {
    const bucket = groups.get(found.rule);
    if (bucket === undefined) {
      groups.set(found.rule, [found]);
    } else {
      bucket.push(found);
    }
  }
  for (const rule of [...groups.keys()].sort(compareText)) {
    write(rule);
    for (const found of [...(groups.get(rule) ?? [])].sort(byFileThenLine)) {
      const where = found.file === '' ? '' : found.file + ':' + found.line + ' — ';
      write(where + found.message);
    }
  }
  const counts = Object.entries(outcome.scanned).sort((a, b) => compareText(a[0], b[0])).map(([key, value]) => key + '=' + value);
  write(outcome.check + ': ' + outcome.violations.length + ' violation(s); scanned ' + (counts.join(', ') || 'none'));
  write(outcome.violations.length === 0 ? 'PASS' : 'FAIL');
}
/** Runs a gate body and turns its outcome, or its throw, into one exit code (AAP 0.10.4), printing through {@link printOutcome} so a thrown message and stack are masked the same way (Rule 1 clause 9 bullet 2). */
export async function runCheck(check: string, body: () => Promise<CheckOutcome>, secrets: readonly string[] = []): Promise<void> {
  try {
    const outcome = await body();
    printOutcome(outcome, secrets);
    process.exitCode = outcome.violations.length === 0 ? 0 : 1;
  } catch (error) {
    const thrown: unknown = error;
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    const stackLines = thrown instanceof Error && thrown.stack ? thrown.stack.split('\n') : [];
    printOutcome({
      check,
      violations: [violation('internal', '', 0, 'check body threw: ' + message)],
      notes: ['internal failure: ' + message, ...stackLines],
      scanned: {},
    }, secrets);
    process.exitCode = 1;
  }
}
