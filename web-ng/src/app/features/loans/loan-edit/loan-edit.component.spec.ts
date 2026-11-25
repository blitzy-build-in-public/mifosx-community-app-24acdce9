import {
  provideHttpClient,
  withInterceptors,
  type HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, Subject, catchError, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { DEFAULT_APP_CONFIG } from '../../../core/config/app-config.model';
import { AppConfigService } from '../../../core/config/app-config.service';
import { toApiError } from '../../../core/http/api-error';
import { isLoanAccount } from '../loan.models';
import type { LoanAccount, LoanCharge, LoanTemplate } from '../loan.models';
import { LoanEditComponent } from './loan-edit.component';

/**
 * Behaviour of the loan edit screen — workflow "Loan edit" of the Agent Action Plan (AAP 0.7.3 row
 * "Loan edit"; AAP 0.7.4 "Loan screens follow the same shell and card pattern").
 *
 * What the suite drives is the component's public surface and the traffic it produces: the route's
 * `:id`, the seeded form, the signals the template reads, and the requests the real `LoanService`
 * sends through `HttpTestingController`. Nothing is asserted about styles, and nothing is mocked that
 * the screen depends on — the service, the shared fields and the translation pipe are the shipped
 * ones.
 *
 * Four properties are pinned, each one a defect the screen had:
 *
 *   - the load is one read — `GET /loans/{id}?template=true&associations=…`, the row AAP 0.7.3 declares
 *     for this screen — whose own `charges` member the save re-posts, so `PUT /loans/{id}` keeps the
 *     loan's charges instead of answering `{"changes":{"charges":[]}}` and deleting every charge, and
 *     no charge-list request is issued for any of it (Rule 1 clauses 2 and 3; AAP 0.7.3 "Loan edit";
 *     AAP 0.3.4: the running fork's contract decides);
 *   - a record the body cannot be built from renders a message and keeps the form and its values,
 *     rather than leaving Save a silent no-op with an unhandled rejection, and no body that would post
 *     an empty charge array over the loan's charges is ever sent (AAP 0.14.2);
 *   - every emission of `route.paramMap` re-reads the loan, so an in-place move from one edit URL to
 *     another cannot leave the previous loan's values on screen;
 *   - a read the route has since moved past is discarded when it answers, so the loan it names cannot
 *     be seeded under the loan the URL now carries.
 *
 * The two collaborations the screen cannot run without are supplied the way the application supplies
 * them: the resolved configuration is loaded from a stubbed `fetch` before the component exists (every
 * service URL is composed from it), the ngx-translate stack is registered, and the router is a spy
 * because what this screen owes the router is one navigation per successful save. The route is a stub
 * whose `paramMap` is a subject, so a case can move the URL the way the router does.
 *
 * The error mapping is the one production piece the TestBed supplies itself: `core/http` owns the
 * mapping of a Fineract failure to `ApiError`, and installing `toApiError` as an interceptor makes the
 * rejection the component catches the type it catches in the application (AAP 0.4.2).
 */

/** The configuration the stubbed transport serves: the application's own documented default shape. */
const SERVED_CONFIG = DEFAULT_APP_CONFIG;

/** The API root every loan URL is composed from, built from the resolved configuration. */
const API_ROOT = `${SERVED_CONFIG.apiBaseUrl}${SERVED_CONFIG.apiPath}`;

/** The loan the first route emission addresses, and the loan a second emission moves to. */
const LOAN_ID = '11';
const SECOND_LOAN_ID = '12';

/** Where the screen returns once a save lands. */
const RECORD_ROUTE = ['/viewloanaccount', LOAN_ID];

/** The associations the edit seed is read with, exactly as AAP 0.7.3's "Loan edit" row spells them. */
const EDIT_SEED_ASSOCIATIONS = 'charges,collateral,meeting,multiDisburseDetails';

/**
 * The legacy captions this screen resolves through the translation pipe. Only the ones a case below
 * could read are served: no case asserts a caption, so the remaining keys may fall back to the
 * missing-translation handler's humanised text without weakening any assertion.
 */
const TRANSLATIONS: Readonly<Record<string, string>> = {
  'label.heading.editloanapplication': 'Edit Loan Application',
  'label.input.principal': 'Principal',
  'label.requiredfield': 'Required field',
  'label.button.cancel': 'Cancel',
  'label.button.save': 'Save',
  'label.selectloanofficer': 'Select Loan Officer',
  'label.selectfund': 'Select Fund',
  'error.msg.resource.not.found': 'The requested resource is not available.',
};

/**
 * The application field set the edit body carries for the fixture loan, sorted, exactly as
 * {@link LoanEditComponent.buildRequest} assembles it from the sixteen controls plus the echoed
 * identifiers and the loan's charge set.
 *
 * Compared against `Object.keys(body).sort()`, so a member silently dropped from the body fails here
 * as loudly as one invented, which is the field-set half of AAP 0.7.2's `LoanApplicationRequest` row.
 */
const APPLICATION_FIELDS: readonly string[] = [
  'amortizationType',
  'charges',
  'clientId',
  'expectedDisbursementDate',
  'interestCalculationPeriodType',
  'interestRateFrequencyType',
  'interestRatePerPeriod',
  'interestType',
  'loanTermFrequency',
  'loanTermFrequencyType',
  'loanType',
  'numberOfRepayments',
  'principal',
  'productId',
  'repaymentEvery',
  'repaymentFrequencyType',
  'submittedOnDate',
  'transactionProcessingStrategyCode',
].sort();

/**
 * A body the loan read can answer with and the loan record's guard rejects: the shape
 * `GET /loans/{id}` returns for an id that names no loan of the client's, which is a `LoanTemplate`
 * and carries neither the record's `id` nor its `status` (AAP 0.7.4).
 */
const NON_LOAN_PAYLOAD: LoanTemplate = { productOptions: [] };

/**
 * Installs the production mapping of a Fineract failure onto the test transport, so a refusal arrives
 * as the `ApiError` the component catches in the application (AAP 0.4.2; workflow W7).
 */
const MAP_FINERACT_FAILURES: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((failure: HttpErrorResponse) => throwError(() => toApiError(failure))),
  );

