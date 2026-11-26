/** W6 — make a repayment; the schedule and transactions update (AAP 0.10.1 W6, AAP 0.7.3 W6, AAP 0.11.1 `e2e/specs/`, Rule 1 clause 8), one spec text over both projects (AAP 0.10.2, Rule 1 clause 9). */
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
/** The repayment transaction template's path (AAP 0.7.3 W6), apiPath-relative and templated with the capture's `{loanId}` role token (Rule 1 clause 2). */
const REPAYMENT_TEMPLATE_PATH = '/loans/{loanId}/transactions/template';
/** The API path of the repayment itself — `POST` with `?command=repayment` (AAP 0.7.3 W6). */
const LOAN_TRANSACTIONS_PATH = '/loans/{loanId}/transactions';
/** The loan record's path: W6's read-back adds `associations=all`, the one read carrying schedule, transactions and charges (AAP 0.7.3 W6). */
const LOAN_RECORD_PATH = '/loans/{loanId}';
/** Hash route of the record a client row opens — `#/viewclient/:id` (AAP 0.8.2). */
const CLIENT_RECORD_ROUTE = /#\/viewclient\/([^/?#]+)/;
/** Hash route of the record a loan account opens — `#/viewloanaccount/:id` (AAP 0.8.2). */
const LOAN_RECORD_ROUTE = /#\/viewloanaccount\/([^/?#]+)/;
/** The 12 monthly periods the seeded `Parity Loan` schedules (AAP 0.10.1 fixed data), asserted as a count so a wrong product's terms are caught. */
const SCHEDULED_PERIODS = 12;
const EXCHANGE_TIMEOUT_MS = 30_000;
interface ExchangeMatch {
  readonly method: string;
  /** Absolute path with the capture's role tokens, e.g. `/fineract-provider/api/v1/loans/{loanId}`. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
}
interface PaymentTypeOption {
  /** Fineract's id for the payment type: the value the endpoint takes as `paymentTypeId`. */
  readonly id: number;
  /** Fineract's own name, which is the label the baseline's select shows and selects by. */
  readonly name: string;
}
type ScheduleLine = ScheduleRow | LoanScheduleRow;
type TransactionLine = TransactionRow | LoanTransactionRow;
interface LoanCandidate {
  /** Loan id the record's route named — the id every later API read and page-object call uses. */
  readonly loanId: number;
  readonly accountNo: string;
  readonly before: LoanSnapshot;
}
/** A captured value as a JSON object, or `null`: with the four readers below, the documented boundary where the harness stops narrowing an unmodelled payload (Rule 1 clause 4). */
function asObject(
  value: NormalizedValue | null | undefined,
): Readonly<Record<string, NormalizedValue>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}
function numberOf(body: Readonly<Record<string, NormalizedValue>> | null, key: string): number | null {
  const value = body === null ? undefined : body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
/** One field of a normalised object as a string, or `null`; an empty string is kept, being a value the server sent. */
function textOf(body: Readonly<Record<string, NormalizedValue>> | null, key: string): string | null {
  const value = body === null ? undefined : body[key];
  return typeof value === 'string' ? value : null;
}
function arrayOf(
  body: Readonly<Record<string, NormalizedValue>> | null,
  key: string,
): readonly NormalizedValue[] {
  const value = body === null ? undefined : body[key];
  // `Array.isArray` narrows to `any[]`; widening back to `NormalizedValue` keeps the consumer narrowing what it reads (Rule 1 clause 4).
  return Array.isArray(value) ? (value as readonly NormalizedValue[]) : [];
}
/** One query parameter of a captured exchange, or `null` when the call did not send it. */
function queryOf(exchange: NormalizedExchange, name: string): string | null {
  return Object.hasOwn(exchange.query, name) ? exchange.query[name] : null;
}
function matches(exchange: NormalizedExchange, match: ExchangeMatch): boolean {
  if (exchange.method !== match.method || exchange.path !== match.path) {
    return false;
  }
  return Object.entries(match.query ?? {}).every(
    ([name, value]) => queryOf(exchange, name) === value,
  );
}
function captured(capture: CaptureSession): readonly NormalizedExchange[] {
  return capture.capture.exchanges;
}
function findExchanges(
  exchanges: readonly NormalizedExchange[],
  match: ExchangeMatch,
): readonly NormalizedExchange[] {
  return exchanges.filter((exchange) => matches(exchange, match));
}
/** Waits for the first exchange satisfying a match that is also usable, then answers it — the wait is the application's own latency, so no click is repeated (AAP 0.14.1); throws within `EXCHANGE_TIMEOUT_MS`. */
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

/** The first payment type the repayment template offered, which is the option both screens preselect (`paymentTypeOptions[0]`, AAP 0.7.2 `LoanRepaymentRequest`) (Rule 1 clause 3). */
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

/** A figure as either front end renders it, parsed into a number, or `null` when the cell carries none (AAP 0.10.2). */
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

/** A figure an assertion cannot proceed without, so a missing value fails naming what it was for instead of being compared as `null` (Rule 1 clause 4). */
function requireFigure(value: number | null, what: string): number {
  if (value === null) {
    throw new Error(`${what} is absent: neither the API nor the screen reported a figure for it.`);
  }
  return value;
}

/** The numeric id a hash route carries, or `null` when the address is not that route (AAP 0.10.2). */
function routeNumber(url: string, route: RegExp): number | null {
  const match = route.exec(url);
  if (match === null) {
    return null;
  }
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** The schedule lines that are repayment periods: the server's schedule opens with the loan's disbursement, which carries no period number, and a totals line carries none either, so a line without a positive period number is not a repayment period (AAP 0.7.2). */
function repaymentPeriodsOf(rows: readonly ScheduleLine[]): readonly ScheduleLine[] {
  return rows.filter((row) => {
    const period = periodOf(row.period);
    return period !== null && period > 0;
  });
}

/** The schedule line of one period, or `null` when the section renders none for it. @param rows Repayment-period lines, as {@link repaymentPeriodsOf} answered them. @param period The period number to find. */
function lineOfPeriod(rows: readonly ScheduleLine[], period: number): ScheduleLine | null {
  return rows.find((row) => periodOf(row.period) === period) ?? null;
}

function outstandingOf(line: ScheduleLine | null): number | null {
  if (line === null) {
    return null;
  }
  return 'outstanding' in line ? line.outstanding : figureOf(line.totalOutstandingForPeriod);
}

/** Whether a rendered transaction row is a repayment. Both screens print Fineract's own transaction type — `Repayment` — so the type text is what separates the freshly disbursed loan (a disbursement and its interest) from the repayment W6 posts (AAP 0.10.1). */
function isRepaymentRow(line: TransactionLine): boolean {
  return /repayment/i.test(line.type);
}

/** The balance the API reports for the repayment transaction itself, read out of the record the application re-read after posting it (AAP 0.10.2). */
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

/** A candidate account, described for a failure message. The account number is the handle the client record prints, and the status is the one the API reported — no generated id is spelled out as a meaning (AAP 0.10.2). */
function describeCandidate(candidate: LoanCandidate): string {
  return `${candidate.accountNo} (${candidate.before.status})`;
}


test.describe('W6 make a repayment and verify the schedule and transactions', () => {
  test('repays the first schedule period total due and the record, the schedule and the transactions show it', async ({
    runWorkflow,
  }) => {
    await runWorkflow('W6', async ({ page, pages, capture, runDate }) => {
      // --- Entry: sign in, then the Parity Client's record --------------------------------- Both applications authenticate through their own login screens and share no browser state (e2e/playwright.config.ts), so W1's flow is performed by each project for itself, and no credential or session crosses between the two (Rule 1 clause 9).
      const credentials = readCredentials();
      await pages.login.open();
      await pages.login.signIn(credentials.username, credentials.password);

      await pages.clients.open();
      await pages.clients.filterList(SCENARIO.client.displayName);
      await pages.clients.openClient(SCENARIO.client.displayName);

      // The record's route carries the client id; it is the handle the record is re-opened with between candidate loans, never an assertion about the id itself (AAP 0.10.2).
      const clientId = routeNumber(page.url(), CLIENT_RECORD_ROUTE);
      if (clientId === null) {
        throw new Error(
          `opening "${SCENARIO.client.displayName}" did not reach the client record route ` +
            `(#/viewclient/:id); the address is ${page.url()}`,
        );
      }

      // --- Select the freshly disbursed loan: the Active loan carrying no repayment --------- The chain spec may have left an Active loan that already has one repayment, so neither the first row nor the first Active row will be the loan this workflow repays.
      const accounts = await pages.clientView.readAccounts();
      const candidates: LoanCandidate[] = [];

      for (const row of accounts) {
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

      // Nothing has been repaid yet, so the whole expected repayment is still outstanding — the money identity that makes this the loan W6 must repay, whatever order the server listed accounts in.
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

      // The period opens on the loan's disbursement date, which the fixed data makes the run date: the comparison is a day offset, never a literal date string (AAP 0.10.2; Rule 1 clause 2).
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
      // The screen seeds its date field and its payment picker from this one answer, so the template is the only source of the payment type the repayment carries (AAP 0.7.3 W6; Rule 1 clause 3).
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

      // One member differs between the two front ends, and only that one: this application's native date field takes `yyyy-mm-dd`, while the baseline's jQuery datepicker takes the `Date` the harness derives from the run date (AAP 0.10.5, Rule 1 clause 3).
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

      // A repayment is not idempotent: one click sends exactly one request (AAP 0.1.1, AAP 0.14.1), and this is the assertion a duplicate submission would fail.
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
      // A date-named member is normalised to its offset from the run date, so the disbursement date the fixed data fixes is `d0` here — the same comparison on both sides (AAP 0.10.2).
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
      expect(textOf(asObject(refreshed.responseBody), 'accountNo')).toBe(candidate.accountNo);

      // --- After-state: the plan's identities ---------------------------------------------
      const after = await snapshotLoan(candidate.loanId);
      expect(after.status).toMatch(/^active$/i);

      const afterOutstanding = requireFigure(
        after.totalOutstanding,
        "the loan's outstanding balance after the repayment",
      );
      // The AAP 0.10.1 W6 outcome, stated twice so a failure says which contract broke: the balance is what the loan expected to collect minus the instalment just paid, and it is what it was before the repayment minus that same instalment.
      expect(afterOutstanding).toBeCloseTo(expectedRepayment - firstPeriodTotalDue, 2);
      expect(afterOutstanding).toBeCloseTo(beforeOutstanding - firstPeriodTotalDue, 2);
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
        // The row's running balance is the balance the API reports for that repayment transaction: the table prints Fineract's per-transaction `outstandingLoanBalance`, a principal-basis figure, while the loan-level `totalOutstanding` is a different figure, so the row is compared with the API's per-transaction one (AAP 0.10.2).
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
      // Neither reader carries a `complete` flag, so "paid" is the balance column: a period the server reports as settled owes zero, and a cell that prints nothing is that same zero.
      expect(outstandingOf(settledFirstPeriod) ?? 0).toBeCloseTo(0, 2);

      // The new application reports each notice's kind, so "no error was raised" is asserted where it is labelled (AAP 0.10.2).
      if (pages.uiProject === 'next') {
        const notices = await pages.clients.readNotifications();
        expect(notices.filter((notice) => notice.kind === 'error')).toHaveLength(0);
      }

      // W6's outcome is the backend state, so the fixture reads it once the body has succeeded and writes the comparison-ready snapshot with 0.10.2's normalisation (AAP 0.10.1; AAP 0.10.4).
      return { stateTargets: { loanId: candidate.loanId } };
    });
  });
});

