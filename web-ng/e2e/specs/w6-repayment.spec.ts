/**
 * Workflow **W6 — "make a repayment; the schedule and transactions update"** on both front ends
 * (AAP 0.10.1 W6 row; AAP 0.11.1 row for `e2e/specs/`; AAP 0.7.3 row "W6 repayment"; Rule 1 clause 8).
 *
 * One spec text drives the unchanged AngularJS baseline (project `legacy`) and this application
 * (project `next`), because every screen is reached through the page objects the parity fixture hands
 * over and the assertions compare behaviour rather than markup (AAP 0.10.2). What it proves, in the
 * plan's own terms:
 *
 * - the repayment amount is the loan's **first schedule period total due**, never a round or "nicer"
 *   figure (AAP 0.10.1 fixed data, row "W6 repayment"; Rule 1 clause 3);
 * - it is booked on the **run date**, the tenant's business date read over the API, which is also the
 *   loan's disbursement date (Rule 1 clause 2; AAP 0.10.1 "Run date");
 * - the traffic is the three calls AAP 0.7.3 gives W6 — `GET /loans/{id}/transactions/template`
 *   (`command=repayment`), exactly one `POST /loans/{id}/transactions` (`command=repayment`) carrying
 *   `dateFormat: 'dd MMMM yyyy'` and the active `locale`, and the `GET /loans/{id}` with
 *   `associations=all` that refreshes the schedule, the transactions and the charges;
 * - the backend end state satisfies the plan's identity `totalOutstanding === totalExpectedRepayment −
 *   firstPeriodTotalDue`, and the screen shows it: one more transaction row, carrying the amount that
 *   was repaid, and a first schedule period that is settled.
 *
 * ## Precondition and ordering contract
 *
 * `w5-approve-disburse.spec.ts` runs before this file (Playwright takes `specs/` in file-name order
 * with one worker, `e2e/playwright.config.ts`) and leaves a freshly disbursed `Active` loan for the
 * `Parity Client` of AAP 0.10.1. The chain spec (`chain-w2-w4-w5-w6.spec.ts`) sorts ahead of both and
 * leaves a second `Active` loan that **already carries one repayment**. This file therefore does not
 * take the first active account it finds: it selects the loan with **no repayment**, asserts that
 * exactly one such candidate exists, and — when none does — **fails naming the precondition**. It
 * never skips and never falls back to a partially repaid loan, because repaying one would break the
 * identity above instead of proving it.
 *
 * One consequence of the plan's own numbers is corrected by the running fork and matters here: a
 * disbursement in `Blitzy-Sandbox/blitzy-fineract` books the interest accrual beside the disbursement,
 * so a freshly disbursed loan carries two transaction rows, not the one AAP 0.10.1 assumes. The
 * candidate is therefore "no repayment row" rather than "exactly one row", and the transaction count
 * is asserted as the **delta of one** that a repayment adds (AAP 0.10.1: "a transaction row appears"),
 * never as the absolute `1` → `2`.
 *
 * ## What is deliberately not asserted
 *
 * Generated ids are compared by their role in the sequence, so no transaction id, no loan id and no
 * timestamp is asserted (AAP 0.10.2); amounts are compared as amounts (`toBeCloseTo`, two decimals)
 * and dates as day offsets from the run date. Everything about charges, rescheduling, guarantors and
 * collateral is out of scope (AAP 0.9.2). No credential, session value or `Authorization` header is
 * printed, attached or compared by value — only its presence, which the capture records as a boolean
 * (Rule 1 clause 9).
 */
import { snapshotLoan } from '../capture/state-snapshot';
import type { LoanSnapshot } from '../capture/state-snapshot';
import { expect, test } from '../fixtures/parity-fixture';
import type { CaptureSession, NormalizedExchange, NormalizedValue } from '../capture/network-capture';
import type { ScheduleRow, TransactionRow } from '../pages/legacy/loans.page';
import type { LoanScheduleRow, LoanTransactionRow } from '../pages/next/loans.page';
import {
  API_PATH,
  dayOffset,
  formatDateOnly,
  LOCALE,
  parseFineractDate,
  PAYLOAD_DATE_FORMAT,
  readCredentials,
  SCENARIO,
} from '../seed/fixtures';

/**
 * The API path segment of the repayment transaction template (AAP 0.7.3 "W6 repayment"), held
 * apiPath-relative with the capture's own role token for the loan.
 *
 * The capture templates every id segment by its role, so the loan of the run — whichever id it got —
 * reads as `{loanId}`; the path is prefixed with {@link API_PATH} at run time, which keeps the
 * literal a resource path rather than an address (Rule 1 clause 2).
 */
