/**
 * W8 — open a savings account, approve it, activate it, deposit 1,000 and withdraw 200 (AAP 0.10.1
 * "W8 savings (Stretch)"). One spec, two front ends: `e2e/playwright.config.ts` declares the untouched
 * AngularJS baseline as project `legacy` and this application as project `next`, and every call below
 * goes through the fixture's page objects, so the same body drives whichever side is running and the
 * parity report compares the two runs' captured calls and end states (AAP 0.10.2).
 *
 * **Ordering contract.** W8 opens an account for an existing client and creates no client of its own,
 * so it needs the `Parity Client` that `chain-w2-w4-w5-w6.spec.ts` and `w2-create-client.spec.ts`
 * create; with one Playwright worker and alphabetical spec order, both run before this file. It creates
 * its own savings account and reads no savings state another spec produced, so a run of this file
 * alone is a complete W8 as long as that client exists — which is also why it is the last workflow
 * spec: it leaves one active `Parity Savings` account behind, at a balance of 800.
 *
 * **What it proves, in the order the screens allow.** The client record opens the application; the
 * product comes from the template the form requested; the application posts exactly one
 * `POST /savingsaccounts`; approve and activate each post exactly one dated command to
 * `POST /savingsaccounts/{id}`; deposit and withdrawal each post exactly one command to
 * `POST /savingsaccounts/{id}/transactions`, with a payment type chosen from the options the
 * transactions template returned; and the record read back over `GET /savingsaccounts/{id}` with
 * `associations=all` ends at 800, having taken in 1,000 and paid out 200. Counts are asserted because
 * Fineract's action endpoints are not idempotent: one click must produce one request (AAP 0.4.2,
 * AAP 0.10.1 W5).
 *
 * **What it deliberately does not assert.** No savings, transaction or payment-type id is compared by
 * value and no date is compared as text: the capture normalises a generated id to its role token and a
 * payload date to its day offset from the tenant business date, so the two runs compare as behaviour
 * (AAP 0.10.2). No interest is computed: `Parity Savings` carries a 2% nominal annual rate that accrues
 * nothing over a same-day run, and the plan fixes the balance at 800 rather than inventing an accrual
 * (Rule 1 clause 3). Nothing here covers shares, fixed or recurring deposits, which stay on the legacy
 * app (AAP 0.9.2).
 *
 * **Security.** No credential, authentication key, session value or tenant datum is read, printed,
 * attached or compared by value: the sign-in goes through the application's own login screen with the
 * pair `readCredentials()` answers in memory, and the capture masks both headers before an exchange
 * exists (Rule 1 clause 9, AAP 0.10.2). Navigation only ever goes through a page object, and the
 * fixture's teardown fails the test when any captured Fineract call left `FINERACT_URL` (Rule 2).
 */
import type { CaptureSession, NormalizedExchange, NormalizedValue } from '../capture/network-capture';
import { snapshotSavings } from '../capture/state-snapshot';
import { expect, test } from '../fixtures/parity-fixture';
import type { WorkflowTools } from '../fixtures/parity-fixture';
import {
  LOCALE,
  PAYLOAD_DATE_FORMAT,
  SCENARIO,
  SEED_SAVINGS_PRODUCT,
  formatDateOnly,
  readCredentials,
} from '../seed/fixtures';

/**
 * Ceiling for one wait on a hash route or on a capture record. Generous next to the 20 s action
 * timeout `e2e/playwright.config.ts` sets, because both waits are watching work the page has already
 * started rather than issuing a request of their own.
 */
const WAIT_TIMEOUT_MS = 30_000;

/** Interval between two reads of the hash or of the capture while a wait is in progress. */
const POLL_INTERVAL_MS = 100;

/**
 * The capture's form of a payload date that is the run date itself: `network-capture.ts` rewrites a
 * date-naming field to its day offset from the tenant business date, so the harness's own run date
 * reads `d0` (AAP 0.10.2, "Dates"). Every date this spec submits is that date, and no date is compared
 * as a literal string anywhere.
 */
const RUN_DATE_OFFSET = 'd0';

