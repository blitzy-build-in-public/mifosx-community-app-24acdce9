import { computed, signal, type Signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';

import { ApiError } from '../../../core/http/api-error';
import type { LoanActionResult, LoanTransactionTemplate, OptionItem } from '../loan.models';
import { LoanService, type LoanRepaymentInput } from '../loan.service';
import { LoanRepaymentComponent } from './loan-repayment.component';

/**
 * Behaviour of the repayment screen — workflow W6 of the Agent Action Plan, mounted at
 * `#/loanaccount/:id/repayment` by `LoanActionComponent` (AAP 0.7.3 row "W6 repayment"; AAP 0.7.4 "the
 * action screens … are single-purpose forms"; AAP 0.14.1 "each screen lands with at least one
 * behavioural spec").
 *
 * It pins the five things the screen exists to do and that a rewrite would get wrong:
 *
 *  1. the seed: the template's payment types in the payload's order with the first preselected, the
 *     template's amount and the template's date, which are the values legacy's own repayment form is
 *     seeded from (Rule 1 clause 3);
 *  2. the id change: `LoanActionComponent` re-binds `[loanId]` on the same component instance, so a
 *     move between two loans' repayment routes must leave none of the previous loan's amount or payment
 *     type behind — a figure from the loan the URL has left would otherwise be posted against the loan
 *     it names now;
 *  3. the superseded answer: a read for the loan the URL has left is discarded even when it answers
 *     last, so it can neither seed nor fail the form that belongs to another loan;
 *  4. no added validation: a template that offers no payment types leaves the payment-type control valid
 *     and posts a body without that member, because legacy's repayment select carries no `required`
 *     marker and Fineract accepts a repayment without one (Rule 1 clause 3; AAP 0.7.2);
 *  5. the 404: the template read answering 404 replaces the form with the not-found message (AAP 0.7.4).
 *
 * **What is stubbed, and why.** Only the collaborations a unit test cannot own: `LoanService`, whose
 * endpoint-level contract — method, path, query parameters and the `dateFormat`/`locale` members of the
 * body — belongs to `loan.service.spec.ts`, and the translation stack, which is asked for display text
 * only. The date and select controls are the shipped shared components, the submit guard is the
 * application's own, and the router is a real `provideRouter([])`, so the cancel link renders the href
 * the application would render.
 */

/** The loan the screen is opened for: the `:id` of `#/loanaccount/:id/repayment`. */
const LOAN_ID = '5';

/** The loan a second binding of the same component moves the screen to. */
const SECOND_LOAN_ID = '6';

/** The payment types the first loan's template offers, deliberately out of alphabetical order. */
const PAYMENT_TYPES: readonly OptionItem[] = [
  { id: 3, name: 'Repayment Adjustment Refund' },
  { id: 1, name: 'Money Transfer' },
];

/** The payload's option names, in payload order. */
const PAYMENT_TYPE_NAMES: readonly string[] = PAYMENT_TYPES.map((option) => option.name);

/** The first option, which is the one the screen preselects — legacy's own default. */
const FIRST_PAYMENT_TYPE = PAYMENT_TYPES[0];

/** The amount the first loan's template offers: its next period's total due. */
const TEMPLATE_AMOUNT = 466.67;

/** The date the first loan's template defaults to, in the `[year, month, day]` shape Fineract sends. */
const TEMPLATE_DATE = new Date(2026, 11, 24);

/**
 * The payload the screen's one read answers with: the three members it seeds from, in the shape
 * `GET /loans/{id}/transactions/template?command=repayment` returns.
 */
const TEMPLATE: LoanTransactionTemplate = {
  paymentTypeOptions: PAYMENT_TYPES,
  date: [2026, 12, 24],
  amount: TEMPLATE_AMOUNT,
  loanId: 5,
};

/** The second loan's amount: the unpaid remainder of its next period, which shares no figure with the first. */
const SECOND_TEMPLATE_AMOUNT = 75;

/** The second loan's payment type, which shares neither id nor name with the first loan's. */
const SECOND_PAYMENT_TYPE: OptionItem = { id: 7, name: 'Second Loan Payment' };

/** The second loan's payload, dated in the `yyyy-MM-dd` string shape Fineract also sends. */
const SECOND_TEMPLATE: LoanTransactionTemplate = {
  paymentTypeOptions: [SECOND_PAYMENT_TYPE],
  date: '2027-01-15',
  amount: SECOND_TEMPLATE_AMOUNT,
  loanId: 6,
};

/**
 * A payload that offers no payment type at all, the case in which the legacy form posts a repayment
 * with no `paymentTypeId` member (AAP 0.7.2 `LoanRepaymentRequest`).
 */
const NO_PAYMENT_TYPE_TEMPLATE: LoanTransactionTemplate = {
  date: [2026, 12, 24],
  amount: 100,
};

/** The result the POST answers with; the screen reads it only to know the write landed. */
const ACTION_RESULT: LoanActionResult = { resourceId: 5 };

/** `LoanService` as this screen uses it: the one template read and the one write, both stubbed. */
interface LoanServiceStub {
  readonly actionTemplate: Mock<
    (id: number | string, command: 'disburse' | 'repayment') => Observable<LoanTransactionTemplate>
  >;
  readonly repay: Mock<(id: number | string, body: LoanRepaymentInput) => Observable<LoanActionResult>>;
}

/**
 * The ngx-translate surface this screen touches: the `translate()` signal `TranslatePipe` resolves its
 * keys through and the two change streams a component in this family subscribes to. Nothing here
 * reaches the network.
 */
interface TranslateStub {
  readonly currentLang: Signal<string>;
  instant(key: string): string;
  translate(key: string): Signal<string>;
  readonly onLangChange: Observable<unknown>;
  readonly onTranslationChange: Observable<unknown>;
}

/** Builds the translation stub the TestBed provides; every key resolves to itself. */
function translateStub(): TranslateStub {
  return {
    currentLang: signal('en').asReadonly(),
    instant: (key: string): string => key,
    translate: (key: string): Signal<string> => computed(() => key),
    onLangChange: new Observable<never>(),
    onTranslationChange: new Observable<never>(),
  };
}

/**
 * An observable a case settles by hand, so one loan's answer can be held open while the URL moves to
 * another loan — the order in which a superseded read answers last.
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

describe('LoanRepaymentComponent', () => {
  let fixture: ComponentFixture<LoanRepaymentComponent>;
  let component: LoanRepaymentComponent;
  let loan: LoanServiceStub;
  let navigate: MockInstance<Router['navigate']>;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines the
  // cast to one line and keeps the DOM assertions type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The rendered text of the host, whitespace-collapsed for a stable containment test. */
  function renderedText(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /** The payment-type select the shared field renders. */
  function paymentSelect(): HTMLSelectElement | null {
    const element: unknown = host().querySelector('app-select-field select');

    return element instanceof HTMLSelectElement ? element : null;
  }

  /** The amount field's own input, which renders the seeded figure. */
  function amountInput(): HTMLInputElement | null {
    const element: unknown = host().querySelector('#transactionAmount');

    return element instanceof HTMLInputElement ? element : null;
  }

  /** The date field's own input, which renders the seeded date as `yyyy-MM-dd`. */
  function dateInput(): HTMLInputElement | null {
    const element: unknown = host().querySelector('#transactionDate');

    return element instanceof HTMLInputElement ? element : null;
  }

  /** The visible option texts of the picker, in render order. */
  function optionTexts(select: HTMLSelectElement): string[] {
    return Array.from(select.options).map((option) => (option.textContent ?? '').trim());
  }

  /** The text of the option the picker currently shows as chosen, or `null` when it shows none. */
  function selectedText(select: HTMLSelectElement): string | null {
    return select.selectedIndex < 0 ? null : (select.options[select.selectedIndex]?.textContent ?? '').trim();
  }

  /** Lets the screen's read answer and the first paint show it. */
  async function settle(): Promise<void> {
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /**
   * Mounts the screen for one loan and renders it once.
   *
   * The `loanId` input is set before the first change detection: the component reads it inside an
   * effect, and a required input that has no value yet would throw when that effect runs.
   *
   * @param id the loan the screen is opened for.
   */
  async function show(id: string): Promise<void> {
    fixture = TestBed.createComponent(LoanRepaymentComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('loanId', id);
    fixture.detectChanges();
    await settle();
  }

  /**
   * Moves the mounted screen to another loan the way the router does when only the `:id` segment
   * changes: the same component instance stays on screen and `LoanActionComponent` re-binds the input.
   *
   * @param id the loan the URL names now.
   */
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

    // The real router is the one the template's `routerLink` needs, so the navigation a success makes
    // is spied on it rather than replaced by a stub.
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  it('seeds the form from the loan’s repayment template, first payment type included', async () => {
    await show(LOAN_ID);

    // One read, for the loan the input names and the repayment command: this screen issues no record
    // read, so the schedule is not its source (Rule 1 clauses 2 and 3).
    expect(loan.actionTemplate.mock.calls).toEqual([[LOAN_ID, 'repayment']]);
    expect(component.notFound()).toBe(false);
    expect(component.error()).toBeNull();

    // The picker offers the payload's options in the payload's order, and the first of them is the
    // control's value — the default legacy's repayment form applies.
    expect(component.paymentTypeOptions().map((option) => option.id)).toEqual(
      PAYMENT_TYPES.map((option) => option.id),
    );
    expect(component.form.controls.paymentTypeId.value).toBe(FIRST_PAYMENT_TYPE.id);

    // The amount and the date are the template's own, and the fields render them.
    expect(component.form.controls.transactionAmount.value).toBe(TEMPLATE_AMOUNT);
    expect(component.form.controls.transactionDate.value).toEqual(TEMPLATE_DATE);
    expect(amountInput()?.value).toBe(String(TEMPLATE_AMOUNT));
    expect(dateInput()?.value).toBe('2026-12-24');

    const select = paymentSelect();

    expect(select).not.toBeNull();
    // No blank row: legacy renders a plain `ng-options` select with no empty option.
    expect(optionTexts(select as HTMLSelectElement)).toEqual(PAYMENT_TYPE_NAMES);
    expect(selectedText(select as HTMLSelectElement)).toBe(FIRST_PAYMENT_TYPE.name);
  });

  it('re-seeds the form when the loan id changes, keeping nothing of the previous loan', async () => {
    loan.actionTemplate.mockImplementation((id) =>
      of(String(id) === SECOND_LOAN_ID ? SECOND_TEMPLATE : TEMPLATE),
    );

    await show(LOAN_ID);

    expect(component.form.controls.transactionAmount.value).toBe(TEMPLATE_AMOUNT);

    await moveTo(SECOND_LOAN_ID);

    // One read per binding, addressed by the id the input now holds.
    expect(loan.actionTemplate.mock.calls).toEqual([
      [LOAN_ID, 'repayment'],
      [SECOND_LOAN_ID, 'repayment'],
    ]);
    // Nothing of the first loan survives the move: neither its amount nor its payment type, which is
    // the figure a stale form would otherwise post against the second loan.
    expect(component.form.controls.transactionAmount.value).toBe(SECOND_TEMPLATE_AMOUNT);
    expect(component.form.controls.paymentTypeId.value).toBe(SECOND_PAYMENT_TYPE.id);
    expect(component.form.controls.transactionDate.value).toEqual(new Date(2027, 0, 15));
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

    // The first loan's read is still unanswered when the URL moves to the second loan, which is what a
    // move between two repayment routes produces when the earlier response is the slower one.
    await moveTo(SECOND_LOAN_ID);

    second.resolve(SECOND_TEMPLATE);
    await settle();

    expect(component.form.controls.transactionAmount.value).toBe(SECOND_TEMPLATE_AMOUNT);
    expect(component.form.controls.paymentTypeId.value).toBe(SECOND_PAYMENT_TYPE.id);

    // The earlier answer lands last. It is dropped rather than painted, so the first loan's figures can
    // never be posted against the second loan.
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

    // No validator was added to the payment type, so a template that offers none leaves the form
    // valid: the only required members are the date and the amount (Rule 1 clause 3; AAP 0.7.2).
    expect(component.form.controls.paymentTypeId.value).toBeNull();
    expect(component.form.controls.paymentTypeId.valid).toBe(true);
    expect(component.form.valid).toBe(true);
    expect(paymentSelect()?.options.length).toBe(0);

    await component.submit();

    // The POST is still issued — never refused client-side by a rule legacy does not have — and the
    // body carries no `paymentTypeId`, which is the body the legacy form posts with an empty list.
    expect(loan.repay).toHaveBeenCalledTimes(1);
    expect(loan.repay).toHaveBeenCalledWith(LOAN_ID, {
      transactionDate: TEMPLATE_DATE,
      transactionAmount: NO_PAYMENT_TYPE_TEMPLATE.amount,
    });

    const [, postedBody] = loan.repay.mock.calls[0];

    expect(Object.keys(postedBody)).not.toContain('paymentTypeId');
    expect(navigate).toHaveBeenCalledWith(['/viewloanaccount', LOAN_ID]);
  });

  it('renders the not-found state in place of the form when the template answers 404', async () => {
    loan.actionTemplate.mockReturnValue(
      throwError(() => new ApiError('The loan does not exist.', 404)),
    );

    await show(LOAN_ID);

    expect(component.notFound()).toBe(true);
    expect(component.error()).toBeNull();
    expect(renderedText()).toContain('error.msg.resource.not.found');
    // Nothing can be posted against a loan the server says is not there.
    expect(host().querySelector('form')).toBeNull();
    expect(loan.repay).not.toHaveBeenCalled();
  });
});
