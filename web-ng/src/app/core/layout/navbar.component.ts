import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  type Signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { navigationFailure } from '../../core/http/api-error';
import { HasPermissionDirective } from '../../shared/has-permission.directive';
import { LanguageSwitcherComponent } from '../../shared/language-switcher/language-switcher.component';
import type { SearchScope } from '../api/search.service';
import { AuthService } from '../auth/auth.service';
import { AVAILABLE_LANGS, FALLBACK_LANG } from '../i18n/translate.config';
import { NotificationService } from '../notifications/notification.service';
import { GlobalSearchComponent, type GlobalSearchSubmission } from './global-search.component';

/**
 * Legacy key of the message a failure that is not Fineract's own text is reported with — the same
 * key the login screen uses for the same purpose, so no new wording is invented (Rule 1 clause 3).
 */
const GENERIC_FAILURE_KEY = 'error.connection.failed';

/**
 * The signed-in navigation bar: the `Navbar` row of the component inventory (AAP 0.2.3), part of
 * `core/layout` (AAP 0.7.1) and the chrome above the clients list of the "Sign in and open a client
 * record" flow (Figma node `1:3`, file `DKm5TBFbXypfqyx4xUdhBw`; AAP 0.7.4). The shell renders it
 * as `<app-navbar [userName]="…" />` above its breadcrumb and its `<router-outlet>`.
 *
 * **What it renders, and nothing besides.** The brand lockup, the one in-scope destination
 * ("Clients"), the global search, the language switcher and the user menu carrying sign-out. Every
 * other control the captured screen shows belongs to a feature that keeps living on the legacy
 * application during cutover, so none of them is rendered, stubbed or linked (AAP 0.10.5 items 4 and
 * 8): no hamburger, no notification bell, no "Accounting", "Reports" or "Admin" item, no "Import
 * Clients" button and no left icon rail. A control that navigates nowhere would be the broken
 * affordance this migration exists to avoid, and legacy behaviour is reproduced rather than improved
 * (Rule 1 clause 3).
 *
 * **It issues no request.** The navbar composes no URL and injects no Fineract service — not even
 * `SearchService`, which the results screen owns — so nothing here can reach the backend or hold a
 * host (Rule 1 clause 5, Rule 2). Searching is a navigation: the control reports the text, the scope
 * and legacy's exact-match flag, and this component routes to `/search/:query` carrying both
 * parameters.
 *
 * **Navigation is the router's.** Both destinations go through `Router`, never through a hash
 * `href` or `window.location`, which keeps the hash-location strategy of `app.routes.ts` and the
 * in-scope route list the single statement of where the application can go (Rule 1 clause 5).
 *
 * **The user menu is Angular state, not a Bootstrap plugin.** No jQuery and no Bootstrap JavaScript
 * is installed (AAP 0.6.1), so the dropdown's open state is a signal that the template binds to
 * Bootstrap 3's `.open` class; the global stylesheet renders the `.dropdown-menu` that class reveals
 * (AAP 0.5.1, AAP 0.5.4).
 *
 * **It carries no CSS.** The design's 50px height, `#FFFFFF` fill, 1px `#DFDFDF` bottom border,
 * `#5099ED` link colour, 30px search control and the brand image's sizing are the global
 * `.navbar`/`.navbar-brand`/`.navbar-default .navbar-nav`/`.navbar .form-control` rules of
 * `web-ng/src/styles.scss` (AAP 0.2.1, Rule 1 clause 6) — so there is no `styles` or `styleUrl`
 * here, no hex value and no dimension.
 *
 * **Its public contract is the inventory's.** AAP 0.2.3's `Navbar` row names the props the bar
 * offers, and the bar provides them across the controls it composes: the account name it labels the
 * menu with (`userName`), the `searchScope` the search control is seeded with, the language list
 * and the language in force (`langs`, `currentLang`), and the three reporting channels —
 * `(search)` from the `app-global-search` control it renders (AAP 0.7.1 assigns that output to
 * `GlobalSearchComponent`, whose form is the search field the bar shows), and `(langChange)` and
 * `(signOut)` declared here. The scope is an input rather than a value buried inside the search
 * control, so a host can seed the control the user meets; the two action outputs report what the
 * bar has already done, because the bar performs the switch and the sign-out itself and no consumer
 * has to act on them.
 *
 * **Nothing is logged.** The user menu displays the authenticated account name and nothing else: no
 * authentication key, no session object and no tenant reaches the template, the console or a log
 * (Rule 1 clause 9, AAP 0.10.4's credential gate).
 */
