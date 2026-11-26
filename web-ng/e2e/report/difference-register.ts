/**
 * The deliberate-difference register: the readings this run takes more narrowly than AAP 0.10.5's own
 * wording, carried into `parity-report.md` and `parity-report.json` so acceptance criterion 4's reader
 * can compare them with the shipped behaviour (AAP 0.10.5; AAP 0.10.3 criterion 4; AAP 0.11.1's report
 * row).
 *
 * Why it exists. AAP 0.10.5 registers the sixteen deliberate differences from legacy and requires each
 * of them to appear in the parity report as `intentional-diff` with its reason. Criterion 4 then has a
 * human inspect the report for exactly that: every `intentional-diff` row carries a non-empty reason
 * and cites its item by number. That vocabulary covers the rows a spec chooses to record, and it does
 * not cover a plan statement the run reads more narrowly than the plan wrote it: two of those were
 * settled by reading the shipped code and the archived legacy screens, which is AAP 0.3.4's rule —
 * "where the code disagrees with the request, the code wins and the difference is recorded in 0.10.5".
 * Until this module existed each of the two lived only in a comment beside the code that implements it,
 * which is not a place criterion 4's reader looks. {@link DIFFERENCE_REGISTER_READINGS} holds them,
 * {@link renderDifferenceRegister} renders them as the report's own section, and `ParityReport` carries
 * the same list in JSON, so the register, the specs and the delivered behaviour cannot drift apart
 * without the report showing it.
 *
 * What it is not. No entry changes behaviour and none is a new difference from legacy: each states what
 * the run delivers where the plan's sentence covers more ground than the shipped screens do, and the
 * deliberate differences from legacy remain AAP 0.10.5's sixteen (Rule 1 clause 3). Import has no side
 * effect — this module reads no file, calls no backend and needs no environment — so
 * `e2e/fixtures/parity-fixture.ts` reaches it through `report/parity-report.ts` while Playwright is
 * collecting, and `npx playwright test --list` still exits 0 (AAP 0.10.3).
 */

/**
 * One reading of AAP 0.10.5's register: the plan's own wording, what this run delivers instead, and the
 * authority that settles the difference. Every member is a finished sentence a reader compares against
 * the behaviour rather than a label, because the entry is what criterion 4's reader has to work from.
 */
export interface DifferenceRegisterReading {
  /** The register item and the subject it governs: the AAP section, the item number and what it covers. */
  readonly where: string;
  /** The plan's wording at that item, so a reader can see exactly what the run reads more narrowly. */
  readonly plan: string;
  /** What this run delivers, in the terms the specs and the running application show it. */
  readonly delivered: string;
  /** Why the delivered reading holds: the AAP decision and the user Rule behind it, and the code they rest on. */
  readonly why: string;
}

/**
 * The two readings this run takes more narrowly than the plan's wording, in AAP order: AAP 0.10.5 item
 * 15, the default dates a form opens with, and AAP 0.10.1's W2 row, the client template read. Both were
 * established from the shipped code and the archived legacy screens rather than chosen here, and both
 * are recorded rather than fixed: overriding a template-seeded control with the browser clock, or adding
 * a template read the shipped controllers never send, would show behaviour legacy does not have, which
 * AAP 0.3.4 and Rule 1 clauses 2 and 3 forbid.
 */
export const DIFFERENCE_REGISTER_READINGS: readonly DifferenceRegisterReading[] = [
  {
    where: 'AAP 0.10.5 item 15 — the default dates a form opens with',
    plan:
      'activation, submission, disbursement and repayment dates default from the browser clock exactly '
      + 'as legacy\'s do, and only the harness derives its run date from the tenant business date',
    delivered:
      'the submission, activation, approve, withdraw, deposit and create-client dates default from the '
      + 'browser clock; the loan application\'s disbursement date and the repayment form\'s transaction date '
      + 'are the values the Fineract template that seeds the screen carries (GET /loans/template and '
      + 'GET /loans/{id}/transactions/template?command=repayment), because a template-seeded control keeps '
      + 'the template\'s default in both front ends. The application issues no business-date request, and no '
      + 'form reads the browser clock where its template supplies a date.',
    why:
      'AAP 0.4.4 point 6 and Rule 1 clause 3 take a form\'s defaults and dropdown options from the same '
      + 'template endpoints legacy uses, so overriding the two seeded controls with the browser clock would '
      + 'show a default legacy never shows and register as a form-default difference in W4, W5 and W6, while '
      + 'reading the business date inside the application would add a call legacy never makes — the reason '
      + 'item 15 itself gives. The business date stays authoritative where AAP 0.10.1 and Rule 1 clause 2 '
      + 'require it: the seed, every workflow input and every comparison.',
  },
  {
    where: 'AAP 0.10.1 — the W2 create-and-activate row',
    plan: 'the ordered outcome names GET /clients/{id}?template=true between the create and the activation',
    delivered:
      'the create, record and activate path reads the plain client record and sends no template read; only '
      + 'the edit screen sends the template parameter, so the parity spec asserts the plain record read both '
      + 'front ends make and holds any template read to the row\'s ordering',
    why:
      'AAP 0.3.4 gives the shipped code precedence where it and the request disagree, and the archived legacy '
      + 'record screen reads the plain record — app/scripts/controllers/client/ViewClientController.js calls '
      + 'clientResource.get({clientId}) and never asks for the template — while Rule 1 clause 2 requires the '
      + 'same calls as legacy.',
  },
];

/** The register table's column headings, in the order a reader compares a reading: where, plan, run, why. */
const REGISTER_COLUMNS: readonly string[] = ['Where', 'The plan\'s wording', 'What the run delivers', 'Authority'];

/**
 * One table cell: the reading's own text on a single line, with runs of whitespace collapsed and pipes
 * escaped so the cell cannot end its row. The text is never cut — the report writer shortens a diff
 * value because a diff is an aside, while a reading is the statement criterion 4's reader compares
 * against the run, so it is carried whole.
 *
 * @param value The reading's text.
 */
function registerCell(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\|/g, '\\|');
}

/**
 * Renders the register as the report's `## Deliberate-difference register (AAP 0.10.5)` section: the
 * heading, a paragraph placing the entries against AAP 0.10.5's sixteen differences, and one table row
 * per reading. {@link renderMarkdown} in `report/parity-report.ts` inserts the lines between its
 * intentional-differences and failures sections, which is where criterion 4's reader looks for a
 * difference from the plan.
 *
 * @param readings The readings to render; the register's own list by default, so a caller that has
 * nothing narrower to add still gets the register rather than an absent section.
 * @returns The section's Markdown lines, in order, each a single line.
 */
export function renderDifferenceRegister(
  readings: readonly DifferenceRegisterReading[] = DIFFERENCE_REGISTER_READINGS,
): string[] {
  const lines: string[] = [
    '',
    '## Deliberate-difference register (AAP 0.10.5)',
    '',
    'The register itself is AAP 0.10.5\'s sixteen deliberate differences, and every `intentional-diff` row '
      + 'above cites one of them by number. The entries below are the ones this run reads more narrowly than '
      + 'the plan wrote them, stated with what the run delivers so that the register and the specs agree.',
    '',
    `| ${REGISTER_COLUMNS.join(' | ')} |`,
    `| ${REGISTER_COLUMNS.map(() => '---').join(' | ')} |`,
  ];
  for (const reading of readings) {
    lines.push(
      `| ${[reading.where, reading.plan, reading.delivered, reading.why].map(registerCell).join(' | ')} |`,
    );
  }
  return lines;
}
