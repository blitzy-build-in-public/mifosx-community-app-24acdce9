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

/**
 * Behaviour of the loan charge screen — the add form of `#/addloancharge/:id` and the pay and waive
 * forms of `#/loanaccountcharge/:id/:action/:chargeId` (AAP 0.7.3 row "Loan charges"; AAP 0.7.4 "the
 * action screens … are single-purpose forms"; AAP 0.8.2 feature routes).
 *
 * It pins the things the screen exists to do and that a rewrite would get wrong:
 *
 *  1. the add route reads the charge template once, for the loan its `:id` names, and offers the
 *     payload's options in the payload's order — nothing sorted, filtered or relabelled (Rule 1
 *     clause 3);
 *  2. the add form posts the picked charge and the amount it seeded, adds `dueDate` only for a charge
 *     that falls due on a specified date, and carries no `dateFormat` or `locale`, which the service
 *     writes itself (AAP 0.7.2 row `LoanChargeRequest`; Rule 1 clause 2);
 *  3. the pay route posts the date the payment is recorded on and the waive route posts the command
 *     alone, because the endpoint pays or waives the charge's whole outstanding portion and refuses
 *     an `amount` and a `paymentTypeId` — so neither is collected, let alone sent;
 *  4. the pay and waive routes read nothing at all, because the bodies their endpoints accept carry
 *     only what their own field collects;
 *  5. an `:action` this application does not serve, and a route that names no loan, put the screen into
 *     its not-found state, offer no form and issue no request (AAP 0.7.4 state rules; AAP 0.9.2);
 *  6. a successful submit returns to `/viewloanaccount/:id`, one click sends exactly one POST because
 *     the trigger disables itself while the request is in flight, `Cancel` posts nothing, and a
 *     rejected POST paints Fineract's own text verbatim above a form that keeps every entered value
 *     and raises no second notice (AAP 0.1.1, 0.7.4, 0.14.1; workflow W5);
 *  7. every emission of `route.paramMap` re-resolves the mode, clears the previous emission's picker,
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
 * template renders the href the application would render. The notification queue is the shipped
 * service, observed rather than replaced: this screen must raise no notice of its own, because the one
 * interceptor owns that for a 5xx or a transport failure.
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

/**
 * The disbursement-timed charge: its amount seeds the form the same way, and it asks for no due date,
 * so the add body it produces carries the charge and the amount and nothing else.
 */
const DISBURSEMENT_CHARGE_ID = 1;

/**
 * A charge whose amount does not divide evenly, so a `toFixed` or `Math.round` anywhere between the
 * payload and the posted body shows up as a wrong value instead of coinciding with the right one.
 */
const UNROUNDED_AMOUNT = 60.35;

/** The template carrying {@link UNROUNDED_AMOUNT}, offered by the cases that pin the seed's exactness. */
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

/** The charge id {@link UNROUNDED_TEMPLATE} offers, which the seed cases pick. */
const UNROUNDED_CHARGE_ID = 5;

/** The due date a specified-due-date case enters, held as a `Date` and posted as the same value. */
const DUE_DATE = new Date(2026, 10, 24);

/** The date a pay case records its payment on. */
const PAYMENT_DATE = new Date(2026, 10, 25);

/** The amount an error case types, distinct from any the payload seeds, so preservation is visible. */
const ENTERED_AMOUNT = 87.5;

/**
 * An amount far above any bound a product could set, used to prove the form applies none of its own:
 * workflow W7 depends on Fineract alone rejecting an out-of-range amount (Rule 1 clause 3).
 */
