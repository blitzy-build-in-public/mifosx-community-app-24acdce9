import { provideHttpClient, type HttpRequest } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { AppConfigService } from '../../core/config/app-config.service';
import type {
  ChargeTemplate,
  LoanAccount,
  LoanActionResult,
  LoanActionRequest,
  LoanActionTemplate,
  LoanApplicationRequest,
  LoanCharge,
  LoanChargeActionCommand,
  LoanChargeRequest,
  LoanCommand,
  LoanTemplate,
  LoanTransactionTemplate,
  RepaymentPeriod,
  RepaymentSchedule,
} from './loan.models';
import { LoanService, type LoanChargeActionInput, type LoanRepaymentInput } from './loan.service';

/**
 * Contract spec for `LoanService`: the one place the loans family composes a Fineract URL and turns
 * a model into a payload (Rule 1 clause 8; AAP 0.7.3 endpoint rows "W4 loan application", "Loan
 * edit", "W5 approve and disburse", "W6 repayment" and "Loan charges"; AAP 0.11.1 row for this path).
 *
 * Every public method is pinned against the real `HttpTestingController` transport, so the
 * assertions are on the request the application actually sends — method, path, the whole parameter
 * set and the whole body — and never on a stand-in for `HttpClient`. Four properties are asserted
 * for each call beyond its shape:
 *
 *   - the date-format pair. Every date-bearing body carries `dateFormat: 'dd MMMM yyyy'` and the
 *     active `locale`, and every date member is the string `toFineractDate` produced, never a `Date`
 *     (AAP 0.7.2 "Date handling"; Rule 1 clause 2). The `undoapproval` and `undodisbursal` bodies
 *     carry neither member, because the server takes no date for them and legacy sent neither — and
 *     that absence is asserted, not assumed.
 *   - the command's home. `command` travels in the query string and never in the body, exactly as
 *     the legacy resource calls send it (AAP 0.7.3; Rule 1 clause 2).
 *   - the host. Each URL is composed by `AppConfigService.apiUrl()`, which this spec stubs and spies
 *     on, so a service that built its own host would fail here (AAP 0.4.2; Rule 2).
 *   - the absent header. Neither the authorization nor the tenant header is set here; both belong to
 *     `core/http/fineract.interceptor.ts` (AAP 0.4.2).
 *
 * The transport is registered without the application's interceptor, because the interceptor is
 * what adds those headers: a request asserted here is the service's own contribution to it.
 *
 * The `AppConfigService` stub is a fixed, non-secret configuration whose `apiUrl()` composes exactly
 * as the real one documents, so an expected URL and a requested URL are built the same way. The
 * resolution of `apiBaseUrl` and `apiPath` is proved in `core/config/app-config.service.spec.ts`.
 */

/**
 * The served API host and root, written as `web-ng/src/assets/config.json` ships them, so the URLs
 * this spec expects are the URLs the deployed application produces (AAP 0.4.4 decision 5(a)). No
 * demo host appears here or anywhere else in this tree (Rule 2).
 */
const API_BASE_URL = 'https://localhost:8443';
const API_PATH = '/fineract-provider/api/v1';
const API_ROOT = API_BASE_URL + API_PATH;

/** The one separator every expected URL is joined with, so expectation and request are built alike. */
const SEPARATOR = '/';

/** The active language these cases run in, and therefore the `locale` every body must carry. */
const APP_LOCALE = 'en';

/** The one payload format, spelled once; the service takes it from `AppConfig.dateFormat`. */
const FINERACT_DATE_FORMAT = 'dd MMMM yyyy';

/** The client the loan is opened for, the loan every case acts on, and the product it is written on. */
const CLIENT_ID = 2;
const LOAN_ID = 31;
const LOAN_ID_TEXT = '31';
const PRODUCT_ID = 1;

/** The charge attached to the loan, and the different charge its own terms are read from. */
const CHARGE_ID = 8;
const PICKED_CHARGE_ID = 3;

/**
 * The two charges a loan already carries: the loan-charge ids the edit body re-posts, which are what
 * keep each charge rather than re-creating it, and the charge definitions those rows apply.
 */
const LOAN_CHARGE_ID = 12;
const SECOND_LOAN_CHARGE_ID = 13;

/**
 * The dates the loan screens hold as `Date` values, built from their local calendar parts so the
 * expected strings below cannot shift with the machine's time zone (AAP 0.7.2 "Date handling").
 */
const SUBMITTED_DATE = new Date(2026, 10, 21);
const DISBURSEMENT_DATE = new Date(2026, 10, 24);

/** Those dates as every date-bearing payload must carry them: `dd MMMM yyyy` in the active locale. */
const SUBMITTED_TEXT = '21 November 2026';
const DISBURSEMENT_TEXT = '24 November 2026';

/** The submission date in French, for the case that proves the payload follows the selected language. */
const SUBMITTED_TEXT_FR = '21 novembre 2026';

/**
 * The URL the service must request for the given path segments: the API root the configuration
 * supplies and the resource segments the service owns, joined with one separator.
 *
 * @param segments Resource segments, exactly as `loan.service.ts` names them.
 */
function loanUrl(...segments: readonly (string | number)[]): string {
  return [API_ROOT, ...segments].join(SEPARATOR);
}

/** Matches a request by method and full URL; the parameter set and body are asserted separately. */
function isRequest(
  method: string,
  url: string,
): (request: HttpRequest<unknown>) => boolean {
  return (request: HttpRequest<unknown>): boolean =>
    request.method === method && request.url === url;
}

/** The members of a request body, so a case can prove an optional member was left out entirely. */
function bodyKeys(request: HttpRequest<unknown>): string[] {
  const body: unknown = request.body;

  return typeof body === 'object' && body !== null ? Object.keys(body) : [];
}

/**
 * The `AppConfigService` surface `LoanService` uses: the resolved configuration, the URL composition
 * every service shares, and the live active locale.
 */
type ConfigSurface = Pick<AppConfigService, 'config' | 'apiUrl' | 'activeLocale'>;

