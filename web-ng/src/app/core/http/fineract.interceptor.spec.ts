/**
 * Behavioural spec for `fineractInterceptor`, the application's single HTTP interceptor (AAP 0.4.2,
 * 0.7.1, 0.7.4; Rule 1 clauses 5 and 8). Each test pins one contract of the file:
 *
 * - the tenant header and the session's Basic key are attached, and the URL, method and query
 *   parameters reach the handler exactly as the calling service composed them (no rewriting);
 * - the authentication request carries the tenant header but no credential, because the credential is
 *   what it is asking for;
 * - no credential header is sent while no session is in effect;
 * - a request issued before the configuration resolves passes through untouched, so bootstrap cannot be
 *   handed a throw from the configuration surface it is resolving;
 * - a 401 on a normal request ends the session and returns to the login screen carrying the attempted
 *   route, while a 401 on the authentication request and a 401 while the login screen is showing leave
 *   both alone;
 * - exactly one notification is raised for a transport failure or a 5xx, and none for a 4xx, which
 *   reaches the caller alone;
 * - every `HttpErrorResponse` becomes the `ApiError` the caller renders, and an error of another kind is
 *   rethrown unchanged.
 *
 * The interceptor is exercised through `runInInjectionContext` with the four collaborators it injects
 * supplied as values, rather than through `TestBed`: it has no template, and the run's house pattern for
 * a class with no template is the runtime injector (see `session.service.spec.ts`).
 *
 * Security (Rule 1 clause 9, AAP 0.10.4): the session fixture's credential is assembled at run time from
 * parts, so no credential-shaped literal reaches the source, and it is compared by equality rather than
 * printed.
 */
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
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
          // The composition is the real service's job; this stand-in only has to answer for the one
          // endpoint the interceptor names, exactly as `apiUrl()` would.
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
  // The one cast in this spec: `echo` answers with the request itself as its body, which the response
  // type states only as `unknown`.
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

describe('fineractInterceptor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(sent.url).toBe(request.url);
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

  it('maps a Fineract validation failure to ApiError carrying the server text, and notifies nothing', async () => {
    const { run, session, clear, router, notifications } = harnessFor();
    session.set(sessionFixture());
    const body = { defaultUserMessage: SERVER_MESSAGE, errors: [{ defaultUserMessage: SERVER_MESSAGE }] };

    const error = await rejectionOf(
      run(new HttpRequest('POST', CLIENTS_URL, {}), failing(400, body)),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(SERVER_MESSAGE);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).validationErrors).toHaveLength(1);
    // A 4xx is the screen's to render; only a 5xx or transport failure is also notified (AAP 0.7.4).
    expect(notifications.messages()).toHaveLength(0);
    expect(clear).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

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
});