/**
 * A transport whose save fails in a shape the Fineract mapper never produces — a bare string rather than
 * an `HttpErrorResponse` — which is the fault a screen still has to report rather than swallow. Reads
 * pass through, so the screen is seeded normally and only the save meets it.
 */
const UNMAPPED_SAVE_TRANSPORT: HttpInterceptorFn = (request, next) =>
  request.method === 'PUT' ? throwError(() => 'a transport fault') : next(request);

/**
 * One persisted enumeration id as the fork sends it: the `{id, code, value}` object the option lists
 * are built from, or the plain number a payload also answers with. Both name the same id, and the
 * screen has to seed either of them.
 */
type PersistedId = { readonly id: number } | number;

/**
 * The edit seed as `GET /loans/{id}?template=true&associations=…` answers it: the loan record plus the
 * loan form's own members, which `LoanAccount` does not declare and this screen reads through a
 * documented partial projection.
 *
 * The option lists are absent from the base seed: a payload that carries none is exactly what the
 * template renders as a static display of the persisted value rather than as an invented
 * enumeration, and the cases that need a picker add the list they are about.
 */
interface LoanEditSeed extends LoanAccount {
  /** The persisted term. Widened beyond `number` so a case can send the member in another shape. */
  readonly termFrequency: number | string;

  readonly termPeriodFrequencyType: PersistedId;
  readonly repaymentFrequencyType: PersistedId;
  readonly interestRateFrequencyType: PersistedId;
  readonly amortizationType: PersistedId;
  readonly interestType: PersistedId;
  readonly interestCalculationPeriodType: PersistedId;
  readonly transactionProcessingStrategyCode: string;
  readonly loanOfficerId?: PersistedId;
  readonly fundId?: PersistedId;

  /** `loanOfficerOptions` as the seed sends it: rows carrying `id` and a name member. */
  readonly loanOfficerOptions?: readonly Readonly<Record<string, unknown>>[];

  /** `fundOptions` as the seed sends it: rows carrying `id` and `value`. */
  readonly fundOptions?: readonly Readonly<Record<string, unknown>>[];

  /** `termFrequencyTypeOptions` — the term unit's picker rows, shaped `{id, value}`. */
  readonly termFrequencyTypeOptions?: readonly Readonly<Record<string, unknown>>[];

  /** `repaymentFrequencyTypeOptions` — the interval unit's picker rows. */
  readonly repaymentFrequencyTypeOptions?: readonly Readonly<Record<string, unknown>>[];

  /** `interestRateFrequencyTypeOptions` — the rate unit's picker rows. */
  readonly interestRateFrequencyTypeOptions?: readonly Readonly<Record<string, unknown>>[];

  /** `amortizationTypeOptions` — the amortisation method's picker rows. */
  readonly amortizationTypeOptions?: readonly Readonly<Record<string, unknown>>[];

  /** `interestTypeOptions` — the interest method's picker rows. */
  readonly interestTypeOptions?: readonly Readonly<Record<string, unknown>>[];

  /** `interestCalculationPeriodTypeOptions` — the calculation basis's picker rows. */
  readonly interestCalculationPeriodTypeOptions?: readonly Readonly<Record<string, unknown>>[];

  /** `transactionProcessingStrategyOptions` — the strategy's picker rows, keyed by `code`. */
  readonly transactionProcessingStrategyOptions?: readonly Readonly<Record<string, unknown>>[];
}

/** One charge the loan carries: its own id, the definition it applies, and a specified due date. */
const CHARGE: LoanCharge = {
  id: 12,
  chargeId: 3,
  name: 'Parity Fee',
  amount: 25,
  amountOrPercentage: 25,
  amountPaid: 0,
  amountWaived: 0,
  amountOutstanding: 25,
  chargeTimeType: { id: 2, value: 'Specified due date' },
  chargeCalculationType: { id: 1, value: 'Flat' },
  dueDate: [2026, 12, 24],
};

/** `CHARGE` as the save body must re-post it: the due date a `Date`, ready for the boundary. */
const CHARGE_ROW_WIRE: Readonly<Record<string, unknown>> = {
  id: CHARGE.id,
  chargeId: CHARGE.chargeId,
  amount: 25,
  dueDate: '24 December 2026',
};

/**
 * The seed's own `charges` member for the fixture loan: one charge, shaped exactly as the fork reports
 * it inside `GET /loans/{id}?template=true&associations=…`. That member is where the save body's rows
 * come from, and the row AAP 0.7.3's "Loan edit" declares for this screen is the whole read — no
 * charge-list request is issued (Rule 1 clauses 2 and 3).
 */
const LOAN_CHARGES: readonly LoanCharge[] = [CHARGE];

/**
 * The same charge without the definition id the body has to re-post. The cast is the one boundary this
 * fixture needs: the wire can answer a charge without `chargeId` although `LoanCharge` declares it,
 * and the case that uses this seed asserts what the screen does with such a row.
 */
const CHARGE_WITHOUT_DEFINITION: LoanCharge = {
  ...CHARGE,
  chargeId: undefined,
} as unknown as LoanCharge;

/** The charges a second route emission's loan carries, distinct from the first loan's set. */
const SECOND_CHARGES: readonly LoanCharge[] = [
  { ...CHARGE, id: 13, name: 'Second Parity Fee', amountOrPercentage: 40 },
];

