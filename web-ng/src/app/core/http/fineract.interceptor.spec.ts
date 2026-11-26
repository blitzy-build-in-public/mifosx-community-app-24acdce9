/** Behavioural spec for `fineractInterceptor`, the application's single HTTP interceptor (AAP 0.4.2, 0.7.1, 0.7.4; Rule 1 clauses 5 and 8) (AAP 0.14.2, Rule 1 clause 9, AAP 0.10.4). */
import {
  HttpErrorResponse,
  HttpParams,
  HttpRequest,
  HttpResponse,
  provideHttpClient,
  withInterceptors,
  type HttpEvent,
  type HttpHandlerFn,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { EnvironmentInjector, computed, runInInjectionContext, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NEVER, firstValueFrom, of, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionData } from '../auth/session.model';
import { SessionService } from '../auth/session.service';
import type { AppConfig } from '../config/app-config.model';
import { AppConfigService } from '../config/app-config.service';
import { NotificationService } from '../notifications/notification.service';
import { ApiError } from './api-error';
import { fineractInterceptor } from './fineract.interceptor';

/** Tenant identifier the resolved configuration reports; the value is configuration, not a credential. */
const TENANT = 'default';

/** The API origin the stand-in configuration names: scheme, host and port, because the credential is presented only to the origin it was issued against and a relative stub would have no origin to compare (AAP 0.4.4 decision 5). */
const API_ORIGIN = 'https://fineract.example:8443';

/** Stand-in API root the stubbed `apiUrl()` prefixes, so this spec names no real endpoint. */
const API_ROOT = `${API_ORIGIN}/api/v1`;

const CLIENTS_URL = `${API_ROOT}/clients`;

const AUTHENTICATION_URL = `${API_ROOT}/authentication`;

/** The origin a crafted page URL would name in place of the one the session was issued against: the F01 case, and a host this spec sends nothing to. */
const OTHER_ORIGIN = 'https://other.example:4421';

const ATTEMPTED_URL = '/viewclient/2';

/** A second protected URL of the same origin, so a burst of simultaneous failures is three distinct requests rather than three readings of one. */
const LOANS_URL = `${API_ROOT}/loans`;

/** A request the application makes to its own origin rather than to Fineract: the translation bundle `TranslateHttpLoader` fetches while the application starts, which must travel with no credential (AAP 0.4.2, Rule 1 clause 9). */
const BUNDLE_URL = 'global-translations/locale-en.json';

/** A path that begins with the API origin's characters without sitting under it: a match that is not a segment boundary would send the credential here too. */
const OUTSIDE_ORIGIN_URL = `${API_ROOT}ish/clients`;

/** The allowlisted `GET /users/{id}` the recovery re-validates a refused credential with (AAP 0.7.3 W1), composed the way the stubbed `apiUrl()` composes it. */
const USERS_URL = `${API_ROOT}/users`;

const USER_ID = 7;

const PROBE_URL = `${USERS_URL}/${USER_ID}`;

/** How long the interceptor waits for an answer, in milliseconds: the bound a case advances a fake clock past to fail a request no server answered. */
const REQUEST_TIMEOUT_MS = 30_000;

/** The sentence a request that ran out of time is reported with, so a case pins the text a user reads rather than the operator's own words. */
const TIMED_OUT_TEXT = 'The server did not answer in time. Try again in a moment.';

/** The sentence shown once a refused credential has ended the session: what the user is told to do next, and nothing about the exchange (Rule 1 clause 9). */
const SESSION_ENDED_TEXT = 'Your session has ended. Sign in again to continue.';

/** Header names asserted by name, as the Fineract contract fixes them (AAP 0.4.3). */
const TENANT_HEADER = 'Fineract-Platform-TenantId';
const AUTHORIZATION_HEADER = 'Authorization';

/** The authentication key parts the fixture joins; the value exists only in this run's memory. */
const KEY_PARTS = ['Zm9v', 'YmFy', 'OnNlY3JldA'];

/** The server's own validation text, which a screen must render verbatim (workflow W7). */
const SERVER_MESSAGE = 'The maximum allowed principal is 10,000';

/** The generic sentence Fineract puts in the envelope's top-level `defaultUserMessage` beside a validation failure's own field-level text; it must never displace that text (AAP 0.4.4 decision 6). */
const GENERIC_MESSAGE = 'Validation errors exist.';

const UNMAPPED_FAILURE_TEXT = 'The request could not be completed.';

function configFixture(): AppConfig {
  return {
    apiBaseUrl: API_ROOT,
    apiPath: 'api/v1',
    tenantId: TENANT,
    dateFormat: 'dd MMMM yyyy',
    locale: 'en',
    idleMinutes: 30,
    warningSeconds: 10,
    keepaliveMinutes: 15,
  };
}

/** The session in effect, in the legacy shape the interceptor reads its credential from. */
function sessionFixture(): SessionData {
  return {
    userId: USER_ID,
    authenticationKey: KEY_PARTS.join(''),
    userPermissions: ['ALL_FUNCTIONS'],
  };
}

const echo: HttpHandlerFn = (request) => of(new HttpResponse({ status: 200, body: request }));

function failing(status: number, body?: unknown): HttpHandlerFn {
  return () => throwError(() => new HttpErrorResponse({ status, error: body }));
}

interface Harness {
  readonly config: WritableSignal<AppConfig | null>;
  readonly session: WritableSignal<SessionData | null>;
  /** The origin the session's credential was issued against, which a case sets when the page resolved its base elsewhere (AAP 0.4.4 decision 5). */
  readonly issuedAgainst: WritableSignal<string | null>;
  readonly clear: ReturnType<typeof vi.fn>;
  readonly router: { url: string; navigated: boolean; navigate: ReturnType<typeof vi.fn> };
  readonly notifications: NotificationService;
  readonly server: HttpTestingController;
  readonly run: (
    request: HttpRequest<unknown>,
    handler?: HttpHandlerFn,
  ) => Observable<HttpEvent<unknown>>;
}

/** Builds the interceptor over the collaborators it injects, four of them supplied as values and the fifth the application's own `HttpClient`, so the recovery's re-validation is a real request this same interceptor sees. */
function harnessFor(): Harness {
  const config = signal<AppConfig | null>(configFixture());
  const session = signal<SessionData | null>(null);
  // A credential and its origin stand or fall together: `SessionService` publishes the origin with the session and empties both on clear, so the double derives one from the other and defaults it to the origin these requests go to.
  const issuedAgainst = signal<string | null>(API_ORIGIN);
  const credentialOrigin = computed<string | null>(() => (session() === null ? null : issuedAgainst()));
  const clear = vi.fn((): void => session.set(null));
  const router = {
    url: '/clients',
    // A route the application has already shown: the state a mid-session failure arrives in, and the one a case sets false to reproduce the start-up read.
    navigated: true,
    navigate: vi.fn(() => Promise.resolve(true)),
  };
  const notifications = new NotificationService();

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      // The application's own client with this interceptor in its chain: the re-validation then re-enters the interceptor under test, which is what makes its context mark a fact this spec can check rather than a stub's good behaviour.
      provideHttpClient(withInterceptors([fineractInterceptor])),
      provideHttpClientTesting(),
      {
        provide: AppConfigService,
        useValue: {
          changes: config.asReadonly(),
          // The composition is the real service's job; this stand-in only has to answer for the endpoints the interceptor names, exactly as `apiUrl()` would.
          apiUrl: (path: string) => `${API_ROOT}/${path}`,
        },
      },
      { provide: SessionService, useValue: { session: session.asReadonly(), credentialOrigin, clear } },
      { provide: Router, useValue: router },
      { provide: NotificationService, useValue: notifications },
    ],
  });

  const injector = TestBed.inject(EnvironmentInjector);
  const server = TestBed.inject(HttpTestingController);

  const run = (
    request: HttpRequest<unknown>,
    handler: HttpHandlerFn = echo,
  ): Observable<HttpEvent<unknown>> =>
    runInInjectionContext(injector, () => fineractInterceptor(request, handler));

  return { config, session, issuedAgainst, clear, router, notifications, server, run };
}

