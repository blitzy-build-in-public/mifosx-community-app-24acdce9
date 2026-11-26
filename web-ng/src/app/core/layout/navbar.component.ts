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
 * The signed-in navigation bar: the `Navbar` row of the component inventory (AAP 0.2.3), part of `core/layout` (AAP 0.7.1) and the chrome above the clients list of the "Sign in and open a client record" flow
 * (Figma node `1:3`, file `DKm5TBFbXypfqyx4xUdhBw`; AAP 0.7.4). The shell renders it above its breadcrumb and its `<router-outlet>`. It renders the brand lockup, the one in-scope destination ("Clients"), the
 * global search, the language switcher and the user menu carrying sign-out, and nothing besides: every other control the captured screen shows belongs to a feature that keeps living on the legacy application
 * during cutover, so none is rendered, stubbed or linked — no hamburger, notification bell, "Accounting", "Reports" or "Admin" item, "Import Clients" button or left icon rail (AAP 0.10.5 items 4 and 8). A
 * control that navigates nowhere would be the broken affordance this migration exists to avoid, and legacy behaviour is reproduced rather than improved (Rule 1 clause 3). It issues no request and composes no
 * URL, injecting no Fineract service — not even `SearchService`, which the results screen owns (Rule 1 clause 5, Rule 2): searching is a navigation, so the control reports the text, the scope and legacy's
 * exact-match flag and this component routes to `/search/:query` carrying both, through `Router` rather than a hash `href` or `window.location`, which keeps the hash-location strategy of `app.routes.ts`. The
 * user menu is Angular state, not a Bootstrap plugin: no jQuery or Bootstrap JavaScript is installed (AAP 0.6.1), so the dropdown's open state is a signal bound to Bootstrap 3's `.open` class and the global
 * stylesheet renders the `.dropdown-menu` it reveals (AAP 0.5.1, AAP 0.5.4). It carries no CSS: the design's 50px height, `#FFFFFF` fill, 1px `#DFDFDF` bottom border, `#5099ED` link colour, 30px search control
 * and the brand image's sizing are the global `.navbar`/`.navbar-brand`/`.navbar-default .navbar-nav`/`.navbar .form-control` rules of `web-ng/src/styles.scss` (AAP 0.2.1, Rule 1 clause 6). Its public contract
 * is the inventory's: `userName`, the `searchScope` the search control is seeded with, `langs` and `currentLang`, and the three reporting channels — `(search)` from the `app-global-search` control it renders,
 * plus `(langChange)` and `(signOut)` declared here, which report what the bar has already done. Nothing is logged: the user menu displays the authenticated account name and nothing else (Rule 1 clause 9, AAP
 * 0.10.4's credential gate).
 *
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
   * The source of the language in force — read for the switcher's `current` — and of the legacy wording a failed bundle
   * load is reported with. The switch itself belongs to the shared `LanguageSwitcherComponent`, which owns the single
   * `use()` call both screens share.
   */
  private readonly translate = inject(TranslateService);

  /** Route navigation for the search and the sign-out; no `window.location` anywhere in this file. */
  private readonly router = inject(Router);

  /**
   * The application's single user-facing channel, used for the two failures this component can suffer: a navigation the
   * router refuses, and a language switch whose bundle could not be loaded (AAP 0.14.2 — neither is swallowed). It issues
   * no request and holds no Fineract concern, so the navbar still reaches no backend and composes no URL (Rule 1 clause 5).
   */
  private readonly notifications = inject(NotificationService);

  /**
   * The permission the "Clients" destination requires, which `features/clients/clients.routes.ts` declares as its group's
   * `data.permission`. It is the code the legacy template carries on the same link (`has-permission='READ_CLIENT'`,
   * `app/views/_topnavbar.html`), stated as one named value so the template binds the permission rather than transcribing
   * the string; the route table remains the only route declaration (AAP 0.14.1).
   */
  readonly clientPermission = 'READ_CLIENT';

  /**
   * The languages the switcher offers — `AVAILABLE_LANGS`, the single language list of the application, shared with the
   * login screen's own switcher so a language can never be offered by one and missing from the other (AAP 0.7.4;
   * `core/i18n/translate.config.ts`).
   */
  readonly langs: readonly string[] = AVAILABLE_LANGS;

  /**
   * The scope the global search control is seeded with — AAP 0.2.3's `Navbar` prop `searchScope: 'clients' | 'loans' |
   * 'all'`. It is the navbar's input rather than a value the search control keeps, so the screen that composes the bar
   * decides what the user meets: the default `all` searches both in-scope resource families at once, which is what
   * legacy's scope list put first (AAP 0.10.5 item 9), and the user's own selection travels back out through `(search)`.
   */
  readonly searchScope = input<SearchScope>('all');

  /**
   * The authenticated account name the user menu is labelled with — `mifos` after a login as `mifos` — or `null` before a session restore has resolved one. It is `SessionService.username` reached through
   * `AuthService`, the projection of `GET /users/{id}`'s `username`, which is the value legacy renders from `currentSession.user.name` in the same place. The label shows the account name only: the session, the
   * authentication key and the permission list are deliberately not exposed to the template (Rule 1 clause 9).
   *
   */
  readonly username: Signal<string | null> = this.auth.username;

  /**
   * The account name the signed-in shell hands in, when it has one of its own (AAP 0.7.1's `ShellComponent` input chain:
   * the shell's optional `userName` input reaches this label through {@link displayName}). Optional and `null` by default,
   * so the navbar keeps working when nothing supplies it. A name supplied here wins over the session projection, which
   * lets the host label the menu for an account whose `GET /users/{id}` projection has not resolved yet.
   */
  readonly userName = input<string | null>(null);

  /**
   * The text the user menu is labelled with: the {@link userName} input when the shell supplied one, and the authenticated account name {@link username} otherwise, the value legacy printed from
   * `currentSession.user.name` in the same place (AAP 0.7.4). It is `null` only when no name was supplied and no session restore has resolved a projection, and the authentication key, the session object and
   * the permission list are never exposed to the template (Rule 1 clause 9).
   *
   */
  readonly displayName: Signal<string | null> = computed(
    (): string | null => this.userName() ?? this.username(),
  );

  /**
   * The active language, for the native `<select>` the switcher renders. It reads ngx-translate's own `currentLang` signal rather than keeping a copy, so the selector
   * always shows the language whose bundle is actually loaded: a switch made by the login screen's switcher updates this one with no subscription, and a bundle that
   * fails to load leaves the library on the previous language, which is what the selector then shows (`node_modules/@ngx-translate/core` 18.1.0, `use()`).
   *
   */
  readonly currentLang: Signal<string> = computed(
    (): string => this.translate.currentLang() ?? FALLBACK_LANG,
  );

  /**
   * Whether the user menu's dropdown is open. Angular state instead of the Bootstrap dropdown plugin, which needs jQuery
   * and is therefore not installed (AAP 0.5.1, AAP 0.5.4): the template binds this to the `.open` class the global
   * stylesheet reacts to.
   */
  readonly userMenuOpen = signal(false);

  /**
   * The user menu's trigger, referenced so the menu can hand focus back to it when it closes: the panel is hidden the
   * moment the state changes, and a keyboard user's focus would otherwise be left on an element no longer displayed.
   */
  private readonly userMenuTrigger = viewChild<ElementRef<HTMLElement>>('userMenuTrigger');

  /**
   * Reports a language switch that has taken effect — AAP 0.2.3's `(langChange)` prop of the `Navbar` row, and the bar's
   * report of something it has already done: the shared switcher performs the switch, so no consumer has to act on this
   * for the language to change. It exists because the inventory names it as part of the delivered contract, so a host that
   * wants to react to a language change has one channel to listen on. Nothing in the application subscribes today.
   */
  readonly langChange = output<string>();

  /**
   * Reports that the user has signed out — AAP 0.2.3's `(signOut)` prop of the `Navbar` row — emitted once the session is cleared and the return to the login screen has been started. Like {@link langChange} it
   * reports what the bar has already done rather than asking for it: the sign-out remains this component's own work (AAP 0.7.1's `logout(): void`, W1), so the menu entry keeps working with no consumer present.
   *
   */
  readonly signOut = output<void>();

  /** Opens the user menu, or closes it when it is already open — one click toggles, as the legacy dropdown's toggle did. */
  toggleUserMenu(): void {
    this.userMenuOpen.update((open: boolean): boolean => !open);
  }

  /**
   * Closes the user menu. The template calls it on the menu's own `Escape` binding, so a keyboard user can dismiss the dropdown without leaving the control, and this
   * component calls it whenever an entry it contains is activated — the menu must not stay painted over the screen the navigation just produced. Closing returns focus
   * to the trigger, invisibly: without this the focus of a keyboard user who pressed Escape from inside the menu would be dropped onto the document body.
   *
   */
  closeUserMenu(): void {
    if (!this.userMenuOpen()) {
      return;
    }

    this.userMenuOpen.set(false);
    this.userMenuTrigger()?.nativeElement.focus();
  }

  /**
   * Reports a language switch that has taken effect (AAP 0.2.3's `(langChange)` prop). The switch itself belongs to the shared `LanguageSwitcherComponent`, which calls `TranslateService.use()`, subscribes to
   * it once and reconciles its own selector with the language actually in force; what remains for the bar is what the inventory says it reports — the code whose bundle was applied, forwarded to any host that
   * wants to react. Nothing navigates and no page reload happens (AAP 0.7.4), and the selector already shows the new language through {@link currentLang}.
   *
   * @param code the language code the switcher reports as applied, one of {@link langs}.
   *
   */
  onLangChange(code: string): void {
    this.langChange.emit(code);
  }

  /**
   * Reports a language switch whose bundle could not be loaded. The shared switcher has already put its selector back on the language in force, so the control never advertises a language the application is not
   * rendering; what the bar adds is the report, because the application's single user-facing channel is the notification widget, so the failure is raised there rather than swallowed (AAP 0.14.2), in legacy's
   * own connection-failure key so no new wording reaches the user (Rule 1 clause 3). Nothing is logged and no bundle content is inspected (Rule 1 clause 9). This is the one user-visible surface the bar adds
   * that legacy did not have: it departs from Rule 1 clause 3, with the difference registered in the plan, because AAP 0.14.2 requires every HTTP call path to end in a rendered message or a notification and
   * the AAP outranks the rules. It is unreachable in the shipped application, where every bundle is served.
   *
   */
  onLangChangeFailed(): void {
    this.notifications.show('error', this.translate.instant(GENERIC_FAILURE_KEY));
  }

  /**
   * Navigates to the global search results for the submitted text (AAP 0.7.4 "Shell: global search"; AAP 0.7.3 row "Shell: global search"). The route is `/search/:query`, declared in
   * `web-ng/src/app/app.routes.ts`, and the two parameters the results screen forwards to `SearchService.search` travel beside it: the `scope` the user chose and legacy's `exactMatch` flag, which
   * `GlobalSearchComponent` derived from the text typed — the pair legacy put in its own URL, `location.path('/search/' + searchString).search({exactMatch: exactMatch, resource: …})`
   * (`app/scripts/controllers/main/MainController.js:208-217`), which `SearchController` hands to the search resource. `GlobalSearchComponent` has already trimmed the query, stripped its surrounding quotes and
   * refused an empty search, and the router encodes it. Nothing is searched here — the request belongs to `SearchService` through the results screen (Rule 1 clause 5).
   *
   * @param submission the search text, the selected scope and the exact-match flag, as the search control emits them.
   *
   */
  onSearch(submission: GlobalSearchSubmission): void {
    this.closeUserMenu();
    // Settled rather than dropped: a refused navigation would otherwise be an unhandled rejection, and the user is told the results screen did not open instead of being left in place.
    void this.router
      .navigate(['/search', submission.query], {
        queryParams: { scope: submission.scope, exactMatch: submission.exactMatch },
      })
      .catch((cause: unknown) => {
        this.notifications.show('error', navigationFailure(cause, 'search results').message);
      });
  }

  /**
   * Ends the session and returns to the login screen (AAP 0.7.1 `logout(): void`; AAP 0.10.1 W1). The order matters: `AuthService.logout()` clears the stored session, the in-memory session the interceptor
   * reads and the permission list, and only then does the navigation run, so no screen renders for an instant with a session that has already ended. No request is issued and no password, key or session field
   * is logged on the way out (Rule 1 clause 9). {@link signOut} is emitted after both steps, which is what AAP 0.2.3's `(signOut)` prop reports; a refused navigation is settled in the handler below, after the
   * report. The method carries the `on` prefix because the output already bears the inventory's name `signOut`.
   *
   */
  onSignOut(): void {
    this.closeUserMenu();
    this.auth.logout();
    // Settled rather than dropped: a refused navigation would otherwise be an unhandled rejection, and the user is told the return to the login screen did not happen.
    // The session is already cleared above, so the message is the only thing left to report.
    void this.router.navigate(['/login']).catch((cause: unknown) => {
      this.notifications.show('error', navigationFailure(cause, 'login screen').message);
    });
    this.signOut.emit();
  }
}