const REPAYMENT_TEMPLATE_PATH = '/loans/{loanId}/transactions/template';

/** The API path of the repayment itself — `POST` with `?command=repayment` (AAP 0.7.3 W6). */
const LOAN_TRANSACTIONS_PATH = '/loans/{loanId}/transactions';

/**
 * The API path of the loan record. W6's read-back is this path with `associations=all`, the one read
 * that carries the repayment schedule, the transactions and the charges (AAP 0.7.3 W6).
 */
const LOAN_RECORD_PATH = '/loans/{loanId}';

/** Hash route of the record a client row opens — `#/viewclient/:id` (AAP 0.8.2). */
const CLIENT_RECORD_ROUTE = /#\/viewclient\/([^/?#]+)/;

/** Hash route of the record a loan account opens — `#/viewloanaccount/:id` (AAP 0.8.2). */
const LOAN_RECORD_ROUTE = /#\/viewloanaccount\/([^/?#]+)/;

/**
 * The repayment periods the seeded `Parity Loan` product schedules: 12 monthly repayments
 * (AAP 0.10.1 fixed data, row "Loan product"). Asserted as a count so a schedule that renders the
 * wrong product's terms is caught rather than compared against itself.
 */
const SCHEDULED_PERIODS = 12;

/**
 * How long the capture is given to record an exchange the workflow has just caused. The traffic is
 * the application's own, so a missing exchange is a defect rather than a slow machine; the bound
 * exists only so a defect fails with a message instead of the test's 180-second timeout.
 */
const EXCHANGE_TIMEOUT_MS = 30_000;

/** What a captured exchange must look like to be the one an assertion is about. */
interface ExchangeMatch {
  /** HTTP method, upper-cased as the capture records it. */
  readonly method: string;
  /** Absolute path with the capture's role tokens, e.g. `/fineract-provider/api/v1/loans/{loanId}`. */
  readonly path: string;
  /** Query parameters the exchange must carry, compared by value. Omitted when any query will do. */
  readonly query?: Readonly<Record<string, string>>;
}

/** A payment type the repayment template offers, as the server sent it. */
interface PaymentTypeOption {
  /** Fineract's id for the payment type: the value the endpoint takes as `paymentTypeId`. */
  readonly id: number;
  /** Fineract's own name, which is the label the baseline's select shows and selects by. */
  readonly name: string;
}

/** One rendered repayment-schedule line of either front end. */
type ScheduleLine = ScheduleRow | LoanScheduleRow;

/** One rendered transaction line of either front end. */
type TransactionLine = TransactionRow | LoanTransactionRow;

/**
 * The role of a loan account the workflow selected, with the state read for it.
 *
 * Deliberately holds no rendered text and no id of any other resource: the account number is the
 * handle the client record offers for opening the loan, and the loan id is the role the URL carries.
 */
interface LoanCandidate {
  /** Loan id the record's route named — the id every later API read and page-object call uses. */
  readonly loanId: number;
  /** Account number the client record printed, used by {@link describeCandidate} only. */
  readonly accountNo: string;
  /** End state read before the repayment, kept for the identities the after-state is measured against. */
  readonly before: LoanSnapshot;
}

/**
 * A captured body or value as a JSON object, or `null` when it is anything else.
 *
 * Every normalised payload the capture hands over is a {@link NormalizedValue} — a JSON value whose
 * shape this harness does not model field by field, because comparing payloads the application is not
 * typed for is the whole purpose of the capture. This function and the four readers below are the
 * documented boundary at which that stops (Rule 1 clause 4): each answers `null`/`[]` instead of
 * throwing, so one unexpected field never fails a workflow that behaved correctly.
 *
 * @param value A normalised capture value, or `null` when the body was absent.
 */
function asObject(
  value: NormalizedValue | null | undefined,
): Readonly<Record<string, NormalizedValue>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}

/**
 * One field of a normalised object as a finite number, or `null` when it is absent or another type.
 *
 * @param body Object to read, or `null` for an absent body.
 * @param key Field name, as the canonicalised payload spells it.
 */
