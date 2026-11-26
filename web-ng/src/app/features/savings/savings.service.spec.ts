import { provideHttpClient, type HttpErrorResponse, type HttpRequest } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { AppConfigService } from '../../core/config/app-config.service';
import type {
  SavingsAccount,
  SavingsCommand,
  SavingsTemplate,
  SavingsTransactionCommand,
  SavingsTransactionTemplate,
} from './savings.models';
import {
  SavingsService,
  type SavingsActionInput,
  type SavingsApplicationInput,
  type SavingsCreateResult,
  type SavingsTransactionInput,
} from './savings.service';

/**
 * Contract spec for `SavingsService`: the one place the savings family composes a Fineract URL and
 * turns a model into a payload (Rule 1 clause 8; AAP 0.7.3 row "W8 savings (Stretch)"; AAP 0.7.1
 * `savings` row; AAP 0.11.1 row for this path).
 *
 * Every public method is pinned against the real `HttpTestingController` transport, so the
 * assertions are on the request the application actually sends — method, path, the whole parameter
 * set and the whole body — and never on a stand-in for `HttpClient`. Four properties are asserted
 * for each call beyond its shape:
 *
 *   - the date-format pair. Every date-bearing body carries `dateFormat: 'dd MMMM yyyy'` and the
 *     active `locale`, and every date member is the string `toFineractDate` produced, never a `Date`
 *     (AAP 0.7.2 "Date handling"; Rule 1 clause 2). A field that held no date travels as `null`, so
 *     the server's own required-field rule reports the absence (Rule 1 clause 3).
 *   - the two command spellings. The account endpoint takes `approve`/`activate` and the
 *     transactions endpoint takes `deposit`/`withdrawal`, and neither is normalised into the other;
 *     the command travels in the query string and never in the body (AAP 0.7.3; AAP 0.8.2).
 *   - the host. Each URL is composed by `AppConfigService.apiUrl()`, which this spec stubs and spies
 *     on, so a service that built its own host would fail here (AAP 0.4.2; Rule 2).
 *   - the absent header. Neither the authorization nor the tenant header is set here; both belong to
 *     `core/http/fineract.interceptor.ts` (AAP 0.4.2).
 *
 * The transport is registered without the application's interceptor, because the interceptor is
 * what adds those headers: a request asserted here is the service's own contribution to it.
 *
 * The `AppConfigService` stub is a fixed, non-secret configuration whose `apiUrl()` composes exactly
 * as the real one documents, so an expected URL and a requested URL are built the same way. The
 * resolution of `apiBaseUrl` and `apiPath` is proved in `core/config/app-config.service.spec.ts`.
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

/** The client the account is opened for, and the account every later case acts on. */
const CLIENT_ID = 2;
const ACCOUNT_ID = 41;
const ACCOUNT_ID_TEXT = '41';

/** The savings product the account is opened on. */
const PRODUCT_ID = 1;

/** The payment type the deposit and withdrawal forms post, from the transaction template. */
const PAYMENT_TYPE_ID = 1;

/**
 * The submitted-on date the new-application screen holds as a `Date`, built from its local calendar
 * parts so the expected string below cannot shift with the machine's time zone (AAP 0.7.2).
 */
const SUBMITTED_DATE = new Date(2026, 10, 21);

/** That date as every date-bearing payload must carry it: `dd MMMM yyyy` in the active locale. */
const SUBMITTED_TEXT = '21 November 2026';

/** The same date in French, for the case that proves the payload follows the selected language. */
const SUBMITTED_TEXT_FR = '21 novembre 2026';

/** The date the two lifecycle actions are recorded on. */
const ACTION_DATE = new Date(2026, 10, 24);
const ACTION_TEXT = '24 November 2026';

/**
 * The URL the service must request for the given path segments: the API root the configuration
 * supplies and the resource segments the service owns, joined with one separator.
 *
 * @param segments Resource segments, exactly as `savings.service.ts` names them.
 */
