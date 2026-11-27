import { HttpErrorResponse } from '@angular/common/http';
import { DebugElement, provideZonelessChangeDetection, signal, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, RouterLink, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService } from '@ngx-translate/core';
import { EMPTY, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ALL_FUNCTIONS, PermissionsService } from '../../../core/auth/permissions.service';
import { ApiError, toApiError } from '../../../core/http/api-error';
import {
  NotificationService,
  type NotificationKind,
} from '../../../core/notifications/notification.service';
import type {
  Client,
  ClientAccountSummary,
  ClientIdentifier,
  ClientIdentifierTemplate,
} from '../client.models';
import { ClientService } from '../client.service';
import { ClientViewComponent } from './client-view.component';
import { RecordHeaderComponent } from './record-header/record-header.component';
import { TabStripComponent, tabDomId } from '../../../shared/tab-strip/tab-strip.component';

/** Behaviour of the client record screen — `#/viewclient/:id`, the last step of the "Sign in and open a client record" flow and the entry point of workflow W3's record read (AAP 0.7.4 "Client view"; AAP 0.8.2 feature route; Rule 1 clause 8, Rule 1 clause 5, AAP 0.1.1, AAP 0.7.1). */

const ROUTES: Routes = [
  { path: 'viewclient/:id', component: ClientViewComponent },
  { path: 'viewclient', component: ClientViewComponent, pathMatch: 'full' },
];

const CLIENT_ID = '2';

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

const NOT_FOUND_MESSAGE = 'Client with id `2` does not exist.';

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

/** The same client once its record has been closed: the one state whose action list is `Reactivate` alone, because that is the only entry legacy's `Closed` state carries for a command this build implements (`app/scripts/models/clientStatus.js`; AAP 0.7.4). */
const CLOSED_CLIENT: Client = {
  ...CLIENT,
  status: { id: 600, code: 'clientStatusType.closed', value: 'Closed' },
};

const PENDING_CLIENT: Client = {
  ...CLIENT,
  status: { id: 100, code: 'clientStatusType.pending', value: 'Pending' },
  activationDate: undefined,
};

/** The same client after its application was rejected: legacy answers that state with `undoReject` alone, a command this build does not implement. */
const REJECTED_CLIENT: Client = {
  ...CLIENT,
  status: { id: 200, code: 'clientStatusType.rejected', value: 'Rejected' },
};

/** The same client after its application was withdrawn: legacy answers that state with `undoWithdrawn`, which this build does not implement either. */
const WITHDRAWN_CLIENT: Client = {
  ...CLIENT,
  status: { id: 700, code: 'clientStatusType.withdraw', value: 'Withdrawn' },
};

/** The same client while a transfer is in progress: legacy's list for that state holds the transfer commands alone, none of which is in scope (AAP 0.10.5 item 5). */
const TRANSFERRING_CLIENT: Client = {
  ...CLIENT,
  status: { id: 601, code: 'clientStatusType.transfer.in.progress', value: 'Transfer in progress' },
};

/** The same client with the neutral code the enum declares for a record that is in none of the states above: legacy's list carries no entry for it. */
const INVALID_CLIENT: Client = {
  ...CLIENT,
  status: { id: 0, code: 'clientStatusType.invalid', value: 'Invalid' },
};

/** Every state whose legacy action list holds only commands this build does not implement, named as `label.button.*`-free prose for the parameterised case below: `undoReject`, `undoWithdrawn` and the transfer commands (AAP 0.10.5 item 5; Rule 1 clause 3). */
const NO_ACTION_STATES: readonly (readonly [string, Client])[] = [
  ['rejected', REJECTED_CLIENT],
  ['withdrawn', WITHDRAWN_CLIENT],
  ['transferring', TRANSFERRING_CLIENT],
  ['invalid', INVALID_CLIENT],
];

const NO_ACCOUNTS: ClientAccountSummary = {};

const NO_IDENTIFIERS: ClientIdentifier[] = [];

const NO_DOCUMENT_TYPES: ClientIdentifierTemplate = { allowedDocumentTypes: [] };

/** The captions this screen resolves, keyed exactly as the shipped flat legacy bundles key them (`app/global-translations/`) (Rule 1 clause 6). */
const TRANSLATIONS: Readonly<Record<string, string>> = {
  'label.heading.general': 'General',
  'label.heading.identities': 'Identities',
  'label.heading.clientno': 'Client Number',
  'label.input.externalid': 'External ID',
  'label.input.office': 'Office',
  'label.input.staff': 'Staff',
  'label.input.activationdate': 'Activation Date',
  'label.heading.performancehistory': 'Performance History',
  'label.heading.numofloancycle': 'No. of Loan Cycle',
  'label.lastloanamount': 'Last Loan Amount',
  'label.numofactiveloans': 'No. of Active Loans',
  'label.totalsavings': 'Total Savings',
  'label.numofactivesavings': 'No. of Active Savings',
  'label.heading.accountdetail': 'Account Detail',
  'label.heading.notavailable': 'Not Available',
  'error.msg.resource.not.found': 'The requested resource is not available.',
};

