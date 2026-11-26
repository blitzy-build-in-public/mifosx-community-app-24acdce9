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
import { BehaviorSubject, EMPTY, Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { PermissionsService } from '../../../core/auth/permissions.service';
import { toApiError } from '../../../core/http/api-error';
import {
  NotificationService,
  type NotificationKind,
} from '../../../core/notifications/notification.service';
import type { SavingsTransactionTemplate } from '../savings.models';
import {
  SavingsService,
  type SavingsActionInput,
  type SavingsTransactionInput,
} from '../savings.service';
import { SavingsActionComponent } from './savings-action.component';

/**
 * Behaviour of the savings action screen — the last steps of workflow W8 (AAP 0.10.1 W8 row; AAP 0.7.1
 * `savings` row): the operation the `:action` segment selects, the form that operation draws, the one
 * request each submit sends to the family's own service, the template read the cash-transaction form
 * makes, the not-found outcome that sends nothing, the verbatim Fineract text a refusal shows with every
 * entered value kept, the refusal a missing required value produces without any request at all, a failed
 * template read that leaves the form standing, an amount that travels exactly as entered, and the Cancel
 * anchor that leaves for the record without one.
 *
 * The endpoint-level contract — method, path, query parameters and the `dateFormat`/`locale` members of
 * the body — belongs to `savings.service.spec.ts`, so `SavingsService` is stubbed at its own token and
 * no HTTP client, interceptor or transport takes part in this file (Rule 1 clause 5). The translation
 * stack, the permission gate and the notification queue are stubbed the same way. Dates stay `Date`
 * instances here: the screen never formats one, and the posted-body cases pin that the service is the
 * only writer of the `dd MMMM yyyy` string (AAP 0.7.2 "Date handling", AAP 0.14.1).
 */

/** The account the screen was opened on: the `:id` segment of the route. */
const ACCOUNT_ID = '41';

/** The account a second emission moves the same component to. */
const SECOND_ACCOUNT_ID = '47';

/** The payment types the transactions template offers, deliberately in a non-alphabetical order. */
const PAYMENT_TYPES: SavingsTransactionTemplate = {
  paymentTypeOptions: [
    { id: 2, name: 'Cash' },
    { id: 1, name: 'Cheque' },
  ],
};

/** The second account's transactions template: another list, so a stale answer is caught by its rows. */
const SECOND_PAYMENT_TYPES: SavingsTransactionTemplate = {
  paymentTypeOptions: [
    { id: 4, name: 'Transfer' },
    { id: 3, name: 'Cheque' },
  ],
};

/** The payload's payment-type labels, in payload order. */
const PAYMENT_TYPE_NAMES: readonly string[] = PAYMENT_TYPES.paymentTypeOptions.map(
  (option) => option.name,
);

/** The payment type the cash-transaction cases choose: the payload's first row. */
const CHOSEN_PAYMENT_TYPE_ID = 2;

/** The amount a cash-transaction case enters. */
const TRANSACTION_AMOUNT = 1000;

/** A distinctive Fineract rejection, quoted from the server's own wording. */
const REJECTED_MESSAGE = 'The account is not in an active state.';

/** The text a 5xx answers with; the interceptor turns it into that failure's one notification. */
const SERVER_FAILURE_MESSAGE = 'The request could not be processed because an internal error occurred.';

/** The refusal the transactions-template read answers with, surfaced above the form it belongs to. */
const TEMPLATE_FAILURE_MESSAGE = 'The transaction template could not be built for this account.';

/**
 * The dates the cases enter, each built from its calendar parts so it is local midnight everywhere and
 * no assertion can shift by a timezone. Three distinct days, so a body carrying the wrong field — or the
 * wrong command's date — is visible rather than hidden by two equal values.
 */
const APPROVED_ON = new Date(2026, 10, 21);
const ACTIVATED_ON = new Date(2026, 10, 22);
const TRANSACTION_ON = new Date(2026, 10, 23);

/**
 * An amount larger than any product maximum: the screen must pass it through untouched, because the
 * server owns the bound and the legacy form adds none (Rule 1 clause 3, workflow W7's rule for amounts).
 */
const LARGE_TRANSACTION_AMOUNT = 50000;

/** `SavingsService` as this screen uses it: the two writes and the one template read, all stubbed. */
interface SavingsServiceStub {
  readonly action: Mock<
    (
      id: number | string,
      command: 'approve' | 'activate',
      body: SavingsActionInput,
    ) => Observable<void>
  >;
  readonly transactionTemplate: Mock<(id: number | string) => Observable<SavingsTransactionTemplate>>;
  readonly transaction: Mock<
    (
      id: number | string,
      command: 'deposit' | 'withdrawal',
      body: SavingsTransactionInput,
    ) => Observable<void>
  >;
}

/** `Router` as this screen uses it: one navigation command list per outcome. */
interface RouterStub {
  readonly navigate: Mock<(commands: readonly unknown[]) => Promise<boolean>>;
}

/** `PermissionsService` as the submit control's gate asks it. */
interface PermissionsStub {
  has(key: string): boolean;
}

/**
 * `NotificationService` as this screen would use it. The interceptor is the only reporter of a failure a
 * screen must not paint twice, so a case states that the screen raised no notice of its own instead of
 * inferring it from the absence of a widget nobody mounted here.
 */
interface NotificationStub {
  readonly show: Mock<(kind: NotificationKind, message: string) => void>;
}

/**
 * The active route as the component reads it: the parameter map the router delivers `:id` and
 * `:action` on, held as a subject so a case can move the URL the way the router does on the same
 * mounted component.
 */
interface ActivatedRouteStub {
  readonly paramMap: BehaviorSubject<ParamMap>;
}

/**
 * The ngx-translate surface this screen touches: the constructor's two subscriptions, the
 * `currentLang()` and `instant()` reads behind the label signals, and the `translate()` signal
 * `TranslatePipe` 18 resolves its own keys through. Members the screen never reads are absent rather
 * than stubbed, and nothing here reaches the network.
 */
interface TranslateStub {
  readonly currentLang: Signal<string>;
  instant(key: string): string;
  translate(key: string): Signal<string>;
  readonly onLangChange: Observable<unknown>;
  readonly onTranslationChange: Observable<unknown>;
}

/** The parameter map of one action route, absent segments omitted. */
function paramsFor(id: string | null, action: string | null): ParamMap {
  const params: Record<string, string> = {};

  if (id !== null) {
    params['id'] = id;
  }

  if (action !== null) {
    params['action'] = action;
  }

  return convertToParamMap(params);
}

/** The route the screen is opened on, carrying the two segments it reads. */
function routeWith(id: string | null, action: string | null): ActivatedRouteStub {
  return { paramMap: new BehaviorSubject<ParamMap>(paramsFor(id, action)) };
}

/** Builds the translation stub the TestBed provides. */
function translateStub(): TranslateStub {
  return {
    currentLang: signal('en').asReadonly(),
    instant: (key: string): string => key,
    translate: (key: string): Signal<string> => computed(() => key),
    onLangChange: EMPTY,
    onTranslationChange: EMPTY,
  };
}

/**
 * An observable a case settles by hand, so one route's answer can be held open while the URL moves on —
 * the order in which a superseded read answers last.
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

/**
 * An observable the spec settles by hand, for the in-flight assertion: subscribing it stores the
 * completion, so a case can hold a write open, click again, then answer it.
 */
function deferredCompletion(): { readonly response: Observable<void>; complete(): void } {
  let settle: (() => void) | null = null;

  const response = new Observable<void>((subscriber) => {
    settle = (): void => {
      subscriber.next();
      subscriber.complete();
    };
  });

  return {
    response,
    complete(): void {
      if (settle === null) {
        throw new Error('the screen never subscribed to the deferred response');
      }
      settle();
    },
  };
}

/**
 * A Fineract refusal as this screen receives it in the application: the interceptor's own `toApiError`
 * mapping of the failed response, so the error class and the server's verbatim text are the production
 * pair rather than a hand-built error that merely resembles them (AAP 0.4.2, workflow W7).
 *
 * @param status the HTTP status the server answered with.
 * @param message the body's `defaultUserMessage`, the text every in-scope screen renders unchanged.
 * @returns the failure a rejected request delivers.
 */
function failure(status: number, message: string): ReturnType<typeof toApiError> {
  return toApiError(new HttpErrorResponse({ status, error: { defaultUserMessage: message } }));
}

describe('SavingsActionComponent', () => {
  let fixture: ComponentFixture<SavingsActionComponent>;
  let component: SavingsActionComponent;
  let savings: SavingsServiceStub;
  let router: RouterStub;
  let route: ActivatedRouteStub;
  let notifications: NotificationStub;

  /** The rendered host, narrowed once so every query below is type-checked. */
  const host = (): HTMLElement => {
    const element: unknown = fixture.nativeElement;
    if (!(element instanceof HTMLElement)) {
      throw new Error('the fixture rendered no host element');
    }
    return element;
  };

  /** The submit control, which must be disabled for as long as its request is in flight. */
  function submitButton(): HTMLButtonElement {
    const element: unknown = host().querySelector('button[type="submit"]');
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error('the screen rendered no submit button');
    }
    return element;
  }

  /** The payment-type select the cash-transaction form renders. */
  function paymentTypeSelect(): HTMLSelectElement {
    const element: unknown = host().querySelector('app-select-field select');
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error('the screen rendered no payment-type select');
    }
    return element;
  }

  /** The `.form-group` that carries the cash-transaction amount and its invalid state. */
  function amountGroup(): HTMLElement {
    const element: unknown = host().querySelector('input#transactionAmount')?.closest('.form-group');
    if (!(element instanceof HTMLElement)) {
      throw new Error('the screen rendered no amount field group');
    }
    return element;
  }

  /** The cash-transaction amount field itself, whose native increment the form must not leave at 1. */
  function amountInput(): HTMLInputElement {
    const element: unknown = host().querySelector('input#transactionAmount');
    if (!(element instanceof HTMLInputElement)) {
      throw new Error('the screen rendered no amount field');
    }
    return element;
  }

  /** The rendered text of the host, whitespace-collapsed for a stable containment test. */
  function renderedText(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Lets a constructor's template read answer and the first paint show it: its
   * `await firstValueFrom(...)` resumes in a microtask, which the await below crosses before the
   * render, so the payment types are on screen by the time a case asserts them.
   */
  async function settle(): Promise<void> {
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Creates the screen on the given route segments. */
  async function render(id: string | null, action: string | null): Promise<void> {
    route = routeWith(id, action);
    TestBed.overrideProvider(ActivatedRoute, { useValue: route });
    fixture = TestBed.createComponent(SavingsActionComponent);
    component = fixture.componentInstance;
    await settle();
  }

  /**
   * Moves the mounted screen to another action route the way the router does when only the segments
   * change: the same component instance stays on screen and the parameter map emits again.
   */
  async function navigateTo(id: string, action: string): Promise<void> {
    route.paramMap.next(paramsFor(id, action));
    await settle();
  }

  /** Fills the cash-transaction form with the values the cases post. */
  function fillTransactionForm(): void {
    component.transactionForm.controls.transactionAmount.setValue(TRANSACTION_AMOUNT);
    component.transactionForm.controls.paymentTypeId.setValue(CHOSEN_PAYMENT_TYPE_ID);
  }

  /**
   * The body the action call carried, narrowed to the approval shape the way `SavingsService.action()`
   * narrows it: `approvedOnDate` is the member only an approval body holds.
   *
   * @returns the approval body, or `undefined` when no call was made or it carried the other shape.
   */
  function postedApproveBody(): { readonly approvedOnDate: Date | null } | undefined {
    const body: SavingsActionInput | undefined = savings.action.mock.calls[0]?.[2];

    return body !== undefined && 'approvedOnDate' in body ? body : undefined;
  }

  /**
   * The same narrowing for the activation command, whose body carries `activatedOnDate` instead.
   *
   * @returns the activation body, or `undefined` when no call was made or it carried the other shape.
   */
  function postedActivateBody(): { readonly activatedOnDate: Date | null } | undefined {
    const body: SavingsActionInput | undefined = savings.action.mock.calls[0]?.[2];

    return body !== undefined && 'activatedOnDate' in body ? body : undefined;
  }

  beforeEach(() => {
    savings = { action: vi.fn(), transactionTemplate: vi.fn(), transaction: vi.fn() };
    router = { navigate: vi.fn(() => Promise.resolve(true)) };
    notifications = { show: vi.fn() };

    TestBed.configureTestingModule({
      imports: [SavingsActionComponent],
      providers: [
        { provide: SavingsService, useValue: savings },
        { provide: Router, useValue: router },
        { provide: TranslateService, useValue: translateStub() },
        { provide: PermissionsService, useValue: { has: (): boolean => true } satisfies PermissionsStub },
        { provide: NotificationService, useValue: notifications },
      ],
    });
  });

  /**
   * Discards the module a case built, so a deferred answer or a mounted screen of one case can never
   * reach the next — the reuse cases hold a response open across a URL change, and the Cancel case
   * re-configures the module for the application's real router.
   */
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('approves the routed account with the date its form holds, then opens the record', async () => {
    savings.action.mockReturnValue(of(void 0));

    await render(ACCOUNT_ID, 'approve');

    // The approval screen draws its one date field and nothing a cash transaction owns, so the control
    // a case fills below is the operation's own field rather than another form's.
    expect(host().querySelectorAll('app-date-field')).toHaveLength(1);
    expect(host().querySelector('#approvedOnDate')).not.toBeNull();
    expect(host().querySelector('#transactionAmount')).toBeNull();
    expect(host().querySelector('app-select-field')).toBeNull();

    component.approveForm.controls.approvedOnDate.setValue(APPROVED_ON);

    await component.submit();

    expect(savings.action).toHaveBeenCalledTimes(1);
    // The date reaches the service as the `Date` the field holds: the service is the only writer of the
    // `dd MMMM yyyy` string it becomes on the wire (AAP 0.7.2 "Date handling").
    expect(postedApproveBody()?.approvedOnDate).toBeInstanceOf(Date);
    expect(postedApproveBody()?.approvedOnDate).toEqual(APPROVED_ON);
    expect(savings.action).toHaveBeenCalledWith(ACCOUNT_ID, 'approve', {
      approvedOnDate: APPROVED_ON,
    });
    expect(savings.transaction).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/viewsavingaccount', ACCOUNT_ID]);
  });

  it('activates the routed account with the date its form holds, and reads no payment types', async () => {
    savings.action.mockReturnValue(of(void 0));

    await render(ACCOUNT_ID, 'activate');

    component.activateForm.controls.activatedOnDate.setValue(ACTIVATED_ON);

    await component.submit();

    expect(savings.action).toHaveBeenCalledTimes(1);
    // Each command sends its own date member and no other: the activation body cannot carry the
    // approval date, which is what keeps the two lifecycle shapes apart (AAP 0.7.2).
    expect(postedActivateBody()?.activatedOnDate).toEqual(ACTIVATED_ON);
    expect(postedActivateBody()).not.toHaveProperty('approvedOnDate');
    expect(savings.action).toHaveBeenCalledWith(ACCOUNT_ID, 'activate', {
      activatedOnDate: ACTIVATED_ON,
    });
    expect(savings.transactionTemplate).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/viewsavingaccount', ACCOUNT_ID]);
  });

  it('reads the transaction template once and renders its payment types in the payload order', async () => {
    savings.transactionTemplate.mockReturnValue(of(PAYMENT_TYPES));

    await render(ACCOUNT_ID, 'deposit');

    expect(savings.transactionTemplate).toHaveBeenCalledTimes(1);
    expect(savings.transactionTemplate).toHaveBeenCalledWith(ACCOUNT_ID);

    const options = Array.from(paymentTypeSelect().options).map((option) =>
      (option.textContent ?? '').trim(),
    );
    expect(options.slice(1)).toEqual([...PAYMENT_TYPE_NAMES]);
  });

  it('deposits the amount and payment type its form holds, then opens the record', async () => {
    savings.transactionTemplate.mockReturnValue(of(PAYMENT_TYPES));
    savings.transaction.mockReturnValue(of(void 0));

    await render(ACCOUNT_ID, 'deposit');
    fillTransactionForm();
    component.transactionForm.controls.transactionDate.setValue(TRANSACTION_ON);

    await component.submit();

    expect(savings.transaction).toHaveBeenCalledTimes(1);
    expect(savings.transaction).toHaveBeenCalledWith(ACCOUNT_ID, 'deposit', {
      transactionDate: TRANSACTION_ON,
      transactionAmount: TRANSACTION_AMOUNT,
      paymentTypeId: CHOSEN_PAYMENT_TYPE_ID,
    });
    expect(savings.transaction.mock.calls[0]?.[2].transactionDate).toBeInstanceOf(Date);
    expect(router.navigate).toHaveBeenCalledWith(['/viewsavingaccount', ACCOUNT_ID]);
  });

  it('keeps the amount field on a two-decimal increment, so a money figure is never natively invalid', async () => {
    savings.transactionTemplate.mockReturnValue(of(PAYMENT_TYPES));

    await render(ACCOUNT_ID, 'deposit');

    // The browser's own increment for the field. Left at the `type="number"` default of one whole unit,
    // an ordinary two-decimal amount would be reported as a step mismatch; the form's `novalidate` keeps
    // the increment from ever blocking a submit the server decides (Rule 1 clause 3).
    expect(amountInput().getAttribute('step')).toBe('0.01');
  });

  it('flags the amount as soon as an entered value is cleared, and only then', async () => {
    savings.transactionTemplate.mockReturnValue(of(PAYMENT_TYPES));

    await render(ACCOUNT_ID, 'deposit');

    // Untouched and empty, the field reports nothing: the operator has not entered a value yet, so
    // there is nothing to correct.
    expect(amountGroup().classList.contains('has-error')).toBe(false);
    expect(renderedText()).not.toContain('label.requiredfield');

    // Entering a value and clearing it leaves the control invalid and dirty while it is still focused,
    // which is the state the screen must report without waiting for the field to be left. A programmatic
    // `setValue` reports through the model side of the form, so the dirty flag is set the way the value
    // accessor sets it on a user edit.
    const amount = component.transactionForm.controls.transactionAmount;
    amount.setValue(TRANSACTION_AMOUNT);
    amount.setValue(null);
    amount.markAsDirty();

    expect(amount.touched).toBe(false);
    expect(amount.dirty).toBe(true);

    fixture.detectChanges();

    expect(amountGroup().classList.contains('has-error')).toBe(true);
    expect(amountGroup().querySelector('.help-block')?.textContent?.trim()).toBe('label.requiredfield');
    // The message is a display concern only: the form stays unsendable for the missing value, and no
    // rule beyond the legacy `required` was added.
    expect(amount.invalid).toBe(true);
    expect(savings.transaction).not.toHaveBeenCalled();
  });

  it('submits a cash transaction with no payment type chosen as paymentTypeId null', async () => {
    savings.transactionTemplate.mockReturnValue(of(PAYMENT_TYPES));
    savings.transaction.mockReturnValue(of(void 0));

    await render(ACCOUNT_ID, 'deposit');

    // Only the amount is filled. The legacy form marks the date and the amount and nothing else, so
    // an unchosen payment type must leave the form valid instead of turning the submission away.
    component.transactionForm.controls.transactionAmount.setValue(TRANSACTION_AMOUNT);

    expect(component.transactionForm.controls.paymentTypeId.value).toBeNull();
    expect(component.transactionForm.valid).toBe(true);

    const transactionDate = component.transactionForm.controls.transactionDate.value;

    await component.submit();

    // The form named no payment type, so `null` travels and the server's own required-field rule is
    // what answers (AAP 0.4.4 decision 6, Rule 1 clause 3).
    expect(savings.transaction).toHaveBeenCalledTimes(1);
    expect(savings.transaction).toHaveBeenCalledWith(ACCOUNT_ID, 'deposit', {
      transactionDate,
      transactionAmount: TRANSACTION_AMOUNT,
      paymentTypeId: null,
    });
    expect(router.navigate).toHaveBeenCalledWith(['/viewsavingaccount', ACCOUNT_ID]);
  });

  it('posts the withdraw route segment as the transactions endpoint command', async () => {
    savings.transactionTemplate.mockReturnValue(of(PAYMENT_TYPES));
    savings.transaction.mockReturnValue(of(void 0));

    await render(ACCOUNT_ID, 'withdraw');
    fillTransactionForm();

    await component.submit();

    expect(savings.transaction).toHaveBeenCalledTimes(1);
    expect(savings.transaction.mock.calls[0]?.[1]).toBe('withdrawal');
  });

  it('renders the not-found message and sends nothing for a segment it does not serve', async () => {
    await render(ACCOUNT_ID, 'nonsense');

    expect(renderedText()).toContain('label.heading.notavailable');
    expect(savings.transactionTemplate).not.toHaveBeenCalled();
    // No form and so no submit control: an unknown segment has nothing to post with.
    expect(host().querySelector('form')).toBeNull();
    expect(host().querySelector('button[type="submit"]')).toBeNull();

    await component.submit();

    expect(savings.action).not.toHaveBeenCalled();
    expect(savings.transaction).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('treats a route with no account id as not found and sends nothing', async () => {
    await render(null, 'approve');

    expect(component.notFound()).toBe(true);
    expect(renderedText()).toContain('error.msg.resource.not.found');
    expect(host().querySelector('form')).toBeNull();

    await component.submit();

    expect(savings.action).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('sends exactly one request when the submit control is used twice while one is in flight', async () => {
    const inFlight = deferredCompletion();
    savings.action.mockReturnValue(inFlight.response);

    await render(ACCOUNT_ID, 'approve');

    const first = component.submit();

    // The guard sets its busy signal synchronously, before the request is subscribed: one render
    // shows the control already disabled while the call is still outstanding.
    fixture.detectChanges();
    expect(component.guard.busy()).toBe(true);
    expect(submitButton().disabled).toBe(true);

    await component.submit();
    expect(savings.action).toHaveBeenCalledTimes(1);
    expect(component.guard.busy()).toBe(true);

    inFlight.complete();
    await first;

    // The one call having answered, the trigger is released and the record opened exactly once.
    expect(component.guard.busy()).toBe(false);
    expect(router.navigate).toHaveBeenCalledTimes(1);
  });

  it('shows the server failure verbatim, keeps every entered value and raises no second notice', async () => {
    savings.transactionTemplate.mockReturnValue(of(PAYMENT_TYPES));
    savings.transaction.mockReturnValue(throwError(() => failure(400, REJECTED_MESSAGE)));

    await render(ACCOUNT_ID, 'deposit');
    fillTransactionForm();
    component.transactionForm.controls.transactionDate.setValue(TRANSACTION_ON);

    await component.submit();
    fixture.detectChanges();

    // The alert carries the server's own sentence, character for character: no prefix, no truncation and
    // no translation (AAP 0.7.2 "Rendered verbatim", AAP 0.7.4; workflow W7 compares it exactly).
    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(REJECTED_MESSAGE);
    expect(component.error()).toBe(REJECTED_MESSAGE);
    // The form stays mounted with everything the user entered, so the refusal can be corrected in place.
    expect(host().querySelector('form')).not.toBeNull();
    expect(component.transactionForm.controls.transactionDate.value).toEqual(TRANSACTION_ON);
    expect(component.transactionForm.controls.transactionAmount.value).toBe(TRANSACTION_AMOUNT);
    expect(component.transactionForm.controls.paymentTypeId.value).toBe(CHOSEN_PAYMENT_TYPE_ID);
    // A 4xx is Fineract's answer to the values submitted, so it belongs on the form and not in a notice.
    expect(notifications.show).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('reports a server error once, through the interceptor’s notification and not on screen', async () => {
    savings.action.mockReturnValue(throwError(() => failure(500, SERVER_FAILURE_MESSAGE)));

    await render(ACCOUNT_ID, 'approve');

    const approvedOnDate = component.approveForm.controls.approvedOnDate.value;

    await component.submit();
    fixture.detectChanges();

    // A 5xx has already produced the interceptor's single notification, so the screen paints no
    // second copy of it (AAP 0.7.4): it keeps no failure of its own and renders no alert.
    expect(component.error()).toBeNull();
    expect(host().querySelector('.alert.alert-danger')).toBeNull();
    expect(renderedText()).not.toContain(SERVER_FAILURE_MESSAGE);
    // Nor does the screen raise a notice of its own: the one a 5xx carries is the interceptor's.
    expect(notifications.show).not.toHaveBeenCalled();
    // The one request was made, the form kept the date it held, and nothing navigated.
    expect(savings.action).toHaveBeenCalledTimes(1);
    expect(savings.action).toHaveBeenCalledWith(ACCOUNT_ID, 'approve', { approvedOnDate });
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('re-reads the payment types for a second account, clearing the first form’s values', async () => {
    savings.transactionTemplate.mockImplementation((id) =>
      of(String(id) === SECOND_ACCOUNT_ID ? SECOND_PAYMENT_TYPES : PAYMENT_TYPES),
    );

    await render(ACCOUNT_ID, 'deposit');
    fillTransactionForm();
    fixture.detectChanges();

    await navigateTo(SECOND_ACCOUNT_ID, 'deposit');

    // One read per emission, addressed by the account the URL now names…
    expect(savings.transactionTemplate.mock.calls).toEqual([[ACCOUNT_ID], [SECOND_ACCOUNT_ID]]);
    // …and nothing of the first account's screen survives it: no amount, no chosen payment type.
    expect(component.transactionForm.controls.transactionAmount.value).toBeNull();
    expect(component.transactionForm.controls.paymentTypeId.value).toBeNull();
    expect(component.error()).toBeNull();

    // The picker offers only the payload the new route's read answered.
    const options = Array.from(paymentTypeSelect().options).map((option) =>
      (option.textContent ?? '').trim(),
    );
    expect(options.slice(1)).toEqual(SECOND_PAYMENT_TYPES.paymentTypeOptions.map((option) => option.name));
    expect(options).not.toContain(PAYMENT_TYPE_NAMES[0]);
  });

  it('switches to the operation a second emission names, with no read for a lifecycle command', async () => {
    savings.transactionTemplate.mockReturnValue(of(PAYMENT_TYPES));

    await render(ACCOUNT_ID, 'deposit');
    fillTransactionForm();
    fixture.detectChanges();

    await navigateTo(ACCOUNT_ID, 'approve');

    // Approve reads nothing at all, so the template read stays the deposit route's one.
    expect(savings.transactionTemplate).toHaveBeenCalledTimes(1);
    expect(component.notFound()).toBe(false);
    expect(renderedText()).toContain('label.heading.approvesavingaccount');
    // The cash-transaction form's values went with the operation that collected them, and the approval
    // form holds its own browser-clock default.
    expect(component.transactionForm.controls.transactionAmount.value).toBeNull();
    expect(component.transactionForm.controls.paymentTypeId.value).toBeNull();
    expect(component.approveForm.controls.approvedOnDate.value).toBeInstanceOf(Date);
    expect(host().querySelector('app-select-field select')).toBeNull();
  });

  it('discards a superseded payment-type answer that lands after the URL moved on', async () => {
    const first = deferredResponse<SavingsTransactionTemplate>();
    const second = deferredResponse<SavingsTransactionTemplate>();

    savings.transactionTemplate.mockImplementation((id) =>
      String(id) === SECOND_ACCOUNT_ID ? second.response : first.response,
    );

    await render(ACCOUNT_ID, 'deposit');

    // The first account's read is still unanswered when the URL moves to the second account, which is
    // what a move between two action routes produces when the earlier response is the slower one.
    await navigateTo(SECOND_ACCOUNT_ID, 'deposit');

    second.resolve(SECOND_PAYMENT_TYPES);
    await settle();

    expect(component.paymentTypes().map((option) => option.name)).toEqual(
      SECOND_PAYMENT_TYPES.paymentTypeOptions.map((option) => option.name),
    );

    // The earlier answer lands last. It is dropped rather than published, so the first account's
    // payment types can never be offered under the second account's URL.
    first.resolve(PAYMENT_TYPES);
    await settle();

    expect(component.paymentTypes().map((option) => option.name)).toEqual(
      SECOND_PAYMENT_TYPES.paymentTypeOptions.map((option) => option.name),
    );
    expect(component.error()).toBeNull();
  });

  it('sends no cash transaction while a required value is missing, and marks every control', async () => {
    savings.transactionTemplate.mockReturnValue(of(PAYMENT_TYPES));

    await render(ACCOUNT_ID, 'deposit');

    // The date and the amount are the two required fields; the payment type carries no rule of its own,
    // so it is never the reason a submission is refused (AAP 0.4.4 decision 6, Rule 1 clause 3).
    component.transactionForm.controls.transactionDate.setValue(null);
    component.transactionForm.controls.transactionAmount.setValue(null);

    await component.submit();

    expect(savings.transaction).not.toHaveBeenCalled();
    // The form is touched as a whole, so the missing values are reported in place rather than leaving
    // the operator with a button that does nothing.
    expect(component.transactionForm.controls.transactionDate.touched).toBe(true);
    expect(component.transactionForm.controls.transactionAmount.touched).toBe(true);
    expect(component.transactionForm.controls.paymentTypeId.touched).toBe(true);
    expect(component.error()).toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('sends no lifecycle action while its date is missing, and marks the field', async () => {
    await render(ACCOUNT_ID, 'approve');

    component.approveForm.controls.approvedOnDate.setValue(null);

    await component.submit();
    fixture.detectChanges();

    expect(savings.action).not.toHaveBeenCalled();
    expect(component.approveForm.controls.approvedOnDate.touched).toBe(true);
    // The rendered field reports the missing date the way the legacy form-validate directive does.
    expect(host().querySelector('#approvedOnDate')?.getAttribute('aria-invalid')).toBe('true');
    expect(component.error()).toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('surfaces a failed transactions-template read without unmounting the form', async () => {
    savings.transactionTemplate.mockReturnValue(
      throwError(() => failure(400, TEMPLATE_FAILURE_MESSAGE)),
    );

    await render(ACCOUNT_ID, 'deposit');

    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(
      TEMPLATE_FAILURE_MESSAGE,
    );
    expect(component.error()).toBe(TEMPLATE_FAILURE_MESSAGE);
    // The template read failed, not the screen: the three controls are still there to be filled, so the
    // operator can retry once the payment types are available instead of losing the form.
    expect(host().querySelector('#transactionDate')).not.toBeNull();
    expect(amountInput()).not.toBeNull();
    expect(paymentTypeSelect()).not.toBeNull();
    expect(savings.transaction).not.toHaveBeenCalled();
  });

  it('posts an amount above any product maximum unchanged, adding no client-side bound', async () => {
    savings.transactionTemplate.mockReturnValue(of(PAYMENT_TYPES));
    savings.transaction.mockReturnValue(of(void 0));

    await render(ACCOUNT_ID, 'deposit');
    fillTransactionForm();
    component.transactionForm.controls.transactionDate.setValue(TRANSACTION_ON);
    component.transactionForm.controls.transactionAmount.setValue(LARGE_TRANSACTION_AMOUNT);

    // Required and nothing more: no maximum a legacy form lacks is added here (Rule 1 clause 3).
    expect(component.transactionForm.controls.transactionAmount.valid).toBe(true);

    await component.submit();

    // The figure the service receives is the figure the form held, untouched: the server owns the bound
    // and its own message is what answers an out-of-range amount.
    expect(savings.transaction.mock.calls[0]?.[2].transactionAmount).toBe(LARGE_TRANSACTION_AMOUNT);
    expect(savings.transaction).toHaveBeenCalledWith(ACCOUNT_ID, 'deposit', {
      transactionDate: TRANSACTION_ON,
      transactionAmount: LARGE_TRANSACTION_AMOUNT,
      paymentTypeId: CHOSEN_PAYMENT_TYPE_ID,
    });
  });

  it('returns to the record from the Cancel anchor, without sending anything', async () => {
    // The application's real router, because the address a `RouterLink` renders is the router's own
    // serialisation of the command list; the `navigate` stub cannot produce one.
    TestBed.resetTestingModule();
    route = routeWith(ACCOUNT_ID, 'approve');

    TestBed.configureTestingModule({
      imports: [SavingsActionComponent],
      providers: [
        provideRouter([]),
        { provide: SavingsService, useValue: savings },
        { provide: ActivatedRoute, useValue: route },
        { provide: TranslateService, useValue: translateStub() },
        {
          provide: PermissionsService,
          useValue: { has: (): boolean => true } satisfies PermissionsStub,
        },
        { provide: NotificationService, useValue: notifications },
      ],
    });

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(SavingsActionComponent);
    component = fixture.componentInstance;
    await settle();

    // A containment check rather than an exact string: the address is serialised with the location
    // strategy the workspace configures, so the assertion states where Cancel leads, not how the prefix
    // happens to be spelled (with hash location it carries the `#/` form).
    expect(host().querySelector('a.btn.btn-default')?.getAttribute('href')).toContain(
      `/viewsavingaccount/${ACCOUNT_ID}`,
    );
    // Leaving the screen is the anchor's own job: no request and no programmatic navigation.
    expect(savings.action).not.toHaveBeenCalled();
    expect(savings.transaction).not.toHaveBeenCalled();
    expect(savings.transactionTemplate).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
