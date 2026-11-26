import { provideHttpClient, type HttpErrorResponse, type HttpRequest } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { AppConfigService } from '../config/app-config.service';
import {
  SearchService, toResourceParam, type GlobalSearchParams, type SearchResult, type SearchScope, type SearchTemplate,
} from './search.service';

/** Contract spec for `SearchService`: the one place the application composes the Fineract search URLs and turns a selected scope into the `resource` parameter (Rule 1 clause 8; AAP 0.7.3 row "Shell: global search"; AAP 0.7.1). */

/** The served API host and root, written as `web-ng/src/assets/config.json` ships them. */
const API_BASE_URL = 'https://localhost:8443';
const API_PATH = '/fineract-provider/api/v1';
const API_ROOT = API_BASE_URL + API_PATH;

/** The one separator every expected URL is joined with, so expectation and request are built alike. */
const SEPARATOR = '/';

/** The two paths the service owns, named once so the spy assertions and the URLs agree (AAP 0.7.3). */
const SEARCH_PATH = 'search';
const TEMPLATE_PATH = 'search/template';

/** The text the cases search for: a client's name. */
const QUERY = 'Ada Okafor';

/** The URL the service must request for the given path segments: the API root the configuration supplies and the resource segments the service owns. */
function searchUrl(...segments: readonly string[]): string {
  return [API_ROOT, ...segments].join(SEPARATOR);
}

/** Matches a request by method and full URL; the parameter set and body are asserted separately. */
function isRequest(method: string, url: string,
): (request: HttpRequest<unknown>) => boolean {
  return (request: HttpRequest<unknown>): boolean =>
    request.method === method && request.url === url;
}

/** The `AppConfigService` surface `SearchService` uses: the URL composition every service shares. The search endpoints carry no date. */
function configSurface(apiUrl: Mock<(path: string) => string>): Pick<AppConfigService, 'apiUrl'> {
  return { apiUrl };
}

/** The `resource` value legacy put on the wire for each scope on screen (AAP 0.7.3 row "Shell: global search"; AAP 0.10.5 item 9). */
const SCOPE_CASES: readonly {
  readonly scope: SearchScope;
  readonly resource: string;
}[] = [{ scope: 'clients', resource: 'clients,clientIdentifiers' }, { scope: 'loans', resource: 'loans' },
  { scope: 'all', resource: 'clients,clientIdentifiers,loans' }, ];

/** The three states of the optional `exactMatch` flag, whose branches differ only in the input and in what the URL must then carry. */
const EXACT_MATCH_CASES: readonly {
  readonly label: string;
  readonly exactMatch: boolean | undefined;
  readonly sent: string | null;
}[] = [{ label: 'leaves exactMatch off when the caller sets no flag', exactMatch: undefined, sent: null },
  { label: 'sends exactMatch=true when exact matching is on', exactMatch: true, sent: 'true' },
  { label: 'sends exactMatch=false rather than dropping the flag', exactMatch: false, sent: 'false' }, ];

/** A client row as `GET /search` returns it: the `CLIENT` discriminator and the client's status. */
const CLIENT_ROW: SearchResult = {
  entityType: 'CLIENT', entityId: 2, entityName: 'Ada Okafor', entityAccountNo: '000000002', entityExternalId: 'CL-002',
  entityStatus: { id: 300, code: 'clientStatusType.active', value: 'Active' }, };

/** A loan row, which names the client that owns it through `parentId`/`parentName`. */
const LOAN_ROW: SearchResult = {
  entityType: 'LOAN', entityId: 31, entityName: 'Parity Loan', entityAccountNo: '000000031', parentId: 2,
  parentName: 'Ada Okafor', entityStatus: { id: 300, code: 'loanStatusType.active', value: 'Active' }, };

/** A client-identifier row, the shape a search by identifier answers with (AAP 0.10.5 item 9). */
const IDENTIFIER_ROW: SearchResult = {
  entityType: 'CLIENTIDENTIFIER', entityId: 11, entityName: 'Passport P1234567', parentId: 2, parentName: 'Ada Okafor',
};

/** The heterogeneous rows one `GET /search` answers with, in the order the server returned them. */
const ROWS: readonly SearchResult[] = [CLIENT_ROW, LOAN_ROW, IDENTIFIER_ROW];

/** The `GET /search/template` answer as the fork sends it: the ad-hoc query template's loan-product and office options, one plain row of each. */
const SEARCH_TEMPLATE: SearchTemplate = {
  loanProducts: [{ id: 1, name: 'Parity Loan' }], offices: [{ id: 1, name: 'Head Office' }], };

