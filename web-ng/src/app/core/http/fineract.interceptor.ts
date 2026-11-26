/** The application's single HTTP interceptor (AAP 0.4.2, AAP 0.7.1, AAP 0.14.1; Rule 1 clause 5): it owns the two headers every Fineract call carries — `Fineract-Platform-TenantId` and `Authorization: Basic (AAP 0.7.4, AAP 0.10.5). */
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

/** Attaches the tenant and Basic authorization headers, maps failures into `ApiError`, ends the session and returns to the login screen on a 401, and raises one notification for a 5xx or transport failure. */
export const fineractInterceptor: HttpInterceptorFn = (req, next) => {
  const config = inject(AppConfigService);
  const session = inject(SessionService);
  const router = inject(Router);
  const notifications = inject(NotificationService);

  const resolved = config.changes();

  if (resolved === null) {
    return next(req);
  }

  const isAuthenticationRequest = req.url === config.apiUrl(AUTHENTICATION_ENDPOINT);

  let headers = req.headers.set(TENANT_HEADER, resolved.tenantId);
  const current = isAuthenticationRequest ? null : session.session();

  if (current !== null) {
    headers = headers.set(AUTHORIZATION_HEADER, `Basic ${current.authenticationKey}`);
  }

  return next(req.clone({ headers })).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) {
        return throwError(() => error);
      }

      const apiError = toApiError(error);

      if (error.status === 401) {
        if (!isAuthenticationRequest) {
          session.clear();

          if (!router.url.startsWith('/login')) {
            void router
              .navigate(['/login'], { queryParams: { returnUrl: router.url } })
              .catch((cause: unknown) => {
                notifications.show('error', navigationFailure(cause, 'login screen').message);
              });
          }
        }
      } else if (error.status === 0 || error.status >= 500) {
        notifications.show('error', apiError.message);
      }

      return throwError(() => apiError);
    }),
  );
};
