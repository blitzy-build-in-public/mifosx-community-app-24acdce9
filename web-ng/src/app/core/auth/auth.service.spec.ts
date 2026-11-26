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

/** Contract and behaviour spec for `AuthService`, the application's only credential exchange and the proof of workflow W1 (AAP 0.10.1: `POST /authentication`, then `GET /users/{id}`); a restore that leaves no session in effect rejects the login with the projection failure's own `ApiError`, so a failed post-login read is never an unexplained return to the login form (AAP 0.14.2). */

/** The served API host and root, written out exactly as `web-ng/src/assets/config.json` ships them. */
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

/** The stand-in password, joined from parts at run time. It is never a literal in this file and it is asserted to be absent from the stored session. */
const SECRET_PARTS = ['correct', 'horse', 'battery', 'staple'];

/** The stand-in authentication key, joined from parts for the same reason as the password. */
const KEY_PARTS = ['Zm9v', 'YmFy', 'OnNlY3JldA'];

/** The permissions Fineract returns on the fixture login, and the ones the gate must then answer. */
const GRANTED: readonly string[] = ['READ_CLIENT', 'CREATE_CLIENT'];

/** The composed legacy storage key, `mifosX` + `sessionData`: the string a legacy screen reads (AAP 0.3.4 claim 9); the bare spelling is never written. */
const COMPOSED_KEY = 'mifosXsessionData';
const BARE_KEY = 'sessionData';

/** The submitted password, assembled where it is used rather than kept in a constant. */
function submittedPassword(): string {
  return SECRET_PARTS.join('-');
}

/** The `POST /authentication` answer the fixtures use, with the flags absent unless a test adds them. */
function authResponse(overrides: Partial<AuthResponse> = {}): AuthResponse {
  return {
    userId: USER_ID, username: USERNAME, base64EncodedAuthenticationKey: KEY_PARTS.join(''), permissions: [...GRANTED],
    ...overrides, };
}

/** The `GET /users/{id}` as the restore reads it: the id and the account name, with no permission list. */
function projection(): SessionUserResponse {
  return { id: USER_ID, username: USERNAME };
}

/** The message a login is refused with when its `POST /authentication` response cannot describe a session. */
const MALFORMED_RESPONSE_MESSAGE =
  'The authentication response did not carry a user id, an authentication key and a permission list, ' +
  'so no session was created.';

/** `POST /authentication` answers that cannot describe a session, each with the member it omits or mistypes. The response is a network boundary. */
const MALFORMED_AUTHENTICATION_RESPONSES: Array<[string, Record<string, unknown>]> = [[
    'a response that omits the permission list',
    { userId: USER_ID, username: USERNAME, base64EncodedAuthenticationKey: KEY_PARTS.join('') }, ], [
    'a response that omits the authentication key', { userId: USER_ID, username: USERNAME, permissions: [...GRANTED] },
  ], ['a response whose userId is a string', {
      userId: String(USER_ID), username: USERNAME, base64EncodedAuthenticationKey: KEY_PARTS.join(''),
      permissions: [...GRANTED], }, ], ];

/** The session entry the fixture login must record, exactly the three legacy fields. */
function expectedSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    userId: USER_ID, authenticationKey: KEY_PARTS.join(''), userPermissions: [...GRANTED], ...overrides, };
}

/** The stub `apiUrl()`: the service owns no host, so the configuration supplies one (AAP 0.4.2, Rule 2). */
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

