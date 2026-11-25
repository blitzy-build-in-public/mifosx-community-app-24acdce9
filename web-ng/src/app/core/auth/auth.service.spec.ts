import { provideHttpClient, withInterceptors, type HttpRequest } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppConfigService } from '../config/app-config.service';
import { ApiError } from '../http/api-error';
import { fineractInterceptor } from '../http/fineract.interceptor';
import { AuthService, type AuthenticationRequest } from './auth.service';
import { PermissionsService } from './permissions.service';
import type { AuthResponse, SessionData, SessionUserResponse } from './session.model';
import { SessionService, sessionStorageKey } from './session.service';

/**
 * Contract and behaviour spec for `AuthService`, the application's only credential exchange and the
 * proof of workflow W1 (AAP 0.10.1: `POST /authentication`, then `GET /users/{id}`).
 *
 * It is the `HttpTestingController` contract test Rule 1 clause 8 asks for on both endpoints the login
 * uses, and the suite criterion 2's 90% gate over this file measures. Each test pins one contract:
 * - the login request is a `POST` to the configured `authentication` path carrying exactly the two
 *   submitted fields and no query parameter, with neither the authorization nor the tenant header set
 *   here, because the interceptor is the only place those are added (AAP 0.4.2);
 * - exactly one `GET` follows it, for the authenticated user's id, with no query parameter, and the
 *   session entry that becomes the shared login is recorded at the composed legacy key before it;
 * - the entry holds exactly the three legacy fields (AAP 0.7.2 row `SessionData`), the submitted
 *   password appears nowhere in it, and the bare key spelling is never written;
 * - a successful restore puts the session, the account name and the permission list in effect, for
 *   both the accessors and the signals a template reads;
 * - a restore that fails leaves the login successful and the gate closed — the path the prompt
 *   requires, because the entry is already written and the interceptor owns a 401;
 * - an authentication failure reaches the caller unchanged and writes no session;
 * - driven through the application's own interceptor, the login is tagged with the tenant header and
 *   no credential, the restore carries the key the login just stored, and a 401 reaches the caller as
 *   the `ApiError` whose message is Fineract's `defaultUserMessage` verbatim (AAP 0.4.2; workflow W1);
 * - the password-renewal and two-factor flags are received and acted on by no branch (AAP 0.10.5
 *   item 13);
 * - `logout()` removes both stored spellings and empties every accessor without a request.
 *
 * Security (Rule 1 clause 9, AAP 0.10.4): the stand-in password and authentication key are assembled
 * at run time from parts, so no credential-shaped literal reaches the source, and every assertion
 * compares values rather than printing them.
 */

/**
 * The served API host and root, written out exactly as `web-ng/src/assets/config.json` ships them, so
 * the requests this spec expects are the URLs the deployed application produces (AAP 0.4.4 decision
 * 5(a)). No demo host appears here (Rule 2).
 */
const API_BASE_URL = 'https://localhost:8443';
const API_PATH = '/fineract-provider/api/v1';
const API_ROOT = API_BASE_URL + API_PATH;

/** The one separator the expected URLs are joined with, so expectations build URLs one way only. */
const SEPARATOR = '/';

/** `POST` target of the login (AAP 0.7.3 row "W1 login and logout": `AuthenticationService`). */
const AUTHENTICATION_URL = API_ROOT + SEPARATOR + 'authentication';

/** Path segment of the restore's read (AAP 0.7.3 row "W1 login and logout": `userResource`). */
const USERS_SEGMENT = 'users';

/** The restore's read target for one user id: `GET /users/{id}` with the id as a path segment. */
function usersUrl(userId: number | string): string {
  return [API_ROOT, USERS_SEGMENT, userId].join(SEPARATOR);
}

/** The authenticated user of every fixture: the id the restore reads and the name the menu shows. */
const USER_ID = 42;
const USERNAME = 'mifos';

/**
 * The stand-in password, joined from parts at run time. It is never a literal in this file and it is
 * asserted to be absent from the stored session, which is the property that matters: a login keeps no
 * copy of what was submitted.
 */
const SECRET_PARTS = ['correct', 'horse', 'battery', 'staple'];

