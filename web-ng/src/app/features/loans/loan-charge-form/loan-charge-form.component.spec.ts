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
import type { ChargeTemplate, LoanActionResult, LoanChargeOption } from '../loan.models';
import {
  LoanService,
  type LoanChargeActionInput,
  type LoanChargeInput,
} from '../loan.service';
import { LoanChargeFormComponent } from './loan-charge-form.component';

/**
 * Behaviour of the loan charge screen — the add form of `#/addloancharge/:id` and the pay and waive
 * forms of `#/loanaccountcharge/:id/:action/:chargeId` (AAP 0.7.3 row "Loan charges"; AAP 0.7.4 "the
 * action screens … are single-purpose forms"; AAP 0.8.2 feature routes).
 *
 * It pins the four things the screen exists to do and that a rewrite would get wrong:
 *
 *  1. the add route reads the charge template once, for the loan its `:id` names, and offers the
 *     payload's options in the payload's order — nothing sorted, filtered or relabelled (Rule 1
 *     clause 3);
 *  2. the pay and waive routes read nothing at all, because the bodies their endpoints accept carry
 *     only what their own field collects;
 *  3. an `:action` this application does not serve, and a route that names no loan, put the screen into
 *     its not-found state and issue no request (AAP 0.7.4 state rules; AAP 0.9.2);
 *  4. every emission of `route.paramMap` re-resolves the mode, clears the previous emission's picker,
 *     entered values and message, and re-runs the read the new route needs — so an in-place move from
 *     one loan's charge route to another replaces the screen instead of leaving the first loan's form
 *     in place and issuing no request; an answer for the route the URL has left is discarded rather
 *     than painted (the reuse fix `loan-edit` and `client-actions` carry).
 *
 * **What is stubbed, and why.** Only the collaborations a unit test cannot own: `LoanService`, whose
 * endpoint-level contract — method, path, query parameters and the `dateFormat`/`locale` members of the
 * body — belongs to `loan.service.spec.ts`, and the translation stack, which is asked for display text
 * only. The date and select controls are the shipped shared components, the submit guard is the
 * application's own, and the router is a real `provideRouter([])`, so every `routerLink` in the
 * template renders the href the application would render.
 */

/** The loan the screen is opened for: the `:id` segment of both routes. */
const LOAN_ID = '9';

/** The loan a second emission moves the same component to. */
const SECOND_LOAN_ID = '12';

/** The loan-charge id of the pay and waive routes: the charge row the loan carries. */
const CHARGE_ID = '21';

/** The charges the template offers, deliberately in a non-alphabetical order. */
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

/** The payload the add route reads: the four members this screen renders. */
const TEMPLATE: ChargeTemplate = { chargeOptions: CHARGE_OPTIONS };

/** The payload the second loan's add route reads; its options share no id or name with the first. */
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

/** The payload's option labels, in payload order. */
const OPTION_NAMES: readonly string[] = CHARGE_OPTIONS.map((option) => option.name);

/** The specified-due-date charge the add cases pick, whose amount the form seeds from the payload. */
const CHOSEN_CHARGE_ID = 3;

/** `LoanService` as this screen uses it: the one template read and the two writes, all stubbed. */
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
}

