import {
  provideHttpClient,
  withInterceptors,
  type HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { catchError, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PermissionsService } from '../../../core/auth/permissions.service';
import type { SearchResult } from '../../../core/api/search.service';
import { DEFAULT_APP_CONFIG } from '../../../core/config/app-config.model';
import { AppConfigService } from '../../../core/config/app-config.service';
import { toApiError } from '../../../core/http/api-error';
import {
  NotificationService,
  type NotificationKind,
} from '../../../core/notifications/notification.service';
import type { Client } from '../client.models';
import { ClientListComponent } from './client-list.component';

/**
 * Behaviour of the clients list at `#/clients` — the post-authentication landing screen, step 2 of 3
 * of the design flow "Sign in and open a client record", and the entry point of workflow W2 (its
 * "Create Client" control) and workflow W3 (a row opened onto the record) (AAP 0.7.1 Features row
 * `clients`; AAP 0.7.4 "Clients list (`#/clients`)", Figma node `1:3`; AAP 0.11.1 "unit specs beside
 * every component and service"; Rule 1 clause 8).
 *
 * What it pins is the traffic the screen produces, the state it holds and the few properties only the
 * markup can express, because those are the parts a rewrite would silently change:
 *
 *  1. exactly one `GET /clients` on construction, carrying `offset=0` and `limit=15` and no
 *     `searchText` — the parameter set the legacy `getAllClients({offset, limit})` sends, and nothing
 *     the legacy list does not send (Rule 1 clauses 2 and 3; AAP 0.7.3 row "Client list and edit");
 *  2. the paged envelope's `pageItems` become the rows the screen holds, in the order the server sent
 *     them and with no reformatting (Rule 1 clause 3), while the rows the table renders are those
 *     survivors ordered by display name ascending, compared case-insensitively as AngularJS 1.7.9's
 *     default comparator compares two strings — both lower-cased, then `<`/`>` — which is what
 *     legacy's `| orderBy:'displayName':reverse` with `reverse` unset does
 *     (`app/views/clients/clients.html:63`);
 *  3. the two display filters — "Show Closed" and the filter field — narrow the rows already in hand
 *     and cost no request at all: "Show Closed" hides the `closed` status code alone, and the filter
 *     compares every cell the table prints text in — the name, the client number, the external id,
 *     the office and the staff member — case-insensitively;
 *  4. a 4xx renders Fineract's own message on `errorMessage` and empties the rows, which is the state
 *     the template shows in place of the table (AAP 0.7.4 states; workflow W7);
 *  5. a 5xx leaves `errorMessage` empty and only flags the failure, because the interceptor has
 *     already raised the single notification carrying it and reporting it twice is what the plan
 *     forbids (AAP 0.7.4);
 *  6. `loading()` is true while the read is outstanding and false once it settles either way;
 *  7. the find field's submit runs `GET /search` with `query`, `resource` and `exactMatch`, the flag
 *     derived from the field's surrounding double quotes exactly as legacy derives it
 *     (`ClientController.search()`, `app/scripts/controllers/client/ClientController.js:44-62`;
 *     Rule 1 clause 2; AAP 0.7.2 `GlobalSearchParams`), and the answer's rows replace the page's;
 *  8. the states the card must render: the explicit empty state with no error (AAP 0.7.4), no rows
 *     and no "no clients" claim after a failure, and a pager that paints for a match larger than one
 *     page — over the server's own pages and over a find's answer alike, because legacy pages a find
 *     client-side out of the rows it already holds
 *     (`app/scripts/controllers/client/ClientController.js:15-19,66-85`);
 *  9. what the table and the toolbar actually paint: the card title, the six column headers, one row
 *     per visible client, a status cell holding the swatch and no word (AAP 0.10.5 deliberate
 *     difference 11), the row itself as the link to `#/viewclient/:id` with no nested control, and
 *     the "Create Client" gate following `CREATE_CLIENT` — hidden, not removed, when it is absent.
 *
 * **Two levels of assertion, each for what the other cannot see.** The traffic the screen sends is
 * asserted on `HttpTestingController` and the state it holds on the component's own signals, because
 * those are what a rewrite would silently change and a signal assertion names a failure precisely.
 * The markup is asserted separately, and only where a property exists in the DOM alone: the status
 * cell that must carry no text, the row that is itself the link, the gate that hides its control
 * rather than removing it, the empty state, and the pager's links. Wording that only restates a
 * translated caption is not asserted, so re-keying the bundles cannot break this file.
 *
 * **Providers.** The configuration is loaded from a stubbed `fetch` before the component exists,
 * because every client URL is composed from it. The ngx-translate stack is registered for the
 * template's pipe. `PermissionsService` is a stub typed against the real class, because the
 * component imports the permission directive its toolbar gates "Create Client" with; no session is
 * ever assembled for a spec. `NotificationService` is stubbed for the same reason from the other
 * side: `core/http/fineract.interceptor.ts` owns the single notification a 5xx raises, so a stub at
 * the token is what proves the screen raises none of its own. `provideRouter([])` supplies the router
 * the row and "Create Client" links need in order to render; the empty route table is enough because
 * no case completes a navigation — the row's click is observed at the router it asks.
 *
 * The error mapping is the one production piece the TestBed supplies itself: `core/http` owns the
 * mapping of a Fineract failure to `ApiError`, and installing it as an interceptor means the
 * rejection the component narrows is the type it narrows in the application (AAP 0.4.2).
 */

/** The configuration the stubbed transport serves: the application's own documented default shape. */
const SERVED_CONFIG = DEFAULT_APP_CONFIG;

/** The API root every client URL is composed from, built from the resolved configuration. */
const API_ROOT = `${SERVED_CONFIG.apiBaseUrl}${SERVED_CONFIG.apiPath}`;

/** `GET /clients` — the one read this screen makes. */
const CLIENTS_URL = `${API_ROOT}/clients`;

/** `GET /search` — the read the find field submits when it carries text. */
const SEARCH_URL = `${API_ROOT}/search`;

/** The first page's offset and page size, which are the legacy list's own `offset: 0, limit: 15`. */
const FIRST_PAGE_OFFSET = '0';
const PAGE_LIMIT = '15';

/** The second page's offset: fifteen rows skipped, which is legacy's `(page - 1) * clientsPerPage`. */
const SECOND_PAGE_OFFSET = '15';

/** The office the Head Office fixtures are filed under. */
const OFFICE_NAME = 'Head Office';

/** The staff member a case searches the list by; the seeded officer's own label form. */
const STAFF_NAME = 'Officer, Parity';

/** A second office, so the office half of the display filter has a row of its own to find. */
const BRANCH_NAME = 'Kigali Branch';

/** Names the fixtures are filtered by, chosen so case-insensitive matching is observable. */
const ADA = 'Ada Okafor';
const MARCUS = 'Marcus Rowe-Bennett';
const JOSE = 'José Luis Núñez';
const NADIA = 'Nadia Weber';
const OMAR = 'Omar Haddad';

/**
 * Two names that first differ where one is upper-case and the other is not, so a case-sensitive
 * comparison and legacy's lower-cased one disagree about which of them leads: on UTF-16 code units
 * `'QA20 …'` sorts before `'Qa008 …'` (`'A'` is 0x41, `'a'` is 0x61), while lower-cased
 * `'qa008 …'` sorts before `'qa20 …'`. Both spellings are invented for this suite.
 */
const QA20_ROW = 'QA20 ProbeEdited';
const QA008_ROW = 'Qa008 Client';

/**
 * The message a refused list read answers with. A 4xx is the one status this screen renders itself.
 */
const REFUSED_MESSAGE = 'The client list could not be read for this office.';

/**
 * The status label every fixture carries in its payload. The design paints a colour swatch with no
 * word beside it (AAP 0.10.5 deliberate difference 11), so a value a test would notice if it leaked
 * into the markup is exactly what the fixture stores.
 */
const SERVER_STATUS_LABEL = 'the server label, never rendered';

/**
 * A client row as `GET /clients` returns it: the five members the model requires, with the name and
 * the status code a case is about. The first three names are the project's own fixed seed fixtures
 * (AAP 0.10.1); the rejected and withdrawn rows and the two case-ordering rows carry names invented
 * for this suite, because the seed creates no client in either terminal state and no pair of its
 * names differs only in case. Every row here is a stub payload value: nothing in this file stores,
 * sends or prints tenant state.
 *
 * @param id the client id, also rendered as the zero-padded account number.
 * @param displayName the name the list prints and the filter compares.
 * @param statusCode the Fineract status code, e.g. `'clientStatusType.closed'`.
 * @param officeName the office the client is filed under; the seeded office unless a case needs a
 *   second one, which is what makes the office half of the display filter observable.
 * @param staffName the loan officer's name, absent unless a case is about the staff half of it.
 */
function clientRow(
  id: number,
  displayName: string,
  statusCode: string,
  officeName: string = OFFICE_NAME,
  staffName?: string,
): Client {
  return {
    id,
    accountNo: `${id}`.padStart(9, '0'),
    displayName,
    officeId: 1,
    officeName,
    staffName,
    status: { id: 1, code: statusCode, value: SERVER_STATUS_LABEL },
    timeline: {},
  };
}

/** An open client: the state "Show Closed" leaves on screen and the filter can narrow. */
const ACTIVE_CLIENT = clientRow(2, ADA, 'clientStatusType.active');

/** A terminal client, which the list hides until "Show Closed" is ticked. */
const CLOSED_CLIENT = clientRow(3, MARCUS, 'clientStatusType.closed');

/** A client still awaiting activation: neither hidden nor filtered until a case says so. */
const PENDING_CLIENT = clientRow(4, JOSE, 'clientStatusType.pending');

/** A rejected client: terminal in the swatch's vocabulary, but not the code the list hides. */
const REJECTED_CLIENT = clientRow(6, NADIA, 'clientStatusType.rejected');

/** A withdrawn client: the other terminal state "Show Closed" leaves on screen. */
const WITHDRAWN_CLIENT = clientRow(7, OMAR, 'clientStatusType.withdraw', BRANCH_NAME, STAFF_NAME);

/** The name a raw code-unit comparison would put first: it renders second (see the case below). */
const QA20_CLIENT = clientRow(8, QA20_ROW, 'clientStatusType.active');

/** The name legacy's lower-cased comparison puts first, although the server lists it second. */
const QA008_CLIENT = clientRow(9, QA008_ROW, 'clientStatusType.active');

/** The page the endpoint answers the first read with, in the server's own order. */
const FIRST_PAGE = {
  totalFilteredRecords: 3,
  pageItems: [ACTIVE_CLIENT, CLOSED_CLIENT, PENDING_CLIENT],
} as const;

/**
 * A page carrying one client of each terminal state beside an active and a pending one, listed in the
 * ascending display-name order legacy renders. Only which rows the "Show Closed" checkbox hides is
 * asserted from it: the rendered order has its own case.
 */
const MIXED_STATUS_PAGE = {
  totalFilteredRecords: 5,
  pageItems: [ACTIVE_CLIENT, CLOSED_CLIENT, PENDING_CLIENT, REJECTED_CLIENT, WITHDRAWN_CLIENT],
} as const;

/**
 * A match larger than one page, as `GET /clients` answers it: 31 rows at fifteen per page is three
 * pages, which is the smallest shape in which the pager has something to do. Only the counts and the
 * single row per page matter here; the rows themselves are the fixtures above.
 */
const LARGE_MATCH_FIRST_PAGE = {
  totalFilteredRecords: 31,
  pageItems: [ACTIVE_CLIENT],
} as const;

/** The same match on its second page: the same server-side total, a different row. */
const LARGE_MATCH_SECOND_PAGE = {
  totalFilteredRecords: 31,
  pageItems: [PENDING_CLIENT],
} as const;

/**
 * A find's answer carrying `count` clients, named by ordinal so a case can name the row each page of
 * the client-side pager holds: legacy keeps the whole answer in `actualClients`, counts it into
 * `totalClients` and slices the page in view out of those rows without asking the server again
 * (`app/scripts/controllers/client/ClientController.js:15-19,66-85`).
 *
 * @param count how many clients the find answers with.
 */
function findAnswer(count: number): SearchResult[] {
  return Array.from({ length: count }, (_, index): SearchResult => {
    const ordinal: string = `${index + 1}`.padStart(2, '0');

    return {
      entityId: index + 1,
      entityName: `Find ${ordinal}`,
      entityAccountNo: `${index + 1}`.padStart(9, '0'),
      entityType: 'CLIENT',
      parentName: OFFICE_NAME,
      entityStatus: { id: 300, code: 'clientStatusType.active', value: SERVER_STATUS_LABEL },
    };
  });
}

/**
 * Installs the production mapping of a Fineract failure onto the test transport, so a rejection
 * arrives as the `ApiError` the component narrows in the application (AAP 0.4.2; workflow W7).
 */
const MAP_FINERACT_FAILURES: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((failure: HttpErrorResponse) => throwError(() => toApiError(failure))),
  );