/** Drives one whole login through the mock backend and resolves when `login()` does: the `POST` is answered, the restore's `GET` that the service issues next is answered, and the promise is awaited. */
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
    // The two collaborators are the application's own: the session entry the login writes and the gate the restore publishes permissions through are what the screens then read (AAP 0.7.1).
    sessions = TestBed.inject(SessionService);
    permissions = TestBed.inject(PermissionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    window.localStorage.clear();
  });

  it('answers the accessors with no session in effect', () => {
    // The state the login screen starts in: nothing stored, nothing in effect, and every accessor reporting the absence rather than an empty or stale session (AAP 0.1.1, a gate that fails closed).
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

    // Two body keys and no others: no tenant, no locale, no date, no remember-me flag (Rule 1 clause 2; AAP 0.7.3 row "W1 login and logout").
    expect(Object.keys(authentication.request.body as AuthenticationRequest)).toEqual(['username', 'password']);
    expect(authentication.request.body).toEqual({
      username: USERNAME,
      password: submittedPassword(),
    } satisfies AuthenticationRequest);

    // No query parameter, and neither header this application sends is built here: the interceptor attaches both from the configuration and the session (AAP 0.4.2).
    expect(authentication.request.params.keys()).toEqual([]);
    expect(authentication.request.headers.has('Authorization')).toBe(false);
    expect(authentication.request.headers.has('Fineract-Platform-TenantId')).toBe(false);

    authentication.flush(authResponse());
    await Promise.resolve();

    const users = httpMock.expectOne(byMethodAndUrl('GET', usersUrl(USER_ID)));
    expect(users.request.params.keys()).toEqual([]);
    expect(users.request.body).toBeNull();

    users.flush(projection());
    await login;

    expect(service.isAuthenticated()).toBe(true);
  });

  it('records the legacy session entry before the restore reads the user', async () => {
    expect(sessionStorageKey()).toBe(COMPOSED_KEY);

    // Captured from inside the restore's own request, which is the moment the password must already be gone and the session must already be published: the interceptor sends the key it carries (AAP 0.4.2), so a write ordered.
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

    // Exactly the three legacy fields, at the composed key, with the bare spelling never written (AAP 0.3.4 claim 9; AAP 0.7.2 row `SessionData`).
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
    expect(permissions.can('READ_CLIENT')).toBe(true);
    expect(permissions.can('DELETE_CLIENT')).toBe(false);
  });

  it.each([
    { status: 403, message: 'Not permitted' },
    { status: 500, message: 'Server error' },
  ])(
    'rejects the login with the user projection failure for a $status answer',
    async ({ status, message }: { status: number; message: string }) => {
      // The post-login read is the login's own last step, so a failure there is a failed sign-in: the entry stays written, no session is in effect, and the caller is
      // told why instead of navigating into a guard that sends the user straight back to this form with nothing said. The 403 is the status the interceptor
      // deliberately leaves silent; the 500 arrives on top of its one notification, and both reject the same way (AAP 0.14.2).
      const login = service.login(USERNAME, submittedPassword());

      httpMock.expectOne(byMethodAndUrl('POST', AUTHENTICATION_URL)).flush(authResponse());
      await Promise.resolve();

      httpMock.expectOne(byMethodAndUrl('GET', usersUrl(USER_ID))).flush(
        { defaultUserMessage: message },
        { status, statusText: String(status) },
      );

      const failure = await rejectionOf(login);

      assertApiError(failure);
      // The server's own text, character for character, and the status it arrived with, so the screen paints a failed projection read the way it paints a refused credential (AAP 0.4.4 decision 6).
      expect(failure.message).toBe(message);
      expect(failure.status).toBe(status);

      // The entry is still where a 401 can act on it, and the gate is closed (AAP 0.1.1, AAP 0.14.2).
      expect(storedSession()).toEqual(expectedSession());
      expect(sessions.read()).toEqual(expectedSession());
      expect(service.isAuthenticated()).toBe(false);
      expect(service.user()).toBeNull();
      expect(service.permissions()).toEqual([]);
      expect(service.username()).toBeNull();
      expect(permissions.can('READ_CLIENT')).toBe(false);
      // Exactly one projection read: the rejection adds no request and no retry (Rule 1 clause 2).
      httpMock.expectNone(byMethodAndUrl('GET', usersUrl(USER_ID)));
    },
  );

  it('surfaces the authentication failure unchanged and writes no session', async () => {
    const login = service.login(USERNAME, submittedPassword());

    httpMock.expectOne(byMethodAndUrl('POST', AUTHENTICATION_URL)).flush(
      { defaultUserMessage: 'Invalid credentials', errors: [{ defaultUserMessage: 'Invalid credentials' }] },
      { status: 401, statusText: 'Unauthorized' },
    );

    // The failure reaches the caller as it arrived, so the login screen renders the server's own text and keeps the typed username (AAP 0.4.4 decision 6).
    await expect(login).rejects.toMatchObject({ status: 401 });

    expect(storedSession()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.user()).toBeNull();
    expect(service.permissions()).toEqual([]);
    expect(permissions.can('READ_CLIENT')).toBe(false);
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
      expect(failure.status).toBe(200);
      expect(failure.validationErrors).toEqual([]);

      // Nothing reached storage, no session is in effect and the restore read is never issued, which is what keeps a partial entry and `Authorization: Basic undefined` out of the application.
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

    // No second exchange, no redirect and no message: both flags are out of scope and are read by no branch (AAP 0.9.2; AAP 0.10.5 item 13).
    expect(service.isAuthenticated()).toBe(true);
    expect(service.permissions()).toEqual(GRANTED);
    httpMock.expectNone(byMethodAndUrl('POST', AUTHENTICATION_URL));
  });

  it('resumes the stored legacy entry on restore, reading the user once with a bodiless GET', async () => {
    // What a page reload, or a login on a legacy screen, leaves behind: the entry in storage and nothing in memory — the state the bootstrap initializer restores from before the router's first navigation (AAP 0.10.1 W1.
    window.localStorage.setItem(COMPOSED_KEY, JSON.stringify(expectedSession()));
    expect(service.isAuthenticated()).toBe(false);

    const restored = service.restore();

    // The reload is a read, not a second credential exchange: one bodiless `GET` for the stored id, with no query parameter (AAP 0.7.3 row "W1 login and logout"; Rule 1 clause 8).
    const users = httpMock.expectOne(byMethodAndUrl('GET', usersUrl(USER_ID)));
    expect(users.request.method).toBe('GET');
    expect(users.request.params.keys()).toEqual([]);
    expect(users.request.body).toBeNull();

    users.flush(projection());
    await expect(restored).resolves.toBe(true);

    // The state the restore publishes: the stored session, the account name the projection supplied and the stored permission list, for the accessors and the signals a template reads (AAP 0.7.1 `restore(): Promise<boolean>`).
    expect(service.user()).toEqual(expectedSession());
    expect(service.session()).toEqual(expectedSession());
    expect(service.isAuthenticated()).toBe(true);
    expect(service.permissions()).toEqual(GRANTED);
    expect(service.username()).toBe(USERNAME);
    expect(sessions.user()).toEqual({ id: USER_ID, username: USERNAME });
    expect(permissions.can('READ_CLIENT')).toBe(true);
    expect(permissions.can('DELETE_CLIENT')).toBe(false);
    httpMock.expectNone(byMethodAndUrl('POST', AUTHENTICATION_URL));
  });

  it('restores nothing when no entry is stored, and reaches no transport', async () => {
    // A start with no entry — the first run after a logout, or a visitor arriving at the login screen — resolves `false`, so the initializer's awaited restore closes the gate instead of opening one over an empty session (AAP (AAP 0.10.1, AAP 0.7.1).
    await expect(service.restore()).resolves.toBe(false);

    httpMock.expectNone(() => true);
    expect(service.user()).toBeNull();
    expect(service.session()).toBeNull();
    expect(service.username()).toBeNull();
    expect(service.permissions()).toEqual([]);
    expect(service.isAuthenticated()).toBe(false);
    expect(permissions.can('READ_CLIENT')).toBe(false);
  });

  it('ends the session on logout without issuing a request', async () => {
    await loginThrough(httpMock, service, { password: submittedPassword() });
    expect(service.isAuthenticated()).toBe(true);

    service.logout();

    // Both stored spellings go, so no later restore can sign the user back in, and every accessor reports the absence (AAP 0.4.2: the authorization disappears with the session).
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

/** The refusal Fineract answers a bad credential exchange with, as the server sends it (AAP 0.4.4). */
const SERVER_MESSAGE = 'Invalid credentials';

/** The resolved configuration's shape, taken from the accessor that publishes it rather than declared a second time here, so a member the interceptor starts reading fails the build in this spec as well. */
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

/** The router surface the interceptor reads. A refused authentication navigates nowhere — the user is already on the login screen — so this stand-in exists for the injection to resolve, and its `url` keeps the. */
const routerStub = {
  url: '/login',
  navigate: (): Promise<boolean> => Promise.resolve(true),
};

/** The `AppConfigService` surface the interceptor uses: the configuration signal it reads the tenant from, and the composition every service shares. */
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

/** Asserts that a login rejected with the one error type every Fineract failure becomes, and narrows it so the cases below read its members without a cast (Rule 1 clause 4). */
function assertApiError(failure: unknown): asserts failure is ApiError {
  expect(failure).toBeInstanceOf(ApiError);
}

/** Workflow W1 behind the application's own HTTP interceptor (AAP 0.4.2; AAP 0.10.1 W1 "Outcome that must match"; Rule 1 clauses 5 and 8). */
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
    // The key the login just stored is the one the restore is authorised with: the interceptor reads it from the session, which is why the entry is written before this read (AAP 0.4.2).
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
    // Character for character, with no prefix, trim or translation: the login screen shows the server's own words and keeps the typed username (AAP 0.4.4 decision 6).
    expect(failure.message).toBe(SERVER_MESSAGE);
    expect(failure.status).toBe(401);
    expect(failure.validationErrors).toEqual([]);

    expect(window.localStorage.getItem(COMPOSED_KEY)).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.user()).toBeNull();
    expect(service.permissions()).toEqual([]);
    expect(service.username()).toBeNull();
    httpMock.expectNone(byMethodAndUrl('GET', usersUrl(USER_ID)));
  });
});