@Component({
  selector: 'app-navbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    GlobalSearchComponent,
    LanguageSwitcherComponent,
    HasPermissionDirective,
    TranslatePipe,
  ],
  templateUrl: './navbar.component.html',
})
export class NavbarComponent {
  /** The login and logout entry point; its `username` signal labels the user menu. */
  private readonly auth = inject(AuthService);

  /**
   * The source of the language in force — read for the switcher's `current` — and of the legacy
   * wording a failed bundle load is reported with. The switch itself belongs to the shared
   * `LanguageSwitcherComponent`, which owns the single `use()` call both screens share.
   */
  private readonly translate = inject(TranslateService);

  /** Route navigation for the search and the sign-out; no `window.location` anywhere in this file. */
  private readonly router = inject(Router);

  /**
   * The application's single user-facing channel, used for the two failures this component can
   * suffer: a navigation the router refuses, and a language switch whose bundle could not be loaded
   * (AAP 0.14.2 — neither is swallowed). It issues no request and holds no Fineract concern, so the
   * navbar still reaches no backend and composes no URL (Rule 1 clause 5).
   */
  private readonly notifications = inject(NotificationService);

  /**
   * The permission the "Clients" destination requires, which
   * `features/clients/clients.routes.ts` declares as its group's `data.permission`.
   *
   * It is the code the legacy template carries on the same link
   * (`has-permission='READ_CLIENT'`, `app/views/_topnavbar.html`), and it is stated here as one named
   * value so the template binds the permission rather than transcribing the string. The route table
   * remains the only route declaration; this constant duplicates one permission code, not the routes
   * (AAP 0.14.1, "Permissions are declared once per route and once per action").
   */
  readonly clientPermission = 'READ_CLIENT';

  /**
   * The languages the switcher offers — `AVAILABLE_LANGS`, the single language list of the
   * application, shared with the login screen's own switcher so a language can never be offered by
   * one and missing from the other (AAP 0.7.4; `core/i18n/translate.config.ts`).
   */
  readonly langs: readonly string[] = AVAILABLE_LANGS;

  /**
   * The scope the global search control is seeded with — AAP 0.2.3's `Navbar` prop
   * `searchScope: 'clients' | 'loans' | 'all'`.
   *
   * It is the navbar's input rather than a value the search control keeps to itself, so the screen
   * that composes the bar decides what the user meets: the default `all` searches both in-scope
   * resource families at once, which is what legacy's scope list put first (AAP 0.10.5 item 9), and
   * the user's own selection in the selector travels back out through `(search)`. `app.routes.ts`
   * renders the shell, and today the shell binds nothing, so the default stands.
   */
  readonly searchScope = input<SearchScope>('all');

  /**
   * The authenticated account name the user menu is labelled with — `mifos` after a login as
   * `mifos` — or `null` before a session restore has resolved one.
   *
   * It is `SessionService.username` reached through `AuthService`, the projection of
   * `GET /users/{id}`'s `username`, which is the value legacy renders from `currentSession.user.name`
   * in the same place. The label shows the account name only: the session, the authentication key
   * and the permission list are deliberately not exposed to the template (Rule 1 clause 9).
   */
  readonly username: Signal<string | null> = this.auth.username;

  /**
   * The account name the signed-in shell hands in, when it has one of its own (AAP 0.7.1's
   * `ShellComponent` input chain: the shell's optional `userName` input reaches this label through
   * {@link displayName}).
   *
   * Optional and `null` by default, so the navbar keeps working when nothing supplies it — the state
   * `app.routes.ts` produces, because it renders the shell without binding the shell's own optional
   * `userName`. A name supplied here wins over the session projection, which lets the host label the
   * menu for an account whose `GET /users/{id}` projection has not resolved yet.
   */
  readonly userName = input<string | null>(null);

  /**
   * The text the user menu is labelled with: the {@link userName} input when the shell supplied one,
   * and the authenticated account name {@link username} otherwise — `mifos` after a login as `mifos`,
   * the value legacy printed from `currentSession.user.name` in the same place (AAP 0.7.4).
   *
   * It is `null` only when no name was supplied and no session restore has resolved a projection, and
   * it stays the session's own label thereafter: the authentication key, the session object and the
   * permission list are never exposed to the template (Rule 1 clause 9).
   */
  readonly displayName: Signal<string | null> = computed(
    (): string | null => this.userName() ?? this.username(),
  );

