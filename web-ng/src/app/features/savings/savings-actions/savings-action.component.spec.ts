import { computed, signal, type Signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router, type ParamMap } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, EMPTY, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { PermissionsService } from '../../../core/auth/permissions.service';
import { ApiError } from '../../../core/http/api-error';
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
 * makes, the not-found outcome that sends nothing, and the verbatim Fineract text a refusal shows.
 *
 * The endpoint-level contract — method, path, query parameters and the `dateFormat`/`locale` members of
 * the body — belongs to `savings.service.spec.ts`, so `SavingsService` is stubbed at its own token and
 * no HTTP client, interceptor or transport takes part in this file (Rule 1 clause 5). The translation
 * stack and the permission gate are stubbed the same way. Dates stay `Date` instances here: the screen
 * never formats one, and the posted-body cases pin that the service is the only writer of the
 * `dd MMMM yyyy` string (AAP 0.7.2 "Date handling", AAP 0.14.1).
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

describe('SavingsActionComponent', () => {
  let fixture: ComponentFixture<SavingsActionComponent>;
  let component: SavingsActionComponent;
  let savings: SavingsServiceStub;
  let router: RouterStub;
  let route: ActivatedRouteStub;

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

  beforeEach(() => {
    savings = { action: vi.fn(), transactionTemplate: vi.fn(), transaction: vi.fn() };
    router = { navigate: vi.fn(() => Promise.resolve(true)) };

    TestBed.configureTestingModule({
      imports: [SavingsActionComponent],
      providers: [
        { provide: SavingsService, useValue: savings },
        { provide: Router, useValue: router },
        { provide: TranslateService, useValue: translateStub() },
        { provide: PermissionsService, useValue: { has: (): boolean => true } satisfies PermissionsStub },
      ],
    });
  });

  it('approves the routed account with the date its form holds, then opens the record', async () => {
    savings.action.mockReturnValue(of(void 0));

    await render(ACCOUNT_ID, 'approve');

    const approvedOnDate = component.approveForm.controls.approvedOnDate.value;
    expect(approvedOnDate).toBeInstanceOf(Date);

    await component.submit();

    expect(savings.action).toHaveBeenCalledTimes(1);
    expect(savings.action).toHaveBeenCalledWith(ACCOUNT_ID, 'approve', { approvedOnDate });
    expect(savings.transaction).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/viewsavingaccount', ACCOUNT_ID]);
  });

  it('activates the routed account with the date its form holds, and reads no payment types', async () => {
    savings.action.mockReturnValue(of(void 0));

    await render(ACCOUNT_ID, 'activate');

    const activatedOnDate = component.activateForm.controls.activatedOnDate.value;
    expect(activatedOnDate).toBeInstanceOf(Date);

    await component.submit();

    expect(savings.action).toHaveBeenCalledTimes(1);
    expect(savings.action).toHaveBeenCalledWith(ACCOUNT_ID, 'activate', { activatedOnDate });
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

    const transactionDate = component.transactionForm.controls.transactionDate.value;
    expect(transactionDate).toBeInstanceOf(Date);

    await component.submit();

    expect(savings.transaction).toHaveBeenCalledTimes(1);
    expect(savings.transaction).toHaveBeenCalledWith(ACCOUNT_ID, 'deposit', {
      transactionDate,
      transactionAmount: TRANSACTION_AMOUNT,
      paymentTypeId: CHOSEN_PAYMENT_TYPE_ID,
    });
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

    await component.submit();

    expect(savings.action).not.toHaveBeenCalled();
    expect(savings.transaction).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('treats a route with no account id as not found and sends nothing', async () => {
    await render(null, 'approve');

    expect(component.notFound()).toBe(true);
    expect(renderedText()).toContain('error.msg.resource.not.found');

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
    expect(submitButton().disabled).toBe(true);

    await component.submit();
    expect(savings.action).toHaveBeenCalledTimes(1);

    inFlight.complete();
    await first;
  });

  it('shows the server failure verbatim and keeps every entered value', async () => {
    savings.transactionTemplate.mockReturnValue(of(PAYMENT_TYPES));
    savings.transaction.mockReturnValue(
      throwError(() => new ApiError(REJECTED_MESSAGE, 400)),
    );

    await render(ACCOUNT_ID, 'deposit');
    fillTransactionForm();

    await component.submit();
    fixture.detectChanges();

    expect(component.error()).toBe(REJECTED_MESSAGE);
    expect(renderedText()).toContain(REJECTED_MESSAGE);
    expect(component.transactionForm.controls.transactionAmount.value).toBe(TRANSACTION_AMOUNT);
    expect(component.transactionForm.controls.paymentTypeId.value).toBe(CHOSEN_PAYMENT_TYPE_ID);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('reports a server error once, through the interceptor’s notification and not on screen', async () => {
    savings.action.mockReturnValue(throwError(() => new ApiError(SERVER_FAILURE_MESSAGE, 500)));

    await render(ACCOUNT_ID, 'approve');

    const approvedOnDate = component.approveForm.controls.approvedOnDate.value;

    await component.submit();
    fixture.detectChanges();

    // A 5xx has already produced the interceptor's single notification, so the screen paints no
    // second copy of it (AAP 0.7.4): it keeps no failure of its own and renders no alert.
    expect(component.error()).toBeNull();
    expect(host().querySelector('.alert.alert-danger')).toBeNull();
    expect(renderedText()).not.toContain(SERVER_FAILURE_MESSAGE);
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
});
