/// <reference types="node" />
import process from 'node:process';

// Rule ids the three gates emit, and only these: endpoint-allowlist, harness-allowlist, allowlist-overlap,
// demo-host, template-coverage, dead-injectable, dead-component, route-drift, spec-without-expect,
// write-boundary, credential-literal, internal.

/** One gate finding; any violation makes the gate exit non-zero (AAP 0.10.4). */
export interface Violation { rule: string; file: string; line: number; message: string }

/** What a gate body returns; `scanned` proves coverage on the summary line (AAP 0.8.2). */
export interface CheckOutcome { check: string; violations: Violation[]; notes: string[]; scanned: Record<string, number> }

/** Builds a finding verbatim, so each gate owns the rule id it emits (AAP 0.10.4). */
export function violation(rule: string, file: string, line: number, message: string): Violation {
  return { rule, file, line, message };
}

/** Plain code-unit ordering, so printed order never depends on the host locale (AAP 0.11.1). */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Orders findings within one rule by file, then by line numerically (AAP 0.11.1). */
function byFileThenLine(a: Violation, b: Violation): number {
  return compareText(a.file, b.file) || a.line - b.line;
}

/** Prints one outcome in the format all three gates share, interpolating only listed fields (AAP 0.10.4). */
export function printOutcome(outcome: CheckOutcome): void {
  console.log('▶ ' + outcome.check);
  for (const note of outcome.notes) {
    console.log('note: ' + note);
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
    console.log(rule);
    for (const found of [...(groups.get(rule) ?? [])].sort(byFileThenLine)) {
      const where = found.file === '' ? '' : found.file + ':' + found.line + ' — ';
      console.log(where + found.message);
    }
  }
  const counts = Object.entries(outcome.scanned).sort((a, b) => compareText(a[0], b[0])).map(([key, value]) => key + '=' + value);
  console.log(outcome.check + ': ' + outcome.violations.length + ' violation(s); scanned ' + (counts.join(', ') || 'none'));
  console.log(outcome.violations.length === 0 ? 'PASS' : 'FAIL');
}

/** Runs a gate body and turns its outcome, or its throw, into one exit code (AAP 0.10.4). */
export async function runCheck(check: string, body: () => Promise<CheckOutcome>): Promise<void> {
  try {
    const outcome = await body();
    printOutcome(outcome);
    process.exitCode = outcome.violations.length === 0 ? 0 : 1;
  } catch (error) {
    // A body may throw any arbitrary value, so the payload is narrowed from unknown rather than trusted.
    const thrown: unknown = error;
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    const stackLines = thrown instanceof Error && thrown.stack ? thrown.stack.split('\n') : [];
    printOutcome({
      check,
      violations: [violation('internal', '', 0, 'check body threw: ' + message)],
      notes: ['internal failure: ' + message, ...stackLines],
      scanned: {},
    });
    process.exitCode = 1;
  }
}
