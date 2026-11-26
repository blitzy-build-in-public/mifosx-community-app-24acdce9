import { provideHttpClient, type HttpRequest } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppConfigService } from '../config/app-config.service';
import {
  CLIENT_ACTION_CHECK_STATUS, CLIENT_ENTITY_NAME, DataTableGateService, type ClientActionName, type ClientCheckStatus,
  type DataTableGateResult, type DataTableRowSet, type EntityDatatableCheck, type EntityDatatableCheckPage,
} from './datatable-gate.service';

/** Contract and behaviour spec for `DataTableGateService`, the gate every client lifecycle action passes through before it posts (AAP 0.3.4 claim 13; AAP 0.7.3 row "Client actions: datatable gate"; AAP 0.7.1 supporting-services row `DataTableGateService`). */

/** The served API host and root, written out exactly as `web-ng/src/assets/config.json` ships them. */
const API_BASE_URL = 'https://localhost:8443';
const API_PATH = '/fineract-provider/api/v1';
const API_ROOT = `${API_BASE_URL}${API_PATH}`;

/** The one separator the expected URLs are joined with. Named because both the stub's composition and the expectations below join path segments, and one constant keeps the expected URL and the requested URL built the same. */
const SEPARATOR = '/';

/** The resource path of the gate's first call (AAP 0.7.3 row "Client actions: datatable gate"). */
const ENTITY_CHECKS_PATH = 'entityDatatableChecks';

/** The checks URL the service must request, composed from the serving configuration and the path. */
const ENTITY_CHECKS_URL = API_ROOT + SEPARATOR + ENTITY_CHECKS_PATH;

/** The client every case gates, and the two registered tables the fixtures' checks name. */
const CLIENT_ID = 7;
const FIRST_TABLE = 'client_extra_details';
const SECOND_TABLE = 'client_family_members';

/** A client id in the zero-padded form the legacy client list shows it in. */
const LEADING_ZERO_CLIENT_ID = '000000002';

/** The numeric ids of the check statuses these fixtures use, from Fineract's `StatusEnum`: `ACTIVATE` is 300, `WITHDRAWN` 400, `REJECTED` 500 and `CLOSE` 600. */
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

/** Answers to `GET /entityDatatableChecks` the gate must not read as an empty gate, each named by what is wrong with it. The answer is `unknown` because the endpoint's payload reaches the gate untyped, so an entry may be something other than an object at all and reaches the mock backend through the cast below (Rule 1 clause 4). */
const UNREADABLE_ANSWERS: readonly (readonly [string, unknown])[] = [
  ['that carries no pageItems', { totalFilteredRecords: 0 }],
  ['whose pageItems is null', { totalFilteredRecords: 1, pageItems: null }],
  ['whose pageItems is a string', { totalFilteredRecords: 1, pageItems: FIRST_TABLE }],
  ['that carries a row which is not an object', { totalFilteredRecords: 1, pageItems: [null] }],
  [
    'that carries a row naming no entity',
    {
      totalFilteredRecords: 1,
      pageItems: [
        {
          status: { id: STATUS_IDS.ACTIVATE, code: 'statusEnum.activate', value: 'ACTIVATE' },
          datatableName: FIRST_TABLE,
        },
      ],
    },
  ],
  [
    'that carries a client row without a status',
    { totalFilteredRecords: 1, pageItems: [{ entity: CLIENT_ENTITY_NAME, datatableName: FIRST_TABLE }] },
  ],
  [
    'that carries a client row whose status has no value',
    {
      totalFilteredRecords: 1,
      pageItems: [
        {
          entity: CLIENT_ENTITY_NAME,
          status: { id: STATUS_IDS.ACTIVATE, code: 'statusEnum.activate' },
          datatableName: FIRST_TABLE,
        },
      ],
    },
  ],
  [
    'that carries a client check naming no datatable',
    {
      totalFilteredRecords: 1,
      pageItems: [
        {
          entity: CLIENT_ENTITY_NAME,
          status: { id: STATUS_IDS.ACTIVATE, code: 'statusEnum.activate', value: 'ACTIVATE' },
        },
      ],
    },
  ],
  ['that is a JSON array rather than the page envelope', []],
  ['that is a bare string rather than the page envelope', 'refused'],
];

