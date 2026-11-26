import { provideZonelessChangeDetection, signal, type Signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { throwError } from 'rxjs';

import { AuthService } from '../auth/auth.service';
import { PermissionsService } from '../auth/permissions.service';
import { NotificationService } from '../notifications/notification.service';
import { NavbarComponent } from './navbar.component';

/**
 * Behavioural spec for `NavbarComponent` — the `Navbar` row of the component inventory (AAP 0.2.3) and the
 * signed-in chrome of the clients list screen in the "Sign in and open a client record" flow (Figma node
 * `1:3`, file `DKm5TBFbXypfqyx4xUdhBw`; AAP 0.7.1 `core/layout`, AAP 0.7.4).
 *
 * It discharges AAP 0.11.1 (a unit spec beside every component), AAP 0.14.1 ("each screen lands with at
 * least one behavioural spec") and Rule 1 clause 8 (no spec without an `expect`). It pins the five in-scope
 * things the bar renders and the out-of-scope chrome it does not (AAP 0.10.5 items 4 and 8), the
 * permission-gated "Clients" destination including `ALL_FUNCTIONS`, the user-menu label, a search becoming a
 * navigation to `/search/:query` with the scope and exact-match flag, the language switch without
 * navigation, sign-out clearing the session before it navigates (AAP 0.7.1; W1), a navigation the router
 * refuses settled in its own words (AAP 0.14.2), the inventory's public contract (AAP 0.2.3's `Navbar`
 * props: `searchScope`, `(langChange)`, `(signOut)`), and the menu opening and closing on the trigger and on
 * `Escape` through Angular state rather than the Bootstrap dropdown plugin.
 *
 * `AuthService` and `PermissionsService` are stubs typed against the real classes, so no session is
 * assembled and no storage read. No HTTP provider exists: the component injects no Fineract service, so
 * reaching the backend from it would fail with NG0201 rather than passing silently (Rule 1 clause 5,
 * Rule 2). The router is the real one, its route table empty and its `navigate` spied.
 */

/** The permission the clients route group declares, spelled out rather than imported from routes. */
const READ_CLIENT = 'READ_CLIENT';

/**
 * The permission Fineract returns to a user who may do everything, spelled out rather than imported:
 * the wildcard the legacy gate answers before it considers any other code
 * (`app/scripts/controllers/main/MainController.js:104-127`; AAP 0.3.4 claim 12).
 */
const ALL_FUNCTIONS = 'ALL_FUNCTIONS';

/** The account name a restore resolves, which is what the user menu must show. */
const ACCOUNT_NAME = 'mifos';

/** The account name the signed-in shell hands in through the `userName` input, distinct from the above. */
const SUPPLIED_NAME = 'supplied-by-shell';

/** The text a refusing router rejects the sign-out navigation with; it is what the user must be shown. */
const SIGN_OUT_NAVIGATION_FAILURE = 'Navigation cancelled because a guard returned false';
/** The one sentence a refused return to the login screen is reported with (AAP 0.14.2). */
const LOGIN_SCREEN_MESSAGE = 'The login screen did not open. Reload the page and try again.';
/** The one sentence a refused search navigation is reported with (AAP 0.14.2). */
const SEARCH_RESULTS_MESSAGE = 'The search results did not open. Reload the page and try again.';

/**
 * Stand-in for the shipped bundles: one distinct value per key, so an assertion can tell which key
 * produced which text and can never pass on a raw dotted key. Test input only — it adds no locale
 * file and reproduces no shipped translation text (Rule 1 clause 6).
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
  'error.connection.failed': 'The connection to the server failed.',
};

/** The text the bar reports a bundle that could not be loaded with: legacy's own failure message. */
const GENERIC_MESSAGE = SPEC_BUNDLE['error.connection.failed'] ?? '';

/**
 * The half of `AuthService` the navbar reads: the account name it labels the user menu with and the
 * logout it performs. `logout` records its call so a test can prove the session is cleared before
 * the navigation runs.
 */
class AuthStub implements Pick<AuthService, 'username' | 'logout'> {
  private readonly account: WritableSignal<string | null> = signal<string | null>(ACCOUNT_NAME);

  /** The label's source, the same projection `SessionService.username` publishes. */
  readonly username: Signal<string | null> = this.account.asReadonly();

  /** Records each logout, in the order the component performs it. */
  readonly logout = vi.fn((): void => {
    this.account.set(null);
  });
}

/**
 * The half of `PermissionsService` the `hasPermission` directive asks, with the legacy algebra for
 * `ALL_FUNCTIONS` and a leading `!`. The real service reads the session, which a unit test has no
 * business assembling.
 */
class PermissionsStub implements Pick<PermissionsService, 'has'> {
  private readonly granted: WritableSignal<readonly string[]> = signal<readonly string[]>([]);

  /** Whether the permission — or its absence, for a negated code — is held. */
  has(key: string): boolean {
    const code = key.trim();
    if (code.startsWith('!')) {
      const negated = code.slice(1).trim();
      return negated.length > 0 && !this.granted().includes(negated);
    }
    return this.granted().includes(ALL_FUNCTIONS) || this.granted().includes(code);
  }

  /** Replaces the granted list, as a login or a withdrawal does. */
  grant(codes: readonly string[]): void {
    this.granted.set(codes);
  }
}

describe('NavbarComponent', () => {
  let fixture: ComponentFixture<NavbarComponent>;
  let auth: AuthStub;
  let permissions: PermissionsStub;
  let translate: TranslateService;
  let navigate: MockInstance;

  /** Every language code the bar reported as switched, in emission order: its `(langChange)` output. */
  let reported: string[];

  /** How many times the bar reported a completed sign-out: its `(signOut)` output. */
  let signOuts: number;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps the
  // assertions below type-checked and confines the boundary to this line (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The rendered element with the given selector, or a named failure when nothing matches it. */
  function find<T extends Element>(selector: string): T {
    const element: unknown = host().querySelector(selector);
    if (element === null) {
      throw new Error(`the navbar rendered no ${selector}`);
    }
    return element as T;
  }

  /** The "Clients" destination's list item, which is the element the permission gate hides. */
  const clientsItem = (): HTMLElement => find<HTMLElement>('#main-menu-left li');

  /** The user menu's trigger. */
  const userMenuTrigger = (): HTMLElement => find<HTMLElement>('#user-dropdown');

  /** The language selector. */
  const languageSelector = (): HTMLSelectElement => find<HTMLSelectElement>('#navbar-language');

  beforeEach(() => {
    // Reset first so each test starts on a fresh root injector: a permission granted by one test
    // must never reach the next, and a second `configureTestingModule` on an instantiated module
    // throws.
    TestBed.resetTestingModule();
    auth = new AuthStub();
    permissions = new PermissionsStub();

    TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslateService(),
        { provide: AuthService, useValue: auth },
        { provide: PermissionsService, useValue: permissions },
      ],
    });

    translate = TestBed.inject(TranslateService);
    for (const [language, bundle] of [['en', SPEC_BUNDLE], ['fr', SPEC_BUNDLE]] as const) {
      translate.setTranslation(language, bundle, true);
    }
    translate.use('en');

    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(NavbarComponent);
    reported = [];
    signOuts = 0;
    fixture.componentInstance.langChange.subscribe((code: string) => reported.push(code));
    fixture.componentInstance.signOut.subscribe(() => {
      signOuts += 1;
    });
    permissions.grant([READ_CLIENT]);
    fixture.detectChanges();
  });

  it('renders the brand lockup, the Clients destination, the search, the language switcher and the user menu', () => {
    const brand = find<HTMLImageElement>('.navbar-brand img');

    expect(brand.getAttribute('src')).toBe('images/MifosX_logoSmall.png');
    expect(brand.getAttribute('alt')).toBe('Mifos X');
    expect(find<HTMLAnchorElement>('#main-menu-left a').textContent).toContain('Clients');
    expect(find<HTMLAnchorElement>('#main-menu-left a').getAttribute('href')).toBe('/clients');
    expect(host().querySelector('app-global-search')).not.toBeNull();
    expect(languageSelector().value).toBe('en');
    expect(userMenuTrigger().textContent).toContain(ACCOUNT_NAME);
  });

  it('labels the user menu with the name the shell hands in, and with the session projection when it hands none', () => {
    // AAP 0.7.1's `ShellComponent` input chain: the signed-in shell passes its own `userName` down,
    // and the navbar falls back to `AuthService.username` — the `GET /users/{id}` projection — when
    // nothing above it supplies a name. The menu shows one value, never both.
    expect(userMenuTrigger().textContent).toContain(ACCOUNT_NAME);

    fixture.componentRef.setInput('userName', SUPPLIED_NAME);
    fixture.detectChanges();

    expect(userMenuTrigger().textContent).toContain(SUPPLIED_NAME);
    expect(userMenuTrigger().textContent).not.toContain(ACCOUNT_NAME);

    fixture.componentRef.setInput('userName', null);
    fixture.detectChanges();

    expect(userMenuTrigger().textContent).toContain(ACCOUNT_NAME);
  });

  it('renders none of the out-of-scope chrome the legacy navbar carried', () => {
    const text = host().textContent ?? '';

    // AAP 0.10.5 item 8: no hamburger, no notification bell and no Accounting / Reports / Admin
    // destination, because every screen behind them stays on the legacy application.
    expect(host().querySelector('.navbar-toggle')).toBeNull();
    expect(host().querySelector('.fa-bell')).toBeNull();
    // The three destinations themselves, addressed the way a link would address them: text absence
    // alone would miss a link whose label resolved to an empty string.
    expect(
      host().querySelectorAll('a[href*="accounting"], a[href*="reports"], a[href*="admin"]'),
    ).toHaveLength(0);
    expect(text).not.toContain('Accounting');
    expect(text).not.toContain('Reports');
    expect(text).not.toContain('Admin');
  });

  it('hides the Clients destination until the permission the clients route declares is held', () => {
    permissions.grant([]);
    fixture.detectChanges();
    expect(clientsItem().style.display).toBe('none');

    permissions.grant([READ_CLIENT]);
    fixture.detectChanges();
    expect(clientsItem().style.display).toBe('');
  });

  it('shows the Clients destination to a super user holding ALL_FUNCTIONS', () => {
    // The wildcard the legacy gate answers before it considers any other code, so a user who holds it
    // reaches the one in-scope destination with `READ_CLIENT` absent from the list entirely (AAP 0.3.4
    // claim 12). The item is hidden first, so what this measures is the wildcard's effect and not a
    // gate that was open all along.
    permissions.grant([]);
    fixture.detectChanges();
    expect(clientsItem().style.display).toBe('none');

    permissions.grant([ALL_FUNCTIONS]);
    fixture.detectChanges();
    expect(clientsItem().style.display).toBe('');
    expect(host().textContent).toContain('Clients');
  });

  it('navigates to the search route with the selected scope and the exact-match flag when the search control reports a search', () => {
    const field = find<HTMLInputElement>('#search');
    field.value = 'ada okafor';
    field.dispatchEvent(new Event('input'));
    find<HTMLFormElement>('app-global-search form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    // The pair legacy put in its own URL, and the pair the results screen forwards to the search
    // request: the scope beside the flag, which is `false` for text the user did not quote
    // (`app/scripts/controllers/main/MainController.js:208-217`).
    expect(navigate).toHaveBeenCalledWith(['/search', 'ada okafor'], {
      queryParams: { scope: 'all', exactMatch: false },
    });
  });

  it('carries the scope the user picked in the selector beside the search text', () => {
    // The scope travels from the control's own selector rather than from its default: the results
    // screen turns it into legacy's `resource` parameter, so a navigation that lost it would search a
    // wider scope than the user asked for (AAP 0.7.3 row "Shell: global search").
    const scope = find<HTMLSelectElement>('#search-scope');
    scope.value = 'clients';
    scope.dispatchEvent(new Event('change'));
    const field = find<HTMLInputElement>('#search');
    field.value = 'Parity Client';
    field.dispatchEvent(new Event('input'));
    find<HTMLFormElement>('app-global-search form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(['/search', 'Parity Client'], {
      queryParams: { scope: 'clients', exactMatch: false },
    });
  });

  it('seeds the search control with the searchScope it was given', async () => {
    // AAP 0.2.3's `Navbar` prop `searchScope`: the scope is the bar's input rather than state buried
    // inside the search control, so a host can decide what the user meets. The control's own
    // selector shows it, and the payload carries it from there.
    fixture.componentRef.setInput('searchScope', 'clients');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(find<HTMLSelectElement>('#search-scope').value).toBe('clients');

    const field = find<HTMLInputElement>('#search');
    field.value = 'Parity Client';
    field.dispatchEvent(new Event('input'));
    find<HTMLFormElement>('app-global-search form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(['/search', 'Parity Client'], {
      queryParams: { scope: 'clients', exactMatch: false },
    });
  });

  it('navigates with exactMatch when the search text was quoted, and drops the quotes from the path', () => {
    const field = find<HTMLInputElement>('#search');
    field.value = '"ada okafor"';
    field.dispatchEvent(new Event('input'));
    find<HTMLFormElement>('app-global-search form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    // The path segment is the unquoted text legacy searched for; the quotes survive only as the
    // flag that asks Fineract for the literal string.
    expect(navigate).toHaveBeenCalledWith(['/search', 'ada okafor'], {
      queryParams: { scope: 'all', exactMatch: true },
    });
  });

  it('switches the active language without navigating, and reports the code that took effect', async () => {
    const selector = languageSelector();
    selector.value = 'fr';
    selector.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(translate.currentLang()).toBe('fr');
    // AAP 0.2.3's `(langChange)` prop: the bar reports the switch its switcher performed, and the
    // report is what the next consumer would react to. A language switch is not a navigation.
    expect(reported).toEqual(['fr']);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps the selector on the language actually in force when a bundle cannot be loaded', () => {
    // A bundle that fails to load moves nothing: the service keeps the language it had, so the
    // control must not go on advertising the one that was asked for. The shared switcher writes it
    // back, and the bar reports the failure in the application's notification channel rather than
    // swallowing it (AAP 0.14.2).
    const notifications = TestBed.inject(NotificationService);
    vi.spyOn(translate, 'use').mockReturnValue(throwError(() => new Error('the bundle is absent')));
    const selector = languageSelector();
    selector.value = 'fr';
    selector.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(languageSelector().value).toBe('en');
    expect(reported).toEqual([]);
    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.kind).toBe('error');
    expect(notifications.messages()[0]?.message).toBe(GENERIC_MESSAGE);
  });

  it('shows a language switched by another switcher', () => {
    // The selector reads the library's own active language, so a switch made elsewhere — the login
    // screen's switcher — is reflected here without a second copy of that state.
    translate.use('fr');
    fixture.detectChanges();

    expect(languageSelector().value).toBe('fr');
  });

  it('clears the session before it navigates to the login screen on sign-out', () => {
    find<HTMLElement>('#logout').click();
    fixture.detectChanges();

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/login']);
    expect(auth.logout.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0],
    );
    expect(fixture.componentInstance.userMenuOpen()).toBe(false);
    // AAP 0.2.3's `(signOut)` prop reports the completed sign-out — once, after the session is gone
    // and the return to the login screen has started.
    expect(signOuts).toBe(1);
  });

  it('reports the sign-out through its output only once the session is cleared and the navigation has started', () => {
    const order: string[] = [];
    fixture.componentInstance.signOut.subscribe(() => order.push('reported'));
    const logout = auth.logout.getMockImplementation();
    auth.logout.mockImplementation(() => {
      order.push('logged out');
      logout?.();
    });
    navigate.mockImplementation(() => {
      order.push('navigating');
      return Promise.resolve(true);
    });

    find<HTMLElement>('#logout').click();
    fixture.detectChanges();

    // The report follows both steps, so a host reacting to it never precedes the session being
    // cleared or the navigation starting.
    expect(order).toEqual(['logged out', 'navigating', 'reported']);
  });

  it('reports a refused sign-out navigation once, after the session is cleared', async () => {
    const notifications = TestBed.inject(NotificationService);
    navigate.mockImplementation(() => Promise.reject(new Error(SIGN_OUT_NAVIGATION_FAILURE)));

    find<HTMLElement>('#logout').click();
    // Crosses a macrotask, so the handler the component attached has run and the notification it
    // raises is queued: that handler is what keeps the rejection from surfacing unhandled.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    fixture.detectChanges();

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(auth.logout.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0],
    );
    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.kind).toBe('error');
    // The bar names the screen the user was being returned to rather than repeating the router's own
    // wording (AAP 0.14.2).
    expect(notifications.messages()[0]?.message).toBe(LOGIN_SCREEN_MESSAGE);
    expect(notifications.messages()[0]?.message).not.toContain(SIGN_OUT_NAVIGATION_FAILURE);
  });

  it('reports a refused search navigation once, in the sentence naming the results screen', async () => {
    const routerWording = 'Navigation ID 3 is not equal to the current navigation id 2';
    const requestSentence = 'The request could not be completed.';
    const notifications = TestBed.inject(NotificationService);
    navigate.mockImplementation(() => Promise.reject(new Error(routerWording)));

    const field = find<HTMLInputElement>('#search');
    field.value = 'ada okafor';
    field.dispatchEvent(new Event('input'));
    find<HTMLFormElement>('app-global-search form').dispatchEvent(new Event('submit'));

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(notifications.messages()).toHaveLength(1);
    expect(notifications.messages()[0]?.kind).toBe('error');
    expect(notifications.messages()[0]?.message).toBe(SEARCH_RESULTS_MESSAGE);
    expect(notifications.messages()[0]?.message).not.toContain(routerWording);
    expect(notifications.messages()[0]?.message).not.toBe(requestSentence);
  });

  it('opens the user menu on its trigger and closes it on Escape, returning focus to the trigger', () => {
    const dropdown = find<HTMLElement>('#main-menu-right li.dropdown');

    userMenuTrigger().click();
    fixture.detectChanges();
    expect(dropdown.classList).toContain('open');
    expect(userMenuTrigger().getAttribute('aria-expanded')).toBe('true');

    find<HTMLElement>('#logout').focus();
    dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(dropdown.classList).not.toContain('open');
    expect(userMenuTrigger().getAttribute('aria-expanded')).toBe('false');

    // The panel is hidden by the state change alone, so focus is handed back rather than being left
    // on a hidden entry.
    expect(document.activeElement).toBe(userMenuTrigger());
  });
});
