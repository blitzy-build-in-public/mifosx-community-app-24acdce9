/** The application's single HTTP interceptor (AAP 0.4.2, AAP 0.7.1, AAP 0.14.1; Rule 1 clause 5): it owns the two headers a Fineract call carries — `Fineract-Platform-TenantId` and `Authorization: Basic <key>` — sends them only to the configured API origin, leaves every URL a service composed untouched, bounds each request, maps every failure into `ApiError`, ends the session and returns to the login screen carrying the attempted route on a 401 or a confirmed credential refusal, and raises one notification for a 5xx, a transport failure or a timeout (AAP 0.7.4, AAP 0.10.5). */
import {
  HttpClient,
  HttpContext,
  HttpContextToken,
  HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  TimeoutError,
  catchError,
  firstValueFrom,
  from,
  switchMap,
  throwError,
  timeout,
  type Observable,
} from 'rxjs';

import type { SessionData } from '../auth/session.model';
import { SessionService } from '../auth/session.service';
import { AppConfigService } from '../config/app-config.service';
import { NotificationService } from '../notifications/notification.service';
import { ApiError, navigationFailure, toApiError } from './api-error';

/** Tenant header every Fineract request carries; the value is the resolved configuration's `tenantId`. */
const TENANT_HEADER = 'Fineract-Platform-TenantId';

/** Credential header carrying the session's Basic key; absent whenever no session is in effect. */
const AUTHORIZATION_HEADER = 'Authorization';

/** The one allowlisted endpoint this file names, resolved through `apiUrl()` and never composed here. */
const AUTHENTICATION_ENDPOINT = 'authentication';

/** How long one request may stay unanswered before it fails, in milliseconds: the same 30-second bound the parity harness waits for a screen, a template or a submit, so a backend that accepts and never answers fails the application where it already fails the harness (AAP 0.10.5). Legacy waits for as long as its server takes, and this bound is the deliberate departure from that: Rule 1 clause 3's legacy match protects the calls, payloads, defaults and messages the parity comparison reads — none of which this touches — not a control a server that stopped answering can disable for good. */
const REQUEST_TIMEOUT_MS = 30_000;

/** What a request that ran out of time is reported with: its own sentence, so a user can tell a server that never answered from a request that was refused (AAP 0.7.2, AAP 0.10.5). */
const REQUEST_TIMED_OUT = 'The server did not answer in time. Try again in a moment.';

/** What the user is told once a refused credential has ended their session: plain English that names no key, tenant or URL, which is all a notice may carry (Rule 1 clause 9, AAP 0.10.5). */
const SESSION_ENDED_MESSAGE = 'Your session has ended. Sign in again to continue.';

/** Marks the one read this file sends to re-validate a refused credential: that read re-enters this interceptor, so the mark keeps it from starting a second recovery or raising a notice of its own (AAP 0.14.1). */
const SESSION_REVALIDATION = new HttpContextToken<boolean>(() => false);

/** The re-validation in flight, shared by every failure that arrives while it runs, so a burst of refusals from one screen costs exactly one extra request (AAP 0.14.2). */
let revalidation: Promise<boolean> | null = null;

/** The collaborators a recovery of a refused credential works through, read from the injection context of the request that failed. */
interface RecoveryDependencies {
  /** Owns `apiBaseUrl`, `apiPath` and the tenant, so no URL is composed here (AAP 0.4.2, AAP 0.14.1). */
  readonly config: AppConfigService;
  /** Sends the one re-validation read; this file is one of the seven that may hold `HttpClient` (AAP 0.14.1). */
  readonly http: HttpClient;
  /** Holds the session whose credential was refused; `clear()` ends it (AAP 0.7.1). */
  readonly session: SessionService;
  /** Supplies the attempted route as `returnUrl` and takes the user back to the login screen (AAP 0.4.2). */
  readonly router: Router;
  /** The single place a failure is reported to the user (AAP 0.4.2). */
  readonly notifications: NotificationService;
}