/** The loan a first `#/editloanaccount/:id` URL addresses. */
const SEED: LoanEditSeed = {
  id: 11,
  accountNo: '000000011',
  clientId: 2,
  loanProductId: 1,
  principal: 5000,
  numberOfRepayments: 12,
  repaymentEvery: 1,
  interestRatePerPeriod: 12,
  status: {
    id: 100,
    code: 'loanStatusType.submitted.and.pending.approval',
    value: 'Submitted and pending approval',
  },
  timeline: { submittedOnDate: [2026, 11, 24], expectedDisbursementDate: [2026, 11, 24] },
  termFrequency: 12,
  termPeriodFrequencyType: { id: 2 },
  repaymentFrequencyType: { id: 2 },
  interestRateFrequencyType: { id: 3 },
  amortizationType: { id: 1 },
  interestType: { id: 0 },
  interestCalculationPeriodType: { id: 1 },
  transactionProcessingStrategyCode: 'mifos-standard-strategy',
  charges: LOAN_CHARGES,
};

/**
 * The seed for a loan that carries no charge: the fork leaves the `charges` member out entirely, and
 * the save must still post the empty array rather than leaving the member absent.
 */
const UNCHARGED_SEED: LoanEditSeed = { ...SEED, charges: undefined };

/** The loan a second emission addresses: different terms and charges, so a stale form cannot hide. */
const SECOND_SEED: LoanEditSeed = {
  ...SEED,
  id: 12,
  accountNo: '000000012',
  principal: 7000,
  numberOfRepayments: 6,
  termFrequency: 6,
  charges: SECOND_CHARGES,
};

/**
 * The first loan with every persisted enumeration and both optional ids in the `{id}` object form,
 * which is one of the two shapes the edit seed answers with.
 */
const OBJECT_ID_SEED: LoanEditSeed = {
  ...SEED,
  loanOfficerId: { id: 7 },
  fundId: { id: 2 },
};

/**
 * The same loan with those eight members as plain numbers — the other shape the fork answers with,
 * and the one the edit form used to drop, leaving every required select empty for a value the loan
 * already carries.
 */
const NUMERIC_ID_SEED: LoanEditSeed = {
  ...SEED,
  termPeriodFrequencyType: 2,
  repaymentFrequencyType: 2,
  interestRateFrequencyType: 3,
  amortizationType: 1,
  interestType: 0,
  interestCalculationPeriodType: 1,
  loanOfficerId: 7,
  fundId: 2,
};

/**
 * The same loan with the two pickers' own option lists, which is where the officer and fund rows come
 * from (Rule 1 clause 3: a dropdown's options are the template endpoint's, in its order).
 *
 * The officer rows use the two shapes the fork answers with — `displayName`, and a first and last name
 * when it sends none — and the fund rows the `{id, value}` shape the other option lists use, so the
 * case that renders them covers both readers.
 */
const PICKER_SEED: LoanEditSeed = {
  ...SEED,
  loanOfficerId: { id: 7 },
  fundId: { id: 2 },
  loanOfficerOptions: [
    { id: 7, displayName: 'Parity Officer' },
    { id: 9, firstname: 'Ada', lastname: 'Okafor' },
    // Two rows without what a picker row needs: no name at all, and no id. Neither may reach the
    // user as a blank or unaddressable row, so the case below asserts they are skipped.
    { id: 11 },
    { displayName: 'Ghost Officer' },
  ],
  fundOptions: [
    { id: 2, value: 'Parity Fund' },
    { id: 1, value: 'Head Office Fund' },
  ],
};

/**
 * The same loan with the seven enumeration pickers' option lists, which is where those dropdowns' rows
 * come from, and rows of a shape the reader cannot use.
 *
 * The malformed rows are the state that matters: a list carrying a row without a numeric id, or a
 * strategy without a name, must leave that row out rather than render it with a value nobody sent
 * (Rule 1 clause 3, "every option list comes from the template endpoint").
 */
const ENUMERATION_SEED: LoanEditSeed = {
  ...SEED,
  termFrequencyTypeOptions: [
    { id: 0, value: 'Days' },
    { id: 1, value: 'Weeks' },
    { id: 2, value: 'Months' },
    { id: 'two', value: 'Unusable row' },
  ],
  repaymentFrequencyTypeOptions: [
    { id: 0, value: 'Days' },
    { id: 1, value: 'Weeks' },
    { id: 2, value: 'Months' },
  ],
  interestRateFrequencyTypeOptions: [
    { id: 2, value: 'Per month' },
    { id: 3, value: 'Per year' },
  ],
  amortizationTypeOptions: [
    { id: 0, value: 'Equal principle payments' },
    { id: 1, value: 'Equal installments' },
  ],
  interestTypeOptions: [
    { id: 0, value: 'Declining Balance' },
    { id: 1, value: 'Flat' },
  ],
  interestCalculationPeriodTypeOptions: [
    { id: 0, value: 'Daily' },
    { id: 1, value: 'Same as repayment period' },
  ],
  transactionProcessingStrategyOptions: [
    { code: 'mifos-standard-strategy', name: 'Penalties, Fees, Interest, Principal order' },
    { code: 'early-repayment-strategy', name: 'Early Repayment Strategy' },
    { code: 'unusable-strategy' },
  ],
};

/**
 * The same loan with two members in a shape the screen cannot use: the term as text, and the strategy
 * as the empty string. Neither may become a number or a strategy nobody chose, so both controls stay
 * empty and the required-only gate keeps the save from being sent (Rule 1 clause 3).
 */
const MALFORMED_SEED: LoanEditSeed = {
  ...SEED,
  termFrequency: 'twelve',
  transactionProcessingStrategyCode: '',
};

/**
 * The same loan with a charge that carries no due date: a charge whose date the server computes is
 * re-posted without a `dueDate` member at all, exactly as legacy sent it.
 */
const UNDATED_CHARGE_SEED: LoanEditSeed = {
  ...SEED,
  charges: [{ ...CHARGE, dueDate: undefined }],
};

/**
 * The records the body cannot be built from, each with the message the screen must render for it.
 *
 * They differ only in which member is missing, so one case per seed is the same behaviour over two
 * inputs: a record the form can display but the request contract cannot describe, and a charge the
 * seed carries without the definition id the body must re-post (AAP 0.14.2).
 */
