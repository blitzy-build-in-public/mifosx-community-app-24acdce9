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

/** One crumb the shell hands to `app-breadcrumb`: the text it displays, already translated (AAP 0.2.3). */
interface ShellBreadcrumb {
  readonly label: string;
}

/** The document events that count as the session being in use and re-arm the idle clock immediately: a key, a click and a touch — the three of ng-idle's own DOM interruption list that say the user has actually done (AAP 0.1.1, AAP 0.4.2). */
const IMMEDIATE_ACTIVITY_EVENTS: readonly string[] = ['keydown', 'mousedown', 'touchstart'];

/** The document events that say the pointer is moving. They prove the user is present but arrive at their own rate — a trackpad emits hundreds of `mousemove` events per second — so they are counted through the throttle. */
const POINTER_ACTIVITY_EVENTS: readonly string[] = ['mousemove', 'wheel'];

/** The window in which one pointer event may re-arm the idle clock: one second. */
const ACTIVITY_THROTTLE_MS = 1_000;

/** The id of the shell's content landmark, which the skip link names and {@link ShellComponent.skipToMain} focuses. */
const MAIN_CONTENT_ID = 'main-content';

/** Reads the breadcrumb trail a matched route declares in `data['breadcrumb']` (AAP 0.8.2, "each route declares its permission in `data.permission`"; the trail is the sibling declaration the breadcrumb renders) and (Rule 1 clause 4). */
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

