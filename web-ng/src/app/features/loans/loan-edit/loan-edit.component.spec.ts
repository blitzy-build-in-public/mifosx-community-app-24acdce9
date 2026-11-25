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
import { inject } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, catchError, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { DEFAULT_APP_CONFIG } from '../../../core/config/app-config.model';
import { AppConfigService } from '../../../core/config/app-config.service';
import { APP_CONFIG } from '../../../core/config/app-config.token';
import { toApiError } from '../../../core/http/api-error';
import type { LoanAccount, LoanCharge } from '../loan.models';
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
  'error.msg.resource.not.found': 'The requested resource is not available.',
};

/**
 * Installs the production mapping of a Fineract failure onto the test transport, so a refusal arrives
 * as the `ApiError` the component catches in the application (AAP 0.4.2; workflow W7).
 */
const MAP_FINERACT_FAILURES: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((failure: HttpErrorResponse) => throwError(() => toApiError(failure))),
  );

/**
 * The edit seed as `GET /loans/{id}?template=true&associations=…` answers it: the loan record plus the
 * loan form's own members, which `LoanAccount` does not declare and this screen reads through a
 * documented partial projection.
 *
 * The option lists are deliberately absent: no case below picks from one of those pickers, and a
 * payload that carries no list is exactly what the template renders as a static display of the
 * persisted value rather than as an invented enumeration.
 */
interface LoanEditSeed extends LoanAccount {
  readonly termFrequency: number;
  readonly termPeriodFrequencyType: { readonly id: number };
  readonly repaymentFrequencyType: { readonly id: number };
  readonly interestRateFrequencyType: { readonly id: number };
  readonly amortizationType: { readonly id: number };
  readonly interestType: { readonly id: number };
  readonly interestCalculationPeriodType: { readonly id: number };
  readonly transactionProcessingStrategyCode: string;
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
   * Mounts the screen for one `#/editloanaccount/:id` URL.
   *
   * The component's constructor subscribes to the route's parameters and issues the edit seed read, so
   * the pending request is what each case answers with the payload it wants the form seeded from. The
   * subject backing the route is recreated per case, so one case's emissions cannot reach the next.
   *
   * @param id the `:id` segment, or `null` for a route that carries none.
   */
  async function show(id: string | null = LOAN_ID): Promise<void> {
    // Each case mounts the screen for its own URL, so the module is reset first: the route stub is the
    // one provider a case supplies, and a module left instantiated by the previous case cannot take a
    // new one.
    TestBed.resetTestingModule();
    routeParams = new BehaviorSubject<ParamMap>(paramsFor(id));

    TestBed.configureTestingModule({
      imports: [LoanEditComponent],
      providers: [
        provideHttpClient(withInterceptors([MAP_FINERACT_FAILURES])),
        provideHttpClientTesting(),
        provideTranslateService(),
        // The application registers this token in `app.config.ts`, which the final boundary delivers.
        // The factory mirrors that registration — the resolved configuration of the service the
        // stubbed `fetch` has just answered — so the screen reads the same value it reads in the app.
        { provide: APP_CONFIG, useFactory: () => inject(AppConfigService).config },
        { provide: Router, useValue: { navigate } },
        { provide: ActivatedRoute, useValue: { paramMap: routeParams.asObservable() } },
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
      dateFormat: 'dd MMMM yyyy',
      locale: 'en',
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
});
