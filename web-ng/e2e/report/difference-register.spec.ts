/** The harness's own tests for `e2e/report/difference-register.ts` — the deliberate-difference register AAP 0.10.5 requires and acceptance criterion 4 has a human read (AAP 0.10.1, Rule 1 clause 4). */
import { describe, expect, it } from 'vitest';

import {
  DIFFERENCE_REGISTER_READINGS,
  renderDifferenceRegister,
  type DifferenceRegisterReading,
} from './difference-register';
import {
  renderMarkdown,
  type ParityReport,
  type ReportHeader,
  type WorkflowRow,
} from './parity-report';

const REGISTER_HEADING = '## Deliberate-difference register (AAP 0.10.5)';

/** A header holding every `ReportHeader` field, with addresses that name no Fineract endpoint: the register's section is what is under test here, so the run's own provenance is only required to be present and typed. */
const HEADER: ReportHeader = {
  environment: 'codespaces',
  backendRemote: 'Blitzy-Sandbox/blitzy-fineract',
  backendCommit: '74099701987ccb4755706d9a3de9fbbd3576ea1b',
  fineractUrl: 'https://localhost:8443',
  legacyUrl: 'http://localhost:9090',
  nextUrl: 'http://localhost:4300',
  runDate: '2026-11-24',
  generatedAt: '2026-11-26T00:52:11.345Z',
  backendVerified: true,
};

const PASS_ROW: WorkflowRow = { workflow: 'W1', project: 'next', status: 'pass', comparable: true };

/** A report carrying one pass row and the register, which is every field `ParityReport` requires. */
function minimalReport(): ParityReport {
  return { header: HEADER, workflows: [PASS_ROW], differenceRegister: DIFFERENCE_REGISTER_READINGS };
}

/** Line index of the first line equal to `line`, or `-1` when the document does not hold it. */
function indexOfLine(lines: readonly string[], line: string): number {
  return lines.findIndex((candidate) => candidate === line);
}

/** The reading the register records at `prefix` of its `where`, or `undefined` when it holds none. */
function readingWhere(prefix: string): DifferenceRegisterReading | undefined {
  return DIFFERENCE_REGISTER_READINGS.find((reading) => reading.where.startsWith(prefix));
}

describe('the deliberate-difference register\'s readings', () => {
  it('holds the four readings this run takes from the plan, and no other', () => {
    expect(DIFFERENCE_REGISTER_READINGS).toHaveLength(4);
    expect(readingWhere('AAP 0.10.5 item 5')).toBeDefined();
    expect(readingWhere('AAP 0.10.5 item 15')).toBeDefined();
    expect(readingWhere('AAP 0.10.1')).toBeDefined();
    expect(readingWhere('AAP 0.10.5 — the session-expiry warning')).toBeDefined();
  });

  it('states all four members of every reading rather than leaving one empty', () => {
    for (const reading of DIFFERENCE_REGISTER_READINGS) {
      expect(reading.where.trim().length).toBeGreaterThan(0);
      expect(reading.plan.trim().length).toBeGreaterThan(0);
      expect(reading.delivered.trim().length).toBeGreaterThan(0);
      expect(reading.why.trim().length).toBeGreaterThan(0);
    }
  });

  it('records item 5 as the savings screens the fixed cut order withdrew, with the reason and the Must scope kept', () => {
    const item5 = readingWhere('AAP 0.10.5 item 5');
    expect(item5?.delivered).toContain('the savings screens are not delivered');
    expect(item5?.delivered).toContain('no Must scope was dropped');
    expect(item5?.why).toContain('AAP 0.9.3 fixes the cut order');
    expect(item5?.why).toContain('5,214 lines in 17 files');
    expect(item5?.why).toContain('The revised totals stand in the report');
  });

  it('records item 15 as the template-seeded disbursement and repayment dates, with no business-date request', () => {
    const item15 = readingWhere('AAP 0.10.5 item 15');
    expect(item15?.delivered).toContain('disbursement date');
    expect(item15?.delivered).toContain('transaction date');
    expect(item15?.delivered).toContain('are the values the Fineract template that seeds the screen carries');
    expect(item15?.delivered).toContain('issues no business-date request');
  });

  it('records the W2 row as the plain client record read the parity spec asserts', () => {
    const w2 = readingWhere('AAP 0.10.1');
    expect(w2?.delivered).toContain('reads the plain client record');
    expect(w2?.delivered).toContain('the parity spec asserts the plain record read');
  });

  it('records the session-expiry copy as the application\'s own, English-only, with a bundle\'s wording taking over by itself', () => {
    const sessionExpiry = readingWhere('AAP 0.10.5 — the session-expiry warning');
    expect(sessionExpiry?.delivered).toContain('are the application\'s own copy in `APP_OWNED_TRANSLATIONS`');
    expect(sessionExpiry?.delivered).toContain('English-only in every one of the languages the switchers offer');
    expect(sessionExpiry?.delivered).toContain('no bundle under the legacy `app/global-translations/` tree carries either key');
    expect(sessionExpiry?.delivered).toContain('that bundle\'s wording wins automatically and no code changes');
    expect(sessionExpiry?.delivered).toContain('adding the copy to a build-owned bundle per locale is the path');
    expect(sessionExpiry?.why).toContain('AAP 0.1.1 requires the 10-second warning before logout');
    expect(sessionExpiry?.why).toContain('Rule 1 clause 6 keeps app/ read-only');
  });
});