interface ClientServiceStub {
  readonly get: Mock<(id: number | string) => Observable<Client>>;
  readonly accounts: Mock<(id: number | string) => Observable<ClientAccountSummary>>;
  readonly identifiers: Mock<(id: number | string) => Observable<ClientIdentifier[]>>;
  readonly identifiersTemplate: Mock<(id: number | string) => Observable<ClientIdentifierTemplate>>;
}

/** `NotificationService` as this screen could use it: the one method a component that reported a failure itself would call (AAP 0.7.4, AAP 0.4.2). */
interface NotificationStub {
  readonly show: Mock<(kind: NotificationKind, message: string) => void>;
}

/** The failure a read rejects with, built by the application's own mapper from the response Fineract would answer, so every case drives the message and status the interceptor hands this screen rather than an `ApiError` a double assembled by hand (AAP 0.7.2, AAP 0.14.1). */
function failure(status: number, defaultUserMessage: string): ApiError {
  return toApiError(new HttpErrorResponse({ status, error: { defaultUserMessage } }));
}

interface TranslateStub {
  readonly currentLang: Signal<string>;
  instant(key: string): string;
  translate(key: string): Signal<string>;
  readonly onLangChange: Observable<unknown>;
  readonly onTranslationChange: Observable<unknown>;
}

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
  let notifications: NotificationStub;
  let heldCodes: readonly string[];

  /** Configures the TestBed for one case, with the stubbed reads, the notification double and the permission codes the case holds, then opens the record at `url` through the real router. */
  async function render(url: string): Promise<RouterTestingHarness> {
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter(ROUTES),
        { provide: ClientService, useValue: clients },
        { provide: NotificationService, useValue: notifications },
        { provide: TranslateService, useValue: translateStub() },
      ],
    });

    // The real gate, holding exactly the codes this case names: `ALL_FUNCTIONS`, the `READ_` rule and the fail-closed answer for a list with nothing in it are `PermissionsService`'s own algebra, so the rendered visibility is the service's own verdict (AAP 0.1.1, Rule 1 clause 3).
    TestBed.inject(PermissionsService).setPermissions(heldCodes);

    const harness = await RouterTestingHarness.create(url);

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

  function actionLinks(host: HTMLElement): HTMLAnchorElement[] {
    return Array.from(host.querySelectorAll<HTMLAnchorElement>('.btn-group a'));
  }

  /** The href of every action anchor, in render order: the visible row's entries first, then the `More` menu's. */
  function actionHrefs(host: HTMLElement): (string | null)[] {
    return actionLinks(host).map((link) => link.getAttribute('href'));
  }

  /** The href of every anchor of the visible row alone, without the `More` menu's entries, so a case can prove how a state splits its descriptors (AAP 0.7.4). */
  function rowHrefs(host: HTMLElement): (string | null)[] {
    return Array.from(host.querySelectorAll<HTMLAnchorElement>('div.btn-group > a.btn.btn-primary')).map(
      (link) => link.getAttribute('href'),
    );
  }

  /** The lifecycle command a route names — its last path segment — so an assertion can ask which command a link carries without holding a URL-shaped literal of its own for the endpoint gate to read as a bare endpoint path. */
  function commandOf(route: string): string {
    return route.split('/').at(-1) ?? '';
  }

  /** The action hrefs an **active** record shows for the client id it is showing: the three entries of the joined row, and no `More` menu at all, because legacy's `Active` list carries no lifecycle command in scope (`app/scripts/models/clientStatus.js`; AAP 0.7.4). */
  function expectedActiveHrefs(id: string): string[] {
    return [`/editclient/${id}`, `/newclientloanaccount/${id}`, `/client/${id}/close`];
  }

  /** The action hrefs a **pending** record shows: `Edit` and `Close` in the row, then `Activate`, `Reject` and `Withdraw` in the `More` menu, in that state's own order. */
  function expectedPendingHrefs(id: string): string[] {
    return [
      `/editclient/${id}`,
      `/client/${id}/close`,
      `/client/${id}/activate`,
      `/client/${id}/reject`,
      `/client/${id}/withdraw`,
    ];
  }

  /** The one href a **closed** record shows: `Reactivate` in the `More` menu, because reactivation is the command that state answers. */
  function expectedClosedHrefs(id: string): string[] {
    return [`/client/${id}/reactivate`];
  }

  /** The legacy label keys an **active** record's descriptors carry, in render order (`label.button.*` in `app/global-translations/`; AAP 0.7.4). */
  const ACTIVE_LABEL_KEYS: readonly string[] = [
    'label.button.edit',
    'label.button.newloan',
    'label.button.close',
  ];

  /** The permission each active-record descriptor is gated on — legacy's own code per action (`app/scripts/models/clientStatus.js`) — so the plan's gate cannot be widened or swapped silently (AAP 0.1.1; AAP 0.7.4). */
  const ACTIVE_PERMISSIONS: readonly string[] = ['UPDATE_CLIENT', 'CREATE_LOAN', 'CLOSE_CLIENT'];

  /** The legacy label keys a **pending** record's descriptors carry: the row's two entries, then the menu's three lifecycle commands. */
  const PENDING_LABEL_KEYS: readonly string[] = [
    'label.button.edit',
    'label.button.close',
    'label.button.activate',
    'label.button.reject',
    'label.button.withdraw',
  ];

  const PENDING_PERMISSIONS: readonly string[] = [
    'UPDATE_CLIENT',
    'CLOSE_CLIENT',
    'ACTIVATE_CLIENT',
    'REJECT_CLIENT',
    'WITHDRAW_CLIENT',
  ];

  /** Lets the queued reads and effects settle, then paints, which is what one navigation produces. */
  async function settle(harness: RouterTestingHarness): Promise<void> {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  function profileRows(host: HTMLElement): readonly (readonly [string, string])[] {
    return Array.from(host.querySelectorAll<HTMLElement>('[data-testid="profile-field"]')).map(
      (row) => [
        (row.querySelector('[data-testid="profile-field-label"]')?.textContent ?? '').trim(),
        (row.querySelector('[data-testid="profile-field-value"]')?.textContent ?? '').trim(),
      ],
    );
  }

  /** The label and value cells of the profile card's `Performance History` rows, in render order (AAP 0.7.4). */
  function historyRows(host: HTMLElement): readonly (readonly [string, string])[] {
    return Array.from(host.querySelectorAll<HTMLElement>('[data-testid="profile-history-field"]')).map(
      (row) => [
        (row.querySelector('[data-testid="profile-history-field-label"]')?.textContent ?? '').trim(),
        (row.querySelector('[data-testid="profile-history-field-value"]')?.textContent ?? '').trim(),
      ],
    );
  }

  /** The routed component's debug element, narrowed once so `By.directive` queries are typed. */
  function debugOf(harness: RouterTestingHarness): DebugElement {
    const element: unknown = harness.routeDebugElement;

    if (!(element instanceof DebugElement)) {
      throw new Error('the record route activated no component');
    }

    return element;
  }

  /** The record header as the screen rendered it, so a case can read the input the screen handed it: the header is presentational and paints whatever record it receives (AAP 0.7.4). */
  function recordHeaderOf(harness: RouterTestingHarness): RecordHeaderComponent {
    const header = debugOf(harness).query(By.directive(RecordHeaderComponent));

    if (header === null) {
      throw new Error('the record rendered no header');
    }

    const instance: unknown = header.componentInstance;

    if (!(instance instanceof RecordHeaderComponent)) {
      throw new Error('the record rendered no RecordHeaderComponent');
    }

    return instance;
  }

  /** The tab strip as the screen rendered it, so a case can read the tab the screen reports as selected rather than inferring it from the body: the strip holds no tab list of its own and paints exactly the active id it is handed (AAP 0.7.4). */
  function tabStripOf(harness: RouterTestingHarness): TabStripComponent {
    const strip = debugOf(harness).query(By.directive(TabStripComponent));

    if (strip === null) {
      throw new Error('the record rendered no tab strip');
    }

    const instance: unknown = strip.componentInstance;

    if (!(instance instanceof TabStripComponent)) {
      throw new Error('the record rendered no TabStripComponent');
    }

    return instance;
  }

  /** The route each rendered action anchor names, read through the `RouterLink` directive the anchor carries rather than through its rendered `href`, so the assertion proves what the router would navigate to and the template cannot drift from the descriptors the component computes (AAP 0.8.2, AAP 0.7.4). */
  function renderedRoutes(harness: RouterTestingHarness): string[] {
    return debugOf(harness)
      .queryAll(By.directive(RouterLink))
      .map((link) => {
        const tree = link.injector.get(RouterLink).urlTree;

        if (tree === null) {
          throw new Error('an action anchor carries no route');
        }

        return tree.toString();
      });
  }

  /** The one action anchor naming `href`, or a named failure when the row rendered none. */
  function linkFor(host: HTMLElement, href: string): HTMLAnchorElement {
    const link = actionLinks(host).find((candidate) => candidate.getAttribute('href') === href);

    if (link === undefined) {
      throw new Error('the record rendered no action naming the requested route');
    }

    return link;
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

    notifications = { show: vi.fn<(kind: NotificationKind, message: string) => void>() };

    // Every code legacy's own record gates an action on, so the action cases prove the rendered link set rather than the gate; the gate cases below narrow it to the codes they name.
    heldCodes = [
      'UPDATE_CLIENT',
      'CREATE_LOAN',
      'CLOSE_CLIENT',
      'ACTIVATE_CLIENT',
      'REJECT_CLIENT',
      'WITHDRAW_CLIENT',
      'REACTIVATE_CLIENT',
    ];
  });

  it('reads the record once and hands it to the header', async () => {
    const harness = await render(`/viewclient/${CLIENT_ID}`);
    const host = hostOf(harness);

    // One read for one navigation, addressed to the client the URL names (AAP 0.7.1 row `clients`; AAP 0.7.3 row "W3 search and view client").
    expect(clients.get).toHaveBeenCalledTimes(1);
    expect(clients.get).toHaveBeenCalledWith(CLIENT_ID);

    expect(recordHeaderOf(harness).client()).toEqual(CLIENT);
    expect(host.querySelector('app-record-header h1 strong')?.textContent?.trim()).toBe(
      CLIENT.displayName,
    );
    expect(renderedText(host)).toContain(`Client Number: ${CLIENT.accountNo}`);

    const tabLabels = Array.from(
      host.querySelectorAll('app-tab-strip ul.nav-tabs > li > a'),
    ).map((tab) => (tab.textContent ?? '').trim());

    // Two tabs and no third: Family Members, Documents, Notes and Credit Report are out of scope (AAP 0.10.5 item 6).
    expect(tabLabels).toEqual(['General', 'Identities']);

    // The crumb is the record's own office — the design's "Head Office /" for this client — and not a static route trail (AAP 0.7.4).
    expect(host.querySelector('ol.breadcrumb')?.textContent?.trim()).toBe(`${CLIENT.officeName} /`);

    // The profile card carries the client's own fields, the activation date the payload supplies, and an empty value for the external id this record does not carry (AAP 0.7.4).
    expect(profileRows(host)).toEqual([
      ['Client Number', CLIENT.accountNo],
      ['External ID', ''],
      ['Office', CLIENT.officeName],
      ['Staff', CLIENT.staffName ?? ''],
      ['Activation Date', '21 November 2026'],
    ]);

    expect(historyRows(host)).toEqual([
      ['No. of Loan Cycle', ''],
      ['Last Loan Amount', ''],
      ['No. of Active Loans', ''],
      ['Total Savings', ''],
      ['No. of Active Savings', ''],
    ]);
  });

  it('opens on the General tab, whose two sections render and whose sibling does not', async () => {
    const harness = await render(`/viewclient/${CLIENT_ID}`);
    const host = hostOf(harness);

    // The design's record opens on `General` with the summary and the accounts table on the left (Figma node `1:4`; AAP 0.2.1 step 3; AAP 0.7.4 "Client view").
    expect(host.querySelector('app-client-summary')).not.toBeNull();
    expect(host.querySelector('app-client-accounts')).not.toBeNull();
    expect(host.querySelector('app-client-identifiers')).toBeNull();
    expect(tabStripOf(harness).activeId()).toBe('general');

    expect(clients.accounts).toHaveBeenCalledTimes(1);
    expect(clients.accounts).toHaveBeenCalledWith(CLIENT_ID);
    expect(clients.identifiers).not.toHaveBeenCalled();

    // The tab body is the panel of the tab on screen and names that tab's element through the id the strip mints, so the body is read as `General`'s panel (AAP 0.2.3 row `TabStrip`).
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(
      tabDomId('general'),
    );
  });

  it('swaps the body to the Identities section when that tab is chosen', async () => {
    const harness = await render(`/viewclient/${CLIENT_ID}`);
    const host = hostOf(harness);

    componentOf(harness).selectTab('identities');
    await settle(harness);

    // The other in-scope tab paints its own section and retires the two the General tab owns, while the record header, the strip and the action row stay in place (AAP 0.7.4).
    expect(host.querySelector('app-client-identifiers')).not.toBeNull();
    expect(host.querySelector('app-client-summary')).toBeNull();
    expect(host.querySelector('app-client-accounts')).toBeNull();
    expect(tabStripOf(harness).activeId()).toBe('identities');
    expect(host.querySelector('app-record-header')).not.toBeNull();

    // The panel follows the selection: the body is now labelled by the tab that is selected, not by the one it replaced (AAP 0.2.3 row `TabStrip`).
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(
      tabDomId('identities'),
    );

    expect(clients.identifiers).toHaveBeenCalledTimes(1);
    expect(clients.identifiers).toHaveBeenCalledWith(CLIENT_ID);
    expect(clients.get).toHaveBeenCalledTimes(1);
  });

  it('renders the not-found message in place of the record when Fineract answers 404', async () => {
    clients.get.mockReturnValue(throwError(() => failure(404, NOT_FOUND_MESSAGE)));

    const host = hostOf(await render(`/viewclient/${CLIENT_ID}`));

    // The record's own not-found branch: the heading and the sentence the shipped legacy bundles carry, in place of the record, so no control is offered against a client that was never read (AAP 0.7.4).
    expect(host.querySelectorAll('.alert.alert-danger')).toHaveLength(1);
    expect(renderedText(host)).toContain('Not Available');
    expect(renderedText(host)).toContain('The requested resource is not available.');

    expect(host.querySelector('app-record-header')).toBeNull();
    expect(host.querySelector('app-tab-strip')).toBeNull();
    expect(host.querySelector('app-action-button-group')).toBeNull();
    expect(host.querySelector('app-profile-card')).toBeNull();
    expect(host.querySelector('.panel')).toBeNull();

    // Fineract's own 404 text is not painted beside the not-found copy: `notFound` owns that state and `clientError` answers `null` for a 404, so the message appears once, in the wording the bundles carry (AAP 0.7.4).
    expect(renderedText(host)).not.toContain(NOT_FOUND_MESSAGE);

    expect(host.querySelector('.container-fluid')).not.toBeNull();
  });

  it('sends no request and claims the not-found state for a route with no client id', async () => {
    const host = hostOf(await render('/viewclient'));

    // No id, no request: nothing names a client to read (AAP 0.7.4).
    expect(clients.get).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.alert.alert-danger')).toHaveLength(1);
    expect(renderedText(host)).toContain('Not Available');
    expect(host.querySelector('app-record-header')).toBeNull();
    expect(host.querySelector('.panel')).toBeNull();
  });

  it('paints the not-found message in place of the record for an id that is not a client id', async () => {
    const harness = await render('/viewclient/abc');
    const host = hostOf(harness);

    // A route whose id is not a Fineract identifier names no client, so no read is issued for it: the refused value never reaches a path segment, and neither tab section asks for an id the record never received (AAP 0.7.4; Rule 1 clause 2).
    expect(clients.get).not.toHaveBeenCalled();
    expect(clients.accounts).not.toHaveBeenCalled();
    expect(clients.identifiers).not.toHaveBeenCalled();

    // The route still says what happened: the not-found copy the empty id and a 404 paint, in place of the record, while the shell around it stays usable and no record section is rendered (AAP 0.7.4; AAP 0.14.2).
    expect(host.querySelectorAll('.alert.alert-danger')).toHaveLength(1);
    expect(renderedText(host)).toContain('Not Available');
    expect(renderedText(host)).toContain('The requested resource is not available.');

    expect(host.querySelector('app-record-header')).toBeNull();
    expect(host.querySelector('app-tab-strip')).toBeNull();
    expect(host.querySelector('app-action-button-group')).toBeNull();
    expect(host.querySelector('app-profile-card')).toBeNull();
    expect(host.querySelector('.panel')).toBeNull();

    // No read was started, so nothing is outstanding and nothing was refused: the screen never claims to be loading and never raises a notification of its own (AAP 0.4.2).
    expect(componentOf(harness).loading()).toBe(false);
    expect(notifications.show).not.toHaveBeenCalled();

    expect(host.querySelector('.container-fluid')).not.toBeNull();
    expect(componentOf(harness)).toBeInstanceOf(ClientViewComponent);
    expect(componentOf(harness).notFound()).toBe(true);
  });

  it('shows a 4xx message verbatim and leaves the screen usable', async () => {
    const refusal = 'The client record is not visible to this user.';
    clients.get.mockReturnValue(throwError(() => failure(403, refusal)));

    const harness = await render(`/viewclient/${CLIENT_ID}`);
    const host = hostOf(harness);

    // Exactly one banner, carrying Fineract's own text character for character: the read's failure reaches the template through `clientError`, whose message is rendered verbatim with no prefix, suffix or translation (AAP 0.7.2, Rule 1 clause 3).
    const alerts = Array.from(host.querySelectorAll<HTMLElement>('.alert.alert-danger'));
    expect(alerts).toHaveLength(1);
    expect((alerts[0].textContent ?? '').trim()).toBe(refusal);

    expect(host.querySelector('app-record-header')).toBeNull();
    expect(renderedText(host)).not.toContain('Not Available');
    expect(host.querySelector('.container-fluid')).not.toBeNull();
    expect(componentOf(harness)).toBeInstanceOf(ClientViewComponent);
  });

  it('renders nothing of its own for a 5xx, because the interceptor has already notified', async () => {
    const serverFailure = 'There was an unexpected error in the server.';
    clients.get.mockReturnValue(throwError(() => failure(500, serverFailure)));

    const harness = await render(`/viewclient/${CLIENT_ID}`);
    const host = hostOf(harness);

    // The single interceptor raises the one notification a server or transport failure gets, so this screen neither notifies a second time, nor paints the message itself, nor claims an empty state in place of a record it never received (AAP 0.7.4, AAP 0.4.2, Rule 1 clause 9).
    expect(notifications.show).not.toHaveBeenCalled();
    expect(host.querySelector('.alert')).toBeNull();
    expect(host.querySelector('app-empty-state')).toBeNull();
    expect(renderedText(host)).not.toContain(serverFailure);
    expect(renderedText(host)).not.toContain('Not Available');

    expect(host.querySelector('app-record-header')).toBeNull();
    expect(host.querySelector('app-profile-card')).toBeNull();
    expect(host.querySelector('.container-fluid')).not.toBeNull();
    expect(componentOf(harness)).toBeInstanceOf(ClientViewComponent);
  });

  it('describes and links every action an active record offers, and renders no More menu', async () => {
    const harness = await render(`/viewclient/${CLIENT_ID}`);
    const host = hostOf(harness);

    // The descriptors the record computes: the legacy label keys, the permission each is gated on and the route each leads to, in the order the design's joined row paints them (AAP 0.7.4; AAP 0.2.3 row `ActionButtonGroup`).
    const descriptors = componentOf(harness).actionButtons();

    expect(descriptors.map((action) => action.label)).toEqual(ACTIVE_LABEL_KEYS);
    expect(descriptors.map((action) => action.permission)).toEqual(ACTIVE_PERMISSIONS);
    expect(descriptors.map((action) => action.routerLink)).toEqual(expectedActiveHrefs(CLIENT_ID));

    expect(actionHrefs(host)).toEqual(expectedActiveHrefs(CLIENT_ID));

    // And the route each anchor actually carries, read through its `RouterLink` directive: that is what the router would navigate to, whichever way the href is spelled.
    expect(renderedRoutes(harness)).toEqual(expectedActiveHrefs(CLIENT_ID));

    // An active client's own state answers no menu command, so the row is the whole group and no trigger opens an empty list (Rule 1 clause 3).
    expect(host.querySelector('.dropdown-toggle')).toBeNull();
    expect(host.querySelector('.dropdown-menu')).toBeNull();
  });

  it('offers a pending record the row legacy gives it plus the lifecycle commands in the More menu', async () => {
    clients.get.mockReturnValue(of(PENDING_CLIENT));

    const harness = await render(`/viewclient/${CLIENT_ID}`);
    const host = hostOf(harness);
    const descriptors = componentOf(harness).actionButtons();

    expect(descriptors.map((action) => action.label)).toEqual(PENDING_LABEL_KEYS);
    expect(descriptors.map((action) => action.permission)).toEqual(PENDING_PERMISSIONS);
    expect(descriptors.map((action) => action.routerLink)).toEqual(expectedPendingHrefs(CLIENT_ID));

    // The split is legacy's own: `Edit` and `Close` in the visible row, `Activate`, `Reject` and `Withdraw` in the menu, in that state's order (AAP 0.7.4).
    expect(rowHrefs(host)).toEqual([`/editclient/${CLIENT_ID}`, `/client/${CLIENT_ID}/close`]);
    expect(actionHrefs(host)).toEqual(expectedPendingHrefs(CLIENT_ID));
    expect(renderedRoutes(harness)).toEqual(expectedPendingHrefs(CLIENT_ID));

    // Neither a loan application nor a reactivation belongs to a pending client: legacy's `Pending` list holds neither (Rule 1 clause 3).
    expect(host.querySelector(`a[href="/newclientloanaccount/${CLIENT_ID}"]`)).toBeNull();
    expect(host.querySelector(`a[href="/client/${CLIENT_ID}/reactivate"]`)).toBeNull();
  });

  it('offers Reactivate on a closed record alone, in the menu and with no row entry', async () => {
    const active = await render(`/viewclient/${CLIENT_ID}`);

    // An active client's state answers reactivation no more than it answers the other lifecycle commands, so no descriptor and no anchor names one (AAP 0.7.4 "plus `Reactivate` for the states that allow it").
    expect(
      componentOf(active)
        .actionButtons()
        .filter((action) => commandOf(action.routerLink) === 'reactivate'),
    ).toHaveLength(0);
    expect(actionHrefs(hostOf(active))).toEqual(expectedActiveHrefs(CLIENT_ID));

    clients.get.mockReturnValue(of(CLOSED_CLIENT));

    const closed = await render(`/viewclient/${CLIENT_ID}`);
    const closedHost = hostOf(closed);
    const closedDescriptors = componentOf(closed).actionButtons();

    // `Reactivate` is the whole list, and it belongs to the menu, so a closed record's row carries nothing (Rule 1 clause 3).
    expect(closedDescriptors.map((action) => action.routerLink)).toEqual(expectedClosedHrefs(CLIENT_ID));
    expect(closedDescriptors.map((action) => action.permission)).toEqual(['REACTIVATE_CLIENT']);
    expect(closedDescriptors.every((action) => action.menu === true)).toBe(true);
    expect(rowHrefs(closedHost)).toHaveLength(0);
    expect(actionHrefs(closedHost)).toEqual(expectedClosedHrefs(CLIENT_ID));
  });

  it.each(NO_ACTION_STATES)(
    'offers no action to a %s record, because legacy answers that state with a command this build does not implement',
    async (_state: string, record: Client) => {
      clients.get.mockReturnValue(of(record));

      const harness = await render(`/viewclient/${CLIENT_ID}`);
      const host = hostOf(harness);

      // No descriptor, so no entry at all — not even a gated one — and no trigger opening an empty menu (Rule 1 clause 3). A rejected or withdrawn record is deliberately among them: Fineract answers those states with `undoReject` and `undoWithdrawn` alone, so the `Reactivate` a closed record offers would be refused there (AAP 0.7.4; AAP 0.2.3).
      expect(componentOf(harness).actionButtons()).toEqual([]);
      expect(actionLinks(host)).toHaveLength(0);
      expect(host.querySelector('.dropdown-toggle')).toBeNull();

      // The record itself still renders: the state removes the actions, never the screen (AAP 0.7.4).
      expect(host.querySelector('app-record-header')).not.toBeNull();
      expect(host.querySelector('app-tab-strip')).not.toBeNull();
    },
  );

  it('hides every action the permission list does not allow', async () => {
    heldCodes = [];
    clients.get.mockReturnValue(of(PENDING_CLIENT));

    const host = hostOf(await render(`/viewclient/${CLIENT_ID}`));
    const links = actionLinks(host);

    // The legacy gate hides rather than removes: every anchor a pending record's descriptors name is still in the document, carrying the inline `display: none` `HasPermissionDirective` writes before its first verdict (AAP 0.3.4 claim 12; Rule 1 clause 3).
    expect(links).toHaveLength(PENDING_LABEL_KEYS.length);
    expect(links.every((link) => link.style.display === 'none')).toBe(true);
  });

  it('hides the codes the user lacks and shows the one they hold', async () => {
    heldCodes = ['CREATE_LOAN'];

    const host = hostOf(await render(`/viewclient/${CLIENT_ID}`));

    // `New Loan` is visible on its own `CREATE_LOAN`; `Edit` needs `UPDATE_CLIENT` and `Close` needs `CLOSE_CLIENT`, neither of which this list holds (AAP 0.1.1; AAP 0.7.4).
    expect(linkFor(host, `/newclientloanaccount/${CLIENT_ID}`).style.display).toBe('');
    expect(linkFor(host, `/editclient/${CLIENT_ID}`).style.display).toBe('none');
    expect(linkFor(host, `/client/${CLIENT_ID}/close`).style.display).toBe('none');

    expect(host.querySelector(`a[href="/client/${CLIENT_ID}/activate"]`)).toBeNull();
  });

  it('shows both gated entry points once the codes that gate them are held', async () => {
    heldCodes = ['CREATE_LOAN', 'UPDATE_CLIENT', 'CLOSE_CLIENT'];

    const host = hostOf(await render(`/viewclient/${CLIENT_ID}`));

    expect(linkFor(host, `/editclient/${CLIENT_ID}`).style.display).toBe('');
    expect(linkFor(host, `/client/${CLIENT_ID}/close`).style.display).toBe('');
    // An active record offers no lifecycle command, held or not (AAP 0.7.4).
    expect(host.querySelector(`a[href="/client/${CLIENT_ID}/activate"]`)).toBeNull();
  });

  it('shows every action a record offers to a session holding only ALL_FUNCTIONS', async () => {
    heldCodes = [ALL_FUNCTIONS];

    const active = hostOf(await render(`/viewclient/${CLIENT_ID}`));

    // The wildcard answers every code, exactly as it does to `permissionGuard` (AAP 0.1.1).
    expect(actionLinks(active)).toHaveLength(ACTIVE_LABEL_KEYS.length);
    expect(actionLinks(active).every((link) => link.style.display !== 'none')).toBe(true);
    expect(active.querySelector('.dropdown-toggle')).toBeNull();

    clients.get.mockReturnValue(of(PENDING_CLIENT));

    const pending = hostOf(await render(`/viewclient/${CLIENT_ID}`));

    // The menu's three entries are included too, because each one carries its own gate (AAP 0.7.4).
    expect(actionLinks(pending)).toHaveLength(PENDING_LABEL_KEYS.length);
    expect(actionLinks(pending).every((link) => link.style.display !== 'none')).toBe(true);
    expect(pending.querySelector('.dropdown-toggle')).not.toBeNull();
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

    expect(hostOf(harness).querySelector('app-record-header h1 strong')?.textContent?.trim()).toBe(
      CLIENT.displayName,
    );

    await harness.navigateByUrl(`/viewclient/${SECOND_CLIENT_ID}`);
    await settle(harness);

    const moved = hostOf(harness);

    expect(componentOf(harness)).toBe(instance);

    expect(clients.get).toHaveBeenCalledTimes(2);
    expect(clients.get).toHaveBeenNthCalledWith(1, CLIENT_ID);
    expect(clients.get).toHaveBeenNthCalledWith(2, SECOND_CLIENT_ID);

    // The record header's name is an `h1`, so the second client's own values are on screen from it through the profile card.
    expect(moved.querySelector('app-record-header h1 strong')?.textContent?.trim()).toBe(
      SECOND_CLIENT.displayName,
    );
    expect(profileRows(moved)).toEqual([
      ['Client Number', SECOND_CLIENT.accountNo],
      ['External ID', ''],
      ['Office', SECOND_CLIENT.officeName],
      ['Staff', SECOND_CLIENT.staffName ?? ''],
      ['Activation Date', '24 November 2026'],
    ]);

    expect(actionHrefs(moved)).toEqual(expectedActiveHrefs(SECOND_CLIENT_ID));
    expect(clients.accounts).toHaveBeenLastCalledWith(SECOND_CLIENT_ID);
  });

  it('ignores a superseded client’s answer that arrives after the URL moved on', async () => {
    const first = new Subject<Client>();
    const second = new Subject<Client>();

    clients.get.mockImplementation((id: number | string) =>
      id === SECOND_CLIENT_ID ? second.asObservable() : first.asObservable(),
    );

    const harness = await render(`/viewclient/${CLIENT_ID}`);

    expect(hostOf(harness).querySelector('app-record-header')).toBeNull();

    await harness.navigateByUrl(`/viewclient/${SECOND_CLIENT_ID}`);

    second.next(SECOND_CLIENT);
    second.complete();
    await settle(harness);

    expect(hostOf(harness).querySelector('app-record-header h1 strong')?.textContent?.trim()).toBe(
      SECOND_CLIENT.displayName,
    );

    first.next(CLIENT);
    first.complete();
    await settle(harness);

    const after = hostOf(harness);

    expect(after.querySelector('app-record-header h1 strong')?.textContent?.trim()).toBe(
      SECOND_CLIENT.displayName,
    );
    expect(profileRows(after)[0]).toEqual(['Client Number', SECOND_CLIENT.accountNo]);
    expect(actionHrefs(after)).toEqual(expectedActiveHrefs(SECOND_CLIENT_ID));
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

    expect(renderedText(moved)).not.toContain('Not Available');
    expect(moved.querySelector('app-record-header h1 strong')?.textContent?.trim()).toBe(
      SECOND_CLIENT.displayName,
    );
  });

  it('cancels the outstanding read when the screen is destroyed', async () => {
    const pending = new Subject<Client>();

    clients.get.mockReturnValue(pending.asObservable());

    const harness = await render(`/viewclient/${CLIENT_ID}`);

    expect(pending.observed).toBe(true);

    harness.fixture.destroy();

    expect(pending.observed).toBe(false);
  });
});