/**
 * `#/viewclient/{id}` — the client record W8 is entered from (AAP 0.8.2). Read only to learn which
 * client the run is working on; the id is never asserted, because it belongs to the spec that created
 * the client (AAP 0.10.2).
 */
const CLIENT_RECORD_HASH = /#\/viewclient\/(\d+)/;

/** `#/new_client_saving_application/{clientId}` — the savings application (AAP 0.8.2). */
const SAVINGS_APPLICATION_HASH = /#\/new_client_saving_application\/(\d+)/;

/** `#/viewsavingaccount/{id}` — the savings record the application and every action return to. */
const SAVINGS_RECORD_HASH = /#\/viewsavingaccount\/(\d+)/;

/**
 * Normalised paths of the four W8 endpoints (AAP 0.7.3 W8 row), matched as patterns because a capture
 * templates an id segment by its role: `GET /savingsaccounts/{id}` arrives as
 * `/fineract-provider/api/v1/savingsaccounts/{savingsAccountId}`.
 */
const SAVINGS_TEMPLATE_PATH = /\/savingsaccounts\/template$/;
const SAVINGS_ACCOUNT_COLLECTION_PATH = /\/savingsaccounts$/;
const SAVINGS_ACCOUNT_PATH = /\/savingsaccounts\/\{savingsAccountId\}$/;
const SAVINGS_TRANSACTIONS_TEMPLATE_PATH = /\/savingsaccounts\/\{savingsAccountId\}\/transactions\/template$/;
const SAVINGS_TRANSACTIONS_PATH = /\/savingsaccounts\/\{savingsAccountId\}\/transactions$/;

/**
 * The submitted-on control each front end renders, addressed by the id its own markup ships. The
 * `next` application renders the shared date field with `inputId="savings-submitted-on"` and a native
 * `<input type="date">` (AAP 0.10.5 item 1); the baseline renders the jQuery datepicker input
 * `#submittedOnDate`. The page objects deliberately expose no fill for this field, because the fixed
 * contract of the class has none — its own documentation is what names the markup a caller types into.
 */
const NEXT_SUBMITTED_ON = 'app-savings-new #savings-submitted-on';
const LEGACY_SUBMITTED_ON = '#submittedOnDate';

/**
 * What one action form is to be given: the approve and activate dates, or a cash transaction's date,
 * amount and payment type. Discriminated by `kind`, which is the action the screen was opened for.
 */
type ActionFill =
  | { readonly kind: 'approve'; readonly date: Date }
  | { readonly kind: 'activate'; readonly date: Date }
  | {
      readonly kind: 'transaction';
      readonly date: Date;
      readonly amount: number;
      readonly paymentType: PaymentTypeOption;
    };

/** One payment type the transactions template offers, as the template's own option carries it. */
interface PaymentTypeOption {
  /** Fineract's id for the payment type, which is what a transaction body names. */
  readonly id: number;
  /** The payment type's name, which is the label the legacy select is driven by. */
  readonly name: string;
}

/**
 * The hash fragment of a page URL, `''` when it carries none.
 *
 * The page objects address both applications by a fragment, so everything this spec reads about
 * navigation comes from here: the id of the client it is working on, and the id of the account the
 * application created.
 *
 * @param url URL as the browser reported it.
 */
function hashOf(url: string): string {
  const index = url.indexOf('#');
  return index < 0 ? '' : url.slice(index);
}

/**
 * Waits until the page's hash names `route`, and answers the id the route carries.
 *
 * Both applications navigate by fragment and paint the destination afterwards, so the hash is read
 * until it settles rather than sampled once: a click returns as soon as the event is dispatched, and
 * the router's navigation follows it.
 *
 * @param page The test's own page, whose fragment carries the route.
 * @param route Pattern of the route, whose first group is the id it names.
 * @param description What the route is, used in the error message.
 * @returns The id the route carries.
 * @throws When the hash has not settled on the route within {@link WAIT_TIMEOUT_MS}; the message
 * names the fragment it is showing and never the full address, so no query parameter is echoed.
 */
