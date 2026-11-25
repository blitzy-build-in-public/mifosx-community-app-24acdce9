import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter, type ParamMap } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { PermissionsService } from '../../../core/auth/permissions.service';
import { ApiError, toApiError } from '../../../core/http/api-error';
import type { LoanAccount, LoanCharge, LoanTransaction, RepaymentSchedule } from '../loan.models';
import { LoanService } from '../loan.service';
import { LoanChargesComponent } from './loan-charges/loan-charges.component';
import { LoanScheduleComponent } from './loan-schedule/loan-schedule.component';
import { LoanTransactionsComponent } from './loan-transactions/loan-transactions.component';
import { LOAN_ACTIONS, LoanViewComponent } from './loan-view.component';

/**
 * Behavioural spec for the individual-loan record — `#/viewloanaccount/:id`, the screen the loan
 * route tree mounts for its one record path (AAP 0.7.1 Features row `loans`; AAP 0.7.4's
 * `#/viewloanaccount/:id` row; AAP 0.8.2 "Feature routes, matching legacy paths exactly").
 *
 * It pins the five things the record exists to do and that a rewrite would get wrong:
 *
 *  1. the loaded loan renders its account number, its product and its identity, from exactly one read
 *     of `LoanService.get(id)` — the `GET /loans/{id}?associations=all` answer that carries the
 *     schedule, the transactions and the loan's own `charges` together (AAP 0.7.3 row "W6
 *     repayment") — which is the record's whole read, because no charge-list endpoint is a row of the
 *     plan's endpoint table and the legacy record read the same members from the same call;
 *  2. the record shows three tabs — the repayment schedule, the transactions and the charges — and
 *     hands each committed section component the payload's own slice, so none of them requests
 *     anything;
 *  3. a 404, and a route that names no loan at all, put the record into its not-found state: the
 *     message replaces the record and no request is made for a route with no id (AAP 0.7.4 state
 *     rules);
 *  4. the summary block prints the loan's total and outstanding balance from the repayment
 *     schedule's own `totalRepaymentExpected` and `totalOutstanding`, and its three balances from the
 *     sums of the schedule's per-period outstanding members — the fork answers a `summary` for active
 *     loans only, so the schedule it carries for every state is what the block reads — with a figure
 *     the payload omits rendering an empty cell rather than a zero; a 4xx other
 *     than a 404 shows Fineract's own message verbatim with the screen intact, and a 5xx is left to the
 *     interceptor's single notification (Rule 1 clause 3; AAP 0.4.2; AAP 0.4.4 decision 6; AAP 0.7.4);
 *  5. the charges tab renders one row per charge the record's own `charges` member carried — name, due
 *     date, amount, paid and outstanding, with the two charge actions beside them, every one gated on
 *     the single permission code the record declares — and shows the explicit empty state for a loan
 *     that carries none (AAP 0.7.4; AAP 0.14.1);
 *  6. every emission of `route.paramMap` re-reads the loan it names, so an in-place move from one
 *     record URL to another replaces the previous loan, its figures and its action links instead of
 *     leaving them on screen and issuing no request — and an answer for the loan the URL has left is
 *     discarded rather than painted (the reuse fix `loan-edit` and `client-actions` carry).
 *
 * The route stub is what makes point 6 testable: its `paramMap` is a subject, so a case can move the
 * URL the way the router does, on the same mounted component.
 *
 * The action entry points are asserted too, because they are what makes the record the way into W5,
 * W6 and the two charge screens: the rows of `LOAN_ACTIONS` the loan's own state offers — the charge
 * form, the six `loanaccount/:id/:action` segments and the edit form — each gated by
 * `HasPermissionDirective` on that row's own Fineract code (AAP 0.14.1, "Permissions are declared
 * once per route and once per action").
 *
 * **What is stubbed, and why.** Only the two collaborations a unit test cannot own: `LoanService`,
 * which would otherwise need a transport for a request this screen's contract already fixes — and of
 * which only the one method this screen calls, `get`, is supplied, so a stub cannot stand in for a
 * second read the screen does not make — and `PermissionsService`, which reads the session a unit
 * test has no business assembling — the same substitution `navbar.component.spec.ts` makes for the
 * same directive. Everything else is the shipped code: the three section components, the
 * application's tab strip, the status swatch, the permission directive and the real
 * `TranslateService` filled with the legacy captions, so a label that did not resolve would show up
 * as the missing-translation handler's wording rather than as the text asserted below.
 *
 * A rejected read reaches the component as `ApiError` because `core/http/fineract.interceptor.ts`
 * maps it there (AAP 0.4.2); the failures below are built with the production mapper `toApiError`
 * from a real `HttpErrorResponse`, so the type and the status the component discriminates on are the
 * application's own.
 */

/** The loan every case opens, as the `:id` segment delivers it. */
const LOAN_ID = '9';

/**
 * The second record the route is moved to in place — a second `#/viewloanaccount/{id}` the router
 * serves with the same component instance, which is what makes the snapshot read a defect.
 */
const SECOND_LOAN_ID = '12';

