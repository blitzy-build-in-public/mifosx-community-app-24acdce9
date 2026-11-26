/** W4 — submit an individual loan application after previewing its repayment schedule, on both front ends (AAP 0.10.1 W4, AAP 0.11.1 row 52, Rule 1 clause 8) (AAP 0.10.4, Rule 1 clause 2, AAP 0.10.5). */
import type { CaptureSession, NormalizedExchange } from '../capture/network-capture';
import { snapshotLoan } from '../capture/state-snapshot';
import { expect, test } from '../fixtures/parity-fixture';
import {
  LOCALE,
  PAYLOAD_DATE_FORMAT,
  SCENARIO,
  SEED_LOAN_PRODUCT,
  dayOffset,
  formatDateOnly,
  parseFineractDate,
  readCredentials,
} from '../seed/fixtures';
/** The loan template read of AAP 0.7.3's "W4 loan application" row, below the API path. */
const LOAN_TEMPLATE_PATH = '/loans/template';
/** The loan collection: AAP 0.7.3's preview posts to it with a command, the submission without one. */
const LOAN_COLLECTION_PATH = '/loans';
/** The query `command` AAP 0.7.3 fixes for the repayment-schedule preview. */
const PREVIEW_COMMAND = 'calculateLoanSchedule';
/** `#/viewclient/:id` — the client record W4 is entered from (AAP 0.8.2). */
const CLIENT_RECORD_HASH = /^#\/viewclient\/(\d+)$/;
/** `#/newclientloanaccount/:clientId` — the application screen (AAP 0.8.2). */
const NEW_LOAN_HASH = /^#\/newclientloanaccount\/(\d+)$/;
/** `#/viewloanaccount/:id` — the record the submission lands on (AAP 0.8.2). */
const LOAN_RECORD_HASH = /#\/viewloanaccount\/(\d+)/;
const CAPTURE_WAIT_MS = 20_000;
const AMOUNT_TOLERANCE = 1;
/** The application members the preview body and the submission body must agree on (AAP 0.7.2 `LoanApplicationRequest`); one builder posts both, so their agreement is the application's property. */
const SHARED_APPLICATION_FIELDS: readonly string[] = [
  'clientId',
  'productId',
  'loanType',
  'principal',
  'loanTermFrequency',
  'loanTermFrequencyType',
  'numberOfRepayments',
  'repaymentEvery',
  'repaymentFrequencyType',
  'interestRatePerPeriod',
  'interestRateFrequencyType',
  'amortizationType',
  'interestType',
  'interestCalculationPeriodType',
  'transactionProcessingStrategyCode',
  'expectedDisbursementDate',
  'submittedOnDate',
  'dateFormat',
  'locale',
];
/** One preview row over both readers — `pages/next` parses cells into numbers, `pages/legacy` reports text — read-only, because a spec observes the screen. */
interface PreviewRowReading {
  readonly period: number | string | null;
  readonly dueDate: string;
  readonly principalDue: number | string | null;
}
/** The record's status colour and label/value rows over both readers: the pair types differ by name only, which is what lets one assertion read both front ends (AAP 0.10.2). */
interface LoanSummaryReading {
  readonly statusClass: string;
  readonly fields: readonly { readonly label: string; readonly value: string }[];
}
interface NamedClientRow {
  readonly name: string;
}
interface PrincipalBounds {
  /** The control's declared `min`, or `null` when it declares none. */
  readonly min: string | null;
  /** The control's declared `max`, or `null` when it declares none. */
  readonly max: string | null;
}
/** Narrows a captured body to an object: the documented boundary where the spec narrows a payload that crossed an HTTP boundary the harness does not model (Rule 1 clause 4). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** The request body of one exchange as an object, or `null` when the exchange carried none. */
function bodyOf(exchange: NormalizedExchange): Record<string, unknown> | null {
  return isRecord(exchange.requestBody) ? exchange.requestBody : null;
}
/** A rendered figure or captured member as a number in either separator style (`5,000` or `5000`), or `null` when it carries no digit — never a zero nothing displayed. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const stripped = value.replace(/[^0-9.-]/g, '');
  if (!/[0-9]/.test(stripped)) {
    return null;
  }
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? parsed : null;
}
/** A row's period number as a whole number, or `null` for the unnumbered disbursement period Fineract's schedule opens with. */
function toPeriodNumber(value: unknown): number | null {
  const parsed = toNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}
