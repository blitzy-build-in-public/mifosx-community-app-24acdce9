/**
 * W4 — submit an individual loan application after previewing its repayment schedule, proved on both
 * front ends (AAP 0.10.1 W4 row; AAP 0.11.1 row 52; Rule 1 clause 8: one Playwright spec per workflow).
 *
 * **What W4 is.** Entry point `#/viewclient/:id` → "New Loan": choose the product, set the terms,
 * preview the schedule, submit. The outcome AAP 0.10.1 requires is `GET /loans/template?
 * templateType=individual&clientId=&productId=`, then `POST /loans?command=calculateLoanSchedule` for
 * the preview and `POST /loans` for the submission, leaving a loan in the submitted status with a
 * principal of 5,000 (AAP 0.10.1 fixed data, "W4 loan: Parity Loan, principal 5,000, submitted on the
 * run date").
 *
 * **Precondition and ordering contract.** The suite runs per Playwright project in filename order
 * against one seeded database (`e2e/playwright.config.ts`: `workers: 1`, `fullyParallel: false`), so
 * this file both consumes and produces state:
 *
 * 1. In — at least one client named `Parity Client` must already exist on the client list, created by
 *    `w2-create-client.spec.ts` and by `chain-w2-w4-w5-w6.spec.ts`, which run first. A run without it
 *    fails here with a message naming the precondition and the file that creates it; it is never
 *    skipped, because a skipped workflow reads in the parity report as an absent one.
 * 2. Out — this spec leaves the loan it submitted in the submitted state, unapproved and with no
 *    transaction, which `w5-approve-disburse.spec.ts` picks up when it runs next and approves.
 *
 * **What it asserts, in the order the workflow happens.** The product option exists in the template's
 * own list; the template read carries `templateType: individual` beside the `clientId` and a non-empty
 * `productId`; the form is seeded from that template (principal 5,000, 12 repayments, a submission
 * default date); the preview posts exactly one `calculateLoanSchedule` body that repeats the
 * application fields the submission then posts; the preview renders 12 repayment periods in schedule
 * order, whose principal sums to 5,000 and whose due dates all follow the disbursement date; the
 * submission posts exactly one `POST /loans` without a command and with `principal: 5000`,
 * `numberOfRepayments: 12`, the run date, `dateFormat` and `locale`; the Fineract end state read back
 * over the API shows the submitted status, a principal of 5,000 and no transaction; and the record the
 * application lands on paints the pending status and the 5,000 principal with no error notification.
 *
 * **Dates.** Every date the workflow types is the tenant's business date, read over the API by the
 * fixture's `runDate` (Rule 1 clause 2), never the browser clock. The form's own defaults follow the
 * legacy screen and come from the browser clock (AAP 0.10.5 item 15), which is why the default of the
 * submission field is asserted as "a calendar date" and the value the payload must carry is asserted
 * against `runDate` after the workflow typed it.
 *
 * **No bound on the principal.** Nothing here reads a product minimum or maximum, types a limit, or
 * disables a trigger on one: legacy marks the field `required` and nothing else, and W7 exists to prove
 * Fineract itself rejects a 50,000 principal (Rule 1 clause 3; AAP 0.7.2 `LoanApplicationRequest`). The
 * one assertion about bounds checks that the control declares no `min` or `max` of its own.
 *
 * **Two facts this fork's payload settles, recorded rather than assumed.** The repayment schedule
 * Fineract returns opens with a disbursement period that carries no period number and no principal
 * before the 12 numbered repayments (`capture/state-snapshot.ts` skips that row for the same reason), so
 * the count this spec owns is of the numbered repayment periods. And `approvedPrincipal` equals the
 * principal from submission onward, not only after approval, so it is the status — and the absent
 * approval step — that proves the loan is still unapproved, never that field.
 *
 * **Rules discharged here.** Rule 1 clause 1 — this file writes nothing; clause 2 — only the AAP 0.7.3
 * "W4 loan application" endpoints are asserted, dates are the run date and the tenant header's presence
 * is asserted on every captured call; clause 3 — no behaviour legacy lacks is required; clause 4 — the
 * captured payload is read as `unknown` and narrowed by the documented guards below; clause 9 — no
 * credential, header value or session material is read, printed or compared. Rule 2 — every navigation
 * goes through a page object, which composes the `?baseApiUrl=…&tenantIdentifier=…` entry URL, so no
 * host appears here and the fixture's own teardown enforces the backend origin.
 */
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