/**
 * The action links the fixture loan's state offers — it is an active loan (`loanStatusType.active`,
 * 300) — in the order `LOAN_ACTIONS` lists them: the charge form, the repayment form and undo
 * disbursal, which is exactly the set the legacy record shows for an active loan
 * (`ViewLoanDetailsController.js`).
 */
const ACTION_PATHS: readonly string[] = [
  `/addloancharge/${LOAN_ID}`,
  `/loanaccount/${LOAN_ID}/repayment`,
  `/loanaccount/${LOAN_ID}/undodisbursal`,
];

/** The captions those links render, keyed exactly as the shipped flat translation bundles key them. */
const ACTION_CAPTIONS: readonly string[] = ['Add Loan Charge', 'Make Repayment', 'Undo Disbursal'];

/** The summary block's captions, in render order: the loan-wide totals, then the three balances. */
const SUMMARY_CAPTIONS: readonly string[] = [
  'Total',
  'Outstanding',
  'Principal Outstanding',
  'Interest Outstanding',
  'Fees',
];

/**
 * The legacy captions this record resolves, keyed as the shipped bundles key them. Every key is one
 * `app/global-translations/locale-en.json` carries, so serving them here is what proves the labels
 * resolve rather than fall back to the missing-translation handler's wording.
 */
const TRANSLATIONS: Readonly<Record<string, string>> = {
  'label.heading.repaymentschedule': 'Repayment Schedule',
  'label.heading.transactions': 'Transactions',
  'label.heading.charges': 'Charges',
  'label.heading.accnum': 'Account Number',
  'label.heading.clientname': 'Client Name',
  'label.heading.principal': 'Principal',
  'label.heading.total': 'Total',
  'label.heading.outstanding': 'Outstanding',
  'label.heading.principal.outstanding': 'Principal Outstanding',
  'label.heading.interest.outstanding': 'Interest Outstanding',
  'label.heading.fees': 'Fees',
  'label.heading.date': 'Date',
  'label.heading.amount': 'Amount',
  'label.heading.type': 'Type',
  'label.heading.name': 'Name',
  'label.heading.dueasof': 'Due as of',
  'label.heading.paid': 'Paid',
  'label.heading.actions': 'Actions',
  'label.heading.no': 'No',
  'label.heading.fromdate': 'From Date',
  'label.heading.interest': 'Interest',
  'label.button.approve': 'Approve',
  'label.button.modifyapplication': 'Modify Application',
  'label.button.undoapproval': 'Undo Approval',
  'label.button.reject': 'Reject',
  'label.button.disburse': 'Disburse',
  'label.button.undodisbursal': 'Undo Disbursal',
  'label.button.makerepayment': 'Make Repayment',
  'label.button.addloancharge': 'Add Loan Charge',
  'label.button.paycharge': 'Pay Charge',
  'label.button.waivecharge': 'Waive Charge',
  'label.nodata': 'No Data',
  'error.msg.resource.not.found': 'The requested resource is not available.',
};

/**
 * The two-period schedule the payload of the fixture loan carries, shaped as
 * `GET /loans/{id}?associations=all` answers it: the loan-wide totals beside the periods, and the
 * per-period outstanding members the record's three balances are summed from. The first period is
 * paid and carries every member at zero; the second omits the fee and penalty members entirely,
 * which is how the fork reports a period no fee is outstanding against.
 */
const SCHEDULE: RepaymentSchedule = {
  periods: [
    {
      period: 1,
      fromDate: '2026-11-24',
      dueDate: '2026-12-24',
      principalDue: 416.67,
      principalOriginalDue: 416.67,
      interestDue: 50,
      feeChargesDue: 25,
      penaltyChargesDue: 0,
      totalDueForPeriod: 491.67,
      totalOriginalDueForPeriod: 491.67,
      principalOutstanding: 0,
      interestOutstanding: 0,
      feeChargesOutstanding: 0,
      penaltyChargesOutstanding: 0,
      totalOutstandingForPeriod: 0,
      complete: true,
    },
    {
      period: 2,
      fromDate: '2026-12-24',
      dueDate: '2027-01-24',
      principalDue: 4583.33,
      principalOriginalDue: 4583.33,
      interestDue: 550,
      feeChargesDue: 0,
      penaltyChargesDue: 0,
      totalDueForPeriod: 5133.33,
      totalOriginalDueForPeriod: 5133.33,
      principalOutstanding: 4583.33,
      interestOutstanding: 550,
      totalOutstandingForPeriod: 5133.33,
      complete: false,
    },
  ],
  totalPrincipalDisbursed: 5000,
  totalPrincipalExpected: 5000,
  totalPrincipalPaid: 416.67,
  totalInterestCharged: 600,
  totalFeeChargesCharged: 25,
  totalPenaltyChargesCharged: 0,
  totalWaived: 0,
  totalWrittenOff: 0,
  totalRepaymentExpected: 5625,
  totalRepayment: 491.67,
  totalOutstanding: 5133.33,
};

