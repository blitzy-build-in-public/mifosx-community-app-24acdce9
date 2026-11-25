import { provideHttpClient, type HttpRequest } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { AppConfigService } from '../../core/config/app-config.service';
import type {
  Client,
  ClientAccountSummary,
  ClientActionCommand,
  ClientCreateRequest,
  ClientIdentifier,
  ClientIdentifierTemplate,
  ClientListPage,
  ClientMutationResponse,
  ClientNarrationTemplate,
  ClientTemplate,
} from './client.models';
import { ClientService, type ClientActionInput, type ClientEditInput } from './client.service';

/**
 * Contract spec for `ClientService`: the one place the clients family composes a Fineract URL and
 * turns a model into a payload (Rule 1 clause 8; AAP 0.7.3 endpoint rows "W2 create and activate
 * client", "Client list and edit", "Client actions" and "W3 search and view client"; AAP 0.11.1 row
 * for this path).
 *
 * Every public method is pinned against the real `HttpTestingController` transport, so the
 * assertions are on the request the application actually sends — method, path, the whole parameter
 * set and the whole body — and never on a stand-in for `HttpClient`. Three properties are asserted
 * for each call beyond its shape:
 *
 *   - the date-format pair. Every date-bearing body carries `dateFormat: 'dd MMMM yyyy'` and the
 *     active `locale`, and every date member is the string `toFineractDate` produced, never a `Date`
 *     (AAP 0.7.2 "Date handling"; Rule 1 clause 2).
 *   - the host. The URL is composed by `AppConfigService.apiUrl()`, which this spec stubs and spies
 *     on, so a service that built its own host would fail here (AAP 0.4.2; Rule 2).
 *   - the absent header. Neither the authorization nor the tenant header is set here; both belong
 *     to `core/http/fineract.interceptor.ts` (AAP 0.4.2).
 *
 * The transport is registered without the application's interceptor, because the interceptor is
 * what adds those headers: a request asserted here is the service's own contribution to it.
 *
 * The `AppConfigService` stub is a fixed, non-secret configuration whose `apiUrl()` composes
 * exactly as the real one documents, so an expected URL and a requested URL are built the same way.
 * The resolution of `apiBaseUrl` and `apiPath` is proved in `core/config/app-config.service.spec.ts`.
 */

/**
 * The served API host and root, written as `web-ng/src/assets/config.json` ships them, so the URLs
 * this spec expects are the URLs the deployed application produces (AAP 0.4.4 decision 5(a)). No
 * demo host appears here or anywhere else in this tree (Rule 2).
 */
const API_BASE_URL = 'https://localhost:8443';
const API_PATH = '/fineract-provider/api/v1';
const API_ROOT = API_BASE_URL + API_PATH;

/** The one separator every expected URL is joined with, so expectation and request are built alike. */
const SEPARATOR = '/';

/** The active language these cases run in, and therefore the `locale` every body must carry. */
const APP_LOCALE = 'en';

/** The one payload format, spelled once; the service takes it from `AppConfig.dateFormat`. */
const FINERACT_DATE_FORMAT = 'dd MMMM yyyy';

/** The client every action and read is aimed at, in both the numeric and the route-parameter form. */
const CLIENT_ID = 2;
const CLIENT_ID_TEXT = '2';

/**
 * A date the client screens hold as a `Date`, built from its local calendar parts so the expected
 * string below cannot shift with the machine's time zone (AAP 0.7.2 "Date handling").
 */
const CLIENT_DATE = new Date(2026, 10, 21);

/** That date as every date-bearing payload must carry it: `dd MMMM yyyy` in the active locale. */
const CLIENT_DATE_TEXT = '21 November 2026';

/** The same date in French, for the case that proves the payload follows the selected language. */
const CLIENT_DATE_TEXT_FR = '21 novembre 2026';

/**
 * The URL the service must request for the given path segments: the API root the configuration
 * supplies and the resource segments the service owns, joined with one separator.
 *
 * @param segments Resource segments, exactly as `client.service.ts` names them.
 */
function clientUrl(...segments: readonly (string | number)[]): string {
  return [API_ROOT, ...segments].join(SEPARATOR);
}

/** Matches a request by method and full URL; the parameter set and body are asserted separately. */
function isRequest(
  method: string,
  url: string,
): (request: HttpRequest<unknown>) => boolean {
  return (request: HttpRequest<unknown>): boolean =>
    request.method === method && request.url === url;
}

/** The members of a request body, so a case can prove an optional member was left out entirely. */
function bodyKeys(request: HttpRequest<unknown>): string[] {
  const body: unknown = request.body;

  return typeof body === 'object' && body !== null ? Object.keys(body) : [];
}

/**
 * The `AppConfigService` surface `ClientService` uses: the resolved configuration, the URL
 * composition every service shares, and the live active locale.
 */
type ConfigSurface = Pick<AppConfigService, 'config' | 'apiUrl' | 'activeLocale'>;