/** The re-validation reads the mock backend has been asked for, so a case states how often the credential was re-validated rather than that some request was made. */
function revalidations(server: HttpTestingController): TestRequest[] {
  return server.match(PROBE_URL);
}

function sentRequest(response: HttpEvent<unknown>): HttpRequest<unknown> {
  // The one cast in this spec: `echo` answers with the request itself as its body, which the response type states only as `unknown`.
  return (response as HttpResponse<unknown>).body as HttpRequest<unknown>;
}

/** The value an observable failed with, so its identity and type can be asserted; the rejection handler is attached as a case calls this, which keeps a failure that arrives while a fake clock runs an observed one. */
function rejectionOf(observable: Observable<unknown>): Promise<unknown> {
  return firstValueFrom(observable).then(
    () => {
      throw new Error('the request was expected to fail, but the interceptor let it through');
    },
    (error: unknown) => error,
  );
}

/** The text a refusing router rejects its navigation with; it is never what the user must be shown. */
const NAVIGATION_FAILURE = 'Navigation cancelled because a guard returned false';

/** The sentence a refused return to the login screen is reported with: it names the screen. */
const LOGIN_SCREEN_MESSAGE = 'The login screen did not open. Reload the page and try again.';

/** The promise a refusing router rejects its navigation with, counting the rejection handlers the code under test attaches to it. */
class RefusedNavigation extends Promise<boolean> {
  rejectionHandlers = 0;