/** The stand-in authentication key, joined from parts for the same reason as the password. */
const KEY_PARTS = ['Zm9v', 'YmFy', 'OnNlY3JldA'];

/** The permissions Fineract returns on the fixture login, and the ones the gate must then answer. */
const GRANTED: readonly string[] = ['READ_CLIENT', 'CREATE_CLIENT'];

/**
 * The key the legacy pair composes — `mifosX` with `sessionData` — spelled out because the stored key
 * string is the contract a legacy screen reads (AAP 0.3.4 claim 9), and the bare spelling the newer
 * release writes, which this application never produces.
 */
const COMPOSED_KEY = 'mifosXsessionData';
const BARE_KEY = 'sessionData';

/** The submitted password, assembled where it is used rather than kept in a constant. */
function submittedPassword(): string {
  return SECRET_PARTS.join('-');
}

/** The `POST /authentication` answer the fixtures use, with the flags absent unless a test adds them. */
function authResponse(overrides: Partial<AuthResponse> = {}): AuthResponse {
  return {
    userId: USER_ID,
    username: USERNAME,
    base64EncodedAuthenticationKey: KEY_PARTS.join(''),
    permissions: [...GRANTED],
    ...overrides,
  };
}

/** The `GET /users/{id}` as the restore reads it: the id and the account name, with no permission list. */
function projection(): SessionUserResponse {
  return { id: USER_ID, username: USERNAME };
}

/**
 * The message a login is refused with when its `POST /authentication` response cannot describe a
 * session, stated here from this spec's own reading of the contract — the login screen renders it, so
 * it is a value a user sees (AAP 0.14.1) — and carrying no member value the response sent.
 */
const MALFORMED_RESPONSE_MESSAGE =
  'The authentication response did not carry a user id, an authentication key and a permission list, ' +
  'so no session was created.';

/**
 * `POST /authentication` answers that cannot describe a session, each with the member it omits or
 * mistypes. The response is a network boundary, so a member copied out of it unchecked would either
 * persist a partial entry or reach the interceptor as `Authorization: Basic undefined` (cr3-F07;
 * AAP 0.7.2 row `AuthResponse`).
 */
const MALFORMED_AUTHENTICATION_RESPONSES: Array<[string, Record<string, unknown>]> = [
  [
    'a response that omits the permission list',
    { userId: USER_ID, username: USERNAME, base64EncodedAuthenticationKey: KEY_PARTS.join('') },
  ],
  [
    'a response that omits the authentication key',
    { userId: USER_ID, username: USERNAME, permissions: [...GRANTED] },
  ],
  [
    'a response whose userId is a string',
    {
      userId: String(USER_ID),
      username: USERNAME,
      base64EncodedAuthenticationKey: KEY_PARTS.join(''),
      permissions: [...GRANTED],
    },
  ],
];

/** The session entry the fixture login must record, exactly the three legacy fields. */
function expectedSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    userId: USER_ID,
    authenticationKey: KEY_PARTS.join(''),
    userPermissions: [...GRANTED],
    ...overrides,
  };
}

/**
 * The stub `apiUrl()`: the service owns no host, so the configuration supplies one (AAP 0.4.2, Rule
 * 2). It composes exactly as `AppConfigService.apiUrl()` documents — base, path and resource joined
 * with one separator and no other rewriting — so the requests this spec sees are the ones the
 * application sends. Resolving the real configuration is proved in
 * `core/config/app-config.service.spec.ts`.
 */
const apiConfig: Pick<AppConfigService, 'apiUrl'> = {
  apiUrl: (path: string): string => `${API_ROOT}${SEPARATOR}${path}`,
};

/** Matches one request by method and exact URL; the parameter set and headers are asserted separately. */
function byMethodAndUrl(method: 'GET' | 'POST', url: string) {
  return (request: HttpRequest<unknown>): boolean => request.method === method && request.url === url;
}

/** What one login's mock backend answers, and which requests it must receive. */
interface LoginAnswers {
  /** The password the test submits; the assertion on the body compares this same value. */
  readonly password: string;
  /** The `POST /authentication` answer; the standard fixture when absent. */
  readonly authentication?: AuthResponse;
  /** How the restore's read is answered; a successful projection when absent. */
  readonly users?: (request: TestRequest) => void;
}

