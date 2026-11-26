/**
 * The harness's own tests for `e2e/report/difference-register.ts` — the deliberate-difference register
 * AAP 0.10.5 requires and acceptance criterion 4 has a human read.
 *
 * Why this file exists. AAP 0.10.5 registers the sixteen deliberate differences from legacy, and
 * criterion 4 requires a reader to find every one of them in `web-ng/parity-report.json` with its
 * reason. The register carries the two plan statements this run reads more narrowly than the plan wrote
 * them — AAP 0.10.5 item 15's default dates and AAP 0.10.1's W2 client-template read — because both
 * were settled by reading the shipped code and the archived legacy screens rather than by choosing a
 * behaviour here, and until this module existed each reading lived only in a comment beside the code
 * that implements it. A register nothing checks is a register that drifts: a reading deleted from the
 * list, retitled, emptied of its authority, or a section that stops being rendered into the report
 * would leave criterion 4's reader with no statement to compare against the run, and no gate would say
 * so.
 *
 * What is pinned here: both readings exist and every member of each is a non-empty statement; the
 * rendered lines carry the section heading, the table's four column headings and one row per reading
 * holding that reading's own `where` and `delivered` text; the item-15 row states the template-seeded
 * disbursement and repayment dates and that the application issues no business-date request; the W2 row
 * states that the plain client record read is what the parity spec asserts; and `renderMarkdown` places
 * the whole section between the intentional-differences section and the failures section of a minimal
 * in-memory report, whose JSON carries the same list under `differenceRegister`.
 *
 * These are the harness's tests, not the Playwright workflow specs: they run under the `web-ng-harness`
 * vitest project (`e2e/vitest.config.ts`, `npm run test:harness`) in a plain Node environment, and they
 * write no file, start no browser and call no backend. Every expectation is written against the two
 * modules' real exports; the one cast is the parsed JSON of a report built here in memory, which is the
 * documented boundary where a document arrives untyped (Rule 1 clause 4).
 */
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

/** The section heading the report renders the register under, and the line a reader looks for. */
const REGISTER_HEADING = '## Deliberate-difference register (AAP 0.10.5)';

/**
 * A header holding every `ReportHeader` field, with addresses that name no Fineract endpoint: the
 * register's section is what is under test here, so the run's own provenance is only required to be
 * present and typed.
 */
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

/** The one row a minimal report needs: a workflow that passed on the new app, so no section fails it. */
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
  it('holds the two readings this run takes more narrowly than the plan, and no other', () => {
    expect(DIFFERENCE_REGISTER_READINGS).toHaveLength(2);
    expect(readingWhere('AAP 0.10.5 item 15')).toBeDefined();
    expect(readingWhere('AAP 0.10.1')).toBeDefined();
  });

  it('states all four members of every reading rather than leaving one empty', () => {
    for (const reading of DIFFERENCE_REGISTER_READINGS) {
      expect(reading.where.trim().length).toBeGreaterThan(0);
      expect(reading.plan.trim().length).toBeGreaterThan(0);
      expect(reading.delivered.trim().length).toBeGreaterThan(0);
      expect(reading.why.trim().length).toBeGreaterThan(0);
    }
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
});

describe('the rendered register', () => {
  const lines: readonly string[] = renderDifferenceRegister();

  it('opens with the section heading and the register\'s own placement of the entries', () => {
    expect(indexOfLine(lines, REGISTER_HEADING)).toBeGreaterThanOrEqual(0);
    expect(lines).toContain(
      'The register itself is AAP 0.10.5\'s sixteen deliberate differences, and every `intentional-diff` row '
        + 'above cites one of them by number. The entries below are the ones this run reads more narrowly than '
        + 'the plan wrote them, stated with what the run delivers so that the register and the specs agree.',
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
      // Four cells hold five unescaped pipes: a pipe written inside a reading arrives escaped, so the
      // row keeps its column count however the reading's own text is worded.
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