/**
 * Builds the stub from the two live members the cases below need to change: the `apiUrl` spy the
 * host assertions read, and the active-locale signal the language case moves. A fresh pair per test
 * keeps one case's calls and language out of the next.
 *
 * @param apiUrl The spy standing in for `AppConfigService.apiUrl`.
 * @param activeLocale The signal standing in for `AppConfigService.activeLocale`.
 */
function configSurface(
  apiUrl: Mock<(path: string) => string>,
  activeLocale: WritableSignal<string>,
): ConfigSurface {
  return {
    config: {
      apiBaseUrl: API_BASE_URL,
      apiPath: API_PATH,
      tenantId: 'default',
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
      idleMinutes: 30,
      warningSeconds: 10,
      keepaliveMinutes: 15,
    },
    apiUrl,
    activeLocale,
  };
}

/** The status object the client endpoints send, of which only `code` is ever read. */
const ACTIVE_STATUS = { id: 300, code: 'clientStatusType.active', value: 'Active' } as const;

/** One person, as `GET /clients` rows and `GET /clients/{id}` return it. */
const PERSON: Client = {
  id: CLIENT_ID,
  accountNo: '000000002',
  externalId: 'CL-002',
  displayName: 'Ada Okafor',
  firstname: 'Ada',
  lastname: 'Okafor',
  officeId: 1,
  officeName: 'Head Office',
  staffId: 7,
  staffName: 'Parity Officer',
  status: ACTIVE_STATUS,
  activationDate: [2026, 11, 21],
  timeline: { submittedOnDate: '2026-11-21', activatedOnDate: [2026, 11, 21] },
};

/** One entity, named through `fullname` alone — the other name set the endpoints send. */
const ENTITY: Client = {
  id: 5,
  accountNo: '000000005',
  displayName: 'Blitzy Bakery LLC',
  fullname: 'Blitzy Bakery LLC',
  officeId: 1,
  officeName: 'Head Office',
  status: ACTIVE_STATUS,
  activationDate: [2026, 11, 21],
  timeline: { submittedOnDate: '2026-11-21', activatedOnDate: [2026, 11, 21] },
};

/** The paged envelope `GET /clients` answers with, rather than a bare row list. */
const CLIENT_PAGE: ClientListPage = { totalFilteredRecords: 2, pageItems: [PERSON, ENTITY] };

/** The `GET /clients/template` answer the create form's dropdowns and defaults come from. */
const CLIENT_TEMPLATE: ClientTemplate = {
  officeId: 1,
  officeOptions: [
    { id: 1, name: 'Head Office' },
    { id: 2, name: 'Branch 01' },
  ],
  staffOptions: [{ id: 7, displayName: 'Officer, Parity' }],
  activationDate: [2026, 11, 21],
  datatables: [{ registeredTableName: 'client_extra_details' }],
};

/** The `GET /clients/template?commandParam=…` answer: reasons alone, in the server's order. */
const NARRATION_TEMPLATE: ClientNarrationTemplate = {
  narrations: [
    { id: 5, name: 'Client requested closure' },
    { id: 6, name: 'Moved to another institution' },
  ],
};

/** The `GET /clients/{id}/accounts` answer, grouped by account family. */
const ACCOUNT_SUMMARY: ClientAccountSummary = {
  loanAccounts: [
    {
      id: 31,
      accountNo: '000000031',
      productName: 'Parity Loan',
      status: ACTIVE_STATUS,
      loanBalance: 5000,
    },
  ],
  savingsAccounts: [
    {
      id: 41,
      accountNo: '000000041',
      productName: 'Parity Savings',
      status: ACTIVE_STATUS,
      accountBalance: 800,
    },
  ],
};

/** The `GET /clients/{id}/identifiers` answer: a JSON array, empty when the client has none. */
const IDENTIFIERS: readonly ClientIdentifier[] = [
  {
    id: 11,
    documentType: { id: 1, name: 'Passport' },
    documentKey: 'P1234567',
    description: 'Primary passport',
    status: 'Active',
  },
];

/** The `GET /clients/{id}/identifiers/template` answer: the tenant's document types. */
const IDENTIFIER_TEMPLATE: ClientIdentifierTemplate = {
  allowedDocumentTypes: [
    { id: 1, name: 'Passport' },
    { id: 2, name: 'National ID' },
  ],
};

/** The command result every write answers with, carrying the ids a screen navigates by. */
const MUTATION_RESULT: ClientMutationResponse = { resourceId: CLIENT_ID, clientId: CLIENT_ID };


/** The one case table of `GET /clients/template`, whose three branches differ only in its arguments. */
const TEMPLATE_CASES: readonly {
  readonly label: string;
  readonly args: readonly [officeId?: number, staffInSelectedOfficeOnly?: boolean];
  readonly params: readonly (readonly [string, string])[];
}[] = [
  { label: 'with no office, sending no parameter at all', args: [], params: [] },
  { label: 'with an office only', args: [1], params: [['officeId', '1']] },
  {
    label: 'with an office and the staff narrowing',
    args: [1, true],
    params: [
      ['officeId', '1'],
      ['staffInSelectedOfficeOnly', 'true'],
    ],
  },
];

