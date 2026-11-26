/** W8 — open a savings account, approve it, activate it, deposit 1,000 and withdraw 200 (AAP 0.10.1 "W8 savings (Stretch)"), one spec driving both projects through the fixture's page objects (AAP 0.10.2) (AAP 0.4.2, Rule 1 clause 3, AAP 0.9.2, Rule 1 clause 9). */
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
/** Ceiling for one wait on a hash route or a capture record — generous next to the 20 s action timeout, both waits watching work the page already started. */
const WAIT_TIMEOUT_MS = 30_000;
/** Interval between two reads of the hash or of the capture while a wait is in progress. */
const POLL_INTERVAL_MS = 100;
/** The capture's form of a payload date that is the run date: `d0` (AAP 0.10.2); every date this spec submits is that date and none is compared as a literal. */
const RUN_DATE_OFFSET = 'd0';
/** `#/viewclient/{id}` — the client record W8 is entered from (AAP 0.8.2); read only to learn which client the run works on, the id never asserted (AAP 0.10.2). */
const CLIENT_RECORD_HASH = /#\/viewclient\/(\d+)/;
/** `#/new_client_saving_application/{clientId}` — the savings application (AAP 0.8.2). */
const SAVINGS_APPLICATION_HASH = /#\/new_client_saving_application\/(\d+)/;
/** `#/viewsavingaccount/{id}` — the savings record the application and every action return to. */
const SAVINGS_RECORD_HASH = /#\/viewsavingaccount\/(\d+)/;
/** The four W8 endpoints (AAP 0.7.3) as patterns, because a capture templates an id segment by its role. */
const SAVINGS_TEMPLATE_PATH = /\/savingsaccounts\/template$/;
const SAVINGS_ACCOUNT_COLLECTION_PATH = /\/savingsaccounts$/;
const SAVINGS_ACCOUNT_PATH = /\/savingsaccounts\/\{savingsAccountId\}$/;
const SAVINGS_TRANSACTIONS_TEMPLATE_PATH = /\/savingsaccounts\/\{savingsAccountId\}\/transactions\/template$/;
const SAVINGS_TRANSACTIONS_PATH = /\/savingsaccounts\/\{savingsAccountId\}\/transactions$/;
/** The submitted-on control each front end renders: `savings-submitted-on` with a native date input here (AAP 0.10.5 item 1), `#submittedOnDate` on the baseline — the markup the page objects' own documentation names. */
const NEXT_SUBMITTED_ON = 'app-savings-new #savings-submitted-on';
const LEGACY_SUBMITTED_ON = '#submittedOnDate';
/** What one action form is given: the approve and activate dates, or a cash transaction's date, amount and payment type, discriminated by `kind`. */
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
/** The hash fragment of a page URL, `''` when it carries none — how every navigation fact here is read: the client's id and the account's. */
function hashOf(url: string): string {
  const index = url.indexOf('#');
  return index < 0 ? '' : url.slice(index);
}
/** Waits until the page's hash names `route` and answers the id it carries, since both applications paint the destination after navigating; the failure names the fragment, never the full address. */
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

/** The exchanges a capture recorded for one call, in the order the page issued them. @param exchanges The capture's exchanges so far. @param method HTTP method to match, upper-cased. @param path Normalised-path pattern, an (AAP 0.7.3). */
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

/** Waits until the capture holds at least `expected` matching exchanges, then answers all it holds. */
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