/** The single disbursement the payload of the fixture loan carries. */
const TRANSACTIONS: readonly LoanTransaction[] = [
  {
    id: 41,
    date: '2026-11-24',
    type: { id: 1, code: 'loanTransactionType.disbursement', value: 'Disbursement' },
    amount: 5000,
    principalPortion: 5000,
    interestPortion: 0,
    feeChargesPortion: 0,
    penaltyChargesPortion: 0,
    outstandingLoanBalance: 5125,
    manuallyReversed: false,
  },
];

/**
 * The charges the fixture loan carries, shaped as the record's own `charges` member carries them —
 * `GET /loans/{id}?associations=all` (AAP 0.7.3 row "W6 repayment"): one charge still outstanding,
 * with a specified due date, and one already paid that falls due on disbursement and so carries no
 * date at all.
 */
const LOAN_CHARGES: readonly LoanCharge[] = [
  {
    id: 21,
    chargeId: 3,
    name: 'Parity Fee',
    amount: 25,
    amountOrPercentage: 25,
    amountPaid: 0,
    amountWaived: 0,
    amountOutstanding: 25,
    chargeTimeType: { id: 2, value: 'Specified due date' },
    chargeCalculationType: { id: 1, value: 'Flat' },
    dueDate: '2026-12-24',
  },
  {
    id: 22,
    chargeId: 1,
    name: 'Parity Fee W8',
    amount: 40,
    amountOrPercentage: 40,
    amountPaid: 40,
    amountWaived: 0,
    amountOutstanding: 0,
    chargeTimeType: { id: 1, value: 'Disbursement' },
    chargeCalculationType: { id: 1, value: 'Flat' },
  },
];

/**
 * The loan the record renders: every member the page reads — its charges included, because the one
 * read carries them — with the server's own figures.
 */
const LOAN: LoanAccount = {
  id: 9,
  accountNo: '000000145',
  clientId: 2,
  clientName: 'Spec Borrower',
  loanProductId: 3,
  loanProductName: 'Spec Loan Product',
  principal: 5000,
  numberOfRepayments: 1,
  repaymentEvery: 1,
  interestRatePerPeriod: 2.5,
  status: { id: 300, code: 'loanStatusType.active', value: 'Active' },
  repaymentSchedule: SCHEDULE,
  transactions: TRANSACTIONS,
  charges: LOAN_CHARGES,
};

/**
 * A loan whose payload carries no `charges` member at all, which is how the fork answers a loan that
 * carries no charge: the record's charge tab then renders the explicit empty state rather than an
 * empty table or an error (AAP 0.7.4).
 */
const UNCHARGED_LOAN: LoanAccount = { ...LOAN, charges: undefined };

/**
 * The one charge the second route's loan carries: a row of its own, so a charge list left over from
 * the first record is caught as surely as a figure left over from it.
 */
const SECOND_LOAN_CHARGE: LoanCharge = {
  id: 31,
  chargeId: 4,
  name: 'Second Fee',
  amount: 60,
  amountOrPercentage: 60,
  amountPaid: 0,
  amountWaived: 0,
  amountOutstanding: 60,
  chargeTimeType: { id: 2, value: 'Specified due date' },
  chargeCalculationType: { id: 1, value: 'Flat' },
  dueDate: '2027-01-24',
};

/**
 * The record the second route emission names: a loan whose every printed value — its charge list
 * included — differs from {@link LOAN}, so a screen that kept the first record, its action links or
 * its charges is caught.
 */
const SECOND_LOAN: LoanAccount = {
  ...LOAN,
  id: 12,
  accountNo: '000000212',
  clientName: 'Second Borrower',
  principal: 12000,
  charges: [SECOND_LOAN_CHARGE],
};

/**
 * The fixture loan as the same payload in another lifecycle state, so a case can read the record the
 * way the server answers it for an application that has been submitted, approved or rejected.
 *
 * @param id numeric `LoanStatus.id` the record filters its action links on.
 * @param code the status's message code, as the payload carries it.
 * @param value the status's display text.
 * @returns the fixture loan in that state.
 */
function loanInStatus(id: number, code: string, value: string): LoanAccount {
  return { ...LOAN, status: { id, code, value } };
}

/**
 * The action links the legacy record offers in each loan state, and the ones it does not — the
 * per-status button lists of `app/scripts/controllers/loanAccount/ViewLoanDetailsController.js`,
 * which is what the record's entry points have to reproduce (Rule 1 clause 3): a submitted
 * application (100) carries add-charge, approve, modify and reject; an approved loan (200) carries
 * add-charge, disburse and undo approval; an active loan (300) carries add-charge, make repayment and
 * undo disbursal; an application in any other state carries none.
 */