/**
 * A person the create form posts: both names, both optional strings, an active record whose
 * submission and activation fall on the same day. The two dates are `Date | null` on the model and
 * become `dd MMMM yyyy` strings in the body.
 */
const PERSON_CREATE: ClientCreateRequest = {
  officeId: 1,
  legalFormId: 1,
  firstname: 'Ada',
  lastname: 'Okafor',
  externalId: 'CL-002',
  mobileNo: '2025550101',
  submittedOnDate: CLIENT_DATE,
  active: true,
  activationDate: CLIENT_DATE,
  dateFormat: FINERACT_DATE_FORMAT,
  locale: APP_LOCALE,
};

/** `PERSON_CREATE` as it must reach the server: every date a string, plus the date-format pair. */
const PERSON_CREATE_WIRE: Readonly<Record<string, unknown>> = {
  dateFormat: FINERACT_DATE_FORMAT,
  locale: APP_LOCALE,
  officeId: 1,
  legalFormId: 1,
  firstname: 'Ada',
  lastname: 'Okafor',
  externalId: 'CL-002',
  mobileNo: '2025550101',
  submittedOnDate: CLIENT_DATE_TEXT,
  active: true,
  activationDate: CLIENT_DATE_TEXT,
};

/**
 * The same person, with every optional member absent and both dates missing. The body must then
 * leave the optional strings out and send each date as `null`, so the server's own required-field
 * rules decide what is missing instead of an empty string standing in for a value.
 */
const UNDATED_CREATE: ClientCreateRequest = {
  officeId: 1,
  legalFormId: 1,
  firstname: 'Ada',
  lastname: 'Okafor',
  submittedOnDate: null,
  active: true,
  activationDate: null,
  dateFormat: FINERACT_DATE_FORMAT,
  locale: APP_LOCALE,
};

/** `UNDATED_CREATE` as it must reach the server. */
const UNDATED_CREATE_WIRE: Readonly<Record<string, unknown>> = {
  dateFormat: FINERACT_DATE_FORMAT,
  locale: APP_LOCALE,
  officeId: 1,
  legalFormId: 1,
  firstname: 'Ada',
  lastname: 'Okafor',
  submittedOnDate: null,
  active: true,
  activationDate: null,
};

/** An entity, which is named by `fullname` alone and carries no activation date while pending. */
const ENTITY_CREATE: ClientCreateRequest = {
  officeId: 1,
  legalFormId: 2,
  fullname: 'Blitzy Bakery LLC',
  externalId: 'ENT-001',
  submittedOnDate: CLIENT_DATE,
  active: false,
  dateFormat: FINERACT_DATE_FORMAT,
  locale: APP_LOCALE,
};

/** `ENTITY_CREATE` as it must reach the server: no individual name parts, no activation date. */
const ENTITY_CREATE_WIRE: Readonly<Record<string, unknown>> = {
  dateFormat: FINERACT_DATE_FORMAT,
  locale: APP_LOCALE,
  officeId: 1,
  legalFormId: 2,
  fullname: 'Blitzy Bakery LLC',
  externalId: 'ENT-001',
  submittedOnDate: CLIENT_DATE_TEXT,
  active: false,
};

/**
 * The same person, with a `locale` the caller picked. The service must ignore it and send the
 * active language, because the two members are filled at the API boundary and no screen sets them.
 */
const CALLER_LOCALE_CREATE: ClientCreateRequest = { ...PERSON_CREATE, locale: 'de' };

/**
 * The one case table of `PUT /clients/{id}`, whose two branches differ in the activation date.
 *
 * Each request is a `ClientEditInput`: the fields the edit screen holds, with no `dateFormat` or
 * `locale`, because the service fills both from the configuration at the boundary. The wire
 * expectations below still carry the pair, which is what proves it comes from the configuration and
 * not from the caller (AAP 0.7.2 "Date handling"; Rule 1 clause 2).
 */
const EDIT_CASES: readonly {
  readonly label: string;
  readonly request: ClientEditInput;
  readonly wire: Readonly<Record<string, unknown>>;
}[] = [
  {
    label: 'its names and external id only',
    request: {
      firstname: 'Ada',
      lastname: 'Okonkwo',
      externalId: 'CL-002',
    },
    wire: {
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
      firstname: 'Ada',
      lastname: 'Okonkwo',
      externalId: 'CL-002',
    },
  },
  {
    label: 'its activation date as well',
    request: {
      firstname: 'Ada',
      lastname: 'Okonkwo',
      activationDate: CLIENT_DATE,
    },
    wire: {
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
      firstname: 'Ada',
      lastname: 'Okonkwo',
      activationDate: CLIENT_DATE_TEXT,
    },
  },
  {
    // The remaining branch of the body builder: every optional member absent, so none of them
    // reaches the payload and the server alone decides what an edit needs.
    label: 'its activation date alone',
    request: {
      activationDate: CLIENT_DATE,
    },
    wire: {
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
      activationDate: CLIENT_DATE_TEXT,
    },
  },
  {
    label: 'an entity name and a mobile number',
    request: {
      fullname: 'Blitzy Bakery LLC',
      mobileNo: '2025550101',
    },
    wire: {
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
      fullname: 'Blitzy Bakery LLC',
      mobileNo: '2025550101',
    },
  },
];