/** The signed-in shell — the `AppShell` row of the component inventory (AAP 0.2.3) and the chrome AAP 0.7.1 and AAP 0.8.2 place behind the authenticated routes: "`core/layout/shell.component.ts` renders the navbar, the (AAP 0.9.2, AAP 0.10.5, AAP 0.1.1, AAP 0.4.1). */
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

  /** Injected rather than read off the `document` global, so the activity listeners are registered on the same document the rest of the application injects and a test can dispatch to them. */
  private readonly document = inject(DOCUMENT);

  /** The account name the navbar labels its user menu with, when the hosting route supplies one (AAP 0.7.1 `ShellComponent` input `userName`). */
  readonly userName = input<string | null>(null);

  /** The breadcrumb trail to render, when the hosting route supplies one (AAP 0.7.1 `ShellComponent` input `breadcrumb`). */
  readonly breadcrumb = input<readonly ShellBreadcrumb[] | null>(null);

  /** The trail derived from the active route tree: the `data['breadcrumb']` keys of the matched routes from the root down, translated through {@link translate} into the language in force (AAP 0.7.4, AAP 0.9.1). */
  private readonly trail = signal<readonly ShellBreadcrumb[]>([]);

  /** The crumbs `app-breadcrumb` renders: the caller's `breadcrumb` input when one was supplied, and the route-derived trail otherwise. */
  readonly breadcrumbItems = computed<readonly ShellBreadcrumb[]>(
    (): readonly ShellBreadcrumb[] => this.breadcrumb() ?? this.trail(),
  );

  /** The account name the navbar shows: the `userName` input when the host supplies it, and the session's own `GET /users/{id}` projection (`SessionService.user`) otherwise — the account `mifos` after a login as `mifos` (AAP 0.7.4). */
  readonly displayName = computed<string | null>(
    (): string | null => this.userName() ?? this.sessions.user()?.username ?? null,
  );

  /** Whether the idle warning is on screen — `true` from the moment `IdleService.warning$` emits until activity, "Stay signed in", the timeout or the end of the session takes it away (AAP 0.4.1). */
  readonly idleWarning = signal(false);

  /** Wires the idle clock to the session and to the document, keeps the trail in step with the route and with the active language, and registers the activity listeners. */
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

    // The switcher changes the active language without a reload (AAP 0.7.4), so the document's own `lang` attribute has to follow it: an interface read in French or Spanish must not still be announced as English (WCAG 3.1.1.
    bindDocumentLanguage(this.translate);

    // The trail is translated text, so it follows the language as well as the route: a switch from either switcher performs no navigation, and without these two subscriptions the visible crumb would keep the previous language (AAP 0.7.4, AAP 0.9.1).
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

    // Pointer movement keeps the session alive through the throttle below rather than once per event: it arrives at pointer-event rate, and each reset re-arms three timers and re-reads the configuration.
    for (const activity of POINTER_ACTIVITY_EVENTS) {
      this.document.addEventListener(activity, this.onPointerActivity, { passive: true });
    }
  }

  /** Dismisses the idle warning and re-arms the whole idle window — the warning's "Stay signed in" action, which is what legacy's ng-idle interrupt did (`$idleProvider`, `initialTasks.js:72-78`). */
  staySignedIn(): void {
    this.idleWarning.set(false);
    this.idle.reset();
  }

  /**
   * Moves focus into the screen's content, which is what the shell's skip link does (WCAG 2.4.1): the `main` landmark carries `tabindex="-1"`, so it accepts programmatic focus without becoming a
   * tab stop of its own, and the next Tab continues from it into the screen's own controls rather than back through the navbar. The click's default is cancelled first and always — the application routes on the hash
   * (`withHashLocation`, Rule 1 clause 5), so letting the browser follow `#main-content` would be read as a navigation and would take the screen away — and nothing is navigated to or requested here. The parameter
   * is the click's own `MouseEvent` because this file imports the router's `Event` under that name; `@param event` the anchor's click, whose default fragment navigation is suppressed.
   */
  skipToMain(event: MouseEvent): void {
    event.preventDefault();
    this.document.getElementById(MAIN_CONTENT_ID)?.focus();
  }

  /** Stops the idle clock and removes the document listeners (AAP 0.7.1: the shell stops the clock it started). */
  ngOnDestroy(): void {
    this.idle.stop();

    for (const activity of IMMEDIATE_ACTIVITY_EVENTS) {
      this.document.removeEventListener(activity, this.onActivity);
    }

    for (const activity of POINTER_ACTIVITY_EVENTS) {
      this.document.removeEventListener(activity, this.onPointerActivity);
    }
  }

  /** The handler of the immediate activity events — `keydown`, `mousedown`, `touchstart` — an arrow property so the same reference is added on subscribe and removed in `ngOnDestroy`, and so it keeps the component's `this`. */
  private readonly onActivity = (): void => {
    this.noteActivity();
  };

  /** When a pointer event was last allowed to re-arm the clock, as `Date.now()` milliseconds. */
  private lastPointerActivityAt = Number.NEGATIVE_INFINITY;

  /** The handler of the pointer activity events — `mousemove` and `wheel` — as a one-second leading-edge throttle over {@link ACTIVITY_THROTTLE_MS}. The first pointer event of each window calls {@link noteActivity} and. */
  private readonly onPointerActivity = (): void => {
    const now: number = Date.now();

    if (now - this.lastPointerActivityAt < ACTIVITY_THROTTLE_MS) {
      return;
    }

    this.lastPointerActivityAt = now;
    this.noteActivity();
  };

  /** Counts the session as being in use: it dismisses a showing warning and re-arms the idle window, and it does nothing at all while no session is in effect. */
  private noteActivity(): void {
    if (this.auth.session() === null) {
      return;
    }

    this.idleWarning.set(false);
    this.idle.reset();
  }

  /** Ends the session when the idle duration has elapsed (AAP 0.1.1 requirement 1; legacy `MainController.js:139-143` logs out on `$idleTimeout` and stops watching). */
  private signOutAfterTimeout(): void {
    this.idleWarning.set(false);
    this.auth.logout();

    void this.router.navigate(['/login']).catch((): void => undefined);
  }

  /** Re-derives the trail from the active route tree and publishes the translated crumbs (AAP 0.7.4, AAP 0.9.1). */
  private publishBreadcrumb(): void {
    const keys: readonly string[] = this.declaredKeys(this.router.routerState.snapshot.root);

    this.trail.set(
      keys.map((key: string): ShellBreadcrumb => {
        const label: string = this.translate.instant(key);
        return { label };
      }),
    );
  }

  /** Collects the breadcrumb keys every node of one route tree declares. @param root the router's root snapshot, walked downwards through `firstChild`. @returns the keys in trail order, the root's first. */
  private declaredKeys(root: ActivatedRouteSnapshot): readonly string[] {
    const keys: string[] = [];

    for (let node: ActivatedRouteSnapshot | null = root; node !== null; node = node.firstChild) {
      keys.push(...declaredBreadcrumbKeys(node.data['breadcrumb']));
    }

    return keys;
  }
}