/**
 * Builds the stub from the two live members the cases below need to change: the `apiUrl` spy the
 * host assertions read, and the active-locale signal the language case moves. A fresh pair per test
 * keeps one case's calls and language out of the next.
 *
 * @param apiUrl The spy standing in for `AppConfigService.apiUrl`.
 * @param activeLocale The signal standing in for `AppConfigService.activeLocale`.
 */
function configSurface(
  apiUrl: Mock<(path: string) => string>,
  activeLocale: WritableSignal<string>,
): ConfigSurface {
  return {
    config: {
      apiBaseUrl: API_BASE_URL,
      apiPath: API_PATH,
      tenantId: 'default',
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
      idleMinutes: 30,
      warningSeconds: 10,
      keepaliveMinutes: 15,
    },
    apiUrl,
    activeLocale,
  };
}

/** The `GET /loans/template` answer the client-only read fills the product picker from. */
const LOAN_TEMPLATE: LoanTemplate = {
  clientId: CLIENT_ID,
  clientName: 'Ada Okafor',
  productOptions: [{ id: PRODUCT_ID, name: 'Parity Loan', currency: { code: 'USD' } }],
  principal: 5000,
};

/** The same template once a product is chosen: the product-dependent defaults are seeded. */
const PRODUCT_TEMPLATE: LoanTemplate = {
  ...LOAN_TEMPLATE,
  product: { id: PRODUCT_ID, name: 'Parity Loan' },
  principal: 5000,
  numberOfRepayments: 12,
  repaymentEvery: 1,
  interestRatePerPeriod: 12,
  transactionProcessingStrategyCode: 'mifos-standard-strategy',
};

/** The `GET /charges/{id}?template=true` answer: one charge's own amount and currency. */
const CHARGE_TEMPLATE: ChargeTemplate = {
  chargeOptions: [
    { id: PICKED_CHARGE_ID, name: 'Parity Fee', amount: 25, currency: { code: 'USD' } },
  ],
  chargeAppliesTo: { id: 1, value: 'Loan' },
  currency: { code: 'USD', displaySymbol: 'US$', name: 'US Dollar' },
};

/** One row of a calculated schedule — the first period, which W6 repays in full. */
const PERIOD: RepaymentPeriod = {
  period: 1,
  fromDate: '2026-11-24',
  dueDate: '2026-12-24',
  principalDue: 392,
  principalOriginalDue: 392,
  interestDue: 50,
  feeChargesDue: 25,
  penaltyChargesDue: 0,
  totalDueForPeriod: 467,
  totalOriginalDueForPeriod: 467,
  principalOutstanding: 4608,
  interestOutstanding: 550,
  totalOutstandingForPeriod: 5158,
  complete: false,
};

/** The `POST /loans?command=calculateLoanSchedule` answer the preview table renders. */
const SCHEDULE: RepaymentSchedule = {
  periods: [PERIOD],
  totalPrincipalDisbursed: 5000,
  totalPrincipalExpected: 5000,
  totalPrincipalPaid: 416.67,
  totalInterestCharged: 600,
  totalFeeChargesCharged: 25,
  totalPenaltyChargesCharged: 0,
  totalWaived: 0,
  totalWrittenOff: 0,
  totalRepaymentExpected: 5625,
  totalRepayment: 466.67,
  totalOutstanding: 5158.33,
  loanTermInDays: 365,
};

/** The `GET /loans/{id}?associations=all` answer the record page renders. */
const LOAN_ACCOUNT: LoanAccount = {
  id: LOAN_ID,
  accountNo: '000000031',
  clientId: CLIENT_ID,
  clientName: 'Ada Okafor',
  loanProductId: PRODUCT_ID,
  loanProductName: 'Parity Loan',
  principal: 5000,
  numberOfRepayments: 12,
  repaymentEvery: 1,
  interestRatePerPeriod: 12,
  status: { id: 300, code: 'loanStatusType.active', value: 'Active' },
  repaymentSchedule: SCHEDULE,
  transactions: [],
};

/**
 * The `GET /loans/{id}/charges` answer: the charges the loan carries, exactly as the fork reports
 * them — the loan charge's own id, the definition it applies, its amounts and the date it falls due.
 * The record's charge section and the edit's re-posted rows are both built from this answer, because
 * the loan record itself carries no `charges` member (AAP 0.7.3 row "Loan charges").
 */