/** The three commands that offer a configured reason list, and therefore read the template. */
const COMMAND_PARAM_VALUES: readonly Extract<ClientActionCommand, 'close' | 'reject' | 'withdraw'>[] =
  ['close', 'reject', 'withdraw'];

/**
 * The five lifecycle commands, each with the body its own command posts and the body that must
 * reach the server. Every request is a `ClientActionInput` — the fields the action screen holds, with
 * no `dateFormat` or `locale` — and every wire expectation carries the pair the service adds from the
 * configuration, so these cases prove the caller supplies neither member and the payload still does
 * (AAP 0.7.2 "Date handling"; Rule 1 clause 2). The reason ids are the ids
 * `GET /clients/template?commandParam=…` returns, never constants a screen invents.
 */
const ACTION_CASES: readonly {
  readonly command: ClientActionCommand;
  readonly request: ClientActionInput;
  readonly wire: Readonly<Record<string, unknown>>;
}[] = [
  {
    command: 'activate',
    request: {
      command: 'activate',
      activationDate: CLIENT_DATE,
    },
    wire: {
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
      activationDate: CLIENT_DATE_TEXT,
    },
  },
  {
    command: 'close',
    request: {
      command: 'close',
      closureDate: CLIENT_DATE,
      closureReasonId: 5,
    },
    wire: {
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
      closureDate: CLIENT_DATE_TEXT,
      closureReasonId: 5,
    },
  },
  {
    command: 'reject',
    request: {
      command: 'reject',
      rejectionDate: CLIENT_DATE,
      rejectionReasonId: 6,
    },
    wire: {
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
      rejectionDate: CLIENT_DATE_TEXT,
      rejectionReasonId: 6,
    },
  },
  {
    command: 'withdraw',
    request: {
      command: 'withdraw',
      withdrawalDate: CLIENT_DATE,
      withdrawalReasonId: 5,
    },
    wire: {
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
      withdrawalDate: CLIENT_DATE_TEXT,
      withdrawalReasonId: 5,
    },
  },
  {
    // The reactivation date is a member of the payload rather than an optional extra: the fork
    // validates it with `notNull` and refuses a blank body as invalid JSON, so the command posts the
    // date and the date-format pair beside it (Rule 1 clause 2).
    command: 'reactivate',
    request: {
      command: 'reactivate',
      reactivationDate: CLIENT_DATE,
    },
    wire: {
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
      reactivationDate: CLIENT_DATE_TEXT,
    },
  },
];

/**
 * The three commands whose reason member is posted only when a reason was chosen, each with the body
 * a tenant that configures no narration produces: the action's own date and the date-format pair the
 * service adds, and no reason member at all.
 *
 * `GET /clients/template?commandParam=<command>` may answer `{"isStaff":false,"narrations":[]}`, and
 * legacy posts these actions anyway with whatever its unvalidated reason select held — nothing — so
 * the member is left out entirely rather than sent as `undefined` or `null`, and Fineract's own
 * refusal is what the screen renders (Rule 1 clause 3; AAP 0.7.4).
 */
const UNREASONED_ACTION_CASES: readonly {
  readonly command: Extract<ClientActionCommand, 'close' | 'reject' | 'withdraw'>;
  readonly reasonKey: string;
  readonly request: ClientActionInput;
  readonly wire: Readonly<Record<string, unknown>>;
}[] = [
  {
    command: 'close',
    reasonKey: 'closureReasonId',
    request: {
      command: 'close',
      closureDate: CLIENT_DATE,
    },
    wire: {
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
      closureDate: CLIENT_DATE_TEXT,
    },
  },
  {
    command: 'reject',
    reasonKey: 'rejectionReasonId',
    request: {
      command: 'reject',
      rejectionDate: CLIENT_DATE,
    },
    wire: {
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
      rejectionDate: CLIENT_DATE_TEXT,
    },
  },
  {
    command: 'withdraw',
    reasonKey: 'withdrawalReasonId',
    request: {
      command: 'withdraw',
      withdrawalDate: CLIENT_DATE,
    },
    wire: {
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
      withdrawalDate: CLIENT_DATE_TEXT,
    },
  },
];

/**
 * The two write bodies `EDIT_CASES` and `ACTION_CASES` can only prove in English, because their
 * fixtures pin the language the suite starts in. Each case here moves the active language to French
 * before the call and expects the whole body, month name included, so a `locale` fixed at `'en'` in
 * `editWire` or in `actionWire` — or a date formatted with a fixed language while the member beside
 * it follows the selection — fails here, which an English fixture cannot show (AAP 0.7.2 "Date
 * handling"; Rule 1 clause 2).
 */
