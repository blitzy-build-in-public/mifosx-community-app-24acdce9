/** Behavioural spec for `fineractInterceptor`, the application's single HTTP interceptor (AAP 0.4.2, 0.7.1, 0.7.4; Rule 1 clauses 5 and 8) (AAP 0.14.2, Rule 1 clause 9, AAP 0.10.4). */
import {
  HttpErrorResponse,
  HttpParams,
  HttpRequest,
  HttpResponse,
  type HttpEvent,
  type HttpHandlerFn,
} from '@angular/common/http';
import { Injector, runInInjectionContext, signal, type WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, of, throwError, type Observable } from 'rxjs';
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

/** Stand-in API root the stubbed `apiUrl()` prefixes, so this spec names no real endpoint. */
const API_ROOT = 'api-root';

/** Stand-in resource URL of an ordinary Fineract request. */
const CLIENTS_URL = 'api-root/clients';

/** Stand-in URL of the authentication request, which the stubbed `apiUrl()` also composes. */
const AUTHENTICATION_URL = 'api-root/authentication';

/** The route a 401 interrupts, carried to the login screen as `returnUrl`. */
const ATTEMPTED_URL = '/viewclient/2';

/** Header names asserted by name, as the Fineract contract fixes them (AAP 0.4.3). */
const TENANT_HEADER = 'Fineract-Platform-TenantId';
const AUTHORIZATION_HEADER = 'Authorization';

/** The authentication key parts the fixture joins; the value exists only in this run's memory. */
const KEY_PARTS = ['Zm9v', 'YmFy', 'OnNlY3JldA'];

/** The server's own validation text, which a screen must render verbatim (workflow W7). */
const SERVER_MESSAGE = 'The maximum allowed principal is 10,000';

/** The generic sentence Fineract puts in the envelope's top-level `defaultUserMessage` beside a validation failure's own field-level text; it must never displace that text (AAP 0.4.4 decision 6). */
const GENERIC_MESSAGE = 'Validation errors exist.';

/** The sentence `api-error.ts` shows for a failure whose body carries no message of its own. */
const UNMAPPED_FAILURE_TEXT = 'The request could not be completed.';

/** The resolved configuration the interceptor reads, with only the tenant exercised. */
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
  return { userId: 7, authenticationKey: KEY_PARTS.join(''), userPermissions: ['ALL_FUNCTIONS'] };
}

/** Answers the request as Fineract would, echoing the request the interceptor handed on. */
const echo: HttpHandlerFn = (request) => of(new HttpResponse({ status: 200, body: request }));

/** Fails the request with the status and body a Fineract error response carries. */
function failing(status: number, body?: unknown): HttpHandlerFn {
  return () => throwError(() => new HttpErrorResponse({ status, error: body }));
}

/** The interceptor's collaborators, and the interceptor bound to them. */
interface Harness {
  readonly config: WritableSignal<AppConfig | null>;
  readonly session: WritableSignal<SessionData | null>;
  readonly clear: ReturnType<typeof vi.fn>;
  readonly router: { url: string; navigate: ReturnType<typeof vi.fn> };
  readonly notifications: NotificationService;
  readonly run: (
    request: HttpRequest<unknown>,
    handler?: HttpHandlerFn,
  ) => Observable<HttpEvent<unknown>>;
}

/** Builds the interceptor over the four collaborators it injects, all supplied as values. */
function harnessFor(): Harness {
  const config = signal<AppConfig | null>(configFixture());
  const session = signal<SessionData | null>(null);
  const clear = vi.fn((): void => session.set(null));
  const router = { url: '/clients', navigate: vi.fn(() => Promise.resolve(true)) };
  const notifications = new NotificationService();

  const injector = Injector.create({
    providers: [
      {
        provide: AppConfigService,
        useValue: {
          changes: config.asReadonly(),
          // The composition is the real service's job; this stand-in only has to answer for the one endpoint the interceptor names, exactly as `apiUrl()` would.
          apiUrl: (path: string) => `${API_ROOT}/${path}`,
        },
      },
      { provide: SessionService, useValue: { session: session.asReadonly(), clear } },
      { provide: Router, useValue: router },
      { provide: NotificationService, useValue: notifications },
    ],
  });

  const run = (
    request: HttpRequest<unknown>,
    handler: HttpHandlerFn = echo,
  ): Observable<HttpEvent<unknown>> =>
    runInInjectionContext(injector, () => fineractInterceptor(request, handler));

  return { config, session, clear, router, notifications, run };
}

