import { formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
  type EnvironmentProviders,
  type Provider,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  RouterOutlet,
  convertToParamMap,
  provideRouter,
  type ParamMap,
} from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { PermissionsService } from '../../../core/auth/permissions.service';
import { ApiError, toApiError } from '../../../core/http/api-error';
import {
  NotificationService,
  type NotificationKind,
} from '../../../core/notifications/notification.service';
import { DISPLAY_DATE_FORMAT } from '../../../shared/date-format.util';
import type { SavingsAccount } from '../savings.models';
import { SavingsService } from '../savings.service';
import { SavingsViewComponent } from './savings-view.component';

/** Behaviour of the savings record — `#/viewsavingaccount/:id`, the last screen of workflow W8 (AAP 0.9.1 scope group 4; AAP 0.10.1 W8 row; AAP 0.7.1 Features row `savings`) (AAP 0.7.3, AAP 0.7.4, AAP 0.10.5, AAP 0.4.2). */

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
  // The payload's own order, newest first, exactly as `GET /savingsaccounts/{id}?associations=all` answers it: the withdrawal the W8 workflow makes after the deposit comes first (Rule 1 clause 3).
  transactions: [
    {
      id: 92,
      date: [2026, 11, 24],
      transactionType: { id: 2, code: 'savingsAccountTransactionType.withdrawal', value: 'Withdrawal' },
      amount: 200,
      runningBalance: 800,
    },
    {
      id: 91,
      date: '2026-11-24',
      transactionType: { id: 1, code: 'savingsAccountTransactionType.deposit', value: 'Deposit' },
      amount: 1000,
      runningBalance: 1000,
    },
  ],
};

/** The account the second route emission names: every printed value differs from {@link ACCOUNT}, so a screen that kept the first record — or its action links — is caught. */
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

/** An account as the fork answers one whose deposit and withdrawal totals stand at zero: the summary carries `accountBalance` and leaves both totals out altogether (`SavingsSummary`), so the record has to read each absent. */
const BALANCE_ONLY_ACCOUNT: SavingsAccount = {
  ...ACCOUNT,
  accountNo: '000000045',
  summary: { accountBalance: 1250 },
  transactions: [],
};

/** The message a 404 answers with, quoted from Fineract's own `defaultUserMessage`. */
const NOT_FOUND_MESSAGE = 'The requested resource is not available.';

/** The message a refused read answers with, compared character for character below. */
const REFUSED_MESSAGE = 'The savings account could not be read for this user.';

/** The text a 5xx answers with. The record never paints it: the interceptor has already raised that failure's one notification (AAP 0.4.2), so a second copy on the page would report it twice. */
const SERVER_FAILURE_MESSAGE = 'The request could not be processed because an internal error occurred.';

/** The text a transport failure (`status` 0) answers with; it is the interceptor's to announce too. */
const TRANSPORT_FAILURE_MESSAGE = 'Http failure response for an unreachable Fineract host.';

/** The day both fixture transactions fall on, built part by part so it is local midnight everywhere. */
const TRANSACTION_DAY = new Date(2026, 10, 24);

/** The date cell the table must render for each fixture row: the shared display pattern, formatted the way the record's `DatePipe` formats it. */
const TRANSACTION_DAY_AS_SHOWN = formatDate(TRANSACTION_DAY, DISPLAY_DATE_FORMAT, 'en-US');

/** The read this screen makes of its family's service, so a case can answer it and count the calls. */
type AccountRead = (id: number | string) => Observable<SavingsAccount>;

/** The half of `PermissionsService` the `hasPermission` directive asks, with the legacy algebra for `ALL_FUNCTIONS` and a leading `!`, and a spy over every question so a case can state which code the record declared. */
class PermissionsStub implements Pick<PermissionsService, 'has'> {
  private readonly granted: WritableSignal<readonly string[]> = signal<readonly string[]>([]);