const LOCALISED_WRITE_CASES: readonly {
  readonly label: string;
  readonly method: 'PUT' | 'POST';
  readonly send: (service: ClientService) => Observable<ClientMutationResponse>;
  readonly params: readonly (readonly [string, string])[];
  readonly wire: Readonly<Record<string, unknown>>;
}[] = [
  {
    label: 'update',
    method: 'PUT',
    send: (service) =>
      service.update(CLIENT_ID, {
        firstname: 'Ada',
        lastname: 'Okonkwo',
        activationDate: CLIENT_DATE,
      }),
    params: [],
    wire: {
      dateFormat: FINERACT_DATE_FORMAT,
      locale: 'fr',
      firstname: 'Ada',
      lastname: 'Okonkwo',
      activationDate: CLIENT_DATE_TEXT_FR,
    },
  },
  {
    label: 'close action',
    method: 'POST',
    send: (service) =>
      service.action(CLIENT_ID, 'close', {
        command: 'close',
        closureDate: CLIENT_DATE,
        closureReasonId: 5,
      }),
    params: [['command', 'close']],
    wire: {
      dateFormat: FINERACT_DATE_FORMAT,
      locale: 'fr',
      closureDate: CLIENT_DATE_TEXT_FR,
      closureReasonId: 5,
    },
  },
];

