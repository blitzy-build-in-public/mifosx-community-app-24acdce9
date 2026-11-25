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
import { BehaviorSubject, Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';

import { AppConfigService } from '../../../core/config/app-config.service';
import type { AppConfig } from '../../../core/config/app-config.model';
import type {
  ChargeTemplate,
  LoanActionResult,
  LoanApplicationRequest,
  LoanChargeOption,
  LoanTemplate,
  RepaymentSchedule,
} from '../loan.models';
import { LoanService } from '../loan.service';
import { LoanNewComponent } from './loan-new.component';

/**
 * Behaviour of the new-application screen — `#/newclientloanaccount/:clientId`, workflow W4 (AAP 0.7.3
 * "W4 loan application"; AAP 0.7.4 loan screens; AAP 0.10.1), read through the one thing it inherits
 * from the router: the client the URL names.
 *
 * It pins the four things that fix must not lose and that a rewrite would get wrong:
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
 *     move cannot submit one client's application against another.
 *
 * **What is stubbed, and why.** Only the collaborations a unit test cannot own: `LoanService`, whose
 * endpoint-level contract — method, path, query parameters and the `dateFormat`/`locale` members of the
 * body — belongs to `loan.service.spec.ts`; `AppConfigService`, which loads `assets/config.json` over
 * `fetch` and whose two date members are the only ones this screen reads; and the translation stack,
 * which is asked for display text only. The router is a real `provideRouter([])`, so the Cancel link
 * renders the href the application would render.
 */

/** The client the screen is opened for: the `:clientId` segment of the route. */
const CLIENT_ID = 2;

/** The client a second emission moves the same component to. */
const SECOND_CLIENT_ID = 12;

/** The configuration the screen reads its two date members from. */
const CONFIG: Pick<AppConfig, 'dateFormat' | 'locale'> = { dateFormat: 'dd MMMM yyyy', locale: 'en' };

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
 * The `:clientId` segments that name no client, each described for the case's title: a non-numeric,
 * zero, negative, fractional and blank segment, plus the absent parameter a URL that carries none
 * reads as. None of them may reach a request, and each must put the screen in its not-found state.
 */
const INVALID_CLIENT_ID_SEGMENTS: [string, string | null][] = [
  ['a non-numeric segment', 'abc'],
  ['a fractional segment', '2.5'],
  ['an absent parameter', null],
];

/** `LoanService` as this screen uses it: the template reads and the two posts, all stubbed. */
interface LoanServiceStub {
  readonly template: Mock<(clientId: number, productId?: number | string) => Observable<LoanTemplate>>;
  readonly chargeTemplate: Mock<(chargeId: number | string) => Observable<ChargeTemplate>>;
  readonly previewSchedule: Mock<(body: LoanApplicationRequest) => Observable<RepaymentSchedule>>;
  readonly create: Mock<(body: LoanApplicationRequest) => Observable<LoanActionResult>>;
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
        { provide: AppConfigService, useValue: { config: CONFIG } },
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
});