/** How long the live capture is given to record a call the screen has already made. */
const CAPTURE_WAIT_MS = 20_000;

/**
 * Tolerance, in the loan's currency, on the sum of the rendered principal dues. Each cell is the
 * server's figure printed at the table's own precision, so the periods' rounded text need not add up
 * to the principal to the last cent; anything beyond one unit is a real difference.
 */
const AMOUNT_TOLERANCE = 1;

/**
 * The application members the preview body and the submission body must agree on, in the vocabulary of
 * AAP 0.7.2's `LoanApplicationRequest`. `LoanService.toApplicationBody` builds both bodies, so their
 * agreement is a property of the application rather than of this spec (AAP 0.7.2 "the identical body is
 * posted to `command=calculateLoanSchedule` for the preview").
 */
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

/**
 * One preview row as this spec reads it, declared over both page objects' readers: `pages/next` parses
 * the cells into numbers while `pages/legacy` reports the cell text, so the members are the union of the
 * two and the guards below are what turn either into a number. Read-only, because a spec observes the
 * screen and never writes back into a reading.
 */
interface PreviewRowReading {
  /** Period number from the first column, in whichever type the running reader reported it. */
  readonly period: number | string | null;
  /** The period's due date, exactly as the screen formatted it. */
  readonly dueDate: string;
  /** Principal due in the period, as the reader reported it. */
  readonly principalDue: number | string | null;
}

/**
 * The loan record's status colour and label/value rows, declared over both readers: the two page
 * objects name the pair types differently but agree on their members, which is what lets one assertion
 * read both front ends (AAP 0.10.2 compares the rendered data, not the reader's type names).
 */
interface LoanSummaryReading {
  /** The colour class of the record's status indicator — a colour and never a status word. */
  readonly statusClass: string;
  /** Label/value rows in document order. */
  readonly fields: readonly { readonly label: string; readonly value: string }[];
}

/** The one member this spec reads from a client list row: the name a caller opens the record by. */
interface NamedClientRow {
  /** The client's display name as the list renders it. */
  readonly name: string;
}

/** The two attributes a numeric field must not carry, read off the control itself. */
interface PrincipalBounds {
  /** The control's declared `min`, or `null` when it declares none. */
  readonly min: string | null;
  /** The control's declared `max`, or `null` when it declares none. */
  readonly max: string | null;
}

/**
 * Narrows a captured body to an object.
 *
 * A captured payload crossed an HTTP boundary the harness does not model, so it arrives as
 * `NormalizedValue`; this guard is the documented boundary at which the spec narrows it (Rule 1
 * clause 4). Nothing else in this file casts a payload.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The request body of one exchange as an object, or `null` when the exchange carried none.
 *
 * @param exchange One normalised API exchange.
 */
function bodyOf(exchange: NormalizedExchange): Record<string, unknown> | null {
  return isRecord(exchange.requestBody) ? exchange.requestBody : null;
}

/**
 * A rendered figure or a captured numeric member as a number, whatever separator style the screen or
 * the payload used: `5,000` as the number pipe prints it and `5000` as Fineract sends it both answer
 * 5000, and a cell that carries no digit answers `null` rather than a zero nothing displayed.
 *
 * @param value A rendered cell, a captured member, or anything else.
 */
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

/**
 * A row's period number as a whole number, or `null` for a row the schedule does not number — the
 * disbursement period Fineract's schedule opens with.
 *
 * @param value The row's period member, in whichever type the running reader reported it.
 */