/** Matches the list read, whatever query the screen sent with it. */
function isClientListRead(request: { readonly url: string }): boolean {
  return request.url === CLIENTS_URL;
}

/** Matches the find's search read, whatever query the screen sent with it. */
function isFindRead(request: { readonly url: string }): boolean {
  return request.url === SEARCH_URL;
}

/** The legacy code the toolbar's "Create Client" control is gated on in the template. */
const CREATE_CLIENT_CODE = 'CREATE_CLIENT';

/**
 * The permission codes the stubbed gate answers `true` for. It is reset before every case and set by
 * the one case that needs the gate open, so the rest of the suite renders the toolbar as a user
 * without the permission sees it.
 */
let grantedCodes: readonly string[] = [];

/**
 * The half of `PermissionsService` the toolbar's permission gate reads. Typed against the real class
 * with `Pick`, so the stub cannot drift from the two questions the directive asks, and it needs no
 * session: the screen's traffic does not depend on a permission.
 *
 * The answers are read from {@link grantedCodes} when the directive's effect runs rather than being
 * fixed at construction, which is what lets one case render the gate shut and another render it open
 * with the same provider registration.
 */
class PermissionsStub implements Pick<PermissionsService, 'can' | 'has'> {
  /** Membership only; no case here asks a negated code through this member. */
  can(key: string): boolean {
    return grantedCodes.includes(key);
  }