/**
 * Drives one whole login through the mock backend and resolves when `login()` does: the `POST` is
 * answered, the restore's `GET` that the service issues next is answered, and the promise is awaited.
 * The tick between the two answers lets the awaiting `login()` continue to the restore call.
 */
async function loginThrough(
  httpMock: HttpTestingController,
  service: AuthService,
  answers: LoginAnswers,
): Promise<void> {
  const login = service.login(USERNAME, answers.password);

  httpMock.expectOne(byMethodAndUrl('POST', AUTHENTICATION_URL)).flush(answers.authentication ?? authResponse());
  await Promise.resolve();

  const users = httpMock.expectOne(byMethodAndUrl('GET', usersUrl(USER_ID)));
  (answers.users ?? ((request: TestRequest) => request.flush(projection())))(users);

  await login;
}

/** The stored session entry, parsed, so an assertion reads the persisted contract rather than a value. */
function storedSession(): unknown {
  const raw = window.localStorage.getItem(sessionStorageKey());

  return raw === null ? null : JSON.parse(raw);
}

describe('AuthService', () => {
  let service: AuthService;
  let sessions: SessionService;
  let permissions: PermissionsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    window.localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AppConfigService, useValue: apiConfig },
      ],
    });

    service = TestBed.inject(AuthService);
    // The two collaborators are the application's own: the session entry the login writes and the
    // gate the restore publishes permissions through are what the screens then read (AAP 0.7.1).
    sessions = TestBed.inject(SessionService);
    permissions = TestBed.inject(PermissionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Proves no request was left outstanding, so a login that issued a third call fails here.
    httpMock.verify();
    window.localStorage.clear();
  });

  it('answers the accessors with no session in effect', () => {
    // The state the login screen starts in: nothing stored, nothing in effect, and every accessor
    // reporting the absence rather than an empty or stale session (AAP 0.1.1, a gate that fails
    // closed).
    expect(service.user()).toBeNull();
    expect(service.session()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.permissions()).toEqual([]);
    expect(service.username()).toBeNull();
    expect(permissions.can('READ_CLIENT')).toBe(false);
  });

  it('posts exactly the two submitted fields to POST /authentication', async () => {
    const login = service.login(USERNAME, submittedPassword());

    const authentication = httpMock.expectOne(byMethodAndUrl('POST', AUTHENTICATION_URL));

    // Two body keys and no others: no tenant, no locale, no date, no remember-me flag (Rule 1 clause
    // 2; AAP 0.7.3 row "W1 login and logout").
    expect(Object.keys(authentication.request.body as AuthenticationRequest)).toEqual(['username', 'password']);
    expect(authentication.request.body).toEqual({
      username: USERNAME,
      password: submittedPassword(),
    } satisfies AuthenticationRequest);

    // No query parameter, and neither header this application sends is built here: the interceptor
    // attaches both from the configuration and the session (AAP 0.4.2).
    expect(authentication.request.params.keys()).toEqual([]);
    expect(authentication.request.headers.has('Authorization')).toBe(false);
    expect(authentication.request.headers.has('Fineract-Platform-TenantId')).toBe(false);

    authentication.flush(authResponse());
    await Promise.resolve();

    // Exactly one read follows, for the id the response named, with no query parameter and no body.
    const users = httpMock.expectOne(byMethodAndUrl('GET', usersUrl(USER_ID)));
    expect(users.request.params.keys()).toEqual([]);
    expect(users.request.body).toBeNull();

    users.flush(projection());
    await login;

    // The pair of calls is the whole login: a third request would be reported by afterEach's verify().
    expect(service.isAuthenticated()).toBe(true);
  });

  it('records the legacy session entry before the restore reads the user', async () => {
    expect(sessionStorageKey()).toBe(COMPOSED_KEY);

    // Captured from inside the restore's own request, which is the moment the password must already
    // be gone and the session must already be published: the interceptor sends the key it carries
    // (AAP 0.4.2), so a write ordered after the read would leave the restore unauthenticated.
    let entryDuringRestore: string | null = null;
    let sessionDuringRestore: SessionData | null = null;

    await loginThrough(httpMock, service, {
      password: submittedPassword(),
      users: (request: TestRequest) => {
        entryDuringRestore = window.localStorage.getItem(COMPOSED_KEY);
        sessionDuringRestore = sessions.session();
        request.flush(projection());
      },
    });

    expect(entryDuringRestore).not.toBeNull();
    expect(sessionDuringRestore).toEqual(expectedSession());

    // Exactly the three legacy fields, at the composed key, with the bare spelling never written
    // (AAP 0.3.4 claim 9; AAP 0.7.2 row `SessionData`).
    expect(storedSession()).toEqual(expectedSession());
    expect(sessions.read()).toEqual(expectedSession());
    expect(window.localStorage.getItem(BARE_KEY)).toBeNull();
    expect(storedSession()).not.toBeNull();
  });

  it('keeps no copy of the submitted password', async () => {
    await loginThrough(httpMock, service, { password: submittedPassword() });

    const raw = window.localStorage.getItem(COMPOSED_KEY);

    expect(raw).not.toBeNull();
    expect(raw ?? '').not.toContain(submittedPassword());
    // The session's own members are the three legacy fields, so a password cannot be hidden in it.
    expect(Object.keys(storedSession() as SessionData)).toEqual(['userId', 'authenticationKey', 'userPermissions']);
  });

  it('puts the session, the account name and the permission list in effect', async () => {
    await loginThrough(httpMock, service, { password: submittedPassword() });

    expect(service.user()).toEqual(expectedSession());
    expect(service.session()).toEqual(expectedSession());
    expect(service.isAuthenticated()).toBe(true);
    expect(service.permissions()).toEqual(GRANTED);
    // The label comes from `GET /users/{id}`, not from the submitted account name.
    expect(service.username()).toBe(USERNAME);
    expect(sessions.user()).toEqual({ id: USER_ID, username: USERNAME });
    // The gate the templates and the route guard ask answers from the login's own list.
    expect(permissions.can('READ_CLIENT')).toBe(true);
    expect(permissions.can('DELETE_CLIENT')).toBe(false);
  });

  it('keeps the login successful when the user projection cannot be read', async () => {
    // The prompt's restore-false path: the entry is written, the projection read fails, and the login
    // resolves rather than reporting a credential rejection that never happened. The gate is closed
    // afterwards, which is the state a 401 settles for good.
    await loginThrough(httpMock, service, {
      password: submittedPassword(),
      users: (request: TestRequest) => request.flush(
        { defaultUserMessage: 'Not permitted' },
        { status: 403, statusText: 'Forbidden' },
      ),
    });

    expect(storedSession()).toEqual(expectedSession());
    expect(sessions.read()).toEqual(expectedSession());
    expect(service.isAuthenticated()).toBe(false);
    expect(service.user()).toBeNull();
    expect(service.permissions()).toEqual([]);
    expect(service.username()).toBeNull();
    expect(permissions.can('READ_CLIENT')).toBe(false);
  });

  it('surfaces the authentication failure unchanged and writes no session', async () => {
    const login = service.login(USERNAME, submittedPassword());

    httpMock.expectOne(byMethodAndUrl('POST', AUTHENTICATION_URL)).flush(
      { defaultUserMessage: 'Invalid credentials', errors: [{ defaultUserMessage: 'Invalid credentials' }] },
      { status: 401, statusText: 'Unauthorized' },
    );

    // The failure reaches the caller as it arrived, so the login screen renders the server's own text
    // and keeps the typed username (AAP 0.4.4 decision 6).
    await expect(login).rejects.toMatchObject({ status: 401 });

    expect(storedSession()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.user()).toBeNull();
    expect(service.permissions()).toEqual([]);
    expect(permissions.can('READ_CLIENT')).toBe(false);
    // A rejected exchange is not followed by the restore read.
    httpMock.expectNone(byMethodAndUrl('GET', usersUrl(USER_ID)));
  });

  it.each(MALFORMED_AUTHENTICATION_RESPONSES)(
    'stores no session for %s and rejects with the described ApiError',
    async (_label: string, body: Record<string, unknown>) => {
      const login = service.login(USERNAME, submittedPassword());

      httpMock.expectOne(byMethodAndUrl('POST', AUTHENTICATION_URL)).flush(body);

      const failure = await rejectionOf(login);

      assertApiError(failure);
      expect(failure.message).toBe(MALFORMED_RESPONSE_MESSAGE);
      // The exchange succeeded, so the failure is the response body's: status 200 and no field failure.
      expect(failure.status).toBe(200);
      expect(failure.validationErrors).toEqual([]);

      // Nothing reached storage, no session is in effect and the restore read is never issued, which is
      // what keeps a partial entry and `Authorization: Basic undefined` out of the application.
      expect(window.localStorage.length).toBe(0);
      expect(service.session()).toBeNull();
      expect(service.isAuthenticated()).toBe(false);
      expect(service.permissions()).toEqual([]);
      httpMock.expectNone(byMethodAndUrl('GET', usersUrl(USER_ID)));
    },
  );

  it('receives the password-renewal and two-factor flags without acting on them', async () => {
    await loginThrough(httpMock, service, {
      password: submittedPassword(),
      authentication: authResponse({ shouldRenewPassword: true, isTwoFactorAuthenticationRequired: true }),
    });

    // No second exchange, no redirect and no message: both flags are out of scope and are read by no
    // branch (AAP 0.9.2; AAP 0.10.5 item 13).
    expect(service.isAuthenticated()).toBe(true);
    expect(service.permissions()).toEqual(GRANTED);
    httpMock.expectNone(byMethodAndUrl('POST', AUTHENTICATION_URL));
  });

  it('ends the session on logout without issuing a request', async () => {
    await loginThrough(httpMock, service, { password: submittedPassword() });
    expect(service.isAuthenticated()).toBe(true);

    service.logout();

    // Both stored spellings go, so no later restore can sign the user back in, and every accessor
    // reports the absence (AAP 0.4.2: the authorization disappears with the session).
    expect(window.localStorage.getItem(COMPOSED_KEY)).toBeNull();
    expect(window.localStorage.getItem(BARE_KEY)).toBeNull();
    expect(sessions.read()).toBeNull();
    expect(service.user()).toBeNull();
    expect(service.session()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.permissions()).toEqual([]);
    expect(service.username()).toBeNull();
    expect(permissions.can('READ_CLIENT')).toBe(false);
    // Logout is local: no sign-out endpoint is called, as in legacy.
    httpMock.expectNone(() => true);
  });
});