const LOCAL_FAULTS: readonly {
  readonly label: string;
  readonly seed: LoanEditSeed;
  readonly message: string;
}[] = [
  {
    label: 'a record without the product id the body must echo',
    seed: { ...SEED, loanProductId: undefined },
    message: 'The loan edit form has no productId value to post.',
  },
  {
    label: 'a charge row without the definition id the body must re-post',
    seed: { ...SEED, charges: [CHARGE_WITHOUT_DEFINITION] },
    message: 'The loaded loan carries a charge this form cannot re-post.',
  },
];

/** The URL of the loan's own endpoints, one route segment per id the URL addresses. */
function loanUrl(id: string): string {
  return `${API_ROOT}/loans/${id}`;
}

/** Matches the edit seed read of one loan, whatever query the screen sent with it. */
function isEditSeedRead(id: string): (request: TestRequest['request']) => boolean {
  return (request) => request.method === 'GET' && request.url === loanUrl(id);
}

/**
 * Matches the charge-list read `GET /loans/{id}/charges`, which this screen must never send: it is not
 * a row of AAP 0.7.3's endpoint table for the loan edit — that row is the seed read and the save — the
 * legacy edit never called it, and the app allowlist holds the path for the charge POSTs alone (Rule 1
 * clauses 2 and 3). The first case asserts its absence explicitly, and `httpMock.verify()` fails on it
 * in every case.
 */
function isChargeListRead(id: string): (request: TestRequest['request']) => boolean {
  return (request) => request.method === 'GET' && request.url === `${loanUrl(id)}/charges`;
}

/** Matches the one save this screen makes for a loan. */
function isEditSave(id: string): (request: TestRequest['request']) => boolean {
  return (request) => request.method === 'PUT' && request.url === loanUrl(id);
}

/** The members of a request body, so a case can read one of them without a cast at every use. */
function bodyOf(request: TestRequest['request']): Readonly<Record<string, unknown>> {
  // `HttpTestingController` types a request body as `unknown`, because a request can carry
  // anything. Narrowing it once here confines the cast to one line (Rule 1 clause 4).
  return request.body as Readonly<Record<string, unknown>>;
}

