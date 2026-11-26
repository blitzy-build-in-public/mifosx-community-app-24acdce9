import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal, type Signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { ApiError, toApiError } from '../../../core/http/api-error';
import type { LoanActionResult, LoanTransactionTemplate, OptionItem } from '../loan.models';
import { LoanService, type LoanRepaymentInput } from '../loan.service';
import { LoanRepaymentComponent } from './loan-repayment.component';

/** Behaviour of the repayment screen — workflow W6, mounted by `LoanActionComponent` at `#/loanaccount/:id/repayment` (AAP 0.7.3 "W6 repayment"; AAP 0.7.4): the template's payment types and amount seed the form, the transaction date opens on the browser's today rather than on the template's due date, a re-bound `[loanId]` replaces those seeds, one click sends one POST, and a rejected amount renders Fineract's own sentence with every entered value kept. */

const LOAN_ID = '5';
const SECOND_LOAN_ID = '6';
const PAYMENT_TYPES: readonly OptionItem[] = [
  { id: 3, name: 'Repayment Adjustment Refund' },
  { id: 1, name: 'Money Transfer' },
];
const PAYMENT_TYPE_NAMES: readonly string[] = PAYMENT_TYPES.map((option) => option.name);
const FIRST_PAYMENT_TYPE = PAYMENT_TYPES[0];
const TEMPLATE_AMOUNT = 466.67;
const TEMPLATE: LoanTransactionTemplate = {
  paymentTypeOptions: PAYMENT_TYPES,
  date: [2026, 12, 24],
  amount: TEMPLATE_AMOUNT,
  loanId: 5,
};
const SECOND_TEMPLATE_AMOUNT = 75;
const SECOND_PAYMENT_TYPE: OptionItem = { id: 7, name: 'Second Loan Payment' };
const SECOND_TEMPLATE: LoanTransactionTemplate = {
  paymentTypeOptions: [SECOND_PAYMENT_TYPE],
  date: '2027-01-15',
  amount: SECOND_TEMPLATE_AMOUNT,
  loanId: 6,
};