/** The tenant identifier the resolved configuration reports: configuration, never tenant data. */
const TENANT_ID = 'default';

/** The two header names the Fineract contract fixes (AAP 0.4.3); the interceptor is their only writer. */
const TENANT_HEADER = 'Fineract-Platform-TenantId';
const AUTHORIZATION_HEADER = 'Authorization';

/**
 * The refusal Fineract answers a bad credential exchange with, as the server sends it. The login screen
 * renders this text unchanged, so the case below compares it character for character — workflow W7's
 * rule applied to W1's refusal (AAP 0.4.4 decision 6).
 */
const SERVER_MESSAGE = 'Invalid credentials';

/**
 * The resolved configuration's shape, taken from the accessor that publishes it rather than declared a
 * second time here, so a member the interceptor starts reading fails the build in this spec as well.
 */
type ResolvedConfig = AppConfigService['config'];

/** The configuration the interceptor reads: the tenant it stamps on every request, and the API root. */
function resolvedConfig(): ResolvedConfig {
  return {
    apiBaseUrl: API_BASE_URL,
    apiPath: API_PATH,
    tenantId: TENANT_ID,
    dateFormat: 'dd MMMM yyyy',
    locale: 'en',
    idleMinutes: 30,
    warningSeconds: 10,
    keepaliveMinutes: 15,
  };
}