function numberOf(body: Readonly<Record<string, NormalizedValue>> | null, key: string): number | null {
  const value = body === null ? undefined : body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * One field of a normalised object as a string, or `null` when it is absent or another type. An empty
 * string is kept: it is a value the server sent.
 *
 * @param body Object to read, or `null` for an absent body.
 * @param key Field name, as the canonicalised payload spells it.
 */
function textOf(body: Readonly<Record<string, NormalizedValue>> | null, key: string): string | null {
  const value = body === null ? undefined : body[key];
  return typeof value === 'string' ? value : null;
}

/**
 * One field of a normalised object as an array, or `[]` when it is absent or another type.
 *
 * @param body Object to read, or `null` for an absent body.
 * @param key Field name, as the canonicalised payload spells it.
 */
function arrayOf(
  body: Readonly<Record<string, NormalizedValue>> | null,
  key: string,
): readonly NormalizedValue[] {
  const value = body === null ? undefined : body[key];
  // `Array.isArray` narrows to `any[]`; this widening restores `NormalizedValue` for the elements, so a
  // consumer still has to narrow what it reads (Rule 1 clause 4).
  return Array.isArray(value) ? (value as readonly NormalizedValue[]) : [];
}

/**
 * One query parameter of a captured exchange, or `null` when the call did not send it. Read through
 * this accessor rather than the record's index signature so an absent key answers `null` explicitly.
 *
 * @param exchange The captured exchange.
 * @param name Query parameter name.
 */
function queryOf(exchange: NormalizedExchange, name: string): string | null {
  return Object.hasOwn(exchange.query, name) ? exchange.query[name] : null;
}

/** Whether one captured exchange is the call an assertion is about. */
function matches(exchange: NormalizedExchange, match: ExchangeMatch): boolean {
  if (exchange.method !== match.method || exchange.path !== match.path) {
    return false;
  }
  return Object.entries(match.query ?? {}).every(
    ([name, value]) => queryOf(exchange, name) === value,
  );
}

/**
 * Every exchange the capture has recorded so far, in the order the page issued them.
 *
 * The array is the capture's own live view: it fills as the page makes calls, which is what lets an
 * assertion wait for the call it caused without stopping the recording the rest of the workflow and
 * the fixture's host check still need.
 *
 * @param capture The running capture of this test.
 */
function captured(capture: CaptureSession): readonly NormalizedExchange[] {
  return capture.capture.exchanges;
}

/** The exchanges that satisfy one {@link ExchangeMatch}, in capture order. */
function findExchanges(
  exchanges: readonly NormalizedExchange[],
  match: ExchangeMatch,
): readonly NormalizedExchange[] {
  return exchanges.filter((exchange) => matches(exchange, match));
}

/**
 * Waits for the first exchange that satisfies a match and is usable for the assertion about it, then
 * answers it.
 *
 * The wait is the application's own latency, not a fixed pause: the request is recorded as the page
 * issues it, while its response body settles a moment later, so a caller that reads a body has to
 * wait for the state it needs. Nothing is retried and nothing is clicked twice — the workflow's clicks
 * stay exactly the clicks a user makes (AAP 0.14.1).
 *
 * @param capture The running capture of this test.
 * @param match Which call to wait for.
 * @param what The call, in words, used in the failure message.
 * @param usable Whether an already-recorded exchange carries what the assertion needs.
 * @returns The first matching exchange that satisfies `usable`.
 * @throws When no such exchange is recorded within {@link EXCHANGE_TIMEOUT_MS}.
 */
async function waitForExchange(
  capture: CaptureSession,
  match: ExchangeMatch,
  what: string,
  usable: (exchange: NormalizedExchange) => boolean = () => true,
): Promise<NormalizedExchange> {
  const ready = (): readonly NormalizedExchange[] =>
    findExchanges(captured(capture), match).filter((exchange) => usable(exchange));

  await expect
    .poll(() => ready().length, {
      message:
        `${what} never reached the capture. Expected ${match.method} ${match.path}` +
        `${match.query === undefined ? '' : ` with ${JSON.stringify(match.query)}`}.`,
      timeout: EXCHANGE_TIMEOUT_MS,
    })
    .toBeGreaterThan(0);

  const [first] = ready();
  if (first === undefined) {
    throw new Error(`${what} was recorded and then lost: the capture no longer holds it.`);
  }
  return first;
}

/**
 * The first payment type the repayment template offered, which is the option both screens preselect
 * (`paymentTypeOptions[0]`, AAP 0.7.2 `LoanRepaymentRequest`).
 *
 * No id is ever written here: the value is read out of the template the application itself read, so
 * the repayment posts whichever payment type the seed's tenant offers (Rule 1 clause 3). An option
 * without a positive id or a name is a placeholder rather than a choice and is passed over, which is
 * what "first non-placeholder option" means.
 *
 * @param template The captured `GET /loans/{id}/transactions/template?command=repayment` exchange.
 * @returns The option, or `null` when the template offered none.
 */
function firstPaymentOption(template: NormalizedExchange): PaymentTypeOption | null {
  for (const element of arrayOf(asObject(template.responseBody), 'paymentTypeOptions')) {
    const option = asObject(element);
    const id = numberOf(option, 'id');
    const name = textOf(option, 'name');
    if (id !== null && id > 0 && name !== null && name.trim().length > 0) {
      return { id, name: name.trim() };
    }
  }
  return null;
}

/**
 * A figure as either front end renders it, parsed into a number, or `null` when the cell carries none.
 *
 * The two readers answer different shapes for the same figure: this application's rows carry numbers
 * (`amount: number | null`), the baseline's carry the cell text the legacy filter printed
 * (`amount: string`). Everything that is not a digit, a `.` or a `-` is dropped — thousands
 * separators, currency glyphs, spaces — and what remains is read as a number; a cell with no digit at
 * all answers `null` rather than `0`, because a figure the screen never printed must not compare equal
 * to a real zero. Whether a rendered figure matches the API's is the parity comparison's decision
 * (AAP 0.10.2), not this reader's.
 *
 * @param value A rendered figure from either row shape.
 */
function figureOf(value: string | number | null): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (value === null) {
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
 * A whole count as either front end renders it, or `null` when the cell carries none. The period
 * column is a sequence number, so its digits are read and everything else — a `#` prefix, a trailing
 * dot — is discarded.
 *
 * @param value A rendered period number from either row shape.
 */
function periodOf(value: string | number | null): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }
  if (value === null) {
    return null;
  }
  const digits = value.replace(/[^0-9]/g, '');
  return digits.length === 0 ? null : Number(digits);
}