/** The hash of a URL, or `''` when it carries none. A hash holds a route, never a credential. */
function hashOf(url: string): string {
  const marker = url.indexOf('#');
  return marker === -1 ? '' : url.slice(marker);
}
function routeId(url: string, pattern: RegExp, what: string): number {
  const hash = hashOf(url);
  const matched = pattern.exec(hash);
  if (matched === null) {
    throw new Error(`${what} is not on screen: the page is at "${hash}", which is not ${String(pattern)}`);
  }
  return Number(matched[1]);
}

/** Whether a captured date member names the run date. The capture rewrites a date to its day offset from the run date — the run date itself becomes `d0` — and leaves a value it could not read as a date verbatim (AAP 0.10.2. */
function namesRunDate(value: unknown, runDate: Date): boolean {
  if (value === 'd0') {
    return true;
  }
  const parsed = parseFineractDate(value);
  return parsed !== null && dayOffset(runDate, parsed) === 0;
}

/** Whether a control's own text is a calendar date, in either shape the two front ends render one: the new application's `yyyy-mm-dd` native date input and the legacy screen's `dd MMMM yyyy` text. @param text The control's. */
function isCalendarDate(text: string): boolean {
  return parseFineractDate(text) !== null;
}

/** Whether a captured identifier names the client this run opened (AAP 0.10.2). */
function namesClient(value: unknown, clientId: number): boolean {
  if (typeof value === 'number') {
    return value === clientId;
  }
  return typeof value === 'string' && (value === '{clientId}' || value === String(clientId));
}

/** Whether one exchange is the loan template read of AAP 0.7.3's "W4 loan application" row. */
function isLoanTemplateRead(exchange: NormalizedExchange): boolean {
  return exchange.method === 'GET' && exchange.path.endsWith(LOAN_TEMPLATE_PATH);
}

/** Whether one exchange is a `POST /loans`, with the command the caller names or — for `null` — with no command at all, which is the submission. @param exchange One normalised API exchange. @param command The `command`. */
function isLoanPost(exchange: NormalizedExchange, command: string | null): boolean {
  if (exchange.method !== 'POST' || !exchange.path.endsWith(LOAN_COLLECTION_PATH)) {
    return false;
  }
  const sent = exchange.query['command'];
  return command === null ? sent === undefined : sent === command;
}

async function awaitExchanges(
  capture: CaptureSession,
  matches: (exchange: NormalizedExchange) => boolean,
): Promise<readonly NormalizedExchange[]> {
  await expect
    .poll(() => capture.capture.exchanges.filter(matches).length, { timeout: CAPTURE_WAIT_MS })
    .toBeGreaterThan(0);
  return capture.capture.exchanges.filter(matches);
}

function readPrincipalBounds(element: Element): PrincipalBounds {
  return { min: element.getAttribute('min'), max: element.getAttribute('max') };
}