// A template offering no payment type leaves the control valid and posts a body without the member: legacy's repayment select carries no `required` marker and Fineract accepts a repayment without one (Rule 1 clause 3; AAP 0.7.2 `LoanRepaymentRequest`).
const NO_PAYMENT_TYPE_TEMPLATE: LoanTransactionTemplate = {
  date: [2026, 12, 24],
  amount: 100,
};
const ACTION_RESULT: LoanActionResult = { resourceId: 5 };
const ENTERED_AMOUNT = 200.25;
const ENTERED_DATE = new Date(2026, 11, 28);
const ENTERED_PAYMENT_TYPE: OptionItem = PAYMENT_TYPES[1];
const ENTERED_NOTE = 'Paid at the branch counter';
const SERVER_MESSAGE = 'The transaction amount cannot be greater than the outstanding loan balance.';
interface LoanServiceStub {
  readonly actionTemplate: Mock<
    (id: number | string, command: 'disburse' | 'repayment') => Observable<LoanTransactionTemplate>
  >;
  readonly repay: Mock<(id: number | string, body: LoanRepaymentInput) => Observable<LoanActionResult>>;
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

/** Local midnight of the browser's current date: the transaction date the form opens on, because a form's own default date comes from the browser clock and the tenant business date stays the harness's to read (AAP 0.10.5 item 15, AAP 0.12). Computed from the running clock rather than pinned to a literal, so the assertion holds on whatever day the suite runs. */
function todayAtMidnight(): Date {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The `yyyy-MM-dd` string a native `input[type=date]` shows for a `Date`, which is how `DateFieldComponent` writes the control's value onto the element. */
function inputValueOf(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/** The `[year, month, day]` triple Fineract sends a template's `date` in, for a local-midnight `Date`. */
function dateTriple(date: Date): readonly [number, number, number] {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

describe('LoanRepaymentComponent', () => {
  let fixture: ComponentFixture<LoanRepaymentComponent>;
  let component: LoanRepaymentComponent;
  let loan: LoanServiceStub;
  let navigate: MockInstance<Router['navigate']>;
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  function renderedText(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ').trim();
  }
  function paymentSelect(): HTMLSelectElement | null {
    const element: unknown = host().querySelector('app-select-field select');
    return element instanceof HTMLSelectElement ? element : null;
  }
  function amountInput(): HTMLInputElement | null {
    const element: unknown = host().querySelector('#transactionAmount');
    return element instanceof HTMLInputElement ? element : null;
  }
  function dateInput(): HTMLInputElement | null {
    const element: unknown = host().querySelector('#transactionDate');
    return element instanceof HTMLInputElement ? element : null;
  }
  function optionTexts(select: HTMLSelectElement): string[] {
    return Array.from(select.options).map((option) => (option.textContent ?? '').trim());
  }
  function selectedText(select: HTMLSelectElement): string | null {
    return select.selectedIndex < 0 ? null : (select.options[select.selectedIndex]?.textContent ?? '').trim();
  }
  function formElement(): HTMLFormElement | null {
    const element: unknown = host().querySelector('form');
    return element instanceof HTMLFormElement ? element : null;
  }
  function submitTrigger(): HTMLButtonElement | null {
    const element: unknown = host().querySelector('button[type=submit]');
    return element instanceof HTMLButtonElement ? element : null;
  }
  function occurrences(text: string, needle: string): number {
    return text.split(needle).length - 1;
  }
  async function settle(): Promise<void> {
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  async function show(id: string): Promise<void> {
    fixture = TestBed.createComponent(LoanRepaymentComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('loanId', id);
    fixture.detectChanges();
    await settle();
  }
  async function moveTo(id: string): Promise<void> {
    fixture.componentRef.setInput('loanId', id);
    fixture.detectChanges();
    await settle();
  }
  beforeEach(() => {
    loan = { actionTemplate: vi.fn(), repay: vi.fn() };
    loan.actionTemplate.mockReturnValue(of(TEMPLATE));
    loan.repay.mockReturnValue(of(ACTION_RESULT));
    TestBed.configureTestingModule({
      imports: [LoanRepaymentComponent],
      providers: [
        provideRouter([]),
        { provide: LoanService, useValue: loan },
        { provide: TranslateService, useValue: translateStub() },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });
  it('seeds the amount and payment types from the loan’s repayment template and the date from the browser clock', async () => {
    await show(LOAN_ID);

// One read, for the loan the input names and the repayment command: this screen issues no record read, because the legacy repayment action reads its template and nothing else, so the schedule is never its source (Rule 1 clauses 2 and 3).
    expect(loan.actionTemplate.mock.calls).toEqual([[LOAN_ID, 'repayment']]);
    expect(component.notFound()).toBe(false);
    expect(component.error()).toBeNull();
    expect(component.paymentTypeOptions().map((option) => option.id)).toEqual(
      PAYMENT_TYPES.map((option) => option.id),
    );
    expect(component.form.controls.paymentTypeId.value).toBe(FIRST_PAYMENT_TYPE.id);
    expect(component.form.controls.transactionAmount.value).toBe(TEMPLATE_AMOUNT);
// The date is not the template's: a form's own default comes from the browser clock at local midnight, not from the template's `date`, which this backend answers with the first unpaid instalment's due date (AAP 0.10.5 item 15, AAP 0.12).
    expect(component.form.controls.transactionDate.value).toEqual(todayAtMidnight());
    expect(amountInput()?.value).toBe(String(TEMPLATE_AMOUNT));
    expect(dateInput()?.value).toBe(inputValueOf(todayAtMidnight()));
    const select = paymentSelect();
    expect(select).not.toBeNull();
    expect(optionTexts(select as HTMLSelectElement)).toEqual(PAYMENT_TYPE_NAMES);
    expect(selectedText(select as HTMLSelectElement)).toBe(FIRST_PAYMENT_TYPE.name);
  });
  it('opens on the browser’s today, not on the due date the template answers', async () => {
// The finding's own reproduction: this backend answers the first unpaid instalment's due date — a month ahead of the business date on the seeded fixture — so a template-seeded form would post a future-dated repayment unchanged (AAP 0.10.5 item 15, AAP 0.12).
    const dueDate = todayAtMidnight();
    dueDate.setDate(dueDate.getDate() + 30);
    loan.actionTemplate.mockReturnValue(of({ ...TEMPLATE, date: dateTriple(dueDate) }));
    await show(LOAN_ID);
    const seeded = component.form.controls.transactionDate.value;
    expect(seeded).toEqual(todayAtMidnight());
    expect(seeded).not.toEqual(dueDate);
    expect(component.form.controls.transactionDate.valid).toBe(true);
    expect(dateInput()?.value).toBe(inputValueOf(todayAtMidnight()));
  });
  it('re-seeds the form when the loan id changes, keeping nothing of the previous loan', async () => {
    loan.actionTemplate.mockImplementation((id) =>
      of(String(id) === SECOND_LOAN_ID ? SECOND_TEMPLATE : TEMPLATE),
    );
    await show(LOAN_ID);
    expect(component.form.controls.transactionAmount.value).toBe(TEMPLATE_AMOUNT);
    await moveTo(SECOND_LOAN_ID);
    expect(loan.actionTemplate.mock.calls).toEqual([
      [LOAN_ID, 'repayment'],
      [SECOND_LOAN_ID, 'repayment'],
    ]);
    expect(component.form.controls.transactionAmount.value).toBe(SECOND_TEMPLATE_AMOUNT);
    expect(component.form.controls.paymentTypeId.value).toBe(SECOND_PAYMENT_TYPE.id);
// The date is the browser's today for every loan, so it carries the same value across the move; the re-seed of the other two controls above is what this case proves, and the date's own seeding is proved separately (AAP 0.10.5 item 15).
    expect(component.form.controls.transactionDate.value).toEqual(todayAtMidnight());
    expect(component.paymentTypeOptions().map((option) => option.id)).toEqual([
      SECOND_PAYMENT_TYPE.id,
    ]);
    const select = paymentSelect();
    expect(select).not.toBeNull();
    expect(optionTexts(select as HTMLSelectElement)).toEqual([SECOND_PAYMENT_TYPE.name]);
    expect(optionTexts(select as HTMLSelectElement)).not.toContain(FIRST_PAYMENT_TYPE.name);
    expect(selectedText(select as HTMLSelectElement)).toBe(SECOND_PAYMENT_TYPE.name);
    expect(amountInput()?.value).toBe(String(SECOND_TEMPLATE_AMOUNT));
  });
  it('discards a superseded template answer that lands after the URL moved on', async () => {
    const first = deferredResponse<LoanTransactionTemplate>();
    const second = deferredResponse<LoanTransactionTemplate>();
    loan.actionTemplate.mockImplementation((id) =>
      String(id) === SECOND_LOAN_ID ? second.response : first.response,
    );
    await show(LOAN_ID);
    await moveTo(SECOND_LOAN_ID);
    second.resolve(SECOND_TEMPLATE);
    await settle();
    expect(component.form.controls.transactionAmount.value).toBe(SECOND_TEMPLATE_AMOUNT);
    expect(component.form.controls.paymentTypeId.value).toBe(SECOND_PAYMENT_TYPE.id);
    first.resolve(TEMPLATE);
    await settle();
    expect(component.form.controls.transactionAmount.value).toBe(SECOND_TEMPLATE_AMOUNT);
    expect(component.form.controls.paymentTypeId.value).toBe(SECOND_PAYMENT_TYPE.id);
    expect(component.paymentTypeOptions().map((option) => option.id)).toEqual([
      SECOND_PAYMENT_TYPE.id,
    ]);
    expect(component.notFound()).toBe(false);
    expect(component.error()).toBeNull();
  });
  it('leaves the payment type valid and posts no payment-type member when the template offers none', async () => {
    loan.actionTemplate.mockReturnValue(of(NO_PAYMENT_TYPE_TEMPLATE));
    await show(LOAN_ID);
    expect(component.form.controls.paymentTypeId.value).toBeNull();
    expect(component.form.controls.paymentTypeId.valid).toBe(true);
    expect(component.form.valid).toBe(true);
    expect(paymentSelect()?.options.length).toBe(0);
    await component.submit();
    expect(loan.repay).toHaveBeenCalledTimes(1);
    expect(loan.repay).toHaveBeenCalledWith(LOAN_ID, {
      transactionDate: todayAtMidnight(),
      transactionAmount: NO_PAYMENT_TYPE_TEMPLATE.amount,
    });
    const [, postedBody] = loan.repay.mock.calls[0];
    expect(Object.keys(postedBody)).not.toContain('paymentTypeId');
    expect(navigate).toHaveBeenCalledWith(['/viewloanaccount', LOAN_ID]);
  });
  it('posts the repayment the form holds and returns to the record', async () => {
    await show(LOAN_ID);
    component.form.controls.transactionDate.setValue(ENTERED_DATE);
    component.form.controls.transactionAmount.setValue(ENTERED_AMOUNT);
    component.form.controls.paymentTypeId.setValue(ENTERED_PAYMENT_TYPE.id);
    component.form.controls.note.setValue(`  ${ENTERED_NOTE}  `);
    fixture.detectChanges();
    await component.submit();
    expect(loan.repay.mock.calls).toEqual([
      [
        LOAN_ID,
        {
          transactionDate: ENTERED_DATE,
          transactionAmount: ENTERED_AMOUNT,
          paymentTypeId: ENTERED_PAYMENT_TYPE.id,
          note: ENTERED_NOTE,
        },
      ],
    ]);
    const [, postedBody] = loan.repay.mock.calls[0];

// The date never travels as a formatted string: `dateFormat` and `locale` are the service's to write at the boundary, and their absence here is what keeps that boundary from drifting into the component (Rule 1 clause 2; AAP 0.7.2 "Date handling").
    expect(postedBody.transactionDate).toBeInstanceOf(Date);
    expect(Object.keys(postedBody)).not.toContain('dateFormat');
    expect(Object.keys(postedBody)).not.toContain('locale');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/viewloanaccount', LOAN_ID]);
    expect(component.error()).toBeNull();
  });
  it('sends one repayment per submit and disables the trigger while the POST is in flight', async () => {
    const pending = new Subject<LoanActionResult>();
    loan.repay.mockReturnValue(pending.asObservable());
    await show(LOAN_ID);
    const form = formElement();
    expect(form).not.toBeNull();
    expect(submitTrigger()).not.toBeNull();
    expect(submitTrigger()?.disabled).toBe(false);
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(component.guard.busy()).toBe(true);
    expect(submitTrigger()?.disabled).toBe(true);
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(loan.repay).toHaveBeenCalledTimes(1);
    pending.next(ACTION_RESULT);
    pending.complete();
    await settle();
    await settle();
    expect(component.guard.busy()).toBe(false);
    expect(submitTrigger()?.disabled).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(component.error()).toBeNull();
  });
  it('renders the server’s rejection verbatim and keeps every value the user entered', async () => {
    loan.repay.mockReturnValue(
      throwError(() =>
        toApiError(
          new HttpErrorResponse({
            status: 400,
            error: { defaultUserMessage: SERVER_MESSAGE },
          }),
        ),
      ),
    );
    await show(LOAN_ID);
    component.form.controls.transactionDate.setValue(ENTERED_DATE);
    component.form.controls.transactionAmount.setValue(ENTERED_AMOUNT);
    component.form.controls.paymentTypeId.setValue(ENTERED_PAYMENT_TYPE.id);
    component.form.controls.note.setValue(ENTERED_NOTE);
    fixture.detectChanges();
    await component.submit();
    await settle();
    expect(component.error()?.message).toBe(SERVER_MESSAGE);
    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(SERVER_MESSAGE);
    expect(host().querySelectorAll('.alert').length).toBe(1);
    expect(host().querySelector('app-notification')).toBeNull();
    expect(occurrences(renderedText(), SERVER_MESSAGE)).toBe(1);
    expect(formElement()).not.toBeNull();
    expect(amountInput()?.value).toBe(String(ENTERED_AMOUNT));
    expect(dateInput()?.value).toBe('2026-12-28');
    expect(selectedText(paymentSelect() as HTMLSelectElement)).toBe(ENTERED_PAYMENT_TYPE.name);
    expect(component.form.controls.paymentTypeId.value).toBe(ENTERED_PAYMENT_TYPE.id);
    expect(component.form.controls.note.value).toBe(ENTERED_NOTE);
    expect(component.notFound()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('renders the not-found state in place of the form when the template answers 404', async () => {
    loan.actionTemplate.mockReturnValue(
      throwError(() => new ApiError('The loan does not exist.', 404)),
    );
    await show(LOAN_ID);
    expect(component.notFound()).toBe(true);
    expect(component.error()).toBeNull();
    expect(renderedText()).toContain('error.msg.resource.not.found');
    expect(formElement()).toBeNull();
    expect(loan.repay).not.toHaveBeenCalled();
  });
});
