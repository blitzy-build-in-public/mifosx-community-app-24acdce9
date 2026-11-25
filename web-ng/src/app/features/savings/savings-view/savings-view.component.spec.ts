import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal, type Signal, type WritableSignal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  type ParamMap,
} from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { PermissionsService } from '../../../core/auth/permissions.service';
import { ApiError, toApiError } from '../../../core/http/api-error';
import type { SavingsAccount } from '../savings.models';
import { SavingsService } from '../savings.service';
import { SavingsViewComponent } from './savings-view.component';

/**
 * Behaviour of the savings record — `#/viewsavingaccount/:id`, the last screen of workflow W8 (AAP 0.9.1
 * scope group 4; AAP 0.10.1 W8 row; AAP 0.7.1 Features row `savings`).
 *
 * It pins the four things the record exists to do and that a rewrite would get wrong:
 *
 *  1. the loaded account renders its number, its product, its three balances and its transaction rows,
 *     from exactly one read of `SavingsService.get(id)` — the `GET /savingsaccounts/{id}?associations=all`
 *     answer that carries all of them (AAP 0.7.3 W8 row);
 *  2. the four action links are addressed at the account the route names, each gated on the single
 *     permission code the record declares (AAP 0.7.1 row `hasPermission`; AAP 0.9.1 item 1);
 *  3. a 404, and a route that names no account at all, put the record into its not-found state: the
 *     card replaces the record and no request is made for a route with no id (AAP 0.7.4 state rules);
 *  4. every emission of `route.paramMap` re-reads the account it names, so an in-place move from one
 *     record URL to another replaces the previous account, its balances and its action links instead of
 *     leaving them on screen and issuing no request — and an answer for the account the URL has left is
 *     discarded rather than painted (the reuse fix `loan-edit`, `client-actions` and `loan-view` carry).
 *
 * **What is stubbed, and why.** Only the two collaborations a unit test cannot own: `SavingsService`,
 * whose endpoint-level contract belongs to `savings.service.spec.ts`, and `PermissionsService`, which
 * reads the session a unit test has no business assembling — the same substitution
 * `navbar.component.spec.ts` makes for the same directive. The translation stack is stubbed at the
 * `TranslatePipe` surface, so a caption renders its own key and no bundle has to be fetched. A rejected
 * read reaches the component as `ApiError` because `core/http/fineract.interceptor.ts` maps it there
 * (AAP 0.4.2), and the failures below are built with the production mapper `toApiError` from a real
 * `HttpErrorResponse`.
 */

/** The account every case opens, as the `:id` segment delivers it. */
const ACCOUNT_ID = '41';

/** The account a second emission moves the same component to. */
const SECOND_ACCOUNT_ID = '47';

/** The action segment table, in the order the record renders its links. */
const ACTION_SEGMENTS: readonly string[] = ['approve', 'activate', 'deposit', 'withdraw'];

/** The account the record renders: every member the page reads, with the server's own figures. */
const ACCOUNT: SavingsAccount = {
  id: 41,
  accountNo: '000000041',
  clientId: 2,
  clientName: 'Ada Okafor',
  savingsProductId: 4,
  savingsProductName: 'Parity Savings',
  status: { id: 300, code: 'savingsAccountStatusType.active', value: 'Active' },
  summary: { accountBalance: 800, totalDeposits: 1000, totalWithdrawals: 200 },
  transactions: [
    {
      id: 91,
      date: '2026-11-24',
      transactionType: { id: 2, code: 'savingsAccountTransactionType.deposit', value: 'Deposit' },
      amount: 1000,
      runningBalance: 1000,
    },
    {
      id: 92,
      date: '2026-11-24',
      transactionType: { id: 3, code: 'savingsAccountTransactionType.withdrawal', value: 'Withdrawal' },
      amount: -200,
      runningBalance: 800,
    },
  ],
};

/**
 * The account the second route emission names: every printed value differs from {@link ACCOUNT}, so a
 * screen that kept the first record — or its action links — is caught.
 */