const ACTIONS_BY_STATUS: readonly {
  readonly state: string;
  readonly loan: LoanAccount;
  readonly shown: readonly string[];
  readonly hidden: readonly string[];
}[] = [
  {
    state: 'a submitted application',
    loan: loanInStatus(
      100,
      'loanStatusType.submitted.and.pending.approval',
      'Submitted and pending approval',
    ),
    shown: [
      'loan-action-addcharge',
      'loan-action-approve',
      'loan-action-edit',
      'loan-action-reject',
    ],
    hidden: [
      'loan-action-disburse',
      'loan-action-undoapproval',
      'loan-action-repayment',
      'loan-action-undodisbursal',
    ],
  },
  {
    state: 'an approved loan',
    loan: loanInStatus(200, 'loanStatusType.approved', 'Approved'),
    shown: ['loan-action-addcharge', 'loan-action-disburse', 'loan-action-undoapproval'],
    hidden: ['loan-action-approve', 'loan-action-edit', 'loan-action-reject', 'loan-action-repayment'],
  },
  {
    state: 'an active loan',
    loan: LOAN,
    shown: ['loan-action-addcharge', 'loan-action-repayment', 'loan-action-undodisbursal'],
    hidden: ['loan-action-approve', 'loan-action-edit', 'loan-action-reject', 'loan-action-disburse'],
  },
  {
    state: 'a rejected application',
    loan: loanInStatus(500, 'loanStatusType.rejected', 'Rejected'),
    shown: [],
    hidden: LOAN_ACTIONS.map((action) => action.id),
  },
];

/**
 * A loan whose schedule reports only part of what the summary block prints: no loan-wide totals at
 * all, and one period carrying nothing but its principal balance. That is the shape an earlier loan
 * state answers with, so the block's empty-cell rule can be observed against real omissions rather
 * than against zeroes, which are values the server did report.
 */
const PARTIAL_LOAN: LoanAccount = {
  ...LOAN,
  repaymentSchedule: {
    periods: [
      {
        period: 1,
        fromDate: '2026-11-24',
        dueDate: '2026-12-24',
        principalDue: 5000,
        principalOriginalDue: 5000,
        interestDue: 0,
        feeChargesDue: 0,
        penaltyChargesDue: 0,
        totalDueForPeriod: 5000,
        totalOriginalDueForPeriod: 5000,
        principalOutstanding: 5000,
        complete: false,
      },
    ],
  },
};

/** The message a 404 answers with, quoted from Fineract's own `defaultUserMessage`. */
const NOT_FOUND_MESSAGE = 'The requested resource is not available.';

/** The not-found text the record renders, as the shipped legacy bundle words it. */
const NOT_FOUND_TEXT: string = TRANSLATIONS['error.msg.resource.not.found'];

/** The message a refused request answers with, compared character for character below. */
const VALIDATION_MESSAGE = 'The loan cannot be disbursed because it has not been approved.';

/**
 * An observable a case settles by hand, so one route's answer can be held open while the URL moves to
 * another record — the order in which a superseded read answers last.
 */
function deferredResponse<T>(): { readonly response: Observable<T>; resolve(value: T): void } {
  let settle: ((value: T) => void) | null = null;

  const response = new Observable<T>((subscriber) => {
    settle = (value: T): void => {
      subscriber.next(value);
      subscriber.complete();
    };
  });

  return {
    response,
    resolve(value: T): void {
      if (settle === null) {
        throw new Error('the screen never subscribed to the deferred response');
      }
      settle(value);
    },
  };
}

/**
 * The read this screen makes of its family's service, so a case can both answer it and assert how
 * often, and with what, the component asked.
 */
type LoanRead = (id: number | string) => Observable<LoanAccount>;

/**
 * The slice of `LoanService` this screen is given: the one read it makes. Supplying only this member
 * keeps a stub from standing in for a request the screen does not issue — the record carries its
 * charges itself, and no charge-list endpoint is a row of the plan's endpoint table (AAP 0.7.3 rows
 * "W6 repayment" and "Loan edit"; Rule 1 clause 2).
 */
type LoanServiceStub = Pick<LoanService, 'get'>;

/**
 * The half of `PermissionsService` the `hasPermission` directive asks, with the legacy algebra for
 * `ALL_FUNCTIONS` and a leading `!`. The real service reads the session, which a unit test has no
 * business assembling — the substitution `navbar.component.spec.ts` makes for the same directive.
 */
class PermissionsStub implements Pick<PermissionsService, 'has'> {
  private readonly granted: WritableSignal<readonly string[]> = signal<readonly string[]>([]);

  /** Whether the permission — or its absence, for a negated code — is held. */
  has(key: string): boolean {
    const code = key.trim();
    if (code.startsWith('!')) {
      const negated = code.slice(1).trim();
      return negated.length > 0 && !this.granted().includes(negated);
    }
    return this.granted().includes('ALL_FUNCTIONS') || this.granted().includes(code);
  }

  /** Replaces the granted list, as a login or a withdrawal does. */
  grant(codes: readonly string[]): void {
    this.granted.set(codes);
  }
}