async function awaitRouteId(page: WorkflowTools['page'], route: RegExp, description: string): Promise<number> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    const match = route.exec(hashOf(page.url()));
    const id = match === null ? Number.NaN : Number(match[1]);
    if (Number.isInteger(id) && id > 0) {
      return id;
    }
    if (Date.now() > deadline) {
      const shown = hashOf(page.url());
      throw new Error(
        `the page never settled on ${description} (${route.source}) within ${WAIT_TIMEOUT_MS} ms; ` +
          `its fragment is ${shown.length > 0 ? shown : 'empty'}`,
      );
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }
}

/**
 * The exchanges a capture recorded for one call, in the order the page issued them.
 *
 * @param exchanges The capture's exchanges so far.
 * @param method HTTP method to match, upper-cased.
 * @param path Normalised-path pattern, an id segment read as its role token.
 * @param command The `?command=` the call carried, or `null` to match calls with no such filter. The
 * capture keeps `command` because it is what separates Fineract's action endpoints (AAP 0.7.3).
 */
function callsTo(
  exchanges: readonly NormalizedExchange[],
  method: string,
  path: RegExp,
  command: string | null = null,
): NormalizedExchange[] {
  return exchanges.filter(
    (exchange) =>
      exchange.method === method && path.test(exchange.path) && (command === null || exchange.query['command'] === command),
  );
}

/**
 * Waits until the capture holds at least `expected` matching exchanges, then answers all it holds.
 *
 * The capture records a request when the page issues it, so a count taken the instant a submit returns
 * could miss the call it just made. The wait is bounded and its shortfall is returned rather than
 * thrown: the caller's `toHaveLength` is what reports a workflow that sent the wrong number of
 * requests, with the count it actually sent.
 *
 * @param capture The running capture.
 * @param method HTTP method to match.
 * @param path Normalised-path pattern.
 * @param command The `?command=` the call must carry, or `null` for no filter.
 * @param expected How many calls the workflow should have produced.
 */
async function awaitCalls(
  capture: CaptureSession,
  method: string,
  path: RegExp,
  command: string | null,
  expected: number,
): Promise<NormalizedExchange[]> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    const found = callsTo(capture.capture.exchanges, method, path, command);
    if (found.length >= expected || Date.now() > deadline) {
      return found;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }
}

/**
 * Narrows a normalised body to a JSON object, leaving the values inside it unmodelled.
 *
 * The capture hands back `NormalizedValue`, a union of every shape a Fineract payload can hold, so a
 * field is reachable only after this check. Narrowing here is the documented boundary Rule 1 clause 4
 * permits: an `any` would carry the payload's shape into the assertions unchecked.
 *
 * @param value A normalised request or response body, or `null` when none was recorded.
 */