  override catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<boolean | TResult> {
    if (typeof onrejected === 'function') {
      this.rejectionHandlers += 1;
    }

    return super.catch(onrejected);
  }
}

/** A navigation that refuses with `failure`, and the record of whether it was settled. */
function refusedNavigation(failure: Error): RefusedNavigation {
  return new RefusedNavigation((_settle: (value: boolean) => void, refuse): void => {
    refuse(failure);
  });
}

/** Waits until the handler the interceptor attached to a refused navigation has run. */
async function navigationSettled(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('fineractInterceptor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Uninstall the console spies a case installs, so no later case runs against a stubbed console; the `clearAllMocks()` above empties their call history but leaves them patched in place.
    vi.restoreAllMocks();
  });

  it('attaches the tenant and Basic headers, and leaves the URL, method and query untouched', async () => {
    const { run, session } = harnessFor();
    const fixture = sessionFixture();
    session.set(fixture);
    const request = new HttpRequest('GET', CLIENTS_URL, {
      params: new HttpParams().set('offset', '0').set('limit', '15'),
    });

    const sent = sentRequest(await firstValueFrom(run(request)));

    expect(sent.headers.get(TENANT_HEADER)).toBe(TENANT);
    expect(sent.headers.get(AUTHORIZATION_HEADER)).toBe(`Basic ${fixture.authenticationKey}`);
    // The composed URL the calling service owns reaches the handler unchanged, query included, so `check:endpoints` stays a true statement about what the application requests (AAP 0.4.2).
    expect(sent.url).toBe(CLIENTS_URL);
    expect(sent.urlWithParams).toBe(`${CLIENTS_URL}?offset=0&limit=15`);
    expect(sent.urlWithParams).toBe(request.urlWithParams);
    expect(sent.method).toBe(request.method);
    expect(request.headers.has(TENANT_HEADER)).toBe(false);
    expect(request.headers.has(AUTHORIZATION_HEADER)).toBe(false);
  });

  it('sends the tenant but no credential on the authentication request', async () => {
    const { run, session } = harnessFor();
    session.set(sessionFixture());

    const sent = sentRequest(
      await firstValueFrom(run(new HttpRequest('POST', AUTHENTICATION_URL, {}))),
    );

    expect(sent.headers.get(TENANT_HEADER)).toBe(TENANT);
    expect(sent.headers.has(AUTHORIZATION_HEADER)).toBe(false);
  });

  it('sends no credential while no session is in effect', async () => {
    const { run } = harnessFor();

    const sent = sentRequest(await firstValueFrom(run(new HttpRequest('GET', CLIENTS_URL))));

    expect(sent.headers.get(TENANT_HEADER)).toBe(TENANT);
    expect(sent.headers.has(AUTHORIZATION_HEADER)).toBe(false);
  });

  it.each([
    ['the translation bundle the application fetches from its own origin', BUNDLE_URL],
    ["a path that only begins with the API origin's characters", OUTSIDE_ORIGIN_URL],
  ])('sends neither header on %s', async (_label, url) => {
    const { run, session } = harnessFor();
    session.set(sessionFixture());
    const request = new HttpRequest('GET', url);

    const sent = sentRequest(await firstValueFrom(run(request)));

    // The credential and the tenant datum belong to Fineract alone, so a request outside the configured API carries neither, however long the session has been in effect (AAP 0.4.2, Rule 1 clause 9). The bundle is at the application's own origin and has no origin to match at all, while the second URL shares the API origin's scheme, host and port and is excluded by the segment boundary alone: the origin check would let it through on its own.
    expect(sent.headers.has(TENANT_HEADER)).toBe(false);
    expect(sent.headers.has(AUTHORIZATION_HEADER)).toBe(false);
    // ...and where a request goes is still the calling service's decision, not this layer's.
    expect(sent.url).toBe(url);
    expect(sent.url).toBe(request.url);
  });

  it('withholds the credential from a base the page URL named, and still sends the tenant', async () => {
    const { run, session, issuedAgainst } = harnessFor();
    const fixture = sessionFixture();
    session.set(fixture);
    // A crafted `?baseApiUrl=` link: this page resolved its base to another origin than the one the session was issued against, which is the case the finding demonstrated end to end (AAP 0.4.4 decision 5).
    issuedAgainst.set(OTHER_ORIGIN);

    const sent = sentRequest(await firstValueFrom(run(new HttpRequest('GET', CLIENTS_URL))));

    expect(sent.headers.has(AUTHORIZATION_HEADER)).toBe(false);
    // The tenant is configuration rather than session material, so the login exchange and every call must still reach whatever base the page named (AAP 0.10.4).
    expect(sent.headers.get(TENANT_HEADER)).toBe(TENANT);
    // The request itself is untouched: the page still talks to the base it resolved, just without the key (AAP 0.4.2).
    expect(sent.url).toBe(CLIENTS_URL);
  });

  it('passes a request through untouched while the configuration is still resolving', async () => {
    const { run, config } = harnessFor();
    config.set(null);
    const request = new HttpRequest('GET', CLIENTS_URL);
    let received: HttpRequest<unknown> | undefined;
    const handler: HttpHandlerFn = (handedOn) => {
      received = handedOn;
      return of(new HttpResponse({ status: 200 }));
    };

    await firstValueFrom(run(request, handler));

    expect(received).toBe(request);
    expect(request.headers.has(TENANT_HEADER)).toBe(false);
    expect(request.headers.has(AUTHORIZATION_HEADER)).toBe(false);
  });

  it('maps a Fineract validation failure to ApiError carrying the field-level server text, and notifies nothing', async () => {
    const { run, session, clear, router, notifications } = harnessFor();
    session.set(sessionFixture());
    const body = {
      defaultUserMessage: GENERIC_MESSAGE,
      errors: [{ defaultUserMessage: SERVER_MESSAGE }],
    };

    const error = await rejectionOf(
      run(new HttpRequest('POST', CLIENTS_URL, {}), failing(400, body)),
    );

    expect(error).toBeInstanceOf(ApiError);
    // The actionable field-level text wins over the envelope's generic summary (AAP 0.4.4 decision 6).
    expect((error as ApiError).message).toBe(SERVER_MESSAGE);
    expect((error as ApiError).message).not.toBe(GENERIC_MESSAGE);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).validationErrors).toHaveLength(1);
    expect((error as ApiError).validationErrors[0]?.defaultUserMessage).toBe(SERVER_MESSAGE);
    // A 4xx is the screen's to render; only a 5xx or transport failure is also notified (AAP 0.7.4).
    expect(notifications.messages()).toHaveLength(0);
    expect(clear).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('takes the first field-level message when the envelope carries no top-level one', async () => {
    const { run, notifications } = harnessFor();
    const body = {
      errors: [{ defaultUserMessage: 'First problem.' }, { defaultUserMessage: 'Second problem.' }],
    };

    const error = await rejectionOf(
      run(new HttpRequest('POST', CLIENTS_URL, {}), failing(400, body)),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('First problem.');
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).validationErrors.map((failure) => failure.defaultUserMessage)).toEqual([
      'First problem.',
      'Second problem.',
    ]);
    expect(notifications.messages()).toHaveLength(0);
  });

  it.each([
    ['a plain-string body', 'Bad Request from a proxy'],
    ['a null body', null],
    ['an errors list whose entries carry no message', { errors: [null, 42] }],
  ])(
    'answers %s with the shared sentence, reporting no field-level failure',
    async (_label, body) => {
      const { run, notifications } = harnessFor();
      const response = new HttpErrorResponse({
        status: 400,
        statusText: 'Bad Request',
        url: CLIENTS_URL,
        error: body,
      });

      const error = await rejectionOf(
        run(
          new HttpRequest('GET', CLIENTS_URL),
          () => throwError(() => response),
        ),
      );

      // The screen must show Fineract's own sentence, or the shared fallback when the server sent none, and never Angular's, whose text describes the transport and names the request URL (Rule 1 clause 3).
      expect(response.message).toContain(CLIENTS_URL);

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).message).toBe(UNMAPPED_FAILURE_TEXT);
      expect((error as ApiError).message).not.toBe('');
      expect((error as ApiError).message).not.toBe(response.message);
      expect((error as ApiError).message).not.toContain(CLIENTS_URL);
      expect((error as ApiError).message).not.toContain(API_ROOT);
      expect((error as ApiError).validationErrors).toHaveLength(0);
      expect(notifications.messages()).toHaveLength(0);
    },
  );

  it.each([0, 500, 503])('raises exactly one notification for status %i', async (status) => {
    const { run, notifications } = harnessFor();

    const error = await rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(status)));

    expect(error).toBeInstanceOf(ApiError);
    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.kind).toBe('error');
    expect(notifications.messages()[0]?.message).toBe((error as ApiError).message);
  });

  it.each([400, 404, 422])('raises no notification for status %i', async (status) => {
    const { run, notifications } = harnessFor();

    const error = await rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(status)));

    expect(error).toBeInstanceOf(ApiError);
    expect(notifications.messages()).toHaveLength(0);
  });

  it('fails a request no server answers once its bound elapses, and reports it once', async () => {
    vi.useFakeTimers();

    try {
      const { run, session, server, clear, router, notifications } = harnessFor();
      session.set(sessionFixture());
      router.url = ATTEMPTED_URL;
      const unanswered: HttpHandlerFn = () => NEVER;
      const failure = rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), unanswered));

      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
      // A slow answer inside the bound is not a failure, so nothing is reported while the request is still waiting.
      expect(notifications.messages()).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1);
      const error = await failure;

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).message).toBe(TIMED_OUT_TEXT);
      // Status 0 is the transport-failure status `api-error.ts` documents, so the screen treats a server that never answered exactly like an unreachable one (AAP 0.7.2).
      expect((error as ApiError).status).toBe(0);
      expect(notifications.messages()).toHaveLength(1);
      expect(notifications.messages()[0]?.kind).toBe('error');
      expect(notifications.messages()[0]?.message).toBe(TIMED_OUT_TEXT);
      // A request nobody answered is no credential refusal: nothing is re-validated and no session ends.
      expect(revalidations(server)).toHaveLength(0);
      expect(clear).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says nothing of its own when the re-validation is the request that runs out of time', async () => {
    vi.useFakeTimers();

    try {
      const { run, session, server, clear, router, notifications } = harnessFor();
      session.set(sessionFixture());
      router.url = ATTEMPTED_URL;
      const failure = rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(0)));

      // The recovery asks for the re-validation as the request fails, and that read is bounded like every other one.
      expect(revalidations(server)).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
      const error = await failure;

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(0);
      // The re-validation's own bound is not the user's failure to read: the sentence on the screen is the session one, once (AAP 0.14.2).
      expect(notifications.messages().map((notice) => notice.message)).not.toContain(TIMED_OUT_TEXT);
      expect(notifications.messages()).toHaveLength(1);
      expect(notifications.messages()[0]?.message).toBe(SESSION_ENDED_TEXT);
      expect(clear).toHaveBeenCalledTimes(1);
      expect(router.navigate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends the session and returns to the login screen carrying the attempted route on a 401', async () => {
    const { run, session, clear, router, notifications } = harnessFor();
    session.set(sessionFixture());
    router.url = ATTEMPTED_URL;

    const error = await rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(401)));

    expect(error).toBeInstanceOf(ApiError);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(session()).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: ATTEMPTED_URL },
    });
    expect(notifications.messages()).toHaveLength(0);
  });

  it('reports a refused return to the login screen once, and leaves no rejection unhandled', async () => {
    const { run, session, clear, router, notifications } = harnessFor();
    const fixture = sessionFixture();
    session.set(fixture);
    router.url = ATTEMPTED_URL;
    const navigation = refusedNavigation(new Error(NAVIGATION_FAILURE));
    router.navigate.mockImplementation(() => navigation);

    const propagated = await rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(401)));
    await navigationSettled();

    expect(navigation.rejectionHandlers).toBe(1);
    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.kind).toBe('error');
    expect(notifications.messages()[0]?.message).toBe(LOGIN_SCREEN_MESSAGE);
    expect(notifications.messages()[0]?.message).not.toContain(NAVIGATION_FAILURE);
    // ...and nothing from the request or the session reaches that text (Rule 1 clause 9).
    expect(notifications.messages()[0]?.message).not.toContain(fixture.authenticationKey);
    expect(propagated).toBeInstanceOf(ApiError);
    expect((propagated as ApiError).status).toBe(401);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('reports a refused return whose own failure is an ApiError in that failure\'s own words', async () => {
    const { run, session, router, notifications } = harnessFor();
    session.set(sessionFixture());
    router.url = ATTEMPTED_URL;
    const refusal = new ApiError('The login screen could not be loaded.', 500);
    router.navigate.mockImplementation(() => Promise.reject(refusal));

    await rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(401)));
    await navigationSettled();

    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.kind).toBe('error');
    expect(notifications.messages()[0]?.message).toBe(refusal.message);
  });

  it('reports a refused return whose own failure is a Fineract response in the server\'s words', async () => {
    const { run, session, router, notifications } = harnessFor();
    session.set(sessionFixture());
    router.url = ATTEMPTED_URL;
    const refusal = new HttpErrorResponse({
      status: 503,
      error: { defaultUserMessage: SERVER_MESSAGE },
    });
    router.navigate.mockImplementation(() => Promise.reject(refusal));

    await rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(401)));
    await navigationSettled();

    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.kind).toBe('error');
    expect(notifications.messages()[0]?.message).toBe(SERVER_MESSAGE);
  });

  it('reports a refused return carrying no message of its own with the sentence naming the login screen', async () => {
    const { run, session, router, notifications } = harnessFor();
    session.set(sessionFixture());
    router.url = ATTEMPTED_URL;
    router.navigate.mockImplementation(() => Promise.reject('the guard refused the login screen'));

    await rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(401)));
    await navigationSettled();

    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.kind).toBe('error');
    expect(notifications.messages()[0]?.message).toBe(LOGIN_SCREEN_MESSAGE);
    expect(notifications.messages()[0]?.message).not.toBe(UNMAPPED_FAILURE_TEXT);
  });

  it('leaves the session and the route alone when the authentication request itself is refused', async () => {
    const { run, session, clear, router } = harnessFor();
    session.set(sessionFixture());

    await rejectionOf(run(new HttpRequest('POST', AUTHENTICATION_URL, {}), failing(401)));

    expect(clear).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not re-navigate while the login screen is showing', async () => {
    const { run, session, clear, router } = harnessFor();
    // The session a sign-in has just written, refused by the read that follows it: the user is on the login screen the whole time.
    session.set(sessionFixture());
    router.url = '/login';

    await rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(401)));

    expect(clear).toHaveBeenCalledTimes(1);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('ends nothing when a 401 answers a request that carried no credential', async () => {
    const { run, session, issuedAgainst, clear, router } = harnessFor();
    session.set(sessionFixture());
    // The key was withheld because the page resolved another origin, so the 401 is about a request that never presented the stored session (AAP 0.4.4 decision 5).
    issuedAgainst.set(OTHER_ORIGIN);
    router.url = ATTEMPTED_URL;

    const error = await rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(401)));

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    // The stored session belongs to the origin it was issued against, so it survives a refusal it never took part in (Rule 1 clause 9)...
    expect(clear).not.toHaveBeenCalled();
    expect(session()).not.toBeNull();
    // ...while the user is still taken back to the login screen, which is where anyone without a credential for this base has to sign in again.
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: ATTEMPTED_URL },
    });
  });

  it('ends the session, returns to the login screen and says so when a status 0 failure is a refused credential', async () => {
    const { run, session, server, clear, router, notifications } = harnessFor();
    const fixture = sessionFixture();
    session.set(fixture);
    router.url = ATTEMPTED_URL;

    const failure = rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(0)));
    const probe = revalidations(server);

    // The re-validation reads the allowlisted `GET /users/{id}` the restore already calls, with the credential this request carried (AAP 0.7.3 W1).
    expect(probe).toHaveLength(1);
    expect(probe[0]?.request.url).toBe(PROBE_URL);
    expect(probe[0]?.request.headers.get(AUTHORIZATION_HEADER)).toBe(
      `Basic ${fixture.authenticationKey}`,
    );

    // A refused key reaches the browser as status 0 rather than 401, so the read's failure is the answer, not its status.
    probe[0]?.error(new ProgressEvent('error'));
    const error = await failure;

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(session()).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: ATTEMPTED_URL },
    });
    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.kind).toBe('error');
    expect(notifications.messages()[0]?.message).toBe(SESSION_ENDED_TEXT);
    // The notice tells the user what to do next and carries nothing from the exchange (Rule 1 clause 9).
    expect(notifications.messages()[0]?.message).not.toContain(fixture.authenticationKey);
  });

  it('keeps the session and reports the failure once when the credential still works', async () => {
    const { run, session, server, clear, router, notifications } = harnessFor();
    session.set(sessionFixture());
    router.url = ATTEMPTED_URL;

    const failure = rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(0)));
    revalidations(server)[0]?.flush({ id: USER_ID, username: 'mifos' });
    const error = await failure;

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    // A key that still works is a transport fault: the session stands, nothing navigates, and the failure is the one thing said.
    expect(clear).not.toHaveBeenCalled();
    expect(session()).not.toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.message).toBe(UNMAPPED_FAILURE_TEXT);
  });

  it('costs one re-validation, one session end and one return when three failures arrive together', async () => {
    const { run, session, server, clear, router, notifications } = harnessFor();
    session.set(sessionFixture());
    router.url = ATTEMPTED_URL;

    const failures = Promise.all([
      rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(0))),
      rejectionOf(run(new HttpRequest('GET', LOANS_URL), failing(0))),
      rejectionOf(
        run(
          new HttpRequest('GET', CLIENTS_URL, { params: new HttpParams().set('offset', '15') }),
          failing(0),
        ),
      ),
    ]);

    const probe = revalidations(server);
    expect(probe).toHaveLength(1);
    probe[0]?.error(new ProgressEvent('error'));
    await failures;

    expect(clear).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledTimes(1);
    // One refusal reaching the screen three times is one thing to report, not three.
    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.message).toBe(SESSION_ENDED_TEXT);
  });

  it('re-validates nothing when a status 0 failure carried no credential', async () => {
    const { run, server, clear, router, notifications } = harnessFor();

    const error = await rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(0)));

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect(revalidations(server)).toHaveLength(0);
    expect(clear).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.message).toBe(UNMAPPED_FAILURE_TEXT);
  });

  it('reports the failure and re-validates nothing when the session ended while the request was in flight', async () => {
    const { run, session, server, clear, router, notifications } = harnessFor();
    session.set(sessionFixture());
    router.url = ATTEMPTED_URL;
    // The session is withdrawn as the request goes out — a sign-out, or another screen's 401 — so by the time this failure arrives there is nothing left to end.
    const signedOutMeanwhile: HttpHandlerFn = () => {
      session.set(null);
      return throwError(() => new HttpErrorResponse({ status: 0 }));
    };

    const error = await rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), signedOutMeanwhile));

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect(revalidations(server)).toHaveLength(0);
    expect(clear).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.message).toBe(UNMAPPED_FAILURE_TEXT);
  });

  it('starts no second re-validation when the re-validation itself is refused', async () => {
    const { run, session, server, clear, router, notifications } = harnessFor();
    session.set(sessionFixture());
    router.url = ATTEMPTED_URL;

    const failure = rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(0)));
    revalidations(server)[0]?.error(new ProgressEvent('error'));
    await failure;

    // The one read is the only read: its own failure re-entered this interceptor and started nothing, raised nothing and ended nothing by itself (AAP 0.14.1).
    expect(revalidations(server)).toHaveLength(0);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.message).toBe(SESSION_ENDED_TEXT);
  });

  it('leaves the start-up read its own refusal handling, re-validating nothing before the first navigation', async () => {
    const { run, session, server, clear, router, notifications } = harnessFor();
    session.set(sessionFixture());
    router.navigated = false;

    const error = await rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(0)));

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect(revalidations(server)).toHaveLength(0);
    expect(clear).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.message).toBe(UNMAPPED_FAILURE_TEXT);
  });

  it('reports a refused return to the login screen once when a refused credential ends the session', async () => {
    const { run, session, server, router, notifications } = harnessFor();
    session.set(sessionFixture());
    router.url = ATTEMPTED_URL;
    const navigation = refusedNavigation(new Error(NAVIGATION_FAILURE));
    router.navigate.mockImplementation(() => navigation);

    const failure = rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(0)));
    revalidations(server)[0]?.error(new ProgressEvent('error'));
    await failure;
    await navigationSettled();

    expect(navigation.rejectionHandlers).toBe(1);
    // The return itself is what failed, so the sentence names the screen and the session-ended one is not added on top.
    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.message).toBe(LOGIN_SCREEN_MESSAGE);
    expect(notifications.messages()[0]?.message).not.toBe(SESSION_ENDED_TEXT);
  });

  it('reports the failure once and returns nowhere when a refused credential reaches the login screen', async () => {
    const { run, session, server, clear, router, notifications } = harnessFor();
    // The session a sign-in has just written, refused by the restore that follows it: the user is on the login screen the whole time.
    session.set(sessionFixture());
    router.url = '/login';

    const failure = rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(0)));
    revalidations(server)[0]?.error(new ProgressEvent('error'));
    const error = await failure;

    expect(error).toBeInstanceOf(ApiError);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(session()).toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
    // A return would land where the user already is, so the failure's own sentence is the one thing said rather than a second one about a session that never reached a screen (AAP 0.7.4, AAP 0.14.2).
    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.message).toBe(UNMAPPED_FAILURE_TEXT);
  });

  it('rethrows an error that is not an HTTP response unchanged', async () => {
    const { run, clear, router, notifications } = harnessFor();
    const failure = new Error('an operator inside the stream failed');

    const error = await rejectionOf(
      run(
        new HttpRequest('GET', CLIENTS_URL),
        () => throwError(() => failure),
      ),
    );

    expect(error).toBe(failure);
    expect(clear).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(notifications.messages()).toHaveLength(0);
  });

  it('writes nothing to the console while a session ends and a failure is notified', async () => {
    const { run, session, router } = harnessFor();
    // Spied on rather than intercepted: the assertion is that the interceptor calls none of them (Rule 1 clause 9 — no credential, header or exchange detail in a log or a console output).
    const logged = vi.spyOn(console, 'log');
    const errored = vi.spyOn(console, 'error');
    const warned = vi.spyOn(console, 'warn');
    const debugged = vi.spyOn(console, 'debug');
    session.set(sessionFixture());
    router.url = ATTEMPTED_URL;

    await rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(401)));
    await rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(500)));
    await navigationSettled();

    expect(logged).not.toHaveBeenCalled();
    expect(errored).not.toHaveBeenCalled();
    expect(warned).not.toHaveBeenCalled();
    expect(debugged).not.toHaveBeenCalled();
  });
});