describe('ClientService', () => {
  let service: ClientService;
  let httpMock: HttpTestingController;
  let apiUrl: Mock<(path: string) => string>;
  let activeLocale: WritableSignal<string>;

  beforeEach(() => {
    // A fresh spy and a fresh language per test, so one case's composition and its calls are never
    // read by the next case's assertions.
    apiUrl = vi.fn((path: string): string => API_ROOT + SEPARATOR + path);
    activeLocale = signal(APP_LOCALE);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AppConfigService, useValue: configSurface(apiUrl, activeLocale) },
      ],
    });

    service = TestBed.inject(ClientService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // A request the service issued but this spec never saw fails here, and so does one it should
    // have issued and did not.
    httpMock.verify();
  });

  it('reads one page of clients with offset and limit and no other parameter', () => {
    const received: ClientListPage[] = [];

    service.list({ offset: 0, limit: 25 }).subscribe((page) => received.push(page));

    // The service names only the resource path: the host and the API root belong to the
    // configuration, so it composes no URL of its own (AAP 0.4.2).
    expect(apiUrl).toHaveBeenCalledTimes(1);
    expect(apiUrl).toHaveBeenCalledWith('clients');

    const request = httpMock.expectOne(isRequest('GET', clientUrl('clients')));

    expect(request.request.params.keys()).toEqual(['offset', 'limit']);
    expect(request.request.params.get('offset')).toBe('0');
    expect(request.request.params.get('limit')).toBe('25');
    expect(request.request.body).toBeNull();

    request.flush(CLIENT_PAGE);

    expect(received).toEqual([CLIENT_PAGE]);
    expect(received[0]?.totalFilteredRecords).toBe(2);
    expect(received[0]?.pageItems).toHaveLength(2);
  });

  it('sends the optional list parameters only when a caller supplies them', () => {
    service
      .list({
        offset: 25,
        limit: 25,
        orderBy: 'displayName',
        sortOrder: 'ASC',
        searchText: 'Parity',
      })
      .subscribe();

    const request = httpMock.expectOne(isRequest('GET', clientUrl('clients')));

    expect(request.request.params.keys()).toEqual([
      'offset',
      'limit',
      'orderBy',
      'sortOrder',
      'searchText',
    ]);
    expect(request.request.params.get('offset')).toBe('25');
    expect(request.request.params.get('limit')).toBe('25');
    expect(request.request.params.get('orderBy')).toBe('displayName');
    expect(request.request.params.get('sortOrder')).toBe('ASC');
    expect(request.request.params.get('searchText')).toBe('Parity');

    request.flush({ totalFilteredRecords: 0, pageItems: [] });
  });

  for (const { label, args, params } of TEMPLATE_CASES) {
    it(`reads the create template ${label}`, () => {
      service.template(...args).subscribe();

      expect(apiUrl).toHaveBeenCalledWith('clients/template');

      const request = httpMock.expectOne(isRequest('GET', clientUrl('clients', 'template')));

      // The whole parameter set, in the order it is appended: a narrowing parameter can only be sent
      // together with the office it narrows (AAP 0.7.3 row "W2 create and activate client").
      expect(request.request.params.keys()).toEqual(params.map(([name]) => name));
      for (const [name, value] of params) {
        expect(request.request.params.get(name)).toBe(value);
      }

      request.flush(CLIENT_TEMPLATE);
    });
  }

  // The route parameter of `#/viewclient/:id` is a string, while every id the service writes is a
  // number; both forms must resolve to the one URL Fineract serves.
  for (const id of [CLIENT_ID, CLIENT_ID_TEXT] as const) {
    it(`reads one client by its ${typeof id} route parameter`, () => {
      const received: Client[] = [];

      service.get(id).subscribe((client) => received.push(client));

      expect(apiUrl).toHaveBeenCalledWith('clients/2');

      const request = httpMock.expectOne(isRequest('GET', clientUrl('clients', CLIENT_ID)));

      expect(request.request.params.keys()).toEqual([]);
      expect(request.request.body).toBeNull();

      request.flush(PERSON);

      expect(received).toEqual([PERSON]);
      expect(received[0]?.accountNo).toBe('000000002');
    });
  }

  it('reads the client record with template=true as its only parameter', () => {
    const received: ClientTemplate[] = [];

    service.getWithTemplate(CLIENT_ID).subscribe((template) => received.push(template));

    expect(apiUrl).toHaveBeenCalledWith('clients/2');

    const request = httpMock.expectOne(isRequest('GET', clientUrl('clients', CLIENT_ID)));

    expect(request.request.params.keys()).toEqual(['template']);
    expect(request.request.params.get('template')).toBe('true');

    request.flush(CLIENT_TEMPLATE);

    // The caller receives the record merged with its template, its option lists included, so a
    // projection that dropped, emptied or reordered them fails here as well as below.
    expect(received).toEqual([CLIENT_TEMPLATE]);
    expect(received[0]?.officeOptions.map((option) => option.name)).toEqual([
      'Head Office',
      'Branch 01',
    ]);
    expect(received[0]?.datatables).toHaveLength(1);
  });

  it('reads the client accounts grouped by family', () => {
    const received: ClientAccountSummary[] = [];

    service.accounts(CLIENT_ID).subscribe((summary) => received.push(summary));

    expect(apiUrl).toHaveBeenCalledWith('clients/2/accounts');

    const request = httpMock.expectOne(
      isRequest('GET', clientUrl('clients', CLIENT_ID, 'accounts')),
    );

    expect(request.request.params.keys()).toEqual([]);
    expect(request.request.body).toBeNull();

    request.flush(ACCOUNT_SUMMARY);

    expect(received).toEqual([ACCOUNT_SUMMARY]);
    expect(received[0]?.loanAccounts).toHaveLength(1);
    expect(received[0]?.savingsAccounts).toHaveLength(1);
  });

  it('reads the client identifiers as the array the endpoint answers with', () => {
    const received: (readonly ClientIdentifier[])[] = [];

    service.identifiers(CLIENT_ID).subscribe((identifiers) => received.push(identifiers));

    expect(apiUrl).toHaveBeenCalledWith('clients/2/identifiers');

    const request = httpMock.expectOne(
      isRequest('GET', clientUrl('clients', CLIENT_ID, 'identifiers')),
    );

    expect(request.request.params.keys()).toEqual([]);
    expect(request.request.body).toBeNull();

    request.flush(IDENTIFIERS);

    expect(received).toEqual([IDENTIFIERS]);
    expect(received[0]?.[0]?.documentType.name).toBe('Passport');
  });

  it('reads the identifier template as the document types the tenant allows', () => {
    const received: ClientIdentifierTemplate[] = [];

    service.identifiersTemplate(CLIENT_ID).subscribe((template) => received.push(template));

    expect(apiUrl).toHaveBeenCalledWith('clients/2/identifiers/template');

    const request = httpMock.expectOne(
      isRequest('GET', clientUrl('clients', CLIENT_ID, 'identifiers', 'template')),
    );

    expect(request.request.params.keys()).toEqual([]);

    request.flush(IDENTIFIER_TEMPLATE);

    // The types reach the caller under the member the tab reads and in the server's order, so a
    // projection that renamed, emptied or reordered `allowedDocumentTypes` fails here.
    expect(received).toEqual([IDENTIFIER_TEMPLATE]);
    expect(received[0]?.allowedDocumentTypes.map((type) => type.name)).toEqual([
      'Passport',
      'National ID',
    ]);
  });

  it('re-reads the record on every call, because its state changes through the commands this service posts', () => {
    service.get(CLIENT_ID).subscribe();
    service.get(CLIENT_ID).subscribe();

    const requests = httpMock.match(isRequest('GET', clientUrl('clients', CLIENT_ID)));

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      request.flush(PERSON);
    }
  });

  it('posts a client with every member the model carries, its dates as dd MMMM yyyy and the date-format pair', () => {
    const received: ClientMutationResponse[] = [];

    service.create(PERSON_CREATE).subscribe((result) => received.push(result));

    expect(apiUrl).toHaveBeenCalledWith('clients');

    const request = httpMock.expectOne(isRequest('POST', clientUrl('clients')));

    expect(request.request.params.keys()).toEqual([]);
    expect(request.request.body).toEqual(PERSON_CREATE_WIRE);

    // Spelled out as well as compared above: the two members every date-bearing payload carries are
    // what the server parses the dates with (AAP 0.7.2 "Date handling"; Rule 1 clause 2).
    expect(request.request.body).toMatchObject({
      dateFormat: 'dd MMMM yyyy',
      locale: 'en',
      submittedOnDate: '21 November 2026',
      activationDate: '21 November 2026',
    });

    request.flush(MUTATION_RESULT);

    expect(received).toEqual([MUTATION_RESULT]);
    expect(received[0]?.clientId).toBe(CLIENT_ID);
  });

  it('leaves an absent member out of the create body and sends a missing date as null', () => {
    service.create(UNDATED_CREATE).subscribe();

    const request = httpMock.expectOne(isRequest('POST', clientUrl('clients')));

    expect(request.request.body).toEqual(UNDATED_CREATE_WIRE);
    expect(bodyKeys(request.request)).not.toContain('externalId');
    expect(bodyKeys(request.request)).not.toContain('mobileNo');
    expect(bodyKeys(request.request)).not.toContain('fullname');
    expect(request.request.body.submittedOnDate).toBeNull();
    expect(request.request.body.activationDate).toBeNull();

    request.flush(MUTATION_RESULT);
  });

  it('posts an entity client by fullname with no individual name parts and no activation date', () => {
    service.create(ENTITY_CREATE).subscribe();

    const request = httpMock.expectOne(isRequest('POST', clientUrl('clients')));

    expect(request.request.body).toEqual(ENTITY_CREATE_WIRE);
    expect(bodyKeys(request.request)).not.toContain('firstname');
    expect(bodyKeys(request.request)).not.toContain('lastname');
    expect(bodyKeys(request.request)).not.toContain('activationDate');

    request.flush(MUTATION_RESULT);
  });

  it('fills the date-format pair from the configuration and the active language, never from the caller', () => {
    service.create(CALLER_LOCALE_CREATE).subscribe();

    const englishRequest = httpMock.expectOne(isRequest('POST', clientUrl('clients')));

    // The caller's own `locale` never reaches the body, and the English month name matches the
    // `locale` beside it.
    expect(englishRequest.request.body).toEqual(PERSON_CREATE_WIRE);
    englishRequest.flush(MUTATION_RESULT);

    activeLocale.set('fr');

    service.create(CALLER_LOCALE_CREATE).subscribe();

    const frenchRequest = httpMock.expectOne(isRequest('POST', clientUrl('clients')));

    // A language selected after startup reaches the next payload, month names included, so the value
    // and the `locale` beside it describe the same language (AAP 0.7.2 "Date handling").
    expect(frenchRequest.request.body).toEqual({
      ...PERSON_CREATE_WIRE,
      locale: 'fr',
      submittedOnDate: CLIENT_DATE_TEXT_FR,
      activationDate: CLIENT_DATE_TEXT_FR,
    });

    frenchRequest.flush(MUTATION_RESULT);
  });

  for (const { label, method, send, params, wire } of LOCALISED_WRITE_CASES) {
    it(`fills the ${label} body's date-format pair from the active language, never from a fixed language`, () => {
      const received: ClientMutationResponse[] = [];

      // The language is selected before the call, because the body is built when the service method
      // runs and not when the caller subscribed; the two members and the month names of that body are
      // then asserted together, so a `locale` that does not follow the selection fails here.
      activeLocale.set('fr');

      send(service).subscribe((result) => received.push(result));

      const sent = httpMock.expectOne(isRequest(method, clientUrl('clients', CLIENT_ID)));

      expect(sent.request.params.keys()).toEqual(params.map(([name]) => name));
      for (const [name, value] of params) {
        expect(sent.request.params.get(name)).toBe(value);
      }
      expect(sent.request.body).toEqual(wire);

      sent.flush(MUTATION_RESULT);

      expect(received).toEqual([MUTATION_RESULT]);
    });
  }

  it('sets no authorization and no tenant header, because both belong to the HTTP interceptor', () => {
    service.create(PERSON_CREATE).subscribe();

    const request = httpMock.expectOne(isRequest('POST', clientUrl('clients')));
    const names = request.request.headers.keys().map((name) => name.toLowerCase());

    expect(names).not.toContain('authorization');
    expect(names).not.toContain('fineract-platform-tenantid');
    expect(names).toEqual([]);

    request.flush(MUTATION_RESULT);
  });

  for (const { label, request: edit, wire } of EDIT_CASES) {
    it(`updates a client with ${label}`, () => {
      service.update(CLIENT_ID, edit).subscribe();

      expect(apiUrl).toHaveBeenCalledWith('clients/2');

      const sent = httpMock.expectOne(isRequest('PUT', clientUrl('clients', CLIENT_ID)));

      expect(sent.request.params.keys()).toEqual([]);
      expect(sent.request.body).toEqual(wire);

      // The update endpoint refuses an office and keeps the submission date, so neither is posted
      // (client.models.ts, `ClientEditRequest`).
      expect(bodyKeys(sent.request)).not.toContain('officeId');
      expect(bodyKeys(sent.request)).not.toContain('submittedOnDate');

      sent.flush(MUTATION_RESULT);
    });
  }

  for (const action of COMMAND_PARAM_VALUES) {
    it(`reads the ${action} reasons from the template endpoint`, () => {
      service.commandParam(action).subscribe();

      expect(apiUrl).toHaveBeenCalledWith('clients/template');

      const request = httpMock.expectOne(isRequest('GET', clientUrl('clients', 'template')));

      // One parameter and nothing else, so the endpoint answers with narrations rather than with a
      // client template (AAP 0.7.3 row "Client actions").
      expect(request.request.params.keys()).toEqual(['commandParam']);
      expect(request.request.params.get('commandParam')).toBe(action);
      expect(request.request.body).toBeNull();

      request.flush(NARRATION_TEMPLATE);
    });
  }

  for (const { command, request: body, wire } of ACTION_CASES) {
    it(`posts the ${command} command with its own body and one command parameter`, () => {
      const received: ClientMutationResponse[] = [];

      service.action(CLIENT_ID, command, body).subscribe((result) => received.push(result));

      expect(apiUrl).toHaveBeenCalledWith('clients/2');

      const sent = httpMock.expectOne(isRequest('POST', clientUrl('clients', CLIENT_ID)));

      expect(sent.request.params.keys()).toEqual(['command']);
      expect(sent.request.params.get('command')).toBe(command);
      expect(sent.request.body).toEqual(wire);
      expect(sent.request.body).toMatchObject({ dateFormat: 'dd MMMM yyyy', locale: 'en' });

      sent.flush(MUTATION_RESULT);

      expect(received).toEqual([MUTATION_RESULT]);
    });
  }

  it('sends a missing action date as null rather than omitting the member', () => {
    service
      .action(CLIENT_ID, 'withdraw', {
        command: 'withdraw',
        withdrawalDate: null,
        withdrawalReasonId: 5,
      })
      .subscribe();

    const sent = httpMock.expectOne(isRequest('POST', clientUrl('clients', CLIENT_ID)));

    // The server's own required-field message is what the screen shows, so the absence of the date
    // travels as `null` and is never replaced by a date this application invented.
    expect(sent.request.body).toEqual({
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
      withdrawalDate: null,
      withdrawalReasonId: 5,
    });

    sent.flush(MUTATION_RESULT);
  });

  for (const { command, reasonKey, request: body, wire } of UNREASONED_ACTION_CASES) {
    it(`posts a ${command} with no reason chosen and sends no reason member at all`, () => {
      service.action(CLIENT_ID, command, body).subscribe();

      const sent = httpMock.expectOne(isRequest('POST', clientUrl('clients', CLIENT_ID)));

      expect(sent.request.params.get('command')).toBe(command);
      expect(sent.request.body).toEqual(wire);

      // `toEqual` ignores a member whose value is `undefined`, so the absence is asserted on the key
      // list: the body carries no reason member to send at all.
      expect(bodyKeys(sent.request)).not.toContain(reasonKey);

      sent.flush(MUTATION_RESULT);
    });
  }

  it('refuses a body that describes another command and issues no request', () => {
    const closure: ClientActionInput = {
      command: 'close',
      closureDate: CLIENT_DATE,
      closureReasonId: 5,
    };

    // The command travels in the query string and the body describes the action, so a mismatch would
    // post one action's payload to another action's endpoint. It is refused before any request.
    expect(() => service.action(CLIENT_ID, 'activate', closure)).toThrowError(
      /describes the 'close' command but the request issues 'activate'/,
    );
    httpMock.expectNone(isRequest('POST', clientUrl('clients', CLIENT_ID)));
  });

  it('refuses a crafted route id with the guard message and issues no request at all', () => {
    // The router hands an `:id` over URL-decoded, so this value reaches the service as a path that
    // would leave `/api/v1` and read another resource on the same host (CWE-20, CWE-22). The refusal
    // arrives as an observable error, which is the form every caller of this service already handles
    // (`firstValueFrom` inside a `try`, or a `catchError` beside it) — `defer` is what makes the
    // invalid id an error value rather than an exception thrown out of a `switchMap` projection.
    const crafted = '../../../users';
    let message = '';
    let emissions = 0;

    service.get(crafted).subscribe({
      next: () => (emissions += 1),
      error: (failure: unknown) => {
        message = failure instanceof Error ? failure.message : String(failure);
      },
    });

    expect(emissions).toBe(0);
    expect(message).toContain(`'${crafted}'`);
    expect(message).toContain('ClientService.get');
    // Nothing was sent: no read of the family this call owns, and no request of any other shape. The
    // teardown's `verify()` states the same expectation for the whole case.
    httpMock.expectNone(isRequest('GET', clientUrl('clients', crafted)));
    httpMock.expectNone(() => true);
  });
});

