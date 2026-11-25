import { computed, signal, type Signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { EMPTY, Observable, of, throwError } from 'rxjs';
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

/** The payment types the transactions template offers, deliberately in a non-alphabetical order. */
const PAYMENT_TYPES: SavingsTransactionTemplate = {
  paymentTypeOptions: [
    { id: 2, name: 'Cash' },
    { id: 1, name: 'Cheque' },
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

/** The active route snapshot the component reads its `:id` and `:action` segments from. */
interface ActivatedRouteStub {
  readonly snapshot: {
    readonly paramMap: {
      get(name: string): string | null;
    };
  };
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

/** The route the screen is opened on, answering the two parameters it reads. */
function routeWith(id: string | null, action: string | null): ActivatedRouteStub {
  return {
    snapshot: {
      paramMap: {
        get: (name: string): string | null => {
          if (name === 'id') {
            return id;
          }

          return name === 'action' ? action : null;
        },
      },
    },
  };
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
 * An observable the spec settles by hand, for the in-flight assertion: subscribing it stores the
 * completion, so a case can hold the request open, click again, then answer it.
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
    TestBed.overrideProvider(ActivatedRoute, { useValue: routeWith(id, action) });
    fixture = TestBed.createComponent(SavingsActionComponent);
    component = fixture.componentInstance;
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
});
