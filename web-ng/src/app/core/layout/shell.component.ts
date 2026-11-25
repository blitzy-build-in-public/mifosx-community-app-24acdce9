import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  computed,
  effect,
  inject,
  input,
  signal,
  type OnDestroy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet, type ActivatedRouteSnapshot, type Event } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { filter } from 'rxjs';

import { AuthService } from '../auth/auth.service';
import { IdleService } from '../auth/idle.service';
import { SessionService } from '../auth/session.service';
import { BreadcrumbComponent } from './breadcrumb.component';
import { NavbarComponent } from './navbar.component';

/**
 * One crumb the shell hands to `app-breadcrumb`: the text it displays, already translated.
 *
 * The shape is the `items` input of `BreadcrumbComponent` (AAP 0.2.3, `Breadcrumb`
 * `items: {label: string}[]`), stated here as well so a caller of the shell's own `breadcrumb` input
 * is typed against the same contract the presentational component takes.
 */
interface ShellBreadcrumb {
  readonly label: string;
}

/**
 * The document events that count as the session being in use, which re-arm the idle clock exactly as
 * ng-idle's own DOM interruption list did (`app/scripts/initialTasks.js:72-78`, wired by
 * `$idleProvider`): a key, a click, a movement of the pointer, a wheel scroll or a touch.
 */
const ACTIVITY_EVENTS: readonly string[] = ['keydown', 'mousedown', 'mousemove', 'wheel', 'touchstart'];

/**
 * Reads the breadcrumb trail a matched route declares in `data['breadcrumb']` (AAP 0.8.2, "each
 * route declares its permission in `data.permission`"; the trail is the sibling declaration the
 * breadcrumb renders) and normalises it to translation keys.
 *
 * Two spellings are accepted, because both are natural to write in a route table: a single
 * translation key (`data: { breadcrumb: 'label.heading.clients' }`) and an array of them for a trail
 * a route contributes more than one crumb to. Anything else — an absent member, a `null`, a number —
 * declares no crumb and contributes nothing, so a route that names no breadcrumb leaves the trail as
 * it found it instead of rendering an empty or humanised entry.
 *
 * The member arrives as `Data`'s index-signature value, which is typed `any`; it is taken as
 * `unknown` and narrowed here rather than cast, which is what Rule 1 clause 4 asks of a boundary
 * value the application does not itself produce.
 *
 * @param value the route's `data['breadcrumb']` member, as declared.
 * @returns the translation keys it names, in declaration order, with blanks dropped.
 */
function declaredBreadcrumbKeys(value: unknown): readonly string[] {
  if (typeof value === 'string') {
    const key: string = value.trim();
    return key.length > 0 ? [key] : [];
  }

  if (Array.isArray(value)) {
    return value
      .filter((entry: unknown): entry is string => typeof entry === 'string')
      .map((entry: string): string => entry.trim())
      .filter((entry: string): boolean => entry.length > 0);
  }

  return [];
}

/**
 * The signed-in shell — the `AppShell` row of the component inventory (AAP 0.2.3) and the chrome
 * AAP 0.7.1 and AAP 0.8.2 place behind the authenticated routes: "`core/layout/shell.component.ts`
 * renders the navbar, the breadcrumb and `<router-outlet>` for every authenticated route (no left
 * rail, 0.10.5)".
 *
 * **What it renders.** The navigation bar, the idle warning while the session is about to expire,
 * the breadcrumb trail, and the routed screen — in that order, inside the `content-wrapper` surface
 * the global stylesheet paints #EBEFF1. Every control the captured design shows that belongs to an
 * out-of-scope module is absent rather than stubbed: no left icon rail, no Accounting / Reports /
 * Admin destination, no hamburger and no notification bell (AAP 0.9.2, AAP 0.10.5 item 8). The
 * routed screen opens its own `.container-fluid` (`features/clients/client-actions`, the loan and
 * savings screens all do), so the outlet sits beside the breadcrumb's container rather than inside
 * it: a second wrapper around it would double the page gutters.
 *
 * **The idle clock is started here and nowhere else.** AAP 0.1.1's first functional requirement —
 * "a session with a 30-minute idle timeout, a 10-second warning before logout and a 15-minute
 * keepalive" — is `IdleService`'s contract (AAP 0.7.1), and this component is its only consumer:
 *
 * - while `AuthService.session()` is non-null the clock runs (`start()`), and it is stopped
 *   (`stop()`) the moment the session clears, which is what legacy's `scope.start(session)` /
 *   `$idle.watch()` wiring did (`app/scripts/controllers/main/MainController.js:151-157`);
 * - document activity re-arms it (`reset()`), only while a session is in effect;
 * - `warning$` raises the alert and `timeout$` ends the session and returns to `/login`, exactly the
 *   `$idleTimeout` handler legacy ran (`MainController.js:139-143`);
 * - `ngOnDestroy` stops the clock and removes the listeners, so a destroyed shell neither logs out a
 *   later session nor keeps a document listener alive.
 *
 * `warning$` and `timeout$` are emitted from timer callbacks, outside any component's change
 * detection (the application is zoneless, AAP 0.4.1), so the warning is held in a signal and the
 * template re-renders on it rather than on a plain field.
 *
 * **Its two inputs are optional, by AAP 0.7.1's contract and by how it is routed.** AAP 0.7.1 gives
 * `ShellComponent` the inputs `userName` and `breadcrumb`; both default to `null`, because
 * `app.routes.ts` renders the shell as a layout route with no bindings, and a required input would
 * fail that instantiation. Each is genuinely used: `userName` labels the navbar (which otherwise
 * shows the account name `GET /users/{id}` resolved) and `breadcrumb` overrides the trail derived
 * from the active route's `data['breadcrumb']`.
 *
 * **It carries no CSS and issues no request.** The navbar's bar, the content surface and the crumb's
 * size and colour are the global rules of `web-ng/src/styles.scss` (Rule 1 clause 6), and this
 * component injects no HTTP owner — it composes no URL, sets no header and touches no Fineract
 * resource (Rule 1 clause 5, Rule 2). Nothing here is logged: the session's key never leaves
 * `SessionService` (Rule 1 clause 9, AAP 0.10.4).
 */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, NavbarComponent, BreadcrumbComponent],
  templateUrl: './shell.component.html',
})
export class ShellComponent implements OnDestroy {
  /** The session the idle clock follows and the logout the timeout performs (AAP 0.7.1). */
  private readonly auth = inject(AuthService);

