import { computed, signal, type Signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
  type ParamMap,
} from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { ApiError } from '../../../core/http/api-error';
import type {
  ChargeTemplate,
  LoanChargeOption,
  LoanTemplate,
  RepaymentPeriod,
  RepaymentSchedule,
} from '../loan.models';
import { LoanService } from '../loan.service';
import { LoanNewComponent } from './loan-new.component';

/** Behaviour of the new-application screen `#/newclientloanaccount/:clientId` — workflow W4 (AAP 0.7.3 "W4 loan application"; AAP 0.7.4; AAP 0.10.1): the template read once per routed client with its lists untouched, a segment naming no client reading nothing, the preview and the submission posting one body, and no client-side principal bound (W7; Rule 1 clause 3). */

const CLIENT_ID = 2;
const SECOND_CLIENT_ID = 12;
const PRODUCTS: LoanTemplate['productOptions'] = [
  { id: 3, name: 'Parity Loan' },
  { id: 1, name: 'Ancillary Loan' },
];
const PRODUCT_NAMES: readonly string[] = PRODUCTS.map((product) => product.name);
const TEMPLATE: LoanTemplate = {
  clientId: CLIENT_ID,
  clientName: 'Ada Okafor',
  product: PRODUCTS[0],
  productId: PRODUCTS[0].id,
  productOptions: PRODUCTS,
  principal: 5000,
  termFrequency: 12,
  termPeriodFrequencyType: {
    id: 2,
    code: 'repaymentFrequency.periodFrequencyType.months',
    value: 'Months',
  },
  termFrequencyTypeOptions: [
    { id: 0, code: 'loanTermFrequency.periodFrequencyType.days', value: 'Days' },
    { id: 2, code: 'loanTermFrequency.periodFrequencyType.months', value: 'Months' },
  ],
  numberOfRepayments: 12,
  repaymentEvery: 1,
  repaymentFrequencyType: {
    id: 2,
    code: 'repaymentFrequency.periodFrequencyType.months',
    value: 'Months',
  },
  repaymentFrequencyTypeOptions: [
    { id: 1, code: 'repaymentFrequency.periodFrequencyType.weeks', value: 'Weeks' },
    { id: 2, code: 'repaymentFrequency.periodFrequencyType.months', value: 'Months' },
  ],
  interestRatePerPeriod: 2.5,
  interestRateFrequencyType: {
    id: 3,
    code: 'interestRateFrequency.periodFrequencyType.years',
    value: 'Per year',
  },
  interestRateFrequencyTypeOptions: [
    { id: 3, code: 'interestRateFrequency.periodFrequencyType.years', value: 'Per year' },
    { id: 2, code: 'interestRateFrequency.periodFrequencyType.months', value: 'Per month' },
  ],
  amortizationType: { id: 1, code: 'amortizationType.equal.installments', value: 'Equal installments' },
  amortizationTypeOptions: [
    { id: 1, code: 'amortizationType.equal.installments', value: 'Equal installments' },
    { id: 0, code: 'amortizationType.equal.principal', value: 'Equal principal payments' },
  ],
  interestType: { id: 0, code: 'interestType.declining.balance', value: 'Declining Balance' },
  interestTypeOptions: [
    { id: 0, code: 'interestType.declining.balance', value: 'Declining Balance' },
    { id: 1, code: 'interestType.flat', value: 'Flat' },
  ],
  interestCalculationPeriodType: {
    id: 1,
    code: 'interestCalculationPeriodType.same.as.repayment.period',
    value: 'Same as repayment period',
  },
  interestCalculationPeriodTypeOptions: [
    { id: 0, code: 'interestCalculationPeriodType.daily', value: 'Daily' },
    {
      id: 1,
      code: 'interestCalculationPeriodType.same.as.repayment.period',
      value: 'Same as repayment period',
    },
  ],
  transactionProcessingStrategyCode: 'mifos-standard-strategy',
  transactionProcessingStrategyOptions: [
    { code: 'mifos-standard-strategy', name: 'Mifos standard strategy' },
    { code: 'early-repayment-strategy', name: 'Early repayment strategy' },
  ],
  loanOfficerOptions: [{ id: 7, displayName: 'Officer, Parity' }],
  fundOptions: [{ id: 2, name: 'Fund' }],
  charges: [],
};
const SECOND_TEMPLATE: LoanTemplate = {
  ...TEMPLATE,
  clientId: SECOND_CLIENT_ID,
  clientName: 'Marcus Rowe-Bennett',
  product: { id: 1, name: 'Ancillary Loan' },
  productOptions: [
    { id: 1, name: 'Ancillary Loan' },
    { id: 3, name: 'Parity Loan' },
  ],
  principal: 7000,
};
const CHARGES: readonly LoanChargeOption[] = [
  { id: 3, name: 'Parity Fee', amount: 40, chargeTimeType: { id: 2, value: 'Specified due date' } },
  { id: 4, name: 'Service Fee', amount: 10, chargeTimeType: { id: 1, value: 'Disbursement' } },
];
const PICKED_CHARGE_ID = 3;
const DISBURSEMENT_CHARGE_ID = 4;
// The due date the applicant supplies for a charge that falls due on a specified date; only its `Date` identity matters, because the service formats it at the boundary (AAP 0.7.2 row `LoanChargeRequest`).
const CHARGE_DUE_DATE = new Date(2026, 11, 24);
const CHARGE_TEMPLATE: ChargeTemplate = { amount: 25 };

