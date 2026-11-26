/** The deliberate-difference register: the readings this run takes more narrowly than AAP 0.10.5's own wording, carried into `parity-report.md` and `parity-report.json` so acceptance criterion 4's reader can compare them (AAP 0.10.3, AAP 0.11.1, AAP 0.3.4, Rule 1 clause 3). */

/** One reading of AAP 0.10.5's register: the plan's own wording, what this run delivers instead, and the authority that settles the difference. */
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

/** The three readings this run takes from the plan's wording, in AAP order: AAP 0.10.5 item 5, the savings entry point AAP 0.9.3's fixed cut order withdrew; AAP 0.10.5 item 15, the default dates a form opens with; and AAP 0.10.1's W2 row, the client template read (AAP 0.3.4). */
export const DIFFERENCE_REGISTER_READINGS: readonly DifferenceRegisterReading[] = [
  {
    where: 'AAP 0.10.5 item 5 — the client record\'s "New Saving" entry point',
    plan: 'the savings entry point is rendered because Stretch ships',
    delivered:
      'the savings screens are not delivered: the record offers `Edit`, `New Loan` and `Close` and no "New Saving", '
      + 'and the savings application, record and action screens, their three routes, their e2e page objects and their '
      + 'spec are gone. Every Must workflow keeps its screen and its spec, and no Must scope was dropped.',
    why:
      'AAP 0.9.3 fixes the cut order for the case its 60,000-line ceiling cannot otherwise be met — first drop Stretch '
      + '(savings, workflow W8), then trim the e2e suite to the Must workflows, and stop there — and requires every cut to '
      + 'be recorded with its reason and its revised totals. The tree crossed that ceiling while the workflow screens '
      + 'landed and stood at 88,418 lines before the prose trim, so the order engaged: W8 was the only Stretch workflow and '
      + 'its spec the only Stretch spec, so its first step contains the second. Restoring the cut half — 5,214 lines in 17 '
      + 'files — would put the tree back over that ceiling, which is why the cut stands and is not undone. '
      + 'The revised totals stand in the report\'s `## Line budget` section, and Rule 1 clause 10 is met by that record.',
  },
  {
    where: 'AAP 0.10.5 item 15 — the default dates a form opens with',
    plan:
      'activation, submission, disbursement and repayment dates default from the browser clock exactly '
      + 'as legacy\'s do, and only the harness derives its run date from the tenant business date',
    delivered:
      'the submission, activation, approve, withdraw and create-client dates default from the '
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

/** One table cell: the reading's own text on a single line, with runs of whitespace collapsed and pipes escaped so the cell cannot end its row. */
function registerCell(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\|/g, '\\|');
}

/** Renders the register as the report's `## Deliberate-difference register (AAP 0.10.5)` section: the heading, a paragraph placing the entries against AAP 0.10.5's sixteen differences, and one table row per reading. {@link. */
export function renderDifferenceRegister(
  readings: readonly DifferenceRegisterReading[] = DIFFERENCE_REGISTER_READINGS,
): string[] {
  const lines: string[] = [
    '',
    '## Deliberate-difference register (AAP 0.10.5)',
    '',
    'The register itself is AAP 0.10.5\'s sixteen deliberate differences, and every `intentional-diff` row '
      + 'above cites one of them by number. The entries below are the ones this run reads more narrowly than '
      + 'the plan wrote them — or, at item 5, does not deliver at all, as AAP 0.9.3\'s fixed cut order required — '
      + 'stated with what the run delivers so that the register and the specs agree.',
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