const SECOND_ACCOUNT: SavingsAccount = {
  id: 47,
  accountNo: '000000047',
  clientId: 3,
  clientName: 'Marcus Rowe-Bennett',
  savingsProductId: 11,
  savingsProductName: 'Ancillary Savings',
  status: { id: 300, code: 'savingsAccountStatusType.active', value: 'Active' },
  summary: { accountBalance: 250, totalDeposits: 250, totalWithdrawals: 0 },
  transactions: [],
};

/** The message a 404 answers with, quoted from Fineract's own `defaultUserMessage`. */
const NOT_FOUND_MESSAGE = 'The requested resource is not available.';

/** The message a refused read answers with, compared character for character below. */
const REFUSED_MESSAGE = 'The savings account could not be read for this user.';

/** The read this screen makes of its family's service, so a case can answer it and count the calls. */
type AccountRead = (id: number | string) => Observable<SavingsAccount>;

/**
 * The half of `PermissionsService` the `hasPermission` directive asks, with the legacy algebra for
 * `ALL_FUNCTIONS` and a leading `!`.
 */
class PermissionsStub implements Pick<PermissionsService, 'has'> {
  private readonly granted: WritableSignal<readonly string[]> = signal<readonly string[]>([]);

  /** Whether the permission — or its absence, for a negated code — is held. */
  has(key: string): boolean {
    const code = key.trim();

    if (code.startsWith('!')) {
      const negated = code.slice(1).trim();

      return negated.length > 0 && !this.granted().includes(negated);
    }

    return this.granted().includes('ALL_FUNCTIONS') || this.granted().includes(code);
  }

  /** Replaces the granted list, as a login or a withdrawal does. */
  grant(codes: readonly string[]): void {
    this.granted.set(codes);
  }
}

