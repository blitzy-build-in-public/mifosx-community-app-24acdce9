/** The route guard in front of every authenticated screen (AAP 0.7.1 `authGuard`, AAP 0.4.2): it asserts one thing — that a session is in effect, which is the whole of legacy's gate (`app/scripts/services/SessionManager.js:37-48`) — and returns the `/login?returnUrl=…` tree rather than navigating, so the login screen replays the attempted route (AAP 0.7.4). */
import { inject } from '@angular/core';
import {
  Router,
  type ActivatedRouteSnapshot,
  type CanActivateFn,
  type RouterStateSnapshot,
  type UrlTree,
} from '@angular/router';

import { AuthService } from './auth.service';

/** Where an unauthenticated navigation is sent; `login` sits beside the shell in `app.routes.ts` (AAP 0.8.2). */
const LOGIN_PATH = '/login';

/** The query parameter the login screen reads the attempted route from and replays (AAP 0.7.4). */
const RETURN_URL_PARAMETER = 'returnUrl';

/** Allows the navigation when a session is in effect, and otherwise replaces it with the login route carrying the attempted URL as `returnUrl`. */
export const authGuard: CanActivateFn = (
  _route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
): boolean | UrlTree => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree([LOGIN_PATH], {
    queryParams: { [RETURN_URL_PARAMETER]: state.url },
  });
};
