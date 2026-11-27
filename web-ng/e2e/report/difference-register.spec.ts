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

function indexOfLine(lines: readonly string[], line: string): number {
  return lines.findIndex((candidate) => candidate === line);
}

/** The reading the register records at `prefix` of its `where`, or `undefined` when it holds none. */
function readingWhere(prefix: string): DifferenceRegisterReading | undefined {
  return DIFFERENCE_REGISTER_READINGS.find((reading) => reading.where.startsWith(prefix));
}

describe('the deliberate-difference register\'s readings', () => {
  it('holds the ten readings this run takes from the plan, and no other', () => {
    expect(DIFFERENCE_REGISTER_READINGS).toHaveLength(10);
    expect(readingWhere('AAP 0.10.5 item 5')).toBeDefined();
    expect(readingWhere('AAP 0.10.5 item 15')).toBeDefined();
    expect(readingWhere('AAP 0.8.2 and 0.1.1')).toBeDefined();
    expect(readingWhere('AAP 0.9.1 group 3 and 0.9.3')).toBeDefined();
    expect(readingWhere('AAP 0.10.1')).toBeDefined();
    expect(readingWhere('AAP 0.10.5 — the session-expiry warning')).toBeDefined();
    expect(readingWhere('AAP 0.10.5 — the two legacy literals')).toBeDefined();
    expect(readingWhere('AAP 0.10.5 — the bounded request')).toBeDefined();
    expect(readingWhere('AAP 0.10.5 — a credential refusal')).toBeDefined();
    expect(readingWhere('AAP 0.10.5 — the accessibility markup')).toBeDefined();
  });

  it('states all six members of every reading rather than leaving one empty', () => {
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

  it('records item 15 as the date defaults the application itself chooses, and the payload dates a server carries', () => {
    const item15 = readingWhere('AAP 0.10.5 item 15');
    expect(item15?.delivered).toContain('every date default the application itself chooses comes from the browser clock');
    expect(item15?.delivered).toContain('the repayment form\'s transaction date');
    expect(item15?.delivered).toContain('Where a server payload carries the date a form opens on');
    expect(item15?.delivered).toContain('the client create form\'s activation date comes from the client template\'s `activationDate`');
    expect(item15?.delivered).toContain('the loan edit form\'s two dates come from the loan\'s own `timeline`');
    expect(item15?.delivered).toContain('No form seeds a date member from GET /loans/template');
    expect(item15?.delivered).toContain('issues no business-date request');
    expect(item15?.why).toContain('register as a request difference in every workflow');
  });

  it('records the charge form\'s payment date as the one default that does not follow legacy, with the read this build does not make', () => {
    const item15 = readingWhere('AAP 0.10.5 item 15');
    expect(item15?.delivered).toContain('the due date the charge form fills for a specified-due-date charge');
    expect(item15?.delivered).toContain('The charge form\'s payment date is the one default that does not follow legacy');
    expect(item15?.delivered).toContain('`GET /loans/{id}/charges/{chargeId}?command=pay`');
    expect(item15?.delivered).toContain('seeds the payment date from the charge\'s `dueDate`');
    expect(item15?.delivered).toContain('opens it on the browser clock and issues no per-charge read');
    expect(item15?.why).toContain('lies outside AAP 0.7.3\'s loan-charge row');
    expect(item15?.why).toContain('AAP 0.10.4 admits a URL outside that table only with a justification written into the plan');
    expect(item15?.why).toContain('registering the divergence is the alternative that rule leaves');
  });

  it('records the charge-action route as legacy\'s paycharge and waivecharge with the aliases beside them, and editcharge not found', () => {
    const route = readingWhere('AAP 0.8.2 and 0.1.1');
    expect(route?.delivered).toContain('serves legacy\'s own segments `paycharge` and `waivecharge`');
    expect(route?.delivered).toContain('accepts `pay` and `waive` as aliases');
    expect(route?.delivered).toContain('`editcharge` resolves to not found and issues no request');
    expect(route?.delivered).toContain('outside the charge scope of AAP 0.9.1 group 3');
    expect(route?.why).toContain('AAP 0.8.2 fixes the route pattern and leaves the vocabulary to the tree');
    expect(route?.why).toContain('Rule 1 clause 5 requires hash routing with paths mirroring legacy\'s URLs');
    expect(route?.why).toContain('Rule 1 clause 3 asks the one deliberate difference');
  });

  it('records the charge-pay happy path as unreachable, with the refusal the screen renders and add and waive proven', () => {
    const chargePay = readingWhere('AAP 0.9.1 group 3 and 0.9.3');
    expect(chargePay?.delivered).toContain('add and waive are exercised end to end against that fixture');
    expect(chargePay?.delivered).toContain('the pay command\'s happy path is unreachable in the delivered scope');
    expect(chargePay?.delivered).toContain('is Regular mode (`chargePaymentMode: 0`');
    expect(chargePay?.delivered).toContain('needs a loan-linked savings account');
    expect(chargePay?.delivered).toContain('This loan charge cannot be paid as the charge payment mode is not account transfer');
    expect(chargePay?.delivered).toContain('renders verbatim above the form with the entered date kept');
    expect(chargePay?.why).toContain('refuses to add or to pay an account-transfer loan charge');
    expect(chargePay?.why).toContain('The savings family is the first item of AAP 0.9.3\'s fixed cut order');
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

  it('records the clients card title and the login paragraph as the application\'s own copy, in English and in French', () => {
    const literals = readingWhere('AAP 0.10.5 — the two legacy literals');
    expect(literals?.plan).toContain('carry no entry for the clients list\'s card title');
    expect(literals?.delivered).toContain('render through the application\'s own copy in `core/i18n/app-translations.ts`');
    expect(literals?.delivered).toContain('`label.heading.listofclients`');
    expect(literals?.delivered).toContain('`label.text.mifosx.community`');
    expect(literals?.delivered).toContain('English is byte-identical to what both screens rendered before');
    expect(literals?.delivered).toContain('French copy is carried for exactly those seven keys');
    expect(literals?.delivered).toContain('the eleven other offered languages fall back to the English copy');
    expect(literals?.delivered).toContain('wins with no code change');
    expect(literals?.why).toContain('AAP 0.1.1 requires i18n through ngx-translate');
    expect(literals?.why).toContain('AAP 0.7.4 names the card title "List of Clients"');
    expect(literals?.why).toContain('No file under the read-only `app/global-translations/` carries a key');
    expect(literals?.why).toContain(
      'Rule 1 clause 3 asks every deliberate difference from legacy to be listed with its reason',
    );
  });

  it('records the bounded request as a 30-second limit with its own sentence, one notice and an untouched answer inside the bound', () => {
    const timeout = readingWhere('AAP 0.10.5 — the bounded request');
    expect(timeout?.plan).toContain('no request the application sends carries a client-side time limit');
    expect(timeout?.delivered).toContain('fails once 30 seconds pass without an answer');
    expect(timeout?.delivered).toContain('timeout({ first: 30_000, each: 30_000 })');
    expect(timeout?.delivered).toContain('The server did not answer in time. Try again in a moment.');
    expect(timeout?.delivered).toContain('raises exactly one notification for it and rethrows it');
    expect(timeout?.delivered).toContain('A request that answers inside the bound is untouched');
    expect(timeout?.why).toContain('AAP 0.14.2 requires every HTTP call path to end in a rendered message');
  });

  it('records the status-0 credential refusal as the session end a 401 cannot deliver, with a re-validation that keeps a working session', () => {
    const refusal = readingWhere('AAP 0.10.5 — a credential refusal');
    expect(refusal?.delivered).toContain('fails with status 0 and the one re-validation read');
    expect(refusal?.delivered).toContain('the stored entry is removed');
    expect(refusal?.delivered).toContain('a single notice says the session has ended and to sign in again');
    expect(refusal?.delivered).toContain('A status-0 failure whose re-validation answers 200 is a transport fault');
    expect(refusal?.delivered).toContain('a backend that refuses the connection outright answers status 0 at once');
    expect(refusal?.delivered).toContain('not before the router\'s first navigation');
    expect(refusal?.why).toContain('401 sent outside its CORS filter');
    expect(refusal?.why).toContain('legacy leaves the refused key in storage and its screen blank');
  });

  it('records the accessibility markup the sixteen differences do not cover, naming legacy\'s bare trail and valueless href', () => {
    const accessibility = readingWhere('AAP 0.10.5 — the accessibility markup');
    expect(accessibility?.plan).toContain('no markup role, landmark or tab stop among them');
    expect(accessibility?.delivered).toContain('<nav aria-label="Breadcrumb">');
    expect(accessibility?.delivered).toContain('role="tab"');
    expect(accessibility?.delivered).toContain('no tab offers an open-in-new-tab that would reload the page');
    expect(accessibility?.why).toContain('Legacy renders the bare `<ul class="breadcrumb">`');
    expect(accessibility?.why).toContain('require every deliberate difference to be listed with its reason');
  });
});

describe('the rendered register', () => {
  const lines: readonly string[] = renderDifferenceRegister();

  it('opens with the section heading and the register\'s own placement of the entries', () => {
    expect(indexOfLine(lines, REGISTER_HEADING)).toBeGreaterThanOrEqual(0);
    expect(lines).toContain(
      'The register itself is AAP 0.10.5\'s sixteen deliberate differences, and every `intentional-diff` row '
        + 'above cites one of them by number. The entries below are the ten readings this run states on the '
        + 'register\'s behalf: readings narrower than the plan wrote them — at item 5 a difference the run does not '
        + 'deliver at all, as AAP 0.9.3\'s fixed cut order required, at item 15 the charge form\'s payment date, '
        + 'which legacy seeds from the charge itself, and at the session-expiry warning copy of the application\'s '
        + 'own because no legacy bundle supplies it — the charge-action route\'s action vocabulary, the charge-pay '
        + 'happy path the cut savings family leaves unreachable, and the clients card title and login paragraph the '
        + 'legacy bundles supply no key for, the two failure behaviours this run adds where the sixteen differences '
        + 'name none, and the accessibility markup the sixteen name nowhere, each stated with what the run delivers '
        + 'so that the register and the specs agree.',
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