function isJsonObject(value: NormalizedValue | null): value is { [key: string]: NormalizedValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The JSON body of an exchange that must have carried one, or a failure naming the call.
 *
 * A call whose body is not a JSON object cannot be compared field by field, which is what this spec
 * does with every write it asserts. All five writes of W8 carry one, so an absent body is a real
 * difference and is reported rather than skipped.
 *
 * @param exchange The recorded call.
 * @throws When the call carried no JSON request body.
 */
function jsonBodyOf(exchange: NormalizedExchange): { [key: string]: NormalizedValue } {
  const body = exchange.requestBody;
  if (!isJsonObject(body)) {
    throw new Error(
      `${exchange.method} ${exchange.path} carried no JSON request body, so the fields the workflow ` +
        'states cannot be compared with it (AAP 0.10.1)',
    );
  }
  return body;
}

/**
 * A figure as a number, or `null` when the value carries none.
 *
 * Two sources are read with it: a normalised payload field, whose amount may be a number or the string
 * one front end sent where the other sent a number, and a rendered cell, whose text may carry a
 * thousands separator, a currency glyph or a decimal part. Everything that is not a digit, a `.` or a
 * `-` is dropped and the rest is read as a number, while a value with no digit at all answers `null`
 * rather than `0` — `Number('')` is `0`, which would let a figure the screen never printed compare
 * equal to a real zero (AAP 0.10.2 compares amounts as numbers, never as text).
 *
 * @param value Payload value or rendered text.
 */
function figureOf(value: unknown): number | null {
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
 * The body of the newest transactions template the capture holds, once it has settled.
 *
 * A response body arrives as a promise, so the newest template exchange can be recorded while its body
 * is still unread; `null` answers "not settled yet" and the caller reads again. Only the newest
 * matching exchange is examined, because the screen the user is on is the one whose template decides
 * the options on its form.
 *
 * @param exchanges The capture's exchanges so far.
 */
function latestTransactionsTemplate(exchanges: readonly NormalizedExchange[]): { [key: string]: NormalizedValue } | null {
  for (let index = exchanges.length - 1; index >= 0; index -= 1) {
    const exchange = exchanges[index];
    if (exchange.method !== 'GET' || !SAVINGS_TRANSACTIONS_TEMPLATE_PATH.test(exchange.path)) {
      continue;
    }
    return isJsonObject(exchange.responseBody) ? exchange.responseBody : null;
  }
  return null;
}

/**
 * The first payment type the transactions template offers — the option the deposit and withdrawal
 * forms are driven with.
 *
 * The options are the server's own list, read from `paymentTypeOptions` of
 * `GET /savingsaccounts/{id}/transactions/template` rather than typed as a literal id, so the run uses
 * whatever payment types the tenant actually holds (AAP 0.7.3 W8 row, Rule 1 clause 3). A payment type
 * is not optional: Fineract validates `paymentTypeId` as `notNull` on a savings transaction, so an
 * empty option list is a fixture problem this reports by name instead of submitting a body the server
 * would refuse.
 *
 * @param capture The running capture, which recorded the template call the screen made.
 * @returns The first option the template listed.
 * @throws When no template body settles within {@link WAIT_TIMEOUT_MS}, or when the settled body
 * carries no payment type at all.
 */
async function firstPaymentType(capture: CaptureSession): Promise<PaymentTypeOption> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    const body = latestTransactionsTemplate(capture.capture.exchanges);
    if (body !== null) {
      const options = body['paymentTypeOptions'];
      if (Array.isArray(options)) {
        for (const option of options) {
          if (!isJsonObject(option)) {
            continue;
          }
          const id = option['id'];
          const name = option['name'];
          if (typeof id === 'number' && Number.isInteger(id) && id > 0 && typeof name === 'string' && name.trim().length > 0) {
            return { id, name: name.trim() };
          }
        }
      }
      throw new Error(
        'the savings transactions template answered no payment type option, but Fineract validates ' +
          'paymentTypeId as notNull on a deposit or withdrawal: the seed must leave at least one ' +
          'payment type on the tenant before W8 can be driven',
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `no savings transactions template settled within ${WAIT_TIMEOUT_MS} ms, so the deposit form's ` +
          'payment type options are unknown; the capture holds ' +
          `${callsTo(capture.capture.exchanges, 'GET', SAVINGS_TRANSACTIONS_TEMPLATE_PATH).length} ` +
          'call(s) to that endpoint',
      );
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }
}

/**
 * W8, driven once per front end.
 *
 * The describe title and the test's own title are the harness's identity for the workflow: the parity
 * fixture reads `W8` out of them to name the capture artefact it writes, and `runWorkflow('W8', …)` is
 * what records the verdict — `pass` on a body that returns, `legacy-broken` on a baseline that throws,
 * `fail` on this application (AAP 0.10.1, AAP 0.10.4).
 */
test.describe('W8 open a savings account, approve, activate, deposit and withdraw', () => {
  test('W8 — the Parity Client opens a Parity Savings account, approves and activates it, deposits 1,000 and withdraws 200', async ({
    runWorkflow,
  }) => {
    await runWorkflow('W8', async ({ page, pages, capture, runDate }) => {
      // The credential pair is read here, inside the workflow, and handed to the login screen only: no
      // copy is kept, printed or compared, and the capture masks both headers (Rule 1 clause 9).
      const { username, password } = readCredentials();
      // Every date the run types is the tenant's business date in the `yyyy-mm-dd` form a native date
      // control accepts; nothing here reads the browser clock (Rule 1 clause 2, AAP 0.10.1 "Run date").
      const runDateText = formatDateOnly(runDate);

      /**
       * Fills the open action form, for the front end that is running.
       *
       * The two sides take different payloads for one reason the migration records: the new app's
       * fields are native controls holding `yyyy-mm-dd` text and a numeric payment type id, while the
       * baseline's are a jQuery datepicker taking a `Date` and a chosen select driven by the option's
       * visible label (AAP 0.10.5 items 1 and 2). The values themselves are the harness's own — the run
       * date, the plan's amount and a payment type the template returned — so the bodies the two sides
       * post are the same call, which is what the parity comparison then measures.
       */
      const fillAction = async (fill: ActionFill): Promise<void> => {
        if (pages.uiProject === 'legacy') {
          await pages.savings.fillTransaction(
            fill.kind === 'transaction'
              ? { date: fill.date, amount: String(fill.amount), paymentType: fill.paymentType.name }
              : { date: fill.date },
          );
          return;
        }
        await pages.savings.fillTransaction(
          fill.kind === 'approve'
            ? { approvedOnDate: formatDateOnly(fill.date) }
            : fill.kind === 'activate'
              ? { activatedOnDate: formatDateOnly(fill.date) }
              : {
                  transactionDate: formatDateOnly(fill.date),
                  transactionAmount: fill.amount,
                  paymentTypeId: fill.paymentType.id,
                },
        );
      };

      // 0. W1's entry step. The fixture hands an unauthenticated page, so the login screen is opened
      //    and the application's own form is signed in through; the password reaches nothing else.
      await pages.login.open();
      await pages.login.signIn(username, password);

      // 1. The client the account is opened for: the list, then its row, then the record's own route.
      //    The id is read from the hash and never asserted — it belongs to the spec that created the
      //    client, and AAP 0.10.2 compares generated ids by their role, not by value.
      await pages.clients.open();
      await pages.clients.openClient(SCENARIO.client.displayName);
      const clientId = await awaitRouteId(page, CLIENT_RECORD_HASH, 'the Parity Client record');
      expect(clientId).toBeGreaterThan(0);

      // 2. "New Saving" leaves the record for the application route AAP 0.8.2 declares.
      await pages.clientView.startNewSaving();
      const application = SAVINGS_APPLICATION_HASH.exec(hashOf(page.url()));
      expect(application).not.toBeNull();
      expect(application?.[1]).toBe(String(clientId));

      // 3. The product is the seeded `Parity Savings`, chosen by the label the seed created it under.
      //    The form's template read is the call AAP 0.7.3 lists for W8: it names the client the account
      //    is opened for, and it carries the tenant header like every other call.
      await pages.savings.selectProduct(SEED_SAVINGS_PRODUCT.name);
      const templates = callsTo(capture.capture.exchanges, 'GET', SAVINGS_TEMPLATE_PATH);
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.every((call) => call.query['clientId'] === String(clientId))).toBe(true);
      expect(templates.every((call) => call.hasTenantHeader)).toBe(true);

      // 4. The form arrives with its submitted-on date already filled — the browser-clock default the
      //    legacy form applies (AAP 0.10.5 item 15) — and the run date replaces it before the submit,
      //    so the body carries the tenant's business date rather than whatever day the host is on.
      if (pages.uiProject === 'legacy') {
        await expect(page.locator(LEGACY_SUBMITTED_ON)).not.toHaveValue('');
        await pages.savings.submitApplication(runDate);
      } else {
        await expect(page.locator(NEXT_SUBMITTED_ON)).not.toHaveValue('');
        await page.locator(NEXT_SUBMITTED_ON).fill(runDateText);
        await pages.savings.submitApplication();
      }

      // 5. One click, one account: exactly one `POST /savingsaccounts`, carrying the client the route
      //    named, the chosen product, the run date and the two format members every date-bearing body
      //    of the API contract carries (AAP 0.7.2 `SavingsApplicationRequest`, Rule 1 clause 2). The
      //    client id is compared as the role token the capture templates it to.
      const savingsId = await awaitRouteId(page, SAVINGS_RECORD_HASH, 'the savings record the new account opens');
      const created = await awaitCalls(capture, 'POST', SAVINGS_ACCOUNT_COLLECTION_PATH, null, 1);
      expect(created).toHaveLength(1);
      expect(created[0].hasTenantHeader).toBe(true);
      const createdBody = jsonBodyOf(created[0]);
      expect(createdBody['clientId']).toBe('{clientId}');
      expect(figureOf(createdBody['productId'])).toBeGreaterThan(0);
      expect(createdBody['submittedOnDate']).toBe(RUN_DATE_OFFSET);
      expect(createdBody['dateFormat']).toBe(PAYLOAD_DATE_FORMAT);
      expect(createdBody['locale']).toBe(LOCALE);

      // The account exists and is waiting for approval: Fineract's own label for status 100 is
      // "Submitted and pending approval", so the state is compared on the word rather than on the whole
      // sentence, which is a server-side wording this spec does not own.
      const submitted = await snapshotSavings(savingsId);
      expect(submitted.status.toLowerCase()).toContain('submitted');

      // 6. Approve: one dated command on the account itself (AAP 0.7.3 W5 and W8).
      await pages.savings.openAction(savingsId, 'approve');
      await fillAction({ kind: 'approve', date: runDate });
      await pages.savings.submitAction();
      const approved = await awaitCalls(capture, 'POST', SAVINGS_ACCOUNT_PATH, 'approve', 1);
      expect(approved).toHaveLength(1);
      expect(approved[0].hasTenantHeader).toBe(true);
      const approveBody = jsonBodyOf(approved[0]);
      expect(approveBody['approvedOnDate']).toBe(RUN_DATE_OFFSET);
      expect(approveBody['dateFormat']).toBe(PAYLOAD_DATE_FORMAT);
      expect(approveBody['locale']).toBe(LOCALE);

      // 7. Activate: the same endpoint with `command=activate`, after which the account holds nothing.
      await pages.savings.openAction(savingsId, 'activate');
      await fillAction({ kind: 'activate', date: runDate });
      await pages.savings.submitAction();
      const activated = await awaitCalls(capture, 'POST', SAVINGS_ACCOUNT_PATH, 'activate', 1);
      expect(activated).toHaveLength(1);
      expect(jsonBodyOf(activated[0])['activatedOnDate']).toBe(RUN_DATE_OFFSET);
      const active = await snapshotSavings(savingsId);
      expect(active.status.toLowerCase()).toBe('active');
      expect(active.accountBalance).toBe(0);
      // Fineract leaves a zero total out of the summary altogether, so an absent deposit or withdrawal
      // total is the zero it means and is read as one; a non-zero total would still fail here.
      expect(active.totalDeposits ?? 0).toBe(0);
      expect(active.totalWithdrawals ?? 0).toBe(0);

      // 8. Deposit: the form reads the transactions template, which is where its payment types come
      //    from, and the option the harness picks is the server's own first one — never a literal id.
      await pages.savings.openAction(savingsId, 'deposit');
      const depositTemplate = await awaitCalls(capture, 'GET', SAVINGS_TRANSACTIONS_TEMPLATE_PATH, null, 1);
      expect(depositTemplate.length).toBeGreaterThan(0);
      const paymentType = await firstPaymentType(capture);
      await fillAction({ kind: 'transaction', date: runDate, amount: SCENARIO.savings.deposit, paymentType });
      await pages.savings.submitAction();

      // 9. One `POST /savingsaccounts/{id}/transactions?command=deposit` for the plan's 1,000, on the
      //    run date, with the payment type the template offered, and the figure read back afterwards.
      const deposits = await awaitCalls(capture, 'POST', SAVINGS_TRANSACTIONS_PATH, 'deposit', 1);
      expect(deposits).toHaveLength(1);
      expect(deposits[0].hasTenantHeader).toBe(true);
      const depositBody = jsonBodyOf(deposits[0]);
      expect(figureOf(depositBody['transactionAmount'])).toBe(SCENARIO.savings.deposit);
      expect(depositBody['transactionDate']).toBe(RUN_DATE_OFFSET);
      expect(figureOf(depositBody['paymentTypeId'])).toBe(paymentType.id);
      expect(depositBody['dateFormat']).toBe(PAYLOAD_DATE_FORMAT);
      expect(depositBody['locale']).toBe(LOCALE);
      const funded = await snapshotSavings(savingsId);
      expect(funded.accountBalance).toBe(SCENARIO.savings.deposit);
      expect(funded.totalDeposits).toBe(SCENARIO.savings.deposit);

      // 10. Withdrawal: the same form and the same template options. The route segment is `withdraw`
      //     on the new application and `withdrawal` on the baseline, while the command both send is
      //     `withdrawal` (AAP 0.7.3 W8 row) — which is the only thing this step varies by side.
      if (pages.uiProject === 'legacy') {
        await pages.savings.openAction(savingsId, 'withdrawal');
      } else {
        await pages.savings.openAction(savingsId, 'withdraw');
      }
      await fillAction({ kind: 'transaction', date: runDate, amount: SCENARIO.savings.withdrawal, paymentType });
      await pages.savings.submitAction();
      const withdrawals = await awaitCalls(capture, 'POST', SAVINGS_TRANSACTIONS_PATH, 'withdrawal', 1);
      expect(withdrawals).toHaveLength(1);
      expect(figureOf(jsonBodyOf(withdrawals[0])['transactionAmount'])).toBe(SCENARIO.savings.withdrawal);
      // The deposit is still exactly one request: the withdrawal must not have replayed it.
      expect(callsTo(capture.capture.exchanges, 'POST', SAVINGS_TRANSACTIONS_PATH, 'deposit')).toHaveLength(1);

      // 11. The record read back: `GET /savingsaccounts/{id}?associations=all` is the one read AAP 0.7.3
      //     lists for the record, and it is what brings the summary and the transactions together.
      await pages.savings.openView(savingsId);
      const recordReads = await awaitCalls(capture, 'GET', SAVINGS_ACCOUNT_PATH, null, 1);
      expect(recordReads.length).toBeGreaterThan(0);
      expect(recordReads.every((call) => call.query['associations'] === 'all')).toBe(true);

      // 12. What the screen shows: the plan's three figures, the deposit and the withdrawal rows, no
      //     empty state behind them and no error raised anywhere. The figures are read as numbers, so a
      //     display format that groups or rounds a value does not decide the verdict (AAP 0.10.2).
      const summary = await pages.savings.readSummary();
      const summaryFigures = [...summary.fields].map((field) => figureOf(field.value));
      expect(summaryFigures).toContain(SCENARIO.savings.expectedBalance);
      expect(summaryFigures).toContain(SCENARIO.savings.deposit);
      expect(summaryFigures).toContain(SCENARIO.savings.withdrawal);

      const transactions = [...(await pages.savings.readTransactions())];
      expect(transactions.length).toBeGreaterThanOrEqual(2);
      const amounts = transactions.map((row) => figureOf(row.amount));
      expect(amounts).toContain(SCENARIO.savings.deposit);
      expect(amounts).toContain(SCENARIO.savings.withdrawal);

      const notifications = [...(await pages.clients.readNotifications())];
      expect(notifications).toHaveLength(0);

      // 13. The backend's own end state, read over the API rather than off the screen: the account is
      //     active with the plan's 800 balance behind a 1,000 deposit and a 200 withdrawal. This is the
      //     outcome the parity report compares between the two front ends (AAP 0.10.1 W8), and the
      //     fixture writes it as this workflow's snapshot because the body returns the target.
      const end = await snapshotSavings(savingsId);
      expect(end.status.toLowerCase()).toBe('active');
      expect(end.accountBalance).toBe(SCENARIO.savings.expectedBalance);
      expect(end.totalDeposits).toBe(SCENARIO.savings.deposit);
      expect(end.totalWithdrawals).toBe(SCENARIO.savings.withdrawal);

      return { stateTargets: { savingsId } };
    });
  });
});

