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
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { filter, merge } from 'rxjs';

import { AuthService } from '../auth/auth.service';
import { IdleService } from '../auth/idle.service';
import { SessionService } from '../auth/session.service';
import { bindDocumentLanguage } from '../i18n/document-language';
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
 * The document events that count as the session being in use and re-arm the idle clock immediately:
 * a key, a click and a touch — the three of ng-idle's own DOM interruption list that say the user has
 * actually done something (`app/scripts/initialTasks.js:72-78`, wired by `$idleProvider`).
 *
 * They stay immediate because each one is a discrete interaction rather than a stream: a keypress, a
 * click or a tap must dismiss a showing warning at once and restart the whole 30-minute window
 * (AAP 0.1.1 requirement 1; AAP 0.4.2 "emits a warning at 29:50 and logs out at 30:00").
 */
const IMMEDIATE_ACTIVITY_EVENTS: readonly string[] = ['keydown', 'mousedown', 'touchstart'];

/**
 * The document events that say the pointer is moving. They prove the user is present but arrive at
 * their own rate — a trackpad emits hundreds of `mousemove` events per second — so they are counted
 * through the throttle below instead of one reset per event.
 */
const POINTER_ACTIVITY_EVENTS: readonly string[] = ['mousemove', 'wheel'];

/**
 * The window in which one pointer event may re-arm the idle clock: one second (QA report F11 at
 * `shell.component.ts:39`).
 *
 * `IdleService.reset()` is not free: it reads `AppConfigService.config` and clears and re-creates
 * three `window` timers, so resetting once per `mousemove` re-armed timers and allocated closures at
 * pointer-event rate on every authenticated screen. One second is far below the granularity that
 * matters to a 30-minute window with a 10-second warning: a pointer that never stops moving still
 * re-arms the clock every second, so the session cannot expire while the user is there, and the first
 * movement after any lull still resets it at once.
 */