/** Attaches the tenant and Basic authorization headers to a Fineract call, bounds it, maps its failure into `ApiError`, ends the session and returns to the login screen with the attempted route on a 401 or a confirmed refusal, and raises one notification for a 5xx, a transport failure or a timeout. Nothing loose is left unmodelled here: the error `catchError` receives is `unknown` narrowed by a guard, and so is the body the re-validation reads, so the file holds no `any` (AAP 0.14.1, Rule 1 clause 4). */
export const fineractInterceptor: HttpInterceptorFn = (req, next) => {
  const config = inject(AppConfigService);
  const http = inject(HttpClient);
  const session = inject(SessionService);
  const router = inject(Router);
  const notifications = inject(NotificationService);

  const resolved = config.changes();

  if (resolved === null) {
    return next(req);
  }

  // The origin every service composes its URL from, closed with a `/` so the match ends on a segment boundary: a translation bundle at the application's own origin, and a path that merely begins with the same characters, are both outside the API (AAP 0.4.2, Rule 1 clause 9).
  const apiOrigin = `${resolved.apiBaseUrl.replace(/\/+$/, '')}/`;
  const isApiRequest = req.url.startsWith(apiOrigin);
  const isAuthenticationRequest = req.url === config.apiUrl(AUTHENTICATION_ENDPOINT);
  const isRevalidationRequest = req.context.get(SESSION_REVALIDATION);

  // The credential belongs to Fineract alone, so a request to any other origin carries neither header, and the exchange that asks for the credential carries none either (AAP 0.4.2, Rule 1 clause 9).
  const current = isApiRequest && !isAuthenticationRequest ? session.session() : null;

  let headers = req.headers;

  if (isApiRequest) {
    headers = headers.set(TENANT_HEADER, resolved.tenantId);
  }

  if (current !== null) {
    headers = headers.set(AUTHORIZATION_HEADER, `Basic ${current.authenticationKey}`);
  }

  return next(req.clone({ headers })).pipe(
    // Bounds the wait at both ends: `first` is the whole wait for the response and `each` the wait between two emissions. The two are passed as one object rather than as a bare number, because rxjs 7.8.2 reads a number as `each` alone, and a bound that does not depend on that reading is the point of stating it (AAP 0.10.5).
    timeout({ first: REQUEST_TIMEOUT_MS, each: REQUEST_TIMEOUT_MS }),
    catchError((cause: unknown): Observable<never> => {
      // Boundary (AAP 0.14.1, Rule 1 clause 4): this layer models a failed response and the timeout it sets itself, and nothing else — an error that is neither is not modelled here and crosses unchanged, for the operator that produced it to own.
      if (!(cause instanceof HttpErrorResponse) && !(cause instanceof TimeoutError)) {
        return throwError(() => cause);
      }

      const apiError =
        cause instanceof TimeoutError ? new ApiError(REQUEST_TIMED_OUT, 0) : toApiError(cause);

      // The re-validation re-enters this interceptor and is nobody's request to report: its outcome is the answer the recovery waits for, so a notice or a second recovery here would report one refusal twice (AAP 0.14.1).
      if (isRevalidationRequest) {
        return throwError(() => apiError);
      }

      if (cause instanceof TimeoutError) {
        // Status 0 is the transport-failure status `api-error.ts` documents, so a screen treats an unanswered request exactly like an unreachable host (AAP 0.7.2, AAP 0.10.5).
        notifications.show('error', apiError.message);
        return throwError(() => apiError);
      }

      if (cause.status === 401) {
        if (!isAuthenticationRequest) {
          session.clear();
          void returnToLogin(router, notifications);
        }
      } else if (cause.status === 0 && current !== null && router.navigated) {
        // Status 0 with a credential in hand is how this browser reports a refused key: the 401 Fineract sends carries no CORS header, so the branch above never sees it (AAP 0.4.2). Only a request made once the application has navigated qualifies, which keeps the start-up case with `SessionService.restore()` — that read already treats status 0 as a refusal and its guard redirect is the verified behaviour (AAP 0.1.1, AAP 0.7.3 W1). Legacy keeps the refused key in storage and leaves its screen blank, and this ends the session instead: Rule 1 clause 3's legacy match does not extend to a screen no user can recover from, and the refused-credential return this layer owes requires the session end the browser never reports as a 401.
        return from(
          recoverRefusedSession(current, apiError.message, {
            config,
            http,
            session,
            router,
            notifications,
          }),
        ).pipe(switchMap(() => throwError(() => apiError)));
      } else if (cause.status === 0 || cause.status >= 500) {
        notifications.show('error', apiError.message);
      }

      return throwError(() => apiError);
    }),
  );
};