function toPeriodNumber(value: unknown): number | null {
  const parsed = toNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

/** The hash of a URL, or `''` when it carries none. A hash holds a route, never a credential. */
function hashOf(url: string): string {
  const marker = url.indexOf('#');
  return marker === -1 ? '' : url.slice(marker);
}

/**
 * The id a route's own hash carries.
 *
 * @param url The page's current URL.
 * @param pattern Route pattern whose first group is the id.
 * @param what The screen being read, named in the failure.
 * @throws When the URL's hash is not that route, so a workflow never reads one screen and asserts
 * another.
 */
function routeId(url: string, pattern: RegExp, what: string): number {
  const hash = hashOf(url);
  const matched = pattern.exec(hash);
  if (matched === null) {
    throw new Error(`${what} is not on screen: the page is at "${hash}", which is not ${String(pattern)}`);
  }
  return Number(matched[1]);
}

/**
 * Whether a captured date member names the run date.
 *
 * The capture rewrites a date to its day offset from the run date — the run date itself becomes `d0` —
 * and leaves a value it could not read as a date verbatim (AAP 0.10.2 "Dates"), so both forms are
 * accepted here and nothing else is.
 *
 * @param value The captured member.
 * @param runDate The tenant's business date the capture normalised against.
 */
function namesRunDate(value: unknown, runDate: Date): boolean {
  if (value === 'd0') {
    return true;
  }
  const parsed = parseFineractDate(value);
  return parsed !== null && dayOffset(runDate, parsed) === 0;
}

/**
 * Whether a control's own text is a calendar date, in either shape the two front ends render one:
 * the new application's `yyyy-mm-dd` native date input and the legacy screen's `dd MMMM yyyy` text.
 *
 * @param text The control's value.
 */
function isCalendarDate(text: string): boolean {
  return parseFineractDate(text) !== null;
}

/**
 * Whether a captured identifier names the client this run opened.
 *
 * The capture replaces an id the run generated with the role token of its role, so the client the
 * application names arrives as `{clientId}`; a member the normaliser left alone carries the id itself
 * (AAP 0.10.2 "ids compared by role in the sequence"). Either form proves the same thing and neither
 * asserts a literal id.
 *
 * @param value The captured member.
 * @param clientId The id the client record's own route carried.
 */
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

/**
 * Whether one exchange is a `POST /loans`, with the command the caller names or — for `null` — with no
 * command at all, which is the submission.
 *
 * @param exchange One normalised API exchange.
 * @param command The `command` query the call must carry, or `null` when it must carry none.
 */
function isLoanPost(exchange: NormalizedExchange, command: string | null): boolean {
  if (exchange.method !== 'POST' || !exchange.path.endsWith(LOAN_COLLECTION_PATH)) {
    return false;
  }
  const sent = exchange.query['command'];
  return command === null ? sent === undefined : sent === command;
}

/**
 * Waits until the live capture holds an exchange the predicate accepts, then answers with every
 * matching exchange in record order.
 *
 * A capture records a request as the page issues it, one event behind the interaction that caused it,
 * so a spec reads through this rather than assuming the record is already on hand. It waits and never
 * retries an interaction: a missing record fails here instead of clicking a second time, which would
 * send the duplicate request the workflow is measuring the absence of.
 *
 * @param capture The running capture.
 * @param matches Predicate selecting the exchanges to wait for.
 */
async function awaitExchanges(
  capture: CaptureSession,
  matches: (exchange: NormalizedExchange) => boolean,
): Promise<readonly NormalizedExchange[]> {
  await expect
    .poll(() => capture.capture.exchanges.filter(matches).length, { timeout: CAPTURE_WAIT_MS })
    .toBeGreaterThan(0);
  return capture.capture.exchanges.filter(matches);
}

/**
 * Reads the bounds a numeric control declares, so the spec can prove the application added none of its
 * own. Runs inside the page.
 *
 * @param element The control.
 */
function readPrincipalBounds(element: Element): PrincipalBounds {
  return { min: element.getAttribute('min'), max: element.getAttribute('max') };
}

test.describe('W4 submit an individual loan application after previewing the schedule', () => {
  test('W4: preview the 12-period schedule of the 5,000 Parity Loan and submit the application', async ({
    runWorkflow,
  }) => {
    await runWorkflow('W4', async ({ page, pages, capture, runDate }) => {
      // 1. Sign in through the application's own login screen (AAP 0.10.1 W1). The credential pair is
      //    read inside the body and handed straight to the page object: it is never stored on a
      //    fixture, annotated, attached or compared (Rule 1 clause 9).
      const credentials = readCredentials();
      await pages.login.open();
      await pages.login.signIn(credentials.username, credentials.password);

      // 2. The client list, and the precondition this spec runs under: W2's client must already be
      //    there. A missing row is a failure that names the precondition, never a skip — a skipped
      //    workflow reads as an absent record in the parity report (AAP 0.10.1, AAP 0.10.4).
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

      // 3. Open the record and take its id from the route. The id is used as the `clientId` argument
      //    and to prove the application screen names the same client; its value is never asserted
      //    (AAP 0.10.2 compares a generated id by its role, never by its number).
      await pages.clients.openClient(requiredClient);
      const clientId = routeId(page.url(), CLIENT_RECORD_HASH, 'the client record');

      // 4. Enter the application from the record's own action, and confirm the route names the client
      //    the record did (AAP 0.8.2 `#/newclientloanaccount/:clientId`).
      await pages.clientView.startNewLoan();
      const routedClientId = routeId(page.url(), NEW_LOAN_HASH, 'the loan application screen');
      expect(routedClientId).toBe(clientId);

      // 5. The product list is Fineract's own (`GET /loans/template` → `productOptions`, AAP 0.4.4
      //    decision 6), so the fixed product has to be one of the options the screen offers before the
      //    workflow chooses it.
      const productLabels = (await page.locator('select#productId option').allTextContents()).map((label) =>
        label.trim(),
      );
      expect(productLabels).toContain(SEED_LOAN_PRODUCT.name);

      await pages.loans.selectProduct(SEED_LOAN_PRODUCT.name);

      // 6. The template read the product selection caused must carry the three parameters AAP 0.7.3
      //    fixes, and the tenant header every call carries (Rule 1 clause 2). The application reads the
      //    template once on entry and again with `productId`, so the call asserted is the one that
      //    names a product.
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

      // 7. The form is seeded from that template and not from anything the workflow typed: the product's
      //    5,000 default principal and 12 repayments, and a submission date the screen pre-fills.
      //    `#principal` and `#numberOfRepayments` have no reader on either page object — the ids are the
      //    legacy form's own and `fillApplication` documents them — so both are read here with that
      //    vocabulary. The disbursement field is seeded by the new app from the template and left empty
      //    by the legacy screen, which never initialises it, so its value is asserted after the workflow
      //    types the run date into it rather than as a default.
      const principalDefault = await page.locator('#principal').inputValue();
      const repaymentsDefault = await page.locator('#numberOfRepayments').inputValue();
      const submittedDefault = await page.locator('#submittedOnDate').inputValue();
      expect(toNumber(principalDefault)).toBe(SCENARIO.loanApplication.principal);
      expect(toNumber(repaymentsDefault)).toBe(SEED_LOAN_PRODUCT.numberOfRepayments);
      expect(isCalendarDate(submittedDefault)).toBe(true);
      expect(await page.locator('#expectedDisbursementDate').isEditable()).toBe(true);

      // 8. The principal carries no bound of the application's own: W7 proves Fineract rejects a 50,000
      //    principal, which no `min`, `max` or disabled trigger here may pre-empt (Rule 1 clause 3).
      const principalBounds = await page.locator('#principal').evaluate(readPrincipalBounds);
      expect(principalBounds.min).toBeNull();
      expect(principalBounds.max).toBeNull();

      // 9. Type the fixed W4 data (AAP 0.10.1): the plan's 5,000 principal, 12 monthly repayments at the
      //    product's flat 12% a year, and the tenant business date for both dates. The two payload types
      //    differ by front end — the legacy screen takes `Date` objects because its widget does, the new
      //    one takes the `yyyy-mm-dd` a native date input holds (AAP 0.10.5 items 1 and 2) — so this is
      //    the one place the body branches on the project.
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

      // The two dates the form now holds are the run date, in whichever shape the front end renders a
      // date in, which is what both bodies below must carry.
      const submittedAfterFill = await page.locator('#submittedOnDate').inputValue();
      const disbursementAfterFill = await page.locator('#expectedDisbursementDate').inputValue();
      expect(namesRunDate(submittedAfterFill, runDate)).toBe(true);
      expect(namesRunDate(disbursementAfterFill, runDate)).toBe(true);

      // 10. Preview. Exactly one `POST /loans?command=calculateLoanSchedule` may leave the screen — one
      //     click, one request (AAP 0.1.1 duplicate-submission rule) — and its body must be the
      //     application AAP 0.7.2 describes, in the `dateFormat` and `locale` pair every date-bearing
      //     payload carries (Rule 1 clause 2).
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

      // 11. The preview itself: the server's schedule, one row per period, in the order it calculated.
      //     Fineract's schedule opens with the disbursement period, which is unnumbered and carries no
      //     principal, so the 12 repayment periods are the numbered ones — the same skip
      //     `capture/state-snapshot.ts` makes for the first period's total due.
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

      // Every instalment falls due after the money is handed over, so no period may be dated on or
      // before the disbursement date the application states.
      const notAfterDisbursement = repaymentPeriods
        .filter((row) => {
          const dueDate = parseFineractDate(row.dueDate);
          return dueDate === null || dayOffset(runDate, dueDate) <= 0;
        })
        .map((row) => row.dueDate);
      expect(notAfterDisbursement).toEqual([]);

      // 12. Submit. Exactly one `POST /loans` may leave the screen, with no `command` at all, and the
      //     router lands on the new loan's record.
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
      // `loanType` is asserted where the form sends it: the legacy controller copies the route's
      // `templateType` onto the body and the new form sends it outright, so a body without it is not a
      // difference this workflow may invent one for.
      if (submitBody['loanType'] !== undefined) {
        expect(submitBody['loanType']).toBe('individual');
      }
      // The preview described the application that was submitted: every member both bodies carry is
      // the same in both (AAP 0.7.2 — one builder posts both).
      for (const field of SHARED_APPLICATION_FIELDS) {
        expect(submitBody[field]).toEqual(previewBody[field]);
      }

      // 13. The Fineract end state, read back over the API (AAP 0.10.1's outcome): the loan exists, it
      //     is still unapproved, its principal is the 5,000 that was applied for, and nothing has been
      //     repaid against it.
      //
      //     The approval itself is proved by the status and not by `approvedPrincipal`: this fork
      //     reports that member equal to the principal from submission onward, so asserting it falsy
      //     would fail against a correct application. The submitted date is proved by the body
      //     assertion above, because `LoanSnapshot` carries no submitted date to read.
      const loanId = routeId(page.url(), LOAN_RECORD_HASH, 'the loan record the submission opened');
      const snapshot = await snapshotLoan(loanId);
      expect(snapshot.status).toMatch(/submitted/i);
      expect(snapshot.principal).toBe(SCENARIO.loanApplication.principal);
      expect(snapshot.transactionCount).toBe(0);

      // 14. The record the application landed on. It is opened explicitly, so the readers below never
      //     race the navigation the submission started and both front ends make the same one record
      //     read (AAP 0.7.3 "W6 repayment": `GET /loans/{id}?associations=all`).
      await pages.loans.openView(loanId);
      const summary: LoanSummaryReading = await pages.loans.readSummary();
      // The status is a colour and never a word (AAP 0.10.5 item 11): a loan awaiting approval paints
      // the pending colour, which the two front ends spell `status-pending` and `statuspending`.
      expect(summary.statusClass).toMatch(/status-?pending/i);
      // The submitted principal is one of the figures the record prints (AAP 0.7.2 `LoanSummary`: the
      // component draws the loan's total, its outstanding balance and the three balances the schedule's
      // periods carry). It is asserted by the figure and not by its caption, because the caption is a
      // legacy locale-bundle key rendered in the reader's language — "Principal Outstanding" where the
      // bundles are served, the same key humanised where they are not — while the figure is what proves
      // the record shows the principal the application was submitted with.
      const summaryFigures = summary.fields.map((field) => toNumber(field.value));
      expect(summaryFigures).toContain(SCENARIO.loanApplication.principal);

      // A successful application raises nothing: the notification host is empty, so no Fineract error
      // reached the user beside a loan that was created (AAP 0.7.4).
      const notifications: readonly unknown[] = await pages.clients.readNotifications();
      expect(notifications).toHaveLength(0);

      // The end state the parity report compares for this workflow is the loan's, which is what W4
      // created; the fixture reads it after the body returns and labels it with the project and id.
      return { stateTargets: { loanId } };
    });
  });
});