// Workflow W7's principal: above the `Parity Loan` product's 10,000 maximum, so only Fineract can refuse it — no bound of this screen's, whose absence W7 exists to prove (Rule 1 clause 3).
const PRINCIPAL_ABOVE_PRODUCT_MAX = 50_000;
const SERVER_MESSAGE = 'The principal amount must be between 1,000 and 10,000.00 (inclusive).';
// Local midnight of the browser's current date: the one clock a form's default dates come from, so a template that carries its own date members is ignored (AAP 0.10.5 item 15; AAP 0.12).
function localToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
function scheduledPeriod(period: number): RepaymentPeriod {
  return {
    period,
    fromDate: [2026, 11, 24],
    dueDate: [2026, 12, 24],
    principalDue: 416.67,
    principalOriginalDue: 416.67,
    interestDue: 50,
    feeChargesDue: 0,
    penaltyChargesDue: 0,
    totalDueForPeriod: 466.67,
    totalOriginalDueForPeriod: 466.67,
    complete: false,
  };
}
const SCHEDULE: RepaymentSchedule = {
  periods: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(scheduledPeriod),
  totalPrincipalDisbursed: 5000,
  totalRepaymentExpected: 5600,
  totalOutstanding: 5600,
};
const INVALID_CLIENT_ID_SEGMENTS: [string, string | null][] = [
  ['a non-numeric segment', 'abc'],
  ['a fractional segment', '2.5'],
  ['an absent parameter', null],
];
interface LoanServiceStub {
  readonly template: Mock<LoanService['template']>;
  readonly chargeTemplate: Mock<LoanService['chargeTemplate']>;
  readonly previewSchedule: Mock<LoanService['previewSchedule']>;
  readonly create: Mock<LoanService['create']>;
}
interface TranslateStub {
  readonly currentLang: Signal<string>;
  instant(key: string): string;
  translate(key: string): Signal<string>;
  readonly onLangChange: Observable<unknown>;
  readonly onTranslationChange: Observable<unknown>;
}
function translateStub(): TranslateStub {
  return {
    currentLang: signal('en').asReadonly(),
    instant: (key: string): string => key,
    translate: (key: string): Signal<string> => computed(() => key),
    onLangChange: new Observable<never>(),
    onTranslationChange: new Observable<never>(),
  };
}
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