/** The stub `apiUrl()`: the gate owns no host, so the configuration supplies one (AAP 0.4.2, Rule 2). */
const apiConfig: Pick<AppConfigService, 'apiUrl'> = {
  apiUrl: (path: string): string => `${API_ROOT}${SEPARATOR}${path}`,
};

/** A generic result set with one entry, the shape `GET /datatables/{table}/{clientId}?genericResultSet=true` answers: a column list and rows whose values are positional. */
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

/** Matches any read in the datatable family, whichever table and client id it names. */
function isAnyDatatableRequest(request: HttpRequest<unknown>): boolean {
  return request.method === 'GET' && request.url.startsWith(`${API_ROOT}${SEPARATOR}datatables${SEPARATOR}`);
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
    httpMock.verify();
  });

  for (const [action, statusValue] of ACTION_STATUS) {
    it(`gates the ${action} action on the ${statusValue} check status`, () => {
      expect(CLIENT_ACTION_CHECK_STATUS.get(action)).toBe(statusValue);

      const emissions: DataTableGateResult[][] = [];
      service
        .checkClientActionGate(CLIENT_ID, action)
        .subscribe((results) => emissions.push(results));

      const checksRequest = httpMock.expectOne(isChecksRequest);
      expect(checksRequest.request.params.keys()).toEqual(['limit']);
      expect(checksRequest.request.params.get('limit')).toBe('-1');
      expect(checksRequest.request.body).toBeNull();

      // The legacy order of the two calls (`app/scripts/controllers/client/ClientActionsController.js:26-35`): the tables to read come out of the checks answer, so nothing in the datatable family may be in flight before that answer has landed.
      httpMock.expectNone(isAnyDatatableRequest);

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

    expect(firstRead.request.body).toBeNull();
    expect(secondRead.request.body).toBeNull();

    secondRead.flush(RESULT_SET);
    firstRead.flush(EMPTY_RESULT_SET);

    expect(emissions).toHaveLength(1);
    expect(emissions[0]?.map((result) => result.table)).toEqual([SECOND_TABLE, FIRST_TABLE]);
    expect(emissions[0]?.[0]?.resultSet).toBe(EMPTY_RESULT_SET);
    expect(emissions[0]?.[1]?.resultSet).toBe(RESULT_SET);
  });

  it('emits an empty array, completes and reads no table when no check applies to the action', () => {
    const emissions: DataTableGateResult[][] = [];
    let completed = false;

    service.checkClientActionGate(CLIENT_ID, 'close').subscribe({
      next: (results) => emissions.push(results),
      complete: () => (completed = true),
    });

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
    // The gate answers with one empty emission and then finishes, so a caller awaiting it through `firstValueFrom` resolves instead of hanging on a stream that never completes.
    expect(completed).toBe(true);
    httpMock.expectNone(isAnyDatatableRequest);
  });

  it('reads no table when the tenant has no check at all', () => {
    const emissions: DataTableGateResult[][] = [];
    service.checkClientActionGate(CLIENT_ID, 'activate').subscribe((results) => emissions.push(results));

    httpMock.expectOne(isChecksRequest).flush({ totalFilteredRecords: 0, pageItems: [] });

    expect(emissions).toEqual([[]]);
    httpMock.expectNone(isAnyDatatableRequest);
  });

  for (const [description, answer] of UNREADABLE_ANSWERS) {
    it(`fails with one described error and reads no table for an answer ${description}`, () => {
      const emissions: DataTableGateResult[][] = [];
      const failures: unknown[] = [];

      service.checkClientActionGate(CLIENT_ID, 'activate').subscribe({
        next: (results) => emissions.push(results),
        error: (failure: unknown) => failures.push(failure),
      });

      httpMock.expectOne(isChecksRequest).flush(answer as object);

      expect(emissions).toEqual([]);
      expect(failures).toHaveLength(1);

      // `failureMessage()` in the caller renders an `Error`'s own message verbatim, so the gate has to fail with a sentence a screen may show: non-empty, and not the `TypeError` wording of a bare `.filter` or `.status.value`.
      const failure = failures[0];
      expect(failure).toBeInstanceOf(Error);
      const message = failure instanceof Error ? failure.message : '';
      expect(message).not.toBe('');
      expect(message).not.toMatch(/TypeError|undefined|Cannot read/);

      // No datatable read can be issued for an answer whose tables are unknown, and `verify()` in `afterEach` would report any that was issued anyway.
      httpMock.expectNone(isDatatableRequest(FIRST_TABLE, CLIENT_ID));
      httpMock.expectNone(isDatatableRequest(SECOND_TABLE, CLIENT_ID));
    });
  }

  it(`skips another entity's unreadable row and still reads the client check beside it`, () => {
    const emissions: DataTableGateResult[][] = [];
    const failures: unknown[] = [];
    service.checkClientActionGate(CLIENT_ID, 'activate').subscribe({
      next: (results) => emissions.push(results), error: (failure: unknown) => failures.push(failure), });

    // `m_loan` is another entity's check. The legacy filter drops it on `entity` alone (`app/scripts/controllers/client/ClientActionsController.js:28`).
    httpMock.expectOne(isChecksRequest).flush({
      totalFilteredRecords: 2, pageItems: [{ entity: 'm_loan' }, checkRow(FIRST_TABLE, 'ACTIVATE')], });
    httpMock.expectNone(isDatatableRequest(SECOND_TABLE, CLIENT_ID));
    const read = httpMock.expectOne(isDatatableRequest(FIRST_TABLE, CLIENT_ID));
    expect(read.request.params.get('genericResultSet')).toBe('true');
    read.flush(RESULT_SET);
    expect(failures).toEqual([]);
    expect(emissions).toEqual([[{ table: FIRST_TABLE, resultSet: RESULT_SET }]]);
  });

  it('propagates a failed checks call without reading a table or reporting an empty gate', () => {
    const emissions: DataTableGateResult[][] = [];
    const failures: unknown[] = [];
    service.checkClientActionGate(CLIENT_ID, 'activate').subscribe({
      next: (results) => emissions.push(results), error: (failure: unknown) => failures.push(failure), });
    httpMock
      .expectOne(isChecksRequest)
      .flush({ defaultUserMessage: 'The list of checks could not be read' },
        { status: 500, statusText: 'Server Error' }, );
    expect(failures).toHaveLength(1);
    expect(emissions).toEqual([]);
  });

  it('propagates a failed table read instead of reporting the gate as passed', () => {
    const emissions: DataTableGateResult[][] = [];
    const failures: unknown[] = [];
    service.checkClientActionGate(CLIENT_ID, 'activate').subscribe({
      next: (results) => emissions.push(results), error: (failure: unknown) => failures.push(failure), });
    httpMock.expectOne(isChecksRequest).flush(checksPage([checkRow(FIRST_TABLE, 'ACTIVATE')]));

    httpMock
      .expectOne(isDatatableRequest(FIRST_TABLE, CLIENT_ID))
      .flush({ defaultUserMessage: 'Not permitted' }, { status: 403, statusText: 'Forbidden' });
    expect(failures).toHaveLength(1);
    expect(emissions).toEqual([]);
  });
  for (const clientId of [CLIENT_ID, String(CLIENT_ID), LEADING_ZERO_CLIENT_ID] as const) {
    it(`uses the client id ${JSON.stringify(clientId)} as a raw path segment`, () => {
      service
        .checkClientActionGate(clientId, 'activate')
        .subscribe({ next: () => undefined, error: () => undefined });

      httpMock.expectOne(isChecksRequest).flush(checksPage([checkRow(FIRST_TABLE, 'ACTIVATE')]));

      // The id is part of the path, unencoded and uncoerced, so `isDatatableRequest` compares it as a whole segment: a query-parameter form of the id would not match, and neither would the value the leading-zero case would send.
      httpMock.expectOne(isDatatableRequest(FIRST_TABLE, clientId)).flush(RESULT_SET);
    });
  }

  it('fails before any request when the action has no mapped check status', () => {
    const emissions: DataTableGateResult[][] = [];
    const failures: unknown[] = [];

    // An action name read off the URL is a string until it is narrowed: the cast is the documented boundary where that untyped value reaches the typed API (Rule 1 clause 4).
    service.checkClientActionGate(CLIENT_ID, 'archive' as ClientActionName).subscribe({
      next: (results) => emissions.push(results),
      error: (failure: unknown) => failures.push(failure),
    });

    expect(failures).toHaveLength(1);
    expect(emissions).toEqual([]);
    httpMock.expectNone(() => true);
  });

  it('refuses a crafted route id with the guard message and issues no request at all', () => {
    // The router hands an `:id` over URL-decoded, so this value would leave `/api/v1` and read another resource on the same host (CWE-20, CWE-22).
    const crafted = '../../../users';
    const emissions: DataTableGateResult[][] = [];
    const refusals: Error[] = [];

    service.checkClientActionGate(crafted, 'activate').subscribe({
      next: (results) => emissions.push(results),
      error: (failure: unknown) => {
        if (failure instanceof Error) {
          refusals.push(failure);
        }
      },
    });

    expect(emissions).toEqual([]);
    expect(refusals).toHaveLength(1);
    // The message is the guard's fixed sentence, which names neither the rejected value nor the call: that sentence is the text a screen renders, so the diagnostic travels in `cause` instead.
    expect(refusals[0].message).not.toContain(crafted);
    expect(refusals[0].message).not.toContain('DataTableGateService.checkClientActionGate');
    expect(String(refusals[0].cause)).toContain(`'${crafted}'`);
    expect(String(refusals[0].cause)).toContain('DataTableGateService.checkClientActionGate');
    httpMock.expectNone(isChecksRequest);
    httpMock.expectNone(() => true);
  });

  it('refuses a check row whose datatable name is not a table name, without reading that table', () => {
    // The table name comes from the server's own `entityDatatableChecks` answer, so it is checked where the read path is composed: a name of any other shape must not be written into a path that could leave the datatable.
    const crafted = '../../../users';
    const emissions: DataTableGateResult[][] = [];
    const refusals: Error[] = [];

    service.checkClientActionGate(CLIENT_ID, 'activate').subscribe({
      next: (results) => emissions.push(results),
      error: (failure: unknown) => {
        if (failure instanceof Error) {
          refusals.push(failure);
        }
      },
    });

    httpMock.expectOne(isChecksRequest).flush(checksPage([checkRow(crafted, 'ACTIVATE')]));

    expect(emissions).toEqual([]);
    expect(refusals).toHaveLength(1);
    // Same two channels as the case above: the server-supplied name and the composing call are in `cause`, and the sentence a screen renders names neither of them.
    expect(refusals[0].message).not.toContain(crafted);
    expect(refusals[0].message).not.toContain('DataTableGateService.checkClientActionGate');
    expect(String(refusals[0].cause)).toContain(`'${crafted}'`);
    expect(String(refusals[0].cause)).toContain('DataTableGateService.checkClientActionGate');
    httpMock.expectNone(isDatatableRequest(crafted, CLIENT_ID));
    httpMock.expectNone(() => true);
  });
});