function savingsUrl(...segments: readonly (string | number)[]): string {
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

/** The members of a request body, so a case can prove a member was left out or sent as `null`. */
function bodyKeys(request: HttpRequest<unknown>): string[] {
  const body: unknown = request.body;

  return typeof body === 'object' && body !== null ? Object.keys(body) : [];
}

/**
 * The `AppConfigService` surface `SavingsService` uses: the resolved configuration, the URL
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
      tenantId: 'default',
      apiPath: API_PATH,
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

/** The `GET /savingsaccounts/template` answer the new-application screen binds its pickers to. */
const SAVINGS_TEMPLATE: SavingsTemplate = {
  clientId: CLIENT_ID,
  productOptions: [{ id: PRODUCT_ID, name: 'Parity Savings' }],
  fieldOfficerOptions: [{ id: 7, displayName: 'Officer, Parity' }],
  submittedOnDate: [2026, 11, 21],
};

/** The same template once a product is chosen: the product-dependent defaults are echoed back. */
const PRODUCT_TEMPLATE: SavingsTemplate = {
  ...SAVINGS_TEMPLATE,
  savingsProductId: PRODUCT_ID,
};

/** The envelope `POST /savingsaccounts` answers with: the id of the account just created. */
const CREATE_RESULT: SavingsCreateResult = { resourceId: ACCOUNT_ID };

/** The `GET /savingsaccounts/{id}?associations=all` answer the record page renders. */
const SAVINGS_ACCOUNT: SavingsAccount = {
  id: ACCOUNT_ID,
  accountNo: '000000041',
  clientId: CLIENT_ID,
  clientName: 'Ada Okafor',
  savingsProductId: PRODUCT_ID,
  savingsProductName: 'Parity Savings',
  status: { id: 300, code: 'savingsAccountStatusType.active', value: 'Active' },
  summary: { accountBalance: 800, totalDeposits: 1000, totalWithdrawals: 200 },
  transactions: [
    {
      id: 61,
      date: [2026, 11, 24],
      transactionType: { id: 2, code: 'savingsAccountTransactionType.deposit', value: 'Deposit' },
      amount: 1000,
      runningBalance: 1000,
    },
    {
      id: 62,
      date: [2026, 11, 24],
      transactionType: { id: 3, code: 'savingsAccountTransactionType.withdrawal', value: 'Withdrawal' },
      amount: 200,
      runningBalance: 800,
    },
  ],
};

/** The `GET /savingsaccounts/{id}/transactions/template` answer: the payment types a form posts. */
const TRANSACTION_TEMPLATE: SavingsTransactionTemplate = {
  paymentTypeOptions: [{ id: PAYMENT_TYPE_ID, name: 'Cash' }],
};

/** The new-application body the form collects: the model without the two format members. */
const APPLICATION: SavingsApplicationInput = {
  clientId: CLIENT_ID,
  productId: PRODUCT_ID,
  submittedOnDate: SUBMITTED_DATE,
};

/** `APPLICATION` as it must reach the server, with the date formatted and the format pair beside it. */
const APPLICATION_WIRE: Readonly<Record<string, unknown>> = {
  clientId: CLIENT_ID,
  productId: PRODUCT_ID,
  submittedOnDate: SUBMITTED_TEXT,
  dateFormat: FINERACT_DATE_FORMAT,
  locale: APP_LOCALE,
};

/**
 * The two lifecycle actions, each with the body its own command posts and the body that must reach
 * the server. They differ in the date member and in the command's wire spelling (AAP 0.7.3 W8).
 */
const ACTION_CASES: readonly {
  readonly command: SavingsCommand;
  readonly request: SavingsActionInput;
  readonly member: string;
  readonly wire: Readonly<Record<string, unknown>>;
}[] = [
  {
    command: 'approve',
    request: { approvedOnDate: ACTION_DATE },
    member: 'approvedOnDate',
    wire: {
      approvedOnDate: ACTION_TEXT,
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    },
  },
  {
    command: 'activate',
    request: { activatedOnDate: ACTION_DATE },
    member: 'activatedOnDate',
    wire: {
      activatedOnDate: ACTION_TEXT,
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    },
  },
];

/**
 * The commands paired with the other command's date member, which `action()` must refuse before it
 * issues any request: a pair that disagrees would post one action's payload to the other action's
 * command (see `actionBody()`).
 */
const MISMATCHED_ACTION_CASES: readonly {
  readonly label: string;
  readonly command: SavingsCommand;
  readonly request: SavingsActionInput;
  readonly message: RegExp;
}[] = [
  {
    label: 'an approve command given an activation date',
    command: 'approve',
    request: { activatedOnDate: ACTION_DATE },
    message: /carries activatedOnDate, so the command must be activate/,
  },
  {
    label: 'an activate command given an approval date',
    command: 'activate',
    request: { approvedOnDate: ACTION_DATE },
    message: /carries approvedOnDate, so the command must be approve/,
  },
];

/** One cash transaction as the deposit and withdrawal form collects it. */
const TRANSACTION: SavingsTransactionInput = {
  transactionDate: ACTION_DATE,
  transactionAmount: 1000,
  paymentTypeId: PAYMENT_TYPE_ID,
};

/** The two cash commands, each with the body that must reach the server. */
const TRANSACTION_CASES: readonly {
  readonly command: SavingsTransactionCommand;
  readonly request: SavingsTransactionInput;
  readonly wire: Readonly<Record<string, unknown>>;
}[] = [
  {
    command: 'deposit',
    request: TRANSACTION,
    wire: {
      transactionDate: ACTION_TEXT,
      transactionAmount: 1000,
      paymentTypeId: PAYMENT_TYPE_ID,
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    },
  },
  {
    command: 'withdrawal',
    request: { ...TRANSACTION, transactionAmount: 200 },
    wire: {
      transactionDate: ACTION_TEXT,
      transactionAmount: 200,
      paymentTypeId: PAYMENT_TYPE_ID,
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    },
  },
];

/**
 * The two branches of `GET /savingsaccounts/template`, which differ only in whether the product is
 * known: the client-only read and the client-and-product read stay the two distinct calls the
 * legacy form makes (AAP 0.7.3 W8 row).
 */
const TEMPLATE_CASES: readonly {
  readonly label: string;
  readonly args: readonly [clientId: number | string, productId?: number | string];
  readonly params: readonly (readonly [string, string])[];
  readonly answer: SavingsTemplate;
}[] = [
  {
    label: 'the client alone, so the product picker fills',
    args: [CLIENT_ID],
    params: [['clientId', String(CLIENT_ID)]],
    answer: SAVINGS_TEMPLATE,
  },
  {
    label: 'the client and the chosen product, so its defaults are echoed back',
    args: [CLIENT_ID, PRODUCT_ID],
    params: [
      ['clientId', String(CLIENT_ID)],
      ['productId', String(PRODUCT_ID)],
    ],
    answer: PRODUCT_TEMPLATE,
  },
];

/**
 * One call of each of the service's five public methods, with the arguments that method needs, so a
 * single case can prove that none of them composes anything before it is subscribed (Rule 1 clause 8;
 * AAP 0.7.2 "Date handling").
 *
 * @param service The service under test, built by the case's own `TestBed`.
 */
function callsOf(
  service: SavingsService,
): readonly { readonly label: string; readonly call: () => Observable<unknown> }[] {
  return [
    { label: 'template()', call: () => service.template(CLIENT_ID) },
    { label: 'create()', call: () => service.create(APPLICATION) },
    { label: 'get()', call: () => service.get(ACCOUNT_ID) },
    {
      label: 'action()',
      call: () => service.action(ACCOUNT_ID, 'approve', { approvedOnDate: ACTION_DATE }),
    },
    { label: 'transaction()', call: () => service.transaction(ACCOUNT_ID, 'deposit', TRANSACTION) },
  ];
}

describe('SavingsService', () => {
  let service: SavingsService;
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

    service = TestBed.inject(SavingsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // A request the service issued but this spec never saw fails here, and so does one it should
    // have issued and did not.
    httpMock.verify();
  });

  for (const { label, args, params, answer } of TEMPLATE_CASES) {
    it(`reads the savings template for ${label}`, () => {
      const received: SavingsTemplate[] = [];

      service.template(...args).subscribe((template) => received.push(template));

      // The service names only the resource path: the host and the API root belong to the
      // configuration, so it composes no URL of its own (AAP 0.4.2).
      expect(apiUrl).toHaveBeenCalledWith('savingsaccounts/template');

      const request = httpMock.expectOne(
        isRequest('GET', savingsUrl('savingsaccounts', 'template')),
      );

      // The whole parameter set, in the order it is appended: an absent `productId` leaves the
      // parameter off the URL entirely rather than sending an empty one.
      expect(request.request.params.keys()).toEqual(params.map(([name]) => name));
      for (const [name, value] of params) {
        expect(request.request.params.get(name)).toBe(value);
      }
      expect(request.request.body).toBeNull();

      request.flush(answer);

      // The payload is returned untouched: no option list is filtered, sorted or renamed here
      // (Rule 1 clause 3).
      expect(received).toEqual([answer]);
    });
  }

  it('opens the account with the submitted-on date formatted and the date-format pair', () => {
    const received: SavingsCreateResult[] = [];

    service.create(APPLICATION).subscribe((result) => received.push(result));

    expect(apiUrl).toHaveBeenCalledWith('savingsaccounts');

    const request = httpMock.expectOne(isRequest('POST', savingsUrl('savingsaccounts')));

    // No query parameter: the create endpoint takes its body alone (AAP 0.7.3 W8 row).
    expect(request.request.params.keys()).toEqual([]);
    expect(request.request.body).toEqual(APPLICATION_WIRE);

    // Spelled out as well as compared above: the two members every date-bearing payload carries are
    // what the server parses the date with (AAP 0.7.2 "Date handling"; Rule 1 clause 2).
    expect(request.request.body).toMatchObject({
      submittedOnDate: '21 November 2026',
      dateFormat: 'dd MMMM yyyy',
      locale: 'en',
    });

    request.flush(CREATE_RESULT);

    expect(received).toEqual([CREATE_RESULT]);
    expect(received[0]?.resourceId).toBe(ACCOUNT_ID);
  });

  it('sends a missing submitted-on date as null rather than omitting it', () => {
    service.create({ ...APPLICATION, submittedOnDate: null }).subscribe();

    const request = httpMock.expectOne(isRequest('POST', savingsUrl('savingsaccounts')));

    // The member is present and empty, so the server's own required-field rule reports the absence
    // instead of a date this application invented (Rule 1 clause 3).
    expect(bodyKeys(request.request)).toContain('submittedOnDate');
    expect(request.request.body.submittedOnDate).toBeNull();
    expect(request.request.body).toEqual({
      clientId: CLIENT_ID,
      productId: PRODUCT_ID,
      submittedOnDate: null,
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    });

    request.flush(CREATE_RESULT);
  });

  it('fills the date-format pair from the configuration and the active language, never from the caller', () => {
    service.create(APPLICATION).subscribe();

    const englishRequest = httpMock.expectOne(isRequest('POST', savingsUrl('savingsaccounts')));

    // The English month name matches the `locale` beside it.
    expect(englishRequest.request.body).toEqual(APPLICATION_WIRE);
    englishRequest.flush(CREATE_RESULT);

    activeLocale.set('fr');

    service.create(APPLICATION).subscribe();

    const frenchRequest = httpMock.expectOne(isRequest('POST', savingsUrl('savingsaccounts')));

    // A language selected after startup reaches the next payload, month names included, so the value
    // and the `locale` beside it describe the same language (AAP 0.7.2 "Date handling").
    expect(frenchRequest.request.body).toEqual({
      ...APPLICATION_WIRE,
      locale: 'fr',
      submittedOnDate: SUBMITTED_TEXT_FR,
    });

    frenchRequest.flush(CREATE_RESULT);
  });

  for (const id of [ACCOUNT_ID, ACCOUNT_ID_TEXT] as const) {
    it(`reads the account record by its ${typeof id} route parameter with associations=all`, () => {
      const received: SavingsAccount[] = [];

      service.get(id).subscribe((account) => received.push(account));

      expect(apiUrl).toHaveBeenCalledWith('savingsaccounts/41');

      const request = httpMock.expectOne(isRequest('GET', savingsUrl('savingsaccounts', ACCOUNT_ID)));

      // One parameter, because one request carries the status, the summary and the transaction list
      // the record page renders (AAP 0.7.3 W8 row; AAP 0.7.1 `savings` row).
      expect(request.request.params.keys()).toEqual(['associations']);
      expect(request.request.params.get('associations')).toBe('all');
      expect(request.request.body).toBeNull();

      request.flush(SAVINGS_ACCOUNT);

      expect(received).toEqual([SAVINGS_ACCOUNT]);
      // The balance is the server's figure, never arithmetic performed in the browser (AAP 0.10.1 W8).
      expect(received[0]?.summary.accountBalance).toBe(800);
      expect(received[0]?.transactions).toHaveLength(2);
    });
  }

  for (const { command, request: body, member, wire } of ACTION_CASES) {
    it(`posts the ${command} command with its own body and one command parameter`, () => {
      const received: void[] = [];

      service.action(ACCOUNT_ID, command, body).subscribe((result) => received.push(result));

      expect(apiUrl).toHaveBeenCalledWith('savingsaccounts/41');

      const sent = httpMock.expectOne(
        isRequest('POST', savingsUrl('savingsaccounts', ACCOUNT_ID)),
      );

      expect(sent.request.params.keys()).toEqual(['command']);
      expect(sent.request.params.get('command')).toBe(command);
      expect(sent.request.body).toEqual(wire);
      // The command travels in the query string and never in the body, exactly as the legacy
      // resource call sends it (AAP 0.7.3; Rule 1 clause 2).
      expect(bodyKeys(sent.request)).toEqual([member, 'dateFormat', 'locale']);

      sent.flush({});

      // The response body is discarded: the caller returns to the record, whose own read shows the
      // account's new status (AAP 0.7.3 W8 row).
      expect(received).toEqual([undefined]);
    });
  }

  for (const { label, command, request: body, message } of MISMATCHED_ACTION_CASES) {
    it(`refuses ${label} and issues no request`, () => {
      // A pair that disagrees is a mistake in the screen's code rather than something the server can
      // be asked about, and refusing it is what keeps one click to one POST (AAP 0.1.1). The refusal
      // arrives as an observable error — `action()` runs the pair check inside its `defer` — so a
      // caller that handles only the `error` notification still sees it (AAP 0.14.1).
      const messages: string[] = [];
      let emissions = 0;

      service.action(ACCOUNT_ID, command, body).subscribe({
        next: () => (emissions += 1),
        error: (failure: unknown) => {
          messages.push(failure instanceof Error ? failure.message : String(failure));
        },
      });

      expect(emissions).toBe(0);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatch(message);
      httpMock.expectNone(isRequest('POST', savingsUrl('savingsaccounts', ACCOUNT_ID)));
      // Stronger than the one path above: the pair check runs before the URL is composed, so the
      // controller saw no request of any method or URL for this call.
      httpMock.expectNone(() => true);
    });
  }

  it('sends a missing action date as null rather than omitting it', () => {
    service.action(ACCOUNT_ID, 'approve', { approvedOnDate: null }).subscribe();

    const sent = httpMock.expectOne(
      isRequest('POST', savingsUrl('savingsaccounts', ACCOUNT_ID)),
    );

    expect(sent.request.params.get('command')).toBe('approve');
    expect(sent.request.body).toEqual({
      approvedOnDate: null,
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    });

    sent.flush({});
  });

  it('reads the transaction template with no parameter at all', () => {
    const received: SavingsTransactionTemplate[] = [];

    service
      .transactionTemplate(ACCOUNT_ID)
      .subscribe((template) => received.push(template));

    expect(apiUrl).toHaveBeenCalledWith('savingsaccounts/41/transactions/template');

    const request = httpMock.expectOne(
      isRequest('GET', savingsUrl('savingsaccounts', ACCOUNT_ID, 'transactions', 'template')),
    );

    // The account is the path, and both commands read this one template (AAP 0.7.3 W8 row).
    expect(request.request.params.keys()).toEqual([]);
    expect(request.request.body).toBeNull();

    request.flush(TRANSACTION_TEMPLATE);

    expect(received).toEqual([TRANSACTION_TEMPLATE]);
    expect(received[0]?.paymentTypeOptions[0]?.name).toBe('Cash');
  });

  for (const { command, request: body, wire } of TRANSACTION_CASES) {
    it(`records a ${command} with the endpoint's own command spelling and the date-format pair`, () => {
      const received: void[] = [];

      service.transaction(ACCOUNT_ID, command, body).subscribe((result) => received.push(result));

      expect(apiUrl).toHaveBeenCalledWith('savingsaccounts/41/transactions');

      const sent = httpMock.expectOne(
        isRequest('POST', savingsUrl('savingsaccounts', ACCOUNT_ID, 'transactions')),
      );

      // `withdrawal` on the wire, never the `withdraw` the route segment spells (AAP 0.8.2).
      expect(sent.request.params.keys()).toEqual(['command']);
      expect(sent.request.params.get('command')).toBe(command);
      expect(sent.request.body).toEqual(wire);
      expect(sent.request.body).toMatchObject({
        dateFormat: 'dd MMMM yyyy',
        locale: 'en',
        transactionDate: '24 November 2026',
      });

      sent.flush({});

      expect(received).toEqual([undefined]);
    });
  }

  it('sends a missing transaction date as null rather than omitting it', () => {
    service
      .transaction(ACCOUNT_ID, 'deposit', { ...TRANSACTION, transactionDate: null })
      .subscribe();

    const sent = httpMock.expectOne(
      isRequest('POST', savingsUrl('savingsaccounts', ACCOUNT_ID, 'transactions')),
    );

    expect(sent.request.body).toEqual({
      transactionDate: null,
      transactionAmount: 1000,
      paymentTypeId: PAYMENT_TYPE_ID,
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    });

    sent.flush({});
  });

  it('sends a missing payment type as null rather than omitting it', () => {
    service
      .transaction(ACCOUNT_ID, 'deposit', { ...TRANSACTION, paymentTypeId: null })
      .subscribe();

    const sent = httpMock.expectOne(
      isRequest('POST', savingsUrl('savingsaccounts', ACCOUNT_ID, 'transactions')),
    );

    // The form named no payment type, so the member is present and empty: the server's own
    // required-field rule reports the absence, and no id this application invented reaches the
    // request body (Rule 1 clause 3, AAP 0.4.4 decision 6).
    expect(bodyKeys(sent.request)).toContain('paymentTypeId');
    expect(sent.request.body.paymentTypeId).toBeNull();
    expect(sent.request.body).toEqual({
      transactionDate: ACTION_TEXT,
      transactionAmount: 1000,
      paymentTypeId: null,
      dateFormat: FINERACT_DATE_FORMAT,
      locale: APP_LOCALE,
    });

    sent.flush({});
  });

  it('sets no authorization and no tenant header, because both belong to the HTTP interceptor', () => {
    service.create(APPLICATION).subscribe();

    const request = httpMock.expectOne(isRequest('POST', savingsUrl('savingsaccounts')));
    const names = request.request.headers.keys().map((name) => name.toLowerCase());

    expect(names).not.toContain('authorization');
    expect(names).not.toContain('fineract-platform-tenantid');
    expect(names).toEqual([]);

    request.flush(CREATE_RESULT);
  });

  it('propagates a failed record read unchanged, so the interceptor can map the message the screen shows', () => {
    const received: SavingsAccount[] = [];
    const failures: HttpErrorResponse[] = [];
    const refusal = { defaultUserMessage: 'The savings account could not be read' };

    service.get(ACCOUNT_ID).subscribe({
      next: (account) => received.push(account),
      error: (failure: HttpErrorResponse) => failures.push(failure),
    });

    httpMock
      .expectOne(isRequest('GET', savingsUrl('savingsaccounts', ACCOUNT_ID)))
      .flush(refusal, { status: 404, statusText: 'Not Found' });

    // One failure, no emission and no completion: the service maps nothing and swallows nothing, and
    // the status and body it hands on are the ones Fineract sent rather than a failure re-created in
    // the service, so the screen can render the not-found message in place of the record (AAP 0.7.4,
    // AAP 0.4.2, AAP 0.14.2 "Error handling").
    expect(failures).toHaveLength(1);
    expect(received).toEqual([]);
    expect(failures[0]?.status).toBe(404);
    expect(failures[0]?.error).toEqual(refusal);
  });

  it('re-reads the record on every call, because its state changes through the commands this service posts', () => {
    service.get(ACCOUNT_ID).subscribe();
    service.get(ACCOUNT_ID).subscribe();

    const requests = httpMock.match(isRequest('GET', savingsUrl('savingsaccounts', ACCOUNT_ID)));

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      request.flush(SAVINGS_ACCOUNT);
    }
  });

  it('composes no request until its observable is subscribed, then issues exactly that one', () => {
    for (const { label, call } of callsOf(service)) {
      apiUrl.mockClear();

      const composed = call();

      // Nothing at call time: neither the configuration's URL — which throws until it has resolved —
      // nor the active locale, nor the transport has been touched (AAP 0.7.2 "Date handling").
      expect(apiUrl, label).not.toHaveBeenCalled();
      httpMock.expectNone(() => true);

      const subscription = composed.subscribe();
      const request = httpMock.expectOne(() => true);

      // The whole request — URL, parameters and body — is composed from the subscription onwards.
      expect(apiUrl, label).toHaveBeenCalledTimes(1);

      request.flush({});
      subscription.unsubscribe();
    }
  });

  it('reads the active language when the request is subscribed, not when the method is called', () => {
    // The call is made while English is the active language…
    const composed = service.create(APPLICATION);

    // …and the user switches language before anything is subscribed.
    activeLocale.set('fr');

    composed.subscribe();

    const request = httpMock.expectOne(isRequest('POST', savingsUrl('savingsaccounts')));

    // The body carries the language in force at subscribe time, month name included, so the value and
    // the `locale` beside it describe the same language (AAP 0.7.2 "Date handling").
    expect(request.request.body).toEqual({
      ...APPLICATION_WIRE,
      locale: 'fr',
      submittedOnDate: SUBMITTED_TEXT_FR,
    });

    request.flush(CREATE_RESULT);
  });

  it('refuses a crafted route id with the guard message and issues no request at all', () => {
    // The router hands an `:id` over URL-decoded, so this value would leave `/api/v1` and read another
    // resource on the same host (CWE-20, CWE-22). The refusal arrives as an observable error — the form
    // every caller of this service already handles (`firstValueFrom` inside a `try`, or a `catchError`
    // beside it) — because `defer` keeps the invalid segment from being an exception thrown out of a
    // `switchMap` projection.
    const crafted = '../../../users';
    const refusals: Error[] = [];
    let emissions = 0;

    const record = (failure: unknown): void => {
      if (failure instanceof Error) {
        refusals.push(failure);
      }
    };

    service.get(crafted).subscribe({ next: () => (emissions += 1), error: record });
    service.transaction(crafted, 'deposit', TRANSACTION).subscribe({
      next: () => (emissions += 1),
      error: record,
    });

    expect(emissions).toBe(0);
    expect(refusals).toHaveLength(2);
    // Each refusal's message is the guard's fixed sentence, so neither the rejected value nor the
    // call that composed the segment is in the text a screen renders; both are in `cause` instead.
    for (const refusal of refusals) {
      expect(refusal.message).not.toContain(crafted);
      expect(String(refusal.cause)).toContain(`'${crafted}'`);
    }
    expect(refusals[0].message).not.toContain('SavingsService.get');
    expect(String(refusals[0].cause)).toContain('SavingsService.get');
    expect(refusals[1].message).not.toContain('SavingsService.transaction');
    expect(String(refusals[1].cause)).toContain('SavingsService.transaction');
    // Nothing was sent, on either path or in any other shape; the teardown's `verify()` says the same
    // for the whole case.
    httpMock.expectNone(isRequest('GET', savingsUrl('savingsaccounts', crafted)));
    httpMock.expectNone(isRequest('POST', savingsUrl('savingsaccounts', crafted, 'transactions')));
    httpMock.expectNone(() => true);
  });
});
