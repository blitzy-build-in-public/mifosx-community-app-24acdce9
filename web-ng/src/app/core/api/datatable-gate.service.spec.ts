import { provideHttpClient, type HttpRequest } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppConfigService } from '../config/app-config.service';
import {
  CLIENT_ACTION_CHECK_STATUS,
  CLIENT_ENTITY_NAME,
  DataTableGateService,
  type ClientActionName,
  type ClientCheckStatus,
  type DataTableGateResult,
  type DataTableRowSet,
  type EntityDatatableCheck,
  type EntityDatatableCheckPage,
} from './datatable-gate.service';

/**
 * Contract and behaviour spec for `DataTableGateService`, the gate every client lifecycle action
 * passes through before it posts (AAP 0.3.4 claim 13; AAP 0.7.3 row "Client actions: datatable gate";
 * AAP 0.7.1 supporting-services row `DataTableGateService`). It is the `HttpTestingController`
 * contract test Rule 1 clause 8 asks for on both endpoints the gate uses: `GET
 * /entityDatatableChecks?limit=-1` and `GET /datatables/{table}/{clientId}?genericResultSet=true`.
 *
 * Each test below pins one contract, against the shapes the legacy controller actually reads:
 * - the checks call is a `GET` carrying `limit=-1` and no other parameter, and its answer is the paged
 *   envelope `{totalFilteredRecords, pageItems}` — not a bare row list, because
 *   `app/scripts/controllers/client/ClientActionsController.js:27` reads `response.pageItems`;
 * - the action selects the check status through `CLIENT_ACTION_CHECK_STATUS`, and the filter compares
 *   the check's `status.value` (a Fineract enum's name, :28) with it: a check of another entity, of
 *   another status, or with the right name in another case is never read;
 * - each surviving table is read once as a `GET` carrying `genericResultSet=true` and no other
 *   parameter, with the table name and the client id as path segments rather than query parameters;
 * - the emitted array holds one result per checked table in the order the server listed the checks,
 *   even when the reads complete in the opposite order, and each result's `resultSet` is the envelope
 *   the read returned, untouched;
 * - no applicable check emits an empty array and issues no datatable request at all;
 * - a failure of either call reaches the subscriber as an error, with no emission and no completion, so
 *   the caller in `features/clients/client-actions/**` can block the action;
 * - an action with no mapped check status fails before any request, because a gate that cannot tell
 *   what to read must not report a pass.
 *
 * The transport is the real `HttpClient` over `HttpTestingController`, so the assertions are on the
 * requests the service actually composes — method, path, parameter set and parameter values — rather
 * than on a stand-in for `HttpClient`. `AppConfigService` is stubbed because this spec is about the
 * gate's own URLs: the resolution of `apiBaseUrl` and `apiPath` is proved in
 * `core/config/app-config.service.spec.ts` (AAP 0.4.4 decision 5).
 */

/**
 * The served API host and root, written out exactly as `web-ng/src/assets/config.json` ships them, so
 * the requests this spec expects are the URLs the deployed application produces (AAP 0.4.4 decision
 * 5(a)). No demo host appears here or anywhere else (Rule 2).
 */
const API_BASE_URL = 'https://localhost:8443';
const API_PATH = '/fineract-provider/api/v1';
const API_ROOT = `${API_BASE_URL}${API_PATH}`;

/**
 * The one separator the expected URLs are joined with. Named because both the stub's composition and
 * the expectations below join path segments, and one constant keeps the expected URL and the requested
 * URL built the same way.
 */
const SEPARATOR = '/';

/** The resource path of the gate's first call (AAP 0.7.3 row "Client actions: datatable gate"). */
const ENTITY_CHECKS_PATH = 'entityDatatableChecks';

/** The checks URL the service must request, composed from the serving configuration and the path. */
const ENTITY_CHECKS_URL = API_ROOT + SEPARATOR + ENTITY_CHECKS_PATH;

