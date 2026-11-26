/** The deliberate-difference register: the readings this run takes more narrowly than AAP 0.10.5's own wording, and the one copy it carries because no legacy bundle supplies it, carried into `parity-report.md` and `parity-report.json` so acceptance criterion 4's reader can compare them (AAP 0.10.3, AAP 0.11.1, AAP 0.3.4, Rule 1 clause 3). */

/** One reading of AAP 0.10.5's register: the plan's own wording, what this run delivers instead, and the authority that settles the difference. */
export interface DifferenceRegisterReading {
  /** The register item and the subject it governs: the AAP section, the item number and what it covers. */
  readonly where: string;
  readonly plan: string;
  readonly delivered: string;
  /** Why the delivered reading holds: the AAP decision and the user Rule behind it, and the code they rest on. */
  readonly why: string;
}

/** The four readings this run takes from the plan's wording, in AAP order: AAP 0.10.5 item 5, the savings entry point AAP 0.9.3's fixed cut order withdrew; AAP 0.10.5 item 15, the default dates a form opens with; AAP 0.10.1's W2 row, the client template read (AAP 0.3.4); and AAP 0.10.5 itself, the session-expiry copy the application owns because no legacy bundle carries a key for it. */
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
  {
    where: 'AAP 0.10.5 — the session-expiry warning\'s copy, which the register\'s sixteen differences do not cover',
    plan:
      'every label resolves through the legacy `app/global-translations/*.json` bundles ngx-translate loads in place '
      + '(AAP 0.1.1, AAP 0.4.3), and the register\'s sixteen differences carry no entry for the shell\'s session-expiry '
      + 'warning',
    delivered:
      'the idle warning\'s two strings — `label.message.session.expiring` and `label.button.stay.signed.in` — are the '
      + 'application\'s own copy in `APP_OWNED_TRANSLATIONS` rather than a legacy bundle\'s, because no bundle under the '
      + 'legacy `app/global-translations/` tree carries either key, and that copy is English-only in every one of the '
      + 'languages the switchers offer. The handler that supplies it runs only for keys the active and fallback bundles '
      + 'lack, so the day a legacy or build-owned per-locale bundle carries either key, that bundle\'s wording wins '
      + 'automatically and no code changes; adding the copy to a build-owned bundle per locale is the path to a '
      + 'translated warning.',
    why:
      'AAP 0.1.1 requires the 10-second warning before logout, the legacy bundles AAP 0.4.3 loads carry no key for it, '
      + 'and Rule 1 clause 6 keeps app/ read-only, so a key invented in a legacy bundle is not available — while '
      + 'answering the two keys with neither copy nor a bundle would put the humanised fragments "Expiring" and "In" in '
      + 'front of the user. Rule 1 clause 3 asks every deliberate difference from legacy to be listed with its reason, '
      + 'which is what this entry does; shell.component.html renders both strings.',
  },
];

const REGISTER_COLUMNS: readonly string[] = ['Where', 'The plan\'s wording', 'What the run delivers', 'Authority'];

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
      + 'or, at the session-expiry warning, carries copy of the application\'s own because no legacy bundle '
      + 'supplies it, stated with what the run delivers so that the register and the specs agree.',
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
