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

/**
 * Behaviour of the new-application screen — `#/newclientloanaccount/:clientId`, workflow W4 (AAP 0.7.3
 * "W4 loan application"; AAP 0.7.4 loan screens; AAP 0.10.1), read through the one thing it inherits
 * from the router: the client the URL names.
 *
 * It pins the six things that fix must not lose and that a rewrite would get wrong:
 *
 *  1. the screen reads the template once for the routed client and offers the payload's option lists in
 *     the payload's order — nothing sorted, filtered or invented (Rule 1 clause 3);
 *  2. a route that names no usable client — a non-numeric or fractional segment, or no segment at all —
 *     reads nothing and renders its not-found message in place of the form (AAP 0.7.4 state rules;
 *     Rule 1 clause 2, which is why no `clientId: NaN` is ever posted);
 *  3. every emission of `route.paramMap` re-reads the template for the client the URL now names and
 *     clears the previous client's application — its control values, its option lists, its preview and
 *     its message — so an in-place move from one client's application to another replaces the screen
 *     instead of leaving the first client's form in place and issuing no request; an answer for the
 *     route the URL has left is discarded rather than painted (the reuse fix `loan-edit`,
 *     `client-actions` and `loan-view` carry);
 *  4. the application that is posted is the one addressed by the client the URL currently names, so a
 *     move cannot submit one client's application against another;
 *  5. the preview and the submission post one body, so the schedule the applicant saw is the schedule
 *     of the loan that is created, and neither trigger reaches the API twice (workflow W4);
 *  6. nothing on the screen bounds the principal, and a rejection is rendered as the server worded it —
 *     verbatim on a 4xx, and not at all on a 5xx, which the interceptor has already notified (workflow
 *     W7; AAP 0.7.2 "Rendered verbatim"; Rule 1 clause 3).
 *
 * **What is stubbed, and why.** Only the collaborations a unit test cannot own: `LoanService`, whose
 * endpoint-level contract — method, path, query parameters and the `dateFormat`/`locale` members of the
 * body — belongs to `loan.service.spec.ts`; and the translation stack, which is asked for display text
 * only. The router is a real `provideRouter([])`, so the Cancel link renders the href the application
 * would render.
 */

/** The client the screen is opened for: the `:clientId` segment of the route. */
const CLIENT_ID = 2;

/** The client a second emission moves the same component to. */
const SECOND_CLIENT_ID = 12;

/**
 * The products the template offers, deliberately in a non-alphabetical order so a screen that sorted
 * them would be caught (Rule 1 clause 3).
 */
const PRODUCTS: LoanTemplate['productOptions'] = [
  { id: 3, name: 'Parity Loan' },
  { id: 1, name: 'Ancillary Loan' },
];

/** The payload's product labels, in payload order. */
const PRODUCT_NAMES: readonly string[] = PRODUCTS.map((product) => product.name);

/** The template the routed client's read answers with: every member the form seeds itself from. */
const TEMPLATE: LoanTemplate = {
  clientId: CLIENT_ID,
  clientName: 'Ada Okafor',
  product: PRODUCTS[0],
  productOptions: PRODUCTS,
  principal: 5000,
  termFrequency: 12,
  termPeriodFrequencyType: { id: 2, value: 'Months' },
  numberOfRepayments: 12,
  repaymentEvery: 1,
  repaymentFrequencyType: 2,
  interestRatePerPeriod: 2.5,
  interestRateFrequencyType: 3,
  amortizationType: 1,
  interestType: 0,
  interestCalculationPeriodType: 1,
  transactionProcessingStrategyCode: 'mifos-standard-strategy',
  transactionProcessingStrategyOptions: [
    { code: 'mifos-standard-strategy', name: 'Mifos standard strategy' },
    { code: 'early-repayment-strategy', name: 'Early repayment strategy' },
  ],
  expectedDisbursementDate: '2026-11-24',
  submittedOnDate: '2026-11-24',
  loanOfficerOptions: [{ id: 7, name: 'Officer, Parity' }],
  fundOptions: [{ id: 2, name: 'Fund' }],
  charges: [],
};

/** The second client's template: another product list and another principal. */
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

/** The charge the application offers, at the amount `GET /loans/template` publishes for it. */
const CHARGES: readonly LoanChargeOption[] = [
  { id: 3, name: 'Parity Fee', amount: 40, chargeTimeType: { id: 2, value: 'Specified due date' } },
];

/** The charge the amount case picks from that list. */
const PICKED_CHARGE_ID = 3;