/** The client every case gates, and the two registered tables the fixtures' checks name. */
const CLIENT_ID = 7;
const FIRST_TABLE = 'client_extra_details';
const SECOND_TABLE = 'client_family_members';

/**
 * The numeric ids of the check statuses these fixtures use, from Fineract's `StatusEnum`: `ACTIVATE` is
 * 300, `WITHDRAWN` 400, `REJECTED` 500 and `CLOSE` 600. Written out so the fixture's enum values are
 * the ones the backend serialises, rather than an id the assertion would agree with on its own.
 */
const STATUS_IDS: Readonly<Record<ClientCheckStatus, number>> = {
  ACTIVATE: 300,
  CLOSE: 600,
  REJECTED: 500,
  WITHDRAWN: 400,
};

/** The five in-scope actions paired with the status the checks must be filtered on. */
const ACTION_STATUS: readonly (readonly [ClientActionName, ClientCheckStatus])[] = [
  ['activate', 'ACTIVATE'],
  ['close', 'CLOSE'],
  ['reject', 'REJECTED'],
  ['withdraw', 'WITHDRAWN'],
  ['reactivate', 'ACTIVATE'],
];

/**
 * The stub `apiUrl()`: the gate owns no host, so the configuration supplies one (AAP 0.4.2, Rule 2). It
 * composes exactly as `AppConfigService.apiUrl()` documents — base, path and resource joined with one
 * separator and no other rewriting — so a request this spec sees is the one the application sends.
 */
const apiConfig: Pick<AppConfigService, 'apiUrl'> = {
  apiUrl: (path: string): string => `${API_ROOT}${SEPARATOR}${path}`,
};

/**
 * A generic result set with one entry, the shape `GET /datatables/{table}/{clientId}?genericResultSet=true`
 * answers: a column list and rows whose values are positional.
 */
const RESULT_SET: DataTableRowSet = {
  columnHeaders: [
    { columnName: 'id', columnType: 'BIGINT', columnDisplayType: 'INTEGER', isColumnPrimaryKey: true },
    { columnName: 'bank_name', columnType: 'VARCHAR', columnDisplayType: 'STRING' },
  ],
  data: [{ row: [1, 'Parity Bank'] }],
};

/** A generic result set with no entry — the table exists and this client has no row in it. */
const EMPTY_RESULT_SET: DataTableRowSet = { columnHeaders: [], data: [] };

/** The URL of one datatable read, composed segment by segment. */
function datatableUrl(table: string, clientId: number | string): string {
  return [API_ROOT, 'datatables', table, clientId].join(SEPARATOR);
}

/** One `GET /entityDatatableChecks` row, built from the members the gate reads. */
function checkRow(
  datatableName: string,
  statusValue: ClientCheckStatus,
  entity: string = CLIENT_ENTITY_NAME,
): EntityDatatableCheck {
  return {
    entity,
    status: { id: STATUS_IDS[statusValue], code: 'statusEnum.' + statusValue.toLowerCase(), value: statusValue },
    datatableName,
  };
}

/** The paged envelope `GET /entityDatatableChecks` answers with, holding the given checks. */
function checksPage(pageItems: readonly EntityDatatableCheck[]): EntityDatatableCheckPage {
  return { totalFilteredRecords: pageItems.length, pageItems };
}

/** Matches the gate's first call by method and path; the parameter set is asserted separately. */
function isChecksRequest(request: HttpRequest<unknown>): boolean {
  return request.method === 'GET' && request.url === ENTITY_CHECKS_URL;
}

/** Matches one table's read by method and path; the parameter set is asserted separately. */
function isDatatableRequest(table: string, clientId: number | string) {
  return (request: HttpRequest<unknown>): boolean =>
    request.method === 'GET' && request.url === datatableUrl(table, clientId);
}