describe('LoanViewComponent', () => {
  let fixture: ComponentFixture<LoanViewComponent>;
  let component: LoanViewComponent;
  let readLoan: Mock<LoanRead>;
  let permissions: PermissionsStub;
  let routeParams: BehaviorSubject<ParamMap>;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines the
  // cast to one line and keeps the DOM assertions type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The tab strip's anchors, in the order the record renders them. */
  function tabAnchors(): readonly HTMLAnchorElement[] {
    return Array.from(host().querySelectorAll<HTMLAnchorElement>('ul.nav-tabs > li > a'));
  }

  /** The action group's links, in the order the record renders them. */
  function actionLinks(): readonly HTMLAnchorElement[] {
    return Array.from(host().querySelectorAll<HTMLAnchorElement>('.btn-group a'));
  }

  /** The charges table's rows, as the five data cells the user reads — the actions column excluded. */
  function chargeRows(): readonly (readonly string[])[] {
    return Array.from(host().querySelectorAll<HTMLTableRowElement>('#loan-charges tbody tr')).map(
      (row): readonly string[] =>
        Array.from(row.querySelectorAll<HTMLTableCellElement>('td'))
          .slice(0, 5)
          .map((cell) => cell.textContent?.trim() ?? ''),
    );
  }

  /** The two charge actions of every rendered charge row, in the order the table shows them. */
  function chargeActionLinks(): readonly HTMLAnchorElement[] {
    return Array.from(host().querySelectorAll<HTMLAnchorElement>('#loan-charges tbody a'));
  }

  /** The charges tab's anchor, the record's third. */
  function openChargesTab(): void {
    tabAnchors()[2].click();
    fixture.detectChanges();
  }

  /** The summary block's rows as `[caption, value]` pairs, read from the cells the user sees. */
  function renderedSummary(): readonly (readonly [string, string])[] {
    return Array.from(host().querySelectorAll<HTMLElement>('#loan-summary > .row')).map(
      (row): readonly [string, string] => [
        row.firstElementChild?.textContent?.trim() ?? '',
        row.lastElementChild?.textContent?.trim() ?? '',
      ],
    );
  }

  /** The route stub's parameter map for the `:id` segment a case is about. */
  function paramMapFor(id: string | null): ParamMap {
    const params: Record<string, string> = {};

    if (id !== null) {
      params['id'] = id;
    }

    return convertToParamMap(params);
  }

  /**
   * Lets the record's reads answer and the screen paint them: each read resumes in a microtask, which
   * the awaits below cross before the render.
   */
  async function settle(): Promise<void> {
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /**
   * Moves the mounted record to another URL the way the router does when only the `:id` segment
   * changes: the same component instance stays on screen and the parameter map emits again.
   *
   * @param id the `:id` segment of the record the URL now names.
   */
  async function navigateTo(id: string): Promise<void> {
    routeParams.next(paramMapFor(id));
    await settle();
  }

  /**
   * Mounts the record for one `#/viewloanaccount/:id` URL and renders it once.
   *
   * Every case starts here, so the route id and the one answer the service gives are the only things
   * it changes. The module is reset first because the route stub is the one provider a case supplies,
   * and a module left instantiated by the previous case cannot take a new one. The subject behind the
   * route is recreated per case, so one case's emissions cannot reach the next.
   *
   * @param id the `:id` segment, or `null` for a route that carries none.
   * @param read the answer `LoanService.get` gives for this case — the record, its charges included.
   */
  async function show(id: string | null, read: LoanRead): Promise<void> {
    TestBed.resetTestingModule();
    readLoan.mockImplementation(read);
    routeParams = new BehaviorSubject<ParamMap>(paramMapFor(id));

    TestBed.configureTestingModule({
      imports: [LoanViewComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslateService(),
        { provide: LoanService, useValue: { get: readLoan } satisfies LoanServiceStub },
        { provide: ActivatedRoute, useValue: { paramMap: routeParams.asObservable() } },
        { provide: PermissionsService, useValue: permissions },
      ],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', TRANSLATIONS, true);
    translate.use('en');

    permissions.grant(['UPDATE_LOAN']);

    fixture = TestBed.createComponent(LoanViewComponent);
    component = fixture.componentInstance;
    await settle();
  }

  /**
   * The production mapping of a Fineract failure onto `ApiError`, so a rejected read reaches the
   * component as the type it catches in the application (AAP 0.4.2; AAP 0.7.2 row `FineractError`).
   *
   * @param status HTTP status to answer with.
   * @param message the server's own `defaultUserMessage`.
   * @returns the failure the service rejects with.
   */
  function failure(status: number, message: string): ApiError {
    return toApiError(new HttpErrorResponse({ status, error: { defaultUserMessage: message } }));
  }

  beforeEach(() => {
    readLoan = vi.fn<LoanRead>();
    permissions = new PermissionsStub();
  });

  it('renders the loaded loan, from its one read, with its account number, its product and its three tabs', async () => {
    await show(LOAN_ID, () => of(LOAN));

    // One read of the record endpoint, and that is the whole load: the answer carries the schedule,
    // the transactions and the loan's charges, so no second request is made (AAP 0.7.3 row "W6
    // repayment"; Rule 1 clause 2).
    expect(readLoan).toHaveBeenCalledTimes(1);
    expect(readLoan).toHaveBeenCalledWith(LOAN_ID);
    expect(component.loanId()).toBe(LOAN_ID);
    expect(component.loading()).toBe(false);
    expect(component.notFound()).toBe(false);
    // The charges the payload carried are the record's charge list, taken from that one answer.
    expect(component.charges()).toEqual(LOAN_CHARGES);

    // The record's own identity, as the payload reported it.
    expect(host().textContent).toContain(LOAN.accountNo);
    expect(host().textContent).toContain('Spec Loan Product');
    expect(host().textContent).toContain('Spec Borrower');
    expect(host().textContent).toContain('5,000');

    // Three tabs, in the legacy record's order and under the legacy bundles' own headings.
    expect(tabAnchors().map((anchor) => anchor.textContent?.trim())).toEqual([
      'Repayment Schedule',
      'Transactions',
      'Charges',
    ]);
  });

  it('hands each section the payload slice it renders, and shows one section at a time', async () => {
    await show(LOAN_ID, () => of(LOAN));

    const schedule = fixture.debugElement.query(By.directive(LoanScheduleComponent));

    expect(schedule).not.toBeNull();
    expect((schedule.componentInstance as LoanScheduleComponent).schedule()).toEqual(SCHEDULE);
    // The record opens on the schedule, so neither other section is instantiated at all.
    expect(fixture.debugElement.query(By.directive(LoanTransactionsComponent))).toBeNull();
    expect(fixture.debugElement.query(By.directive(LoanChargesComponent))).toBeNull();

    const transactionsTab = tabAnchors()[1];
    transactionsTab.click();
    fixture.detectChanges();

    const transactions = fixture.debugElement.query(By.directive(LoanTransactionsComponent));

    expect(transactions).not.toBeNull();
    expect((transactions.componentInstance as LoanTransactionsComponent).transactions()).toEqual(
      TRANSACTIONS,
    );
    expect(fixture.debugElement.query(By.directive(LoanScheduleComponent))).toBeNull();

    const chargesTab = tabAnchors()[2];
    chargesTab.click();
    fixture.detectChanges();

    const charges = fixture.debugElement.query(By.directive(LoanChargesComponent));

    expect(charges).not.toBeNull();
    expect((charges.componentInstance as LoanChargesComponent).charges()).toEqual(LOAN_CHARGES);
    expect((charges.componentInstance as LoanChargesComponent).loanId()).toBe(LOAN.id);
    expect(fixture.debugElement.query(By.directive(LoanTransactionsComponent))).toBeNull();
    // Switching tabs reads nothing: the one answer already carried every section.
    expect(readLoan).toHaveBeenCalledTimes(1);
  });

  it.each<[string, string | null]>([
    ['a route that names no loan', null],
    ['a 404 from the loan read', LOAN_ID],
  ])('renders the not-found message in place of the record for %s', async (_label, id) => {
    await show(id, () => throwError(() => failure(404, NOT_FOUND_MESSAGE)));

    expect(component.notFound()).toBe(true);
    expect(host().textContent).toContain(NOT_FOUND_TEXT);
    // The record is replaced, not annotated: no tabs, no action group, no alert beside it.
    expect(host().querySelector('ul.nav-tabs')).toBeNull();
    expect(host().querySelector('.btn-group')).toBeNull();
    expect(host().querySelector('.alert')).toBeNull();

    // A route with no id issues no request at all; a 404 is the answer to exactly one, and a record
    // the server does not have leaves no charge list behind.
    expect(readLoan).toHaveBeenCalledTimes(id === null ? 0 : 1);
    expect(component.charges()).toBeNull();
  });

  it('links the steps the loan’s state allows, each gated on that step’s own permission code', async () => {
    await show(LOAN_ID, () => of(LOAN));

    expect(actionLinks().map((link) => link.getAttribute('id'))).toEqual([
      'loan-action-addcharge',
      'loan-action-repayment',
      'loan-action-undodisbursal',
    ]);
    expect(actionLinks().map((link) => link.textContent?.trim())).toEqual(ACTION_CAPTIONS);
    expect(actionLinks().map((link) => link.getAttribute('href'))).toEqual(ACTION_PATHS);
    // The charge section's pay and waive links keep the record's own code; the entry points above
    // each answer to the code their `LOAN_ACTIONS` row carries.
    expect(component.actionPermission).toBe('UPDATE_LOAN');

    // The gate fails closed: without the codes no entry point is visible…
    permissions.grant([]);
    fixture.detectChanges();
    expect(actionLinks().every((link) => link.style.display === 'none')).toBe(true);

    // …and it is per action, so holding the repayment code alone reveals the repayment form only.
    permissions.grant(['REPAYMENT_LOAN']);
    fixture.detectChanges();
    expect(
      actionLinks().map((link) => [link.getAttribute('id'), link.style.display] as const),
    ).toEqual([
      ['loan-action-addcharge', 'none'],
      ['loan-action-repayment', ''],
      ['loan-action-undodisbursal', 'none'],
    ]);

    // `ALL_FUNCTIONS` is the one code that reveals every entry point (legacy's permission algebra).
    permissions.grant(['ALL_FUNCTIONS']);
    fixture.detectChanges();
    expect(actionLinks().every((link) => link.style.display === '')).toBe(true);
  });

  it.each(ACTIONS_BY_STATUS)(
    'offers the entry points the legacy record offers for $state, and no others',
    async ({ loan, shown, hidden }) => {
      await show(LOAN_ID, () => of(loan));

      // Every code the table names is held, so the only thing deciding what appears is the loan's
      // own state — the filter the legacy record applies and the record reproduces (Rule 1 clause 3).
      permissions.grant(['ALL_FUNCTIONS']);
      fixture.detectChanges();

      expect(actionLinks().map((link) => link.getAttribute('id'))).toEqual(shown);

      for (const id of hidden) {
        expect(host().querySelector(`#${id}`)).toBeNull();
      }
    },
  );

  it('derives the five summary figures from the repayment schedule the fork sends', async () => {
    await show(LOAN_ID, () => of(LOAN));

    // The fork answers a `summary` object for an active loan only, so the block reads the schedule
    // every state carries: the total is
    // `totalRepaymentExpected`, the outstanding balance is `totalOutstanding`, and the three balances
    // are the sums of the periods' own `principalOutstanding`, `interestOutstanding` and
    // `feeChargesOutstanding` + `penaltyChargesOutstanding` — the same figures the live API's
    // `summary` reports for an active loan.
    expect(renderedSummary().map(([caption, value]) => [caption, value])).toEqual([
      ['Total', '5,625'],
      ['Outstanding', '5,133.33'],
      ['Principal Outstanding', '4,583.33'],
      ['Interest Outstanding', '550'],
      // A zero the payload did report is a figure: it renders as zero, never as an empty cell.
      ['Fees', '0'],
    ]);
  });

  it('renders a summary figure the payload omits as an empty cell and never as a zero', async () => {
    await show(LOAN_ID, () => of(PARTIAL_LOAN));

    const rows = renderedSummary();

    // The captions are the legacy bundles' own, in the record's order…
    expect(rows.map(([caption]) => caption)).toEqual(SUMMARY_CAPTIONS);
    // …the one figure the schedule reports renders as reported…
    // …and the four it omits render nothing at all (Rule 1 clause 3).
    expect(rows.map(([, value]) => value)).toEqual(['', '', '5,000', '', '']);
    expect(rows.map(([, value]) => value)).not.toContain('0');
  });

  it('shows a failure other than a 404 verbatim and keeps the record page mounted', async () => {
    await show(LOAN_ID, () => throwError(() => failure(400, VALIDATION_MESSAGE)));

    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(VALIDATION_MESSAGE);
    expect(component.clientError()?.message).toBe(VALIDATION_MESSAGE);
    // A refusal is not an absent record, and the panel that would hold one is still there.
    expect(component.notFound()).toBe(false);
    expect(host().querySelector('.panel-body')).not.toBeNull();
    // A record that could not be read leaves no charge list behind, so the charge tab can neither
    // list rows nor claim the loan carries none.
    expect(component.charges()).toBeNull();
  });

  it('reports a 5xx only through the interceptor’s notification, leaving the shell usable', async () => {
    await show(LOAN_ID, () => throwError(() => failure(503, VALIDATION_MESSAGE)));

    // A 5xx is the interceptor's to announce exactly once (AAP 0.4.2), so the record adds neither a
    // second copy of the message nor a not-found state of its own (AAP 0.7.4; AAP 0.14.2).
    expect(component.error()?.status).toBe(503);
    expect(component.clientError()).toBeNull();
    expect(component.notFound()).toBe(false);
    expect(host().querySelector('.alert.alert-danger')).toBeNull();
    expect(host().querySelector('.panel-body')).not.toBeNull();
    // Nothing of a record that never arrived is painted: no figures, no links, no charges.
    expect(component.loan()).toBeNull();
    expect(component.charges()).toBeNull();
    expect(actionLinks()).toEqual([]);
  });

  it('renders one row per charge the record carried, with a gated pay and waive link each', async () => {
    await show(LOAN_ID, () => of(LOAN));

    openChargesTab();

    // The server's own values: the name verbatim, the due date through the shared display pattern —
    // an empty cell for the charge that falls due on disbursement and carries no date — and the
    // amounts as reported.
    expect(chargeRows()).toEqual([
      ['Parity Fee', '24 December 2026', '25', '0', '25'],
      ['Parity Fee W8', '', '40', '40', '0'],
    ]);

    // One pay and one waive entry point per charge, on the route those screens are served under.
    expect(chargeActionLinks().map((link) => link.getAttribute('href'))).toEqual(
      LOAN_CHARGES.flatMap((charge) => [
        `/loanaccountcharge/${LOAN_ID}/pay/${charge.id}`,
        `/loanaccountcharge/${LOAN_ID}/waive/${charge.id}`,
      ]),
    );
    expect(chargeActionLinks().map((link) => link.textContent?.trim())).toEqual([
      'Pay Charge',
      'Waive Charge',
      'Pay Charge',
      'Waive Charge',
    ]);

    // The gate is the record's own permission code, and it fails closed…
    permissions.grant([]);
    fixture.detectChanges();
    expect(chargeActionLinks().every((link) => link.style.display === 'none')).toBe(true);

    // …while the code the route declares reveals them all.
    permissions.grant(['UPDATE_LOAN']);
    fixture.detectChanges();
    expect(chargeActionLinks().every((link) => link.style.display === '')).toBe(true);
  });

  it('renders the explicit empty state for a loan whose payload carries no charges', async () => {
    await show(LOAN_ID, () => of(UNCHARGED_LOAN));

    openChargesTab();

    // AAP 0.7.4's empty-state rule for this surface: the shared empty state and no error, never an
    // empty table and never a failure message. The server omits the member rather than answering an
    // empty array, so the record's own default is what the tab reads.
    expect(component.charges()).toEqual([]);
    expect(host().querySelector('#loan-charges')).toBeNull();
    expect(host().querySelector('#loan-charges-empty')?.textContent?.trim()).toBe('No Data');
    expect(host().querySelector('.alert.alert-danger')).toBeNull();
  });

  it('re-reads the record for a second route id, replacing the previous loan, its action links and its charges', async () => {
    const answer: LoanRead = (id) => of(String(id) === SECOND_LOAN_ID ? SECOND_LOAN : LOAN);

    await show(LOAN_ID, answer);

    // The first route's record, with every action link addressed at that loan.
    expect(host().textContent).toContain(LOAN.accountNo);
    expect(actionLinks().map((link) => link.getAttribute('href'))).toEqual(ACTION_PATHS);

    await navigateTo(SECOND_LOAN_ID);

    // One load per emission, addressed at the id the URL now names.
    expect(readLoan.mock.calls).toEqual([[LOAN_ID], [SECOND_LOAN_ID]]);
    expect(component.loanId()).toBe(SECOND_LOAN_ID);

    // The second record is what the screen shows, and nothing of the first remains…
    expect(host().textContent).toContain(SECOND_LOAN.accountNo);
    expect(host().textContent).toContain(SECOND_LOAN.clientName);
    expect(host().textContent).not.toContain(LOAN.accountNo);
    // …including the action links, which followed the record's own id.
    expect(actionLinks().map((link) => link.getAttribute('href'))).toEqual(
      ACTION_PATHS.map((path) => path.replace(LOAN_ID, SECOND_LOAN_ID)),
    );

    // …and the charge list, which is the second payload's own: the first loan's rows are gone, not
    // merely outweighed by the second's.
    expect(component.charges()).toEqual([SECOND_LOAN_CHARGE]);

    openChargesTab();

    expect(chargeRows()).toEqual([['Second Fee', '24 January 2027', '60', '0', '60']]);
    expect(host().textContent).not.toContain('Parity Fee');
    expect(component.loading()).toBe(false);
    expect(component.error()).toBeNull();
  });

  it('clears the previous record while the second route’s read is outstanding', async () => {
    const second = deferredResponse<LoanAccount>();

    await show(LOAN_ID, (id) => (String(id) === SECOND_LOAN_ID ? second.response : of(LOAN)));

    expect(host().textContent).toContain(LOAN.accountNo);

    // The second route's answer is held open, which is the state an in-place move paints first.
    routeParams.next(paramMapFor(SECOND_LOAN_ID));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.loanId()).toBe(SECOND_LOAN_ID);
    expect(component.loan()).toBeNull();
    expect(component.charges()).toBeNull();
    expect(component.loading()).toBe(true);
    // Nothing of the previous loan survives the emission: no figures, no links, no message.
    expect(host().textContent).not.toContain(LOAN.accountNo);
    expect(actionLinks()).toEqual([]);

    second.resolve(SECOND_LOAN);
    await settle();

    expect(component.loan()?.id).toBe(SECOND_LOAN.id);
    expect(component.loading()).toBe(false);
  });

  it('discards a superseded loan’s answer that lands after the URL moved on', async () => {
    const first = deferredResponse<LoanAccount>();
    const second = deferredResponse<LoanAccount>();

    await show(LOAN_ID, (id) => (String(id) === SECOND_LOAN_ID ? second.response : first.response));

    // The first loan's read is still unanswered when the URL moves to the second loan, which is what a
    // move between two record URLs produces when the earlier response is the slower one.
    routeParams.next(paramMapFor(SECOND_LOAN_ID));
    await fixture.whenStable();

    second.resolve(SECOND_LOAN);
    await settle();

    expect(component.loan()?.id).toBe(SECOND_LOAN.id);
    expect(component.loading()).toBe(false);

    // The earlier answer lands last. It is dropped rather than painted, so loan 9's record and its
    // action links can never appear under loan 12's URL.
    first.resolve(LOAN);
    await settle();

    expect(component.loanId()).toBe(SECOND_LOAN_ID);
    expect(component.loan()?.id).toBe(SECOND_LOAN.id);
    expect(host().textContent).toContain(SECOND_LOAN.accountNo);
    expect(host().textContent).not.toContain(LOAN.accountNo);
    expect(actionLinks().map((link) => link.getAttribute('href'))).toEqual(
      ACTION_PATHS.map((path) => path.replace(LOAN_ID, SECOND_LOAN_ID)),
    );
    expect(component.loading()).toBe(false);
    expect(component.error()).toBeNull();
    expect(component.notFound()).toBe(false);
  });
});