  /** Every permission question the mounted record's gate asked, in the order it asked them. */
  readonly has: Mock<(key: string) => boolean> = vi.fn((key: string): boolean => this.answer(key));

  /** Replaces the granted list, as a login or a withdrawal does. */
  grant(codes: readonly string[]): void {
    this.granted.set(codes);
  }

  /** Whether the permission — or its absence, for a negated code — is held. */
  private answer(key: string): boolean {
    const code = key.trim();

    if (code.startsWith('!')) {
      const negated = code.slice(1).trim();

      return negated.length > 0 && !this.granted().includes(negated);
    }

    return this.granted().includes('ALL_FUNCTIONS') || this.granted().includes(code);
  }
}

/** `NotificationService` as this screen would use it: the record raises no notice of its own. */
interface NotificationStub {
  readonly show: Mock<(kind: NotificationKind, message: string) => void>;
}

/** One `SavingsService` member the record must never reach, stubbed as a spy so a call would be observable rather than a missing-method failure that a case could mistake for correct behaviour. */
type UnreachedCall = Mock<(...args: readonly unknown[]) => Observable<unknown>>;

/** The five members of the family's service the record page does not call: the template read and the application belong to the new-application screen, the lifecycle actions to the action screens, and the transaction (AAP 0.7.3). */
interface UnreachedSavingsMethods {
  readonly template: UnreachedCall;
  readonly create: UnreachedCall;
  readonly action: UnreachedCall;
  readonly transactionTemplate: UnreachedCall;
  readonly transaction: UnreachedCall;
}

/** Builds the five spies; each case gets its own, so one case's call cannot answer another's. */
function unreachedSavingsMethods(): UnreachedSavingsMethods {
  return {
    template: vi.fn<(...args: readonly unknown[]) => Observable<unknown>>(),
    create: vi.fn<(...args: readonly unknown[]) => Observable<unknown>>(),
    action: vi.fn<(...args: readonly unknown[]) => Observable<unknown>>(),
    transactionTemplate: vi.fn<(...args: readonly unknown[]) => Observable<unknown>>(),
    transaction: vi.fn<(...args: readonly unknown[]) => Observable<unknown>>(),
  };
}