  /** The authenticated user's `GET /users/{id}` projection, which labels the navbar as a fallback. */
  private readonly sessions = inject(SessionService);

  /** The idle clock: started, reset and stopped here, and the source of the warning and the timeout. */
  private readonly idle = inject(IdleService);

  /** The active route, whose `data['breadcrumb']` declares the trail; and the timeout's navigation. */
  private readonly router = inject(Router);

  /** Resolves the trail's translation keys through the legacy bundles (AAP 0.7.1, i18n row). */
  private readonly translate = inject(TranslateService);

  /**
   * Injected rather than read off the `document` global, so the activity listeners are registered on
   * the same document the rest of the application injects and a test can dispatch to them.
   */
  private readonly document = inject(DOCUMENT);

  /**
   * The account name the navbar labels its user menu with, when the hosting route supplies one
   * (AAP 0.7.1 `ShellComponent` input `userName`).
   *
   * Optional, and `null` by default: `app.routes.ts` renders `<app-shell />` as a layout route with
   * no bindings, so a required input would throw NG0950 on every authenticated navigation. When it
   * is supplied — a screen or a test naming the account itself — it wins over the session projection
   * {@link displayName} falls back to.
   */
  readonly userName = input<string | null>(null);

  /**
   * The breadcrumb trail to render, when the hosting route supplies one (AAP 0.7.1 `ShellComponent`
   * input `breadcrumb`).
   *
   * Optional for the same reason as {@link userName}, and `null` — not an empty list — by default, so
   * the shell can tell "no override was supplied" from "the caller wants no trail" and fall back to
   * the trail the active route declares (see {@link breadcrumbItems}).
   */
  readonly breadcrumb = input<readonly ShellBreadcrumb[] | null>(null);

  /**
   * The trail derived from the active route tree: the `data['breadcrumb']` keys of the matched
   * routes from the root down, translated through {@link translate}.
   *
   * Held in a signal because it is recomputed on every `NavigationEnd` and read by an OnPush
   * template. The constructor fills it once from the router's current snapshot, because the
   * navigation that activates this view completes before the view exists, and its `NavigationEnd`
   * therefore never reaches this component's subscription.
   */
  private readonly trail = signal<readonly ShellBreadcrumb[]>([]);

  /**
   * The crumbs `app-breadcrumb` renders: the caller's `breadcrumb` input when one was supplied, and
   * the route-derived trail otherwise.
   *
   * A computed signal rather than a template expression, so a route change — or an input set on a
   * reused shell instance — re-renders the trail without the component marking itself dirty.
   */
  readonly breadcrumbItems = computed<readonly ShellBreadcrumb[]>(
    (): readonly ShellBreadcrumb[] => this.breadcrumb() ?? this.trail(),
  );

  /**
   * The account name the navbar shows: the `userName` input when the host supplies it, and the
   * session's own `GET /users/{id}` projection (`SessionService.user`) otherwise — the account
   * `mifos` after a login as `mifos`, which is the value the legacy user menu printed from
   * `currentSession.user.name` (AAP 0.7.4).
   *
   * It is `null` before a restore has resolved a projection and whenever no session is in effect.
   */
  readonly displayName = computed<string | null>(
    (): string | null => this.userName() ?? this.sessions.user()?.username ?? null,
  );

  /**
   * Whether the idle warning is on screen — `true` from the moment `IdleService.warning$` emits until
   * activity, "Stay signed in", the timeout or the end of the session takes it away.
   *
   * A signal because the emission comes from a timer callback, outside change detection (AAP 0.4.1).
   */
  readonly idleWarning = signal(false);