const ACTIVITY_THROTTLE_MS = 1_000;

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
 * - document activity re-arms it (`reset()`), only while a session is in effect — a key, a click or a
 *   touch immediately, and pointer movement through a one-second throttle so a burst of `mousemove`
 *   events re-arms the three timers once per second instead of once per event (QA report F11);
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
  imports: [RouterOutlet, NavbarComponent, BreadcrumbComponent, TranslatePipe],
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
   * routes from the root down, translated through {@link translate} into the language in force.
   *
   * Held in a signal because it is recomputed on every `NavigationEnd`, whenever the active language
   * or the loaded bundles change, and read by an OnPush template. The constructor fills it once from
   * the router's current snapshot, because the navigation that activates this view completes before
   * the view exists, and its `NavigationEnd` therefore never reaches this component's subscription.
   *
   * **It holds resolved text, so it follows the language and not only the route.** A switch from
   * either language switcher performs no navigation, so {@link publishBreadcrumb} is re-run on
   * `onLangChange` and on `onTranslationChange` as well: the first re-resolves the trail against the
   * bundle that just became active, the second against a bundle that arrived after the switch that
   * asked for it (AAP 0.7.4 "the language switcher changes the active translation without a page
   * reload"; AAP 0.9.1 item 1).
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
   * Wires the idle clock to the session and to the document, keeps the trail in step with the route
   * and with the active language, and registers the activity listeners.
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

    // The switcher changes the active language without a reload (AAP 0.7.4), so the document's own
    // `lang` attribute has to follow it: an interface read in French or Spanish must not still be
    // announced as English (WCAG 3.1.1, QA F14). `core/i18n/document-language.ts` owns that write, and
    // this screen and the login screen are the two that host a switcher.
    bindDocumentLanguage(this.translate);

    // The trail is translated text, so it follows the language as well as the route: a switch from
    // either switcher performs no navigation, and without these two subscriptions the visible crumb
    // would keep the previous language until the next `NavigationEnd` (AAP 0.7.4 requires the switch
    // to take effect without a reload; AAP 0.9.1 item 1 places the switcher in this scope).
    // `onTranslationChange` covers a bundle that arrives after the switch that asked for it, so a late
    // bundle re-resolves the same keys instead of leaving the trail on the text it already had.
    merge(this.translate.onLangChange, this.translate.onTranslationChange)
      .pipe(takeUntilDestroyed())
      .subscribe((): void => {
        this.publishBreadcrumb();
      });

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

    for (const activity of IMMEDIATE_ACTIVITY_EVENTS) {
      this.document.addEventListener(activity, this.onActivity, { passive: true });
    }

    // Pointer movement keeps the session alive through the throttle below rather than once per event:
    // it arrives at pointer-event rate, and each reset re-arms three timers and re-reads the
    // configuration (QA report F11, ACTIVITY_THROTTLE_MS).
    for (const activity of POINTER_ACTIVITY_EVENTS) {
      this.document.addEventListener(activity, this.onPointerActivity, { passive: true });
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
   * observables: the timer the shell started and the listeners it registered — the immediate ones and
   * the throttled pointer ones, each removed with the handler reference it was added with.
   */
  ngOnDestroy(): void {
    this.idle.stop();

    for (const activity of IMMEDIATE_ACTIVITY_EVENTS) {
      this.document.removeEventListener(activity, this.onActivity);
    }

    for (const activity of POINTER_ACTIVITY_EVENTS) {
      this.document.removeEventListener(activity, this.onPointerActivity);
    }
  }

  /**
   * The handler of the immediate activity events — `keydown`, `mousedown`, `touchstart` — an arrow
   * property so the same reference is added on subscribe and removed in `ngOnDestroy`, and so it
   * keeps the component's `this` when the document calls it.
   *
   * Every one of these counts, with no throttle: a single click has to dismiss the warning and
   * restart the window on the spot.
   */
  private readonly onActivity = (): void => {
    this.noteActivity();
  };

  /**
   * When a pointer event was last allowed to re-arm the clock, as `Date.now()` milliseconds.
   *
   * `-Infinity` rather than `0`, so the very first pointer event of a session always passes whatever
   * the clock reads: `Date.now()` is never negative, and a zero start would swallow that first event
   * on a fake clock that begins at the epoch.
   */
  private lastPointerActivityAt = Number.NEGATIVE_INFINITY;

  /**
   * The handler of the pointer activity events — `mousemove` and `wheel` — as a one-second
   * leading-edge throttle over {@link ACTIVITY_THROTTLE_MS}.
   *
   * The first pointer event of each window calls {@link noteActivity} and re-arms the idle clock;
   * every later event inside the same window is dropped, because a burst of pointer movement carries
   * no more information about idleness than its first event does, and each reset re-reads the
   * configuration and re-creates three timers (QA report F11). The window is measured with
   * `Date.now()` rather than kept in a timer handle, so there is nothing to clear when the shell is
   * destroyed — `ngOnDestroy` only has to remove the listener — and the unit suite drives it by
   * moving the clock.
   */
  private readonly onPointerActivity = (): void => {
    const now: number = Date.now();

    if (now - this.lastPointerActivityAt < ACTIVITY_THROTTLE_MS) {
      return;
    }

    this.lastPointerActivityAt = now;
    this.noteActivity();
  };

  /**
   * Counts the session as being in use: it dismisses a showing warning and re-arms the idle window,
   * and it does nothing at all while no session is in effect.
   *
   * It is the single place both activity handlers end up — {@link onActivity} for the immediate events
   * and {@link onPointerActivity} once its throttle window has elapsed — so the session gate, the
   * dismissal and the reset cannot drift between the two.
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
   *
   * Each key is resolved with `translate.instant()` here, so the published trail is text in the
   * language that is in force at this moment. That is why it runs on a language change and on a
   * translation change as well as on a navigation: a switch hands the application a different bundle
   * without navigating, and a bundle that arrives late has to re-resolve the same keys rather than
   * leave the crumb on the language it was first rendered in (AAP 0.7.4, AAP 0.9.1 item 1).
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
