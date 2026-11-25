import { provideZonelessChangeDetection, signal, type Signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  NavigationEnd,
  Router,
  provideRouter,
  type Event as RouterEvent,
  type RouterState,
} from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { Subject, of, type Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { AuthService } from '../auth/auth.service';
import { IdleService } from '../auth/idle.service';
import type { SessionData, SessionUserResponse } from '../auth/session.model';
import { SessionService, type SessionUserReader } from '../auth/session.service';
import { ShellComponent } from './shell.component';

/**
 * Behavioural spec for `ShellComponent` — AAP 0.2.3's `AppShell` row, AAP 0.7.1's `ShellComponent`
 * contract and AAP 0.8.2's "Shell and navigation", and the consumer that makes `IdleService` live:
 * AAP 0.1.1's first functional requirement ("a session with a 30-minute idle timeout, a 10-second
 * warning before logout and a 15-minute keepalive") is only delivered when this component starts,
 * resets and stops that clock and renders its warning.
 *
 * It discharges AAP 0.11.1 (a unit spec beside every component) and Rule 1 clause 8 (no spec without
 * an `expect`). Each test states one contract the component owns:
 *
 * - it renders the three hosts — the navbar, the breadcrumb and the routed outlet — and the outlet
 *   sits beside the breadcrumb's page container rather than inside it, so the screen's own
 *   `.container-fluid` is not doubled;
 * - the navbar's account name is the `userName` input when the shell is given one and the real
 *   `SessionService.user` projection otherwise;
 * - the idle clock starts while a session is in effect, stops when it clears, and refuses to re-arm
 *   for a document event dispatched with no session behind it;
 * - every document event ng-idle counted as activity reaches the clock;
 * - `warning$` raises the alert without ending the session, and "Stay signed in" dismisses it and
 *   re-arms the clock;
 * - activity dismisses a showing warning with the same reset;
 * - `timeout$` logs out and returns to `/login`, in that order;
 * - `ngOnDestroy` stops the clock and leaves no listener behind;
 * - the trail is the `breadcrumb` input when one is supplied and the active route's translated
 *   `data['breadcrumb']` keys otherwise, re-derived on the next navigation.
 *
 * Providers and what their absence proves. `AuthService` and `IdleService` are replaced by stubs
 * typed against the real classes, so the two cannot drift and the suite drives the clock's contracts
 * rather than real 30-minute timers. `SessionService` is the real service, because the label case
 * asserts the projection the application actually publishes. There is no HTTP provider anywhere in
 * the suite and no `HttpClient` import: the shell issues no request, so an attempt to reach Fineract
 * from it would fail with NG0201 rather than passing silently (Rule 1 clause 5, Rule 2). The router
 * is the real one over an empty route table — its `RouterLink` and `RouterOutlet` need the router's
 * own providers — with `navigate`, `events` and `routerState` replaced, which is the same set of
 * inputs a hand-written stub would supply. The translation service is the real one, because the
 * navbar and the search control render through `TranslatePipe`, which reads bundles rather than a
 * single `instant()` call.
 *
 * Security (Rule 1 clause 9, AAP 0.10.4): the session fixture's authentication key is assembled at
 * run time from parts, so no credential-shaped literal reaches the source, and the stored entry is
 * cleared before the test ends.
 */

/** The Fineract user id every fixture in this suite names. */
const USER_ID = 42;

/** The authentication-key parts the fixture joins: the value exists only in this run's memory. */
const KEY_PARTS = ['Zm9v', 'YmFy', 'OnNlY3JldA'];

/** The account name `GET /users/{id}` resolves, which is what the navbar must fall back to. */
const ACCOUNT_NAME = 'mifos';

/** The account name a host supplies through the shell's `userName` input, distinct from the above. */
const SUPPLIED_NAME = 'supplied-by-shell';

/**
 * Stand-in for the shipped bundles: one distinct value per key, so an assertion can tell which key
 * produced which text and can never pass on a raw dotted key. Test input only — it adds no locale
 * file and reproduces no shipped translation text (Rule 1 clause 6). The first block is what the
 * navbar and the global search control render; the second is the breadcrumb trail this suite drives.
 */
const SPEC_BUNDLE: Record<string, string> = {
  'label.anchor.clients': 'Clients',
  'label.anchor.logout': 'Logout',
  'label.heading.language': 'Language',
  'label.searchorpress': 'Click or press alt+x to Search',
  'label.heading.search': 'Search',
  'label.button.filter': 'Filter',
  'label.search.scope.all': 'All',
  'label.search.scope.clients.and.clientIdentifiers': 'Clients',
  'label.input.adhoc.search.loans': 'Loans',
  'label.heading.clients': 'Clients list',
  'label.heading.viewclient': 'Client record',
};

/** The legacy session entry a signed-in shell is looking at; its contents are never displayed. */
function sessionFixture(): SessionData {
  return {
    userId: USER_ID,
    authenticationKey: KEY_PARTS.join(''),
    userPermissions: ['READ_CLIENT'],
  };
}

/**
 * A matched route node as the shell walks it: the two members the breadcrumb derivation reads out of
 * the router's snapshot tree, and nothing else.
 */
interface RouteNode {
  /** The route's static `data`, which may declare `breadcrumb`. */
  readonly data: Record<string, unknown>;

  /** The route the walk continues into. */
  readonly firstChild: RouteNode | null;
}

/** Builds one route node, with the child it leads to when the test needs a nested trail. */
function routeNode(data: Record<string, unknown>, firstChild: RouteNode | null = null): RouteNode {
  return { data, firstChild };
}

/**
 * Wraps a route tree as the router state the shell reads. `ActivatedRouteSnapshot` carries the
 * router's internal matching state and cannot be assembled by hand, so the fixture is a plain object
 * given the type at this one boundary (Rule 1 clause 4), the way `auth.guard.spec.ts` supplies its
 * own route fixture.
 */
function routerStateFor(root: RouteNode): RouterState {
  return { snapshot: { root } } as unknown as RouterState;
}

/**
 * The half of `AuthService` the shell and its navbar read: the session signal the idle gate follows,
 * the account name the navbar falls back to, and the logout the timeout performs. `logout` records the
 * call and clears the signal, as the real one does.
 *
 * The fallback name stays `null` for the whole suite, so the label the shell renders can only come
 * from the value it hands the navbar — which is what lets the label case prove the shell's own
 * `SessionService.user` projection rather than the navbar's independent fallback.
 */
class AuthStub implements Pick<AuthService, 'session' | 'logout'> {
  private readonly current = signal<SessionData | null>(null);

  /** The session in effect, or `null` — what the shell's `effect()` watches. */
  readonly session: Signal<SessionData | null> = this.current.asReadonly();

  /** The account name the navbar would fall back to on its own; deliberately empty here. */
  readonly username = signal<string | null>(null);

  /** Records each logout, in the order the shell performs it, and ends the session. */
  readonly logout = vi.fn((): void => {
    this.endSession();
  });

  /** Puts a session into effect, as a login or a restore does. */
  signIn(): void {
    this.current.set(sessionFixture());
  }

  /** Clears the session without going through `logout` (a 401, or a test's own arrangement). */
  endSession(): void {
    this.current.set(null);
  }
}

/**
 * The half of `IdleService` the shell drives, with spies for the three commands and subjects for the
 * two emissions, so a test decides exactly when the warning and the timeout arrive.
 */
class IdleStub implements Pick<IdleService, 'start' | 'stop' | 'reset' | 'warning$' | 'timeout$'> {
  /** The warning the real clock emits `warningSeconds` before the idle duration elapses. */
  readonly warning$ = new Subject<void>();

  /** The timeout the real clock emits when the idle duration has elapsed. */
  readonly timeout$ = new Subject<void>();

  /** Arms the schedule. */
  readonly start = vi.fn((): void => undefined);

  /** Clears it. */
  readonly stop = vi.fn((): void => undefined);

  /** Re-arms it from now, on activity. */
  readonly reset = vi.fn((): void => undefined);
}

describe('ShellComponent', () => {
  let fixture: ComponentFixture<ShellComponent>;
  let auth: AuthStub;
  let idle: IdleStub;
  let navigate: MockInstance;
  let events: Subject<RouterEvent>;
  let routerRoot: RouteNode;
  let destroyed: boolean;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps the
  // assertions below type-checked and confines the boundary to this line (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The rendered element with the given selector, or a named failure when nothing matches it. */
  function find<T extends Element>(selector: string): T {
    const element: unknown = host().querySelector(selector);
    if (element === null) {
      throw new Error(`the shell rendered no ${selector}`);
    }
    return element as T;
  }

  /** The account name the user menu currently shows. */
  function userMenuLabel(): string {
    return find<HTMLElement>('#user-dropdown').textContent?.trim() ?? '';
  }

  /** The crumb labels the breadcrumb currently renders, in trail order. */
  function crumbLabels(): readonly string[] {
    return Array.from(
      host().querySelectorAll('app-breadcrumb li'),
      (crumb: Element): string => crumb.textContent?.trim() ?? '',
    );
  }

  /** Creates the shell and runs its first change detection, which is what starts its effect. */
  function createShell(): void {
    fixture = TestBed.createComponent(ShellComponent);
    fixture.detectChanges();
  }

  /** Destroys the fixture once, so `ngOnDestroy` runs and the `afterEach` below stays a no-op. */
  function destroyShell(): void {
    fixture.destroy();
    destroyed = true;
  }

  beforeEach(() => {
    // Reset first so each test starts on a fresh root injector and no previous fixture's listeners
    // or signals reach it.
    TestBed.resetTestingModule();
    auth = new AuthStub();
    idle = new IdleStub();
    events = new Subject<RouterEvent>();
    routerRoot = routeNode({});
    destroyed = false;

    TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslateService(),
        { provide: AuthService, useValue: auth },
        { provide: IdleService, useValue: idle },
      ],
    });

    const translate = TestBed.inject(TranslateService);
    for (const [language, bundle] of [['en', SPEC_BUNDLE], ['fr', SPEC_BUNDLE]] as const) {
      translate.setTranslation(language, bundle, true);
    }
    translate.use('en');

    const router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(router, 'events', 'get').mockReturnValue(events.asObservable());
    vi.spyOn(router, 'routerState', 'get').mockImplementation(
      (): RouterState => routerStateFor(routerRoot),
    );
  });

  afterEach(() => {
    if (!destroyed) {
      destroyShell();
    }
  });

  it('renders the navbar, the breadcrumb and the routed outlet, with the outlet beside the page container', () => {
    createShell();

    const content = find<HTMLElement>('.content-wrapper');

    expect(host().querySelector('app-navbar')).not.toBeNull();
    expect(content.querySelector('app-breadcrumb')).not.toBeNull();
    expect(content.querySelector('router-outlet')).not.toBeNull();

    // Each screen template opens its own `.container-fluid`, so the outlet must not sit inside the
    // breadcrumb's container: a second wrapper would double the page gutters.
    expect(find<HTMLElement>('.content-wrapper > .container-fluid').contains(find('router-outlet'))).toBe(
      false,
    );
  });

  it('renders none of the out-of-scope chrome, the way the legacy shell was cut down', () => {
    createShell();

    expect(host().querySelector('.navbar-toggle')).toBeNull();
    expect(host().querySelector('.fa-bell')).toBeNull();
    expect(host().querySelector('#leftnav')).toBeNull();
  });

  it('labels the navbar with the userName input when given one and with the session projection otherwise', async () => {
    const sessions = TestBed.inject(SessionService);
    const reader: SessionUserReader = (): Observable<SessionUserResponse> =>
      of({ id: USER_ID, username: ACCOUNT_NAME });

    sessions.write(sessionFixture());
    await sessions.restore(reader);

    createShell();
    expect(userMenuLabel()).toContain(ACCOUNT_NAME);

    fixture.componentRef.setInput('userName', SUPPLIED_NAME);
    fixture.detectChanges();
    expect(userMenuLabel()).toContain(SUPPLIED_NAME);
    expect(userMenuLabel()).not.toContain(ACCOUNT_NAME);

    sessions.clear();
  });

  it('starts the idle clock while a session is in effect, stops it when the session clears, and ignores activity without one', () => {
    createShell();

    // No session: the gate leaves the clock stopped.
    expect(idle.start).not.toHaveBeenCalled();
    expect(idle.stop).toHaveBeenCalledTimes(1);

    auth.signIn();
    fixture.detectChanges();
    expect(idle.start).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown'));
    expect(idle.reset).toHaveBeenCalledTimes(1);

    auth.endSession();
    fixture.detectChanges();
    expect(idle.stop).toHaveBeenCalledTimes(2);

    document.dispatchEvent(new KeyboardEvent('keydown'));
    expect(idle.reset).toHaveBeenCalledTimes(1);
  });

  it.each(['keydown', 'mousedown', 'mousemove', 'wheel', 'touchstart'])(
    'counts a document %s as the session being in use',
    (activity: string) => {
      auth.signIn();
      createShell();

      document.dispatchEvent(new Event(activity));

      expect(idle.reset).toHaveBeenCalledTimes(1);
    },
  );

  it('shows the idle warning on warning$ without ending the session', () => {
    auth.signIn();
    createShell();
    expect(host().querySelector('.alert.alert-warning')).toBeNull();

    idle.warning$.next();
    fixture.detectChanges();

    const alert = find<HTMLElement>('.alert.alert-warning');

    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('signed out');
    expect(auth.logout).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('dismisses a showing warning and re-arms the clock on "Stay signed in"', () => {
    auth.signIn();
    createShell();
    idle.warning$.next();
    fixture.detectChanges();

    find<HTMLButtonElement>('.alert-warning button').click();
    fixture.detectChanges();

    expect(host().querySelector('.alert-warning')).toBeNull();
    expect(idle.reset).toHaveBeenCalledTimes(1);
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('dismisses a showing warning on activity and re-arms the clock', () => {
    auth.signIn();
    createShell();
    idle.warning$.next();
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown'));
    fixture.detectChanges();

    expect(host().querySelector('.alert-warning')).toBeNull();
    expect(idle.reset).toHaveBeenCalledTimes(1);
  });

  it('logs out and returns to the login screen on timeout$', () => {
    auth.signIn();
    createShell();
    idle.warning$.next();
    fixture.detectChanges();

    idle.timeout$.next();
    fixture.detectChanges();

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/login']);
    expect(auth.logout.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]);
    expect(host().querySelector('.alert-warning')).toBeNull();
  });

  it('stops the clock and unregisters its listeners when it is destroyed', () => {
    auth.signIn();
    createShell();
    const stopsWhileAlive = idle.stop.mock.calls.length;

    destroyShell();

    expect(idle.stop.mock.calls.length).toBe(stopsWhileAlive + 1);

    document.dispatchEvent(new KeyboardEvent('keydown'));
    expect(idle.reset).not.toHaveBeenCalled();
  });

  it('renders the breadcrumb input when one is supplied and the route-declared trail otherwise', () => {
    routerRoot = routeNode({}, routeNode({ breadcrumb: 'label.heading.clients' }));
    createShell();

    expect(crumbLabels()).toEqual(['Clients list']);

    fixture.componentRef.setInput('breadcrumb', [{ label: 'Supplied trail' }]);
    fixture.detectChanges();
    expect(crumbLabels()).toEqual(['Supplied trail']);

    fixture.componentRef.setInput('breadcrumb', null);
    fixture.detectChanges();
    expect(crumbLabels()).toEqual(['Clients list']);
  });

  it('re-derives the trail, including a route that declares several keys, on the next navigation', () => {
    routerRoot = routeNode({}, routeNode({ breadcrumb: 'label.heading.clients' }));
    createShell();
    expect(crumbLabels()).toEqual(['Clients list']);

    routerRoot = routeNode(
      {},
      routeNode({ breadcrumb: ['label.heading.viewclient', 'label.heading.clients'] }),
    );
    events.next(new NavigationEnd(1, '/viewclient/42', '/viewclient/42'));
    fixture.detectChanges();

    expect(crumbLabels()).toEqual(['Client record', 'Clients list']);
  });
});