  /**
   * Wires the idle clock to the session and to the document, keeps the trail in step with the route,
   * and registers the activity listeners.
   *
   * The clock's gate is an `effect()` on `AuthService.session()`, so the one signal that says a
   * session is in effect drives start and stop: a login starts the clock without a second caller,
   * and a logout, a 401 or the idle timeout itself stops it. Both branches also drop a warning that
   * was on screen, which must not outlive the session it warned about.
   *
   * The subscriptions and listeners are torn down by `takeUntilDestroyed()` and `ngOnDestroy()`, so
   * leaving the shell can never leave a live timer, a document listener or a subscription behind.
   */
  constructor() {
    effect((): void => {
      if (this.auth.session() !== null) {
        this.idle.start();
      } else {
        this.idle.stop();
        this.idleWarning.set(false);
      }
    });

    this.publishBreadcrumb();

    this.router.events
      .pipe(
        filter((event: Event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((): void => {
        this.publishBreadcrumb();
        this.noteActivity();
      });

    this.idle.warning$.pipe(takeUntilDestroyed()).subscribe((): void => {
      this.idleWarning.set(true);
    });

    this.idle.timeout$.pipe(takeUntilDestroyed()).subscribe((): void => {
      this.signOutAfterTimeout();
    });

    for (const activity of ACTIVITY_EVENTS) {
      this.document.addEventListener(activity, this.onActivity, { passive: true });
    }
  }

  /**
   * Dismisses the idle warning and re-arms the whole idle window — the warning's "Stay signed in"
   * action, which is what legacy's ng-idle interrupt did (`$idleProvider`, `initialTasks.js:72-78`).
   *
   * It is the same reset a keystroke or a route change performs: there is one notion of the session
   * being in use, and the button is a way of saying so.
   */
  staySignedIn(): void {
    this.idleWarning.set(false);
    this.idle.reset();
  }

  /**
   * Stops the idle clock and removes the document listeners (AAP 0.7.1: the shell stops the clock it
   * started).
   *
   * The subscriptions on `warning$`, `timeout$` and the router's events end with the injector
   * context's `takeUntilDestroyed()`, so this method owns exactly the two things that are not
   * observables: the timer the shell started and the listeners it registered.
   */
  ngOnDestroy(): void {
    this.idle.stop();

    for (const activity of ACTIVITY_EVENTS) {
      this.document.removeEventListener(activity, this.onActivity);
    }
  }

  /**
   * The document listener's handler, an arrow property so the same reference is added on subscribe
   * and removed in `ngOnDestroy` — and so it keeps the component's `this` when the document calls it.
   */
  private readonly onActivity = (): void => {
    this.noteActivity();
  };

  /**
   * Counts the session as being in use: it dismisses a showing warning and re-arms the idle window,
   * and it does nothing at all while no session is in effect.
   *
   * The gate matters because the listeners outlive a logout by one destruction cycle: a keystroke on
   * the login screen must not arm a clock for a session that no longer exists. `IdleService.reset()`
   * would otherwise read a configuration and start timers with no session behind them.
   */
  private noteActivity(): void {
    if (this.auth.session() === null) {
      return;
    }

    this.idleWarning.set(false);
    this.idle.reset();
  }

  /**
   * Ends the session when the idle duration has elapsed (AAP 0.1.1 requirement 1; legacy
   * `MainController.js:139-143` logs out on `$idleTimeout` and stops watching).
   *
   * The order is legacy's: the warning goes, the session is cleared — which also stops the clock
   * through the `effect()` above — and only then does the navigation run, so no screen renders for
   * an instant against a session that has already ended.
   */
  private signOutAfterTimeout(): void {
    this.idleWarning.set(false);
    this.auth.logout();

    // A rejected navigation is not a failure to report: the login route is reached without a
    // session, so a rejection means a guard redirected somewhere else instead — and the session is
    // already cleared, which is the only state this handler exists to produce. Nothing is logged and
    // no error surface is raised for it.
    void this.router.navigate(['/login']).catch((): void => undefined);
  }

  /**
   * Re-derives the trail from the active route tree and publishes the translated crumbs.
   *
   * The tree is walked from the root down `firstChild`, the same walk the router's own
   * `pathFromRoot` documents, because a layout route's child is the screen: every matched node that
   * declares a `data['breadcrumb']` contributes its keys in that order.
   */
  private publishBreadcrumb(): void {
    const keys: readonly string[] = this.declaredKeys(this.router.routerState.snapshot.root);

    this.trail.set(
      keys.map((key: string): ShellBreadcrumb => {
        const label: string = this.translate.instant(key);
        return { label };
      }),
    );
  }

  /**
   * Collects the breadcrumb keys every node of one route tree declares.
   *
   * @param root the router's root snapshot, walked downwards through `firstChild`.
   * @returns the keys in trail order, the root's first.
   */
  private declaredKeys(root: ActivatedRouteSnapshot): readonly string[] {
    const keys: string[] = [];

    for (let node: ActivatedRouteSnapshot | null = root; node !== null; node = node.firstChild) {
      keys.push(...declaredBreadcrumbKeys(node.data['breadcrumb']));
    }

    return keys;
  }
}