describe('LoanEditComponent', () => {
  let fixture: ComponentFixture<LoanEditComponent>;
  let component: LoanEditComponent;
  let httpMock: HttpTestingController;
  let navigate: Mock<(commands: readonly unknown[]) => Promise<boolean>>;
  let routeParams: BehaviorSubject<ParamMap>;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines the
  // cast to one line and keeps the DOM assertions type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The route stub's parameter map for the id a URL carries, or none for a route without one. */
  function paramsFor(id: string | null): ParamMap {
    const params: Record<string, string> = {};

    if (id !== null) {
      params['id'] = id;
    }

    return convertToParamMap(params);
  }

  /**
   * Registers the module and creates the screen, leaving the route's parameter stream to the caller so a
   * case can decide whether the route has emitted yet.
   *
   * The component's constructor subscribes to that stream and issues the edit seed read, so the pending
   * request is what each case answers with the payload it wants the form seeded from.
   *
   * @param paramMap the route parameters the screen subscribes to.
   */
  async function mount(
    paramMap: Observable<ParamMap>,
    interceptors: readonly HttpInterceptorFn[] = [MAP_FINERACT_FAILURES],
  ): Promise<void> {
    // Each case mounts the screen for its own URL, so the module is reset first: the route stub is the
    // one provider a case supplies, and a module left instantiated by the previous case cannot take a
    // new one.
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      imports: [LoanEditComponent],
      providers: [
        provideHttpClient(withInterceptors([...interceptors])),
        provideHttpClientTesting(),
        provideTranslateService(),
        { provide: Router, useValue: { navigate } },
        { provide: ActivatedRoute, useValue: { paramMap } },
      ],
    });

    await TestBed.inject(AppConfigService).load();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', TRANSLATIONS, true);
    translate.use('en');

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LoanEditComponent);
    component = fixture.componentInstance;
  }

  /**
   * Mounts the screen for one `#/editloanaccount/:id` URL. The subject backing the route is recreated
   * per case, so one case's emissions cannot reach the next.
   *
   * @param id the `:id` segment, or `null` for a route that carries none.
   * @param interceptors the transport the case runs over, defaulting to the production error mapping.
   */
  async function show(
    id: string | null = LOAN_ID,
    interceptors: readonly HttpInterceptorFn[] = [MAP_FINERACT_FAILURES],
  ): Promise<void> {
    routeParams = new BehaviorSubject<ParamMap>(paramsFor(id));
    await mount(routeParams.asObservable(), interceptors);
  }

  /**
   * Mounts the screen on a route that has not emitted yet, which is the state of an edit URL the router
   * is still resolving: no loan is known, so the screen may neither read nor save one.
   */
  async function showBeforeTheRouteEmits(): Promise<void> {
    await mount(new Subject<ParamMap>().asObservable());
  }

  /**
   * Answers the one read the screen makes — the edit seed, whose own `charges` member carries the
   * loan's charge set — and renders the seeded form.
   *
   * @param seed the `GET /loans/{id}?template=true&associations=…` payload, `charges` included.
   * @param id the loan the read addresses.
   */
  async function settle(seed: LoanEditSeed, id: string = LOAN_ID): Promise<void> {
    const pending = httpMock.match(isEditSeedRead(id));

    expect(pending).toHaveLength(1);
    pending[0].flush(seed);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => {
        // `Response` stand-in: the three members `AppConfigService.fetchRawConfig` reads. The cast is
        // the single boundary where the partial object becomes the response the service expects.
        const body = {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve(SERVED_CONFIG),
        };

        return Promise.resolve(body as unknown as Response);
      }),
    );

    navigate = vi.fn<(commands: readonly unknown[]) => Promise<boolean>>(() => Promise.resolve(true));
  });

  afterEach(() => {
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  it('reads the edit seed for the routed loan, and seeds every control and the charge set', async () => {
    await show();

    const read = httpMock.expectOne(isEditSeedRead(LOAN_ID));

    expect(read.request.method).toBe('GET');
    // The two query parameters AAP 0.7.3's "Loan edit" row names, in the order the service sets them.
    expect(read.request.params.get('template')).toBe('true');
    expect(read.request.params.get('associations')).toBe(EDIT_SEED_ASSOCIATIONS);

    read.flush(SEED);
    await fixture.whenStable();
    fixture.detectChanges();

    // The seed is the whole load: its own `charges` member is the loan's charge set, so no charge-list
    // request follows it (AAP 0.7.3 "Loan edit"; Rule 1 clauses 2 and 3).
    httpMock.expectNone(isChargeListRead(LOAN_ID));

    expect(component.controls.principal.value).toBe(5000);
    expect(component.controls.numberOfRepayments.value).toBe(12);
    // The date the payload held, read back as a local `Date`, never re-derived from the clock.
    expect(component.controls.expectedDisbursementDate.value).toEqual(new Date(2026, 10, 24));
    expect(component.charges()).toEqual(LOAN_CHARGES);
    expect(component.loading()).toBe(false);
    // One read is the whole load: nothing is saved until the user asks for it.
    httpMock.expectNone(isEditSave(LOAN_ID));
  });

  it.each<[string, LoanEditSeed]>([
    ['the {id} object form', OBJECT_ID_SEED],
    ['the plain number form', NUMERIC_ID_SEED],
  ])('seeds every persisted enumeration and both optional ids sent in %s', async (_label, seed) => {
    await show();
    await settle(seed);

    // The values the loan already carries, read back into the controls whichever shape the payload
    // used: a select left empty would make the user re-pick terms the server holds on a required
    // field (Rule 1 clause 3; AAP 0.7.2: the ids are the ones the payload returned).
    expect(component.controls.loanTermFrequencyType.value).toBe(2);
    expect(component.controls.repaymentFrequencyType.value).toBe(2);
    expect(component.controls.interestRateFrequencyType.value).toBe(3);
    expect(component.controls.amortizationType.value).toBe(1);
    expect(component.controls.interestType.value).toBe(0);
    expect(component.controls.interestCalculationPeriodType.value).toBe(1);
    expect(component.controls.loanOfficerId.value).toBe(7);
    expect(component.controls.fundId.value).toBe(2);
  });

  it('re-posts the loan’s charges in the save body and returns to the record', async () => {
    await show();
    await settle(SEED);

    const submission = component.submit();
    const save = httpMock.expectOne(isEditSave(LOAN_ID));

    expect(save.request.body).toMatchObject({
      clientId: 2,
      productId: 1,
      loanType: 'individual',
      principal: 5000,
      // The two members the service owns, taken from the resolved configuration rather than chosen
      // by this screen (AAP 0.7.2 "Date handling"; Rule 1 clause 2).
      dateFormat: SERVED_CONFIG.dateFormat,
      locale: SERVED_CONFIG.locale,
    });
    // `PUT /loans/{id}` treats the array as the loan's complete charge set, so the row keeps the
    // loan charge's own id and its definition's id, and its date reaches the wire formatted rather
    // than as an ISO string (AAP 0.7.2 "Date handling"; AAP 0.3.4; Rule 1 clause 2).
    expect(bodyOf(save.request)['charges']).toEqual([CHARGE_ROW_WIRE]);
    expect(bodyOf(save.request)).not.toHaveProperty('command');

    save.flush({ resourceId: 11 });
    await submission;
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(RECORD_ROUTE);
  });

  it('posts the empty charges array for a loan that carries none', async () => {
    await show();
    await settle(UNCHARGED_SEED);

    const submission = component.submit();
    const save = httpMock.expectOne(isEditSave(LOAN_ID));

    // The payload omitted the member, and the body still carries it: an absent one is what deletes
    // the charges, so "none" is the empty array and never a missing member (AAP 0.3.4; legacy posts
    // the array unconditionally).
    expect(component.charges()).toEqual([]);
    expect(bodyOf(save.request)['charges']).toEqual([]);

    save.flush({ resourceId: 11 });
    await submission;
  });

  for (const { label, seed, message } of LOCAL_FAULTS) {
    it(`renders a message for ${label} and keeps the form and its values`, async () => {
      await show();
      await settle(seed);

      await component.submit();
      fixture.detectChanges();

      // Nothing is sent, and the failure is a rendered message rather than a rejection nobody handles.
      httpMock.expectNone(isEditSave(LOAN_ID));
      expect(component.error()?.message).toBe(message);
      // Status 0 is the class's own marker for "no HTTP answer", which this fault is.
      expect(component.error()?.status).toBe(0);
      expect(host().querySelector('[role="alert"]')?.textContent?.trim()).toBe(message);
      // The form stays mounted with every value it was seeded with, so nothing has to be re-entered.
      expect(component.controls.principal.value).toBe(5000);
      expect(host().querySelector('#principal')).not.toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    });
  }

  it('re-reads the loan for each route emission and replaces the previous loan’s values and charges', async () => {
    await show();
    await settle(SEED);

    expect(component.controls.principal.value).toBe(5000);
    expect(component.charges()).toEqual(LOAN_CHARGES);

    // The router reuses this component when the URL moves to another edit route, so a second emission
    // is what an in-place move looks like.
    routeParams.next(paramsFor(SECOND_LOAN_ID));
    fixture.detectChanges();

    // The previous loan is gone before the new answer arrives: no stale form, no stale charge set, no
    // stale message.
    expect(component.loanId()).toBe(SECOND_LOAN_ID);
    expect(component.account()).toBeNull();
    expect(component.controls.principal.value).toBeNull();
    expect(component.charges()).toBeNull();
    expect(component.loading()).toBe(true);

    await settle(SECOND_SEED, SECOND_LOAN_ID);

    expect(component.controls.principal.value).toBe(7000);
    expect(component.controls.numberOfRepayments.value).toBe(6);
    // The charge set follows the record: a save now re-posts loan 12's rows, never loan 11's.
    expect(component.charges()).toEqual(SECOND_CHARGES);
    expect(component.loading()).toBe(false);
    // Each emission addresses its own loan, and the first was read once.
    httpMock.expectNone(isEditSeedRead(LOAN_ID));
    httpMock.expectNone(isEditSave(LOAN_ID));
  });

  it('ignores a superseded loan’s answer that arrives after the URL moved on', async () => {
    await show();

    // The first loan's read is held unanswered while the URL moves to the second loan, which is what a
    // move between two edit routes produces when the earlier response is the slower one.
    const superseded = httpMock.expectOne(isEditSeedRead(LOAN_ID));

    routeParams.next(paramsFor(SECOND_LOAN_ID));
    fixture.detectChanges();

    // The second read is the one the card is waiting on, and the outstanding first response has not
    // cleared that: `loading` belongs to the run the URL now names.
    expect(component.loading()).toBe(true);

    await settle(SECOND_SEED, SECOND_LOAN_ID);

    expect(component.controls.principal.value).toBe(7000);
    expect(component.loading()).toBe(false);

    // The earlier answer lands last. It must be dropped rather than applied, or loan 11's values would
    // appear under loan 12's URL — and Save would post them, its charge set included, to loan 12.
    superseded.flush(SEED);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.loanId()).toBe(SECOND_LOAN_ID);
    expect(component.account()?.id).toBe(SECOND_SEED.id);
    expect(component.controls.principal.value).toBe(7000);
    expect(component.controls.numberOfRepayments.value).toBe(6);
    expect(component.charges()).toEqual(SECOND_CHARGES);
    expect(component.loading()).toBe(false);
    expect(component.notFound()).toBe(false);
    expect(component.error()).toBeNull();
    expect(host().querySelector('#principal')).not.toBeNull();
    // Neither loan is saved, and the discarded answer issued no request of its own.
    httpMock.expectNone(isEditSave(LOAN_ID));
    httpMock.expectNone(isEditSave(SECOND_LOAN_ID));
  });

  it('renders the not-found message for a route that carries no id, with no request', async () => {
    await show(null);
    fixture.detectChanges();

    httpMock.expectNone(() => true);
    expect(component.notFound()).toBe(true);
    expect(host().textContent).toContain('The requested resource is not available.');
    expect(host().querySelector('form')).toBeNull();
  });

  it('renders the not-found message in place of the form when Fineract answers 404', async () => {
    await show();

    const read = httpMock.expectOne(isEditSeedRead(LOAN_ID));

    read.flush(
      { defaultUserMessage: 'The loan with id 11 does not exist.' },
      { status: 404, statusText: 'Not Found' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    // A missing loan is not an error to announce: the card states it once, in the record page's own
    // wording, and leaves the shell usable around it (AAP 0.7.4). No form and no input means nothing
    // can be typed or saved against a loan that is not there.
    expect(component.notFound()).toBe(true);
    expect(component.loading()).toBe(false);
    expect(component.error()).toBeNull();
    expect(host().textContent).toContain('The requested resource is not available.');
    expect(host().querySelector('form')).toBeNull();
    expect(host().querySelector('input')).toBeNull();
    httpMock.expectNone(isEditSave(LOAN_ID));
  });

  it('renders not found for a payload that is not a loan record', async () => {
    await show();

    // This fixture is the side of the model's guard the case depends on, asserted so a payload shaped
    // like a loan by mistake cannot make the case pass for the wrong reason.
    expect(isLoanAccount(NON_LOAN_PAYLOAD)).toBe(false);

    const read = httpMock.expectOne(isEditSeedRead(LOAN_ID));

    read.flush(NON_LOAN_PAYLOAD);
    await fixture.whenStable();
    fixture.detectChanges();

    // An id that names no loan of the client's must not produce an editable screen, whatever shape the
    // body arrived in (AAP 0.7.4).
    expect(component.notFound()).toBe(true);
    expect(component.account()).toBeNull();
    expect(host().querySelector('form')).toBeNull();
    httpMock.expectNone(isEditSave(LOAN_ID));
  });

  it('renders the officer and fund pickers from the seed’s own option lists, in the order it sent them', async () => {
    await show();

    // The fixture is the side of the guard this case needs: the seeded branch.
    expect(isLoanAccount(PICKER_SEED)).toBe(true);

    await settle(PICKER_SEED);

    // The rows are Fineract's, in the payload's order, and the ids the loan already carries are the
    // selected ones (Rule 1 clause 3: a dropdown's options and its default are the server's).
    const optionTexts = (inputId: string): readonly string[] =>
      Array.from(host().querySelectorAll<HTMLOptionElement>(`#${inputId} option`)).map(
        (option) => option.textContent?.trim() ?? '',
      );

    expect(optionTexts('loanOfficerId')).toEqual(['Select Loan Officer', 'Parity Officer', 'Ada Okafor']);
    expect(optionTexts('fundId')).toEqual(['Select Fund', 'Parity Fund', 'Head Office Fund']);
    expect(component.controls.loanOfficerId.value).toBe(7);
    expect(component.controls.fundId.value).toBe(2);
  });

  it('posts the application field set with the entered values and the configured date grammar (W4/W7 body)', async () => {
    await show();
    await settle(SEED);

    // The value the user types replaces the seeded one. 6,000 is a principal the product allows; the
    // out-of-range amount W7 turns on is the subject of the case below.
    component.controls.principal.setValue(6000);

    // The body this screen hands the service: exactly the application's field set, its two dates still
    // `Date` instances, and neither `dateFormat` nor `locale`, which the service writes at the
    // boundary (AAP 0.7.2 "Date handling"; AAP 0.14.1).
    const body = component.buildRequest();

    expect(Object.keys(body).sort()).toEqual(APPLICATION_FIELDS);
    expect(typeof body.principal).toBe('number');
    expect(body.principal).toBe(6000);
    expect(body.expectedDisbursementDate).toBeInstanceOf(Date);
    expect(body.submittedOnDate).toBeInstanceOf(Date);
    expect(body).not.toHaveProperty('dateFormat');
    expect(body).not.toHaveProperty('locale');

    const submission = component.submit();
    const save = httpMock.expectOne(isEditSave(LOAN_ID));
    const wire = bodyOf(save.request);

    // On the wire the same field set plus the two members the service owns, whose values are the
    // resolved configuration's — this screen names neither of them anywhere.
    expect(Object.keys(wire).sort()).toEqual([...APPLICATION_FIELDS, 'dateFormat', 'locale'].sort());
    expect(wire['principal']).toBe(6000);
    expect(wire['dateFormat']).toBe(SERVED_CONFIG.dateFormat);
    expect(wire['locale']).toBe(SERVED_CONFIG.locale);
    // Each date is the day the record held, in that pattern and locale rather than an ISO string.
    expect(wire['expectedDisbursementDate']).toBe('24 November 2026');
    expect(wire['submittedOnDate']).toBe('24 November 2026');

    save.flush({ resourceId: 11 });
    await submission;
  });

  it('places no minimum, maximum or pattern on the amounts Fineract alone judges (W7)', async () => {
    await show();
    await settle(SEED);

    // A principal above the product's maximum must reach the server, which is what rejects it: a bound
    // here would mask Fineract's own message and defeat workflow W7 (Rule 1 clause 3; AAP 0.7.2).
    component.controls.principal.setValue(50000);
    component.controls.numberOfRepayments.setValue(999);
    component.controls.interestRatePerPeriod.setValue(500);

    for (const control of [
      component.controls.principal,
      component.controls.numberOfRepayments,
      component.controls.interestRatePerPeriod,
    ]) {
      expect(control.errors).toBeNull();
      expect(control.hasError('max')).toBe(false);
      expect(control.hasError('min')).toBe(false);
    }

    // The rendered input carries no native bound either, so the browser cannot stop the value before
    // Fineract sees it.
    const principal = host().querySelector<HTMLInputElement>('#principal');

    expect(principal).not.toBeNull();
    expect(principal?.hasAttribute('min')).toBe(false);
    expect(principal?.hasAttribute('max')).toBe(false);
    expect(principal?.hasAttribute('pattern')).toBe(false);
    // Nothing but the legacy required set stands between the form and the request.
    expect(component.form.valid).toBe(true);
  });

  it('renders Fineract’s refusal verbatim above the form and keeps every entered value', async () => {
    const refusal = 'The principal is above the maximum allowed for this product.';

    await show();
    await settle(SEED);

    component.controls.principal.setValue(6000);

    const submission = component.submit();
    const save = httpMock.expectOne(isEditSave(LOAN_ID));

    save.flush(
      {
        defaultUserMessage: refusal,
        errors: [{ defaultUserMessage: refusal, parameterName: 'principal' }],
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await submission;
    fixture.detectChanges();

    // The server's own sentence, character for character, in the card's alert region (workflow W7).
    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(refusal);
    expect(component.error()?.message).toBe(refusal);
    expect(component.error()?.status).toBe(400);

    // Nothing has to be retyped: the form is still mounted with the value that was submitted.
    expect(component.controls.principal.value).toBe(6000);
    expect(host().querySelector<HTMLInputElement>('#principal')?.value).toBe('6000');
    expect(host().querySelector('form')).not.toBeNull();
    // One report, in the card: this screen renders no notification host of its own, so the failure is
    // never announced twice (AAP 0.14.2).
    expect(host().querySelector('app-notification')).toBeNull();
    // A refused save is not a success.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('sends one PUT per click and disables Save while the request is in flight', async () => {
    await show();
    await settle(SEED);

    const saveButton = (): HTMLButtonElement | null =>
      host().querySelector<HTMLButtonElement>('button.btn.btn-primary');

    expect(saveButton()?.disabled).toBe(false);

    const submission = component.submit();
    const save = httpMock.expectOne(isEditSave(LOAN_ID));

    fixture.detectChanges();

    // `PUT /loans/{id}` is not idempotent, so the trigger is disabled for as long as the save is
    // unanswered ...
    expect(saveButton()?.disabled).toBe(true);

    // ... and a second click is refused rather than queued: one click, one request (AAP 0.7.1,
    // "one request per click"; workflow W5's no-duplicates outcome).
    await component.submit();
    httpMock.expectNone(isEditSave(LOAN_ID));

    save.flush({ resourceId: 11 });
    await submission;
    fixture.detectChanges();

    // The trigger comes back once the answer lands, and the one accepted save navigated once.
    expect(saveButton()?.disabled).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(RECORD_ROUTE);
  });

  it('renders the seven enumeration pickers and the strategy picker from the seed’s own option lists', async () => {
    await show();
    await settle(ENUMERATION_SEED);

    const optionTexts = (inputId: string): readonly string[] =>
      Array.from(host().querySelectorAll<HTMLOptionElement>(`#${inputId} option`)).map(
        (option) => option.textContent?.trim() ?? '',
      );

    // Each list is Fineract's, in the order the seed sent it; the row that carries no usable id is left
    // out rather than rendered with a value nobody sent (Rule 1 clause 3).
    expect(optionTexts('loanTermFrequencyType')).toEqual(['Days', 'Weeks', 'Months']);
    expect(optionTexts('repaymentFrequencyType')).toEqual(['Days', 'Weeks', 'Months']);
    expect(optionTexts('interestRateFrequencyType')).toEqual(['Per month', 'Per year']);
    expect(optionTexts('amortizationType')).toEqual(['Equal principle payments', 'Equal installments']);
    expect(optionTexts('interestType')).toEqual(['Declining Balance', 'Flat']);
    expect(optionTexts('interestCalculationPeriodType')).toEqual(['Daily', 'Same as repayment period']);
    // The strategy picker is keyed by the code the body posts and shows the server's name for it.
    expect(optionTexts('transactionProcessingStrategyId')).toEqual([
      'Penalties, Fees, Interest, Principal order',
      'Early Repayment Strategy',
    ]);
    expect(component.controls.transactionProcessingStrategyId.value).toBe('mifos-standard-strategy');
    expect(component.form.valid).toBe(true);
  });

  it('posts the officer and the fund the record carries as the numbers the body takes', async () => {
    await show();
    await settle(PICKER_SEED);

    const submission = component.submit();
    const save = httpMock.expectOne(isEditSave(LOAN_ID));
    const wire = bodyOf(save.request);

    // Both are optional members: present because the loan carries them, and numbers because the pickers
    // are keyed by the id the template sent, never by a stringified copy (Rule 1 clause 2).
    expect(wire['loanOfficerId']).toBe(7);
    expect(wire['fundId']).toBe(2);
    expect(Object.keys(wire).sort()).toEqual(
      [...APPLICATION_FIELDS, 'loanOfficerId', 'fundId', 'dateFormat', 'locale'].sort(),
    );

    save.flush({ resourceId: 11 });
    await submission;
  });

  it('seeds no value for a member sent in another shape, and refuses to save it', async () => {
    await show();
    await settle(MALFORMED_SEED);

    // Neither the text term nor the empty strategy becomes a number or a choice nobody made.
    expect(component.controls.loanTermFrequency.value).toBeNull();
    expect(component.controls.transactionProcessingStrategyId.value).toBeNull();
    expect(component.form.invalid).toBe(true);

    await component.submit();
    fixture.detectChanges();

    // The legacy required set is the whole gate: nothing is sent, and the empty field is marked for the
    // user rather than the form being posted with a hole in it (Rule 1 clause 3).
    httpMock.expectNone(isEditSave(LOAN_ID));
    expect(component.controls.loanTermFrequency.touched).toBe(true);
    expect(host().querySelector('#loanTermFrequency-error')).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders a server failure above the form and leaves the screen usable', async () => {
    const message = 'The server could not read the loan.';

    await show();

    const read = httpMock.expectOne(isEditSeedRead(LOAN_ID));

    read.flush({ defaultUserMessage: message }, { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();

    // Not a missing loan: the message is the server's own, the not-found block is not shown, and the form
    // is still there for the user to work in (AAP 0.7.4).
    expect(component.notFound()).toBe(false);
    expect(component.loading()).toBe(false);
    expect(component.error()?.message).toBe(message);
    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(message);
    expect(host().querySelector('form')).not.toBeNull();
  });

  it('reads and saves nothing until the route says which loan it is', async () => {
    await showBeforeTheRouteEmits();
    fixture.detectChanges();

    // No id means no loan: the screen issues no read at all, and the card reports that it is still filling.
    httpMock.expectNone(() => true);
    expect(component.loanId()).toBeNull();
    expect(component.loading()).toBe(true);
    expect(host().querySelector('form')).not.toBeNull();

    // A body cannot be assembled from a record that never arrived, so the fault is reported rather than
    // posted as an empty application that would delete the loan's charges (AAP 0.3.4).
    expect(() => component.buildRequest()).toThrow('The loan edit form has no loaded loan to save.');

    await component.submit();
    httpMock.expectNone(isEditSave(LOAN_ID));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('discards a superseded read that fails instead of reporting it against the new loan', async () => {
    await show();

    const superseded = httpMock.expectOne(isEditSeedRead(LOAN_ID));

    routeParams.next(paramsFor(SECOND_LOAN_ID));
    fixture.detectChanges();

    await settle(SECOND_SEED, SECOND_LOAN_ID);

    // The earlier read fails after the URL moved on. Its failure belongs to a loan the screen no longer
    // shows, so it may not paint a message or a not-found state over the loan that is on screen.
    superseded.flush(
      { defaultUserMessage: 'The earlier read failed.' },
      { status: 500, statusText: 'Server Error' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.loanId()).toBe(SECOND_LOAN_ID);
    expect(component.error()).toBeNull();
    expect(component.notFound()).toBe(false);
    expect(component.controls.principal.value).toBe(7000);
    expect(host().querySelector('.alert.alert-danger')).toBeNull();
  });

  it('posts a charge the server dates without a dueDate member', async () => {
    await show();
    await settle(UNDATED_CHARGE_SEED);

    const submission = component.submit();
    const save = httpMock.expectOne(isEditSave(LOAN_ID));

    // The row keeps the loan charge's own id and its definition's; the date is absent because the charge
    // carries none, exactly as legacy sent it (Rule 1 clause 3).
    expect(bodyOf(save.request)['charges']).toEqual([
      { id: CHARGE.id, chargeId: CHARGE.chargeId, amount: CHARGE.amountOrPercentage },
    ]);

    save.flush({ resourceId: 11 });
    await submission;
  });

  it('renders a message for a failure the interceptor never mapped', async () => {
    await show(LOAN_ID, [UNMAPPED_SAVE_TRANSPORT, MAP_FINERACT_FAILURES]);
    await settle(SEED);

    await component.submit();
    fixture.detectChanges();

    // The rejection carries no server text, so the screen states the fixed sentence instead of ending in
    // a silent no-op: every failure path ends in a rendered message (AAP 0.14.2). Status 0 is the class's
    // own marker for "no HTTP answer".
    expect(component.error()?.message).toBe('The request could not be completed.');
    expect(component.error()?.status).toBe(0);
    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(
      'The request could not be completed.',
    );
    // The fault reached the screen, not the API, and the form is still there with its values.
    httpMock.expectNone(isEditSave(LOAN_ID));
    expect(host().querySelector<HTMLInputElement>('#principal')?.value).toBe('5000');
    expect(navigate).not.toHaveBeenCalled();
  });
});
