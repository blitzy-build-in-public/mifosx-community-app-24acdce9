/**
 * Behavioural spec for `authGuard` — the route guard in front of every authenticated screen
 * (AAP 0.7.1 core row "`authGuard`", AAP 0.4.2 "Security architecture", AAP 0.8.1 `auth.guard(+spec)`).
 *
 * **What the guard owes, and what is asserted here.** One decision and one answer: a session in
 * effect lets the navigation through, and its absence replaces the navigation with the login route
 * carrying the attempted URL. The cases below state that decision from every side a caller or a
 * refactor could break it from:
 *
 * - the session in effect answers exactly `true`, having asked `AuthService` once and built no
 *   redirect at all — a guard that allocated a tree on the happy path would be doing work the
 *   navigation discards;
 * - the absence of a session answers with a `UrlTree` and not a boolean, which is the difference
 *   between the router resolving a redirect inside the navigation the user started and the guard
 *   starting a second one;
 * - the redirect is `/login?returnUrl=%2Fviewclient%2F2` for an attempt at `/viewclient/2`: a query
 *   parameter, with the login route's segment carrying no matrix parameters, because the login screen
 *   reads the attempted route from `queryParams['returnUrl']` (AAP 0.7.4);
 * - an attempted URL that itself carries a query string arrives verbatim, as one parameter rather
 *   than being flattened into the redirect's own query — the search route
 *   (`/search/:query?scope=`) is exactly such a URL, so its `scope` must travel inside `returnUrl`;
 * - the guard never navigates: `Router.navigate` and `Router.navigateByUrl` are both untouched, since
 *   the tree is the whole contract (AAP 0.4.4 decision 3's "no second navigation racing the first").
 *
 * **Why the assertions go through the injected router.** The guard builds its answer with
 * `router.createUrlTree`, so serializing and parsing it with the *same* `Router` instance is what
 * makes the expected string and the parsed structure statements about the guard's own output rather
 * than about a serializer this file happened to construct. `Router` is retrieved with
 * `TestBed.inject(Router)` for that reason.
 *
 * **Hash-free URLs.** `app.config.ts` provides the router with `withHashLocation()`, so the
 * `RouterStateSnapshot.url` the guard receives is hash-relative and carries no `#` — which is why
 * every URL here is written in the hash-free form (`/viewclient/2`).
 *
 * **What this file deliberately does not cover.** `permissionGuard` has no spec in this folder: AAP
 * 0.8.1 and AAP 0.11.1 list `permission.guard` without a `+spec`, and its subject — the permission
 * algebra — is already proven by `permissions.service.spec.ts` and `has-permission.directive.spec.ts`.
 * The guard under test reads no route data, so no permission case belongs here.
 *
 * Nothing in this file assembles a session, names a host, an API path or a tenant, logs anything, or
 * carries a credential-shaped literal (Rule 1 clauses 2, 4 and 9; Rule 2). The `AuthService` stub
 * below answers one boolean and holds nothing else.
 */