const OUT_OF_RANGE_AMOUNT = 50_000;

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

  /**
   * `GET /loans/{id}` and `GET /loans/{id}/transactions/template`, which this screen must never call:
   * the charge record and the payment types are not members of any body it posts. They are stubbed
   * with no return value, so a call would fail the run loudly rather than answer an unused payload,
   * and the cases below assert they are never called (AAP 0.7.3 row "Loan charges").
   */
  readonly get: Mock<(id: number | string) => Observable<LoanAccount>>;

  readonly actionTemplate: Mock<
    (
      id: number | string,
      command: 'disburse' | 'repayment',
    ) => Observable<LoanTransactionTemplate>
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
  let notify: MockInstance<NotificationService['show']>;
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

  /** The primary control, which posts the screen's one request and disables itself while it does. */
  function saveButton(): HTMLButtonElement | null {
    const element: unknown = host().querySelector('#save');

    return element instanceof HTMLButtonElement ? element : null;
  }

  /** The add form's amount field, which only add mode renders once a charge is picked. */
  function amountInput(): HTMLInputElement | null {
    const element: unknown = host().querySelector('#amount');

    return element instanceof HTMLInputElement ? element : null;
  }

  /** Whether the screen renders a field with `id`, whichever mode's section owns it. */
  function hasField(id: string): boolean {
    return host().querySelector(`#${id}`) !== null;
  }

  /**
   * The amount the fixture template states for one charge, which the add form seeds its amount field
   * from. Reading it out of the payload rather than repeating the number keeps each assertion tied to
   * the fixture a regression would change.
   */
  function seededAmount(chargeId: number): number {
    const option = CHARGE_OPTIONS.find((row) => row.id === chargeId);

    if (option?.amount === undefined) {
      throw new Error(`the fixture states no amount for charge ${chargeId}`);
    }

    return option.amount;
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

    // The real router is the one the template's `routerLink`s need, so the navigation a success makes
    // is spied on it rather than replaced by a stub.
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    // The shipped queue, observed rather than replaced: this screen must raise no notice of its own,
    // because the one interceptor owns the notice a 5xx or a transport failure produces (AAP 0.7.4).
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
    // The prompt row, then the payload's rows in the payload's order — never sorted by name or id.
    expect(optionTexts(select as HTMLSelectElement)).toEqual([
      'label.selectcharge',
      ...OPTION_NAMES,
    ]);
    // One read and no other: this mode reads no charge record and no payment-type list, because
    // neither is a member of the body the add form posts (AAP 0.7.3 row "Loan charges").
    expect(loan.get).not.toHaveBeenCalled();
    expect(loan.actionTemplate).not.toHaveBeenCalled();
    // Cancel returns to the loan the route names.
    expect(cancelHref()).toBe(`/viewloanaccount/${LOAN_ID}`);
  });

  it('renders an empty picker, not a failure, when the payload carries no chargeOptions', async () => {
    // A payload that omits the key altogether: the screen must offer no charge and stay usable, rather
    // than handing `undefined` to the shared select field's `@for` and failing the screen.
    loan.chargeTemplateFor.mockReturnValue(of({}));

    await show(LOAN_ID);

    expect(loan.chargeTemplateFor.mock.calls).toEqual([[LOAN_ID]]);
    expect(component.notFound()).toBe(false);
    expect(component.loading()).toBe(false);
    expect(component.error()).toBeNull();
    expect(component.chargeOptions()).toEqual([]);

    const select = chargeSelect();

    expect(select).not.toBeNull();
    // The prompt row alone: no option row exists for the picker to offer.
    expect(optionTexts(select as HTMLSelectElement)).toEqual(['label.selectcharge']);
    expect(host().querySelector('#save')).not.toBeNull();
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
      // The message sits in the card in place of the form, and the rest of the shell stays usable:
      // no field, no submit and no cancel (AAP 0.7.4 state rules; AAP 0.9.2).
      expect(host().querySelector('.text-center.text-muted')?.textContent?.trim()).toBe(
        'error.msg.resource.not.found',
      );
      expect(host().querySelectorAll('form')).toHaveLength(0);
      expect(host().querySelector('#save')).toBeNull();
      expect(host().querySelector('#cancel')).toBeNull();
      // And no request of any kind: not the charge template, not the loan, not the payment types,
      // and certainly not a write against a loan whose screen this application does not serve.
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
    expect(optionTexts(select as HTMLSelectElement)).toContain(SECOND_TEMPLATE.chargeOptions?.[0]?.name);
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
      (SECOND_TEMPLATE.chargeOptions ?? []).map((option) => option.name),
    );
    expect(component.loading()).toBe(false);

    // The earlier answer lands last. It is dropped rather than painted, so the first loan's charges can
    // never be offered under the second loan's URL.
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
    // The form's own values: the picked charge definition and the amount the payload seeded.
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

    // The routed loan, and the two members the endpoint takes from this screen. No `dateFormat` and no
    // `locale`: the service writes that pair as it serialises, so the form never holds one
    // (AAP 0.7.2 row `LoanChargeRequest`; Rule 1 clause 2). No `dueDate` either, because this charge
    // falls due at disbursement.
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

      // The date control exists exactly for the charge whose timing carries a specified date — the
      // legacy `chargeTimeType.id == 2` test the class reproduces (Rule 1 clause 3).
      expect(hasField('dueDate')).toBe(requiresDueDate);

      component.form.controls.dueDate.setValue(DUE_DATE);
      fixture.detectChanges();

      await component.submit();

      expect(loan.addCharge).toHaveBeenCalledTimes(1);
      const body = loan.addCharge.mock.calls[0]?.[1];

      expect(body?.chargeId).toBe(chargeId);
      expect(body?.amount).toBe(seededAmount(chargeId));

      if (requiresDueDate) {
        // The value the control holds, not a formatted copy of it: the service formats it on the way
        // out, so the member here can never be an empty string or a day shifted by a timezone.
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

    // The payload's own figure, unrounded and unformatted, in the control and in the rendered field.
    expect(component.form.controls.amount.value).toBe(UNROUNDED_AMOUNT);
    expect(amountInput()?.value).toBe(String(UNROUNDED_AMOUNT));

    await component.submit();

    // And the same figure on the wire: a `toFixed` or a `Math.round` on the way through would show up
    // here as 60, and this screen has no reason to reshape a fee the server stated (Rule 1 clause 3).
    expect(loan.addCharge.mock.calls[0]?.[1]?.amount).toBe(UNROUNDED_AMOUNT);
    expect(navigate).toHaveBeenCalledWith(['/viewloanaccount', LOAN_ID]);
  });

  it('posts the payment date of the pay route and collects no amount or payment type', async () => {
    await show(LOAN_ID, 'pay', CHARGE_ID);

    // The command's one field, and neither of the two members the endpoint refuses.
    expect(hasField('transactionDate')).toBe(true);
    expect(hasField('amount')).toBe(false);
    expect(hasField('paymentTypeId')).toBe(false);

    component.form.controls.transactionDate.setValue(PAYMENT_DATE);
    fixture.detectChanges();

    await component.submit();

    expect(loan.chargeAction).toHaveBeenCalledTimes(1);
    const call = loan.chargeAction.mock.calls[0];

    // The route's own segments: the loan from `:id`, the loan-charge row from `:chargeId`, and the
    // command in the third position, which the service turns into the query string.
    expect(call?.[0]).toBe(LOAN_ID);
    expect(call?.[1]).toBe(CHARGE_ID);
    expect(call?.[2]).toBe('pay');

    const body = call?.[3];

    expect(Object.keys(body ?? {}).sort()).toEqual(['command', 'transactionDate']);
    expect(body).toEqual({ command: 'pay', transactionDate: PAYMENT_DATE });
    // No payment-type list is read either, because the body carries no payment type to choose from.
    expect(loan.actionTemplate).not.toHaveBeenCalled();
    expect(loan.chargeTemplateFor).not.toHaveBeenCalled();
    expect(loan.get).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/viewloanaccount', LOAN_ID]);
  });

  it('waives the route’s charge with the command alone, collecting and reading nothing else', async () => {
    await show(LOAN_ID, 'waive', CHARGE_ID);

    // A waiver books no money movement, no date and no payment type, so the screen renders no field:
    // the form is there, and every control that posts nothing is absent from it.
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
    // The discriminating command and nothing beside it — no `transactionDate`, no `paymentTypeId`, and
    // no `amount`, all of which the endpoint refuses on ?command=waive (Rule 1 clause 2).
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

    // The link is a routerLink, so the navigation is the router's and the only request this screen
    // owns is the POST its primary control makes. Leaving posts nothing (AAP 0.7.4).
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

    // One click, one POST, and the trigger is disabled for as long as that POST is unanswered.
    expect(loan.addCharge).toHaveBeenCalledTimes(1);
    expect(saveButton()?.disabled).toBe(true);

    // A second attempt while the first is in flight — the click, and the class's own entry point,
    // which is the path a keyboard submission takes — posts nothing: Fineract's action endpoints are
    // not idempotent, so the guard refuses re-entry rather than queueing it (AAP 0.1.1, 0.14.1; W5).
    saveButton()?.click();
    await component.submit();
    fixture.detectChanges();

    expect(loan.addCharge).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();

    inFlight.next({ resourceId: 5 });
    inFlight.complete();

    // The guarded call finishes on the microtask queue and re-settles the signal that drives the
    // trigger's disabled state, so the enabled button is awaited rather than assumed.
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

    // The server's text, character for character — no prefix, no suffix, no case change — because
    // workflow W7 compares what the screen shows with `errors[].defaultUserMessage` (Rule 1 clause 3).
    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(rejected);
    // The form survives the rejection holding what the user entered, so one correction and a retry is
    // all a failure costs them (AAP 0.7.4).
    expect(host().querySelectorAll('form')).toHaveLength(1);
    expect(amountInput()?.value).toBe(String(ENTERED_AMOUNT));
    expect(component.form.controls.amount.value).toBe(ENTERED_AMOUNT);
    expect(component.form.controls.chargeId.value).toBe(DISBURSEMENT_CHARGE_ID);
    expect(navigate).not.toHaveBeenCalled();
    // One failure, one report: the inline region is this screen's whole account of a 4xx, and the
    // interceptor owns the notice a 5xx or a transport fault raises (AAP 0.7.4; AAP 0.14.2).
    expect(notify).not.toHaveBeenCalled();
  });

  it('leaves the amount unbounded so Fineract alone rejects an out-of-range value', async () => {
    await show(LOAN_ID);
    component.form.controls.chargeId.setValue(DISBURSEMENT_CHARGE_ID);
    component.form.controls.amount.setValue(OUT_OF_RANGE_AMOUNT);
    fixture.detectChanges();

    // No `max`, no `min`, no pattern and no native `required`: the only rule the field carries is the
    // one the legacy form carries. Workflow W7 depends on this — a client-side bound would block the
    // very POST Fineract must answer (Rule 1 clause 3; AAP 0.7.2 row `LoanChargeRequest`).
    expect(component.form.controls.amount.errors).toBeNull();
    expect(component.form.controls.amount.valid).toBe(true);
    expect(amountInput()?.hasAttribute('min')).toBe(false);
    expect(amountInput()?.hasAttribute('max')).toBe(false);
    expect(amountInput()?.hasAttribute('required')).toBe(false);

    await component.submit();

    // The figure reaches the service unchanged, so the server is the one that decides.
    expect(loan.addCharge).toHaveBeenCalledTimes(1);
    expect(loan.addCharge.mock.calls[0]?.[1]?.amount).toBe(OUT_OF_RANGE_AMOUNT);

    // And the `required` rule the legacy form does carry is still attached.
    component.form.controls.amount.setValue(null);

    expect(component.form.controls.amount.hasError('required')).toBe(true);
  });
});
