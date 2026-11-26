import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
  type Signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { navigationFailure } from '../../core/http/api-error';
import { HasPermissionDirective } from '../../shared/has-permission.directive';
import { AuthService } from '../auth/auth.service';
import { AVAILABLE_LANGS, FALLBACK_LANG } from '../i18n/translate.config';
import { NotificationService } from '../notifications/notification.service';
import { GlobalSearchComponent, type GlobalSearchSubmission } from './global-search.component';

/** The signed-in navigation bar: the `Navbar` row of the component inventory (AAP 0.2.3), part of `core/layout` (AAP 0.7.1) and the chrome above the clients list of the "Sign in and open a client record" flow (Figma node (AAP 0.7.4, AAP 0.10.5, Rule 1 clause 3, Rule 1 clause 5). */
@Component({
  selector: 'app-navbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, GlobalSearchComponent, HasPermissionDirective, TranslatePipe],
  templateUrl: './navbar.component.html',
})
export class NavbarComponent {
  /** The login and logout entry point; its `username` signal labels the user menu. */
  private readonly auth = inject(AuthService);

  /** The one owner of the active language and of the bundle list the switcher offers. */
  private readonly translate = inject(TranslateService);

  /** Route navigation for the search and the sign-out; no `window.location` anywhere in this file. */
  private readonly router = inject(Router);

  /** The application's single user-facing channel, used for the one failure this component can suffer — a navigation the router refuses (Rule 1 clause 5). */
  private readonly notifications = inject(NotificationService);

  /** The permission the "Clients" destination requires, which `features/clients/clients.routes.ts` declares as its group's `data.permission` (AAP 0.14.1). */
  readonly clientPermission = 'READ_CLIENT';

  /** The languages the switcher offers — `AVAILABLE_LANGS`, the single language list of the application, shared with the login screen's own switcher so a language can never be offered by one and missing from the other (AAP (AAP 0.7.4). */
  readonly langs: readonly string[] = AVAILABLE_LANGS;

  /** The authenticated account name the user menu is labelled with — `mifos` after a login as `mifos` — or `null` before a session restore has resolved one (Rule 1 clause 9). */
  readonly username: Signal<string | null> = this.auth.username;

  /** The account name the signed-in shell hands in, when it has one of its own (AAP 0.7.1's `ShellComponent` input chain: the shell's optional `userName` input reaches this label through {@link displayName}). */
  readonly userName = input<string | null>(null);

  /** The text the user menu is labelled with: the {@link userName} input when the shell supplied one, and the authenticated account name {@link username} otherwise — `mifos` after a login as `mifos`, the value legacy printed (AAP 0.7.4, Rule 1 clause 9). */
  readonly displayName: Signal<string | null> = computed(
    (): string | null => this.userName() ?? this.username(),
  );

  /** The active language, for the native `<select>` the switcher renders. */
  readonly currentLang: Signal<string> = computed(
    (): string => this.translate.currentLang() ?? FALLBACK_LANG,
  );

  /** Whether the user menu's dropdown is open. Angular state instead of the Bootstrap dropdown plugin, which needs jQuery and is therefore not installed (AAP 0.5.1, AAP 0.5.4): the template binds this to the `.open` class. */
  readonly userMenuOpen = signal(false);

  /** The user menu's trigger, referenced so the menu can hand focus back to it when it closes: the panel is hidden the moment the state changes, and a keyboard user's focus would otherwise be left on an element that is no. */
  private readonly userMenuTrigger = viewChild<ElementRef<HTMLElement>>('userMenuTrigger');

  /** Opens the user menu, or closes it when it is already open — one click toggles, as the legacy dropdown's toggle did. */
  toggleUserMenu(): void {
    this.userMenuOpen.update((open: boolean): boolean => !open);
  }

  /** Closes the user menu. The template calls it on the menu's own `Escape` binding, so a keyboard user can dismiss the dropdown without leaving the control, and this component calls it whenever an entry it contains is. */
  closeUserMenu(): void {
    if (!this.userMenuOpen()) {
      return;
    }

    this.userMenuOpen.set(false);
    this.userMenuTrigger()?.nativeElement.focus();
  }

  /** Switches the active translation in place: no page reload and no navigation (AAP 0.7.4). */
  onLangChange(code: string, select: HTMLSelectElement): void {
    const language: string = code.trim();

    if (language.length > 0) {
      this.translate.use(language);
    }

    select.value = this.currentLang();
  }

  /** Navigates to the global search results for the submitted text (AAP 0.7.4 "Shell: global search"; AAP 0.7.3 row "Shell: global search") (Rule 1 clause 5). */
  onSearch(submission: GlobalSearchSubmission): void {
    this.closeUserMenu();
    // Settled rather than dropped: a navigation the router refuses would otherwise be an unhandled rejection, and the user is told the results screen did not open instead of being left in place.
    void this.router
      .navigate(['/search', submission.query], {
        queryParams: { scope: submission.scope, exactMatch: submission.exactMatch },
      })
      .catch((cause: unknown) => {
        this.notifications.show('error', navigationFailure(cause, 'search results').message);
      });
  }

  /** Ends the session and returns to the login screen (AAP 0.7.1 `logout(): void`; AAP 0.10.1 W1) (Rule 1 clause 9). */
  signOut(): void {
    this.closeUserMenu();
    this.auth.logout();
    // Settled rather than dropped: a navigation the router refuses would otherwise be an unhandled rejection, and the user is told the return to the login screen did not happen.
    void this.router.navigate(['/login']).catch((cause: unknown) => {
      this.notifications.show('error', navigationFailure(cause, 'login screen').message);
    });
  }
}
