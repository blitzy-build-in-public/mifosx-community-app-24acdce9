/**
 * The application's single HTTP interceptor (AAP 0.4.2, 0.7.1, 0.14.1; Rule 1 clause 5): it owns the two
 * headers every Fineract call carries and the mapping of a failed response into `ApiError`, and nothing
 * else — no logging, retry, cache, metrics or second interceptor.
 *
 * **Two headers, no third.** `Fineract-Platform-TenantId` carries the resolved configuration's tenant on
 * every request; `Authorization: Basic <authenticationKey>` carries the session in effect, which the
 * authentication request itself does not send — the pairing the legacy provider applied
 * (`app/scripts/services/HttpServiceProvider.js:42-53`), removal on sign-out being automatic here
 * because the header is derived from the session rather than stored.
 *
 * **No URL rewriting.** Only the headers change, which keeps `npm run check:endpoints` a true statement
 * about the application and the parity harness's host assertion meaningful (AAP 0.4.2). Before the
 * configuration resolves, a request passes through untouched (AAP 0.7.1). The 401 redirect preserving the
 * attempted route and the single notification for a 5xx or transport failure are deliberate differences
 * from legacy registered in the plan, not defects to remove (AAP 0.7.4, 0.10.5).
 */
import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { SessionService } from '../auth/session.service';
import { AppConfigService } from '../config/app-config.service';
import { NotificationService } from '../notifications/notification.service';
import { navigationFailure, toApiError } from './api-error';

/** Tenant header every Fineract request carries; the value is the resolved configuration's `tenantId`. */
const TENANT_HEADER = 'Fineract-Platform-TenantId';

/** Credential header carrying the session's Basic key; absent whenever no session is in effect. */
const AUTHORIZATION_HEADER = 'Authorization';

/** The one allowlisted endpoint this file names, resolved through `apiUrl()` and never composed here. */
const AUTHENTICATION_ENDPOINT = 'authentication';

/**
 * Attaches the tenant and Basic authorization headers, maps failures into `ApiError`, ends the session and
 * returns to the login screen on a 401, and raises one notification for a 5xx or transport failure.
 */
export const fineractInterceptor: HttpInterceptorFn = (req, next) => {
  const config = inject(AppConfigService);
  const session = inject(SessionService);
  const router = inject(Router);
  const notifications = inject(NotificationService);

  const resolved = config.changes();

  if (resolved === null) {
    // Bootstrap is resolving the configuration this request may be part of, so nothing is read from it.
    return next(req);
  }

  const isAuthenticationRequest = req.url === config.apiUrl(AUTHENTICATION_ENDPOINT);

  let headers = req.headers.set(TENANT_HEADER, resolved.tenantId);
  const current = isAuthenticationRequest ? null : session.session();

  if (current !== null) {
    headers = headers.set(AUTHORIZATION_HEADER, `Basic ${current.authenticationKey}`);
  }

  // Headers alone: URL, method and query parameters reach the handler as the service composed them.
  return next(req.clone({ headers })).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) {
        return throwError(() => error);
      }

      const apiError = toApiError(error);

      if (error.status === 401) {
        // A refused authentication is the login screen's own message, and the user is already there.
        if (!isAuthenticationRequest) {
          session.clear();

          // Left to the login screen while it is showing, rather than re-navigating it into a loop.
          if (!router.url.startsWith('/login')) {
            // Settled rather than dropped: a navigation the router refuses would otherwise be an
            // unhandled rejection, and the user is told the return to the login screen did not
            // happen instead of being left on a screen the ended session can no longer serve. The
            // text is the navigation sentence naming that screen, because a refused navigation
            // carries no server text, and the router's own wording names nothing an operator acts
            // on (`api-error.ts` `navigationFailure`).
            void router
              .navigate(['/login'], { queryParams: { returnUrl: router.url } })
              .catch((cause: unknown) => {
                notifications.show('error', navigationFailure(cause, 'login screen').message);
              });
          }
        }
      } else if (error.status === 0 || error.status >= 500) {
        // One notice for a failure no screen can render itself; a 4xx reaches the caller alone.
        notifications.show('error', apiError.message);
      }

      return throwError(() => apiError);
    }),
  );
};