/**
 * The ngx-translate surface this screen touches: the `translate()` signal `TranslatePipe` 18 resolves
 * its keys through. Nothing here reaches the network.
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

describe('SavingsViewComponent', () => {
  let fixture: ComponentFixture<SavingsViewComponent>;
  let component: SavingsViewComponent;
  let readAccount: Mock<AccountRead>;
  let permissions: PermissionsStub;
  let routeParams: BehaviorSubject<ParamMap>;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines the
  // cast to one line and keeps the DOM assertions type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The route stub's parameter map for the `:id` segment a case is about. */
  function paramMapFor(id: string | null): ParamMap {
    const params: Record<string, string> = {};

    if (id !== null) {
      params['id'] = id;
    }

    return convertToParamMap(params);
  }

  /** The joined action group's links, in the order the record renders them. */
  function actionLinks(): readonly HTMLAnchorElement[] {
    return Array.from(host().querySelectorAll<HTMLAnchorElement>('.btn-group a'));
  }

  /** The summary table's rows as `[caption, value]` pairs, read from the cells the user sees. */
  function renderedSummary(): readonly (readonly [string, string])[] {
    return Array.from(host().querySelectorAll<HTMLTableRowElement>('.savings-summary tbody tr')).map(
      (row): readonly [string, string] => [
        row.querySelector('th')?.textContent?.trim() ?? '',
        row.querySelector('td')?.textContent?.trim() ?? '',
      ],
    );
  }

  /** Lets the screen's read answer and the first paint show it. */
  async function settle(): Promise<void> {
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /**
   * Mounts the record for one `#/viewsavingaccount/:id` URL and renders it once.
   *
   * The component's constructor subscribes to the route's parameters, so the first emission and its read
   * happen as the component is created. The subject backing the route is recreated per case, so one
   * case's emissions cannot reach the next.
   *
   * @param id the `:id` segment, or `null` for a route that carries none.
   * @param read the answer `SavingsService.get` gives for this case.
   */
  async function show(id: string | null, read: AccountRead = () => of(ACCOUNT)): Promise<void> {
    TestBed.resetTestingModule();
    readAccount.mockImplementation(read);
    routeParams = new BehaviorSubject<ParamMap>(paramMapFor(id));

    TestBed.configureTestingModule({
      imports: [SavingsViewComponent],
      providers: [
        provideRouter([]),
        { provide: SavingsService, useValue: { get: readAccount } },
        { provide: ActivatedRoute, useValue: { paramMap: routeParams.asObservable() } },
        { provide: TranslateService, useValue: translateStub() },
        { provide: PermissionsService, useValue: permissions },
      ],
    });

    permissions.grant(['READ_SAVINGSACCOUNT']);

    fixture = TestBed.createComponent(SavingsViewComponent);
    component = fixture.componentInstance;
    await settle();
  }

  /**
   * Moves the mounted record to another URL the way the router does when only the `:id` segment changes:
   * the same component instance stays on screen and the parameter map emits again.
   */
  async function navigateTo(id: string): Promise<void> {
    routeParams.next(paramMapFor(id));
    await settle();
  }

  /**
   * The production mapping of a Fineract failure onto `ApiError`, so a rejected read reaches the
   * component as the type it catches in the application (AAP 0.4.2).
   */
  function failure(status: number, message: string): ApiError {
    return toApiError(new HttpErrorResponse({ status, error: { defaultUserMessage: message } }));
  }

  beforeEach(() => {
    readAccount = vi.fn<AccountRead>();
    permissions = new PermissionsStub();
  });

  it('renders the loaded account from its one read, with its figures and its action links', async () => {
    await show(ACCOUNT_ID);

    expect(readAccount.mock.calls).toEqual([[ACCOUNT_ID]]);
    expect(component.accountId()).toBe(ACCOUNT_ID);
    expect(component.loading()).toBe(false);
    expect(component.notFound()).toBe(false);
    expect(component.clientError()).toBeNull();

    expect(host().textContent).toContain(ACCOUNT.accountNo);
    expect(host().textContent).toContain(ACCOUNT.savingsProductName);
    expect(renderedSummary().map(([caption, value]) => [caption, value])).toEqual([
      ['label.heading.accnum', ACCOUNT.accountNo],
      ['label.heading.product', ACCOUNT.savingsProductName],
      // The status row paints the swatch and never the server's status word (AAP 0.10.5 item 11).
      ['label.heading.status', ''],
      ['label.heading.currentBalance', '800'],
      ['label.heading.totaldeposits', '1,000'],
      ['label.totalwithdarawals', '200'],
    ]);

    // One transaction row per transaction the payload carried, in the server's order.
    expect(host().querySelectorAll('#savings-transactions tbody tr')).toHaveLength(
      ACCOUNT.transactions.length,
    );

    // Every action link is addressed at the account the route names…
    expect(actionLinks().map((link) => link.getAttribute('href'))).toEqual(
      ACTION_SEGMENTS.map((segment) => `/savingaccount/${ACCOUNT_ID}/${segment}`),
    );
    // …and the gate fails closed: without the code no entry point is visible.
    permissions.grant([]);
    fixture.detectChanges();
    expect(actionLinks().every((link) => link.style.display === 'none')).toBe(true);
  });

  it.each<[string, string | null]>([
    ['a route that names no account', null],
    ['a 404 from the account read', ACCOUNT_ID],
  ])('renders the not-found card in place of the record for %s', async (_label, id) => {
    await show(id, () => throwError(() => failure(404, NOT_FOUND_MESSAGE)));

    expect(component.notFound()).toBe(true);
    expect(host().textContent).toContain('error.msg.resource.not.found');
    // The record is replaced, not annotated: no action group, no summary, no alert beside it.
    expect(host().querySelector('.btn-group')).toBeNull();
    expect(host().querySelector('.savings-summary')).toBeNull();
    expect(host().querySelector('.alert')).toBeNull();
    expect(readAccount).toHaveBeenCalledTimes(id === null ? 0 : 1);
  });

  it('shows a failure other than a 404 verbatim and keeps the record page mounted', async () => {
    await show(ACCOUNT_ID, () => throwError(() => failure(400, REFUSED_MESSAGE)));

    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(REFUSED_MESSAGE);
    expect(component.clientError()?.message).toBe(REFUSED_MESSAGE);
    expect(component.notFound()).toBe(false);
    // A 5xx carries no inline message: the interceptor has already raised that failure's one notice.
    expect(component.account()).toBeNull();
  });

  it('re-reads the account for a second route id, replacing the record and its action links', async () => {
    await show(
      ACCOUNT_ID,
      (id) => of(String(id) === SECOND_ACCOUNT_ID ? SECOND_ACCOUNT : ACCOUNT),
    );

    expect(host().textContent).toContain(ACCOUNT.accountNo);

    await navigateTo(SECOND_ACCOUNT_ID);

    // One load per emission, addressed by the id the URL now names.
    expect(readAccount.mock.calls).toEqual([[ACCOUNT_ID], [SECOND_ACCOUNT_ID]]);
    expect(component.accountId()).toBe(SECOND_ACCOUNT_ID);
    // The second record is what the screen shows, and nothing of the first remains…
    expect(host().textContent).toContain(SECOND_ACCOUNT.accountNo);
    expect(host().textContent).toContain(SECOND_ACCOUNT.savingsProductName);
    expect(host().textContent).not.toContain(ACCOUNT.accountNo);
    // …including the action links, which followed the record's own id.
    expect(actionLinks().map((link) => link.getAttribute('href'))).toEqual(
      ACTION_SEGMENTS.map((segment) => `/savingaccount/${SECOND_ACCOUNT_ID}/${segment}`),
    );
    expect(component.loading()).toBe(false);
  });

  it('clears the previous record while the second route’s read is outstanding', async () => {
    const second = deferredResponse<SavingsAccount>();

    await show(ACCOUNT_ID, (id) =>
      String(id) === SECOND_ACCOUNT_ID ? second.response : of(ACCOUNT),
    );

    expect(host().textContent).toContain(ACCOUNT.accountNo);

    // The second route's answer is held open, which is the state an in-place move paints first.
    routeParams.next(paramMapFor(SECOND_ACCOUNT_ID));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.accountId()).toBe(SECOND_ACCOUNT_ID);
    expect(component.account()).toBeNull();
    expect(component.loading()).toBe(true);
    expect(host().textContent).not.toContain(ACCOUNT.accountNo);
    expect(actionLinks()).toEqual([]);

    second.resolve(SECOND_ACCOUNT);
    await settle();

    expect(component.account()?.id).toBe(SECOND_ACCOUNT.id);
    expect(component.loading()).toBe(false);
  });

  it('discards a superseded account’s answer that lands after the URL moved on', async () => {
    const first = deferredResponse<SavingsAccount>();
    const second = deferredResponse<SavingsAccount>();

    await show(ACCOUNT_ID, (id) =>
      String(id) === SECOND_ACCOUNT_ID ? second.response : first.response,
    );

    // The first account's read is still unanswered when the URL moves to the second account, which is
    // what a move between two record URLs produces when the earlier response is the slower one.
    routeParams.next(paramMapFor(SECOND_ACCOUNT_ID));
    await fixture.whenStable();

    second.resolve(SECOND_ACCOUNT);
    await settle();

    expect(component.account()?.id).toBe(SECOND_ACCOUNT.id);
    expect(component.loading()).toBe(false);

    // The earlier answer lands last. It is dropped rather than painted, so account 41's figures and
    // links can never appear under account 47's URL.
    first.resolve(ACCOUNT);
    await settle();

    expect(component.accountId()).toBe(SECOND_ACCOUNT_ID);
    expect(component.account()?.id).toBe(SECOND_ACCOUNT.id);
    expect(host().textContent).toContain(SECOND_ACCOUNT.accountNo);
    expect(host().textContent).not.toContain(ACCOUNT.accountNo);
    expect(actionLinks().map((link) => link.getAttribute('href'))).toEqual(
      ACTION_SEGMENTS.map((segment) => `/savingaccount/${SECOND_ACCOUNT_ID}/${segment}`),
    );
    expect(component.loading()).toBe(false);
    expect(component.error()).toBeNull();
  });
});