describe('LoanNewComponent', () => {
  let fixture: ComponentFixture<LoanNewComponent>;
  let component: LoanNewComponent;
  let loanService: LoanServiceStub;
  let navigate: MockInstance<Router['navigate']>;
  let routeParams: BehaviorSubject<ParamMap>;
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  function paramsFor(clientId: string | null): ParamMap {
    const params: Record<string, string> = {};
    if (clientId !== null) {
      params['clientId'] = clientId;
    }
    return convertToParamMap(params);
  }
  function renderedText(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ').trim();
  }
  function cancelHref(): string | null {
    return host().querySelector('a.btn-default')?.getAttribute('href') ?? null;
  }
  function optionLabels(selector: string): readonly string[] {
    const select = host().querySelector(selector);
    return select === null
      ? []
      : Array.from(select.querySelectorAll('option')).map((option) => (option.textContent ?? '').trim());
  }
  function triggers(): readonly HTMLButtonElement[] {
    return Array.from(host().querySelectorAll<HTMLButtonElement>('form button.btn-primary'));
  }
  async function settle(): Promise<void> {
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  async function show(segment: string | null): Promise<void> {
    routeParams.next(paramsFor(segment));
    fixture = TestBed.createComponent(LoanNewComponent);
    component = fixture.componentInstance;
    await settle();
  }
  async function navigateTo(segment: string): Promise<void> {
    routeParams.next(paramsFor(segment));
    await settle();
  }
  beforeEach(() => {
    loanService = {
      template: vi.fn(),
      chargeTemplate: vi.fn(),
      previewSchedule: vi.fn(),
      create: vi.fn(),
    };
    loanService.template.mockReturnValue(of(TEMPLATE));
    loanService.create.mockReturnValue(of({ resourceId: 41 }));
    routeParams = new BehaviorSubject<ParamMap>(paramsFor(null));
    TestBed.configureTestingModule({
      imports: [LoanNewComponent],
      providers: [
        provideRouter([]),
        { provide: LoanService, useValue: loanService },
        { provide: ActivatedRoute, useValue: { paramMap: routeParams.asObservable() } },
        { provide: TranslateService, useValue: translateStub() },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });
  it('reads the template once for the routed client and seeds the form from its payload', async () => {
    await show(String(CLIENT_ID));
    expect(loanService.template.mock.calls).toEqual([[CLIENT_ID, undefined]]);
    expect(component.clientId()).toBe(String(CLIENT_ID));
    expect(component.notFound()).toBe(false);
    expect(component.loading()).toBe(false);
    expect(component.productOptions().map((option) => option.name)).toEqual(PRODUCT_NAMES);
    expect(component.form.controls.principal.value).toBe(TEMPLATE.principal);
    expect(component.form.controls.numberOfRepayments.value).toBe(TEMPLATE.numberOfRepayments);
    expect(component.form.controls.repaymentEvery.value).toBe(TEMPLATE.repaymentEvery);
    expect(component.form.controls.interestRatePerPeriod.value).toBe(TEMPLATE.interestRatePerPeriod);
    expect(component.form.controls.expectedDisbursementDate.value).toEqual(localToday());
    expect(component.form.controls.submittedOnDate.value).toEqual(localToday());
    expect(cancelHref()).toBe(`/viewclient/${CLIENT_ID}`);
    expect(loanService.create).not.toHaveBeenCalled();
  });
  it('defaults both dates from the browser clock and ignores the template’s own date members', async () => {
    loanService.template.mockReturnValue(
      of({ ...TEMPLATE, expectedDisbursementDate: '2026-11-24', submittedOnDate: '2026-11-20' }),
    );
    await show(String(CLIENT_ID));
// A form's default dates (disbursement and submission among them) come from the browser clock exactly as legacy's do, and the application never reads the tenant's business date — deliberately the harness's alone (AAP 0.10.5 item 15; AAP 0.12). The template's members would put the pair on two different clocks, so neither is seeded from it.
    expect(component.form.controls.expectedDisbursementDate.value).toEqual(localToday());
    expect(component.form.controls.submittedOnDate.value).toEqual(localToday());
    expect(component.form.controls.submittedOnDate.value).toEqual(
      component.form.controls.expectedDisbursementDate.value,
    );
  });
  it('seeds a picked charge’s amount from the charge template’s own top-level amount', async () => {
    loanService.template.mockReturnValue(of({ ...TEMPLATE, chargeOptions: CHARGES }));
    loanService.chargeTemplate.mockReturnValue(of(CHARGE_TEMPLATE));
    await show(String(CLIENT_ID));
    component.addCharge();
    component.onChargeSelect(0, PICKED_CHARGE_ID);
    await settle();
    expect(loanService.chargeTemplate.mock.calls).toEqual([[PICKED_CHARGE_ID]]);
    expect(component.chargeRows.at(0).controls.chargeId.value).toBe(PICKED_CHARGE_ID);
// The charge's own `GET /charges/{id}?template=true` amount is the authority for its row, not the figure `GET /loans/template` publishes for the same charge.
    expect(component.chargeRows.at(0).controls.amount.value).toBe(CHARGE_TEMPLATE.amount);
    expect(component.error()).toBeNull();
  });
  it('reveals the due-date field of a charge that falls due on a specified date and posts the date with it', async () => {
    loanService.template.mockReturnValue(of({ ...TEMPLATE, chargeOptions: CHARGES }));
    loanService.chargeTemplate.mockReturnValue(of(CHARGE_TEMPLATE));
    await show(String(CLIENT_ID));
    component.addCharge();
    fixture.detectChanges();
// An empty row names no charge, so it falls due on no date and shows no due-date field (AAP 0.7.2 row `LoanChargeRequest`).
    expect(host().querySelector('#charge-0-dueDate')).toBeNull();
    component.onChargeSelect(0, PICKED_CHARGE_ID);
    await settle();
    fixture.detectChanges();
    expect(host().querySelector('#charge-0-dueDate')).not.toBeNull();
    expect(renderedText()).toContain('label.input.duedate');
    component.chargeRows.at(0).controls.dueDate.setValue(CHARGE_DUE_DATE);
    await component.submit();
    const posted = loanService.create.mock.calls[0]?.[0].charges?.[0];
    expect(posted?.dueDate).toBeInstanceOf(Date);
    expect(posted).toEqual({
      chargeId: PICKED_CHARGE_ID,
      amount: CHARGE_TEMPLATE.amount,
      dueDate: CHARGE_DUE_DATE,
    });
  });
  it('posts no due date for a charge that falls due on disbursement, dropping the date an earlier pick carried', async () => {
    loanService.template.mockReturnValue(of({ ...TEMPLATE, chargeOptions: CHARGES }));
    loanService.chargeTemplate.mockReturnValue(of(CHARGE_TEMPLATE));
    await show(String(CLIENT_ID));
    component.addCharge();
    component.onChargeSelect(0, PICKED_CHARGE_ID);
    await settle();
    component.chargeRows.at(0).controls.dueDate.setValue(CHARGE_DUE_DATE);
    component.onChargeSelect(0, DISBURSEMENT_CHARGE_ID);
    await settle();
    fixture.detectChanges();
// One charge's date cannot travel with another charge's row, so the pick that carries no date clears the one the row held (AAP 0.7.2 row `LoanChargeRequest`).
    expect(component.chargeRows.at(0).controls.dueDate.value).toBeNull();
    expect(host().querySelector('#charge-0-dueDate')).toBeNull();
    await component.submit();
    expect(loanService.create.mock.calls[0]?.[0].charges?.[0]).not.toHaveProperty('dueDate');
  });
  it.each(INVALID_CLIENT_ID_SEGMENTS)(
    'shows the not-found message and reads nothing for %s',
    async (_description: string, segment: string | null) => {
      await show(segment);
      expect(component.notFound()).toBe(true);
      expect(component.clientId()).toBe(segment);
      expect(loanService.template).not.toHaveBeenCalled();
      expect(renderedText()).toContain('error.msg.resource.not.found');
      expect(host().querySelector('#principal')).toBeNull();
    },
  );
  it('re-reads the template for a second client, clearing the first client’s application', async () => {
    loanService.template.mockImplementation((clientId) =>
      of(clientId === SECOND_CLIENT_ID ? SECOND_TEMPLATE : TEMPLATE),
    );
    await show(String(CLIENT_ID));
    component.form.controls.principal.setValue(12345);
    fixture.detectChanges();
    await navigateTo(String(SECOND_CLIENT_ID));
    expect(loanService.template.mock.calls).toEqual([
      [CLIENT_ID, undefined],
      [SECOND_CLIENT_ID, undefined],
    ]);
    expect(component.clientId()).toBe(String(SECOND_CLIENT_ID));
    expect(component.form.controls.principal.value).toBe(SECOND_TEMPLATE.principal);
    expect(component.productOptions().map((option) => option.name)).toEqual(
      SECOND_TEMPLATE.productOptions.map((option) => option.name),
    );
    expect(component.error()).toBeNull();
    expect(cancelHref()).toBe(`/viewclient/${SECOND_CLIENT_ID}`);
  });
  it('discards a superseded template answer that lands after the URL moved on', async () => {
    const first = deferredResponse<LoanTemplate>();
    const second = deferredResponse<LoanTemplate>();
    loanService.template.mockImplementation((clientId) =>
      clientId === SECOND_CLIENT_ID ? second.response : first.response,
    );
    await show(String(CLIENT_ID));
    await navigateTo(String(SECOND_CLIENT_ID));
    second.resolve(SECOND_TEMPLATE);
    await settle();
    expect(component.form.controls.principal.value).toBe(SECOND_TEMPLATE.principal);
    expect(component.loading()).toBe(false);
    first.resolve(TEMPLATE);
    await settle();
    expect(component.clientId()).toBe(String(SECOND_CLIENT_ID));
    expect(component.form.controls.principal.value).toBe(SECOND_TEMPLATE.principal);
    expect(component.productOptions().map((option) => option.name)).toEqual(
      SECOND_TEMPLATE.productOptions.map((option) => option.name),
    );
    expect(component.loading()).toBe(false);
    expect(component.notFound()).toBe(false);
    expect(component.error()).toBeNull();
  });
  it('posts the application for the client the route now names', async () => {
    loanService.template.mockImplementation((clientId) =>
      of(clientId === SECOND_CLIENT_ID ? SECOND_TEMPLATE : TEMPLATE),
    );
    await show(String(CLIENT_ID));
    await navigateTo(String(SECOND_CLIENT_ID));
    await component.submit();
    expect(loanService.create).toHaveBeenCalledTimes(1);
    expect(loanService.create.mock.calls[0]?.[0]).toMatchObject({
      clientId: SECOND_CLIENT_ID,
      productId: SECOND_TEMPLATE.product?.id,
      principal: SECOND_TEMPLATE.principal,
    });
    expect(navigate).toHaveBeenCalledWith(['/viewloanaccount', 41]);
  });
  it('reports a submission the server answered without a loan id, and opens no record', async () => {
// `POST /loans` answering without an id names no record to open, so the outcome is rendered rather than swallowed (AAP 0.14.2).
    loanService.create.mockReturnValue(of({}));
    await show(String(CLIENT_ID));
    await component.submit();
    fixture.detectChanges();
    expect(loanService.create).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(component.submittedWithoutId()).toBe(true);
    expect(host().querySelector('.alert-warning[role="alert"]')?.textContent).toContain(
      'the server reported no loan identifier',
    );
    expect(component.error()).toBeNull();
    await navigateTo(String(SECOND_CLIENT_ID));
    expect(component.submittedWithoutId()).toBe(false);
    expect(host().querySelector('.alert-warning')).toBeNull();
  });
  it('offers the template’s products in its own order, with nothing sorted or filtered', async () => {
    await show(String(CLIENT_ID));
    expect(optionLabels('#productId')).toEqual(['label.selectloanproduct', ...PRODUCT_NAMES]);
    expect(component.form.controls.productId.value).toBe(PRODUCTS[0].id);
  });
  it.each<[string, string, readonly string[]]>([
    ['termFrequencyTypeOptions', '#loanTermFrequencyType', ['Days', 'Months']],
    ['repaymentFrequencyTypeOptions', '#repaymentFrequencyType', ['Weeks', 'Months']],
    ['interestRateFrequencyTypeOptions', '#interestRateFrequencyType', ['Per year', 'Per month']],
    [
      'amortizationTypeOptions',
      '#amortizationType',
      ['Equal installments', 'Equal principal payments'],
    ],
    ['interestTypeOptions', '#interestType', ['Declining Balance', 'Flat']],
    [
      'interestCalculationPeriodTypeOptions',
      '#interestCalculationPeriodType',
      ['Daily', 'Same as repayment period'],
    ],
  ])(
    'renders the template’s own %s rows in the order it sent them',
    async (_member: string, selector: string, labels: readonly string[]) => {
      await show(String(CLIENT_ID));
      expect(optionLabels(selector)).toEqual(labels);
    },
  );
  it('offers only the charges the template lists, in its order', async () => {
    loanService.template.mockReturnValue(of({ ...TEMPLATE, chargeOptions: CHARGES }));
    await show(String(CLIENT_ID));
    component.addCharge();
    fixture.detectChanges();
    expect(optionLabels('#charge-0-chargeId')).toEqual([
      'label.selectcharge',
      ...CHARGES.map((charge) => charge.name),
    ]);
  });
  it('bounds the principal nowhere, so Fineract alone can refuse an amount above the maximum', async () => {
    await show(String(CLIENT_ID));
    const principal = component.form.controls.principal;
    principal.setValue(50_000_000);
    principal.markAsTouched();
    expect(principal.errors).toBeNull();
    expect(principal.hasError('min')).toBe(false);
    expect(principal.hasError('max')).toBe(false);
    principal.setValue(PRINCIPAL_ABOVE_PRODUCT_MAX);
    expect(principal.errors).toBeNull();
    const input = host().querySelector('#principal');
    expect(input?.getAttribute('min')).toBeNull();
    expect(input?.getAttribute('max')).toBeNull();
    component.addCharge();
    const amount = component.chargeRows.at(0).controls.amount;
    amount.setValue(PRINCIPAL_ABOVE_PRODUCT_MAX);
    expect(amount.errors).toBeNull();
    expect(amount.hasError('max')).toBe(false);
  });
  it('previews exactly the application it submits, and opens the loan the server created', async () => {
    loanService.previewSchedule.mockReturnValue(of(SCHEDULE));
    loanService.create.mockReturnValue(of({ resourceId: 42 }));
    await show(String(CLIENT_ID));
    await component.preview();
    await settle();
    expect(loanService.previewSchedule).toHaveBeenCalledTimes(1);
    const previewed = loanService.previewSchedule.mock.calls[0][0];
    expect(previewed.clientId).toBe(CLIENT_ID);
    expect(previewed.principal).toBe(TEMPLATE.principal);
    expect(host().querySelectorAll('#repayment-preview tbody tr')).toHaveLength(
      SCHEDULE.periods.length,
    );
    await component.submit();
    await settle();
    expect(loanService.create).toHaveBeenCalledTimes(1);
    expect(loanService.create.mock.calls[0][0]).toEqual(previewed);
    expect(navigate).toHaveBeenCalledWith(['/viewloanaccount', 42]);
  });
  it('clears the previous schedule when the next preview is refused, and renders the server’s message', async () => {
    loanService.previewSchedule.mockReturnValueOnce(of(SCHEDULE));
    await show(String(CLIENT_ID));
    await component.preview();
    await settle();
    expect(host().querySelectorAll('#repayment-preview tbody tr')).toHaveLength(
      SCHEDULE.periods.length,
    );
    loanService.previewSchedule.mockReturnValueOnce(
      throwError(() => new ApiError(SERVER_MESSAGE, 400)),
    );
    component.form.controls.principal.setValue(PRINCIPAL_ABOVE_PRODUCT_MAX);
    await component.preview();
    await settle();
// The table on screen must belong to the values on the form, so a refused preview leaves no schedule and the shared empty state instead (AAP 0.7.4).
    expect(component.schedule()).toBeNull();
    expect(host().querySelector('#repayment-preview')).toBeNull();
    expect(host().querySelectorAll('#repayment-preview tbody tr')).toHaveLength(0);
    expect(host().querySelector('#repayment-preview-empty')).not.toBeNull();
    expect(host().querySelector('.alert.alert-danger')?.textContent).toBe(SERVER_MESSAGE);
    expect(component.form.controls.principal.value).toBe(PRINCIPAL_ABOVE_PRODUCT_MAX);
  });
  it('renders a rejected application’s message verbatim and keeps every entered value', async () => {
    loanService.create.mockReturnValue(throwError(() => new ApiError(SERVER_MESSAGE, 400)));
    await show(String(CLIENT_ID));
    component.form.controls.principal.setValue(PRINCIPAL_ABOVE_PRODUCT_MAX);
    component.form.controls.numberOfRepayments.setValue(10);
    await component.submit();
    fixture.detectChanges();
    expect(host().querySelector('.alert.alert-danger')?.textContent).toBe(SERVER_MESSAGE);
    expect(loanService.create.mock.calls[0][0].principal).toBe(PRINCIPAL_ABOVE_PRODUCT_MAX);
    expect(component.form.controls.principal.value).toBe(PRINCIPAL_ABOVE_PRODUCT_MAX);
    expect(component.form.controls.numberOfRepayments.value).toBe(10);
    expect(host().querySelector('#principal')).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('leaves a server-side failure to the interceptor’s notification alone', async () => {
    loanService.create.mockReturnValue(
      throwError(() => new ApiError('An unexpected error occurred.', 503)),
    );
    await show(String(CLIENT_ID));
    await component.submit();
    fixture.detectChanges();
    expect(component.error()).toBeNull();
    expect(host().querySelector('.alert.alert-danger')).toBeNull();
    expect(host().querySelector('#principal')).not.toBeNull();
    expect(component.form.controls.principal.value).toBe(TEMPLATE.principal);
  });
  it('disables both triggers while a call is in flight and sends one request per press', async () => {
    const pending = deferredResponse<RepaymentSchedule>();
    loanService.previewSchedule.mockReturnValue(pending.response);
    await show(String(CLIENT_ID));
    component.preview();
    fixture.detectChanges();
    expect(component.guard.busy()).toBe(true);
    expect(triggers()).toHaveLength(2);
    const [previewTrigger, submitTrigger] = triggers();
    expect(previewTrigger.disabled).toBe(true);
    expect(submitTrigger.disabled).toBe(true);
    component.preview();
    component.submit();
    await Promise.resolve();
    expect(loanService.previewSchedule).toHaveBeenCalledTimes(1);
    expect(loanService.create).not.toHaveBeenCalled();
    pending.resolve(SCHEDULE);
    await settle();
    expect(component.guard.busy()).toBe(false);
    expect(triggers().map((trigger) => trigger.disabled)).toEqual([false, false]);
    expect(component.schedule()).toBe(SCHEDULE);
  });
});
