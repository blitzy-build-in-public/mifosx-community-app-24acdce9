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
import { Validators } from '@angular/forms';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, Subject, catchError, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DEFAULT_APP_CONFIG } from '../../../core/config/app-config.model';
import { AppConfigService } from '../../../core/config/app-config.service';
import { toApiError } from '../../../core/http/api-error';
import type { LoanAccount, LoanCharge } from '../loan.models';
import { LoanEditComponent } from './loan-edit.component';

/** The `#/editloanaccount/:id` screen (AAP 0.7.3 "Loan edit"; AAP 0.7.4): one seed read, whose own `charges` member the save re-posts so `PUT /loans/{id}` keeps the loan's charges instead of deleting them, and a record no body can be built from renders a message rather than a silent no-op (AAP 0.14.2). */

const SERVED_CONFIG = DEFAULT_APP_CONFIG;
const API_ROOT = `${SERVED_CONFIG.apiBaseUrl}${SERVED_CONFIG.apiPath}`;
const LOAN_ID = '11';
const SECOND_LOAN_ID = '12';
const RECORD_ROUTE = ['/viewloanaccount', LOAN_ID];
const EDIT_SEED_ASSOCIATIONS = 'charges,collateral,meeting,multiDisburseDetails';
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
const MAP_FINERACT_FAILURES: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((failure: HttpErrorResponse) => throwError(() => toApiError(failure))),
  );
const UNMAPPED_SAVE_TRANSPORT: HttpInterceptorFn = (request, next) =>
  request.method === 'PUT' ? throwError(() => 'a transport fault') : next(request);