/**
 * The router surface the interceptor reads. A refused authentication navigates nowhere — the user is
 * already on the login screen — so this stand-in exists for the injection to resolve, and its `url`
 * keeps the interceptor's own redirect branch out of the way.
 */
const routerStub = {
  url: '/login',
  navigate: (): Promise<boolean> => Promise.resolve(true),
};

/**
 * The `AppConfigService` surface the interceptor uses: the configuration signal it reads the tenant
 * from, and the composition every service shares. Resolving the real configuration is proved in
 * `core/config/app-config.service.spec.ts`; this stand-in joins base, root and path exactly as
 * `apiUrl()` documents, so the requests asserted here are the ones the application sends.
 */
function interceptorConfig(): Pick<AppConfigService, 'apiUrl' | 'changes'> {
  const resolved = signal<ResolvedConfig | null>(resolvedConfig());

  return {
    changes: resolved.asReadonly(),
    apiUrl: (path: string): string => `${API_ROOT}${SEPARATOR}${path}`,
  };
}

/** The error a login rejected with, so a case asserts on the value a screen would receive. */
async function rejectionOf(pending: Promise<void>): Promise<unknown> {
  try {
    await pending;
  } catch (error: unknown) {
    return error;
  }

  throw new Error('the login was expected to fail, but it resolved');
}

