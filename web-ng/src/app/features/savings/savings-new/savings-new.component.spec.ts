import { computed, signal, type Signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { EMPTY, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ApiError } from '../../../core/http/api-error';
import {
  NotificationService,
  type NotificationKind,
} from '../../../core/notifications/notification.service';
import type { SavingsTemplate, SavingsTemplateOption } from '../savings.models';
import {
  SavingsService,
  type SavingsApplicationInput,
  type SavingsCreateResult,
} from '../savings.service';
import { SavingsNewComponent } from './savings-new.component';

/**
 * Behaviour of the new-application screen, the first step of workflow W8 (AAP 0.10.1 W8 row; AAP 0.7.1
 * `savings` row): the one template read it makes, the options it renders in the server's order, the
 * validators it applies, the single `POST` one click sends, and the Fineract text it shows when the
 * server refuses.
 *
 * The endpoint-level contract — method, path, query parameters and the `dateFormat`/`locale` members of
 * the body — belongs to `savings.service.spec.ts`, so `SavingsService` is stubbed at its own token and
 * no Angular HTTP client, interceptor or transport takes part in this file (Rule 1 clause 5). The
 * translation stack is stubbed the same way. Dates stay `Date` instances here: the screen never
 * formats one, and the posted-body case pins that the service is the only writer of the
 * `dd MMMM yyyy` string (AAP 0.7.2 "Date handling", AAP 0.14.1).
 */

/** The client the application is opened for: the `:clientId` segment of the route. */
const CLIENT_ID = 2;

/**
 * The products the template offers, deliberately in a non-alphabetical order so a screen that sorted
 * them would be caught (Rule 1 clause 3).
 */
const PRODUCTS: readonly SavingsTemplateOption[] = [
  { id: 11, name: 'Parity Savings' },
  { id: 4, name: 'Ancillary Savings' },
];

/**
 * The template the client read answers with. The staff row carries `displayName` exactly as the wire
 * sends it (Rule 1 clause 2).
 */
const OFFICERS_TEMPLATE: SavingsTemplate = {
  clientId: CLIENT_ID,
  productOptions: PRODUCTS,
  fieldOfficerOptions: [{ id: 7, displayName: 'Officer, Parity' }],
};

/** The same payload without a field-officer list, as the client-only read sends it. */
const CLIENT_ONLY_TEMPLATE: SavingsTemplate = { clientId: CLIENT_ID, productOptions: PRODUCTS };

/** The payload's product labels, in payload order. */
const PRODUCT_NAMES: readonly string[] = PRODUCTS.map((product) => product.name);

/** The product the account is opened on: the payload's first row. */
const CHOSEN_PRODUCT_ID = 11;

/** The `resourceId` the create envelope answers with; the record the screen opens next. */
const CREATED_RESOURCE_ID = 41;

/** A distinctive Fineract rejection, quoted from the server's own wording. */
const REJECTED_MESSAGE = 'The savings product is not active for the submitted date.';

/** The day the application is submitted on in the cases that fill the form. */
const SUBMITTED_ON = new Date(2026, 10, 24);

/** `SavingsService` as this screen uses it: the template read and the one write, both stubbed. */
interface SavingsServiceStub {
  readonly template: Mock<
    (clientId: number | string, productId?: number | string) => Observable<SavingsTemplate>
  >;
  readonly create: Mock<(body: SavingsApplicationInput) => Observable<SavingsCreateResult>>;
}

/** `Router` as this screen uses it: one navigation command list per outcome. */
interface RouterStub {
  readonly navigate: Mock<(commands: readonly unknown[]) => Promise<boolean>>;
}

/** `NotificationService` as this screen would use it: it raises no notice of its own. */
interface NotificationStub {
  readonly show: Mock<(kind: NotificationKind, message: string) => void>;
}

/** The active route snapshot the component reads its `:clientId` from. */
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

/** The route the screen is opened on, answering the one parameter it reads. */
const ROUTE: ActivatedRouteStub = {
  snapshot: {
    paramMap: {
      get: (name: string): string | null => (name === 'clientId' ? String(CLIENT_ID) : null),
    },
  },
};

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
 * resolver, so a case can hold the request open, click again, then answer it.
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

describe('SavingsNewComponent', () => {
  let fixture: ComponentFixture<SavingsNewComponent>;
  let component: SavingsNewComponent;
  let savings: SavingsServiceStub;
  let router: RouterStub;
  let notifications: NotificationStub;

  /** The rendered host, narrowed once so every query below is type-checked. */
  const host = (): HTMLElement => {
    const element: unknown = fixture.nativeElement;
    if (!(element instanceof HTMLElement)) {
      throw new Error('the fixture rendered no host element');
    }
    return element;
  };

  /** The select controls on the screen, in render order: product first, the optional officer second. */
  function selects(): HTMLSelectElement[] {
    return Array.from(host().querySelectorAll('app-select-field select')).filter(
      (element): element is HTMLSelectElement => element instanceof HTMLSelectElement,
    );
  }

  /** The visible option texts of one select, in render order. */
  function optionTexts(select: HTMLSelectElement): string[] {
    return Array.from(select.options).map((option) => (option.textContent ?? '').trim());
  }

  /** The product select the operator picks from. */
  function productSelect(): HTMLSelectElement {
    const [select] = selects();
    if (select === undefined) {
      throw new Error('the screen rendered no product select');
    }
    return select;
  }

  /** The submit control, which must be disabled for as long as its request is in flight. */
  function submitButton(): HTMLButtonElement {
    const element: unknown = host().querySelector('button[type="submit"]');
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error('the screen rendered no submit button');
    }
    return element;
  }

  /**
   * Lets the constructor's one template read answer and the first paint show it: its
   * `await firstValueFrom(...)` resumes in a microtask, which the await below crosses before the
   * render, so the option lists are on screen by the time a case asserts them.
   */
  async function settle(): Promise<void> {
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Creates the screen on the routed client and answers its template read with `template`. */
  async function render(template: SavingsTemplate): Promise<void> {
    savings.template.mockReturnValue(of(template));
    fixture = TestBed.createComponent(SavingsNewComponent);
    component = fixture.componentInstance;
    await settle();
  }

  /** Fills the two fields a create the server would accept needs: the product and the date. */
  function fillValidForm(): void {
    component.form.controls.productId.setValue(CHOSEN_PRODUCT_ID);
    component.form.controls.submittedOnDate.setValue(SUBMITTED_ON);
  }

  beforeEach(() => {
    savings = { template: vi.fn(), create: vi.fn() };
    router = { navigate: vi.fn(() => Promise.resolve(true)) };
    notifications = { show: vi.fn() };

    TestBed.configureTestingModule({
      imports: [SavingsNewComponent],
      providers: [
        { provide: SavingsService, useValue: savings },
        { provide: ActivatedRoute, useValue: ROUTE },
        { provide: Router, useValue: router },
        { provide: TranslateService, useValue: translateStub() },
        { provide: NotificationService, useValue: notifications },
      ],
    });
  });

  it('reads the new-application template once, for the routed client and no product', async () => {
    await render(OFFICERS_TEMPLATE);

    expect(savings.template.mock.calls).toEqual([[CLIENT_ID]]);
    expect(savings.create).not.toHaveBeenCalled();
    expect(component.clientId).toBe(CLIENT_ID);
  });

  it('renders the product options in the payload order, never sorted', async () => {
    await render(OFFICERS_TEMPLATE);

    expect(component.productOptions().map((option) => option.name)).toEqual(PRODUCT_NAMES);
    expect(optionTexts(productSelect()).filter((text) => PRODUCT_NAMES.includes(text))).toEqual(
      PRODUCT_NAMES,
    );
  });

  it('renders the field-officer control only while the payload supplies field officers', async () => {
    await render(OFFICERS_TEMPLATE);

    expect(component.hasFieldOfficerOptions()).toBe(true);
    expect(component.fieldOfficerOptions()).toEqual([{ id: 7, name: 'Officer, Parity' }]);
    expect(selects()).toHaveLength(2);

    component.savingsTemplate.set(CLIENT_ONLY_TEMPLATE);
    fixture.detectChanges();

    expect(component.hasFieldOfficerOptions()).toBe(false);
    expect(selects()).toHaveLength(1);
  });

  it('pre-fills the submitted-on date from the browser clock and requires it', async () => {
    await render(OFFICERS_TEMPLATE);

    // Legacy defaults this date from the browser clock and the screen reproduces that rather than
    // reading the tenant business date, which would add a request the legacy form never sends: the
    // business date is the harness's, not the screen's (AAP 0.10.5 item 15, the registered departure
    // from Rule 1 clause 2).
    expect(component.form.controls.submittedOnDate.value instanceof Date).toBe(true);

    component.form.controls.submittedOnDate.setValue(null);
    await component.submit();

    expect(component.form.controls.submittedOnDate.invalid).toBe(true);
    expect(component.form.controls.submittedOnDate.errors?.['required']).toBeTruthy();
  });

  it('issues no request and reports every required field when the form is invalid', async () => {
    await render(OFFICERS_TEMPLATE);
    expect(component.form.controls.productId.value).toBeNull();

    await component.submit();

    expect(component.form.controls.productId.errors?.['required']).toBeTruthy();
    expect(savings.create).not.toHaveBeenCalled();
    expect(component.form.controls.productId.touched).toBe(true);
    expect(component.form.controls.submittedOnDate.touched).toBe(true);
  });

  it('posts the application once with values only, then opens the account it created', async () => {
    await render(OFFICERS_TEMPLATE);
    savings.create.mockReturnValue(of({ resourceId: CREATED_RESOURCE_ID }));

    fillValidForm();
    await component.submit();

    expect(savings.create).toHaveBeenCalledTimes(1);

    const [application] = savings.create.mock.calls[0];
    expect(application.clientId).toBe(CLIENT_ID);
    expect(typeof application.productId).toBe('number');
    expect(application.productId).toBe(CHOSEN_PRODUCT_ID);
    expect(application.submittedOnDate).toBe(SUBMITTED_ON);
    // The service writes `dateFormat` and `locale`; the screen hands over values only.
    expect(Object.keys(application).sort()).toEqual(['clientId', 'productId', 'submittedOnDate']);
    expect(router.navigate).toHaveBeenCalledWith(['/viewsavingaccount', CREATED_RESOURCE_ID]);
  });

  it('sends one request per click and disables the submit control while it is in flight', async () => {
    await render(OFFICERS_TEMPLATE);
    const deferred = deferredResponse<SavingsCreateResult>();
    savings.create.mockReturnValue(deferred.response);

    fillValidForm();
    const firstClick = component.submit();
    const secondClick = component.submit();

    expect(savings.create).toHaveBeenCalledTimes(1);
    expect(component.guard.busy()).toBe(true);
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(true);

    deferred.resolve({ resourceId: CREATED_RESOURCE_ID });
    await Promise.all([firstClick, secondClick]);
    fixture.detectChanges();

    expect(component.guard.busy()).toBe(false);
    expect(submitButton().disabled).toBe(false);
  });

  it("renders Fineract's rejection verbatim and keeps every entered value", async () => {
    await render(OFFICERS_TEMPLATE);
    savings.create.mockReturnValue(throwError(() => new ApiError(REJECTED_MESSAGE, 400)));

    fillValidForm();
    await component.submit();
    fixture.detectChanges();

    const alert = host().querySelector<HTMLElement>('.alert.alert-danger');
    // The only whitespace allowed around the text is the template's own indentation; the message
    // itself reaches the user unmodified — no prefix, suffix, trim or translation (Rule 1 clause 3).
    expect(alert?.textContent?.trim()).toBe(REJECTED_MESSAGE);
    expect(component.form.controls.productId.value).toBe(CHOSEN_PRODUCT_ID);
    expect(component.form.controls.submittedOnDate.value).toBe(SUBMITTED_ON);
    expect(router.navigate).not.toHaveBeenCalled();
    // The interceptor already raised the notice for this failure; the screen adds no second one.
    expect(notifications.show).not.toHaveBeenCalled();
  });

  it('returns to the client record on cancel without issuing any request', async () => {
    await render(OFFICERS_TEMPLATE);

    component.cancel();

    expect(router.navigate).toHaveBeenCalledWith(['/viewclient', CLIENT_ID]);
    expect(savings.create).not.toHaveBeenCalled();
    expect(savings.template.mock.calls).toHaveLength(1);
  });
});
