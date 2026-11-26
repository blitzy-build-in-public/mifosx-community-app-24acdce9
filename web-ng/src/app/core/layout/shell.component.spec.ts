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
import { Subject, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { AuthService } from '../auth/auth.service';
import { IdleService } from '../auth/idle.service';
import type { SessionData, SessionUserResponse } from '../auth/session.model';
import { SessionService } from '../auth/session.service';
import { ShellComponent } from './shell.component';

/** Behavioural spec for `ShellComponent` — AAP 0.2.3's `AppShell` row, AAP 0.7.1's `ShellComponent` contract and AAP 0.8.2's "Shell and navigation", and the consumer that makes `IdleService` live: AAP 0.1.1's first (AAP 0.11.1, Rule 1 clause 8, AAP 0.10.5, AAP 0.7.4). */

/** The Fineract user id every fixture in this suite names. */
const USER_ID = 42;

/** The account name `GET /users/{id}` resolves, which is what the navbar must fall back to. */
const ACCOUNT_NAME = 'mifos';

/** The account name a host supplies through the shell's `userName` input, distinct from the above. */
const SUPPLIED_NAME = 'supplied-by-shell';

/** Stand-in for the shipped bundles: one distinct value per key, so an assertion can tell which key produced which text and can never pass on a raw dotted key (Rule 1 clause 6). */
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
  'label.message.session.expiring': 'You have been inactive and will be signed out shortly.',
  'label.button.stay.signed.in': 'Stay signed in',
};

/** The bundle the language-switch cases activate: every key of {@link SPEC_BUNDLE} with a different value for the ones a switch has to re-resolve, so text that stayed in the previous language is visible instead of looking (Rule 1 clause 6). */
const SPEC_BUNDLE_FR: Record<string, string> = {
  ...SPEC_BUNDLE,
  'label.heading.clients': 'Liste des clients',
  'label.heading.viewclient': 'Fiche du client',
  'label.message.session.expiring': 'Vous avez été inactif et serez déconnecté sous peu.',
  'label.button.stay.signed.in': 'Rester connecté',
};

/** The language the suite starts on: the fallback bundle every other language is completed from. */
const BASE_LANG = 'en';

/** The language a switch activates; one the application's own list offers (AAP 0.7.4). */
const SWITCHED_LANG = 'fr';

/** The window in which one pointer event may re-arm the idle clock, as `ShellComponent` documents it. */
const POINTER_THROTTLE_MS = 1_000;

/** The instant the pointer-throttle cases start their fake clock at: the epoch, so any value works. */
const START_OF_WINDOW = new Date(0);

/** The value `AuthService.session()` reports while a session is in effect (Rule 1 clause 9, Rule 1 clause 4). */
const SESSION_EFFECTIVE = { userId: USER_ID } as unknown as SessionData;

/** A matched route node as the shell walks it: the two members the breadcrumb derivation reads out of the router's snapshot tree, and nothing else. */
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

/** Wraps a route tree as the router state the shell reads. `ActivatedRouteSnapshot` carries the router's internal matching state and cannot be assembled by hand, so the fixture is a plain object given the type at this one (Rule 1 clause 4). */
function routerStateFor(root: RouteNode): RouterState {
  return { snapshot: { root } } as unknown as RouterState;
}

/** The half of `AuthService` the shell and its navbar read: the session signal the idle gate follows, the account name the navbar falls back to, and the logout the timeout performs. */
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
    this.current.set(SESSION_EFFECTIVE);
  }

  /** Clears the session without going through `logout` (a 401, or a test's own arrangement). */
  endSession(): void {
    this.current.set(null);
  }
}

/** The half of `IdleService` the shell drives, with spies for the three commands and subjects for the two emissions, so a test decides exactly when the warning and the timeout arrive. */
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

/** The half of `SessionService` the shell reads: the `GET /users/{id}` projection its `displayName` falls back to when the hosting route supplies no `userName` (Rule 1 clause 9). */
class SessionsStub implements Pick<SessionService, 'user'> {
  private readonly current = signal<SessionUserResponse | null>(null);