  /** The directive-facing question, answered the same way. */
  has(key: string): boolean {
    return grantedCodes.includes(key);
  }
}

/**
 * Stand-in for the application's notification surface. `core/http/fineract.interceptor.ts` is the one
 * place that raises a failure notification (AAP 0.7.4), so this stub exists to prove the screen never
 * raises a second one of its own — a regression guard rather than a collaborator the screen uses.
 *
 * `satisfies` rather than a `Pick` annotation, so the shape is still checked against the real class
 * while `mockClear` and the call history stay visible to the cases that read them.
 */
const notificationStub = {
  show: vi.fn<(kind: NotificationKind, message: string) => void>(),
  clear: vi.fn<() => void>(),
} satisfies Pick<NotificationService, 'show' | 'clear'>;

describe('ClientListComponent', () => {
  let fixture: ComponentFixture<ClientListComponent>;
  let component: ClientListComponent;
  let httpMock: HttpTestingController;
  let initialRead: TestRequest;

  /**
   * Mounts the screen. Its constructor issues the one list read before the first render, so the
   * read is matched here and each case answers it with the payload that case is about.
   */
  function mount(): void {
    fixture = TestBed.createComponent(ClientListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const pending = httpMock.match(isClientListRead);
    expect(pending).toHaveLength(1);
    initialRead = pending[0];
  }

  /**
   * The fixture's host element. `ComponentFixture.nativeElement` and `DebugElement.nativeElement`
   * are typed loosely by the framework, so every cast to `HTMLElement` in this suite is the same DOM
   * boundary, written `as HTMLElement` where it is used and explained here once (Rule 1 clause 4).
   */
  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * One typed lookup at the DOM boundary: the caller names the element type `querySelector` cannot
   * infer, which is the documented boundary cast a DOM query needs and the only other one here.
   */
  function element<T extends Element>(selector: string): T | null {
    return host().querySelector<T>(selector);
  }

  /**
   * The pager's page links as rendered. The pager paints only for a match larger than one page, so
   * nothing but the pager cases observes it.
   */
  function pageLinks(): readonly HTMLAnchorElement[] {
    return Array.from(host().querySelectorAll<HTMLAnchorElement>('.pagination li a'));
  }

  beforeEach(async () => {
    grantedCodes = [];
    notificationStub.show.mockClear();
    notificationStub.clear.mockClear();

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => {
        // `Response` stand-in: the three members `AppConfigService.fetchRawConfig` reads. The cast is
        // the single boundary where the partial object becomes the response the service expects.
        const body = {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve(SERVED_CONFIG),
        };

        return Promise.resolve(body as unknown as Response);
      }),
    );

    TestBed.configureTestingModule({
      imports: [ClientListComponent],
      providers: [
        provideHttpClient(withInterceptors([MAP_FINERACT_FAILURES])),
        provideHttpClientTesting(),
        provideTranslateService(),
        { provide: PermissionsService, useValue: new PermissionsStub() },
        // The screen must never notify: the interceptor owns the single failure notification, so a
        // stub at the token is what makes "the screen raised none" an assertion rather than a guess.
        { provide: NotificationService, useValue: notificationStub },
        // The screen links rows and the "Create Client" control through `RouterLink`, so the router
        // has to exist for the template to render at all; an empty route table is enough because no
        // case navigates (the same provider the search-results spec uses).
        provideRouter([]),
      ],
    });

    await TestBed.inject(AppConfigService).load();

    const translate = TestBed.inject(TranslateService);
    // No key is served here: the only rendered strings this suite asserts are the card title, which
    // the template hardcodes, and the fixture data itself, so the stack is registered only because
    // the component imports the translate pipe.
    translate.setTranslation('en', {}, true);
    translate.use('en');

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  it('reads one page on construction, with offset, limit and no search parameter', () => {
    mount();

    expect(initialRead.request.method).toBe('GET');
    // Exactly the two parameters the legacy list sends: no `searchText`, no `orderBy`, no `sortOrder`,
    // because the in-scope screen offers no sort and its find goes through its own path (Rule 1
    // clauses 2 and 3).
    expect(initialRead.request.params.keys()).toEqual(['offset', 'limit']);
    expect(initialRead.request.params.get('offset')).toBe(FIRST_PAGE_OFFSET);
    expect(initialRead.request.params.get('limit')).toBe(PAGE_LIMIT);
    expect(initialRead.request.params.has('searchText')).toBe(false);
    expect(initialRead.request.body).toBeNull();

    // A second read on the first render would mean the load ran twice for one page.
    httpMock.expectNone(isClientListRead);
  });

  it('reports the read as outstanding until the page lands, then holds the page as the server sent it', () => {
    mount();

    expect(component.loading()).toBe(true);
    expect(component.rows()).toEqual([]);

    // The endpoint answers with the paged envelope, not a bare array: its `pageItems` become the rows
    // the screen holds, in the order the server listed them. The order the table renders is legacy's
    // own and is asserted by the case below.
    initialRead.flush(FIRST_PAGE);

    expect(component.loading()).toBe(false);
    expect(component.failed()).toBe(false);
    expect(component.errorMessage()).toBeNull();
    expect(component.rows().map((row) => row.clientId)).toEqual([2, 3, 4]);
    expect(component.rows().map((row) => row.name)).toEqual([ADA, MARCUS, JOSE]);
  });

  it('renders the card title, the six-column header and one row per visible client', () => {
    mount();
    initialRead.flush(FIRST_PAGE);
    fixture.detectChanges();

    const title = fixture.debugElement.query(By.css('.panel-title'));
    expect(title.nativeElement.textContent?.trim()).toBe('List of Clients');

    // The six columns in the legacy table's order (`app/views/clients/clients.html:53-60`), each
    // headed by a column header rather than by a plain cell.
    const headers = fixture.debugElement.queryAll(By.css('thead th'));
    expect(headers).toHaveLength(6);
    expect(headers.map((header) => header.attributes['scope'])).toEqual([
      'col',
      'col',
      'col',
      'col',
      'col',
      'col',
    ]);

    // One row per client the two display filters leave on screen, in legacy's ascending name order:
    // the closed client is hidden until the checkbox is ticked, so two of the three render.
    const rows = fixture.debugElement.queryAll(By.css('tbody tr'));
    expect(rows).toHaveLength(2);
    expect((rows[0].nativeElement as HTMLElement).textContent).toContain(ADA);
    expect((rows[1].nativeElement as HTMLElement).textContent).toContain(JOSE);
  });

  it('paints the status cell as a swatch and never as a word', () => {
    mount();
    initialRead.flush(FIRST_PAGE);
    fixture.detectChanges();

    const statusCells = fixture.debugElement.queryAll(By.css('tbody tr td:nth-child(4)'));
    expect(statusCells).toHaveLength(2);

    for (const cell of statusCells) {
      // The swatch is the cell's whole content: a colour, no word, no `title`, no label.
      expect(cell.queryAll(By.css('app-status-swatch'))).toHaveLength(1);
      expect((cell.nativeElement as HTMLElement).textContent?.trim()).toBe('');
    }

    // The payload's own status label reaches no cell of the rendered table: the design paints a
    // colour and no textual status anywhere (AAP 0.10.5 deliberate difference 11).
    const table = element<HTMLTableElement>('#client-list');
    expect(table).not.toBeNull();
    expect(table?.textContent ?? '').not.toContain(SERVER_STATUS_LABEL);
  });

  it('renders the explicit empty state and no error when the read matched nothing', () => {
    mount();
    initialRead.flush({ totalFilteredRecords: 0, pageItems: [] });
    fixture.detectChanges();

    // A completed read that matched nothing is an empty result, not a failure: the card shows the
    // empty state, no error banner and no row (AAP 0.7.4 "States every list and record screen must
    // implement").
    expect(component.isEmpty()).toBe(true);
    expect(fixture.debugElement.queryAll(By.css('app-empty-state'))).toHaveLength(1);
    expect(fixture.debugElement.queryAll(By.css('.alert.alert-danger'))).toHaveLength(0);
    expect(fixture.debugElement.queryAll(By.css('tbody tr'))).toHaveLength(0);
  });

  it('opens the record from the whole row and offers no other affordance inside it', () => {
    mount();
    initialRead.flush(FIRST_PAGE);
    fixture.detectChanges();

    const rows = fixture.debugElement.queryAll(By.css('tbody tr'));
    expect(rows.length).toBeGreaterThan(0);

    // The row itself is the link, exactly as legacy's per-cell `routeTo(client.id)` was, and the
    // design paints no link styling, chevron or button of its own (Figma screen `1:3`; AAP 0.7.4).
    // `RouterLink` exposes its destination through a write-only setter, so the destination is
    // observed the way a user produces it: the row's own click, on the router the link asks.
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    (rows[0].nativeElement as HTMLElement).click();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0][0])).toBe(`/viewclient/${ACTIVE_CLIENT.id}`);
    expect(rows[0].queryAll(By.css('button'))).toHaveLength(0);
    expect(rows[0].queryAll(By.css('a'))).toHaveLength(0);
  });

  it('keeps Create Client hidden while the user lacks CREATE_CLIENT', async () => {
    mount();
    initialRead.flush(FIRST_PAGE);
    fixture.detectChanges();
    await fixture.whenStable();

    const control = element<HTMLElement>('a.pull-right');
    expect(control).not.toBeNull();
    // The gate hides the control rather than removing it, so its place in the toolbar is kept and a
    // user without the permission is not offered the route (AAP 0.1.1 "a permission gate that fails
    // closed").
    expect(control?.style.display).toBe('none');
  });

  it('shows Create Client once the user holds CREATE_CLIENT', async () => {
    grantedCodes = [CREATE_CLIENT_CODE];

    mount();
    initialRead.flush(FIRST_PAGE);
    fixture.detectChanges();
    await fixture.whenStable();

    const control = element<HTMLElement>('a.pull-right');
    expect(control).not.toBeNull();
    expect(control?.style.display).toBe('');

    // The revealed control opens the create form, which is workflow W2's entry point.
    const anchor = element<HTMLAnchorElement>('a.pull-right');
    expect(anchor?.getAttribute('href')).toBe('/createclient');
  });

  it('renders the rows in legacy order — display name ascending — whatever order the server sent', () => {
    mount();

    // The same three clients on a page the server ordered by id descending: held as they arrived, and
    // not the order the legacy pipeline paints.
    initialRead.flush({
      totalFilteredRecords: 3,
      pageItems: [PENDING_CLIENT, CLOSED_CLIENT, ACTIVE_CLIENT],
    });

    expect(component.rows().map((row) => row.name)).toEqual([JOSE, MARCUS, ADA]);

    component.toolbar.controls.showClosed.setValue(true);

    // `| orderBy:'displayName':reverse` with `reverse` unset sorts by display name ascending before
    // the row paints, so the table shows the page in that order and not the server's
    // (`app/views/clients/clients.html:63`; Rule 1 clause 3).
    expect(component.visibleRows().map((row) => row.name)).toEqual([ADA, JOSE, MARCUS]);

    // The order is a rendering rule: it costs no request.
    expect(httpMock.match(isClientListRead)).toHaveLength(0);
  });

  it('orders the rows case-insensitively, the way legacy’s comparator does, not by code unit', () => {
    mount();

    // A page the server listed so the two candidate comparisons disagree: a raw code-unit comparison
    // puts 'QA20 ProbeEdited' first, while legacy's orderBy lower-cases both names before it compares
    // them, which puts 'Qa008 Client' first. The third row already holds its place under either rule.
    initialRead.flush({
      totalFilteredRecords: 3,
      pageItems: [QA20_CLIENT, QA008_CLIENT, ACTIVE_CLIENT],
    });

    // Held as they arrived, in the order the server sent them (Rule 1 clause 3).
    expect(component.rows().map((row) => row.name)).toEqual([QA20_ROW, QA008_ROW, ADA]);

    // Rendered in legacy's order: both names lower-cased, then compared with `<`/`>` and never by
    // locale collation, so the mixed-case name leads its upper-case sibling exactly as
    // `| orderBy:'displayName':reverse` with `reverse` unset paints it
    // (`app/views/clients/clients.html:63`; AngularJS 1.7.9 `orderBy`'s default comparator; Rule 1
    // clause 3).
    expect(component.visibleRows().map((row) => row.name)).toEqual([ADA, QA008_ROW, QA20_ROW]);

    // An ordering rule like the two display filters: it costs no request.
    expect(httpMock.match(isClientListRead)).toHaveLength(0);
  });

  it('narrows the loaded rows client-side: closed rows hidden unless shown, and the filter is case-insensitive', () => {
    mount();

    initialRead.flush(FIRST_PAGE);

    // The closed client is hidden by default: the checkbox hides the one `closed` status code the
    // legacy template hides, which is what reveals it again.
    expect(component.visibleRows().map((row) => row.name)).toEqual([ADA, JOSE]);
    expect(component.visibleRows().map((row) => row.statusKey)).toEqual(['active', 'pending']);

    component.toolbar.controls.showClosed.setValue(true);

    // All three, in the ascending display-name order the table renders (Rule 1 clause 3).
    expect(component.visibleRows().map((row) => row.name)).toEqual([ADA, JOSE, MARCUS]);
    expect(component.visibleRows().map((row) => row.statusKey)).toContain('closed');

    // The filter compares the name column first — the client's `displayName` on a page row — and does
    // so case-insensitively.
    component.toolbar.controls.filter.setValue('ada');

    expect(component.visibleRows().map((row) => row.name)).toEqual([ADA]);

    component.toolbar.controls.filter.setValue('ROWE');

    expect(component.visibleRows().map((row) => row.name)).toEqual([MARCUS]);

    component.toolbar.controls.filter.setValue('nobody');

    expect(component.visibleRows()).toEqual([]);

    // Both filters are display filters: neither of them is a query parameter, so no request was
    // issued for any of the four changes above (Rule 1 clause 3).
    expect(httpMock.match(isClientListRead)).toHaveLength(0);
  });

  it('finds a row by its client number, its office or its staff, as the filter field promises', () => {
    mount();

    initialRead.flush(MIXED_STATUS_PAGE);

    // The field's own label is "Filter display by name/client number/staff/office"
    // (`label.input.filterbynameaccno`, app/global-translations/locale-en.json:726), and legacy
    // narrowed the whole row (`| filter:filterText`, app/views/clients/clients.html:63), so every one
    // of those columns is searched rather than the name alone.
    component.toolbar.controls.filter.setValue('000000007');
    expect(component.visibleRows().map((row) => row.name)).toEqual([OMAR]);

    component.toolbar.controls.filter.setValue(`  ${BRANCH_NAME.toLowerCase()}  `);
    expect(component.visibleRows().map((row) => row.name)).toEqual([OMAR]);

    component.toolbar.controls.filter.setValue(STAFF_NAME.toUpperCase());
    expect(component.visibleRows().map((row) => row.name)).toEqual([OMAR]);

    // The office column narrows to that office's rows — the three Head Office clients whose status
    // the unticked checkbox leaves on screen.
    component.toolbar.controls.filter.setValue(OFFICE_NAME);
    expect(component.visibleRows().map((row) => row.name)).toEqual([ADA, JOSE, NADIA]);

    // A needle no printed cell carries matches nothing, rather than falling back to the name column.
    component.toolbar.controls.filter.setValue('nobody');
    expect(component.visibleRows()).toEqual([]);

    expect(httpMock.match(isClientListRead)).toHaveLength(0);
  });

  it('hides only the closed status code, leaving rejected and withdrawn clients on screen', () => {
    mount();

    initialRead.flush(MIXED_STATUS_PAGE);

    // The checkbox tests one code, as the legacy template does
    // (`client.status.code != 'clientStatusType.closed' || showClosed`), so a rejected or withdrawn
    // client stays visible while it is unticked even though the swatch paints all three terminal
    // states with the same colour (`app/views/clients/clients.html:65`; Rule 1 clause 3).
    expect(component.visibleRows().map((row) => row.name)).toEqual([ADA, JOSE, NADIA, OMAR]);
    expect(component.visibleRows().map((row) => row.statusKey)).toEqual([
      'active',
      'pending',
      'closed',
      'closed',
    ]);

    component.toolbar.controls.showClosed.setValue(true);

    // Every terminal code now shows, still in the ascending display-name order the table renders.
    expect(component.visibleRows().map((row) => row.name)).toEqual([
      ADA,
      JOSE,
      MARCUS,
      NADIA,
      OMAR,
    ]);

    // The toggle is a display filter like the other one: it costs no request.
    expect(httpMock.match(isClientListRead)).toHaveLength(0);
  });

  it('applies the same Show-Closed filter to the clients the find returns', () => {
    mount();

    initialRead.flush(FIRST_PAGE);

    component.toolbar.controls.find.setValue('a');
    component.onFind();

    const findReads = httpMock.match(isFindRead);
    expect(findReads).toHaveLength(1);
    findReads[0].flush([
      {
        entityId: 2,
        entityName: ADA,
        entityAccountNo: '000000002',
        entityType: 'CLIENT',
        parentName: OFFICE_NAME,
        entityStatus: { id: 300, code: 'clientStatusType.closed', value: 'Closed' },
      },
      {
        entityId: 6,
        entityName: NADIA,
        entityAccountNo: '000000006',
        entityType: 'CLIENT',
        parentName: OFFICE_NAME,
        entityStatus: { id: 600, code: 'clientStatusType.rejected', value: 'Rejected' },
      },
    ]);

    // A search row carries its status in `entityStatus`, and the checkbox reads the same code from
    // it: the closed result is hidden, the rejected one is not (Rule 1 clause 3).
    expect(component.rows().map((row) => row.name)).toEqual([ADA, NADIA]);
    expect(component.visibleRows().map((row) => row.name)).toEqual([NADIA]);
  });

  it('strips the surrounding quotes from a quoted find and asks the search for an exact match', () => {
    mount();

    initialRead.flush(FIRST_PAGE);

    // Legacy removes a quote at either end and flags an exact match when that removal changed the
    // text, so a quoted name searches for the name itself rather than for the quote characters
    // (`ClientController.search()`, ClientController.js:44-62).
    component.toolbar.controls.find.setValue(`"${ADA}"`);
    component.onFind();

    const findReads = httpMock.match(isFindRead);
    expect(findReads).toHaveLength(1);
    expect(findReads[0].request.method).toBe('GET');
    // The three parameters legacy's find sends, and no others: the list read is not repeated.
    expect(findReads[0].request.params.keys()).toEqual(['query', 'resource', 'exactMatch']);
    expect(findReads[0].request.params.get('query')).toBe(ADA);
    expect(findReads[0].request.params.get('resource')).toBe('clients,clientIdentifiers');
    expect(findReads[0].request.params.get('exactMatch')).toBe('true');
    expect(httpMock.match(isClientListRead)).toHaveLength(0);

    findReads[0].flush([]);

    expect(component.rows()).toEqual([]);
    expect(component.loading()).toBe(false);
  });

  it('sends an unquoted find verbatim with exactMatch=false, and renders the answer it returns', () => {
    mount();

    initialRead.flush(FIRST_PAGE);

    // The field's own leading and trailing space is trimmed before the find runs, as the empty-submit
    // check requires; nothing else about the text changes, so no quote was stripped and the flag is
    // false — sent rather than omitted, because legacy distinguishes "false" from "absent"
    // (Rule 1 clause 2; AAP 0.7.2 `GlobalSearchParams`).
    component.toolbar.controls.find.setValue(`  ${JOSE}  `);
    component.onFind();

    const findReads = httpMock.match(isFindRead);
    expect(findReads).toHaveLength(1);
    expect(findReads[0].request.params.get('query')).toBe(JOSE);
    expect(findReads[0].request.params.get('exactMatch')).toBe('false');

    findReads[0].flush([
      {
        entityId: 4,
        entityName: JOSE,
        entityAccountNo: '000000004',
        entityType: 'CLIENT',
        parentName: OFFICE_NAME,
        entityStatus: { id: 100, code: 'clientStatusType.pending', value: 'Pending' },
      },
    ]);

    // The find's rows are the rows the table holds: the page read is replaced by the search answer.
    expect(component.rows().map((row) => row.name)).toEqual([JOSE]);
    expect(component.rows().map((row) => row.key)).toEqual(['client:4']);
  });

  it('shows Fineract’s own message for a 4xx and empties the rows', () => {
    mount();

    // A page lands first: a re-read keeps the rows it already holds until its own response settles,
    // and the failure below is what has to clear them.
    initialRead.flush(FIRST_PAGE);
    expect(component.rows()).toHaveLength(3);

    // The second read — the find submitted with an empty field re-reads the page — is the one that
    // fails, so the state asserted below is that read's outcome.
    component.onFind();
    const failing = httpMock.match(isClientListRead);
    expect(failing).toHaveLength(1);
    failing[0].flush(
      { defaultUserMessage: REFUSED_MESSAGE },
      { status: 400, statusText: 'Bad Request' },
    );

    // The message is the server's text verbatim: no prefix, no translation, no fallback (workflow W7).
    expect(component.errorMessage()).toBe(REFUSED_MESSAGE);
    expect(component.failed()).toBe(true);
    expect(component.rows()).toEqual([]);
    expect(component.visibleRows()).toEqual([]);
    expect(component.loading()).toBe(false);

    fixture.detectChanges();

    // The banner carries that same text and nothing else, and the card shows no rows and no empty
    // state: a failed read is not an empty result.
    const banner = element<HTMLElement>('.alert.alert-danger');
    expect(banner).not.toBeNull();
    expect(banner?.textContent?.trim()).toBe(REFUSED_MESSAGE);
    expect(fixture.debugElement.queryAll(By.css('tbody tr'))).toHaveLength(0);
    expect(fixture.debugElement.queryAll(By.css('app-empty-state'))).toHaveLength(0);

    // The interceptor raises the single notification a failure carries; the screen raises none of its
    // own, so the same problem is never reported twice (AAP 0.7.4).
    expect(notificationStub.show).not.toHaveBeenCalled();

    // The screen stays mounted and usable: its toolbar is not disabled and nothing was navigated.
    expect(component.toolbar.controls.filter.enabled).toBe(true);
    expect(element<HTMLInputElement>('#filterText')?.disabled).toBe(false);
    expect(httpMock.match(isClientListRead)).toHaveLength(0);
  });

  it('leaves the message empty for a 5xx, because the interceptor has already notified it', () => {
    mount();

    initialRead.flush(FIRST_PAGE);
    expect(component.rows()).toHaveLength(3);

    component.onFind();
    const failing = httpMock.match(isClientListRead);
    expect(failing).toHaveLength(1);
    failing[0].flush({}, { status: 503, statusText: 'Service Unavailable' });

    expect(component.failed()).toBe(true);
    // Reporting a 5xx here as well would show the same problem twice (AAP 0.7.4).
    expect(component.errorMessage()).toBeNull();
    expect(component.rows()).toEqual([]);
    expect(component.loading()).toBe(false);

    fixture.detectChanges();

    // No second surface: no banner, and no "no clients" claim about a read that failed.
    expect(fixture.debugElement.queryAll(By.css('.alert.alert-danger'))).toHaveLength(0);
    expect(fixture.debugElement.queryAll(By.css('app-empty-state'))).toHaveLength(0);
    expect(notificationStub.show).not.toHaveBeenCalled();
    expect(httpMock.match(isClientListRead)).toHaveLength(0);
  });

  it('pages a larger match by asking for the next page’s offset and counts pages from the server’s total', () => {
    mount();

    initialRead.flush(LARGE_MATCH_FIRST_PAGE);

    // The envelope's `totalFilteredRecords` is what the pager counts with: 31 rows at the legacy 15
    // per page is three pages, which is why the family models the count rather than the rows alone.
    expect(component.page()).toBe(1);
    expect(component.pageCount()).toBe(3);
    expect(component.pageNumbers()).toEqual([1, 2, 3]);

    const click = new MouseEvent('click', { cancelable: true });
    component.goToPage(click, 2);

    // Paging is a read, not a navigation: the anchor's default is suppressed, so the hash route the
    // screen was reached by cannot change.
    expect(click.defaultPrevented).toBe(true);

    const secondPage = httpMock.match(isClientListRead);
    expect(secondPage).toHaveLength(1);
    // Legacy's own paging arithmetic, `offset: (page - 1) * clientsPerPage`, with the page size kept.
    expect(secondPage[0].request.params.get('offset')).toBe(SECOND_PAGE_OFFSET);
    expect(secondPage[0].request.params.get('limit')).toBe(PAGE_LIMIT);

    secondPage[0].flush(LARGE_MATCH_SECOND_PAGE);

    expect(component.page()).toBe(2);
    expect(component.rows().map((row) => row.name)).toEqual([JOSE]);
    expect(component.loading()).toBe(false);
  });

  it('neither pages past the last page nor re-reads the page already in view', () => {
    mount();
    initialRead.flush(LARGE_MATCH_FIRST_PAGE);

    const click = new MouseEvent('click', { cancelable: true });

    // The page being shown, then one beyond the third and only, last page: neither is a read.
    component.goToPage(click, 1);
    component.goToPage(click, 4);

    httpMock.expectNone(isClientListRead);
    expect(component.page()).toBe(1);
    expect(component.loading()).toBe(false);
  });

  it('pages a find’s answer client-side, fifteen rows at a time and with no request', () => {
    mount();
    initialRead.flush(FIRST_PAGE);

    // Legacy's find keeps the whole match and pages it out of the rows in hand: `totalClients` is the
    // answer's length, the first page is `actualClients.slice(0, clientsPerPage)`, and a later page is
    // the same slice moved along with no request at all (`ClientController.js:15-19,81-83`).
    component.toolbar.controls.find.setValue('Find');
    component.onFind();
    httpMock.match(isFindRead)[0].flush(findAnswer(31));
    fixture.detectChanges();

    expect(component.page()).toBe(1);
    expect(component.totalRecords()).toBe(31);
    expect(component.pageCount()).toBe(3);
    expect(component.pageNumbers()).toEqual([1, 2, 3]);
    expect(component.visibleRows()).toHaveLength(15);
    expect(component.visibleRows()[0]?.name).toBe('Find 01');
    expect(pageLinks().map((link) => link.textContent?.trim())).toEqual(['1', '2', '3']);

    const click = new MouseEvent('click', { cancelable: true });
    component.goToPage(click, 2);
    fixture.detectChanges();

    // Paging the answer in hand costs no request of either kind, and the anchor's default is still
    // suppressed so the hash route cannot change.
    expect(click.defaultPrevented).toBe(true);
    httpMock.verify();
    expect(component.page()).toBe(2);
    expect(component.visibleRows()).toHaveLength(15);
    expect(component.visibleRows()[0]?.name).toBe('Find 16');

    component.goToPage(click, 3);
    expect(component.visibleRows()).toHaveLength(1);
    expect(component.visibleRows()[0]?.name).toBe('Find 31');

    // The display filter narrows the answer under the pager: the page in view is clamped to the last
    // page that still holds a match, so the table is never empty while the answer has one.
    component.toolbar.controls.filter.setValue('Find 31');
    fixture.detectChanges();

    expect(component.visibleRows()).toHaveLength(1);
    expect(component.visibleRows()[0]?.name).toBe('Find 31');

    // A page read ends the client-side paging: the rows come from the server again, exactly as
    // `getResultsPage` asks it once the find field is empty (`ClientController.js:15-27,53-55`).
    component.toolbar.controls.find.setValue('');
    component.toolbar.controls.filter.setValue('');
    component.onFind();
    const reread = httpMock.match(isClientListRead);

    expect(reread).toHaveLength(1);
    expect(reread[0].request.params.get('offset')).toBe(FIRST_PAGE_OFFSET);
    reread[0].flush(LARGE_MATCH_FIRST_PAGE);
    fixture.detectChanges();

    expect(component.totalRecords()).toBe(31);
    expect(component.page()).toBe(1);
    expect(component.visibleRows()).toHaveLength(1);
  });

  it('renders one page link per page and marks the page in view active, as legacy does', () => {
    mount();
    initialRead.flush(LARGE_MATCH_FIRST_PAGE);
    fixture.detectChanges();

    // One span of the pager's markup only: the page links, which are the surface this change adds.
    // The rest of the template is covered by its compilation and lint pass, as this file's header
    // records.
    const firstPageLinks = pageLinks();

    expect(firstPageLinks.map((link) => link.textContent?.trim())).toEqual(['1', '2', '3']);
    // `.active` on the `li` is the only state the pager carries, and the wrapper is no landmark:
    // legacy's control renders a bare `<a href="">` inside a plain block, and AAP 0.10.5 registers
    // no ARIA addition on top of it (Rule 1 clause 3).
    expect(firstPageLinks[0].closest('li')?.classList.contains('active')).toBe(true);
    expect(host().querySelector('nav')).toBeNull();
    expect(firstPageLinks.map((link) => link.getAttribute('aria-current'))).toEqual([
      null,
      null,
      null,
    ]);

    component.goToPage(new MouseEvent('click', { cancelable: true }), 2);
    httpMock.match(isClientListRead)[0].flush(LARGE_MATCH_SECOND_PAGE);
    fixture.detectChanges();

    const secondPageLinks = pageLinks();

    expect(secondPageLinks[1].closest('li')?.classList.contains('active')).toBe(true);
    expect(secondPageLinks[0].closest('li')?.classList.contains('active')).toBe(false);
    expect(secondPageLinks.map((link) => link.getAttribute('aria-current'))).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('paints no pager for a single page', () => {
    mount();
    initialRead.flush(FIRST_PAGE);
    fixture.detectChanges();

    // The design's five-client capture shows this state: the card ends at the table.
    expect(pageLinks()).toEqual([]);
  });
});