describe('SearchService', () => {
  let service: SearchService;
  let httpMock: HttpTestingController;
  let apiUrl: Mock<(path: string) => string>;

  beforeEach(() => {
    apiUrl = vi.fn((path: string): string => API_ROOT + SEPARATOR + path);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(),
        { provide: AppConfigService, useValue: configSurface(apiUrl) }, ], });
    service = TestBed.inject(SearchService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });
  for (const { scope, resource } of SCOPE_CASES) {
    it(`searches the ${scope} scope with the resource value legacy sends`, () => {
      const received: SearchResult[][] = [];
      const params: GlobalSearchParams = { query: QUERY, resource: scope };

      service.search(params).subscribe((rows) => received.push(rows));

      // The service names only the resource path: the host and the API root belong to the configuration, so it composes no URL of its own (AAP 0.4.2).
      expect(apiUrl).toHaveBeenCalledTimes(1);
      expect(apiUrl).toHaveBeenCalledWith(SEARCH_PATH);

      const request = httpMock.expectOne(isRequest('GET', searchUrl(SEARCH_PATH)));

      // The whole parameter set, in the order it is written: the query, the scope's resource value, and nothing else — no `dateFormat`, no `locale`, no paging (AAP 0.7.3; Rule 1 clause 2).
      expect(request.request.params.keys()).toEqual(['query', 'resource']);
      expect(request.request.params.get('query')).toBe(QUERY);
      expect(request.request.params.get('resource')).toBe(resource);
      expect(request.request.body).toBeNull();

      request.flush(ROWS);

      // The rows arrive exactly as the server ordered them, neither filtered nor sorted and not remapped into another shape (Rule 1 clause 3).
      expect(received).toEqual([ROWS]);
      expect(received[0]).toBe(ROWS);
      expect(received[0]?.map((row) => row.entityType)).toEqual([
        'CLIENT',
        'LOAN',
        'CLIENTIDENTIFIER',
      ]);
    });
  }

  for (const { label, exactMatch, sent } of EXACT_MATCH_CASES) {
    it(`${label}`, () => {
      service.search({ query: QUERY, resource: 'clients', exactMatch }).subscribe();

      const request = httpMock.expectOne(isRequest('GET', searchUrl(SEARCH_PATH)));

      if (sent === null) {
        expect(request.request.params.keys()).toEqual(['query', 'resource']);
        expect(request.request.params.has('exactMatch')).toBe(false);
      } else {
        expect(request.request.params.keys()).toEqual(['query', 'resource', 'exactMatch']);
        expect(request.request.params.get('exactMatch')).toBe(sent);
      }

      request.flush(ROWS);
    });
  }

  it('maps every scope onto the resource parameter by the one exported mapping', () => {
    // Asserted directly as well as through the URL: the mapping is exported so that no second derivation of it can appear anywhere else, and this states each arm of it (AAP 0.7.3).
    for (const { scope, resource } of SCOPE_CASES) {
      expect(toResourceParam(scope)).toBe(resource);
    }
  });

  it('emits an empty array for a search that matched nothing, without inventing a row', () => {
    const received: SearchResult[][] = [];

    service.search({ query: 'No Such Client', resource: 'all' }).subscribe((rows) => received.push(rows));

    const request = httpMock.expectOne(isRequest('GET', searchUrl(SEARCH_PATH)));

    expect(request.request.params.get('query')).toBe('No Such Client');

    request.flush([]);

    // The empty result set reaches the screen as it is, so the results list renders its explicit empty state rather than a row this application made up (AAP 0.7.4).
    expect(received).toEqual([[]]);
  });

  it('reads the search template with no parameter at all', () => {
    const received: SearchTemplate[] = [];

    service.template().subscribe((template) => received.push(template));

    expect(apiUrl).toHaveBeenCalledWith(TEMPLATE_PATH);

    const request = httpMock.expectOne(isRequest('GET', searchUrl(SEARCH_PATH, 'template')));

    expect(request.request.params.keys()).toEqual([]);
    expect(request.request.body).toBeNull();

    request.flush(SEARCH_TEMPLATE);

    // Returned as received, with no defaulting or reshaping of either option list (Rule 1 clause 3).
    expect(received).toEqual([SEARCH_TEMPLATE]);
    expect(received[0]?.loanProducts).toEqual([{ id: 1, name: 'Parity Loan' }]);
    expect(received[0]?.offices).toEqual([{ id: 1, name: 'Head Office' }]);

    // The answer carries the ad-hoc query template's two option lists and nothing else: no list of searchable resources, which the endpoint never sends (AAP 0.7.3 row "Shell: global search").
    expect(Object.keys(received[0] ?? {}).sort()).toEqual(['loanProducts', 'offices']);
  });

  it('sets no authorization and no tenant header, because both belong to the HTTP interceptor', () => {
    service.search({ query: QUERY, resource: 'clients' }).subscribe();

    const request = httpMock.expectOne(isRequest('GET', searchUrl(SEARCH_PATH)));
    const names = request.request.headers.keys().map((name) => name.toLowerCase());

    expect(names).not.toContain('authorization');
    expect(names).not.toContain('fineract-platform-tenantid');
    expect(names).toEqual([]);

    request.flush(ROWS);
  });

  it('propagates a failed search unchanged, so the interceptor can map the message the screen shows', () => {
    const received: SearchResult[][] = [];
    const failures: HttpErrorResponse[] = [];
    const refusal = { defaultUserMessage: 'The search could not be run' };

    service.search({ query: QUERY, resource: 'loans' }).subscribe({
      next: (rows) => received.push(rows),
      error: (failure: HttpErrorResponse) => failures.push(failure),
    });

    httpMock
      .expectOne(isRequest('GET', searchUrl(SEARCH_PATH)))
      .flush(refusal, { status: 500, statusText: 'Server Error' });

    // One failure, no emission and no completion: the service maps nothing and swallows nothing, and the status and body it hands on are the ones Fineract sent rather than a failure re-created in the service, so the screen reads Fineract's own message through the `ApiError` the interceptor builds from that status and body (AAP 0.4.2, AAP 0.14.2).
    expect(failures).toHaveLength(1);
    expect(received).toEqual([]);
    expect(failures[0]?.status).toBe(500);
    expect(failures[0]?.error).toEqual(refusal);
  });

  it('re-reads the result set on every call, because a search is never cached', () => {
    service.search({ query: QUERY, resource: 'clients' }).subscribe();
    service.search({ query: QUERY, resource: 'clients' }).subscribe();

    const requests = httpMock.match(isRequest('GET', searchUrl(SEARCH_PATH)));

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      request.flush(ROWS);
    }
  });
});
