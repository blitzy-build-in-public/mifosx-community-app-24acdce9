/**
 * The route guard in front of every authenticated screen (AAP 0.7.1 core row "`authGuard`",
 * AAP 0.4.2 "Security architecture", AAP 0.7.4 login requirement).
 *
 * **What it asserts.** One thing — that a session is in effect — because that is the whole of the
 * legacy gate: `SessionManager` restores a session only when a stored entry exists
 * (`app/scripts/services/SessionManager.js:37-48`), and every screen behind the shell is then driven
 * by the calls the interceptor authorises. Rule 1 clause 3 holds it at exactly that: no role or
 * permission test (that is `permission.guard.ts`, reading `route.data.permission`), no expiry test,
 * no attempt to restore or refresh a session, and no other fallback route.
 *
 * **Why the answer is a `UrlTree` and not a navigation.** A guard's return value is what the router
 * resolves, so returning the tree redirects inside the navigation the user started: the address bar
 * becomes `/login?returnUrl=…` as one resolution, with no second navigation racing the first and no
 * `router.navigate` fired from inside a guard. The login screen replays that `returnUrl` after a
 * successful sign-in — the "attempted route or `#/clients`" rule of AAP 0.7.4 — and the parameter is
 * handed over undecoded and unprefixed, because `createUrlTree` does the encoding: `/viewclient/2`
 * arrives as `/login?returnUrl=%2Fviewclient%2F2`.
 *
 * **What it reads.** `AuthService.isAuthenticated()`: the single source every other gate and the
 * interceptor consult. Injecting `SessionService` here instead would put a second path to the same
 * truth inside the routing layer. Its answer is legacy's own notion of being signed in — the presence
 * of the stored entry — so a returning user passes on the first navigation, before any restore has
 * revalidated the session, which is the reload case of workflow W1.
 *
 * **Why the read is not wrapped.** It is a plain signal read, with no request, no parse and no
 * fallible step of its own, so a `catch` around it could only do the one thing this guard must never
 * do: convert an unexpected error into a silent login redirect. A read that throws therefore
 * propagates out of the guard and aborts the navigation, which never proceeds as authenticated —
 * `auth.guard.spec.ts` pins the propagation and the absence of a redirect.
 *
 * **What it never does.** It logs nothing, reads no key, and names no host, API path or tenant
 * (Rule 1 clause 9, Rule 2). It also needs no check for the login route itself: `app.routes.ts`
 * declares `login` beside the guarded layout route rather than beneath it, so the guard never runs
 * for it.
 */
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

/**
 * Allows the navigation when a session is in effect, and otherwise replaces it with the login route
 * carrying the attempted URL.
 *
 * A plain function rather than a guard service, with both dependencies injected in the body from the
 * navigation's own injection context (Rule 1 clause 5).
 *
 * @param _route the matched route being activated; unread, because one guard covers the whole guarded
 * subtree and the session decision does not vary by route.
 * @param state the router state being activated; its `url` is the hash-relative path
 * (`/viewclient/2`), which becomes the `returnUrl` the login screen replays after signing in.
 * @returns `true` to let the navigation continue, or the `/login?returnUrl=…` tree that replaces it.
 */
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
