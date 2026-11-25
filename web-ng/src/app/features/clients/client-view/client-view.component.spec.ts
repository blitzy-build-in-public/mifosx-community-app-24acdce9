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
import { TabStripComponent } from './tab-strip/tab-strip.component';

/**
 * Behaviour of the client record screen — `#/viewclient/:id`, the last step of the "Sign in and open
 * a client record" flow and the entry point of workflow W3's record read (AAP 0.7.4 "Client view";
 * AAP 0.8.2 feature route `viewclient/:id`; Rule 1 clause 8, "tests prove behaviour").
 *
 * What the suite drives, in the order AAP 0.7.4 states the screen's contract, is: the one record read
 * and the record the header receives; the `General` tab the screen opens on and the body that
 * swapping to `Identities` paints; the four states the record can be in — 404 in place of the record,
 * any other 4xx in Fineract's own words, a 5xx that paints nothing because the interceptor has
 * already notified, and the loading state before the answer; the action links, the descriptors behind
 * them and the permission each is gated on; and the one state-dependent entry, `Reactivate`. It also
 * drives the record a second route emission names, because the router reuses this component when the
 * URL moves from one `#/viewclient/{id}` to another.
 *
 * `ClientService` is stubbed at its own token, so the endpoint-level contract — method, path and query
 * parameters of `GET /clients/{id}` — stays in `client.service.spec.ts` and no HTTP client,
 * interceptor or transport takes part here (Rule 1 clause 5). Rejections are built through the real
 * `toApiError(HttpErrorResponse)`, so the message a case asserts is the one the interceptor would
 * hand this screen rather than a shape a double invented.
 *
 * Two collaborators are the real ones, because each is the evidence: the router, because the screen's
 * links are rendered by `RouterLink` and the assertions read both the descriptors the component
 * computes and the routes those links carry; and `PermissionsService`, never a double, because the
 * suite hands it the codes a login would through `setPermissions()`, so `ALL_FUNCTIONS` and the
 * fail-closed answer are the service's own algebra (AAP 0.1.1; AAP 0.7.1 row `PermissionsService`;
 * Rule 1 clause 3). `HasPermissionDirective` is real for the same reason: it hides a gated entry by
 * writing `display: none` on the host it keeps in the document rather than removing it, which is why
 * the gate cases assert the inline style and never DOM absence (AAP 0.3.4 claim 12). Only
 * `TranslateService` is replaced, by a double that serves an in-memory bundle, so no locale file is
 * fetched and a key the bundle lacked would render as its own dotted string.
 *
 * Every assertion is made on the rendered DOM or on a public computed, never on a private signal,
 * because the DOM is the contract the user and the parity run observe (Rule 1 clause 8).
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

/**
 * The same client once its record has been closed: the one state on which the record offers
 * `Reactivate`, because that is the state legacy's own action list carries the command for
 * (`app/scripts/models/clientStatus.js`, "Closed" → `label.button.reactivate`; AAP 0.7.4
 * "plus `Reactivate` for the states that allow it").
 */
const CLOSED_CLIENT: Client = {
  ...CLIENT,
  status: { id: 600, code: 'clientStatusType.closed', value: 'Closed' },
};

/** The account summary the accounts tab reads: a client holding none of either family. */
const NO_ACCOUNTS: ClientAccountSummary = {};

/** The identifiers the identities tab reads: none. */
const NO_IDENTIFIERS: ClientIdentifier[] = [];

/** The document types the identifiers template offers: none is needed for an empty list. */
const NO_DOCUMENT_TYPES: ClientIdentifierTemplate = { allowedDocumentTypes: [] };

/**
 * The captions this screen resolves, keyed exactly as the shipped flat legacy bundles key them
 * (`app/global-translations/`). The double answers a key it does not carry with the key itself, so
 * serving the real wording is what proves each label resolves rather than falling back to its dotted
 * form, and the labels reach the screen from the bundles rather than from this application
 * (Rule 1 clause 6).
 */
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

/** `ClientService` as this screen and its two loading tabs use it, every method stubbed. */
interface ClientServiceStub {
  readonly get: Mock<(id: number | string) => Observable<Client>>;
  readonly accounts: Mock<(id: number | string) => Observable<ClientAccountSummary>>;
  readonly identifiers: Mock<(id: number | string) => Observable<ClientIdentifier[]>>;
  readonly identifiersTemplate: Mock<(id: number | string) => Observable<ClientIdentifierTemplate>>;
}