/** Narrows a normalised body to a JSON object, leaving the values inside it unmodelled (Rule 1 clause 4). */
function isJsonObject(value: NormalizedValue | null): value is { [key: string]: NormalizedValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The JSON body of an exchange that must have carried one, or a failure naming the call. */
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

/** A figure as a number, or `null` when the value carries none. Two sources are read with it: a normalised payload field, whose amount may be a number or the string one front end sent where the other sent a number, and a (AAP 0.10.2). */
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

/** The body of the newest transactions template the capture holds, once it has settled. */
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

/** The first payment type the transactions template offers — the option the deposit and withdrawal forms are driven with (AAP 0.7.3, Rule 1 clause 3). */
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

/** W8, driven once per front end. The describe title and the test's own title are the harness's identity for the workflow: the parity fixture reads `W8` out of them to name the capture artefact it writes, and (AAP 0.10.1, AAP 0.10.4). */
test.describe('W8 open a savings account, approve, activate, deposit and withdraw', () => {
  test('W8 — the Parity Client opens a Parity Savings account, approves and activates it, deposits 1,000 and withdraws 200', async ({
    runWorkflow,
  }) => {
    await runWorkflow('W8', async ({ page, pages, capture, runDate }) => {
      // The credential pair is read here, inside the workflow, and handed to the login screen only: no copy is kept, printed or compared, and the capture masks both headers (Rule 1 clause 9).
      const { username, password } = readCredentials();
      // Every date the run types is the tenant's business date in the `yyyy-mm-dd` form a native date control accepts; nothing here reads the browser clock (Rule 1 clause 2, AAP 0.10.1 "Run date").
      const runDateText = formatDateOnly(runDate);

      /** Fills the open action form, for the front end that is running (AAP 0.10.5). */
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

      // 0. W1's entry step. The fixture hands an unauthenticated page, so the login screen is opened and the application's own form is signed in through; the password reaches nothing else.
      await pages.login.open();
      await pages.login.signIn(username, password);

      // 1. The client the account is opened for: the list, then its row, then the record's own route (AAP 0.10.2).
      await pages.clients.open();
      await pages.clients.openClient(SCENARIO.client.displayName);
      const clientId = await awaitRouteId(page, CLIENT_RECORD_HASH, 'the Parity Client record');
      expect(clientId).toBeGreaterThan(0);

      // 2. "New Saving" leaves the record for the application route AAP 0.8.2 declares.
      await pages.clientView.startNewSaving();
      const application = SAVINGS_APPLICATION_HASH.exec(hashOf(page.url()));
      expect(application).not.toBeNull();
      expect(application?.[1]).toBe(String(clientId));

      // 3. The product is the seeded `Parity Savings`, chosen by the label the seed created it under (AAP 0.7.3).
      await pages.savings.selectProduct(SEED_SAVINGS_PRODUCT.name);
      const templates = callsTo(capture.capture.exchanges, 'GET', SAVINGS_TEMPLATE_PATH);
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.every((call) => call.query['clientId'] === String(clientId))).toBe(true);
      expect(templates.every((call) => call.hasTenantHeader)).toBe(true);

      // 4. The form arrives with its submitted-on date already filled — the browser-clock default the legacy form applies (AAP 0.10.5 item 15) — and the run date replaces it before the submit, so the body carries the tenant's.
      if (pages.uiProject === 'legacy') {
        await expect(page.locator(LEGACY_SUBMITTED_ON)).not.toHaveValue('');
        await pages.savings.submitApplication(runDate);
      } else {
        await expect(page.locator(NEXT_SUBMITTED_ON)).not.toHaveValue('');
        await page.locator(NEXT_SUBMITTED_ON).fill(runDateText);
        await pages.savings.submitApplication();
      }

      // 5. One click, one account: exactly one `POST /savingsaccounts`, carrying the client the route named, the chosen product, the run date and the two format members every date-bearing body of the API contract carries (AAP (AAP 0.7.2, Rule 1 clause 2).
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

      // The account exists and is waiting for approval: Fineract's own label for status 100 is "Submitted and pending approval", so the state is compared on the word rather than on the whole sentence, which is a server-side.
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
      // Fineract leaves a zero total out of the summary altogether, so an absent deposit or withdrawal total is the zero it means and is read as one; a non-zero total would still fail here.
      expect(active.totalDeposits ?? 0).toBe(0);
      expect(active.totalWithdrawals ?? 0).toBe(0);

      // 8. Deposit: the form reads the transactions template, which is where its payment types come from, and the option the harness picks is the server's own first one — never a literal id.
      await pages.savings.openAction(savingsId, 'deposit');
      const depositTemplate = await awaitCalls(capture, 'GET', SAVINGS_TRANSACTIONS_TEMPLATE_PATH, null, 1);
      expect(depositTemplate.length).toBeGreaterThan(0);
      const paymentType = await firstPaymentType(capture);
      await fillAction({ kind: 'transaction', date: runDate, amount: SCENARIO.savings.deposit, paymentType });
      await pages.savings.submitAction();

      // 9. One `POST /savingsaccounts/{id}/transactions?command=deposit` for the plan's 1,000, on the run date, with the payment type the template offered, and the figure read back afterwards.
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

      // 10. Withdrawal: the same form and the same template options. The route segment is `withdraw` on the new application and `withdrawal` on the baseline, while the command both send is `withdrawal` (AAP 0.7.3 W8 row).
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

      // 11. The record read back: `GET /savingsaccounts/{id}?associations=all` is the one read AAP 0.7.3 lists for the record, and it is what brings the summary and the transactions together.
      await pages.savings.openView(savingsId);
      const recordReads = await awaitCalls(capture, 'GET', SAVINGS_ACCOUNT_PATH, null, 1);
      expect(recordReads.length).toBeGreaterThan(0);
      expect(recordReads.every((call) => call.query['associations'] === 'all')).toBe(true);

      // 12. What the screen shows: the plan's three figures, the deposit and the withdrawal rows, no empty state behind them and no error raised anywhere (AAP 0.10.2).
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

      // 13. The backend's own end state, read over the API rather than off the screen: the account is active with the plan's 800 balance behind a 1,000 deposit and a 200 withdrawal (AAP 0.10.1).
      const end = await snapshotSavings(savingsId);
      expect(end.status.toLowerCase()).toBe('active');
      expect(end.accountBalance).toBe(SCENARIO.savings.expectedBalance);
      expect(end.totalDeposits).toBe(SCENARIO.savings.deposit);
      expect(end.totalWithdrawals).toBe(SCENARIO.savings.withdrawal);

      return { stateTargets: { savingsId } };
    });
  });
});