/**
 * The `GET /charges/{id}?template=true` answer the amount case reads: the charge itself, whose own
 * `amount` is a top-level member, and no `chargeOptions` list at all.
 */
const CHARGE_TEMPLATE: ChargeTemplate = { amount: 25 };

/**
 * The principal workflow W7 submits: above the `Parity Loan` product's 10,000 maximum, so that only
 * Fineract can refuse it. It is no boundary of this screen's, because the screen holds none — a
 * client-side limit would block the submission W7 exists to prove (Rule 1 clause 3).
 */
const PRINCIPAL_ABOVE_PRODUCT_MAX = 50_000;

/** The text Fineract answers W7's rejection with, which the screen renders character for character. */
const SERVER_MESSAGE = 'The principal amount must be between 1,000 and 10,000.00 (inclusive).';

/** One scheduled repayment, as `POST /loans?command=calculateLoanSchedule` reports it. */
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

/** The schedule the preview answers with: one row per one of the application's twelve repayments. */
const SCHEDULE: RepaymentSchedule = {
  periods: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(scheduledPeriod),
  totalPrincipalDisbursed: 5000,
  totalRepaymentExpected: 5600,
  totalOutstanding: 5600,
};

/**
 * The `:clientId` segments that name no client, each described for the case's title: a non-numeric,
 * zero, negative, fractional and blank segment, plus the absent parameter a URL that carries none
 * reads as. None of them may reach a request, and each must put the screen in its not-found state.
 */
const INVALID_CLIENT_ID_SEGMENTS: [string, string | null][] = [
  ['a non-numeric segment', 'abc'],
  ['a fractional segment', '2.5'],
  ['an absent parameter', null],
];

/**
 * `LoanService` as this screen uses it: the template reads and the two posts, all stubbed.
 *
 * Each stub is typed from the real service member rather than re-declared, so a change to a
 * signature is a compile error here instead of an assertion that quietly stops describing the
 * screen. The endpoint-level contract — method, path, query parameters and the `dateFormat`/`locale`
 * pair of the body — belongs to `loan.service.spec.ts` (Rule 1 clauses 2 and 4).
 */
interface LoanServiceStub {
  readonly template: Mock<LoanService['template']>;
  readonly chargeTemplate: Mock<LoanService['chargeTemplate']>;
  readonly previewSchedule: Mock<LoanService['previewSchedule']>;
  readonly create: Mock<LoanService['create']>;
}