/**
 * `NotificationService` as this screen could use it: the one method a component that reported a
 * failure itself would call.
 *
 * The screen deliberately never calls it. A 5xx or a transport failure has already had exactly one
 * notification raised for it in `fineract.interceptor.ts`, and a second copy here would report the
 * same problem twice (AAP 0.7.4; AAP 0.4.2), so the stub exists to prove the call is never made.
 */
interface NotificationStub {
  readonly show: Mock<(kind: NotificationKind, message: string) => void>;
}

/**
 * The failure a read rejects with, built by the application's own mapper from the response Fineract
 * would answer, so every case drives the message and status the interceptor hands this screen rather
 * than an `ApiError` a double assembled by hand (AAP 0.7.2 row `FineractError`; AAP 0.14.1).
 */
function failure(status: number, defaultUserMessage: string): ApiError {
  return toApiError(new HttpErrorResponse({ status, error: { defaultUserMessage } }));
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
  let notifications: NotificationStub;
  let heldCodes: readonly string[];

  /**
   * Configures the TestBed for one case, with the stubbed reads, the notification double and the
   * permission codes the case holds, then opens the record at `url` through the real router.
   *
   * Every case starts here, so the route, the answer the service gives and the codes the gate answers
   * with are the only things it changes. The module is reset first because a case supplies its own
   * providers, and a module left instantiated by the previous case cannot take new ones.
   */
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

    // The real gate, holding exactly the codes this case names: `ALL_FUNCTIONS`, the `READ_` rule and
    // the fail-closed answer for a list with nothing in it are `PermissionsService`'s own algebra, so
    // the rendered visibility is the behaviour the application ships rather than a double's
    // impression of it (AAP 0.1.1 "a permission gate that fails closed"; Rule 1 clause 3).
    TestBed.inject(PermissionsService).setPermissions(heldCodes);

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

  /**
   * The action hrefs every record shows, for the client id it is showing: the four entries of the
   * joined row and the three lifecycle commands of its `More` menu, in render order.
   */
  function expectedHrefs(id: string): string[] {
    return [
      `/editclient/${id}`,
      `/newclientloanaccount/${id}`,
      `/new_client_saving_application/${id}`,
      `/client/${id}/close`,
      `/client/${id}/activate`,
      `/client/${id}/reject`,
      `/client/${id}/withdraw`,
    ];
  }

  /**
   * The hrefs a **closed** record adds to that set: `Reactivate`, last in the menu, because
   * reactivation is the one command whose availability follows the record's state (AAP 0.7.4).
   */
  function expectedClosedHrefs(id: string): string[] {
    return [...expectedHrefs(id), `/client/${id}/reactivate`];
  }

  /**
   * The legacy label keys the record's descriptors carry, in the order the action group renders them:
   * the four entries of the joined row, then the three lifecycle commands of the `More` menu
   * (`label.button.*` in `app/global-translations/`; AAP 0.7.4).
   */
  const ACTION_LABEL_KEYS: readonly string[] = [
    'label.button.edit',
    'label.button.newloan',
    'label.button.newsaving',
    'label.button.close',
    'label.button.activate',
    'label.button.reject',
    'label.button.withdraw',
  ];

  /**
   * The permission each of those descriptors is gated on — legacy's own code per action, read from
   * `app/scripts/models/clientStatus.js` — so the plan's gate cannot be widened or swapped silently
   * (AAP 0.1.1; AAP 0.7.4).
   */
  const ACTION_PERMISSIONS: readonly string[] = [
    'UPDATE_CLIENT',
    'CREATE_LOAN',
    'CREATE_SAVINGSACCOUNT',
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

  /** The label and value cells of the profile card's rows, in render order. */
  function profileRows(host: HTMLElement): readonly (readonly [string, string])[] {
    return Array.from(host.querySelectorAll<HTMLElement>('[data-testid="profile-field"]')).map(
      (row) => [
        (row.querySelector('[data-testid="profile-field-label"]')?.textContent ?? '').trim(),
        (row.querySelector('[data-testid="profile-field-value"]')?.textContent ?? '').trim(),
      ],
    );
  }

  /**
   * The label and value cells of the profile card's `Performance History` rows, in render order.
   * Every one of them carries an empty value, because `Client` models none of the summary figures
   * legacy prints there (AAP 0.7.4).
   */
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

  /**
   * The record header as the screen rendered it, so a case can read the input the screen handed it:
   * the header is presentational and paints whatever record it receives (AAP 0.7.4).
   */
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

  /**
   * The tab strip as the screen rendered it, so a case can read the tab the screen reports as
   * selected rather than inferring it from the body: the strip holds no tab list of its own and
   * paints exactly the active id it is handed (AAP 0.7.4).
   */
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

  /**
   * The route each rendered action anchor names, read through the `RouterLink` directive the anchor
   * carries rather than through its rendered `href`, so the assertion proves what the router would
   * navigate to and the template cannot drift from the descriptors the component computes
   * (AAP 0.8.2 feature routes; AAP 0.7.4).
   *
   * Angular 22's `RouterLink` keeps the bound commands behind its `urlTree` getter — `routerLink`
   * itself is a write-only input on that class — so the tree is read back as the path the router would
   * activate.
   */
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

    // Every code legacy's own record gates an action on, so the action cases prove the rendered
    // link set rather than the gate; the gate cases below narrow it to the codes they name.
    heldCodes = [
      'UPDATE_CLIENT',
      'CREATE_LOAN',
      'CREATE_SAVINGSACCOUNT',
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

    // One read for one navigation, addressed to the client the URL names (AAP 0.7.1 row `clients`;
    // AAP 0.7.3 row "W3 search and view client").
    expect(clients.get).toHaveBeenCalledTimes(1);
    expect(clients.get).toHaveBeenCalledWith(CLIENT_ID);

    // The header receives the record the read returned rather than a copy this screen assembled, so
    // the blocks below it cannot disagree about which client is on screen.
    expect(recordHeaderOf(harness).client()).toEqual(CLIENT);
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

    // The crumb is the record's own office — the design's "Head Office /" for this client — and not a
    // static route trail (AAP 0.7.4).
    expect(host.querySelector('ol.breadcrumb')?.textContent?.trim()).toBe(`${CLIENT.officeName} /`);

    // The profile card carries the client's own fields, the activation date the payload supplies, and
    // an empty value for the external id this record does not carry (AAP 0.7.4).
    expect(profileRows(host)).toEqual([
      ['Client Number', CLIENT.accountNo],
      ['External ID', ''],
      ['Office', CLIENT.officeName],
      ['Staff', CLIENT.staffName ?? ''],
      ['Activation Date', '21 November 2026'],
    ]);

    // The performance-history rows are painted with their labels and no invented figure.
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

    // The design's record opens on `General` with the summary and the accounts table on the left
    // (Figma node `1:4`; AAP 0.2.1 step 3; AAP 0.7.4 "Client view").
    expect(host.querySelector('app-client-summary')).not.toBeNull();
    expect(host.querySelector('app-client-accounts')).not.toBeNull();
    expect(host.querySelector('app-client-identifiers')).toBeNull();
    expect(tabStripOf(harness).activeId()).toBe('general');

    // Only the visible tab loads: its accounts read runs and the identifiers read does not.
    expect(clients.accounts).toHaveBeenCalledTimes(1);
    expect(clients.accounts).toHaveBeenCalledWith(CLIENT_ID);
    expect(clients.identifiers).not.toHaveBeenCalled();
  });

  it('swaps the body to the Identities section when that tab is chosen', async () => {
    const harness = await render(`/viewclient/${CLIENT_ID}`);
    const host = hostOf(harness);

    componentOf(harness).selectTab('identities');
    await settle(harness);

    // The other in-scope tab paints its own section and retires the two the General tab owns, while
    // the record header, the strip and the action row stay in place (AAP 0.7.4).
    expect(host.querySelector('app-client-identifiers')).not.toBeNull();
    expect(host.querySelector('app-client-summary')).toBeNull();
    expect(host.querySelector('app-client-accounts')).toBeNull();
    expect(tabStripOf(harness).activeId()).toBe('identities');
    expect(host.querySelector('app-record-header')).not.toBeNull();

    expect(clients.identifiers).toHaveBeenCalledTimes(1);
    expect(clients.identifiers).toHaveBeenCalledWith(CLIENT_ID);
    // Switching tabs re-reads nothing the record already holds.
    expect(clients.get).toHaveBeenCalledTimes(1);
  });

  it('renders the not-found message in place of the record when Fineract answers 404', async () => {
    clients.get.mockReturnValue(throwError(() => failure(404, NOT_FOUND_MESSAGE)));

    const host = hostOf(await render(`/viewclient/${CLIENT_ID}`));

    // The record's own not-found branch: the heading and the sentence the shipped legacy bundles
    // carry, in place of the record, so no control is offered against a client that was never read
    // (AAP 0.7.4). This screen's branch is the record's single Bootstrap alert and not the empty
    // state the list screens use — `ClientViewComponent` renders no `app-empty-state` at all, which
    // is what the template expresses and what this case pins.
    expect(host.querySelectorAll('.alert.alert-danger')).toHaveLength(1);
    expect(renderedText(host)).toContain('Not Available');
    expect(renderedText(host)).toContain('The requested resource is not available.');

    // Nothing of the record is painted: no header, no strip, no action row, no profile card, no card.
    expect(host.querySelector('app-record-header')).toBeNull();
    expect(host.querySelector('app-tab-strip')).toBeNull();
    expect(host.querySelector('app-action-button-group')).toBeNull();
    expect(host.querySelector('app-profile-card')).toBeNull();
    expect(host.querySelector('.panel')).toBeNull();

    // Fineract's own 404 text is not painted beside the not-found copy: `notFound` owns that state and
    // `clientError` answers `null` for a 404, so the message appears once, in the wording the bundles
    // carry (AAP 0.7.4).
    expect(renderedText(host)).not.toContain(NOT_FOUND_MESSAGE);

    // The shell the record sits in stays mounted, so navigation beside it keeps working.
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

  it('shows a 4xx message verbatim and leaves the screen usable', async () => {
    const refusal = 'The client record is not visible to this user.';
    clients.get.mockReturnValue(throwError(() => failure(403, refusal)));

    const harness = await render(`/viewclient/${CLIENT_ID}`);
    const host = hostOf(harness);

    // Exactly one banner, carrying Fineract's own text character for character: the read's failure
    // reaches the template through `clientError`, whose message is rendered verbatim with no prefix,
    // suffix or translation (AAP 0.7.2 "Rendered verbatim"; Rule 1 clause 3).
    const alerts = Array.from(host.querySelectorAll<HTMLElement>('.alert.alert-danger'));
    expect(alerts).toHaveLength(1);
    expect((alerts[0].textContent ?? '').trim()).toBe(refusal);

    // A refused read returns no record, so no record is painted; the 404 sentence stays out of a
    // failure that is not a missing record, and the screen itself did not throw.
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

    // The single interceptor raises the one notification a server or transport failure gets, so this
    // screen neither notifies a second time, nor paints the message itself, nor claims an empty state
    // in place of a record it never received (AAP 0.7.4; AAP 0.4.2; Rule 1 clause 9 — nothing is
    // logged either).
    expect(notifications.show).not.toHaveBeenCalled();
    expect(host.querySelector('.alert')).toBeNull();
    expect(host.querySelector('app-empty-state')).toBeNull();
    expect(renderedText(host)).not.toContain(serverFailure);
    expect(renderedText(host)).not.toContain('Not Available');

    // Nothing is claimed against a record that never arrived, and the screen stays mounted so the
    // shell around it keeps working.
    expect(host.querySelector('app-record-header')).toBeNull();
    expect(host.querySelector('app-profile-card')).toBeNull();
    expect(host.querySelector('.container-fluid')).not.toBeNull();
    expect(componentOf(harness)).toBeInstanceOf(ClientViewComponent);
  });

  it('describes and links every in-scope action on its own route', async () => {
    const harness = await render(`/viewclient/${CLIENT_ID}`);
    const host = hostOf(harness);

    // The descriptors the record computes: the legacy label keys, the permission each is gated on and
    // the route each leads to, in the order the design's joined row paints them (AAP 0.7.4;
    // AAP 0.2.3 row `ActionButtonGroup`).
    const descriptors = componentOf(harness).actionButtons();

    expect(descriptors.map((action) => action.label)).toEqual(ACTION_LABEL_KEYS);
    expect(descriptors.map((action) => action.permission)).toEqual(ACTION_PERMISSIONS);
    expect(descriptors.map((action) => action.routerLink)).toEqual(expectedHrefs(CLIENT_ID));

    // Every one of them rendered, so the template has not drifted from the descriptors it was handed.
    expect(actionHrefs(host)).toEqual(expectedHrefs(CLIENT_ID));

    // And the route each anchor actually carries, read through its `RouterLink` directive: that is
    // what the router would navigate to, whichever way the href is spelled.
    expect(renderedRoutes(harness)).toEqual(expectedHrefs(CLIENT_ID));
  });

  it('offers Reactivate on a closed record and on no other', async () => {
    const active = await render(`/viewclient/${CLIENT_ID}`);

    // An active client: reactivation would be refused, so no descriptor and no anchor names it
    // (AAP 0.7.4 "plus `Reactivate` for the states that allow it").
    const activeRoutes = componentOf(active)
      .actionButtons()
      .map((action) => action.routerLink);

    expect(activeRoutes.filter((route) => route.endsWith('/reactivate'))).toHaveLength(0);
    expect(actionHrefs(hostOf(active))).toEqual(expectedHrefs(CLIENT_ID));

    clients.get.mockReturnValue(of(CLOSED_CLIENT));

    const closed = await render(`/viewclient/${CLIENT_ID}`);
    const closedRoutes = componentOf(closed)
      .actionButtons()
      .map((action) => action.routerLink);

    // Exactly one `Reactivate`, last in the menu, with every other entry unchanged.
    expect(closedRoutes.filter((route) => route.endsWith('/reactivate'))).toEqual([
      `/client/${CLIENT_ID}/reactivate`,
    ]);
    expect(closedRoutes).toEqual(expectedClosedHrefs(CLIENT_ID));
    expect(actionHrefs(hostOf(closed))).toEqual(expectedClosedHrefs(CLIENT_ID));
  });

  it('hides every action the permission list does not allow', async () => {
    heldCodes = [];

    const host = hostOf(await render(`/viewclient/${CLIENT_ID}`));
    const links = actionLinks(host);

    // The legacy gate hides rather than removes: every anchor is still in the document, carrying the
    // inline `display: none` `HasPermissionDirective` writes before its first verdict
    // (AAP 0.3.4 claim 12; Rule 1 clause 3).
    expect(links).toHaveLength(7);
    expect(links.every((link) => link.style.display === 'none')).toBe(true);
  });

  it('hides the codes the user lacks and shows the one they hold', async () => {
    heldCodes = ['CREATE_LOAN'];

    const host = hostOf(await render(`/viewclient/${CLIENT_ID}`));

    // `New Loan` is visible on its own `CREATE_LOAN`; `Edit` needs `UPDATE_CLIENT` and `Close` needs
    // `CLOSE_CLIENT`, neither of which this list holds (AAP 0.1.1; AAP 0.7.4).
    expect(linkFor(host, `/newclientloanaccount/${CLIENT_ID}`).style.display).toBe('');
    expect(linkFor(host, `/editclient/${CLIENT_ID}`).style.display).toBe('none');
    expect(linkFor(host, `/client/${CLIENT_ID}/close`).style.display).toBe('none');
  });

  it('shows both gated entry points once the codes that gate them are held', async () => {
    heldCodes = ['CREATE_LOAN', 'UPDATE_CLIENT', 'CLOSE_CLIENT'];

    const host = hostOf(await render(`/viewclient/${CLIENT_ID}`));

    expect(linkFor(host, `/editclient/${CLIENT_ID}`).style.display).toBe('');
    expect(linkFor(host, `/client/${CLIENT_ID}/close`).style.display).toBe('');
    // The lifecycle command this list does not hold stays hidden where it stands.
    expect(linkFor(host, `/client/${CLIENT_ID}/activate`).style.display).toBe('none');
  });

  it('shows every action to a session holding only ALL_FUNCTIONS', async () => {
    heldCodes = [ALL_FUNCTIONS];

    const host = hostOf(await render(`/viewclient/${CLIENT_ID}`));

    // The wildcard answers every code, exactly as it does to `permissionGuard` (AAP 0.1.1), and the
    // `More` entries are included because each one carries its own gate.
    expect(actionLinks(host)).toHaveLength(7);
    expect(actionLinks(host).every((link) => link.style.display !== 'none')).toBe(true);
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
      ['Activation Date', '24 November 2026'],
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