/** Answers whether the credential a failed request carried still works, by reading the allowlisted `GET /users/{id}` the session restore already makes (AAP 0.7.3 W1): a resolution means the key still works, and any failure means Fineract refused it — the browser reports a refused key as status 0, because Fineract's 401 carries no CORS header, so the outcome of the read and not its status is the answer. A rejection is that answer and not a swallowed error: nothing else may act on why the read failed (AAP 0.14.2, Rule 1 clause 4). */
async function revalidateCredential(userId: number, deps: RecoveryDependencies): Promise<boolean> {
  revalidation ??= firstValueFrom(
    deps.http.get<unknown>(deps.config.apiUrl('users/' + userId), {
      context: new HttpContext().set(SESSION_REVALIDATION, true),
    }),
  )
    .then(
      () => true,
      () => false,
    )
    .finally(() => {
      revalidation = null;
    });

  return revalidation;
}

/** What became of a return to the login screen: it opened, it was not needed because the user is already there, or it was refused and is already reported in `navigationFailure`'s words. */
type LoginReturn = 'opened' | 'already-there' | 'refused';

/** Recovers from a credential the browser has just refused, in the order AAP 0.4.2 sets: re-validate the key once, keep the session while it still works, and otherwise end the session, return to the login screen carrying the attempted route and tell the user that signing in again is what continues (AAP 0.1.1, AAP 0.10.5). */
async function recoverRefusedSession(
  carried: SessionData,
  message: string,
  deps: RecoveryDependencies,
): Promise<void> {
  // A session that is no longer the one this request carried has already been ended — by a logout, by a 401, or by another failure of the same burst — so there is nothing left to end and only this failure to report.
  if (deps.session.session() !== carried) {
    deps.notifications.show('error', message);
    return;
  }

  const stillValid = await revalidateCredential(carried.userId, deps);

  if (stillValid) {
    // The key works, so the fault was the transport's: the session stays and only the failure is reported.
    deps.notifications.show('error', message);
    return;
  }

  if (deps.session.session() !== carried) {
    // Another failure of the burst ended this session and started the return to the login screen while the one re-validation they shared was running; that notice covers every failure which waited on it.
    return;
  }

  deps.session.clear();

  const returned = await returnToLogin(deps.router, deps.notifications);

  if (returned === 'opened') {
    deps.notifications.show('error', SESSION_ENDED_MESSAGE);
  } else if (returned === 'already-there') {
    // The refusal reached a user who is on the login screen already: no destination and no session end has to be explained, so the failure's own sentence is the one thing said (AAP 0.7.4).
    deps.notifications.show('error', message);
  }
}

/** Returns the user to the login screen carrying the route the failed request was for — the 401 contract (AAP 0.4.2), which a confirmed refusal takes as well: a navigation that lands needs nothing said, a refused one is reported once in `navigationFailure`'s own words, and a return attempted from the login screen itself is skipped because the user is already there. @returns what became of the return. */
function returnToLogin(router: Router, notifications: NotificationService): Promise<LoginReturn> {
  if (router.url.startsWith('/login')) {
    return Promise.resolve('already-there');
  }

  const navigation = router.navigate(['/login'], { queryParams: { returnUrl: router.url } });

  return navigation
    .catch((cause: unknown): boolean => {
      notifications.show('error', navigationFailure(cause, 'login screen').message);
      return false;
    })
    .then((opened: boolean): LoginReturn => (opened ? 'opened' : 'refused'));
}