/**
 * The ngx-translate surface this screen touches: the `translate()` signal `TranslatePipe` 18 resolves
 * its keys through, plus the members the shared fields and the preview read. Nothing here reaches the
 * network.
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

describe('LoanNewComponent', () => {
  let fixture: ComponentFixture<LoanNewComponent>;
  let component: LoanNewComponent;
  let loanService: LoanServiceStub;
  let navigate: MockInstance<Router['navigate']>;
  let routeParams: BehaviorSubject<ParamMap>;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines the
  // cast to one line and keeps the DOM assertions type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The route stub's parameter map for one application URL. */
  function paramsFor(clientId: string | null): ParamMap {
    const params: Record<string, string> = {};

    if (clientId !== null) {
      params['clientId'] = clientId;
    }

    return convertToParamMap(params);
  }

  /** The rendered text of the host, whitespace-collapsed for a stable containment test. */
  function renderedText(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /** The Cancel link beside the two triggers, which returns to the client the URL names. */
  function cancelHref(): string | null {
    return host().querySelector('a.btn-default')?.getAttribute('href') ?? null;
  }

  /**
   * The labels a rendered `<select>` offers, in render order — the prompt row first when the field
   * was given one, then the options it was handed, untouched and unsorted (Rule 1 clause 3).
   */
  function optionLabels(selector: string): readonly string[] {
    const select = host().querySelector(selector);

    return select === null
      ? []
      : Array.from(select.querySelectorAll('option')).map((option) => (option.textContent ?? '').trim());
  }

  /** The form's two triggers in render order: "Preview schedule", then "Submit". */
  function triggers(): readonly HTMLButtonElement[] {
    return Array.from(host().querySelectorAll<HTMLButtonElement>('form button.btn-primary'));
  }

  /** Lets the screen's template read answer and the first paint show it. */
  async function settle(): Promise<void> {
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /**
   * Mounts the screen for one application URL and renders it once.
   *
   * The component's constructor subscribes to the route's parameters, so the first emission and its
   * read happen as the component is created.
   *
   * @param segment the `:clientId` segment, or `null` for a route that carries none.
   */
  async function show(segment: string | null): Promise<void> {
    routeParams.next(paramsFor(segment));

    fixture = TestBed.createComponent(LoanNewComponent);
    component = fixture.componentInstance;
    await settle();
  }

  /**
   * Moves the mounted screen to another application URL the way the router does when only the segment
   * changes: the same component instance stays on screen and the parameter map emits again.
   */
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

    // The payload's own values, passed through untouched (Rule 1 clause 3).
    expect(component.productOptions().map((option) => option.name)).toEqual(PRODUCT_NAMES);
    expect(component.form.controls.principal.value).toBe(TEMPLATE.principal);
    expect(component.form.controls.numberOfRepayments.value).toBe(TEMPLATE.numberOfRepayments);
    expect(component.form.controls.repaymentEvery.value).toBe(TEMPLATE.repaymentEvery);
    expect(component.form.controls.interestRatePerPeriod.value).toBe(TEMPLATE.interestRatePerPeriod);
    // Both dated fields hold a `Date`, never a formatted string: `LoanService` writes the format and
    // the locale at the wire boundary (AAP 0.7.2 "Date handling").
    expect(component.form.controls.expectedDisbursementDate.value).toBeInstanceOf(Date);
    expect(component.form.controls.submittedOnDate.value).toBeInstanceOf(Date);
    // Cancel returns to the client the route names, and nothing has been posted.
    expect(cancelHref()).toBe(`/viewclient/${CLIENT_ID}`);
    expect(loanService.create).not.toHaveBeenCalled();
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
    // The charge's own template is the authority for its amount, so the row carries the figure that
    // payload reports rather than the one `GET /loans/template` published for the same charge.
    expect(component.chargeRows.at(0).controls.amount.value).toBe(CHARGE_TEMPLATE.amount);
    expect(component.error()).toBeNull();
  });

  it.each(INVALID_CLIENT_ID_SEGMENTS)(
    'shows the not-found message and reads nothing for %s',
    async (_description: string, segment: string | null) => {
      // The service below would answer a valid payload, so the absence of a request is the screen's own
      // decision about the route rather than a stub that happened to answer nothing.
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

    // One load per emission, addressed by the client the URL now names…
    expect(loanService.template.mock.calls).toEqual([
      [CLIENT_ID, undefined],
      [SECOND_CLIENT_ID, undefined],
    ]);
    expect(component.clientId()).toBe(String(SECOND_CLIENT_ID));
    // …and nothing of the first client's application survives it: the typed amount is gone and the
    // option lists are the new payload's.
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

    // The first client's read is still unanswered when the URL moves to the second client, which is
    // what a move between two application URLs produces when the earlier response is the slower one.
    await navigateTo(String(SECOND_CLIENT_ID));

    second.resolve(SECOND_TEMPLATE);
    await settle();

    expect(component.form.controls.principal.value).toBe(SECOND_TEMPLATE.principal);
    expect(component.loading()).toBe(false);

    // The earlier answer lands last. It is dropped rather than painted, so the first client's product
    // list and amounts can never appear under the second client's URL.
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
    // The body carries the client the URL names, and only the values the form holds.
    expect(loanService.create.mock.calls[0]?.[0]).toMatchObject({
      clientId: SECOND_CLIENT_ID,
      productId: SECOND_TEMPLATE.product?.id,
      principal: SECOND_TEMPLATE.principal,
    });
    expect(navigate).toHaveBeenCalledWith(['/viewloanaccount', 41]);
  });

  it('reports a submission the server answered without a loan id, and opens no record', async () => {
    // `POST /loans` succeeded and created the loan, but its answer names no id this screen can address
    // the record with — the silent return this case pins (AAP 0.14.2).
    loanService.create.mockReturnValue(of({}));

    await show(String(CLIENT_ID));
    await component.submit();
    fixture.detectChanges();

    expect(loanService.create).toHaveBeenCalledTimes(1);
    // Nothing is opened, because there is no id to open.
    expect(navigate).not.toHaveBeenCalled();
    // …and the outcome is rendered rather than swallowed: the loan exists on the server, so the user
    // has to be told the record cannot be opened from here.
    expect(component.submittedWithoutId()).toBe(true);
    expect(host().querySelector('.alert-warning[role="alert"]')?.textContent).toContain(
      'the server reported no loan identifier',
    );
    // It is not Fineract's own failure text, so the verbatim server-message region stays empty.
    expect(component.error()).toBeNull();

    // The notice describes one submission, so the next URL's screen does not inherit it.
    await navigateTo(String(SECOND_CLIENT_ID));

    expect(component.submittedWithoutId()).toBe(false);
    expect(host().querySelector('.alert-warning')).toBeNull();
  });

  it('offers the template’s products in its own order, with nothing sorted or filtered', async () => {
    await show(String(CLIENT_ID));

    // The shared field renders the prompt row it is given first, then the payload's rows in the
    // payload's order — `Parity Loan` before `Ancillary Loan`, so a screen that sorted them fails.
    expect(optionLabels('#productId')).toEqual(['label.selectloanproduct', ...PRODUCT_NAMES]);
    expect(component.form.controls.productId.value).toBe(PRODUCTS[0].id);
  });

  it('offers only the charges the template lists, in its order', async () => {
    loanService.template.mockReturnValue(of({ ...TEMPLATE, chargeOptions: CHARGES }));

    await show(String(CLIENT_ID));
    component.addCharge();
    fixture.detectChanges();

    // A charge the template does not list has no row to be picked in, so the application can never
    // post a charge the server did not offer it (Rule 1 clause 2).
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

    // No min, no max, no pattern: nothing in this screen stops a submission Fineract has to judge,
    // which is what makes W7's rejection the server's own (Rule 1 clause 3; AAP 0.7.2).
    expect(principal.errors).toBeNull();
    expect(principal.hasError('min')).toBe(false);
    expect(principal.hasError('max')).toBe(false);

    principal.setValue(PRINCIPAL_ABOVE_PRODUCT_MAX);
    expect(principal.errors).toBeNull();

    // The browser is bound nowhere either, so it cannot block the request before the API sees it.
    const input = host().querySelector('#principal');
    expect(input?.getAttribute('min')).toBeNull();
    expect(input?.getAttribute('max')).toBeNull();

    // A charge row's amount carries the same `required`-only rule as the principal.
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
    // The calculated schedule is what the preview renders, period for period (AAP 0.7.4; W4).
    expect(host().querySelectorAll('#repayment-preview tbody tr')).toHaveLength(
      SCHEDULE.periods.length,
    );

    await component.submit();
    await settle();

    // One builder, two triggers: the previewed application is the submitted one (AAP 0.7.2, W4).
    expect(loanService.create).toHaveBeenCalledTimes(1);
    expect(loanService.create.mock.calls[0][0]).toEqual(previewed);
    expect(navigate).toHaveBeenCalledWith(['/viewloanaccount', 42]);
  });

  it('renders a rejected application’s message verbatim and keeps every entered value', async () => {
    loanService.create.mockReturnValue(throwError(() => new ApiError(SERVER_MESSAGE, 400)));

    await show(String(CLIENT_ID));
    component.form.controls.principal.setValue(PRINCIPAL_ABOVE_PRODUCT_MAX);
    component.form.controls.numberOfRepayments.setValue(10);

    await component.submit();
    fixture.detectChanges();

    // Fineract's own text, character for character: no prefix, suffix, translation or reformatting
    // (W7; AAP 0.7.2 "Rendered verbatim"; Rule 1 clause 3).
    expect(host().querySelector('.alert.alert-danger')?.textContent).toBe(SERVER_MESSAGE);
    // The rejected value is the value that was posted, and it is still on the form and on screen.
    expect(loanService.create.mock.calls[0][0].principal).toBe(PRINCIPAL_ABOVE_PRODUCT_MAX);
    expect(component.form.controls.principal.value).toBe(PRINCIPAL_ABOVE_PRODUCT_MAX);
    expect(component.form.controls.numberOfRepayments.value).toBe(10);
    expect(host().querySelector('#principal')).not.toBeNull();
    // Nothing is opened, because the loan was never created.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves a server-side failure to the interceptor’s notification alone', async () => {
    loanService.create.mockReturnValue(
      throwError(() => new ApiError('An unexpected error occurred.', 503)),
    );

    await show(String(CLIENT_ID));
    await component.submit();
    fixture.detectChanges();

    // A 5xx already raised exactly one notification in the interceptor, so this screen paints no
    // second surface for it (AAP 0.7.4; AAP 0.14.2; Rule 1 clause 3)…
    expect(component.error()).toBeNull();
    expect(host().querySelector('.alert.alert-danger')).toBeNull();
    // …and the form stays usable, with the values the applicant entered.
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

    // A second press of either trigger reaches nothing: the schedule calculation and the submission
    // are not idempotent, so one press is one request (AAP 0.1.1; AAP 0.14.1 "one request per click").
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