import { TestBed } from '@angular/core/testing';
import {
  PRIMARY_OUTLET,
  RedirectCommand,
  Router,
  UrlTree,
  provideRouter,
  type ActivatedRouteSnapshot,
  type CanActivateFn,
  type RouterStateSnapshot,
} from '@angular/router';
import { Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

/** The client record route an unauthenticated user most often tries to reach; legacy `#/viewclient/2`. */
const CLIENT_VIEW_URL = '/viewclient/2';

/** An attempted route that carries a query string of its own, which must survive inside `returnUrl`. */
const SEARCH_URL = '/search/parity?scope=clients';

/** Where the guard sends an unauthenticated navigation (the guard's own `LOGIN_PATH`). */
const LOGIN_PATH = '/login';

/**
 * The query parameter the login screen reads the attempted route from (the guard's own
 * `RETURN_URL_PARAMETER`). Spelled out rather than imported: the guard keeps it private, and the name
 * is a contract with the login screen, so renaming it must fail here.
 */
const RETURN_URL_PARAMETER = 'returnUrl';

/**
 * The route the guard is handed. It is never read — the guard's parameter is `_route`, because one
 * guard covers the whole guarded subtree and the answer does not vary by route — so a snapshot-shaped
 * stand-in is cast to the framework type instead of assembling an activated-route tree for an
 * argument nothing consults.
 */
const UNREAD_ROUTE = {} as ActivatedRouteSnapshot;

/**
 * The `AuthService` question the guard asks, with the answer under the test's control.
 *
 * `vi.fn` records each call, so a case can assert the guard asked the session exactly once instead of
 * reading a second source of its own. Typed against the real class through `Pick`, so a renamed or
 * re-typed member fails to compile here rather than silently stubbing nothing (Rule 1 clause 4).
 */
class AuthStub implements Pick<AuthService, 'isAuthenticated'> {
  private signedIn = false;

  /** Whether a session is in effect, as the guard's only input. */
  readonly isAuthenticated = vi.fn((): boolean => this.signedIn);

  /** Puts a session in effect, the state a login produces. */
  signIn(): void {
    this.signedIn = true;
  }
}

/** The guard's synchronous answer: let the navigation through, or replace it with the login tree. */
type GuardAnswer = boolean | UrlTree;

/**
 * The router state the guard is handed for an attempt at `url`.
 *
 * Only `url` is consulted — it becomes the `returnUrl` — and the rest of the snapshot (the activated
 * route tree the guard's first parameter holds) is never read, so a snapshot-shaped literal is the
 * whole of what the contract needs. No navigation is performed to obtain a "real" one, because that
 * navigation is precisely the side effect the guard must not have.
 */
function stateFor(url: string): RouterStateSnapshot {
  return { url } as RouterStateSnapshot;
}

/**
 * Runs the guard in the injector `TestBed` built, so it injects `AuthService` and `Router` from the
 * providers the case configured.
 *
 * `CanActivateFn` admits two answers this guard must never give. It may answer asynchronously, where
 * the guard is synchronous; and it may answer with a `RedirectCommand` — Angular's navigation-command
 * form, which no Fineract screen uses, and which would tell the router how to resolve a redirect
 * instead of handing it the tree the login screen's `returnUrl` contract is written against. Both are
 * reported by name here, so a departure reads as itself rather than as a misleading "the guard allowed
 * the navigation" further down.
 */
function runGuard(state: RouterStateSnapshot): GuardAnswer {
  const answer: ReturnType<CanActivateFn> = TestBed.runInInjectionContext(() =>
    authGuard(UNREAD_ROUTE, state),
  );

  if (answer instanceof Promise || answer instanceof Observable) {
    throw new Error('authGuard answered asynchronously; the guard answers with a boolean or a UrlTree');
  }

  if (answer instanceof RedirectCommand) {
    throw new Error('authGuard answered with a RedirectCommand; the guard returns the login UrlTree');
  }

  return answer;
}

/**
 * The denial answer, narrowed without a cast, so a guard that started allowing the navigation fails
 * with a message that says so instead of a type error.
 */
function asUrlTree(answer: GuardAnswer): UrlTree {
  if (!(answer instanceof UrlTree)) {
    throw new Error(`authGuard allowed the navigation instead of denying it: ${String(answer)}`);
  }

  return answer;
}

/** The `Router` the guard injected, so every assertion reads the guard's own output. */
function router(): Router {
  return TestBed.inject(Router);
}

describe('authGuard', () => {
  let auth: AuthStub;

  beforeEach(() => {
    // A fresh injector per case: a session put in effect by one case must never reach the next, and a
    // second `configureTestingModule` on an instantiated module throws.
    TestBed.resetTestingModule();
    auth = new AuthStub();

    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    });
  });

  it('lets the navigation through when a session is in effect', () => {
    auth.signIn();

    expect(runGuard(stateFor(CLIENT_VIEW_URL))).toBe(true);
    expect(auth.isAuthenticated).toHaveBeenCalledTimes(1);
  });

  it('builds no redirect tree while the session is in effect', () => {
    // The happy path answers before the router is asked for anything: a tree built here would be a
    // redirect the navigation discards, and would mean the session check ran after the tree was made.
    const createUrlTree = vi.spyOn(router(), 'createUrlTree');
    auth.signIn();

    expect(runGuard(stateFor(CLIENT_VIEW_URL))).toBe(true);
    expect(createUrlTree).not.toHaveBeenCalled();
  });

  it('answers with a UrlTree, not a boolean, when no session is in effect', () => {
    const answer = runGuard(stateFor(CLIENT_VIEW_URL));

    expect(answer).toBeInstanceOf(UrlTree);
    expect(answer).not.toBe(true);
    expect(typeof answer).toBe('object');
  });

  it('sends an unauthenticated navigation to the login route with the attempted URL as returnUrl', () => {
    const tree = asUrlTree(runGuard(stateFor(CLIENT_VIEW_URL)));

    // The encoding is the tree's own — `createUrlTree` encodes the value — so this address is what
    // the browser shows once the router resolves the guard's answer (AAP 0.4.4 decision 3).
    expect(router().serializeUrl(tree)).toBe('/login?returnUrl=%2Fviewclient%2F2');
  });

  it('carries the attempted URL as a query parameter on the login segment, not as a matrix parameter', () => {
    const tree = asUrlTree(runGuard(stateFor(CLIENT_VIEW_URL)));
    const parsed = router().parseUrl(router().serializeUrl(tree));

    // `/login;returnUrl=…` would satisfy a string comparison of the path alone but be unreadable by
    // the login screen, so the segment itself must be bare and the value must be a query parameter.
    const loginSegment = parsed.root.children[PRIMARY_OUTLET].segments;
    expect(loginSegment.map((segment) => segment.path)).toEqual(['login']);
    expect(loginSegment[0].parameters).toEqual({});
    expect(Object.keys(parsed.queryParams)).toEqual([RETURN_URL_PARAMETER]);
    expect(parsed.queryParamMap.getAll(RETURN_URL_PARAMETER)).toEqual([CLIENT_VIEW_URL]);
    expect(parsed.fragment).toBeNull();
  });

  it('carries an attempted URL that has its own query string verbatim', () => {
    const tree = asUrlTree(runGuard(stateFor(SEARCH_URL)));
    const serialized = router().serializeUrl(tree);

    // The attempted URL travels as one parameter, encoding included: its own `?scope=clients` does not
    // become a parameter of the login URL, which would lose it from `returnUrl` and replay the wrong
    // route after a successful sign-in.
    expect(serialized).toBe(`${LOGIN_PATH}?${RETURN_URL_PARAMETER}=${encodeURIComponent(SEARCH_URL)}`);

    const parsed = router().parseUrl(serialized);
    expect(parsed.queryParamMap.getAll(RETURN_URL_PARAMETER)).toEqual([SEARCH_URL]);
    expect(parsed.queryParamMap.has('scope')).toBe(false);
  });

  it('denies by returning the tree instead of navigating', () => {
    const navigate = vi.spyOn(router(), 'navigate');
    const navigateByUrl = vi.spyOn(router(), 'navigateByUrl');

    expect(runGuard(stateFor(CLIENT_VIEW_URL))).toBeInstanceOf(UrlTree);

    // A guard that navigated would race the navigation it was called from and lose the guard's own
    // answer; the tree is the whole contract (AAP 0.4.2, AAP 0.4.4 decision 3).
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });
});