test.describe('W4 submit an individual loan application after previewing the schedule', () => {
  test('W4: preview the 12-period schedule of the 5,000 Parity Loan and submit the application', async ({
    runWorkflow,
  }) => {
    await runWorkflow('W4', async ({ page, pages, capture, runDate }) => {
      // 1. Sign in through the application's own login screen (AAP 0.10.1 W1) (Rule 1 clause 9).
      const credentials = readCredentials();
      await pages.login.open();
      await pages.login.signIn(credentials.username, credentials.password);

      // 2. The client list, and the precondition this spec runs under: W2's client must already be there (AAP 0.10.1, AAP 0.10.4).
      await pages.clients.open();
      const clientRows: readonly NamedClientRow[] = await pages.clients.readRows();
      const clientNames = clientRows.map((row) => row.name.trim());
      const requiredClient = SCENARIO.client.displayName;
      const present = clientNames.some((name) => name.toLowerCase() === requiredClient.toLowerCase());
      if (!present) {
        throw new Error(
          `W4 needs the client "${requiredClient}" that W2 creates, and the list shows ` +
            `${clientNames.length} row(s): ${clientNames.length === 0 ? '(none)' : clientNames.join(', ')}. ` +
            'The suite runs per project in filename order against one seeded database, so ' +
            'w2-create-client.spec.ts or chain-w2-w4-w5-w6.spec.ts must have run first.',
        );
      }

      // 3. Open the record and take its id from the route. The id is used as the `clientId` argument and to prove the application screen names the same client; its value is never asserted (AAP 0.10.2 compares a generated id by.
      await pages.clients.openClient(requiredClient);
      const clientId = routeId(page.url(), CLIENT_RECORD_HASH, 'the client record');

      // 4. Enter the application from the record's own action, and confirm the route names the client the record did (AAP 0.8.2 `#/newclientloanaccount/:clientId`).
      await pages.clientView.startNewLoan();
      const routedClientId = routeId(page.url(), NEW_LOAN_HASH, 'the loan application screen');
      expect(routedClientId).toBe(clientId);

      // 5. The product list is Fineract's own (`GET /loans/template` → `productOptions`, AAP 0.4.4 decision 6), so the fixed product has to be one of the options the screen offers before the workflow chooses it.
      const productLabels = (await page.locator('select#productId option').allTextContents()).map((label) =>
        label.trim(),
      );
      expect(productLabels).toContain(SEED_LOAN_PRODUCT.name);

      await pages.loans.selectProduct(SEED_LOAN_PRODUCT.name);

      // 6. The template read the product selection caused must carry the three parameters AAP 0.7.3 fixes, and the tenant header every call carries (Rule 1 clause 2).
      const templateReads = await awaitExchanges(
        capture,
        (exchange) => isLoanTemplateRead(exchange) && (exchange.query['productId'] ?? '').length > 0,
      );
      const templateRead: NormalizedExchange | undefined = templateReads[templateReads.length - 1];
      if (templateRead === undefined) {
        throw new Error(`no ${LOAN_TEMPLATE_PATH} read named a productId, so the terms were not templated`);
      }
      expect(templateRead.query['templateType']).toBe('individual');
      expect(templateRead.query['clientId']).toBe(String(clientId));
      expect(templateRead.query['productId']).toMatch(/^\d+$/);
      expect(templateRead.hasTenantHeader).toBe(true);

      const principalDefault = await page.locator('#principal').inputValue();
      const repaymentsDefault = await page.locator('#numberOfRepayments').inputValue();
      const submittedDefault = await page.locator('#submittedOnDate').inputValue();
      expect(toNumber(principalDefault)).toBe(SCENARIO.loanApplication.principal);
      expect(toNumber(repaymentsDefault)).toBe(SEED_LOAN_PRODUCT.numberOfRepayments);
      expect(isCalendarDate(submittedDefault)).toBe(true);
      expect(await page.locator('#expectedDisbursementDate').isEditable()).toBe(true);

      // 8. The principal carries no bound of the application's own: W7 proves Fineract rejects a 50,000 principal, which no `min`, `max` or disabled trigger here may pre-empt (Rule 1 clause 3).
      const principalBounds = await page.locator('#principal').evaluate(readPrincipalBounds);
      expect(principalBounds.min).toBeNull();
      expect(principalBounds.max).toBeNull();

      // 9. Type the fixed W4 data (AAP 0.10.1): the plan's 5,000 principal, 12 monthly repayments at the product's flat 12% a year, and the tenant business date for both dates (AAP 0.10.5).
      if (pages.uiProject === 'legacy') {
        await pages.loans.fillApplication({
          principal: String(SCENARIO.loanApplication.principal),
          numberOfRepayments: String(SEED_LOAN_PRODUCT.numberOfRepayments),
          interestRatePerPeriod: String(SEED_LOAN_PRODUCT.interestRatePerYear),
          submittedOnDate: runDate,
          expectedDisbursementDate: runDate,
        });
      } else {
        await pages.loans.fillApplication({
          principal: SCENARIO.loanApplication.principal,
          numberOfRepayments: SEED_LOAN_PRODUCT.numberOfRepayments,
          interestRatePerPeriod: SEED_LOAN_PRODUCT.interestRatePerYear,
          submittedOnDate: formatDateOnly(runDate),
          expectedDisbursementDate: formatDateOnly(runDate),
        });
      }

      const submittedAfterFill = await page.locator('#submittedOnDate').inputValue();
      const disbursementAfterFill = await page.locator('#expectedDisbursementDate').inputValue();
      expect(namesRunDate(submittedAfterFill, runDate)).toBe(true);
      expect(namesRunDate(disbursementAfterFill, runDate)).toBe(true);

      // 10. Preview. Exactly one `POST /loans?command=calculateLoanSchedule` may leave the screen — one click, one request (AAP 0.1.1 duplicate-submission rule) — and its body must be the application AAP 0.7.2 describes, in the (Rule 1 clause 2).
      await pages.loans.previewSchedule();

      const previewPosts = await awaitExchanges(capture, (exchange) => isLoanPost(exchange, PREVIEW_COMMAND));
      expect(previewPosts).toHaveLength(1);
      const previewPost = previewPosts[0];
      expect(previewPost.hasTenantHeader).toBe(true);
      const previewBody = bodyOf(previewPost);
      if (previewBody === null) {
        throw new Error('the preview POST carried no JSON body, so it cannot describe the application');
      }
      expect(namesClient(previewBody['clientId'], clientId)).toBe(true);
      expect(typeof previewBody['productId']).toBe('number');
      expect(previewBody['principal']).toBe(SCENARIO.loanApplication.principal);
      expect(previewBody['numberOfRepayments']).toBe(SEED_LOAN_PRODUCT.numberOfRepayments);
      expect(namesRunDate(previewBody['submittedOnDate'], runDate)).toBe(true);
      expect(namesRunDate(previewBody['expectedDisbursementDate'], runDate)).toBe(true);
      expect(previewBody['dateFormat']).toBe(PAYLOAD_DATE_FORMAT);
      expect(previewBody['locale']).toBe(LOCALE);

      const previewRows: readonly PreviewRowReading[] = await pages.loans.readPreviewRows();
      const repaymentPeriods = previewRows.filter((row) => toPeriodNumber(row.period) !== null);
      expect(repaymentPeriods).toHaveLength(SEED_LOAN_PRODUCT.numberOfRepayments);

      const expectedPeriods = Array.from(
        { length: SEED_LOAN_PRODUCT.numberOfRepayments },
        (_unused, index) => index + 1,
      );
      expect(previewRows.map((row) => toPeriodNumber(row.period)).slice(-repaymentPeriods.length)).toEqual(
        expectedPeriods,
      );

      const periodicPrincipal = repaymentPeriods.map((row) => toNumber(row.principalDue));
      expect(periodicPrincipal.every((amount) => amount !== null)).toBe(true);
      const principalTotal = periodicPrincipal.reduce<number>((total, amount) => total + (amount ?? 0), 0);
      expect(Math.abs(principalTotal - SCENARIO.loanApplication.principal)).toBeLessThanOrEqual(AMOUNT_TOLERANCE);

      const notAfterDisbursement = repaymentPeriods
        .filter((row) => {
          const dueDate = parseFineractDate(row.dueDate);
          return dueDate === null || dayOffset(runDate, dueDate) <= 0;
        })
        .map((row) => row.dueDate);
      expect(notAfterDisbursement).toEqual([]);

      // 12. Submit. Exactly one `POST /loans` may leave the screen, with no `command` at all, and the router lands on the new loan's record.
      await pages.loans.submitApplication();
      await page.waitForURL(LOAN_RECORD_HASH, { timeout: CAPTURE_WAIT_MS });

      const submitPosts = await awaitExchanges(capture, (exchange) => isLoanPost(exchange, null));
      expect(submitPosts).toHaveLength(1);
      const submitPost = submitPosts[0];
      expect(submitPost.hasTenantHeader).toBe(true);
      const submitBody = bodyOf(submitPost);
      if (submitBody === null) {
        throw new Error('the submission POST carried no JSON body, so the loan it created is unproven');
      }
      expect(namesClient(submitBody['clientId'], clientId)).toBe(true);
      expect(typeof submitBody['productId']).toBe('number');
      expect(submitBody['principal']).toBe(SCENARIO.loanApplication.principal);
      expect(submitBody['numberOfRepayments']).toBe(SEED_LOAN_PRODUCT.numberOfRepayments);
      expect(namesRunDate(submitBody['submittedOnDate'], runDate)).toBe(true);
      expect(submitBody['dateFormat']).toBe(PAYLOAD_DATE_FORMAT);
      expect(submitBody['locale']).toBe(LOCALE);
      // `loanType` is asserted where the form sends it: the legacy controller copies the route's `templateType` onto the body and the new form sends it outright, so a body without it is not a difference this workflow may invent.
      if (submitBody['loanType'] !== undefined) {
        expect(submitBody['loanType']).toBe('individual');
      }
      // The preview described the application that was submitted: every member both bodies carry is the same in both (AAP 0.7.2 — one builder posts both).
      for (const field of SHARED_APPLICATION_FIELDS) {
        expect(submitBody[field]).toEqual(previewBody[field]);
      }

      // 13. The Fineract end state, read back over the API (AAP 0.10.1's outcome): the loan exists, it is still unapproved, its principal is the 5,000 that was applied for, and nothing has been repaid against it.
      const loanId = routeId(page.url(), LOAN_RECORD_HASH, 'the loan record the submission opened');
      const snapshot = await snapshotLoan(loanId);
      expect(snapshot.status).toMatch(/submitted/i);
      expect(snapshot.principal).toBe(SCENARIO.loanApplication.principal);
      expect(snapshot.transactionCount).toBe(0);

      // 14. The record the application landed on. It is opened explicitly, so the readers below never race the navigation the submission started and both front ends make the same one record read (AAP 0.7.3 "W6 repayment": `GET.
      await pages.loans.openView(loanId);
      const summary: LoanSummaryReading = await pages.loans.readSummary();
      // The status is a colour and never a word (AAP 0.10.5 item 11): a loan awaiting approval paints the pending colour, which the two front ends spell `status-pending` and `statuspending`.
      expect(summary.statusClass).toMatch(/status-?pending/i);
      // The submitted principal is one of the figures the record prints (AAP 0.7.2 `LoanSummary`: the component draws the loan's total, its outstanding balance and the three balances the schedule's periods carry).
      const summaryFigures = summary.fields.map((field) => toNumber(field.value));
      expect(summaryFigures).toContain(SCENARIO.loanApplication.principal);

      // A successful application raises nothing: the notification host is empty, so no Fineract error reached the user beside a loan that was created (AAP 0.7.4).
      const notifications: readonly unknown[] = await pages.clients.readNotifications();
      expect(notifications).toHaveLength(0);

      // The end state the parity report compares for this workflow is the loan's, which is what W4 created; the fixture reads it after the body returns and labels it with the project and id.
      return { stateTargets: { loanId } };
    });
  });
});