/** The record mounted inside the signed-in shell: the layout renders a `<router-outlet>` beside the page a user is on, and the not-found case needs both on screen at once to show that the record is replaced in place rather (AAP 0.7.4). */
@Component({
  selector: 'app-savings-view-shell-host',
  imports: [RouterOutlet, SavingsViewComponent],
  template: '<router-outlet /><app-savings-view />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class SavingsViewShellHostComponent {}

/** The ngx-translate surface this screen touches: the `translate()` signal `TranslatePipe` 18 resolves its keys through. */
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

/** An observable a case settles by hand, so one route's answer can be held open while the URL moves on — the order in which a superseded read answers last. */
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
  let unreached: UnreachedSavingsMethods;
  let notifications: NotificationStub;
  let permissions: PermissionsStub;
  let routeParams: BehaviorSubject<ParamMap>;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines the cast to one line and keeps the DOM assertions type-checked (Rule 1 clause 4).
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

  /** The transactions table's column captions, in the order the record renders them. */
  function transactionCaptions(): readonly string[] {
    const table = host().querySelector('#savings-transactions');

    return Array.from(table?.querySelectorAll('thead th') ?? []).map(
      (heading) => heading.textContent?.trim() ?? '',
    );
  }

  /** The transactions table's body rows, each as the four cells the user sees, in the rows' order. */
  function transactionCells(): readonly (readonly string[])[] {
    const table = host().querySelector('#savings-transactions');

    return Array.from(table?.querySelectorAll('tbody tr') ?? []).map((row) =>
      Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent?.trim() ?? ''),
    );
  }

  /** Lets the screen's read answer and the first paint show it. */
  async function settle(): Promise<void> {
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** The providers both mountings share: the record's two stubbed collaborations, the translation surface behind `TranslatePipe`, and a router so `routerLink` renders a real `href`. */
  function providers(): (Provider | EnvironmentProviders)[] {
    return [
      provideRouter([]),
      { provide: SavingsService, useValue: { get: readAccount, ...unreached } },
      { provide: ActivatedRoute, useValue: { paramMap: routeParams.asObservable() } },
      { provide: TranslateService, useValue: translateStub() },
      { provide: PermissionsService, useValue: permissions },
      { provide: NotificationService, useValue: notifications },
    ];
  }

  /** Mounts the record for one `#/viewsavingaccount/:id` URL and renders it once. */
  async function show(id: string | null, read: AccountRead = () => of(ACCOUNT)): Promise<void> {
    TestBed.resetTestingModule();
    readAccount.mockReset();
    readAccount.mockImplementation(read);
    routeParams = new BehaviorSubject<ParamMap>(paramMapFor(id));

    TestBed.configureTestingModule({
      imports: [SavingsViewComponent],
      providers: providers(),
    });

    permissions.grant(['READ_SAVINGSACCOUNT']);

    fixture = TestBed.createComponent(SavingsViewComponent);
    component = fixture.componentInstance;
    await settle();
  }

  /** Moves the mounted record to another URL the way the router does when only the `:id` segment changes: the same component instance stays on screen and the parameter map emits again. */
  async function navigateTo(id: string): Promise<void> {
    routeParams.next(paramMapFor(id));
    await settle();
  }

  /** The production mapping of a Fineract failure onto `ApiError`, so a rejected read reaches the component as the type it catches in the application (AAP 0.4.2). */
  function failure(status: number, message: string): ApiError {
    return toApiError(new HttpErrorResponse({ status, error: { defaultUserMessage: message } }));
  }

  beforeEach(() => {
    readAccount = vi.fn<AccountRead>();
    unreached = unreachedSavingsMethods();
    notifications = { show: vi.fn() };
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

    // Every action link is addressed at the account the route names, in the order the record renders them; which of them a user may see is the permission case below.
    expect(actionLinks().map((link) => link.getAttribute('href'))).toEqual(
      ACTION_SEGMENTS.map((segment) => `/savingaccount/${ACCOUNT_ID}/${segment}`),
    );
  });

  /** Locks down contract-savings-totals-required-false: the fork omits a zero `totalDeposits` and `totalWithdrawals` from the account summary, so the record reads each absent member as `0` instead of piping an absent value. */
  it('renders a deposit and withdrawal total the fork left out as 0, and the balance it sent', async () => {
    await show(ACCOUNT_ID, () => of(BALANCE_ONLY_ACCOUNT));

    expect(renderedSummary().map(([caption, value]) => [caption, value])).toEqual([
      ['label.heading.accnum', BALANCE_ONLY_ACCOUNT.accountNo],
      ['label.heading.product', BALANCE_ONLY_ACCOUNT.savingsProductName],
      ['label.heading.status', ''],
      // The balance is the figure the payload carried, so the two zeros below are the absent totals and not a cell rendering nothing at all (Rule 1 clause 3).
      ['label.heading.currentBalance', '1,250'],
      ['label.heading.totaldeposits', '0'],
      ['label.totalwithdarawals', '0'],
    ]);
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
    // A refused read leaves no record behind, and the failure's own text is all the page adds to it.
    expect(component.account()).toBeNull();
  });

  it('renders the transaction table with its four columns and one row per transaction', async () => {
    await show(ACCOUNT_ID);

    // The four columns of the record's transactions table, in the order they are painted.
    expect(transactionCaptions()).toEqual([
      'label.heading.date',
      'label.heading.type',
      'label.heading.amount',
      'label.heading.balance',
    ]);

    // Every cell is the payload's own, in the payload's order: the date through the shared display pattern, the row's type text verbatim, the amount exactly as reported — the withdrawal's 200 is not turned into a negative the (Rule 1 clause 3, AAP 0.10.1).
    expect(transactionCells()).toEqual([
      [TRANSACTION_DAY_AS_SHOWN, 'Withdrawal', '200', '800'],
      [TRANSACTION_DAY_AS_SHOWN, 'Deposit', '1,000', '1,000'],
    ]);
  });

  it('paints the status as one colour swatch and never as a word', async () => {
    await show(ACCOUNT_ID);

    const swatches = host().querySelectorAll('app-status-swatch');

    expect(swatches).toHaveLength(1);

    const indicator = swatches[0]?.querySelector('.status-swatch');

    expect(indicator?.classList.contains('status-active')).toBe(true);
    expect(swatches[0]?.textContent?.trim()).toBe('');

    // The server's own status word is on the payload and is deliberately not painted, and no tooltip or accessible name turns the colour back into a word (AAP 0.10.5 item 11, Rule 1 clause 3).
    const summary = host().querySelector('.savings-summary');

    expect(summary?.textContent ?? '').not.toContain(ACCOUNT.status.value);
    expect(summary?.querySelector('[title], [aria-label]')).toBeNull();
  });

  it('renders the explicit empty state and no table for an account carrying no transaction', async () => {
    await show(ACCOUNT_ID, () => of({ ...ACCOUNT, transactions: [] }));

    const section = host().querySelector('.savings-transactions');

    expect(component.transactionRows()).toEqual([]);
    // The shared explicit empty state sits inside the section's own body, and no table claims rows there are none of; an empty list is not a failure, so nothing in the section is an alert (AAP 0.7.4).
    expect(section?.querySelector('app-empty-state')?.textContent?.trim()).toBe('label.nodata');
    expect(section?.querySelector('table')).toBeNull();
    expect(section?.querySelector('.alert')).toBeNull();
    // The record itself still renders: an empty list is a state of the record, not a failure of it.
    expect(host().querySelector('.savings-summary')).not.toBeNull();
    expect(host().querySelector('.alert-danger')).toBeNull();
  });

  it.each<[number, string]>([
    [503, SERVER_FAILURE_MESSAGE],
    [0, TRANSPORT_FAILURE_MESSAGE],
  ])('leaves a %i failure to the interceptor’s one notification', async (status, message) => {
    await show(ACCOUNT_ID, () => throwError(() => failure(status, message)));

    // The record keeps the failure it was given and paints neither a second copy of its message nor a not-found state: a 5xx and a transport failure belong to the interceptor's one notice, so a screen that repeated them would (AAP 0.4.2, AAP 0.7.4, AAP 0.14.2).
    expect(component.error()?.status).toBe(status);
    expect(component.clientError()).toBeNull();
    expect(component.notFound()).toBe(false);
    expect(component.account()).toBeNull();
    expect(host().querySelector('.alert-danger')).toBeNull();
    expect(host().textContent ?? '').not.toContain(message);
    // The page stays mounted with nothing of a record that never arrived on it, so the shell the record sits in is still usable.
    expect(host().querySelector('.container-fluid')).not.toBeNull();
    expect(host().querySelector('.savings-summary')).toBeNull();
    expect(component.loading()).toBe(false);
  });

  it.each<[string, AccountRead]>([
    ['a loaded record', () => of(ACCOUNT)],
    ['a 404 from the account read', () => throwError(() => failure(404, NOT_FOUND_MESSAGE))],
    ['a refused read', () => throwError(() => failure(400, REFUSED_MESSAGE))],
    ['a 5xx', () => throwError(() => failure(503, SERVER_FAILURE_MESSAGE))],
    ['a transport failure', () => throwError(() => failure(0, TRANSPORT_FAILURE_MESSAGE))],
  ])(
    'issues exactly one read and announces nothing itself for %s',
    async (_label: string, read: AccountRead) => {
      await show(ACCOUNT_ID, read);

      // One request per navigation, made through the family's service and through no other member of it: the record composes no URL, posts nothing, opens no template and reads no business date (AAP 0.4.2, AAP 0.10.5 item 15 (Rule 1 clause 5).
      expect(readAccount.mock.calls).toEqual([[ACCOUNT_ID]]);
      expect(unreached.template).not.toHaveBeenCalled();
      expect(unreached.create).not.toHaveBeenCalled();
      expect(unreached.action).not.toHaveBeenCalled();
      expect(unreached.transactionTemplate).not.toHaveBeenCalled();
      expect(unreached.transaction).not.toHaveBeenCalled();
      // The interceptor owns every notice, so the record raises none in any branch.
      expect(notifications.show).not.toHaveBeenCalled();
    },
  );

  it('declares one permission code for every action and hides the links without removing them', async () => {
    await show(ACCOUNT_ID);

    // Every gate on the page asks the record's own single code, and asks about nothing else — the plan supplies no per-action code for this family (AAP 0.7.1, AAP 0.9.1 item 1).
    expect(component.actionPermission).toBe('READ_SAVINGSACCOUNT');
    expect(permissions.has.mock.calls.length).toBeGreaterThanOrEqual(ACTION_SEGMENTS.length);
    expect(
      permissions.has.mock.calls.every(([code]) => code === component.actionPermission),
    ).toBe(true);

    // The gate fails closed and hides in place: the four links stay in the document carrying an inline `display: none`, which is how the legacy directive hides a control rather than removing it.
    permissions.grant([]);
    fixture.detectChanges();

    expect(actionLinks()).toHaveLength(ACTION_SEGMENTS.length);
    expect(actionLinks().every((link) => link.style.display === 'none')).toBe(true);

    // Granting the code again reveals all four, so the gate is live rather than a one-time snapshot.
    permissions.grant(['READ_SAVINGSACCOUNT']);
    fixture.detectChanges();

    expect(actionLinks().every((link) => link.style.display === '')).toBe(true);
  });

  it('replaces the record with the not-found card inside a shell whose outlet stays', async () => {
    TestBed.resetTestingModule();
    readAccount.mockReset();
    readAccount.mockImplementation(() => throwError(() => failure(404, NOT_FOUND_MESSAGE)));
    routeParams = new BehaviorSubject<ParamMap>(paramMapFor(ACCOUNT_ID));

    TestBed.configureTestingModule({
      imports: [SavingsViewShellHostComponent],
      providers: providers(),
    });

    const shell = TestBed.createComponent(SavingsViewShellHostComponent);

    await Promise.resolve();
    await shell.whenStable();
    shell.detectChanges();

    // `ComponentFixture.nativeElement` is typed `any`; one narrowing cast keeps the assertions typed.
    const page = shell.nativeElement as HTMLElement;

    // The record is replaced by the card…
    expect(page.querySelector('.savings-not-found')).not.toBeNull();
    expect(page.querySelector('.savings-summary')).toBeNull();
    expect(page.querySelector('.savings-transactions')).toBeNull();
    expect(page.textContent ?? '').not.toContain(ACCOUNT.accountNo);
    // …and the outlet the shell navigates through is still there, so the record is replaced in place rather than the page being torn down (AAP 0.7.4).
    expect(page.querySelector('router-outlet')).not.toBeNull();
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

    // The first account's read is still unanswered when the URL moves to the second account, which is what a move between two record URLs produces when the earlier response is the slower one.
    routeParams.next(paramMapFor(SECOND_ACCOUNT_ID));
    await fixture.whenStable();

    second.resolve(SECOND_ACCOUNT);
    await settle();

    expect(component.account()?.id).toBe(SECOND_ACCOUNT.id);
    expect(component.loading()).toBe(false);

    // The earlier answer lands last. It is dropped rather than painted, so account 41's figures and links can never appear under account 47's URL.
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
