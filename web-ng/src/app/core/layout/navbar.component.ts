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
 * Legacy key of the message a failure that is not Fineract's own text is reported with — the login screen's key for the same purpose (Rule 1 clause 3).
 */
const GENERIC_FAILURE_KEY = 'error.connection.failed';

/**
 * The signed-in navigation bar: AAP 0.2.3's `Navbar` row, part of `core/layout` (AAP 0.7.1), above the clients list of the "Sign in and open a client record"
 * flow (Figma node `1:3`, AAP 0.7.4). It renders the brand lockup, the "Clients" destination, the global search, the language switcher and the user menu with
 * sign-out, and nothing else: the hamburger, the bell, "Accounting", "Reports", "Admin", "Import Clients" and the left icon rail stay on the legacy application,
 * unrendered and unstubbed (AAP 0.10.5 items 4 and 8). It issues no request and injects no Fineract service (Rule 1 clause 5): searching is a navigation, so it
 * reports the text and scope and routes to `/search/:query`. The user menu is Angular state, not a Bootstrap plugin (AAP 0.5.1, AAP 0.5.4), and both dismissals
 * the plugin gave are reproduced — `Escape` inside the menu, and a click outside it through the `host` document listener (Rule 1 clause 3). It carries no CSS:
 * every value is a global rule of `web-ng/src/styles.scss` (AAP 0.2.1, Rule 1 clause 6). Its contract is the inventory's — `userName`, `searchScope`, `langs`,
 * `currentLang`, `(search)`, `(langChange)`, `(signOut)`. Nothing is logged (Rule 1 clause 9).
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
  host: {
    // A click anywhere outside the dropdown closes the user menu, which is what legacy's Bootstrap dropdown did (Rule 1 clause 3). The binding reaches the
    // document only while this component does, so it is not a global handler the shell has to unbind.
    '(document:click)': 'dismissUserMenuOnOutsideClick($event)',
  },
})
export class NavbarComponent {
  /** The login and logout entry point; its `username` signal labels the user menu. */
  private readonly auth = inject(AuthService);

  /**
   * The source of the language in force — read for the switcher's `current` — and of the legacy wording a failed bundle load is reported with. The switch itself belongs
   * to the shared `LanguageSwitcherComponent`, which owns the single `use()` call both screens share.
   */
  private readonly translate = inject(TranslateService);

  /** Route navigation for the search and the sign-out; no `window.location` anywhere in this file. */
  private readonly router = inject(Router);

  /**
   * The application's single user-facing channel, for the two failures this component can suffer: a navigation the router refuses, and a language switch whose bundle could
   * not be loaded (AAP 0.14.2 — neither is swallowed). It issues no request, so the navbar still reaches no backend and composes no URL (Rule 1 clause 5).
   */
  private readonly notifications = inject(NotificationService);

  /**
   * The permission the "Clients" destination requires, which `features/clients/clients.routes.ts` declares as its group's `data.permission` — the code the legacy template
   * carries on the same link (`has-permission='READ_CLIENT'`, `app/views/_topnavbar.html`). The route table remains the only route declaration (AAP 0.14.1).
   */
  readonly clientPermission = 'READ_CLIENT';

  /**
   * The languages the switcher offers — `AVAILABLE_LANGS`, the single language list of the application, shared with the login screen's switcher (AAP 0.7.4;
   * `core/i18n/translate.config.ts`).
   */
  readonly langs: readonly string[] = AVAILABLE_LANGS;

  /**
   * The scope the global search control is seeded with — AAP 0.2.3's `Navbar` prop `searchScope: 'clients' | 'loans' | 'all'`: the default `all` searches both in-scope resource
   * families at once, which is what legacy's scope list put first (AAP 0.10.5 item 9), and the user's own selection travels back out through `(search)`.
   */
  readonly searchScope = input<SearchScope>('all');

  /**
   * The authenticated account name the user menu is labelled with — `mifos` after a login as `mifos` — or `null` before a session restore has resolved one: `SessionService.username`
   * through `AuthService`, the projection of `GET /users/{id}`'s `username`. The label shows the account name only; the session, the authentication key and the permission list are
   * deliberately not exposed to the template (Rule 1 clause 9).
   */
  readonly username: Signal<string | null> = this.auth.username;

  /**
   * The account name the signed-in shell hands in, when it has one of its own (AAP 0.7.1's `ShellComponent` input chain, through {@link displayName}). Optional and `null` by
   * default, so the navbar keeps working when nothing supplies it; a name supplied here wins over the session projection.
   */
  readonly userName = input<string | null>(null);

  /**
   * The text the user menu is labelled with: the {@link userName} input when the shell supplied one, and the authenticated account name {@link username} otherwise, the value
   * legacy printed from `currentSession.user.name` in the same place (AAP 0.7.4). `null` only when no name was supplied and no session restore has resolved a projection; the
   * authentication key, the session object and the permission list are never exposed to the template (Rule 1 clause 9).
   */
  readonly displayName: Signal<string | null> = computed(
    (): string | null => this.userName() ?? this.username(),
  );

  /**
   * The active language, for the native `<select>` the switcher renders. It reads ngx-translate's own `currentLang` signal rather than keeping a copy, so the selector always shows
   * the language whose bundle is actually loaded (ngx-translate 18.1.0, `use()`).
   */
  readonly currentLang: Signal<string> = computed(
    (): string => this.translate.currentLang() ?? FALLBACK_LANG,
  );

  /**
   * Whether the user menu's dropdown is open. Angular state instead of the Bootstrap dropdown plugin, which needs jQuery and is therefore not installed (AAP 0.5.1, AAP 0.5.4):
   * the template binds it to the `.open` class the global stylesheet reacts to.
   */
  readonly userMenuOpen = signal(false);

  /**
   * The user menu's trigger, referenced so the menu can hand focus back to it when it closes: the panel is hidden the moment the state changes, and focus would otherwise be
   * left on an element no longer displayed.
   */
  private readonly userMenuTrigger = viewChild<ElementRef<HTMLElement>>('userMenuTrigger');

  /** The user menu's own list item — trigger and panel — which is the boundary an outside click is
   * measured against, as Bootstrap measured it against the element its plugin was attached to. */
  private readonly userMenu = viewChild<ElementRef<HTMLElement>>('userMenu');

  /**
   * Reports a language switch that has taken effect — AAP 0.2.3's `(langChange)` prop of the `Navbar` row, and the bar's report of something it has already done: the shared
   * switcher performs the switch, so no consumer has to act on this for the language to change. It exists because the inventory names it as part of the delivered contract.
   */
  readonly langChange = output<string>();

  /**
   * Reports that the user has signed out — AAP 0.2.3's `(signOut)` prop of the `Navbar` row — emitted once the session is cleared and the return to the login screen has been
   * started. Like {@link langChange} it reports what the bar has already done: the sign-out remains this component's own work (AAP 0.7.1's `logout(): void`, W1).
   */
  readonly signOut = output<void>();

  /** Opens the user menu, or closes it when it is already open — one click toggles, as the legacy dropdown's toggle did. */
  toggleUserMenu(): void {
    this.userMenuOpen.update((open: boolean): boolean => !open);
  }

  /**
   * Closes the user menu: the template calls it on the menu's own `Escape` binding and this component calls it whenever an entry it contains is activated, since the menu must
   * not stay painted over the screen the navigation just produced. Closing returns focus to the trigger, without which a keyboard user who pressed Escape from inside the menu
   * would be dropped onto the document body.
   */
  closeUserMenu(): void {
    if (!this.userMenuOpen()) {
      return;
    }

    this.userMenuOpen.set(false);
    this.userMenuTrigger()?.nativeElement.focus();
  }

  /** Closes the user menu when a click that reached the document landed outside it — legacy's Bootstrap
   * dropdown dismissal, driven by the `host` document listener (Rule 1 clause 3). Not through
   * {@link closeUserMenu}, which would take back the focus the outside click already placed.
   * @param event The click event Angular reports for the document, whose target decides the outcome. */
  dismissUserMenuOnOutsideClick(event: Event): void {
    if (!this.userMenuOpen()) {
      return;
    }

    const target: EventTarget | null = event.target;
    const dropdown: ElementRef<HTMLElement> | undefined = this.userMenu();
    if (target instanceof Node && dropdown !== undefined && dropdown.nativeElement.contains(target)) {
      return;
    }

    this.userMenuOpen.set(false);
  }

  /**
   * Reports a language switch that has taken effect (AAP 0.2.3's `(langChange)` prop). The switch belongs to the shared `LanguageSwitcherComponent`, which owns the single
   * `TranslateService.use()` and reconciles its selector with the language in force, so nothing navigates or reloads (AAP 0.7.4). @param code the language code the switcher reports.
   */
  onLangChange(code: string): void {
    this.langChange.emit(code);
  }

  /**
   * Reports a language switch whose bundle could not be loaded. The shared switcher has already put its selector back on the language in force, so the control never
   * advertises a language the application is not rendering; the bar adds the report, because the application's single user-facing channel is the notification widget
   * (AAP 0.14.2), in legacy's own connection-failure key so no new wording reaches the user (Rule 1 clause 3). This is the one user-visible surface the bar adds that
   * legacy did not have: it departs from Rule 1 clause 3, with the difference registered in the plan, because AAP 0.14.2 requires every HTTP call path to end in a
   * rendered message or a notification and the AAP outranks the rules. Unreachable in the shipped application, where every bundle is served.
   */
  onLangChangeFailed(): void {
    this.notifications.show('error', this.translate.instant(GENERIC_FAILURE_KEY));
  }

  /**
   * Navigates to the global search results for the submitted text (AAP 0.7.4 "Shell: global search"; AAP 0.7.3 row "Shell: global search"). The route is `/search/:query`,
   * declared in `web-ng/src/app/app.routes.ts`, and the two parameters the results screen forwards to `SearchService.search` travel beside it: the `scope` the user chose and
   * legacy's `exactMatch` flag, which `GlobalSearchComponent` derived from the text typed — the pair legacy put in its own URL
   * (`app/scripts/controllers/main/MainController.js:208-217`). Nothing is searched here — the request belongs to `SearchService` through the results screen (Rule 1 clause 5).
   * @param submission the search text, the selected scope and the exact-match flag, as the search control emits them.
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
   * Ends the session and returns to the login screen (AAP 0.7.1 `logout(): void`; AAP 0.10.1 W1). The order matters: `AuthService.logout()` clears the stored session, the
   * in-memory session the interceptor reads and the permission list, and only then does the navigation run. No request is issued and no password, key or session field is logged
   * (Rule 1 clause 9). {@link signOut} is emitted after both steps, which is what AAP 0.2.3's `(signOut)` prop reports. The `on` prefix keeps the method off the output's name.
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
