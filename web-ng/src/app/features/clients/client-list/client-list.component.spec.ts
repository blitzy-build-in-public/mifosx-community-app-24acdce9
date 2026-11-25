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
import { provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { catchError, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PermissionsService } from '../../../core/auth/permissions.service';
import { DEFAULT_APP_CONFIG } from '../../../core/config/app-config.model';
import { AppConfigService } from '../../../core/config/app-config.service';
import { toApiError } from '../../../core/http/api-error';
import type { Client } from '../client.models';
import { ClientListComponent } from './client-list.component';

/**
 * Behaviour of the clients list at `#/clients` — the post-authentication landing screen, step 2 of 3
 * of the design flow "Sign in and open a client record", and the entry point of workflow W2 (its
 * "Create Client" control) and workflow W3 (a row opened onto the record) (AAP 0.7.1 Features row
 * `clients`; AAP 0.7.4 "Clients list (`#/clients`)", Figma node `1:3`; AAP 0.11.1 "unit specs beside
 * every component and service"; Rule 1 clause 8).
 *
 * What it pins is the traffic the screen produces and the two signals its table reads, because those
 * are the parts a rewrite would silently change:
 *
 *  1. exactly one `GET /clients` on construction, carrying `offset=0` and `limit=15` and no
 *     `searchText` — the parameter set the legacy `getAllClients({offset, limit})` sends, and nothing
 *     the legacy list does not send (Rule 1 clauses 2 and 3; AAP 0.7.3 row "Client list and edit");
 *  2. the paged envelope's `pageItems` become the rows, in the server's order, with no sort, filter
 *     or reformatting (Rule 1 clause 3);
 *  3. the two display filters — "Show Closed" and the filter field — narrow the rows already in hand
 *     and cost no request at all, and the filter compares the row's name (a page row's `displayName`)
 *     case-insensitively;
 *  4. a 4xx renders Fineract's own message on `errorMessage` and empties the rows, which is the state
 *     the template shows in place of the table (AAP 0.7.4 states; workflow W7);
 *  5. a 5xx leaves `errorMessage` empty and only flags the failure, because the interceptor has
 *     already raised the single notification carrying it and reporting it twice is what the plan
 *     forbids (AAP 0.7.4);
 *  6. `loading()` is true while the read is outstanding and false once it settles either way.
 *
 * **No DOM is asserted here, and that is deliberate.** Every assertion above is made on the
 * component's own signals and on `HttpTestingController`, which is what this spec owns: the traffic
 * the screen sends and the state it holds. The markup beside this file renders those signals and is
 * covered by its own compilation and lint pass, so restating its wording here would make this file
 * move every time a heading is reworded without pinning anything the signals do not already pin.
 *
 * **Providers.** The configuration is loaded from a stubbed `fetch` before the component exists,
 * because every client URL is composed from it. The ngx-translate stack is registered for the
 * template's pipe. `PermissionsService` is a stub typed against the real class, because the
 * component imports the permission directive its toolbar gates "Create Client" with; no session is
 * ever assembled for a spec. `provideRouter([])` supplies the router the row and "Create Client"
 * links need in order to render; the empty route table is enough because no case navigates.
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

/** The first page's offset and page size, which are the legacy list's own `offset: 0, limit: 15`. */
const FIRST_PAGE_OFFSET = '0';
const PAGE_LIMIT = '15';

/** The office every fixture client is filed under. */
const OFFICE_NAME = 'Head Office';

/** Names the fixtures are filtered by, chosen so case-insensitive matching is observable. */
const ADA = 'Ada Okafor';
const MARCUS = 'Marcus Rowe-Bennett';
const JOSE = 'José Luis Núñez';

/**
 * The message a refused list read answers with. A 4xx is the one status this screen renders itself.
 */
const REFUSED_MESSAGE = 'The client list could not be read for this office.';

/**
 * A client row as `GET /clients` returns it: the five members the model requires, with the name and
 * the status code a case is about. The names are the project's own fixed seed fixtures (AAP 0.10.1)
 * used here only as stub payload values: nothing in this file stores, sends or prints tenant state.
 *
 * @param id the client id, also rendered as the zero-padded account number.
 * @param displayName the name the list prints and the filter compares.
 * @param statusCode the Fineract status code, e.g. `'clientStatusType.closed'`.
 */
function clientRow(id: number, displayName: string, statusCode: string): Client {
  return {
    id,
    accountNo: `${id}`.padStart(9, '0'),
    displayName,
    officeId: 1,
    officeName: OFFICE_NAME,
    status: { id: 1, code: statusCode, value: 'the server label, never rendered' },
    timeline: {},
  };
}

/** An open client: the state "Show Closed" leaves on screen and the filter can narrow. */
const ACTIVE_CLIENT = clientRow(2, ADA, 'clientStatusType.active');

/** A terminal client, which the list hides until "Show Closed" is ticked. */
const CLOSED_CLIENT = clientRow(3, MARCUS, 'clientStatusType.closed');

/** A client still awaiting activation: neither hidden nor filtered until a case says so. */
const PENDING_CLIENT = clientRow(4, JOSE, 'clientStatusType.pending');

/** The page the endpoint answers the first read with, in the server's own order. */
const FIRST_PAGE = {
  totalFilteredRecords: 3,
  pageItems: [ACTIVE_CLIENT, CLOSED_CLIENT, PENDING_CLIENT],
} as const;

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

/**
 * The half of `PermissionsService` the toolbar's permission gate reads. Typed against the real class
 * with `Pick`, so the stub cannot drift from the two questions the directive asks, and it needs no
 * session: the screen's traffic does not depend on a permission.
 */
class PermissionsStub implements Pick<PermissionsService, 'can' | 'has'> {
  /** Membership only: this suite grants nothing, so every gate the toolbar renders stays shut. */
  can(): boolean {
    return false;
  }

  /** The directive-facing question, answered the same way. */
  has(): boolean {
    return false;
  }
}

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

  beforeEach(async () => {
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
        // The screen links rows and the "Create Client" control through `RouterLink`, so the router
        // has to exist for the template to render at all; an empty route table is enough because no
        // case navigates (the same provider the search-results spec uses).
        provideRouter([]),
      ],
    });

    await TestBed.inject(AppConfigService).load();

    const translate = TestBed.inject(TranslateService);
    // No key is served here: this spec asserts no rendered text, so the stack is registered only
    // because the component imports the translate pipe.
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

  it('reports the read as outstanding until the page lands, then holds its rows in server order', () => {
    mount();

    expect(component.loading()).toBe(true);
    expect(component.rows()).toEqual([]);

    // The endpoint answers with the paged envelope, not a bare array; the table renders its
    // `pageItems` in exactly the order the server listed them (Rule 1 clause 3).
    initialRead.flush(FIRST_PAGE);

    expect(component.loading()).toBe(false);
    expect(component.failed()).toBe(false);
    expect(component.errorMessage()).toBeNull();
    expect(component.rows().map((row) => row.clientId)).toEqual([2, 3, 4]);
    expect(component.rows().map((row) => row.name)).toEqual([ADA, MARCUS, JOSE]);
  });

  it('narrows the loaded rows client-side: closed rows hidden unless shown, and the filter is case-insensitive', () => {
    mount();

    initialRead.flush(FIRST_PAGE);

    // The terminal client is hidden by default: the design's swatch vocabulary treats closed,
    // rejected and withdrawn as one "closed" state, and the checkbox is what reveals them.
    expect(component.visibleRows().map((row) => row.name)).toEqual([ADA, JOSE]);
    expect(component.visibleRows().map((row) => row.statusKey)).toEqual(['active', 'pending']);

    component.toolbar.controls.showClosed.setValue(true);

    expect(component.visibleRows().map((row) => row.name)).toEqual([ADA, MARCUS, JOSE]);
    expect(component.visibleRows().map((row) => row.statusKey)).toContain('closed');

    // The filter compares the row's name — the client's `displayName` on a page row — so a lower-case
    // needle matches.
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
    // The screen stays mounted and usable: its toolbar is not disabled and nothing was navigated.
    expect(component.toolbar.controls.filter.enabled).toBe(true);
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
    expect(httpMock.match(isClientListRead)).toHaveLength(0);
  });
});