/**
 * The ngx-translate surface this screen touches: the `translate()` signal `TranslatePipe` 18 resolves
 * its keys through and the two change streams a component in this family subscribes to. Nothing here
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
 * An observable a case settles by hand, so one route's answer can be held open while the URL moves on
 * — the order in which a superseded read answers last.
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

describe('LoanChargeFormComponent', () => {
  let fixture: ComponentFixture<LoanChargeFormComponent>;
  let component: LoanChargeFormComponent;
  let loan: LoanServiceStub;
  let navigate: MockInstance<Router['navigate']>;
  let routeParams: BehaviorSubject<ParamMap>;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines the
  // cast to one line and keeps the DOM assertions type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The route stub's parameter map for one charge URL, absent segments omitted. */
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

  /** The rendered text of the host, whitespace-collapsed for a stable containment test. */
  function renderedText(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /** The add form's charge picker, which only add mode renders. */
  function chargeSelect(): HTMLSelectElement | null {
    const element: unknown = host().querySelector('app-select-field select');

    return element instanceof HTMLSelectElement ? element : null;
  }

  /** The visible option texts of the picker, in render order. */
  function optionTexts(select: HTMLSelectElement): string[] {
    return Array.from(select.options).map((option) => (option.textContent ?? '').trim());
  }

  /** The Cancel link, whose href names the loan the current route is for. */
  function cancelHref(): string | null {
    return host().querySelector('#cancel')?.getAttribute('href') ?? null;
  }

  /** Lets the screen's reads answer and the first paint show them. */
  async function settle(): Promise<void> {
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /**
   * Mounts the screen for one charge URL and renders it once.
   *
   * The component's constructor subscribes to the route's parameters, so the first emission and its
   * read happen as the component is created. The subject backing the route is recreated per case, so
   * one case's emissions cannot reach the next.
   *
   * @param id the `:id` segment, or `null` for a route that carries none.
   * @param action the `:action` segment, absent on the add route.
   * @param chargeId the `:chargeId` segment, absent on the add route.
   */
  async function show(
    id: string | null,
    action: string | null = null,
    chargeId: string | null = null,
  ): Promise<void> {
    // The subject the module was configured with is hot, so emitting the case's URL before the
    // component is created is what the router's own parameter map does on the first navigation.
    routeParams.next(paramsFor(id, action, chargeId));

    fixture = TestBed.createComponent(LoanChargeFormComponent);
    component = fixture.componentInstance;
    await settle();
  }

  /**
   * Moves the mounted screen to another charge URL the way the router does when only the segments
   * change: the same component instance stays on screen and the parameter map emits again.
   */
  async function navigateTo(
    id: string | null,
    action: string | null = null,
    chargeId: string | null = null,
  ): Promise<void> {
    routeParams.next(paramsFor(id, action, chargeId));
    await settle();
  }

  beforeEach(() => {
    loan = { chargeTemplateFor: vi.fn(), addCharge: vi.fn(), chargeAction: vi.fn() };
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

    // The real router is the one the template's `routerLink`s need, so the navigation a success makes
    // is spied on it rather than replaced by a stub.
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
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
    expect(optionTexts(select as HTMLSelectElement).filter((text) => OPTION_NAMES.includes(text))).toEqual(
      OPTION_NAMES,
    );
    // Cancel returns to the loan the route names.
    expect(cancelHref()).toBe(`/viewloanaccount/${LOAN_ID}`);
  });

  it.each<[string]>([['pay'], ['waive']])('reads nothing on the %s route', async (action) => {
    await show(LOAN_ID, action, CHARGE_ID);

    expect(loan.chargeTemplateFor).not.toHaveBeenCalled();
    expect(component.mode()).toBe(action);
    expect(component.notFound()).toBe(false);
    expect(component.loading()).toBe(false);
    // The mode's own field is the one rendered: the picker is add mode's alone.
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
      expect(loan.chargeTemplateFor).not.toHaveBeenCalled();
      expect(host().querySelector('#save')).toBeNull();
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

    // One load per emission, addressed by the id the URL now names…
    expect(loan.chargeTemplateFor.mock.calls).toEqual([[LOAN_ID], [SECOND_LOAN_ID]]);
    expect(component.loanId()).toBe(SECOND_LOAN_ID);
    // …and nothing of the first loan's screen survives it: no picked charge, no entered amount, no
    // message, and a picker that offers only the new loan's charges.
    expect(component.form.controls.chargeId.value).toBeNull();
    expect(component.form.controls.amount.value).toBeNull();
    expect(component.error()).toBeNull();

    const select = chargeSelect();

    expect(select).not.toBeNull();
    expect(optionTexts(select as HTMLSelectElement)).not.toContain(CHARGE_OPTIONS[0].name);
    expect(optionTexts(select as HTMLSelectElement)).toContain(SECOND_TEMPLATE.chargeOptions[0].name);
    expect(cancelHref()).toBe(`/viewloanaccount/${SECOND_LOAN_ID}`);
  });

  it('switches to the operation a second emission names, with no request and a cleared form', async () => {
    await show(LOAN_ID);
    component.form.controls.chargeId.setValue(CHOSEN_CHARGE_ID);
    fixture.detectChanges();

    await navigateTo(LOAN_ID, 'pay', CHARGE_ID);

    // The pay route reads nothing, so the template read stays the add route's one.
    expect(loan.chargeTemplateFor).toHaveBeenCalledTimes(1);
    expect(component.isPayMode()).toBe(true);
    expect(component.chargeId()).toBe(CHARGE_ID);
    // The add form's picked charge is gone, and the payment date is the pay form's own default.
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

    // The first loan's read is still unanswered when the URL moves to the second loan, which is what a
    // move between two charge routes produces when the earlier response is the slower one.
    await navigateTo(SECOND_LOAN_ID);

    second.resolve(SECOND_TEMPLATE);
    await settle();

    expect(component.chargeOptions().map((option) => option.name)).toEqual(
      SECOND_TEMPLATE.chargeOptions.map((option) => option.name),
    );
    expect(component.loading()).toBe(false);

    // The earlier answer lands last. It is dropped rather than painted, so the first loan's charges can
    // never be offered under the second loan's URL.
    first.resolve(TEMPLATE);
    await settle();

    expect(component.loanId()).toBe(SECOND_LOAN_ID);
    expect(component.chargeOptions().map((option) => option.name)).toEqual(
      SECOND_TEMPLATE.chargeOptions.map((option) => option.name),
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
    // The form's own values: the picked charge definition and the amount the payload seeded.
    expect(loan.addCharge.mock.calls[0]?.[0]).toBe(LOAN_ID);
    expect(loan.addCharge.mock.calls[0]?.[1]).toMatchObject({
      chargeId: CHOSEN_CHARGE_ID,
      amount: CHARGE_OPTIONS[0].amount,
    });
    expect(loan.chargeAction).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/viewloanaccount', LOAN_ID]);
  });

  it('shows Fineract’s own rejection verbatim and keeps every entered value', async () => {
    const rejected = 'The charge amount cannot be zero.';
    loan.addCharge.mockReturnValue(throwError(() => new ApiError(rejected, 400)));

    await show(LOAN_ID);
    component.form.controls.chargeId.setValue(CHOSEN_CHARGE_ID);
    fixture.detectChanges();

    await component.submit();
    fixture.detectChanges();

    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(rejected);
    expect(component.form.controls.chargeId.value).toBe(CHOSEN_CHARGE_ID);
    expect(component.form.controls.amount.value).toBe(CHARGE_OPTIONS[0].amount);
    expect(navigate).not.toHaveBeenCalled();
  });
});