type PersistedId = { readonly id: number } | number;
interface LoanEditSeed extends LoanAccount {
  /** The persisted term, widened beyond `number` so a case can send the member in another shape. */
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
  /** `fundOptions` as the seed sends it: rows carrying `id` and the label member — `name` as `OptionItem` declares it, or `value` in the enumeration shape. */
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
const CHARGE: LoanCharge = {
  id: 12,
  chargeId: 3,
  name: 'Parity Fee',
  amount: 25,
  amountOrPercentage: 25,
  amountPaid: 0,
  amountWaived: 0,
  amountOutstanding: 25,
  paid: false,
  waived: false,
  chargePayable: false,
  chargeTimeType: { id: 2, value: 'Specified due date' },
  chargeCalculationType: { id: 1, value: 'Flat' },
  dueDate: [2026, 12, 24],
};
const CHARGE_ROW_WIRE: Readonly<Record<string, unknown>> = {
  id: CHARGE.id,
  chargeId: CHARGE.chargeId,
  amount: 25,
  dueDate: '24 December 2026',
};
const LOAN_CHARGES: readonly LoanCharge[] = [CHARGE];
const CHARGE_WITHOUT_DEFINITION: LoanCharge = {
  ...CHARGE,
  chargeId: undefined,
} as unknown as LoanCharge;
const SECOND_CHARGES: readonly LoanCharge[] = [
  { ...CHARGE, id: 13, name: 'Second Parity Fee', amountOrPercentage: 40 },
];
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
const UNCHARGED_SEED: LoanEditSeed = { ...SEED, charges: undefined };
const SECOND_SEED: LoanEditSeed = {
  ...SEED,
  id: 12,
  accountNo: '000000012',
  principal: 7000,
  numberOfRepayments: 6,
  termFrequency: 6,
  charges: SECOND_CHARGES,
};
const OBJECT_ID_SEED: LoanEditSeed = {
  ...SEED,
  loanOfficerId: { id: 7 },
  fundId: { id: 2 },
};
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
const PICKER_SEED: LoanEditSeed = {
  ...SEED,
  loanOfficerId: { id: 7 },
  fundId: { id: 2 },
  loanOfficerOptions: [
    { id: 7, displayName: 'Parity Officer' },
    { id: 9, firstname: 'Ada', lastname: 'Okafor' },
    { id: 11 },
    { displayName: 'Ghost Officer' },
  ],
  fundOptions: [
    { id: 2, value: 'Parity Fund' },
    { id: 1, value: 'Head Office Fund' },
  ],
};
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
const MALFORMED_SEED: LoanEditSeed = {
  ...SEED,
  termFrequency: 'twelve',
  transactionProcessingStrategyCode: '',
};
const UNDATED_CHARGE_SEED: LoanEditSeed = {
  ...SEED,
  charges: [{ ...CHARGE, dueDate: undefined }],
};
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
function loanUrl(id: string): string {
  return `${API_ROOT}/loans/${id}`;
}
function isEditSeedRead(id: string): (request: TestRequest['request']) => boolean {
  return (request) => request.method === 'GET' && request.url === loanUrl(id);
}

// The charge-list read `GET /loans/{id}/charges` is never sent: AAP 0.7.3's "Loan edit" row is the seed read and the save, legacy never called it, and `httpMock.verify()` fails on it in every case.
function isChargeListRead(id: string): (request: TestRequest['request']) => boolean {
  return (request) => request.method === 'GET' && request.url === `${loanUrl(id)}/charges`;
}
function isEditSave(id: string): (request: TestRequest['request']) => boolean {
  return (request) => request.method === 'PUT' && request.url === loanUrl(id);
}
function bodyOf(request: TestRequest['request']): Readonly<Record<string, unknown>> {
  return request.body as Readonly<Record<string, unknown>>;
}

describe('LoanEditComponent', () => {
  let fixture: ComponentFixture<LoanEditComponent>;
  let component: LoanEditComponent;
  let httpMock: HttpTestingController;
  let navigate: Mock<(commands: readonly unknown[]) => Promise<boolean>>;
  let routeParams: BehaviorSubject<ParamMap>;
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  function paramsFor(id: string | null): ParamMap {
    const params: Record<string, string> = {};
    if (id !== null) {
      params['id'] = id;
    }
    return convertToParamMap(params);
  }
  async function mount(
    paramMap: Observable<ParamMap>,
    interceptors: readonly HttpInterceptorFn[] = [MAP_FINERACT_FAILURES],
  ): Promise<void> {
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
  async function show(
    id: string | null = LOAN_ID,
    interceptors: readonly HttpInterceptorFn[] = [MAP_FINERACT_FAILURES],
  ): Promise<void> {
    routeParams = new BehaviorSubject<ParamMap>(paramsFor(id));
    await mount(routeParams.asObservable(), interceptors);
  }
  async function showBeforeTheRouteEmits(): Promise<void> {
    await mount(new Subject<ParamMap>().asObservable());
  }
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
    expect(read.request.params.get('template')).toBe('true');
    expect(read.request.params.get('associations')).toBe(EDIT_SEED_ASSOCIATIONS);
    read.flush(SEED);
    await fixture.whenStable();
    fixture.detectChanges();
    httpMock.expectNone(isChargeListRead(LOAN_ID));
    expect(component.controls.principal.value).toBe(5000);
    expect(component.controls.numberOfRepayments.value).toBe(12);
    expect(component.controls.expectedDisbursementDate.value).toEqual(new Date(2026, 10, 24));
    expect(component.charges()).toEqual(LOAN_CHARGES);
    expect(component.loading()).toBe(false);
    httpMock.expectNone(isEditSave(LOAN_ID));
  });
  it.each<[string, LoanEditSeed]>([
    ['the {id} object form', OBJECT_ID_SEED],
    ['the plain number form', NUMERIC_ID_SEED],
  ])('seeds every persisted enumeration and both optional ids sent in %s', async (_label, seed) => {
    await show();
    await settle(seed);
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
      dateFormat: SERVED_CONFIG.dateFormat,
      locale: SERVED_CONFIG.locale,
    });
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

// A seed without a `charges` member still posts the empty array: an absent array is what deletes the loan's charges, which legacy never sent (AAP 0.3.4).
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
      httpMock.expectNone(isEditSave(LOAN_ID));
      expect(component.error()?.message).toBe(message);
      expect(component.error()?.status).toBe(0);
      expect(host().querySelector('[role="alert"]')?.textContent?.trim()).toBe(message);
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
    routeParams.next(paramsFor(SECOND_LOAN_ID));
    fixture.detectChanges();
    expect(component.loanId()).toBe(SECOND_LOAN_ID);
    expect(component.account()).toBeNull();
    expect(component.controls.principal.value).toBeNull();
    expect(component.charges()).toBeNull();
    expect(component.loading()).toBe(true);
    await settle(SECOND_SEED, SECOND_LOAN_ID);
    expect(component.controls.principal.value).toBe(7000);
    expect(component.controls.numberOfRepayments.value).toBe(6);
    expect(component.charges()).toEqual(SECOND_CHARGES);
    expect(component.loading()).toBe(false);
    httpMock.expectNone(isEditSeedRead(LOAN_ID));
    httpMock.expectNone(isEditSave(LOAN_ID));
  });
  it('ignores a superseded loan’s answer that arrives after the URL moved on', async () => {
    await show();
    const superseded = httpMock.expectOne(isEditSeedRead(LOAN_ID));
    routeParams.next(paramsFor(SECOND_LOAN_ID));
    fixture.detectChanges();
    expect(component.loading()).toBe(true);
    await settle(SECOND_SEED, SECOND_LOAN_ID);
    expect(component.controls.principal.value).toBe(7000);
    expect(component.loading()).toBe(false);
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
    expect(component.notFound()).toBe(true);
    expect(component.loading()).toBe(false);
    expect(component.error()).toBeNull();
    expect(host().textContent).toContain('The requested resource is not available.');
    expect(host().querySelector('form')).toBeNull();
    expect(host().querySelector('input')).toBeNull();
    httpMock.expectNone(isEditSave(LOAN_ID));
  });
  it('renders the officer and fund pickers from the seed’s own option lists, in the order it sent them', async () => {
    await show();
    await settle(PICKER_SEED);
    const optionTexts = (inputId: string): readonly string[] =>
      Array.from(host().querySelectorAll<HTMLOptionElement>(`#${inputId} option`)).map(
        (option) => option.textContent?.trim() ?? '',
      );
    expect(optionTexts('loanOfficerId')).toEqual(['Select Loan Officer', 'Parity Officer', 'Ada Okafor']);
    expect(optionTexts('fundId')).toEqual(['Select Fund', 'Parity Fund', 'Head Office Fund']);
    expect(component.controls.loanOfficerId.value).toBe(7);
    expect(component.controls.fundId.value).toBe(2);
  });
  it('labels a fund row by the name member the model declares, and still reads the value-shaped row', async () => {
    await show();
    await settle({
      ...PICKER_SEED,
      fundId: { id: 4 },
      fundOptions: [
        { id: 4, name: 'Named Fund' },
        { id: 1, value: 'Head Office Fund' },
        { id: 'five', name: 'Unusable row' },
        { id: 6 },
      ],
    });
    const optionTexts = Array.from(host().querySelectorAll<HTMLOptionElement>('#fundId option')).map(
      (option) => option.textContent?.trim() ?? '',
    );
    expect(optionTexts).toEqual(['Select Fund', 'Named Fund', 'Head Office Fund']);
    expect(component.controls.fundId.value).toBe(4);
  });
  it('posts the application field set with the entered values and the configured date grammar (W4/W7 body)', async () => {
    await show();
    await settle(SEED);
    component.controls.principal.setValue(6000);
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
    expect(Object.keys(wire).sort()).toEqual([...APPLICATION_FIELDS, 'dateFormat', 'locale'].sort());
    expect(wire['principal']).toBe(6000);
    expect(wire['dateFormat']).toBe(SERVED_CONFIG.dateFormat);
    expect(wire['locale']).toBe(SERVED_CONFIG.locale);
    expect(wire['expectedDisbursementDate']).toBe('24 November 2026');
    expect(wire['submittedOnDate']).toBe('24 November 2026');
    save.flush({ resourceId: 11 });
    await submission;
  });
  it('places no minimum, maximum or pattern on the amounts Fineract alone judges (W7)', async () => {
    await show();
    await settle(SEED);

// A principal above the product's maximum must reach the server, whose own refusal is W7's subject: a bound here would mask Fineract's message (Rule 1 clause 3).
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
    const principal = host().querySelector<HTMLInputElement>('#principal');
    expect(principal).not.toBeNull();
    expect(principal?.hasAttribute('min')).toBe(false);
    expect(principal?.hasAttribute('max')).toBe(false);
    expect(principal?.hasAttribute('pattern')).toBe(false);
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
    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(refusal);
    expect(component.error()?.message).toBe(refusal);
    expect(component.error()?.status).toBe(400);
    expect(component.controls.principal.value).toBe(6000);
    expect(host().querySelector<HTMLInputElement>('#principal')?.value).toBe('6000');
    expect(host().querySelector('form')).not.toBeNull();
    expect(host().querySelector('app-notification')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('leaves a 5xx save to the interceptor’s own notification and keeps every entered value', async () => {
    await show();
    await settle(SEED);
    component.controls.principal.setValue(6000);
    const submission = component.submit();
    const save = httpMock.expectOne(isEditSave(LOAN_ID));
    save.flush(
      { defaultUserMessage: 'The server could not save the loan.' },
      { status: 500, statusText: 'Server Error' },
    );
    await submission;
    fixture.detectChanges();

    // One failure, one report: the interceptor notifies a 5xx, so the card paints no second copy of it and the entered values stay in the form (AAP 0.7.4; AAP 0.14.2).
    expect(component.error()).toBeNull();
    expect(host().querySelector('.alert.alert-danger')).toBeNull();
    expect(component.controls.principal.value).toBe(6000);
    expect(host().querySelector<HTMLInputElement>('#principal')?.value).toBe('6000');
    expect(host().querySelector('form')).not.toBeNull();
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
    expect(saveButton()?.disabled).toBe(true);
    await component.submit();
    httpMock.expectNone(isEditSave(LOAN_ID));
    save.flush({ resourceId: 11 });
    await submission;
    fixture.detectChanges();
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
    expect(optionTexts('loanTermFrequencyType')).toEqual(['Days', 'Weeks', 'Months']);
    expect(optionTexts('repaymentFrequencyType')).toEqual(['Days', 'Weeks', 'Months']);
    expect(optionTexts('interestRateFrequencyType')).toEqual(['Per month', 'Per year']);
    expect(optionTexts('amortizationType')).toEqual(['Equal principle payments', 'Equal installments']);
    expect(optionTexts('interestType')).toEqual(['Declining Balance', 'Flat']);
    expect(optionTexts('interestCalculationPeriodType')).toEqual(['Daily', 'Same as repayment period']);
    expect(optionTexts('transactionProcessingStrategyId')).toEqual([
      'Penalties, Fees, Interest, Principal order',
      'Early Repayment Strategy',
    ]);
    expect(component.controls.transactionProcessingStrategyId.value).toBe('mifos-standard-strategy');
    expect(component.form.valid).toBe(true);
  });
  it('renders each enumeration picker, with no static fallback, when the payload sent no option list', async () => {
    await show();
    await settle(SEED);
    const pickers: readonly string[] = [
      'loanTermFrequencyType',
      'repaymentFrequencyType',
      'interestRateFrequencyType',
      'amortizationType',
      'interestType',
      'interestCalculationPeriodType',
      'transactionProcessingStrategyId',
    ];
    for (const inputId of pickers) {
      const picker = host().querySelector<HTMLSelectElement>(`#${inputId}`);

      // An empty list is an honest empty select rather than a hidden field: the control keeps the `required` validator asserted below, legacy's own rule with nothing added (Rule 1 clause 3), so a payload that omits a list must still leave the field on screen.
      expect(picker, `${inputId} picker`).not.toBeNull();
      expect(picker?.options.length, `${inputId} options`).toBe(0);
      expect(host().querySelector(`label[for="${inputId}"]`), `${inputId} label`).not.toBeNull();
    }
    expect(host().querySelector('.form-control-static')).toBeNull();
    for (const control of [
      component.controls.loanTermFrequencyType,
      component.controls.repaymentFrequencyType,
      component.controls.interestRateFrequencyType,
      component.controls.amortizationType,
      component.controls.interestType,
      component.controls.interestCalculationPeriodType,
      component.controls.transactionProcessingStrategyId,
    ]) {
      expect(control.hasValidator(Validators.required)).toBe(true);
    }
  });
  it('posts the officer and the fund the record carries as the numbers the body takes', async () => {
    await show();
    await settle(PICKER_SEED);
    const submission = component.submit();
    const save = httpMock.expectOne(isEditSave(LOAN_ID));
    const wire = bodyOf(save.request);
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
    expect(component.controls.loanTermFrequency.value).toBeNull();
    expect(component.controls.transactionProcessingStrategyId.value).toBeNull();
    expect(component.form.invalid).toBe(true);
    await component.submit();
    fixture.detectChanges();
    httpMock.expectNone(isEditSave(LOAN_ID));
    expect(component.controls.loanTermFrequency.touched).toBe(true);
    expect(host().querySelector('#loanTermFrequency-error')).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('leaves a 5xx seed read to the interceptor’s own notification, with no banner and the screen usable', async () => {
    await show();
    const read = httpMock.expectOne(isEditSeedRead(LOAN_ID));
    read.flush(
      { defaultUserMessage: 'The server could not read the loan.' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.notFound()).toBe(false);
    expect(component.loading()).toBe(false);

    // A 5xx is the interceptor's one notification, so the screen paints no banner of its own and keeps the form mounted: the same failure is never reported twice (AAP 0.7.4 "5xx or network failures raise a notification without unmounting the form"; AAP 0.14.2).
    expect(component.error()).toBeNull();
    expect(host().querySelector('.alert.alert-danger')).toBeNull();
    expect(host().querySelector('form')).not.toBeNull();
  });
  it('renders Fineract’s own message for a 4xx seed read, verbatim and above the form', async () => {
    const refusal = 'The loan product is closed for new applications.';
    await show();
    const read = httpMock.expectOne(isEditSeedRead(LOAN_ID));
    read.flush(
      { errors: [{ defaultUserMessage: refusal, parameterName: 'productId' }] },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.notFound()).toBe(false);
    expect(component.loading()).toBe(false);

    // Any other 4xx is the server's own message, rendered where the user can read it (AAP 0.7.4 "any other 4xx keeps the screen usable and shows Fineract's own message").
    expect(component.error()?.message).toBe(refusal);
    expect(component.error()?.status).toBe(400);
    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(refusal);
    expect(host().querySelector('form')).not.toBeNull();
  });
  it('reads and saves nothing until the route says which loan it is', async () => {
    await showBeforeTheRouteEmits();
    fixture.detectChanges();
    httpMock.expectNone(() => true);
    expect(component.loanId()).toBeNull();
    expect(component.loading()).toBe(true);
    expect(host().querySelector('form')).not.toBeNull();
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
    expect(component.error()?.message).toBe('The request could not be completed.');
    expect(component.error()?.status).toBe(0);
    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(
      'The request could not be completed.',
    );
    httpMock.expectNone(isEditSave(LOAN_ID));
    expect(host().querySelector<HTMLInputElement>('#principal')?.value).toBe('5000');
    expect(navigate).not.toHaveBeenCalled();
  });
});
