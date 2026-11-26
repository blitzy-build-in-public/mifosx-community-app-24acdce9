/** Behavioural spec for `authGuard` — the route guard in front of every authenticated screen (AAP 0.7.1 core row "`authGuard`", AAP 0.4.2 "Security architecture", AAP 0.8.1 `auth.guard(+spec)`). */
import { TestBed } from '@angular/core/testing';
import {
  PRIMARY_OUTLET, RedirectCommand, Router, UrlTree, provideRouter, type ActivatedRouteSnapshot, type CanActivateFn,
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

/** The query parameter the login screen reads the attempted route from (the guard's own `RETURN_URL_PARAMETER`). */
const RETURN_URL_PARAMETER = 'returnUrl';

/** The route the guard is handed. It is never read — the guard's parameter is `_route`. */
const UNREAD_ROUTE = {} as ActivatedRouteSnapshot;

/** The `AuthService` question the guard asks, with the answer under the test's control. `vi.fn` records each call. */
class AuthStub implements Pick<AuthService, 'isAuthenticated'> {
  private signedIn = false;

  /** The error the read should raise instead of answering, or `null` while it answers. */
  private failure: Error | null = null;

  /** Whether a session is in effect, as the guard's only input. */
  readonly isAuthenticated = vi.fn((): boolean => {
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.signedIn;
  });

  /** Puts a session in effect, the state a login produces. */
  signIn(): void {
    this.signedIn = true;
  }

  /** Makes the session read raise `error` — the failure no guard clause can answer for. */
  failReadsWith(error: Error): void {
    this.failure = error;
  }

  /** Lets the session read answer again, the state after a transient failure has passed. */
  stopFailing(): void {
    this.failure = null;
  }
}

/** The guard's synchronous answer: let the navigation through, or replace it with the login tree. */
type GuardAnswer = boolean | UrlTree;

/** The router state the guard is handed for an attempt at `url`. */
function stateFor(url: string): RouterStateSnapshot {
  return { url } as RouterStateSnapshot;
}

/** Runs the guard in the injector `TestBed` built, so it injects `AuthService` and `Router` from the providers the case configured. */
function runGuard(state: RouterStateSnapshot): GuardAnswer {
  const answer: ReturnType<CanActivateFn> = TestBed.runInInjectionContext(() =>
    authGuard(UNREAD_ROUTE, state), );
  if (answer instanceof Promise || answer instanceof Observable) {
    throw new Error('authGuard answered asynchronously; the guard answers with a boolean or a UrlTree');
  }
  if (answer instanceof RedirectCommand) {
    throw new Error('authGuard answered with a RedirectCommand; the guard returns the login UrlTree');
  }
  return answer;
}

/** The denial answer, narrowed without a cast, so a guard that started allowing the navigation fails with a message that says so instead of a type error. */
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
    // A fresh injector per case: a session put in effect by one case must never reach the next, and a second `configureTestingModule` on an instantiated module throws.
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
    // The happy path answers before the router is asked for anything: a tree built here would be a redirect the navigation discards, and would mean the session check ran after the tree was made.
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

    // The encoding is the tree's own — `createUrlTree` encodes the value — so this address is what the browser shows once the router resolves the guard's answer (AAP 0.4.4 decision 3).
    expect(router().serializeUrl(tree)).toBe('/login?returnUrl=%2Fviewclient%2F2');
  });

  it('carries the attempted URL as a query parameter on the login segment, not as a matrix parameter', () => {
    const tree = asUrlTree(runGuard(stateFor(CLIENT_VIEW_URL)));
    const parsed = router().parseUrl(router().serializeUrl(tree));

    // `/login;returnUrl=…` would satisfy a string comparison of the path alone but be unreadable by the login screen, so the segment itself must be bare and the value must be a query parameter.
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

    // The attempted URL travels as one parameter, encoding included: its own `?scope=clients` does not become a parameter of the login URL, which would lose it from `returnUrl` and replay the wrong route after a successful.
    expect(serialized).toBe(`${LOGIN_PATH}?${RETURN_URL_PARAMETER}=${encodeURIComponent(SEARCH_URL)}`);

    const parsed = router().parseUrl(serialized);
    expect(parsed.queryParamMap.getAll(RETURN_URL_PARAMETER)).toEqual([SEARCH_URL]);
    expect(parsed.queryParamMap.has('scope')).toBe(false);
  });

  it('denies by returning the tree instead of navigating', () => {
    const navigate = vi.spyOn(router(), 'navigate');
    const navigateByUrl = vi.spyOn(router(), 'navigateByUrl');

    expect(runGuard(stateFor(CLIENT_VIEW_URL))).toBeInstanceOf(UrlTree);

    // A guard that navigated would race the navigation it was called from and lose the guard's own answer; the tree is the whole contract (AAP 0.4.2, AAP 0.4.4 decision 3).
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('lets a throwing session read propagate, with no answer and no navigation, and holds no error state', () => {
    const failure = new Error('the session read failed');
    const navigate = vi.spyOn(router(), 'navigate');
    const navigateByUrl = vi.spyOn(router(), 'navigateByUrl');
    auth.failReadsWith(failure);

    let answer: GuardAnswer | null = null;
    let thrown: Error | null = null;

    try {
      answer = runGuard(stateFor(CLIENT_VIEW_URL));
    } catch (error: unknown) {
      thrown = error instanceof Error ? error : null;
    }

    // The read is unwrapped, so the very instance the session raised is what leaves the guard.
    expect(thrown).toBe(failure);
    // No answer at all — neither `true` nor a tree — so the navigation never proceeds authenticated.
    expect(answer).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();

    // The failure belongs to the read and not to the guard: with the read answering again, the guard gives the ordinary denial answer, so it carries no error state from one call to the next.
    auth.stopFailing();

    expect(router().serializeUrl(asUrlTree(runGuard(stateFor(CLIENT_VIEW_URL))))).toBe(
      '/login?returnUrl=%2Fviewclient%2F2',
    );
  });
});