/**
 * Asserts that a login rejected with the one error type every Fineract failure becomes, and narrows it
 * so the cases below read its members without a cast (Rule 1 clause 4).
 */
function assertApiError(failure: unknown): asserts failure is ApiError {
  expect(failure).toBeInstanceOf(ApiError);
}

/**
 * Workflow W1 behind the application's own HTTP interceptor (AAP 0.4.2; AAP 0.10.1 W1 "Outcome that
 * must match"; Rule 1 clauses 5 and 8).
 *
 * The block above runs without the interceptor on purpose: a request asserted there is
 * `AuthService`'s own contribution to the exchange. Here the interceptor is part of the system under
 * test, which is what makes the two headers and the mapped failure observable — the tenant header on
 * the login, the session's Basic key on the restore that follows it, and the `ApiError` a 401 becomes.
 */
describe('AuthService through the application interceptor', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    window.localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([fineractInterceptor])),
        provideHttpClientTesting(),
        { provide: AppConfigService, useValue: interceptorConfig() },
        { provide: Router, useValue: routerStub },
      ],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Proves the refused exchange was not followed by the restore read, and issues no third call.
    httpMock.verify();
    window.localStorage.clear();
  });

  it('stamps the tenant header on the login and sends the stored key on the restore', async () => {
    const login = service.login(USERNAME, submittedPassword());

    const authentication = httpMock.expectOne(byMethodAndUrl('POST', AUTHENTICATION_URL));
    expect(authentication.request.headers.get(TENANT_HEADER)).toBe(TENANT_ID);
    // The exchange is what asks for the credential, so it carries none (AAP 0.4.2).
    expect(authentication.request.headers.has(AUTHORIZATION_HEADER)).toBe(false);

    authentication.flush(authResponse());
    await Promise.resolve();

    const users = httpMock.expectOne(byMethodAndUrl('GET', usersUrl(USER_ID)));
    // The key the login just stored is the one the restore is authorised with: the interceptor reads it
    // from the session, which is why the entry is written before this read (AAP 0.4.2).
    expect(users.request.headers.get(AUTHORIZATION_HEADER)).toBe(`Basic ${KEY_PARTS.join('')}`);
    expect(users.request.headers.get(TENANT_HEADER)).toBe(TENANT_ID);

    users.flush(projection());
    await login;

    expect(service.isAuthenticated()).toBe(true);
    expect(service.username()).toBe(USERNAME);
  });

  it('rejects the login with the ApiError the interceptor maps a 401 into', async () => {
    const login = service.login(USERNAME, submittedPassword());

    httpMock
      .expectOne(byMethodAndUrl('POST', AUTHENTICATION_URL))
      .flush(
        { defaultUserMessage: SERVER_MESSAGE, errors: [] },
        { status: 401, statusText: 'Unauthorized' },
      );

    const failure = await rejectionOf(login);

    assertApiError(failure);
    // Character for character, with no prefix, trim or translation: the login screen shows the
    // server's own words and keeps the typed username (AAP 0.4.4 decision 6).
    expect(failure.message).toBe(SERVER_MESSAGE);
    expect(failure.status).toBe(401);
    expect(failure.validationErrors).toEqual([]);

    // A refused exchange writes no session, leaves every accessor empty and is not followed by the
    // restore read the interceptor would have attached a credential to.
    expect(window.localStorage.getItem(COMPOSED_KEY)).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.user()).toBeNull();
    expect(service.permissions()).toEqual([]);
    expect(service.username()).toBeNull();
    httpMock.expectNone(byMethodAndUrl('GET', usersUrl(USER_ID)));
  });
});