describe('DataTableGateService', () => {
  let service: DataTableGateService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AppConfigService, useValue: apiConfig },
      ],
    });

    service = TestBed.inject(DataTableGateService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Proves no request was left outstanding: a gate that issued a call it never reported would fail
    // here, and so would one that stayed silent about a table the checks named.
    httpMock.verify();
  });

  for (const [action, statusValue] of ACTION_STATUS) {
    it(`gates the ${action} action on the ${statusValue} check status`, () => {
      // The production table is asserted against this spec's own expectation first, so a changed
      // mapping fails here rather than silently gating on another status.
      expect(CLIENT_ACTION_CHECK_STATUS.get(action)).toBe(statusValue);

      const emissions: DataTableGateResult[][] = [];
      service
        .checkClientActionGate(CLIENT_ID, action)
        .subscribe((results) => emissions.push(results));

      const checksRequest = httpMock.expectOne(isChecksRequest);
      expect(checksRequest.request.params.keys()).toEqual(['limit']);
      expect(checksRequest.request.params.get('limit')).toBe('-1');
      expect(checksRequest.request.body).toBeNull();

      // Three rows the action must ignore — another entity, another status, and the right status for a
      // different entity — beside the one it must read.
      const otherStatus: ClientCheckStatus = statusValue === 'CLOSE' ? 'ACTIVATE' : 'CLOSE';
      checksRequest.flush(
        checksPage([
          checkRow('loan_extra_details', statusValue, 'm_loan'),
          checkRow('client_other_status', otherStatus),
          checkRow('savings_extra_details', statusValue, 'm_savings_account'),
          checkRow(FIRST_TABLE, statusValue),
        ]),
      );

      httpMock.expectNone(isDatatableRequest('client_other_status', CLIENT_ID));

      const read = httpMock.expectOne(isDatatableRequest(FIRST_TABLE, CLIENT_ID));
      expect(read.request.params.keys()).toEqual(['genericResultSet']);
      expect(read.request.params.get('genericResultSet')).toBe('true');
      read.flush(RESULT_SET);

      expect(emissions).toEqual([[{ table: FIRST_TABLE, resultSet: RESULT_SET }]]);
    });
  }

  it('reports every checked table in the order the server listed the checks and hands the envelopes back untouched', () => {
    const emissions: DataTableGateResult[][] = [];
    service.checkClientActionGate(CLIENT_ID, 'activate').subscribe((results) => emissions.push(results));

    httpMock
      .expectOne(isChecksRequest)
      .flush(checksPage([checkRow(SECOND_TABLE, 'ACTIVATE'), checkRow(FIRST_TABLE, 'ACTIVATE')]));

    const firstRead = httpMock.expectOne(isDatatableRequest(SECOND_TABLE, CLIENT_ID));
    const secondRead = httpMock.expectOne(isDatatableRequest(FIRST_TABLE, CLIENT_ID));

    // Both reads are bodiless GETs: the table and the client id are in the path, and the only parameter
    // is the one asserted in the cases above.
    expect(firstRead.request.body).toBeNull();
    expect(secondRead.request.body).toBeNull();

    // The first table answers last on purpose: the emitted array must follow the server's order of the
    // checks, not the order the reads happen to complete in.
    secondRead.flush(RESULT_SET);
    firstRead.flush(EMPTY_RESULT_SET);

    expect(emissions).toHaveLength(1);
    expect(emissions[0]?.map((result) => result.table)).toEqual([SECOND_TABLE, FIRST_TABLE]);
    // The same envelopes the reads returned, not copies and not projections: the gate reads no column
    // of a table whose columns are defined per tenant.
    expect(emissions[0]?.[0]?.resultSet).toBe(EMPTY_RESULT_SET);
    expect(emissions[0]?.[1]?.resultSet).toBe(RESULT_SET);
  });

  it('emits an empty array and reads no table when no check applies to the action', () => {
    const emissions: DataTableGateResult[][] = [];
    service.checkClientActionGate(CLIENT_ID, 'close').subscribe((results) => emissions.push(results));

    httpMock
      .expectOne(isChecksRequest)
      .flush(
        checksPage([
          checkRow(FIRST_TABLE, 'ACTIVATE'),
          checkRow(SECOND_TABLE, 'ACTIVATE'),
          checkRow('loan_extra_details', 'CLOSE', 'm_loan'),
        ]),
      );

    expect(emissions).toEqual([[]]);
    // Nothing to read means nothing was read: `verify()` in `afterEach` would report any datatable
    // request, and naming the fixtures' tables states the same expectation where it matters.
    httpMock.expectNone(isDatatableRequest(FIRST_TABLE, CLIENT_ID));
    httpMock.expectNone(isDatatableRequest(SECOND_TABLE, CLIENT_ID));
  });

  it('reads no table when the tenant has no check at all', () => {
    const emissions: DataTableGateResult[][] = [];
    service.checkClientActionGate(CLIENT_ID, 'activate').subscribe((results) => emissions.push(results));

    httpMock.expectOne(isChecksRequest).flush({ totalFilteredRecords: 0, pageItems: [] });

    expect(emissions).toEqual([[]]);
    httpMock.expectNone(isDatatableRequest(FIRST_TABLE, CLIENT_ID));
  });

  it('propagates a failed checks call without reading a table or reporting an empty gate', () => {
    const emissions: DataTableGateResult[][] = [];
    const failures: unknown[] = [];

    service.checkClientActionGate(CLIENT_ID, 'activate').subscribe({
      next: (results) => emissions.push(results),
      error: (failure: unknown) => failures.push(failure),
    });

    httpMock
      .expectOne(isChecksRequest)
      .flush(
        { defaultUserMessage: 'The list of checks could not be read' },
        { status: 500, statusText: 'Server Error' },
      );

    expect(failures).toHaveLength(1);
    expect(emissions).toEqual([]);
  });

  it('propagates a failed table read instead of reporting the gate as passed', () => {
    const emissions: DataTableGateResult[][] = [];
    const failures: unknown[] = [];

    service.checkClientActionGate(CLIENT_ID, 'activate').subscribe({
      next: (results) => emissions.push(results),
      error: (failure: unknown) => failures.push(failure),
    });

    httpMock.expectOne(isChecksRequest).flush(checksPage([checkRow(FIRST_TABLE, 'ACTIVATE')]));

    // One table failing fails the whole gate: a partial answer would let the caller act on a check
    // whose table was never read.
    httpMock
      .expectOne(isDatatableRequest(FIRST_TABLE, CLIENT_ID))
      .flush({ defaultUserMessage: 'Not permitted' }, { status: 403, statusText: 'Forbidden' });

    expect(failures).toHaveLength(1);
    expect(emissions).toEqual([]);
  });

  for (const clientId of [CLIENT_ID, String(CLIENT_ID)] as const) {
    it(`uses the client id ${JSON.stringify(clientId)} as a raw path segment`, () => {
      service
        .checkClientActionGate(clientId, 'activate')
        .subscribe({ next: () => undefined, error: () => undefined });

      httpMock.expectOne(isChecksRequest).flush(checksPage([checkRow(FIRST_TABLE, 'ACTIVATE')]));

      // The id is part of the path, unencoded, so `isDatatableRequest` compares it as a whole segment
      // and a query-parameter form of the id would not match.
      httpMock.expectOne(isDatatableRequest(FIRST_TABLE, clientId)).flush(RESULT_SET);
    });
  }

  it('fails before any request when the action has no mapped check status', () => {
    const emissions: DataTableGateResult[][] = [];
    const failures: unknown[] = [];

    // An action name read off the URL is a string until it is narrowed: the cast is the documented
    // boundary where that untyped value reaches the typed API (Rule 1 clause 4).
    service.checkClientActionGate(CLIENT_ID, 'archive' as ClientActionName).subscribe({
      next: (results) => emissions.push(results),
      error: (failure: unknown) => failures.push(failure),
    });

    expect(failures).toHaveLength(1);
    expect(emissions).toEqual([]);
    // The gate cannot tell what to read, so it read nothing at all rather than passing on an empty list.
    httpMock.expectNone(() => true);
  });
});