/**
 * A figure an assertion cannot proceed without, so a missing value fails naming what it was for
 * instead of being compared as `null`. This narrows `number | null` to `number` for the compiler
 * without a cast — the figures come from the API and from rendered cells, so `null` is a real
 * possibility that deserves its own message (Rule 1 clause 4).
 *
 * @param value Figure read from the API or a rendered row.
 * @param what What the figure is, in words, used in the failure message.
 * @throws When the figure is absent.
 */
function requireFigure(value: number | null, what: string): number {
  if (value === null) {
    throw new Error(`${what} is absent: neither the API nor the screen reported a figure for it.`);
  }
  return value;
}

/**
 * The numeric id a hash route carries, or `null` when the address is not that route.
 *
 * The id is read from the address the application itself navigated to — never composed here — and is
 * used only as the handle the next call needs, because a generated id is compared by its role in the
 * sequence and never by value (AAP 0.10.2). The numeric read drops the zeros a padded account number
 * carries, so an address naming `000000030` and one naming `30` answer the same loan.
 *
 * @param url Address the page is on, as `page.url()` reports it.
 * @param route The record's hash route, capturing the id segment.
 */
function routeNumber(url: string, route: RegExp): number | null {
  const match = route.exec(url);
  if (match === null) {
    return null;
  }
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * The schedule lines that are repayment periods: the server's schedule opens with the loan's
 * disbursement, which carries no period number, and a totals line carries none either, so a line
 * without a positive period number is not a period (AAP 0.7.2 `RepaymentPeriod`).
 *
 * @param rows Every row the record's repayment-schedule section rendered, in document order.
 */
function repaymentPeriodsOf(rows: readonly ScheduleLine[]): readonly ScheduleLine[] {
  return rows.filter((row) => {
    const period = periodOf(row.period);
    return period !== null && period > 0;
  });
}

/**
 * The schedule line of one period, or `null` when the section renders none for it.
 *
 * @param rows Repayment-period lines, as {@link repaymentPeriodsOf} answered them.
 * @param period The period number to find.
 */
function lineOfPeriod(rows: readonly ScheduleLine[], period: number): ScheduleLine | null {
  return rows.find((row) => periodOf(row.period) === period) ?? null;
}

/**
 * The balance a schedule line still owes, as either screen prints it.
 *
 * The readers name the column differently — `outstanding` on this application's row,
 * `totalOutstandingForPeriod` on the baseline's — so the field is picked by the shape the row has. This
 * is the figure W6's "the first period is settled" assertion reads on both sides: neither reader
 * carries a `complete` flag, and the balance the server reports for a paid period is zero.
 *
 * @param line A repayment-schedule line, or `null` when the period is absent.
 */
function outstandingOf(line: ScheduleLine | null): number | null {
  if (line === null) {
    return null;
  }
  return 'outstanding' in line ? line.outstanding : figureOf(line.totalOutstandingForPeriod);
}

/**
 * Whether a rendered transaction row is a repayment. Both screens print Fineract's own transaction
 * type — `Repayment` — so the type text is what separates the freshly disbursed loan (a disbursement
 * and its interest accrual) from the one the chain spec already repaid (AAP 0.10.1 W6).
 *
 * @param line A rendered transaction row from either front end.
 */
function isRepaymentRow(line: TransactionLine): boolean {
  return /repayment/i.test(line.type);
}

/**
 * The balance the API reports for the repayment transaction itself, read out of the record the
 * application re-read after posting it.
 *
 * The transactions table prints each transaction's own `outstandingLoanBalance` — Fineract's running
 * balance for that row — which this fork maintains on a principal basis, while the loan-level
 * `summary.totalOutstanding` that the workflow's identities read is a principal + interest total. The
 * two are different dimensions of the same account, so holding the row to the loan total fails a
 * correct application; the displayed figure is held to the API's own value for that transaction
 * instead (AAP 0.10.2, "displayed data … transaction rows"):
 * `5000 − 416.67 = 4583.33` is the repayment's own balance while `5600 − 466.67 = 5133.33` is the
 * loan's. The transaction is selected by the type the server reports and by the amount just paid, so
 * an accrual, a disbursement or another loan's row can never answer for it.
 *
 * @param record The `GET /loans/{id}?associations=all` body the application re-read after the
 *   repayment.
 * @param amount The amount the repayment posted, which is the first period's total due.
 * @throws When the record carries no repayment transaction of that amount, carries more than one, or
 *   reports no `outstandingLoanBalance` for it — each named, because a missing figure must fail rather
 *   than fall back to the loan total.
 */
function repaymentTransactionBalance(
  record: Readonly<Record<string, NormalizedValue>> | null,
  amount: number,
): number {
  const repayments = arrayOf(record, 'transactions').filter((element) => {
    const transaction = asObject(element);
    const paid = numberOf(transaction, 'amount');
    if (paid === null || Math.abs(paid - amount) >= 0.005) {
      return false;
    }
    const type = textOf(asObject(transaction?.['type']), 'value');
    return type !== null && /repayment/i.test(type);
  });

  const [transaction] = repayments;
  if (transaction === undefined) {
    throw new Error(
      'the loan record re-read after the repayment carries no repayment transaction of ' +
        `${String(amount)}, so the rendered row has no API balance to be compared with.`,
    );
  }
  if (repayments.length > 1) {
    throw new Error(
      `the loan record re-read after the repayment carries ${String(repayments.length)} repayment ` +
        `transactions of ${String(amount)}, so the rendered row cannot be attributed to one of them.`,
    );
  }

  const balance = numberOf(asObject(transaction), 'outstandingLoanBalance');
  if (balance === null) {
    throw new Error(
      'the repayment transaction in the loan record reports no outstandingLoanBalance, which is the ' +
        'running balance the transactions table prints for each row.',
    );
  }
  return balance;
}

/**
 * A candidate account, described for a failure message. The account number is the handle the client
 * record prints, and the status is the one the API reported — no generated id is spelled out as a
 * meaning (AAP 0.10.2).
 *
 * @param candidate One loan account the selection considered.
 */
function describeCandidate(candidate: LoanCandidate): string {
  return `${candidate.accountNo} (${candidate.before.status})`;
}


test.describe('W6 make a repayment and verify the schedule and transactions', () => {
  test('repays the first schedule period total due and the record, the schedule and the transactions show it', async ({
    runWorkflow,
  }) => {
    await runWorkflow('W6', async ({ page, pages, capture, runDate }) => {
      // --- Entry: sign in, then the Parity Client's record ---------------------------------
      // Both applications authenticate through their own login screens and share no browser state
      // (e2e/playwright.config.ts), so W1's flow is this workflow's first step. The credential pair is
      // read from the environment and is never stored, printed or asserted (Rule 1 clause 9).
      const credentials = readCredentials();
      await pages.login.open();
      await pages.login.signIn(credentials.username, credentials.password);

      await pages.clients.open();
      // The toolbar's filter narrows the rows the list already holds and issues no request, so the
      // client is found on the page as rendered without searching the server.
      await pages.clients.filterList(SCENARIO.client.displayName);
      await pages.clients.openClient(SCENARIO.client.displayName);

      // The record's route carries the client id; it is the handle the record is re-opened with between
      // candidate loans, never an assertion about the id itself (AAP 0.10.2).
      const clientId = routeNumber(page.url(), CLIENT_RECORD_ROUTE);
      if (clientId === null) {
        throw new Error(
          `opening "${SCENARIO.client.displayName}" did not reach the client record route ` +
            `(#/viewclient/:id); the address is ${page.url()}`,
        );
      }

      // --- Select the freshly disbursed loan: the Active loan carrying no repayment ---------
      // The chain spec may have left an Active loan that already has one repayment, so neither the
      // first row nor the first Active row will do: each account is opened and its own transaction
      // list read, and only a loan with no repayment row is a candidate.
      const accounts = await pages.clientView.readAccounts();
      const candidates: LoanCandidate[] = [];

      for (const row of accounts) {
        // The baseline's reader names each row's family; a savings row is not this workflow's and is
        // passed over rather than followed to a record that is not a loan (W8 opens it after W6).
        if ('accountType' in row && row.accountType !== 'loan') {
          continue;
        }
        if (row.accountNo.trim().length === 0) {
          continue;
        }

        await pages.clientView.open(clientId);
        await pages.clientView.openLoanAccount(row.accountNo);

        const loanId = routeNumber(page.url(), LOAN_RECORD_ROUTE);
        if (loanId === null) {
          continue;
        }

        const state = await snapshotLoan(loanId);
        const rendered = await pages.loans.readTransactions();
        const repaid = rendered.some(isRepaymentRow);

        if (/^active$/i.test(state.status) && !repaid) {
          candidates.push({ loanId, accountNo: row.accountNo, before: state });
        }
      }

      const candidate = candidates.length === 1 ? candidates[0] : undefined;
      expect(
        candidates.length,
        'exactly one Active loan account of the Parity Client must carry no repayment: ' +
          'w5-approve-disburse.spec.ts leaves the freshly disbursed loan this workflow repays, and a ' +
          'second one — or none — makes the repayment ambiguous. Examined ' +
          `${accounts.length} account row(s); candidates: ` +
          `${candidates.map(describeCandidate).join(', ') || 'none'}.`,
      ).toBe(1);
      if (candidate === undefined) {
        throw new Error(
          'the W6 precondition is not met: the Parity Client has no single Active loan without a ' +
            'repayment. Run w2-create-client, w4-loan-application and w5-approve-disburse for this ' +
            `front end first. Examined ${accounts.length} account row(s).`,
        );
      }

      // --- Before-state: the identities the repayment must move ----------------------------
      const { before } = candidate;
      expect(before.status).toMatch(/^active$/i);

      const expectedRepayment = requireFigure(
        before.totalExpectedRepayment,
        "the loan's total expected repayment",
      );
      const beforeOutstanding = requireFigure(
        before.totalOutstanding,
        "the loan's outstanding balance",
      );
      const firstPeriodTotalDue = requireFigure(
        before.firstPeriodTotalDue,
        "the loan's first repayment period total due",
      );

      // Nothing has been repaid yet, so the whole expected repayment is still outstanding — the money
      // identity that makes this the loan W6 must repay, whatever order the server listed accounts in.
      expect(beforeOutstanding).toBeCloseTo(expectedRepayment, 2);
      // The repayment is the schedule's own figure, so it has to be a real instalment (AAP 0.10.1).
      expect(firstPeriodTotalDue).toBeGreaterThan(0);

      await pages.loans.openView(candidate.loanId);

      const beforeSchedule = await pages.loans.readScheduleRows();
      const beforeTransactions = await pages.loans.readTransactions();
      expect(beforeTransactions.some(isRepaymentRow)).toBe(false);

      // --- The rendered schedule carries the same first period the API reports --------------
      const beforePeriods = repaymentPeriodsOf(beforeSchedule);
      expect(
        beforePeriods.length,
        'the repayment schedule must render one line per repayment period of the Parity Loan product',
      ).toBe(SCHEDULED_PERIODS);

      const firstPeriod = lineOfPeriod(beforePeriods, 1);
      expect(firstPeriod, 'the repayment schedule must render period 1').not.toBeNull();
      if (firstPeriod === null) {
        throw new Error(
          'the repayment schedule rendered no period 1: the section read is not the schedule W6 reads.',
        );
      }

      expect(
        requireFigure(figureOf(firstPeriod.totalDue), 'the first period total due as rendered'),
      ).toBeCloseTo(firstPeriodTotalDue, 2);
      expect(
        requireFigure(outstandingOf(firstPeriod), 'the first period balance as rendered'),
      ).toBeCloseTo(firstPeriodTotalDue, 2);

      // The period opens on the loan's disbursement date, which the fixed data makes the run date: the
      // comparison is a day offset, never a literal date string (AAP 0.10.2; Rule 1 clause 2).
      const firstPeriodStart = parseFineractDate(firstPeriod.fromDate);
      expect(
        firstPeriodStart,
        'the first repayment period must print the disbursement date; ' +
          `"${firstPeriod.fromDate}" is not a date the harness reads`,
      ).not.toBeNull();
      if (firstPeriodStart !== null) {
        expect(dayOffset(runDate, firstPeriodStart)).toBe(0);
      }

      // --- The repayment form, seeded from the loan's own transaction template --------------
      await pages.loans.openRepayment(candidate.loanId);

      const template = await waitForExchange(
        capture,
        {
          method: 'GET',
          path: `${API_PATH}${REPAYMENT_TEMPLATE_PATH}`,
          query: { command: 'repayment' },
        },
        'the repayment transaction template W6 reads before it can post',
        (exchange) => exchange.responseBody !== null,
      );
      expect(queryOf(template, 'command')).toBe('repayment');

      const templateBody = asObject(template.responseBody);
      // The screen seeds its date field and its payment picker from this one answer, so the template is
      // the only source of the payment type the repayment carries (AAP 0.7.3 W6; Rule 1 clause 3).
      expect(
        arrayOf(templateBody, 'paymentTypeOptions').length,
        'the repayment template must offer at least one payment type for the form to select',
      ).toBeGreaterThan(0);
      expect(textOf(templateBody, 'date')).not.toBeNull();

      const paymentType = firstPaymentOption(template);
      if (paymentType === null) {
        throw new Error(
          'the repayment template offered no payment type with an id and a name, so the form has ' +
            'nothing to seed its picker from.',
        );
      }

      // One member differs between the two front ends, and only that one: this application's native
      // date field takes `yyyy-mm-dd`, while the baseline's jQuery datepicker takes the `Date` the
      // harness derives from the run date (AAP 0.10.5 items 1 and 2). The amount is the schedule's
      // first period total due on both sides (Rule 1 clause 3).
      if (pages.uiProject === 'legacy') {
        await pages.loans.fillRepayment({
          date: runDate,
          amount: String(firstPeriodTotalDue),
          paymentType: paymentType.name,
        });
      } else {
        await pages.loans.fillRepayment({
          transactionDate: formatDateOnly(runDate),
          transactionAmount: firstPeriodTotalDue,
          paymentTypeId: paymentType.id,
        });
      }

      await pages.loans.submitRepayment();

      // --- The one repayment request -------------------------------------------------------
      const repayment = await waitForExchange(
        capture,
        {
          method: 'POST',
          path: `${API_PATH}${LOAN_TRANSACTIONS_PATH}`,
          query: { command: 'repayment' },
        },
        'the repayment POST',
        (exchange) => exchange.status !== 0,
      );

      // A repayment is not idempotent: one click sends exactly one request (AAP 0.1.1, AAP 0.14.1), and
      // this is the assertion a duplicate submission would fail.
      expect(
        findExchanges(captured(capture), {
          method: 'POST',
          path: `${API_PATH}${LOAN_TRANSACTIONS_PATH}`,
          query: { command: 'repayment' },
        }).length,
        'a repayment is not idempotent: one click must send exactly one POST',
      ).toBe(1);
      expect(repayment.status).toBeGreaterThanOrEqual(200);
      expect(repayment.status).toBeLessThan(300);
      expect(repayment.hasTenantHeader).toBe(true);
      expect(repayment.hasAuthorizationHeader).toBe(true);

      const posted = asObject(repayment.requestBody);
      // A date-named member is normalised to its offset from the run date, so the disbursement date the
      // fixed data fixes is `d0` here — the same comparison on both sides (AAP 0.10.2).
      expect(textOf(posted, 'transactionDate')).toBe('d0');
      expect(
        requireFigure(
          numberOf(posted, 'transactionAmount'),
          'the repayment amount in the captured body',
        ),
      ).toBeCloseTo(firstPeriodTotalDue, 2);
      expect(numberOf(posted, 'paymentTypeId')).toBe(paymentType.id);
      expect(textOf(posted, 'dateFormat')).toBe(PAYLOAD_DATE_FORMAT);
      expect(textOf(posted, 'locale')).toBe(LOCALE);

      // --- The read that refreshes the record ----------------------------------------------
      const repaymentIndex = captured(capture).indexOf(repayment);
      const recordMatch: ExchangeMatch = {
        method: 'GET',
        path: `${API_PATH}${LOAN_RECORD_PATH}`,
        query: { associations: 'all' },
      };

      await expect
        .poll(
          () =>
            captured(capture).findIndex(
              (exchange, index) =>
                index > repaymentIndex &&
                matches(exchange, recordMatch) &&
                exchange.responseBody !== null,
            ),
          {
            message:
              'the record read with associations=all that refreshes the schedule, the transactions and ' +
              'the charges must follow the repayment (AAP 0.7.3 W6)',
            timeout: EXCHANGE_TIMEOUT_MS,
          },
        )
        .toBeGreaterThan(-1);

      const refreshed = captured(capture).find(
        (exchange, index) =>
          index > repaymentIndex && matches(exchange, recordMatch) && exchange.responseBody !== null,
      );
      if (refreshed === undefined) {
        throw new Error('the record read that followed the repayment was recorded and then lost.');
      }
      // The record the application re-read is the loan this workflow opened, not another account's: the
      // account number is the one value both the client record and the loan record print.
      expect(textOf(asObject(refreshed.responseBody), 'accountNo')).toBe(candidate.accountNo);

      // --- After-state: the plan's identities ---------------------------------------------
      const after = await snapshotLoan(candidate.loanId);
      expect(after.status).toMatch(/^active$/i);

      const afterOutstanding = requireFigure(
        after.totalOutstanding,
        "the loan's outstanding balance after the repayment",
      );
      // The AAP 0.10.1 W6 outcome, stated twice so a failure says which contract broke: the balance is
      // what the loan expected to collect minus the instalment just paid, and it is what it was before
      // the repayment minus that same instalment.
      expect(afterOutstanding).toBeCloseTo(expectedRepayment - firstPeriodTotalDue, 2);
      expect(afterOutstanding).toBeCloseTo(beforeOutstanding - firstPeriodTotalDue, 2);
      // A repayment adds one transaction — the disbursement and its accrual are already on the loan.
      expect(after.transactionCount).toBe(before.transactionCount + 1);

      // --- The screen shows it: a repayment row, and a settled first period -----------------
      await pages.loans.openView(candidate.loanId);

      const afterTransactions = await pages.loans.readTransactions();
      expect(afterTransactions).toHaveLength(beforeTransactions.length + 1);

      const repaymentRow = afterTransactions.find((line) => {
        const amount = figureOf(line.amount);
        return amount !== null && Math.abs(amount - firstPeriodTotalDue) < 0.005;
      });
      expect(
        repaymentRow,
        `the transactions section must show the repayment of ${String(firstPeriodTotalDue)} as a row`,
      ).toBeDefined();
      if (repaymentRow !== undefined) {
        expect(repaymentRow.type).toMatch(/repayment/i);
        // The row's running balance is the balance the API reports for that repayment transaction: the
        // table prints Fineract's per-transaction `outstandingLoanBalance`, a principal-basis figure,
        // while the loan-level `summary.totalOutstanding` the identities above read is principal +
        // interest. Different dimensions of one account, so the row is held to the API's own value for
        // that transaction (AAP 0.10.2, "displayed data … transaction rows") rather than to the total.
        expect(
          requireFigure(
            figureOf(repaymentRow.outstandingBalance),
            "the repayment row's loan balance",
          ),
        ).toBeCloseTo(
          repaymentTransactionBalance(asObject(refreshed.responseBody), firstPeriodTotalDue),
          2,
        );
      }

      const afterSchedule = await pages.loans.readScheduleRows();
      expect(repaymentPeriodsOf(afterSchedule)).toHaveLength(SCHEDULED_PERIODS);

      const settledFirstPeriod = lineOfPeriod(repaymentPeriodsOf(afterSchedule), 1);
      expect(
        settledFirstPeriod,
        'the repayment schedule must still render period 1 after the repayment',
      ).not.toBeNull();
      // Neither reader carries a `complete` flag, so "paid" is the balance column: a period the server
      // reports as settled owes zero, and a cell that prints nothing is that same zero.
      expect(outstandingOf(settledFirstPeriod) ?? 0).toBeCloseTo(0, 2);

      // The new application reports each notice's kind, so "no error was raised" is asserted where it
      // is labelled. The baseline's reader returns the text of whichever alert or tray is visible —
      // successes included — so nothing about notifications is asserted there, and the parity report
      // compares its own capture instead (AAP 0.10.2).
      if (pages.uiProject === 'next') {
        const notices = await pages.clients.readNotifications();
        expect(notices.filter((notice) => notice.kind === 'error')).toHaveLength(0);
      }

      // W6's outcome is the backend state, so the fixture reads it once the body has succeeded and
      // writes the comparison-ready snapshot with 0.10.2's normalisation (AAP 0.10.1; AAP 0.10.4).
      return { stateTargets: { loanId: candidate.loanId } };
    });
  });
});