describe('the rendered register', () => {
  const lines: readonly string[] = renderDifferenceRegister();

  it('opens with the section heading and the register\'s own placement of the entries', () => {
    expect(indexOfLine(lines, REGISTER_HEADING)).toBeGreaterThanOrEqual(0);
    expect(lines).toContain(
      'The register itself is AAP 0.10.5\'s sixteen deliberate differences, and every `intentional-diff` row '
        + 'above cites one of them by number. The entries below are the ones this run reads more narrowly than '
        + 'the plan wrote them — or, at item 5, does not deliver at all, as AAP 0.9.3\'s fixed cut order required — '
        + 'or, at the session-expiry warning, carries copy of the application\'s own because no legacy bundle '
        + 'supplies it, stated with what the run delivers so that the register and the specs agree.',
    );
  });

  it('holds a table whose four columns answer where, the plan, the run and why', () => {
    expect(lines).toContain('| Where | The plan\'s wording | What the run delivers | Authority |');
    expect(lines).toContain('| --- | --- | --- | --- |');
  });

  it('carries one row per reading with that reading\'s own where and delivered text', () => {
    for (const reading of DIFFERENCE_REGISTER_READINGS) {
      const row: string | undefined = lines.find(
        (line) => line.startsWith('| ') && line.includes(reading.where) && line.includes(reading.delivered),
      );
      expect(row).toBeDefined();
      expect(row).toContain(reading.plan);
      expect(row).toContain(reading.why);
    }
  });

  it('keeps every row on one line of exactly the four cells, so no reading can break the table', () => {
    const rows: readonly string[] = lines.filter((line) => line.startsWith('| ') && line.includes('AAP 0.'));
    expect(rows).toHaveLength(DIFFERENCE_REGISTER_READINGS.length);
    for (const row of rows) {
      expect(row).not.toContain('\n');
      expect(row.match(/(?<!\\)\|/g) ?? []).toHaveLength(5);
    }
  });
});

describe('the report carries the register', () => {
  it('renders the section between the intentional differences and the failures', () => {
    const markdown: string = renderMarkdown(minimalReport());
    const registerAt: number = markdown.indexOf(REGISTER_HEADING);
    const intentionalAt: number = markdown.indexOf('## Intentional differences');
    const fallbackAt: number = markdown.indexOf('No difference from legacy was recorded as intentional.');
    const failuresAt: number = markdown.indexOf('## Failures');
    expect(intentionalAt).toBeGreaterThanOrEqual(0);
    expect(fallbackAt).toBeGreaterThan(intentionalAt);
    expect(registerAt).toBeGreaterThan(fallbackAt);
    expect(failuresAt).toBeGreaterThan(registerAt);
    for (const reading of DIFFERENCE_REGISTER_READINGS) {
      expect(markdown).toContain(reading.delivered);
    }
  });

  it('hands the JSON the same readings the Markdown renders', () => {
    const report: ParityReport = minimalReport();
    // Documented boundary (Rule 1 clause 4): `JSON.parse` is untyped, and the document is this file's own.
    const document = JSON.parse(JSON.stringify(report)) as { differenceRegister: readonly DifferenceRegisterReading[] };
    expect(document.differenceRegister).toEqual(DIFFERENCE_REGISTER_READINGS);
    expect(document.differenceRegister.map((reading) => reading.where)).toEqual(
      DIFFERENCE_REGISTER_READINGS.map((reading) => reading.where),
    );
  });
});