const LOAN_CHARGES: readonly LoanCharge[] = [
  {
    id: LOAN_CHARGE_ID,
    chargeId: PICKED_CHARGE_ID,
    name: 'Parity Fee',
    amount: 25,
    amountOrPercentage: 25,
    amountPaid: 0,
    amountWaived: 0,
    amountOutstanding: 25,
    chargeTimeType: { id: 2, value: 'Specified due date' },
    chargeCalculationType: { id: 1, value: 'Flat' },
    dueDate: '2026-11-24',
  },
  {
    id: SECOND_LOAN_CHARGE_ID,
    chargeId: CHARGE_ID,
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

/** The envelope every loan write answers with, carrying the ids a screen navigates by. */
const ACTION_RESULT: LoanActionResult = {
  resourceId: LOAN_ID,
  changes: { status: 'Active' },
};

/** The `GET /loans/{id}/template?templateType=approval` answer the approve form is seeded from. */
const APPROVAL_TEMPLATE: LoanActionTemplate = {
  approvalDate: '2026-11-21',
  expectedDisbursementDate: '2026-11-24',
  approvalAmount: 5000,
};

/** The transaction template both the disbursement and the repayment form read. */
const TRANSACTION_TEMPLATE: LoanTransactionTemplate = {
  paymentTypeOptions: [{ id: 1, name: 'Cash' }],
  date: '2026-11-24',
  amount: 467,
  loanId: LOAN_ID,
};

/**
 * The application the new-loan form posts: every member the model requires, both dates set, and the
 * optional officer, fund and charge present so the whole body is pinned.
 */
const APPLICATION: LoanApplicationRequest = {
  clientId: CLIENT_ID,
  productId: PRODUCT_ID,
  loanType: 'individual',
  principal: 5000,
  loanTermFrequency: 12,
  loanTermFrequencyType: 2,
  numberOfRepayments: 12,
  repaymentEvery: 1,
  repaymentFrequencyType: 2,
  interestRatePerPeriod: 12,
  interestRateFrequencyType: 2,
  amortizationType: 1,
  interestType: 0,
  interestCalculationPeriodType: 1,
  transactionProcessingStrategyCode: 'mifos-standard-strategy',
  expectedDisbursementDate: DISBURSEMENT_DATE,
  submittedOnDate: SUBMITTED_DATE,
  loanOfficerId: 7,
  fundId: 5,
  charges: [{ chargeId: PICKED_CHARGE_ID, amount: 25 }],
  dateFormat: FINERACT_DATE_FORMAT,
  locale: APP_LOCALE,
};

/** `APPLICATION` as it must reach the server: every date a string, plus the date-format pair. */
const APPLICATION_WIRE: Readonly<Record<string, unknown>> = {
  clientId: CLIENT_ID,
  productId: PRODUCT_ID,
  loanType: 'individual',
  principal: 5000,
  loanTermFrequency: 12,
  loanTermFrequencyType: 2,
  numberOfRepayments: 12,
  repaymentEvery: 1,
  repaymentFrequencyType: 2,
  interestRatePerPeriod: 12,
  interestRateFrequencyType: 2,
  amortizationType: 1,
  interestType: 0,
  interestCalculationPeriodType: 1,
  transactionProcessingStrategyCode: 'mifos-standard-strategy',
  expectedDisbursementDate: DISBURSEMENT_TEXT,
  submittedOnDate: SUBMITTED_TEXT,
  loanOfficerId: 7,
  fundId: 5,
  charges: [{ chargeId: PICKED_CHARGE_ID, amount: 25 }],
  dateFormat: FINERACT_DATE_FORMAT,
  locale: APP_LOCALE,
};

/**
 * The same application with both dates missing and every optional member unset. The body must then
 * leave the optional members out and post no date at all, so the server's own required-field rules
 * decide what is missing instead of a value this application invented (Rule 1 clause 3).
 */
const UNDATED_APPLICATION: LoanApplicationRequest = {
  clientId: CLIENT_ID,
  productId: PRODUCT_ID,
  loanType: 'individual',
  principal: 5000,
  loanTermFrequency: 12,
  loanTermFrequencyType: 2,
  numberOfRepayments: 12,
  repaymentEvery: 1,
  repaymentFrequencyType: 2,
  interestRatePerPeriod: 12,
  interestRateFrequencyType: 2,
  amortizationType: 1,
  interestType: 0,
  interestCalculationPeriodType: 1,
  transactionProcessingStrategyCode: 'mifos-standard-strategy',
  expectedDisbursementDate: null,
  submittedOnDate: null,
  loanOfficerId: undefined,
  fundId: undefined,
  charges: undefined,
  dateFormat: FINERACT_DATE_FORMAT,
  locale: APP_LOCALE,
};

/** `UNDATED_APPLICATION` as it must reach the server: no date, and no unset optional member. */
const UNDATED_APPLICATION_WIRE: Readonly<Record<string, unknown>> = {
  clientId: CLIENT_ID,
  productId: PRODUCT_ID,
  loanType: 'individual',
  principal: 5000,
  loanTermFrequency: 12,
  loanTermFrequencyType: 2,
  numberOfRepayments: 12,
  repaymentEvery: 1,
  repaymentFrequencyType: 2,
  interestRatePerPeriod: 12,
  interestRateFrequencyType: 2,
  amortizationType: 1,
  interestType: 0,
  interestCalculationPeriodType: 1,
  transactionProcessingStrategyCode: 'mifos-standard-strategy',
  dateFormat: FINERACT_DATE_FORMAT,
  locale: APP_LOCALE,
};

/**
 * The same application, with a `locale` the caller picked. The service must ignore it and send the
 * active language, because the two members are filled at the API boundary and no screen sets them.
 */
const CALLER_LOCALE_APPLICATION: LoanApplicationRequest = { ...APPLICATION, locale: 'de' };

/**
 * The five lifecycle commands, each with the body its own command posts and the body that must reach
 * the server. The three dated commands carry the date-format pair; the two undo commands carry
 * neither, because the server takes no date for them (AAP 0.7.2 `LoanActionRequest`).
 */
const ACTION_CASES: readonly {
  readonly command: LoanCommand;
  readonly request: LoanActionRequest;
  readonly wire: Readonly<Record<string, unknown>>;
}[] = [
  {
    command: 'approve',
    request: {
      command: 'approve',
      approvedOnDate: SUBMITTED_DATE,
      approvedLoanAmount: 5000,
      expectedDisbursementDate: DISBURSEMENT_DATE,
      note: 'Approved against the previewed schedule',
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    },
    wire: {
      approvedOnDate: SUBMITTED_TEXT,
      approvedLoanAmount: 5000,
      expectedDisbursementDate: DISBURSEMENT_TEXT,
      note: 'Approved against the previewed schedule',
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    },
  },
  {
    command: 'reject',
    request: {
      command: 'reject',
      rejectedOnDate: SUBMITTED_DATE,
      note: 'Outside the product range',
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    },
    wire: {
      rejectedOnDate: SUBMITTED_TEXT,
      note: 'Outside the product range',
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    },
  },
  {
    command: 'disburse',
    request: {
      command: 'disburse',
      actualDisbursementDate: DISBURSEMENT_DATE,
      transactionAmount: 5000,
      note: 'Disbursed in full',
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    },
    wire: {
      actualDisbursementDate: DISBURSEMENT_TEXT,
      transactionAmount: 5000,
      note: 'Disbursed in full',
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    },
  },
  {
    // The note alone: the server accepts `note` here and nothing else, so no date and no
    // date-format pair are sent (AAP 0.7.2 `LoanActionRequest`).
    command: 'undoapproval',
    request: { command: 'undoapproval', note: 'Correction before disbursement' },
    wire: { note: 'Correction before disbursement' },
  },
  {
    command: 'undodisbursal',
    request: { command: 'undodisbursal' },
    wire: {},
  },
];

/**
 * The two loan-charge commands. The endpoint pays or waives the charge's **whole outstanding
 * portion**, so `pay` carries only the date the payment is recorded on and `waive` carries neither a
 * date, an amount nor a payment type: the running server refuses an `amount` and a `paymentTypeId`
 * on the parameter binding, which is why neither arm declares one (AAP 0.7.3, "Loan charges";
 * `LoanChargeActionRequest`).
 */
const CHARGE_ACTION_CASES: readonly {
  readonly command: LoanChargeActionCommand;
  readonly request: LoanChargeActionInput;
  readonly wire: Readonly<Record<string, unknown>>;
}[] = [
  {
    command: 'pay',
    request: {
      command: 'pay',
      transactionDate: SUBMITTED_DATE,
    },
    wire: {
      transactionDate: SUBMITTED_TEXT,
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    },
  },
  {
    command: 'waive',
    request: {
      command: 'waive',
    },
    wire: {
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    },
  },
];

/** A repayment as the repayment form holds it: the model without the format members the service fills. */
const REPAYMENT: LoanRepaymentInput = {
  transactionDate: DISBURSEMENT_DATE,
  transactionAmount: 467,
  paymentTypeId: 1,
  note: 'First period in full',
};

/** `REPAYMENT` as it must reach the server. */
const REPAYMENT_WIRE: Readonly<Record<string, unknown>> = {
  transactionDate: DISBURSEMENT_TEXT,
  transactionAmount: 467,
  paymentTypeId: 1,
  note: 'First period in full',
  dateFormat: FINERACT_DATE_FORMAT,
  locale: APP_LOCALE,
};

/** A charge whose timing carries a specified due date, which the body must therefore post. */
const CHARGED_WITH_DUE_DATE: LoanChargeRequest = {
  chargeId: PICKED_CHARGE_ID,
  amount: 25,
  dueDate: SUBMITTED_DATE,
  dateFormat: FINERACT_DATE_FORMAT,
  locale: APP_LOCALE,
};

/** `CHARGED_WITH_DUE_DATE` as it must reach the server. */
const CHARGED_WITH_DUE_DATE_WIRE: Readonly<Record<string, unknown>> = {
  chargeId: PICKED_CHARGE_ID,
  amount: 25,
  dueDate: SUBMITTED_TEXT,
  dateFormat: FINERACT_DATE_FORMAT,
  locale: APP_LOCALE,
};

/** A disbursement-timed charge, which carries no due date and must post none. */
const CHARGE_WITHOUT_DUE_DATE: LoanChargeRequest = {
  chargeId: PICKED_CHARGE_ID,
  amount: 25,
  dateFormat: FINERACT_DATE_FORMAT,
  locale: APP_LOCALE,
};

/**
 * The charges a loan edit re-posts: the charges the loaded record carries, each with its own
 * loan-charge id, the definition it applies, the amount the record reports as `amountOrPercentage`,
 * and the due date as a `Date` — one charge dated, one carrying no date at all (AAP 0.7.3 row
 * "Loan edit"; legacy `EditLoanAccAppController.submit` posts the same four members).
 */
const REPOSTED_CHARGES: NonNullable<LoanApplicationRequest['charges']> = [
  { id: LOAN_CHARGE_ID, chargeId: PICKED_CHARGE_ID, amount: 25, dueDate: DISBURSEMENT_DATE },
  { id: SECOND_LOAN_CHARGE_ID, chargeId: CHARGE_ID, amount: 40, dueDate: null },
];

/** `REPOSTED_CHARGES` as it must reach the server: the dated row's date formatted, the other's absent. */
const REPOSTED_CHARGES_WIRE: readonly Readonly<Record<string, unknown>>[] = [
  { id: LOAN_CHARGE_ID, chargeId: PICKED_CHARGE_ID, amount: 25, dueDate: DISBURSEMENT_TEXT },
  { id: SECOND_LOAN_CHARGE_ID, chargeId: CHARGE_ID, amount: 40 },
];

/**
 * The two branches of `GET /loans/template`, which differ only in whether the product is known.
 * The first load names the client alone and receives the bare template whose `productOptions` fill
 * the picker; a product change re-reads the same endpoint with the chosen id (AAP 0.3.4 claim 14).
 */
const TEMPLATE_CASES: readonly {
  readonly label: string;
  readonly args: readonly [clientId: number | string, productId?: number | string];
  readonly params: readonly (readonly [string, string])[];
  readonly answer: LoanTemplate;
}[] = [
  {
    label: 'the client alone, so the bare template fills the product picker',
    args: [CLIENT_ID],
    params: [
      ['templateType', 'individual'],
      ['clientId', String(CLIENT_ID)],
    ],
    answer: LOAN_TEMPLATE,
  },
  {
    label: 'the client and the chosen product, so its defaults are seeded',
    args: [CLIENT_ID, PRODUCT_ID],
    params: [
      ['templateType', 'individual'],
      ['clientId', String(CLIENT_ID)],
      ['productId', String(PRODUCT_ID)],
    ],
    answer: PRODUCT_TEMPLATE,
  },
];

describe('LoanService', () => {
  let service: LoanService;
  let httpMock: HttpTestingController;
  let apiUrl: Mock<(path: string) => string>;
  let activeLocale: WritableSignal<string>;

  beforeEach(() => {
    // A fresh spy and a fresh language per test, so one case's composition and its calls are never
    // read by the next case's assertions. The composition mirrors the real `apiUrl()` exactly: the
    // loans service names its paths with a leading slash (`apiUrl('/loans')`), which the real method
    // strips and joins with one separator, so the stub strips it too and an expected URL and a
    // requested URL are built the same way (AAP 0.4.2).
    apiUrl = vi.fn((path: string): string => API_ROOT + SEPARATOR + path.replace(/^\/+/, ''));
    activeLocale = signal(APP_LOCALE);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AppConfigService, useValue: configSurface(apiUrl, activeLocale) },
      ],
    });

    service = TestBed.inject(LoanService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // A request the service issued but this spec never saw fails here, and so does one it should
    // have issued and did not.
    httpMock.verify();
  });

  for (const { label, args, params, answer } of TEMPLATE_CASES) {
    it(`reads the loan template for ${label}`, () => {
      const received: LoanTemplate[] = [];

      service.template(...args).subscribe((template) => received.push(template));

      expect(apiUrl).toHaveBeenCalledWith('/loans/template');

      const request = httpMock.expectOne(isRequest('GET', loanUrl('loans', 'template')));

      // The whole parameter set, in the order it is appended: `productId` is added only when a
      // product is already chosen (AAP 0.7.3 row "W4 loan application").
      expect(request.request.params.keys()).toEqual(params.map(([name]) => name));
      for (const [name, value] of params) {
        expect(request.request.params.get(name)).toBe(value);
      }
      expect(request.request.body).toBeNull();

      request.flush(answer);

      expect(received).toEqual([answer]);
    });
  }

  it('reads one charge template with template=true as its only parameter', () => {
    const received: ChargeTemplate[] = [];

    service.chargeTemplate(PICKED_CHARGE_ID).subscribe((template) => received.push(template));

    expect(apiUrl).toHaveBeenCalledWith('/charges/3');

    const request = httpMock.expectOne(isRequest('GET', loanUrl('charges', PICKED_CHARGE_ID)));

    expect(request.request.params.keys()).toEqual(['template']);
    expect(request.request.params.get('template')).toBe('true');
    expect(request.request.body).toBeNull();

    request.flush(CHARGE_TEMPLATE);

    expect(received).toEqual([CHARGE_TEMPLATE]);
    expect(received[0]?.chargeOptions[0]?.amount).toBe(25);
  });

  it('previews the schedule with the application body, its dates as dd MMMM yyyy and the date-format pair', () => {
    const received: RepaymentSchedule[] = [];

    service.previewSchedule(APPLICATION).subscribe((schedule) => received.push(schedule));

    expect(apiUrl).toHaveBeenCalledWith('/loans');

    const request = httpMock.expectOne(isRequest('POST', loanUrl('loans')));

    // The preview is a POST to the collection with the one command parameter (AAP 0.7.3 W4).
    expect(request.request.params.keys()).toEqual(['command']);
    expect(request.request.params.get('command')).toBe('calculateLoanSchedule');
    expect(request.request.body).toEqual(APPLICATION_WIRE);

    // Spelled out as well as compared above: the two members every date-bearing payload carries are
    // what the server parses the dates with (AAP 0.7.2 "Date handling"; Rule 1 clause 2).
    expect(request.request.body).toMatchObject({
      dateFormat: 'dd MMMM yyyy',
      locale: 'en',
      submittedOnDate: '21 November 2026',
      expectedDisbursementDate: '24 November 2026',
    });

    request.flush(SCHEDULE);

    expect(received).toEqual([SCHEDULE]);
    expect(received[0]?.periods[0]?.totalDueForPeriod).toBe(467);
  });

  it('submits the same body it previewed, with no command parameter at all', () => {
    service.create(APPLICATION).subscribe();

    expect(apiUrl).toHaveBeenCalledWith('/loans');

    const request = httpMock.expectOne(isRequest('POST', loanUrl('loans')));

    // Submission is the endpoint's default command, so legacy sent none and neither does this
    // (AAP 0.7.3 W4; Rule 1 clause 2).
    expect(request.request.params.keys()).toEqual([]);
    // The identical serialiser, so the schedule the user previewed was computed from exactly the
    // application the user then submitted (AAP 0.7.3 W4).
    expect(request.request.body).toEqual(APPLICATION_WIRE);

    request.flush(ACTION_RESULT);
  });

  it('omits a missing date and every unset optional member rather than posting them empty', () => {
    service.create(UNDATED_APPLICATION).subscribe();

    const request = httpMock.expectOne(isRequest('POST', loanUrl('loans')));

    expect(request.request.body).toEqual(UNDATED_APPLICATION_WIRE);

    // The absence, member by member: a null date is no date, and an unset optional is no member, so
    // the server's own required-field rule is what reports the gap (Rule 1 clause 3).
    expect(bodyKeys(request.request)).not.toContain('submittedOnDate');
    expect(bodyKeys(request.request)).not.toContain('expectedDisbursementDate');
    expect(bodyKeys(request.request)).not.toContain('loanOfficerId');
    expect(bodyKeys(request.request)).not.toContain('fundId');
    expect(bodyKeys(request.request)).not.toContain('charges');

    request.flush(ACTION_RESULT);
  });

  it('fills the date-format pair from the configuration and the active language, never from the caller', () => {
    service.create(CALLER_LOCALE_APPLICATION).subscribe();

    const englishRequest = httpMock.expectOne(isRequest('POST', loanUrl('loans')));

    // The caller's own `locale` never reaches the body, and the English month name matches the
    // `locale` beside it.
    expect(englishRequest.request.body).toEqual(APPLICATION_WIRE);
    englishRequest.flush(ACTION_RESULT);

    activeLocale.set('fr');

    service.create(CALLER_LOCALE_APPLICATION).subscribe();

    const frenchRequest = httpMock.expectOne(isRequest('POST', loanUrl('loans')));

    // A language selected after startup reaches the next payload, month names included, so the value
    // and the `locale` beside it describe the same language (AAP 0.7.2 "Date handling").
    expect(frenchRequest.request.body).toEqual({
      ...APPLICATION_WIRE,
      locale: 'fr',
      submittedOnDate: SUBMITTED_TEXT_FR,
      expectedDisbursementDate: '24 novembre 2026',
    });

    frenchRequest.flush(ACTION_RESULT);
  });

  for (const id of [LOAN_ID, LOAN_ID_TEXT] as const) {
    it(`reads the edit seed by its ${typeof id} route parameter`, () => {
      const received: (LoanTemplate | LoanAccount)[] = [];

      service.getWithTemplate(id).subscribe((seed) => received.push(seed));

      expect(apiUrl).toHaveBeenCalledWith('/loans/31');

      const request = httpMock.expectOne(isRequest('GET', loanUrl('loans', LOAN_ID)));

      // Both parameters, and only those: the associations are the ones the edit form reads
      // (AAP 0.7.3 row "Loan edit").
      expect(request.request.params.keys()).toEqual(['template', 'associations']);
      expect(request.request.params.get('template')).toBe('true');
      expect(request.request.params.get('associations')).toBe(
        'charges,collateral,meeting,multiDisburseDetails',
      );
      expect(request.request.body).toBeNull();

      request.flush(PRODUCT_TEMPLATE);

      expect(received).toEqual([PRODUCT_TEMPLATE]);
    });
  }

  for (const id of [LOAN_ID, LOAN_ID_TEXT] as const) {
    it(`reads the loan record by its ${typeof id} route parameter with associations=all`, () => {
      const received: LoanAccount[] = [];

      service.get(id).subscribe((loan) => received.push(loan));

      expect(apiUrl).toHaveBeenCalledWith('/loans/31');

      const request = httpMock.expectOne(isRequest('GET', loanUrl('loans', LOAN_ID)));

      // One parameter, because `associations=all` is what carries the repayment schedule — and with
      // it the loan's money totals — beside the transactions (AAP 0.7.3 row "W6 repayment"). The
      // record's charges are a separate read: this fork answers no `charges` member here at all.
      expect(request.request.params.keys()).toEqual(['associations']);
      expect(request.request.params.get('associations')).toBe('all');
      expect(request.request.body).toBeNull();

      request.flush(LOAN_ACCOUNT);

      expect(received).toEqual([LOAN_ACCOUNT]);
      expect(received[0]?.repaymentSchedule?.periods).toHaveLength(1);
    });
  }

  for (const id of [LOAN_ID, LOAN_ID_TEXT] as const) {
    it(`reads the loan's charges by its ${typeof id} route parameter, and no other parameter`, () => {
      const received: (readonly LoanCharge[])[] = [];

      service.charges(id).subscribe((charges) => received.push(charges));

      expect(apiUrl).toHaveBeenCalledWith('/loans/31/charges');

      const request = httpMock.expectOne(isRequest('GET', loanUrl('loans', LOAN_ID, 'charges')));

      // No parameter and no body: the endpoint answers the loan's charge list, and the record needs
      // nothing else from it (AAP 0.7.3 row "Loan charges"; Rule 1 clause 2).
      expect(request.request.params.keys()).toEqual([]);
      expect(request.request.body).toBeNull();

      request.flush(LOAN_CHARGES);

      // The rows arrive with the members the record lists and the edit re-posts, unchanged: the
      // loan-charge id beside the definition id, the amounts, and the due date as the server sent it.
      expect(received).toEqual([LOAN_CHARGES]);
      expect(received[0]?.[0]?.chargeId).toBe(PICKED_CHARGE_ID);
      expect(received[0]?.[1]?.dueDate).toBeUndefined();
    });
  }

  it('updates a loan with the application body unchanged and no query parameter', () => {
    service.update(LOAN_ID, APPLICATION).subscribe();

    expect(apiUrl).toHaveBeenCalledWith('/loans/31');

    const request = httpMock.expectOne(isRequest('PUT', loanUrl('loans', LOAN_ID)));

    expect(request.request.params.keys()).toEqual([]);
    // The edit posts the application's own field set: the server accepts the same members, so there
    // is no second member list to drift (AAP 0.7.3 row "Loan edit").
    expect(request.request.body).toEqual(APPLICATION_WIRE);

    request.flush(ACTION_RESULT);
  });

  it('re-posts the loan’s charges on an edit, each due date formatted and each id kept', () => {
    service.update(LOAN_ID, { ...APPLICATION, charges: REPOSTED_CHARGES }).subscribe();

    const request = httpMock.expectOne(isRequest('PUT', loanUrl('loans', LOAN_ID)));

    // `PUT /loans/{id}` treats `charges` as the loan's complete set, so the body carries a row per
    // charge with the loan-charge id that keeps it; a row's `dueDate` is formatted exactly as a
    // top-level date is — the active locale's `dd MMMM yyyy`, never the ISO string `JSON.stringify`
    // would make of a `Date` — and a charge with no due date posts no member at all
    // (AAP 0.7.3 row "Loan edit"; AAP 0.7.2 "Date handling"; Rule 1 clause 2).
    expect(request.request.body).toEqual({ ...APPLICATION_WIRE, charges: REPOSTED_CHARGES_WIRE });

    request.flush(ACTION_RESULT);
  });

  it('reads the approval template with templateType=approval as its only parameter', () => {
    const received: LoanActionTemplate[] = [];

    service.approvalTemplate(LOAN_ID).subscribe((template) => received.push(template));

    expect(apiUrl).toHaveBeenCalledWith('/loans/31/template');

    const request = httpMock.expectOne(isRequest('GET', loanUrl('loans', LOAN_ID, 'template')));

    expect(request.request.params.keys()).toEqual(['templateType']);
    expect(request.request.params.get('templateType')).toBe('approval');

    request.flush(APPROVAL_TEMPLATE);

    expect(received).toEqual([APPROVAL_TEMPLATE]);
  });

  for (const command of ['disburse', 'repayment'] as const) {
    it(`reads the ${command} transaction template with its command and no other parameter`, () => {
      const received: LoanTransactionTemplate[] = [];

      service
        .actionTemplate(LOAN_ID, command)
        .subscribe((template) => received.push(template));

      expect(apiUrl).toHaveBeenCalledWith('/loans/31/transactions/template');

      const request = httpMock.expectOne(
        isRequest('GET', loanUrl('loans', LOAN_ID, 'transactions', 'template')),
      );

      // One endpoint takes the command as a parameter, which is why one method serves both forms
      // (AAP 0.7.3 rows "W5 approve and disburse" and "W6 repayment").
      expect(request.request.params.keys()).toEqual(['command']);
      expect(request.request.params.get('command')).toBe(command);
      expect(request.request.body).toBeNull();

      request.flush(TRANSACTION_TEMPLATE);

      expect(received).toEqual([TRANSACTION_TEMPLATE]);
      expect(received[0]?.paymentTypeOptions?.[0]?.name).toBe('Cash');
    });
  }

  for (const { command, request: body, wire } of ACTION_CASES) {
    it(`posts the ${command} command with its own body and one command parameter`, () => {
      const received: LoanActionResult[] = [];

      service.action(LOAN_ID, command, body).subscribe((result) => received.push(result));

      expect(apiUrl).toHaveBeenCalledWith('/loans/31');

      const sent = httpMock.expectOne(isRequest('POST', loanUrl('loans', LOAN_ID)));

      expect(sent.request.params.keys()).toEqual(['command']);
      expect(sent.request.params.get('command')).toBe(command);
      expect(sent.request.body).toEqual(wire);

      // The command travels in the query string and never in the body, exactly as the legacy
      // resource call sends it (AAP 0.7.3; Rule 1 clause 2).
      expect(bodyKeys(sent.request)).not.toContain('command');

      if (command === 'undoapproval' || command === 'undodisbursal') {
        // Neither command takes a date, so neither carries the pair a dated body must (AAP 0.7.2).
        expect(bodyKeys(sent.request)).not.toContain('dateFormat');
        expect(bodyKeys(sent.request)).not.toContain('locale');
      } else {
        expect(sent.request.body).toMatchObject({ dateFormat: 'dd MMMM yyyy', locale: 'en' });
      }

      sent.flush(ACTION_RESULT);

      expect(received).toEqual([ACTION_RESULT]);
    });
  }

  it('posts the empty body the server takes when a caller supplies none for an undo command', () => {
    service.action(LOAN_ID, 'undodisbursal').subscribe();

    const sent = httpMock.expectOne(isRequest('POST', loanUrl('loans', LOAN_ID)));

    expect(sent.request.params.keys()).toEqual(['command']);
    expect(sent.request.params.get('command')).toBe('undodisbursal');
    // No body was assembled, so nothing is invented: the command's own empty object is posted.
    expect(sent.request.body).toEqual({});

    sent.flush(ACTION_RESULT);
  });

  it('sends an undo approval with no note as an empty body rather than a note of null', () => {
    service.action(LOAN_ID, 'undoapproval', { command: 'undoapproval' }).subscribe();

    const sent = httpMock.expectOne(isRequest('POST', loanUrl('loans', LOAN_ID)));

    expect(sent.request.body).toEqual({});
    expect(bodyKeys(sent.request)).not.toContain('note');

    sent.flush(ACTION_RESULT);
  });

  it('books a repayment with its own command, its date and the date-format pair', () => {
    const received: LoanActionResult[] = [];

    service.repay(LOAN_ID, REPAYMENT).subscribe((result) => received.push(result));

    expect(apiUrl).toHaveBeenCalledWith('/loans/31/transactions');

    const sent = httpMock.expectOne(
      isRequest('POST', loanUrl('loans', LOAN_ID, 'transactions')),
    );

    expect(sent.request.params.keys()).toEqual(['command']);
    expect(sent.request.params.get('command')).toBe('repayment');
    expect(sent.request.body).toEqual(REPAYMENT_WIRE);
    expect(sent.request.body).toMatchObject({
      dateFormat: 'dd MMMM yyyy',
      locale: 'en',
      transactionDate: '24 November 2026',
      transactionAmount: 467,
      paymentTypeId: 1,
    });

    sent.flush(ACTION_RESULT);

    expect(received).toEqual([ACTION_RESULT]);
  });

  it('sends a repayment with no date without the member, leaving the gap to the server', () => {
    service.repay(LOAN_ID, { ...REPAYMENT, transactionDate: null }).subscribe();

    const sent = httpMock.expectOne(
      isRequest('POST', loanUrl('loans', LOAN_ID, 'transactions')),
    );

    expect(bodyKeys(sent.request)).not.toContain('transactionDate');
    expect(sent.request.body).toEqual({
      transactionAmount: 467,
      paymentTypeId: 1,
      note: 'First period in full',
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    });

    sent.flush(ACTION_RESULT);
  });

  it('reads the loan charge template with no parameter at all', () => {
    const received: ChargeTemplate[] = [];

    service.chargeTemplateFor(LOAN_ID).subscribe((template) => received.push(template));

    expect(apiUrl).toHaveBeenCalledWith('/loans/31/charges/template');

    const request = httpMock.expectOne(
      isRequest('GET', loanUrl('loans', LOAN_ID, 'charges', 'template')),
    );

    // The loan is the path and legacy asked this endpoint for nothing else (AAP 0.7.3 "Loan charges").
    expect(request.request.params.keys()).toEqual([]);
    expect(request.request.body).toBeNull();

    request.flush(CHARGE_TEMPLATE);

    expect(received).toEqual([CHARGE_TEMPLATE]);
  });

  it('adds a charge with its due date formatted and the date-format pair', () => {
    service.addCharge(LOAN_ID, CHARGED_WITH_DUE_DATE).subscribe();

    expect(apiUrl).toHaveBeenCalledWith('/loans/31/charges');

    const sent = httpMock.expectOne(isRequest('POST', loanUrl('loans', LOAN_ID, 'charges')));

    expect(sent.request.params.keys()).toEqual([]);
    expect(sent.request.body).toEqual(CHARGED_WITH_DUE_DATE_WIRE);

    sent.flush(ACTION_RESULT);
  });

  it('adds a disbursement-timed charge without a due date member', () => {
    service.addCharge(LOAN_ID, CHARGE_WITHOUT_DUE_DATE).subscribe();

    const sent = httpMock.expectOne(isRequest('POST', loanUrl('loans', LOAN_ID, 'charges')));

    // A member the form left unset is omitted, so the charge posts no date rather than an empty one.
    expect(bodyKeys(sent.request)).not.toContain('dueDate');
    expect(sent.request.body).toEqual({
      chargeId: PICKED_CHARGE_ID,
      amount: 25,
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    });

    sent.flush(ACTION_RESULT);
  });

  for (const { command, request: body, wire } of CHARGE_ACTION_CASES) {
    it(`posts the ${command} charge action with its command in the path-relative query only`, () => {
      service.chargeAction(LOAN_ID, CHARGE_ID, command, body).subscribe();

      expect(apiUrl).toHaveBeenCalledWith('/loans/31/charges/8');

      const sent = httpMock.expectOne(
        isRequest('POST', loanUrl('loans', LOAN_ID, 'charges', CHARGE_ID)),
      );

      expect(sent.request.params.keys()).toEqual(['command']);
      expect(sent.request.params.get('command')).toBe(command);
      expect(sent.request.body).toEqual(wire);
      expect(bodyKeys(sent.request)).not.toContain('command');
      // The members the endpoint refuses on the parameter binding: neither command posts an amount and
      // neither posts a payment type, while only `pay` posts the date it is recorded on (AAP 0.7.3,
      // "Loan charges"; `LoanChargeActionRequest`).
      expect(bodyKeys(sent.request)).not.toContain('amount');
      expect(bodyKeys(sent.request)).not.toContain('paymentTypeId');

      if (command === 'waive') {
        expect(bodyKeys(sent.request)).not.toContain('transactionDate');
      }

      sent.flush(ACTION_RESULT);
    });
  }

  /**
   * The path segment is the loan's own charge row — the `resourceId` `POST /loans/{id}/charges`
   * answers — and not the charge definition id the picker offers: with this body,
   * `POST /loans/8/charges/1?command=pay` answers 404 "Loan charge with identifier 1 does not exist
   * for loan 8" for a definition attached as loan-charge 5, while the same command against
   * `/charges/5` resolves the charge (AAP 0.7.3, "Loan charges").
   */
  it('posts the charge action against the loan-charge id it is given, never the definition id', () => {
    const loanChargeId = 5;

    service
      .chargeAction(LOAN_ID, loanChargeId, 'pay', { command: 'pay', transactionDate: SUBMITTED_DATE })
      .subscribe();

    const sent = httpMock.expectOne(
      isRequest('POST', loanUrl('loans', LOAN_ID, 'charges', loanChargeId)),
    );

    expect(sent.request.url).toBe(`${API_ROOT}${SEPARATOR}loans/${LOAN_ID}/charges/${loanChargeId}`);
    expect(sent.request.url).not.toContain(`/charges/${PICKED_CHARGE_ID}`);

    sent.flush(ACTION_RESULT);
  });

  it('refuses to post the charge action when the body describes the other command', () => {
    // The command travels in the query string and the discriminator in the body, so a mismatched pair
    // would post one command's payload to the other's non-idempotent endpoint.
    expect(() => service.chargeAction(LOAN_ID, CHARGE_ID, 'pay', { command: 'waive' })).toThrow(
      /waive/,
    );

    httpMock.expectNone(isRequest('POST', loanUrl('loans', LOAN_ID, 'charges', CHARGE_ID)));
  });

  it('refuses a lifecycle action whose body describes another command, and issues no request', () => {
    // The two travel separately — the command in the query string, the discriminator in the body — and
    // neither action endpoint is idempotent, so a mismatched pair never reaches the server.
    expect(() =>
      service.action(LOAN_ID, 'approve', { command: 'reject', rejectedOnDate: SUBMITTED_DATE }),
    ).toThrow(/reject/);

    httpMock.expectNone(isRequest('POST', loanUrl('loans', LOAN_ID)));
  });

  it('refuses a dated command with no body rather than posting an empty one', () => {
    expect(() => service.action(LOAN_ID, 'approve')).toThrow(/approve/);

    httpMock.expectNone(isRequest('POST', loanUrl('loans', LOAN_ID)));
  });

  it('sets no authorization and no tenant header, because both belong to the HTTP interceptor', () => {
    service.create(APPLICATION).subscribe();

    const request = httpMock.expectOne(isRequest('POST', loanUrl('loans')));
    const names = request.request.headers.keys().map((name) => name.toLowerCase());

    expect(names).not.toContain('authorization');
    expect(names).not.toContain('fineract-platform-tenantid');
    expect(names).toEqual([]);

    request.flush(ACTION_RESULT);
  });

  it('re-reads the record on every call, because its state changes through the commands this service posts', () => {
    service.get(LOAN_ID).subscribe();
    service.get(LOAN_ID).subscribe();

    const requests = httpMock.match(isRequest('GET', loanUrl('loans', LOAN_ID)));

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      request.flush(LOAN_ACCOUNT);
    }
  });

  it('refuses a crafted route id or charge id with the guard message and issues no request at all', () => {
    // The router hands an `:id` over URL-decoded, so this value would leave `/api/v1` and read another
    // resource on the same host (CWE-20, CWE-22). Both identifier segments of the charges path are
    // guarded, and both refusals arrive as observable errors — the form every caller of this service
    // already handles (`firstValueFrom` inside a `try`, or a `catchError` beside it) — because `defer`
    // keeps the invalid segment from being an exception thrown out of a `switchMap` projection.
    const crafted = '../../../users';
    const messages: string[] = [];
    let emissions = 0;

    const record = (failure: unknown): void => {
      messages.push(failure instanceof Error ? failure.message : String(failure));
    };

    service.get(crafted).subscribe({ next: () => (emissions += 1), error: record });
    service.chargeAction(LOAN_ID, crafted, 'waive', { command: 'waive' }).subscribe({
      next: () => (emissions += 1),
      error: record,
    });

    expect(emissions).toBe(0);
    expect(messages).toHaveLength(2);
    // Each refusal quotes the value and names the call that composed the segment.
    for (const message of messages) {
      expect(message).toContain(`'${crafted}'`);
    }
    expect(messages[0]).toContain('LoanService.get');
    expect(messages[1]).toContain('LoanService.chargeAction');
    // Nothing was sent, on either path or in any other shape; the teardown's `verify()` says the same
    // for the whole case.
    httpMock.expectNone(isRequest('GET', loanUrl('loans', crafted)));
    httpMock.expectNone(isRequest('POST', loanUrl('loans', LOAN_ID, 'charges', crafted)));
    httpMock.expectNone(() => true);
  });
});