  /**
   * The active language, for the native `<select>` the switcher renders.
   *
   * It reads ngx-translate's own `currentLang` signal rather than keeping a copy, so the selector
   * always shows the language whose bundle is actually loaded: a switch made by the login screen's
   * switcher updates this one with no subscription to maintain, and a bundle that fails to load
   * leaves the library on the previous language, which is exactly what the selector then shows
   * (`node_modules/@ngx-translate/core` 18.1.0, `use()`). The fallback covers the moment before the
   * first language resolves, when the library reports `null`.
   */
  readonly currentLang: Signal<string> = computed(
    (): string => this.translate.currentLang() ?? FALLBACK_LANG,
  );

  /**
   * Whether the user menu's dropdown is open.
   *
   * Angular state instead of the Bootstrap dropdown plugin, which needs jQuery and is therefore not
   * installed (AAP 0.5.1, AAP 0.5.4): the template binds this to the `.open` class the global
   * stylesheet reacts to.
   */
  readonly userMenuOpen = signal(false);

  /**
   * The user menu's trigger, referenced so the menu can hand focus back to it when it closes: the
   * panel is hidden the moment the state changes, and a keyboard user's focus would otherwise be
   * left on an element that is no longer displayed.
   */
  private readonly userMenuTrigger = viewChild<ElementRef<HTMLElement>>('userMenuTrigger');

  /**
   * Reports a language switch that has taken effect — AAP 0.2.3's `(langChange)` prop of the
   * `Navbar` row, and the bar's report of something it has already done: the shared switcher
   * performs the switch, so no consumer has to act on this for the language to change.
   *
   * It exists because the inventory names it as part of the delivered contract, which is what keeps
   * the next consumer honest: a host that wants to react to a language change — to re-resolve a
   * label, or to set the document language — has one channel to listen on rather than reaching into
   * the switcher. Nothing in the application subscribes today.
   */
  readonly langChange = output<string>();

  /**
   * Reports that the user has signed out — AAP 0.2.3's `(signOut)` prop of the `Navbar` row —
   * emitted once the session is cleared and the return to the login screen has been started.
   *
   * Like {@link langChange} it reports what the bar has already done rather than asking for it: the
   * sign-out itself remains this component's own work (AAP 0.7.1's `logout(): void`, W1), so the
   * menu entry keeps working with no consumer present, which is the state `app.routes.ts` produces
   * today.
   */
  readonly signOut = output<void>();

  /**
   * Opens the user menu, or closes it when it is already open — one click toggles, as the legacy
   * dropdown's toggle did.
   */
  toggleUserMenu(): void {
    this.userMenuOpen.update((open: boolean): boolean => !open);
  }

  /**
   * Closes the user menu.
   *
   * The template calls it on the menu's own `Escape` binding, so a keyboard user can dismiss the
   * dropdown without leaving the control, and this component calls it whenever an entry it contains
   * is activated — the menu must not stay painted over the screen the navigation just produced.
   *
   * Closing returns focus to the trigger, invisibly: the panel is hidden by the state change alone,
   * so without this the focus of a keyboard user who pressed Escape from inside the menu would be
   * dropped onto the document body.
   */
  closeUserMenu(): void {
    if (!this.userMenuOpen()) {
      return;
    }

    this.userMenuOpen.set(false);
    this.userMenuTrigger()?.nativeElement.focus();
  }

  /**
   * Reports a language switch that has taken effect (AAP 0.2.3's `(langChange)` prop).
   *
   * The switch itself belongs to the shared `LanguageSwitcherComponent`, which calls
   * `TranslateService.use()`, subscribes to it once and reconciles its own selector with the
   * language actually in force — the reasoning that used to live here, moved to the one place both
   * switchers now share. What remains for the bar is what the inventory says it reports: the code
   * whose bundle was applied, forwarded to any host that wants to react to the change. Nothing
   * navigates and no page reload happens (AAP 0.7.4), and the selector already shows the new
   * language through {@link currentLang}.
   *
   * @param code the language code the switcher reports as applied, one of {@link langs}.
   */
  onLangChange(code: string): void {
    this.langChange.emit(code);
  }

