import { HttpErrorResponse } from '@angular/common/http';
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
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { toApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notifications/notification.service';
import type {
  ChargeTemplate,
  LoanAccount,
  LoanActionResult,
  LoanChargeOption,
  LoanTransactionTemplate,
} from '../loan.models';
import {
  LoanService,
  type LoanChargeActionInput,
  type LoanChargeInput,
} from '../loan.service';
import { LoanChargeFormComponent } from './loan-charge-form.component';

/** Behaviour of the loan charge screens — `#/addloancharge/:id` and `#/loanaccountcharge/:id/:action/:chargeId` (AAP 0.7.3 "Loan charges"; AAP 0.7.4; AAP 0.8.2): the template read once for the loan the route names, `dueDate` only for a charge whose timing carries a date, the pay and waive bodies their endpoint accepts and refuses, and no client-side amount bound, so Fineract refuses an out-of-range one (Rule 1 clause 3; W7). */

const LOAN_ID = '9';
const SECOND_LOAN_ID = '12';
const CHARGE_ID = '21';
const CHARGE_OPTIONS: readonly LoanChargeOption[] = [
  {
    id: 3,
    name: 'Parity Fee',
    amount: 25,
    chargeTimeType: { id: 2, value: 'Specified due date' },
    chargeCalculationType: { id: 1, value: 'Flat' },
  },
  {
    id: 1,
    name: 'Disbursement Fee',
    amount: 40,
    chargeTimeType: { id: 1, value: 'Disbursement' },
    chargeCalculationType: { id: 1, value: 'Flat' },
  },
];
const TEMPLATE: ChargeTemplate = { chargeOptions: CHARGE_OPTIONS };
const SECOND_TEMPLATE: ChargeTemplate = {
  chargeOptions: [
    {
      id: 7,
      name: 'Second Loan Fee',
      amount: 60,
      chargeTimeType: { id: 1, value: 'Disbursement' },
    },
  ],
};
const OPTION_NAMES: readonly string[] = CHARGE_OPTIONS.map((option) => option.name);
const CHOSEN_CHARGE_ID = 3;
const DISBURSEMENT_CHARGE_ID = 1;
const UNROUNDED_AMOUNT = 60.35;
const UNROUNDED_TEMPLATE: ChargeTemplate = {
  chargeOptions: [
    {
      id: 5,
      name: 'Unrounded Fee',
      amount: UNROUNDED_AMOUNT,
      chargeTimeType: { id: 1, value: 'Disbursement' },
    },
  ],
};
const UNROUNDED_CHARGE_ID = 5;
const DUE_DATE = new Date(2026, 10, 24);
const PAYMENT_DATE = new Date(2026, 10, 25);
const ENTERED_AMOUNT = 87.5;
const OUT_OF_RANGE_AMOUNT = 50_000;
interface LoanServiceStub {
  readonly chargeTemplateFor: Mock<(id: number | string) => Observable<ChargeTemplate>>;
  readonly addCharge: Mock<(id: number | string, body: LoanChargeInput) => Observable<LoanActionResult>>;
  readonly chargeAction: Mock<
    (
      id: number | string,
      chargeId: number | string,
      command: 'pay' | 'waive',
      body: LoanChargeActionInput,
    ) => Observable<LoanActionResult>
  >;
// `GET /loans/{id}` and `GET /loans/{id}/transactions/template` are stubbed with no return value because no body this screen posts carries a charge record or a payment type, so a call would fail the run loudly (AAP 0.7.3 "Loan charges").
  readonly get: Mock<(id: number | string) => Observable<LoanAccount>>;
  readonly actionTemplate: Mock<
    (
      id: number | string,
      command: 'disburse' | 'repayment',
    ) => Observable<LoanTransactionTemplate>
  >;
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

describe('LoanChargeFormComponent', () => {
  let fixture: ComponentFixture<LoanChargeFormComponent>;
  let component: LoanChargeFormComponent;
  let loan: LoanServiceStub;
  let navigate: MockInstance<Router['navigate']>;
  let notify: MockInstance<NotificationService['show']>;
  let routeParams: BehaviorSubject<ParamMap>;
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  function paramsFor(
    id: string | null,
    action: string | null = null,
    chargeId: string | null = null,
  ): ParamMap {
    const params: Record<string, string> = {};
    if (id !== null) {
      params['id'] = id;
    }
    if (action !== null) {
      params['action'] = action;
    }
    if (chargeId !== null) {
      params['chargeId'] = chargeId;
    }
    return convertToParamMap(params);
  }
  function renderedText(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ').trim();
  }
  function chargeSelect(): HTMLSelectElement | null {
    const element: unknown = host().querySelector('app-select-field select');
    return element instanceof HTMLSelectElement ? element : null;
  }
  function optionTexts(select: HTMLSelectElement): string[] {
    return Array.from(select.options).map((option) => (option.textContent ?? '').trim());
  }
  function cancelHref(): string | null {
    return host().querySelector('#cancel')?.getAttribute('href') ?? null;
  }
  function saveButton(): HTMLButtonElement | null {
    const element: unknown = host().querySelector('#save');
    return element instanceof HTMLButtonElement ? element : null;
  }
  function amountInput(): HTMLInputElement | null {
    const element: unknown = host().querySelector('#amount');
    return element instanceof HTMLInputElement ? element : null;
  }
  function hasField(id: string): boolean {
    return host().querySelector(`#${id}`) !== null;
  }
  function seededAmount(chargeId: number): number {
    const option = CHARGE_OPTIONS.find((row) => row.id === chargeId);
    if (option?.amount === undefined) {
      throw new Error(`the fixture states no amount for charge ${chargeId}`);
    }
    return option.amount;
  }
  async function settle(): Promise<void> {
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  async function show(
    id: string | null,
    action: string | null = null,
    chargeId: string | null = null,
  ): Promise<void> {
    routeParams.next(paramsFor(id, action, chargeId));
    fixture = TestBed.createComponent(LoanChargeFormComponent);
    component = fixture.componentInstance;
    await settle();
  }
  async function navigateTo(
    id: string | null,
    action: string | null = null,
    chargeId: string | null = null,
  ): Promise<void> {
    routeParams.next(paramsFor(id, action, chargeId));
    await settle();
  }
  beforeEach(() => {
    vi.clearAllMocks();
    loan = {
      chargeTemplateFor: vi.fn(),
      addCharge: vi.fn(),
      chargeAction: vi.fn(),
      get: vi.fn(),
      actionTemplate: vi.fn(),
    };
    loan.chargeTemplateFor.mockReturnValue(of(TEMPLATE));
    loan.addCharge.mockReturnValue(of({ resourceId: 5 }));
    loan.chargeAction.mockReturnValue(of({ resourceId: 5 }));
    routeParams = new BehaviorSubject<ParamMap>(paramsFor(null));
    TestBed.configureTestingModule({
      imports: [LoanChargeFormComponent],
      providers: [
        provideRouter([]),
        { provide: LoanService, useValue: loan },
        { provide: ActivatedRoute, useValue: { paramMap: routeParams.asObservable() } },
        { provide: TranslateService, useValue: translateStub() },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    notify = vi.spyOn(TestBed.inject(NotificationService), 'show');
  });
  it('reads the charge template once for the routed loan and offers its options in payload order', async () => {
    await show(LOAN_ID);
    expect(loan.chargeTemplateFor.mock.calls).toEqual([[LOAN_ID]]);
    expect(component.isAddMode()).toBe(true);
    expect(component.isPayMode()).toBe(false);
    expect(component.isWaiveMode()).toBe(false);
    expect(component.notFound()).toBe(false);
    expect(component.loading()).toBe(false);
    const select = chargeSelect();
    expect(select).not.toBeNull();
    expect(optionTexts(select as HTMLSelectElement)).toEqual([
      'label.selectcharge',
      ...OPTION_NAMES,
    ]);
    expect(loan.get).not.toHaveBeenCalled();
    expect(loan.actionTemplate).not.toHaveBeenCalled();
    expect(cancelHref()).toBe(`/viewloanaccount/${LOAN_ID}`);
  });
  it('renders an empty picker, not a failure, when the payload carries no chargeOptions', async () => {
    loan.chargeTemplateFor.mockReturnValue(of({}));
    await show(LOAN_ID);
    expect(loan.chargeTemplateFor.mock.calls).toEqual([[LOAN_ID]]);
    expect(component.notFound()).toBe(false);
    expect(component.loading()).toBe(false);
    expect(component.error()).toBeNull();
    expect(component.chargeOptions()).toEqual([]);
    const select = chargeSelect();
    expect(select).not.toBeNull();
    expect(optionTexts(select as HTMLSelectElement)).toEqual(['label.selectcharge']);
    expect(host().querySelector('#save')).not.toBeNull();
  });
  it.each<[string]>([['pay'], ['waive']])('reads nothing on the %s route', async (action) => {
    await show(LOAN_ID, action, CHARGE_ID);
    expect(loan.chargeTemplateFor).not.toHaveBeenCalled();
    expect(component.mode()).toBe(action);
    expect(component.notFound()).toBe(false);
    expect(component.loading()).toBe(false);
    expect(chargeSelect()).toBeNull();
  });
  it.each<[string, string | null, string | null, string | null]>([
    ['an action this application does not serve', LOAN_ID, 'nonsense', CHARGE_ID],
    ['a route that names no loan', null, null, null],
  ])(
    'renders the not-found message and sends nothing for %s',
    async (_label, id, action, chargeId) => {
      await show(id, action, chargeId);
      expect(component.notFound()).toBe(true);
      expect(renderedText()).toContain('error.msg.resource.not.found');
      expect(host().querySelector('.text-center.text-muted')?.textContent?.trim()).toBe(
        'error.msg.resource.not.found',
      );
      expect(host().querySelectorAll('form')).toHaveLength(0);
      expect(host().querySelector('#save')).toBeNull();
      expect(host().querySelector('#cancel')).toBeNull();
      expect(loan.chargeTemplateFor).not.toHaveBeenCalled();
      expect(loan.get).not.toHaveBeenCalled();
      expect(loan.actionTemplate).not.toHaveBeenCalled();
      expect(loan.addCharge).not.toHaveBeenCalled();
      expect(loan.chargeAction).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    },
  );
  it('re-reads the template for a second loan, clearing the first loan’s picker and values', async () => {
    loan.chargeTemplateFor.mockImplementation((id) =>
      of(String(id) === SECOND_LOAN_ID ? SECOND_TEMPLATE : TEMPLATE),
    );
    await show(LOAN_ID);
    component.form.controls.chargeId.setValue(CHOSEN_CHARGE_ID);
    component.form.controls.amount.setValue(99);
    fixture.detectChanges();
    await navigateTo(SECOND_LOAN_ID);
    expect(loan.chargeTemplateFor.mock.calls).toEqual([[LOAN_ID], [SECOND_LOAN_ID]]);
    expect(component.loanId()).toBe(SECOND_LOAN_ID);
    expect(component.form.controls.chargeId.value).toBeNull();
    expect(component.form.controls.amount.value).toBeNull();
    expect(component.error()).toBeNull();
    const select = chargeSelect();
    expect(select).not.toBeNull();
    expect(optionTexts(select as HTMLSelectElement)).not.toContain(CHARGE_OPTIONS[0].name);
    expect(optionTexts(select as HTMLSelectElement)).toContain(SECOND_TEMPLATE.chargeOptions?.[0]?.name);
    expect(cancelHref()).toBe(`/viewloanaccount/${SECOND_LOAN_ID}`);
  });
  it('switches to the operation a second emission names, with no request and a cleared form', async () => {
    await show(LOAN_ID);
    component.form.controls.chargeId.setValue(CHOSEN_CHARGE_ID);
    fixture.detectChanges();
    await navigateTo(LOAN_ID, 'pay', CHARGE_ID);
    expect(loan.chargeTemplateFor).toHaveBeenCalledTimes(1);
    expect(component.isPayMode()).toBe(true);
    expect(component.chargeId()).toBe(CHARGE_ID);
    expect(component.form.controls.chargeId.value).toBeNull();
    expect(component.form.controls.transactionDate.value).toBeInstanceOf(Date);
    expect(chargeSelect()).toBeNull();
  });
  it('discards a superseded template answer that lands after the URL moved on', async () => {
    const first = deferredResponse<ChargeTemplate>();
    const second = deferredResponse<ChargeTemplate>();
    loan.chargeTemplateFor.mockImplementation((id) =>
      String(id) === SECOND_LOAN_ID ? second.response : first.response,
    );
    await show(LOAN_ID);
    await navigateTo(SECOND_LOAN_ID);
    second.resolve(SECOND_TEMPLATE);
    await settle();
    expect(component.chargeOptions().map((option) => option.name)).toEqual(
      (SECOND_TEMPLATE.chargeOptions ?? []).map((option) => option.name),
    );
    expect(component.loading()).toBe(false);
    first.resolve(TEMPLATE);
    await settle();
    expect(component.loanId()).toBe(SECOND_LOAN_ID);
    expect(component.chargeOptions().map((option) => option.name)).toEqual(
      (SECOND_TEMPLATE.chargeOptions ?? []).map((option) => option.name),
    );
    expect(component.loading()).toBe(false);
    expect(component.error()).toBeNull();
  });
  it('posts the picked charge to the routed loan and returns to its record', async () => {
    await show(LOAN_ID);
    component.form.controls.chargeId.setValue(CHOSEN_CHARGE_ID);
    fixture.detectChanges();
    await component.submit();
    expect(loan.addCharge).toHaveBeenCalledTimes(1);
    expect(loan.addCharge.mock.calls[0]?.[0]).toBe(LOAN_ID);
    expect(loan.addCharge.mock.calls[0]?.[1]).toMatchObject({
      chargeId: CHOSEN_CHARGE_ID,
      amount: CHARGE_OPTIONS[0].amount,
    });
    expect(loan.chargeAction).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/viewloanaccount', LOAN_ID]);
  });
  it('posts exactly the picked charge and its amount, with no format pair', async () => {
    await show(LOAN_ID);
    component.form.controls.chargeId.setValue(DISBURSEMENT_CHARGE_ID);
    fixture.detectChanges();
    await component.submit();
    expect(loan.addCharge).toHaveBeenCalledTimes(1);
    const call = loan.addCharge.mock.calls[0];
    const body = call?.[1];
    expect(call?.[0]).toBe(LOAN_ID);
    expect(Object.keys(body ?? {}).sort()).toEqual(['amount', 'chargeId']);
    expect(body).toEqual({
      chargeId: DISBURSEMENT_CHARGE_ID,
      amount: seededAmount(DISBURSEMENT_CHARGE_ID),
    });
    expect(loan.chargeAction).not.toHaveBeenCalled();
  });
  it.each<[number, boolean]>([
    [CHOSEN_CHARGE_ID, true],
    [DISBURSEMENT_CHARGE_ID, false],
  ])(
    'adds the due date for charge %i only when it falls due on a specified date: %s',
    async (chargeId, requiresDueDate) => {
      await show(LOAN_ID);
      component.form.controls.chargeId.setValue(chargeId);
      fixture.detectChanges();

// The date control exists exactly for the charge whose timing carries a specified date — legacy's `chargeTimeType.id == 2` test (Rule 1 clause 3).
      expect(hasField('dueDate')).toBe(requiresDueDate);
      component.form.controls.dueDate.setValue(DUE_DATE);
      fixture.detectChanges();
      await component.submit();
      expect(loan.addCharge).toHaveBeenCalledTimes(1);
      const body = loan.addCharge.mock.calls[0]?.[1];
      expect(body?.chargeId).toBe(chargeId);
      expect(body?.amount).toBe(seededAmount(chargeId));
      if (requiresDueDate) {
        expect(body?.dueDate).toBe(DUE_DATE);
      } else {
        expect(Object.keys(body ?? {}).sort()).toEqual(['amount', 'chargeId']);
      }
    },
  );
  it('seeds and posts the charge amount exactly, with no rounding', async () => {
    loan.chargeTemplateFor.mockReturnValue(of(UNROUNDED_TEMPLATE));
    await show(LOAN_ID);
    component.form.controls.chargeId.setValue(UNROUNDED_CHARGE_ID);
    fixture.detectChanges();
    expect(component.form.controls.amount.value).toBe(UNROUNDED_AMOUNT);
    expect(amountInput()?.value).toBe(String(UNROUNDED_AMOUNT));
    await component.submit();
    expect(loan.addCharge.mock.calls[0]?.[1]?.amount).toBe(UNROUNDED_AMOUNT);
    expect(navigate).toHaveBeenCalledWith(['/viewloanaccount', LOAN_ID]);
  });
  it('posts the payment date of the pay route and collects no amount or payment type', async () => {
    await show(LOAN_ID, 'pay', CHARGE_ID);
    expect(hasField('transactionDate')).toBe(true);
    expect(hasField('amount')).toBe(false);
    expect(hasField('paymentTypeId')).toBe(false);
    component.form.controls.transactionDate.setValue(PAYMENT_DATE);
    fixture.detectChanges();
    await component.submit();
    expect(loan.chargeAction).toHaveBeenCalledTimes(1);
    const call = loan.chargeAction.mock.calls[0];
    expect(call?.[0]).toBe(LOAN_ID);
    expect(call?.[1]).toBe(CHARGE_ID);
    expect(call?.[2]).toBe('pay');
    const body = call?.[3];
    expect(Object.keys(body ?? {}).sort()).toEqual(['command', 'transactionDate']);
    expect(body).toEqual({ command: 'pay', transactionDate: PAYMENT_DATE });
    expect(loan.actionTemplate).not.toHaveBeenCalled();
    expect(loan.chargeTemplateFor).not.toHaveBeenCalled();
    expect(loan.get).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/viewloanaccount', LOAN_ID]);
  });
  it('waives the route’s charge with the command alone, collecting and reading nothing else', async () => {
    await show(LOAN_ID, 'waive', CHARGE_ID);
    expect(host().querySelectorAll('form')).toHaveLength(1);
    expect(hasField('transactionDate')).toBe(false);
    expect(hasField('paymentTypeId')).toBe(false);
    expect(hasField('amount')).toBe(false);
    expect(host().querySelectorAll('app-date-field')).toHaveLength(0);
    expect(host().querySelectorAll('app-select-field')).toHaveLength(0);
    await component.submit();
    expect(loan.chargeAction).toHaveBeenCalledTimes(1);
    const call = loan.chargeAction.mock.calls[0];
    expect(call?.[0]).toBe(LOAN_ID);
    expect(call?.[1]).toBe(CHARGE_ID);
    expect(call?.[2]).toBe('waive');
// The discriminating command and nothing beside it: no `transactionDate`, `paymentTypeId` or `amount`, all of which `?command=waive` refuses on the binding (Rule 1 clause 2).
    expect(Object.keys(call?.[3] ?? {})).toEqual(['command']);
    expect(call?.[3]).toEqual({ command: 'waive' });
    expect(loan.actionTemplate).not.toHaveBeenCalled();
    expect(loan.chargeTemplateFor).not.toHaveBeenCalled();
    expect(loan.get).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/viewloanaccount', LOAN_ID]);
  });
  it('returns to the loan record from Cancel without posting anything', async () => {
    await show(LOAN_ID);
    component.form.controls.chargeId.setValue(DISBURSEMENT_CHARGE_ID);
    fixture.detectChanges();
    const cancel = host().querySelector('#cancel');
    expect(cancel?.getAttribute('href')).toBe(`/viewloanaccount/${LOAN_ID}`);
    const navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    cancel?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    expect(loan.addCharge).not.toHaveBeenCalled();
    expect(loan.chargeAction).not.toHaveBeenCalled();
  });
  it('disables the trigger while the request is in flight so one click sends one POST', async () => {
    const inFlight = new Subject<LoanActionResult>();
    loan.addCharge.mockReturnValue(inFlight.asObservable());
    await show(LOAN_ID);
    component.form.controls.chargeId.setValue(DISBURSEMENT_CHARGE_ID);
    fixture.detectChanges();
    expect(saveButton()?.disabled).toBe(false);
    saveButton()?.click();
    fixture.detectChanges();
    expect(loan.addCharge).toHaveBeenCalledTimes(1);
    expect(saveButton()?.disabled).toBe(true);
    saveButton()?.click();
    await component.submit();
    fixture.detectChanges();
    expect(loan.addCharge).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    inFlight.next({ resourceId: 5 });
    inFlight.complete();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(saveButton()?.disabled).toBe(false);
    });
    expect(navigate).toHaveBeenCalledWith(['/viewloanaccount', LOAN_ID]);
  });
  it('shows Fineract’s own rejection verbatim and keeps every entered value', async () => {
    const rejected = 'Charge amount must be greater than zero';
    loan.addCharge.mockReturnValue(
      throwError(() =>
        toApiError(new HttpErrorResponse({ status: 400, error: { defaultUserMessage: rejected } })),
      ),
    );
    await show(LOAN_ID);
    component.form.controls.chargeId.setValue(DISBURSEMENT_CHARGE_ID);
    component.form.controls.amount.setValue(ENTERED_AMOUNT);
    fixture.detectChanges();
    await component.submit();
    fixture.detectChanges();
    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(rejected);
    expect(host().querySelectorAll('form')).toHaveLength(1);
    expect(amountInput()?.value).toBe(String(ENTERED_AMOUNT));
    expect(component.form.controls.amount.value).toBe(ENTERED_AMOUNT);
    expect(component.form.controls.chargeId.value).toBe(DISBURSEMENT_CHARGE_ID);
    expect(navigate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
  it('leaves the amount unbounded so Fineract alone rejects an out-of-range value', async () => {
    await show(LOAN_ID);
    component.form.controls.chargeId.setValue(DISBURSEMENT_CHARGE_ID);
    component.form.controls.amount.setValue(OUT_OF_RANGE_AMOUNT);
    fixture.detectChanges();
    expect(component.form.controls.amount.errors).toBeNull();
    expect(component.form.controls.amount.valid).toBe(true);
    expect(amountInput()?.hasAttribute('min')).toBe(false);
    expect(amountInput()?.hasAttribute('max')).toBe(false);
    expect(amountInput()?.hasAttribute('required')).toBe(false);
    await component.submit();
    expect(loan.addCharge).toHaveBeenCalledTimes(1);
    expect(loan.addCharge.mock.calls[0]?.[1]?.amount).toBe(OUT_OF_RANGE_AMOUNT);
    component.form.controls.amount.setValue(null);
    expect(component.form.controls.amount.hasError('required')).toBe(true);
  });
});