/** The request the handler received, read back off the body `echo` answered with. */
function sentRequest(response: HttpEvent<unknown>): HttpRequest<unknown> {
  // The one cast in this spec: `echo` answers with the request itself as its body, which the response type states only as `unknown`.
  return (response as HttpResponse<unknown>).body as HttpRequest<unknown>;
}

/** The value an observable failed with, so its identity and type can be asserted. */
async function rejectionOf(observable: Observable<unknown>): Promise<unknown> {
  try {
    await firstValueFrom(observable);
  } catch (error: unknown) {
    return error;
  }

  throw new Error('the request was expected to fail, but the interceptor let it through');
}

/** The text a refusing router rejects its navigation with; it is never what the user must be shown. */
const NAVIGATION_FAILURE = 'Navigation cancelled because a guard returned false';

/** The sentence a refused return to the login screen is reported with: it names the screen. */
const LOGIN_SCREEN_MESSAGE = 'The login screen did not open. Reload the page and try again.';

/** The promise a refusing router rejects its navigation with, counting the rejection handlers the code under test attaches to it. */
class RefusedNavigation extends Promise<boolean> {
  /** How many rejection handlers have been attached to this navigation so far. */
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
    // The incoming request is never mutated: the interceptor clones it with its headers alone.
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
    // Both failures are kept, in the server's order, so a form can paint each field's own text.
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

      // Angular's own text is what used to reach the screen, and it names the request's URL, so the assertions below fail if that text ever comes back (Rule 1 clause 3).
      expect(response.message).toContain(CLIENTS_URL);

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).message).toBe(UNMAPPED_FAILURE_TEXT);
      expect((error as ApiError).message).not.toBe('');
      expect((error as ApiError).message).not.toBe(response.message);
      // Neither the request's path nor the host behind it reaches the text a screen renders.
      expect((error as ApiError).message).not.toContain(CLIENTS_URL);
      expect((error as ApiError).message).not.toContain(API_ROOT);
      expect((error as ApiError).validationErrors).toHaveLength(0);
      // A 4xx is the screen's to render, whatever shape its body arrived in.
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
    // Crosses a macrotask, so the handler the interceptor attached has run and the notification it raises is queued before the assertions below read it.
    await navigationSettled();

    // The navigation's promise is settled — one rejection handler, attached by the interceptor...
    expect(navigation.rejectionHandlers).toBe(1);
    // ...the user is told once, in the fixed sentence naming the screen that did not open...
    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.kind).toBe('error');
    expect(notifications.messages()[0]?.message).toBe(LOGIN_SCREEN_MESSAGE);
    // ...and not in the router's own wording, which names navigation ids and guards and leaves an operator nothing to act on...
    expect(notifications.messages()[0]?.message).not.toContain(NAVIGATION_FAILURE);
    // ...and nothing from the request or the session reaches that text (Rule 1 clause 9).
    expect(notifications.messages()[0]?.message).not.toContain(fixture.authenticationKey);
    // The 401 still reaches the caller as the mapped ApiError the case above asserts.
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
    // A guard that rejects with something other than an error still has to reach the user as words.
    router.navigate.mockImplementation(() => Promise.reject('the guard refused the login screen'));

    await rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(401)));
    await navigationSettled();

    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.kind).toBe('error');
    expect(notifications.messages()[0]?.message).toBe(LOGIN_SCREEN_MESSAGE);
    // The request sentence is for a failure that made a request, and a refused navigation made none.
    expect(notifications.messages()[0]?.message).not.toBe(UNMAPPED_FAILURE_TEXT);
  });

  it('leaves the session and the route alone when the authentication request itself is refused', async () => {
    const { run, session, clear, router } = harnessFor();
    session.set(sessionFixture());

    await rejectionOf(run(new HttpRequest('POST', AUTHENTICATION_URL, {}), failing(401)));

    // The login screen owns the refusal and the user is already there.
    expect(clear).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not re-navigate while the login screen is showing', async () => {
    const { run, clear, router } = harnessFor();
    router.url = '/login';

    await rejectionOf(run(new HttpRequest('GET', CLIENTS_URL), failing(401)));

    expect(clear).toHaveBeenCalledTimes(1);
    expect(router.navigate).not.toHaveBeenCalled();
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