  /**
   * Reports a language switch whose bundle could not be loaded.
   *
   * The shared switcher has already put its selector back on the language in force, so the control
   * never advertises a language the application is not rendering. What the bar adds is the report:
   * this screen has no error region of its own, and the application's single user-facing channel is
   * the notification widget, so the failure is raised there rather than swallowed (AAP 0.14.2). The
   * message is legacy's own connection-failure key — the one the login screen shows for the same
   * event — so no new wording reaches the user (Rule 1 clause 3). Nothing is logged and no bundle
   * content is inspected (Rule 1 clause 9).
   *
   * This is the one place the bar adds a user-visible surface legacy did not have, and it departs
   * from Rule 1 clause 3 (legacy parity, with every deliberate difference registered in the plan)
   * because AAP 0.14.2 requires every HTTP call path to end in a rendered message or a notification,
   * and the AAP outranks the rules. The surface is unreachable in the shipped application: every
   * bundle is served, so only a broken deployment can raise it.
   */
  onLangChangeFailed(): void {
    this.notifications.show('error', this.translate.instant(GENERIC_FAILURE_KEY));
  }

  /**
   * Navigates to the global search results for the submitted text (AAP 0.7.4 "Shell: global search";
   * AAP 0.7.3 row "Shell: global search").
   *
   * The route is `/search/:query`, declared in `web-ng/src/app/app.routes.ts`, and the two
   * parameters the results screen forwards to `SearchService.search` travel beside it: the `scope`
   * the user chose and legacy's `exactMatch` flag, which `GlobalSearchComponent` derived from the
   * text the user typed. That is the pair legacy put in its own URL —
   * `location.path('/search/' + searchString).search({exactMatch: exactMatch, resource: …})`
   * (`app/scripts/controllers/main/MainController.js:208-217`) — and it is what `SearchController`
   * hands to the search resource, so both parameters have to reach the results screen. The query is
   * a path segment rather than a parameter of this file's making: `GlobalSearchComponent` has already
   * trimmed it, stripped its surrounding quotes and refused an empty search, and the router encodes
   * it. Nothing is searched here — the request belongs to `SearchService` through the results screen
   * (Rule 1 clause 5).
   *
   * @param submission the search text, the selected scope and the exact-match flag, as the search
   *   control emits them.
   */
  onSearch(submission: GlobalSearchSubmission): void {
    this.closeUserMenu();
    // Settled rather than dropped: a navigation the router refuses would otherwise be an unhandled
    // rejection, and the user is told the results screen did not open instead of being left in place.
    void this.router
      .navigate(['/search', submission.query], {
        queryParams: { scope: submission.scope, exactMatch: submission.exactMatch },
      })
      .catch((cause: unknown) => {
        this.notifications.show('error', navigationFailure(cause, 'search results').message);
      });
  }

  /**
   * Ends the session and returns to the login screen (AAP 0.7.1 `logout(): void`; AAP 0.10.1 W1).
   *
   * The order matters: `AuthService.logout()` clears the stored session, the in-memory session the
   * interceptor reads and the permission list, and only then does the navigation run, so no screen
   * can render for an instant with a session that has already ended. The interceptor's
   * `Authorization` header disappears with that session; no request is issued and no password, key
   * or session field is logged on the way out (Rule 1 clause 9).
   *
   * {@link signOut} is emitted after both steps: the session is gone and the return to the login
   * screen has been asked for, which is what AAP 0.2.3's `(signOut)` prop reports. A navigation the
   * router refuses is settled in the handler below, after the report, so a host reacting to the
   * output never precedes the session being cleared or the navigation being requested.
   *
   * The method carries the `on` prefix because the output already bears the inventory's name
   * `signOut`: a field and a method cannot share one, and the prop is the name AAP 0.2.3 fixes.
   */
  onSignOut(): void {
    this.closeUserMenu();
    this.auth.logout();
    // Settled rather than dropped: a navigation the router refuses would otherwise be an unhandled
    // rejection, and the user is told the return to the login screen did not happen. The session is
    // already cleared above, so the message is the only thing left to report.
    void this.router.navigate(['/login']).catch((cause: unknown) => {
      this.notifications.show('error', navigationFailure(cause, 'login screen').message);
    });
    this.signOut.emit();
  }
}
