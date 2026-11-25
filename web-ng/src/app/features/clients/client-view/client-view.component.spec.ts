import { provideZonelessChangeDetection, signal, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService } from '@ngx-translate/core';
import { EMPTY, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { PermissionsService } from '../../../core/auth/permissions.service';
import { ApiError } from '../../../core/http/api-error';
import type {
  Client,
  ClientAccountSummary,
  ClientIdentifier,
  ClientIdentifierTemplate,
} from '../client.models';
import { ClientService } from '../client.service';
import { ClientViewComponent } from './client-view.component';

/**
 * Behaviour of the client record screen — `#/viewclient/:id`, the last step of the "Sign in and open
 * a client record" flow and the entry point of workflow W3's record read (AAP 0.7.4 "Client view";
 * AAP 0.8.2 feature route `viewclient/:id`; Rule 1 clause 8, "tests prove behaviour").
 *
 * What the suite drives is the screen's public surface and the traffic it produces: the one record
 * read, the reads its tabs own, the four states the record can be in, the two in-scope tabs, and the
 * action links with the permission each is gated on. It also drives the record a second route
 * emission names, because the router reuses this component when the URL moves from one
 * `#/viewclient/{id}` to another. `ClientService` is stubbed at its own token, so
 * the endpoint-level contract — method, path and query parameters of `GET /clients/{id}` — stays in
 * `client.service.spec.ts` and no HTTP client, interceptor or transport takes part here (Rule 1
 * clause 5). The router, the translation stack and the permission gate are the real ones: the
 * screen's links are rendered by `RouterLink`, so the router is composed with the route that serves
 * this screen and the assertions read the hrefs the browser would follow.
 *
 * Every assertion is made on the rendered DOM, never on the component's signals, because the DOM is
 * the contract the user and the parity run observe.
 */

/** The route that serves the record, exactly as `clients.routes.ts` declares it. */
const ROUTES: Routes = [
  { path: 'viewclient/:id', component: ClientViewComponent },
  { path: 'viewclient', component: ClientViewComponent, pathMatch: 'full' },
];

/** The record the route was opened on: the client id `#/viewclient/2` names. */
const CLIENT_ID = '2';

/** The record the stubbed read answers with: the client the design's third screen shows. */
const CLIENT: Client = {
  id: 2,
  accountNo: '000000002',
  displayName: 'Ada Okafor',
  firstname: 'Ada',
  lastname: 'Okafor',
  officeId: 1,
  officeName: 'Head Office',
  staffName: 'Parity Officer',
  status: { id: 300, code: 'clientStatusType.active', value: 'Active' },
  activationDate: [2026, 11, 21],
  timeline: { submittedOnDate: '2026-11-21', activatedOnDate: [2026, 11, 21] },
};

/** The message Fineract answers a missing record with, matched character for character. */
const NOT_FOUND_MESSAGE = 'Client with id `2` does not exist.';

/**
 * The record a second route emission addresses: the id `#/viewclient/25` names, and the client the
 * baseline data holds under client number 000000025.
 *
 * Every value that reaches the screen differs from {@link CLIENT}'s — name, client number, office and
 * staff — so a second emission that kept the first record on screen could not be mistaken for a
 * correct one, and the action hrefs it asserts cannot match the first client's by accident.
 */
const SECOND_CLIENT_ID = '25';

const SECOND_CLIENT: Client = {
  id: 25,
  accountNo: '000000025',
  displayName: 'Marcus Rowe-Bennett',
  firstname: 'Marcus',
  lastname: 'Rowe-Bennett',
  officeId: 2,
  officeName: 'Branch One',
  staffName: 'Field Officer',
  status: { id: 300, code: 'clientStatusType.active', value: 'Active' },
  activationDate: [2026, 11, 24],
  timeline: { submittedOnDate: '2026-11-24', activatedOnDate: [2026, 11, 24] },
};

/** The account summary the accounts tab reads: a client holding none of either family. */
const NO_ACCOUNTS: ClientAccountSummary = {};

/** The identifiers the identities tab reads: none. */
const NO_IDENTIFIERS: ClientIdentifier[] = [];

/** The document types the identifiers template offers: none is needed for an empty list. */
const NO_DOCUMENT_TYPES: ClientIdentifierTemplate = { allowedDocumentTypes: [] };

/**
 * The captions this screen resolves, keyed exactly as the shipped flat legacy bundles key them
 * (`app/global-translations/`). A key that did not resolve would render humanised through the
 * missing-translation handler, so serving the real wording is what proves the labels resolve.
 */
const TRANSLATIONS: Readonly<Record<string, string>> = {
  'label.heading.general': 'General',
  'label.heading.identities': 'Identities',
  'label.heading.clientno': 'Client Number',
  'label.input.externalid': 'External ID',
  'label.input.office': 'Office',
  'label.input.staff': 'Staff',
  'label.heading.accountdetail': 'Account Detail',
  'label.heading.notavailable': 'Not Available',
  'error.msg.resource.not.found': 'The requested resource is not available.',
};

/** `ClientService` as this screen and its two loading tabs use it, every method stubbed. */
interface ClientServiceStub {
  readonly get: Mock<(id: number | string) => Observable<Client>>;
  readonly accounts: Mock<(id: number | string) => Observable<ClientAccountSummary>>;
  readonly identifiers: Mock<(id: number | string) => Observable<ClientIdentifier[]>>;
  readonly identifiersTemplate: Mock<(id: number | string) => Observable<ClientIdentifierTemplate>>;
}

/** `PermissionsService` as the action gates ask it. */
interface PermissionsStub {
  has(key: string): boolean;
}

/**
 * The ngx-translate surface this screen touches: the two event streams the constructor subscribes
 * to, the `currentLang()` and `instant()` reads behind the tab and profile-card labels, and the
 * `translate()` signal `TranslatePipe` 18 resolves its own keys through. Nothing here reaches the
 * network.
 */
interface TranslateStub {
  readonly currentLang: Signal<string>;
  instant(key: string): string;
  translate(key: string): Signal<string>;
  readonly onLangChange: Observable<unknown>;
  readonly onTranslationChange: Observable<unknown>;
}

/** Builds the translation stub the TestBed provides. */
function translateStub(): TranslateStub {
  return {
    currentLang: signal('en').asReadonly(),
    instant: (key: string): string => TRANSLATIONS[key] ?? key,
    translate: (key: string): Signal<string> => signal(TRANSLATIONS[key] ?? key),
    onLangChange: EMPTY,
    onTranslationChange: EMPTY,
  };
}

describe('ClientViewComponent', () => {
  let clients: ClientServiceStub;
  let granted: Set<string>;

  /**
   * Configures the TestBed for one case, with the stubbed reads and the permission codes the case
   * grants, then opens the record at `url` through the real router.
   *
   * Every case starts here, so the route and the answer the service gives are the only things it
   * changes. The module is reset first because a case supplies its own providers, and a module left
   * instantiated by the previous case cannot take new ones.
   */
  async function render(url: string): Promise<RouterTestingHarness> {
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter(ROUTES),
        { provide: ClientService, useValue: clients },
        { provide: TranslateService, useValue: translateStub() },
        {
          provide: PermissionsService,
          useValue: { has: (key: string): boolean => granted.has(key) } satisfies PermissionsStub,
        },
      ],
    });

    const harness = await RouterTestingHarness.create(url);

    // The read answers synchronously, but the tabs' own effects and the translate-driven labels
    // settle a microtask later, so the first paint is taken after the fixture is stable.
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();

    return harness;
  }

  /** The rendered host of the routed component, narrowed once so every query below is typed. */
  function hostOf(harness: RouterTestingHarness): HTMLElement {
    const element: unknown = harness.routeDebugElement?.nativeElement;

    if (!(element instanceof HTMLElement)) {
      throw new Error('the record route activated no component');
    }

    return element;
  }

  /** The routed component instance, narrowed once for the tab-switch cases. */
  function componentOf(harness: RouterTestingHarness): ClientViewComponent {
    const instance: unknown = harness.routeDebugElement?.componentInstance;

    if (!(instance instanceof ClientViewComponent)) {
      throw new Error('the record route activated no ClientViewComponent');
    }

    return instance;
  }

  /** The host's text with runs of whitespace collapsed to one space and the ends trimmed. */
  function renderedText(host: HTMLElement): string {
    return (host.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /** Every anchor the action row renders, in render order. */
  function actionLinks(host: HTMLElement): HTMLAnchorElement[] {
    return Array.from(host.querySelectorAll<HTMLAnchorElement>('.btn-group a'));
  }

  /** The href of every action anchor, in render order. */
  function actionHrefs(host: HTMLElement): (string | null)[] {
    return actionLinks(host).map((link) => link.getAttribute('href'));
  }

  /** The eight in-scope action hrefs, for the client id a record is showing. */
  function expectedHrefs(id: string): string[] {
    return [
      `/editclient/${id}`,
      `/newclientloanaccount/${id}`,
      `/new_client_saving_application/${id}`,
      `/client/${id}/close`,
      `/client/${id}/activate`,
      `/client/${id}/reject`,
      `/client/${id}/withdraw`,
      `/client/${id}/reactivate`,
    ];
  }

  /** Lets the queued reads and effects settle, then paints, which is what one navigation produces. */
  async function settle(harness: RouterTestingHarness): Promise<void> {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  /** The label and value cells of the profile card's rows, in render order. */
  function profileRows(host: HTMLElement): readonly (readonly [string, string])[] {
    return Array.from(host.querySelectorAll<HTMLElement>('[data-testid="profile-field"]')).map(
      (row) => [
        (row.querySelector('[data-testid="profile-field-label"]')?.textContent ?? '').trim(),
        (row.querySelector('[data-testid="profile-field-value"]')?.textContent ?? '').trim(),
      ],
    );
  }

  beforeEach(() => {
    clients = {
      get: vi.fn<(id: number | string) => Observable<Client>>(() => of(CLIENT)),
      accounts: vi.fn<(id: number | string) => Observable<ClientAccountSummary>>(
        () => of(NO_ACCOUNTS),
      ),
      identifiers: vi.fn<(id: number | string) => Observable<ClientIdentifier[]>>(
        () => of(NO_IDENTIFIERS),
      ),
      identifiersTemplate: vi.fn<(id: number | string) => Observable<ClientIdentifierTemplate>>(
        () => of(NO_DOCUMENT_TYPES),
      ),
    };

    // Every code legacy's own record gates an action on, so the action cases prove the rendered
    // link set rather than the gate; the denial case below withholds one of them.
    granted = new Set([
      'UPDATE_CLIENT',
      'CREATE_LOAN',
      'CREATE_SAVINGSACCOUNT',
      'CLOSE_CLIENT',
      'ACTIVATE_CLIENT',
      'REJECT_CLIENT',
      'WITHDRAW_CLIENT',
      'REACTIVATE_CLIENT',
    ]);
  });

  it('renders the record it read, with the two in-scope tabs and the client’s own profile rows', async () => {
    const host = hostOf(await render(`/viewclient/${CLIENT_ID}`));

    expect(host.querySelector('app-record-header h3 strong')?.textContent?.trim()).toBe(
      CLIENT.displayName,
    );
    expect(renderedText(host)).toContain(`Client Number: ${CLIENT.accountNo}`);

    const tabLabels = Array.from(host.querySelectorAll('app-tab-strip li[role="presentation"] a')).map(
      (tab) => (tab.textContent ?? '').trim(),
    );

    // Two tabs and no third: Family Members, Documents, Notes and Credit Report are out of scope
    // (AAP 0.10.5 item 6).
    expect(tabLabels).toEqual(['General', 'Identities']);

    // The profile card carries the client's own fields, and the external id this record does not
    // carry is an empty value rather than a placeholder (AAP 0.7.4).
    expect(profileRows(host)).toEqual([
      ['Client Number', CLIENT.accountNo],
      ['External ID', ''],
      ['Office', CLIENT.officeName],
      ['Staff', CLIENT.staffName ?? ''],
    ]);
  });

  it('reads the record once and leaves the tab reads to the tabs themselves', async () => {
    const harness = await render(`/viewclient/${CLIENT_ID}`);
    const component = componentOf(harness);

    expect(clients.get).toHaveBeenCalledTimes(1);
    expect(clients.get).toHaveBeenCalledWith(CLIENT_ID);

    // The General tab is the one shown, so its accounts read runs and the identities read does not.
    expect(clients.accounts).toHaveBeenCalledTimes(1);
    expect(clients.accounts).toHaveBeenCalledWith(CLIENT_ID);
    expect(clients.identifiers).not.toHaveBeenCalled();

    component.selectTab('identities');
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(clients.identifiers).toHaveBeenCalledTimes(1);
    expect(clients.identifiers).toHaveBeenCalledWith(CLIENT_ID);
    // Switching tabs re-reads nothing the record already holds.
    expect(clients.get).toHaveBeenCalledTimes(1);
  });

  it('renders the not-found message in place of the record when Fineract answers 404', async () => {
    clients.get.mockReturnValue(throwError(() => new ApiError(NOT_FOUND_MESSAGE, 404)));

    const host = hostOf(await render(`/viewclient/${CLIENT_ID}`));

    expect(renderedText(host)).toContain('Not Available');
    expect(renderedText(host)).toContain('The requested resource is not available.');
    // The record itself is not rendered, so no control is offered against a record never read.
    expect(host.querySelector('app-record-header')).toBeNull();
    expect(host.querySelector('app-tab-strip')).toBeNull();
    expect(actionLinks(host)).toHaveLength(0);
  });

  it('sends no request and claims the not-found state for a route with no client id', async () => {
    const host = hostOf(await render('/viewclient'));

    expect(clients.get).not.toHaveBeenCalled();
    expect(renderedText(host)).toContain('Not Available');
    expect(host.querySelector('app-record-header')).toBeNull();
  });

  it('shows a 4xx message verbatim and keeps the record usable', async () => {
    const refusal = 'The client record is not visible to this user.';
    clients.get.mockReturnValue(throwError(() => new ApiError(refusal, 403)));

    const host = hostOf(await render(`/viewclient/${CLIENT_ID}`));

    // No record was loaded, so the message stands alone; a 5xx would render nothing here at all,
    // because the interceptor has already notified for it (AAP 0.7.4; AAP 0.4.2).
    expect(renderedText(host)).toContain(refusal);
    expect(renderedText(host)).not.toContain('Not Available');
  });

  it('links every in-scope action to its own route', async () => {
    const host = hostOf(await render(`/viewclient/${CLIENT_ID}`));

    expect(actionHrefs(host)).toEqual([
      `/editclient/${CLIENT_ID}`,
      `/newclientloanaccount/${CLIENT_ID}`,
      `/new_client_saving_application/${CLIENT_ID}`,
      `/client/${CLIENT_ID}/close`,
      `/client/${CLIENT_ID}/activate`,
      `/client/${CLIENT_ID}/reject`,
      `/client/${CLIENT_ID}/withdraw`,
      `/client/${CLIENT_ID}/reactivate`,
    ]);
  });

  it('hides every action whose permission the user does not hold', async () => {
    granted = new Set<string>();

    const host = hostOf(await render(`/viewclient/${CLIENT_ID}`));
    const links = actionLinks(host);

    expect(links).toHaveLength(8);
    expect(links.every((link) => link.style.display === 'none')).toBe(true);
  });

  it('keeps a gated action visible for the one code the user holds', async () => {
    granted = new Set(['CLOSE_CLIENT']);

    const host = hostOf(await render(`/viewclient/${CLIENT_ID}`));
    const visible = actionLinks(host)
      .filter((link) => link.style.display !== 'none')
      .map((link) => link.getAttribute('href'));

    expect(visible).toEqual([`/client/${CLIENT_ID}/close`]);
  });

  it('renders no placeholder where the record carries no value', async () => {
    const host = hostOf(await render(`/viewclient/${CLIENT_ID}`));
    const text = renderedText(host);

    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
    expect(text).not.toContain('N/A');
  });

  it('re-reads the client for each route emission and paints the second client with its own hrefs', async () => {
    clients.get.mockImplementation((id: number | string) =>
      of(id === SECOND_CLIENT_ID ? SECOND_CLIENT : CLIENT),
    );

    const harness = await render(`/viewclient/${CLIENT_ID}`);
    const instance = componentOf(harness);

    expect(hostOf(harness).querySelector('app-record-header h3 strong')?.textContent?.trim()).toBe(
      CLIENT.displayName,
    );

    // The router reuses this component when the URL moves from one record to another, so a second
    // emission is what an in-app move between two clients produces.
    await harness.navigateByUrl(`/viewclient/${SECOND_CLIENT_ID}`);
    await settle(harness);

    const moved = hostOf(harness);

    // The same instance served both URLs: nothing below could pass by the screen being rebuilt.
    expect(componentOf(harness)).toBe(instance);

    // One load per emission, and each run addresses the client its own URL named.
    expect(clients.get).toHaveBeenCalledTimes(2);
    expect(clients.get).toHaveBeenNthCalledWith(1, CLIENT_ID);
    expect(clients.get).toHaveBeenNthCalledWith(2, SECOND_CLIENT_ID);

    // The second client's own values are on screen, from the header through the profile card.
    expect(moved.querySelector('app-record-header h3 strong')?.textContent?.trim()).toBe(
      SECOND_CLIENT.displayName,
    );
    expect(profileRows(moved)).toEqual([
      ['Client Number', SECOND_CLIENT.accountNo],
      ['External ID', ''],
      ['Office', SECOND_CLIENT.officeName],
      ['Staff', SECOND_CLIENT.staffName ?? ''],
    ]);

    // Every action href, and both tab inputs, address the client the URL names now.
    expect(actionHrefs(moved)).toEqual(expectedHrefs(SECOND_CLIENT_ID));
    expect(clients.accounts).toHaveBeenLastCalledWith(SECOND_CLIENT_ID);
  });

  it('ignores a superseded client’s answer that arrives after the URL moved on', async () => {
    const first = new Subject<Client>();
    const second = new Subject<Client>();

    clients.get.mockImplementation((id: number | string) =>
      id === SECOND_CLIENT_ID ? second.asObservable() : first.asObservable(),
    );

    const harness = await render(`/viewclient/${CLIENT_ID}`);

    // The first read is held open, so nothing is painted for the first client.
    expect(hostOf(harness).querySelector('app-record-header')).toBeNull();

    await harness.navigateByUrl(`/viewclient/${SECOND_CLIENT_ID}`);

    // The second read is the one the screen is waiting on; answering it paints the second client.
    second.next(SECOND_CLIENT);
    second.complete();
    await settle(harness);

    expect(hostOf(harness).querySelector('app-record-header h3 strong')?.textContent?.trim()).toBe(
      SECOND_CLIENT.displayName,
    );

    // The earlier client's answer lands last. It is dropped rather than painted, or the first
    // client's record and hrefs would appear under the second client's URL.
    first.next(CLIENT);
    first.complete();
    await settle(harness);

    const after = hostOf(harness);

    expect(after.querySelector('app-record-header h3 strong')?.textContent?.trim()).toBe(
      SECOND_CLIENT.displayName,
    );
    expect(profileRows(after)[0]).toEqual(['Client Number', SECOND_CLIENT.accountNo]);
    expect(actionHrefs(after)).toEqual(expectedHrefs(SECOND_CLIENT_ID));
  });

  it('clears the previous client’s not-found state when the URL moves to a client that exists', async () => {
    clients.get.mockImplementation((id: number | string) =>
      id === SECOND_CLIENT_ID
        ? of(SECOND_CLIENT)
        : throwError(() => new ApiError(NOT_FOUND_MESSAGE, 404)),
    );

    const harness = await render(`/viewclient/${CLIENT_ID}`);

    expect(renderedText(hostOf(harness))).toContain('Not Available');

    await harness.navigateByUrl(`/viewclient/${SECOND_CLIENT_ID}`);
    await settle(harness);

    const moved = hostOf(harness);

    // No trace of the missing client is left: the record the URL now names is what renders.
    expect(renderedText(moved)).not.toContain('Not Available');
    expect(moved.querySelector('app-record-header h3 strong')?.textContent?.trim()).toBe(
      SECOND_CLIENT.displayName,
    );
  });

  it('cancels the outstanding read when the screen is destroyed', async () => {
    const pending = new Subject<Client>();

    clients.get.mockReturnValue(pending.asObservable());

    const harness = await render(`/viewclient/${CLIENT_ID}`);

    // The read is in flight: the subject the read answers through has a subscriber.
    expect(pending.observed).toBe(true);

    harness.fixture.destroy();

    // Nothing is left holding the request open once the screen is gone.
    expect(pending.observed).toBe(false);
  });
});