  /** The projection a completed restore publishes; `null` until {@link resolveUser} supplies one. */
  readonly user: Signal<SessionUserResponse | null> = this.current.asReadonly();

  /** Publishes a resolved projection, exactly as a restore does once `GET /users/{id}` answers. */
  resolveUser(username: string): void {
    this.current.set({ id: USER_ID, username });
  }
}

describe('ShellComponent', () => {
  let fixture: ComponentFixture<ShellComponent>;
  let auth: AuthStub;
  let idle: IdleStub;
  let sessions: SessionsStub;
  let navigate: MockInstance;
  let events: Subject<RouterEvent>;
  let routerRoot: RouteNode;
  let destroyed: boolean;
  let translate: TranslateService;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps the assertions below type-checked and confines the boundary to this line (Rule 1 clause 4).
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
    TestBed.resetTestingModule();
    auth = new AuthStub();
    idle = new IdleStub();
    sessions = new SessionsStub();
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
        { provide: SessionService, useValue: sessions },
      ],
    });

    translate = TestBed.inject(TranslateService);
    for (const [language, bundle] of [
      [BASE_LANG, SPEC_BUNDLE],
      [SWITCHED_LANG, SPEC_BUNDLE_FR],
    ] as const) {
      translate.setTranslation(language, bundle, true);
    }
    translate.use(BASE_LANG);

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

    // `bindDocumentLanguage` writes the real document, which every case in this runner shares: the attribute is put back on the static default so one case's switch cannot be read as the next case's starting state.
    document.documentElement.lang = BASE_LANG;
  });

  it('renders the navbar, the breadcrumb and the routed outlet, with the outlet beside the page container', () => {
    createShell();

    const content = find<HTMLElement>('.content-wrapper');

    expect(host().querySelector('app-navbar')).not.toBeNull();
    expect(content.querySelector('app-breadcrumb')).not.toBeNull();
    expect(content.querySelector('router-outlet')).not.toBeNull();

    // The initial state, before any navigation: the first snapshot declares no `breadcrumb`, so the trail is empty — which a component that rendered a fixed crumb could not reproduce.
    expect(fixture.componentInstance.breadcrumbItems()).toEqual([]);
    expect(host().querySelector('ol.breadcrumb')).toBeNull();

    // Each screen template opens its own `.container-fluid`, so the outlet must not sit inside the breadcrumb's container: a second wrapper would double the page gutters.
    expect(find<HTMLElement>('.content-wrapper > .container-fluid').contains(find('router-outlet'))).toBe(
      false,
    );
  });

  it('puts the skip link first, points it at the named main landmark, and moves focus there without navigating', () => {
    createShell();

    // Bootstrap 3.4.3's own two classes: hidden until focused, visible on focus, so the shell paints exactly what it painted before (Rule 1 clause 6).
    const skip = find<HTMLAnchorElement>('a.sr-only.sr-only-focusable');
    const focusable = Array.from(
      host().querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'),
    ).filter((element: HTMLElement): boolean => element.tabIndex >= 0);

    // The first Tab stop on every signed-in screen, which is what makes the whole page bypassable (WCAG 2.4.1).
    expect(focusable[0]).toBe(skip);
    expect(skip.textContent?.trim()).toBe('Skip to content');
    expect(skip.getAttribute('href')).toBe('#main-content');

    const main = find<HTMLElement>('#main-content');

    expect(main.tagName).toBe('MAIN');
    expect(main.getAttribute('tabindex')).toBe('-1');
    expect(main.getAttribute('aria-label')).toBe('Main content');

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    skip.dispatchEvent(click);
    fixture.detectChanges();

    // The default is cancelled, because the application routes on the hash: an un-cancelled `#main-content` would be read as a route and would take the screen away (Rule 1 clause 5).
    expect(click.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(main);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders none of the out-of-scope chrome, the way the legacy shell was cut down', () => {
    createShell();

    expect(host().querySelector('.navbar-toggle')).toBeNull();
    expect(host().querySelector('.fa-bell')).toBeNull();
    expect(host().querySelector('#leftnav')).toBeNull();

    // Every destination behind those controls — Accounting, Reports, Admin and the rail's modules — stays on the legacy application during cutover, so no rendered link may lead to one of them (AAP 0.10.5 item 8).
    const destinations = Array.from(
      host().querySelectorAll('a'),
      (link: HTMLAnchorElement): string =>
        `${link.getAttribute('href') ?? ''} ${link.textContent ?? ''}`.toLowerCase(),
    );

    expect(destinations.length).toBeGreaterThan(0);

    expect(
      destinations.filter((destination: string): boolean =>
        ['accounting', 'reports', 'admin'].some((segment: string): boolean =>
          destination.includes(segment),
        ),
      ),
    ).toEqual([]);
  });

  it('labels the navbar with the session projection when no userName is given, and with the input when one is', () => {
    sessions.resolveUser(ACCOUNT_NAME);
    createShell();
    expect(userMenuLabel()).toContain(ACCOUNT_NAME);

    fixture.componentRef.setInput('userName', SUPPLIED_NAME);
    fixture.detectChanges();
    expect(userMenuLabel()).toContain(SUPPLIED_NAME);
    expect(userMenuLabel()).not.toContain(ACCOUNT_NAME);
  });

  it('starts the idle clock while a session is in effect, stops it when the session clears, and ignores activity without one', () => {
    createShell();

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

  it('re-arms the clock on every key, click and touch, with no throttle at all', () => {
    auth.signIn();
    createShell();

    for (const activity of ['keydown', 'keydown', 'mousedown', 'touchstart', 'keydown']) {
      document.dispatchEvent(new Event(activity));
    }

    // The immediate events are never throttled: a click has to dismiss the warning and restart the whole window on the spot, however recently the previous one happened (AAP 0.1.1 requirement 1).
    expect(idle.reset).toHaveBeenCalledTimes(5);
  });

  it('re-arms the clock once for a burst of pointer events, and again in the next window', () => {
    // Only `Date` is faked: the throttle reads `Date.now()`, and nothing else in the shell should lose its own timers to a fake clock.
    vi.useFakeTimers({ toFake: ['Date'] });

    try {
      vi.setSystemTime(START_OF_WINDOW);
      auth.signIn();
      createShell();

      // The first pointer event of the window re-arms the clock, from a clock that reads zero — which is what the handler's `-Infinity` starting point is for.
      document.dispatchEvent(new Event('mousemove'));
      expect(idle.reset).toHaveBeenCalledTimes(1);

      for (let move = 0; move < 20; move += 1) {
        document.dispatchEvent(new Event('mousemove'));
      }
      document.dispatchEvent(new Event('wheel'));
      expect(idle.reset).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date(START_OF_WINDOW.getTime() + POINTER_THROTTLE_MS - 1));
      document.dispatchEvent(new Event('wheel'));
      expect(idle.reset).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date(START_OF_WINDOW.getTime() + POINTER_THROTTLE_MS));
      document.dispatchEvent(new Event('mousemove'));
      expect(idle.reset).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

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

  it('renders the warning from the active bundle and follows a language switch with no navigation', async () => {
    auth.signIn();
    createShell();
    idle.warning$.next();
    fixture.detectChanges();

    const alert = find<HTMLElement>('.alert.alert-warning');

    expect(alert.textContent).toContain(SPEC_BUNDLE['label.message.session.expiring']);
    expect(find<HTMLButtonElement>('.alert-warning button').textContent?.trim()).toBe(
      SPEC_BUNDLE['label.button.stay.signed.in'],
    );

    // The switch a navbar or login switcher performs: no `NavigationEnd` is emitted and nothing is navigated to, so a warning hardcoded in English would stay in English here (AAP 0.7.4).
    await firstValueFrom(translate.use(SWITCHED_LANG));
    fixture.detectChanges();

    const switched = find<HTMLElement>('.alert.alert-warning');

    expect(navigate).not.toHaveBeenCalled();
    expect(switched.textContent).toContain(SPEC_BUNDLE_FR['label.message.session.expiring']);
    expect(switched.textContent).not.toContain(SPEC_BUNDLE['label.message.session.expiring']);
    expect(find<HTMLButtonElement>('.alert-warning button').textContent?.trim()).toBe(
      SPEC_BUNDLE_FR['label.button.stay.signed.in'],
    );
    expect(auth.logout).not.toHaveBeenCalled();
    expect(host().querySelector('.alert.alert-warning')).not.toBeNull();
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

    document.dispatchEvent(new Event('mousemove'));
    document.dispatchEvent(new Event('wheel'));
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

  it('re-resolves the trail in the newly active language on a switch, with no navigation', async () => {
    routerRoot = routeNode({}, routeNode({ breadcrumb: 'label.heading.clients' }));
    createShell();
    expect(crumbLabels()).toEqual([SPEC_BUNDLE['label.heading.clients']]);

    // A switch and nothing else: no `NavigationEnd` is emitted anywhere in this case, and nothing is navigated to — which is exactly the state a navbar or login switch produces (AAP 0.7.4).
    await firstValueFrom(translate.use(SWITCHED_LANG));
    fixture.detectChanges();

    expect(navigate).not.toHaveBeenCalled();
    expect(crumbLabels()).toEqual([SPEC_BUNDLE_FR['label.heading.clients']]);

    await firstValueFrom(translate.use(BASE_LANG));
    fixture.detectChanges();

    expect(crumbLabels()).toEqual([SPEC_BUNDLE['label.heading.clients']]);
  });

  it('re-resolves a multi-key trail on a switch, in trail order', async () => {
    routerRoot = routeNode(
      {},
      routeNode({ breadcrumb: ['label.heading.viewclient', 'label.heading.clients'] }),
    );
    createShell();
    expect(crumbLabels()).toEqual([
      SPEC_BUNDLE['label.heading.viewclient'],
      SPEC_BUNDLE['label.heading.clients'],
    ]);

    await firstValueFrom(translate.use(SWITCHED_LANG));
    fixture.detectChanges();

    // The keys come from the route and the text from the bundle, so a switch translates every crumb without re-reading the tree: order and count are unchanged (AAP 0.2.3 `Breadcrumb` items).
    expect(crumbLabels()).toEqual([
      SPEC_BUNDLE_FR['label.heading.viewclient'],
      SPEC_BUNDLE_FR['label.heading.clients'],
    ]);
  });

  it('binds the document language to the active one and follows a switch', async () => {
    createShell();

    // The static `<html lang="en">` in `src/index.html` is only the pre-render default; the shell writes the language actually in force as it is constructed.
    expect(document.documentElement.lang).toBe(BASE_LANG);

    await firstValueFrom(translate.use(SWITCHED_LANG));
    fixture.detectChanges();

    expect(document.documentElement.lang).toBe(SWITCHED_LANG);

    await firstValueFrom(translate.use(BASE_LANG));
    fixture.detectChanges();

    expect(document.documentElement.lang).toBe(BASE_LANG);
  });

  it('clears the trail when the route it reaches declares no breadcrumb', () => {
    routerRoot = routeNode({}, routeNode({ breadcrumb: 'label.heading.clients' }));
    createShell();
    expect(fixture.componentInstance.breadcrumbItems()).toEqual([{ label: 'Clients list' }]);

    // The login route declares no `breadcrumb`, so leaving the record for it must clear the trail rather than leave the previous screen's crumb behind.
    routerRoot = routeNode({}, routeNode({}));
    events.next(new NavigationEnd(1, '/login', '/login'));
    fixture.detectChanges();

    expect(fixture.componentInstance.breadcrumbItems()).toEqual([]);
    expect(host().querySelector('ol.breadcrumb')).toBeNull();
    expect(crumbLabels()).toEqual([]);
  });

});
