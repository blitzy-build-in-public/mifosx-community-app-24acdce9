import { provideZonelessChangeDetection, signal, type Signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { of } from 'rxjs';

import { AuthService } from '../auth/auth.service';
import { PermissionsService } from '../auth/permissions.service';
import { NavbarComponent } from './navbar.component';

/**
 * Behavioural spec for `NavbarComponent` — the `Navbar` row of the component inventory (AAP 0.2.3)
 * and the signed-in chrome of the clients list screen in the "Sign in and open a client record"
 * flow (Figma node `1:3`, file `DKm5TBFbXypfqyx4xUdhBw`; AAP 0.7.1 `core/layout`, AAP 0.7.4).
 *
 * It discharges AAP 0.11.1 (a unit spec beside every component), AAP 0.14.1 ("each screen lands with
 * at least one behavioural spec") and Rule 1 clause 8 (no spec without an `expect`). Each test
 * states one contract the component owns:
 *
 * - it renders the five in-scope things — the brand lockup, the "Clients" destination, the global
 *   search, the language switcher and the user menu labelled with the authenticated account name —
 *   and renders none of the out-of-scope chrome (the hamburger, the notification bell, the
 *   Accounting / Reports / Admin items and the left icon rail), which AAP 0.10.5 items 4 and 8 fix;
 * - the "Clients" destination follows the permission the clients route declares, appearing only
 *   once that permission is held;
 * - a search reported by the search control becomes a navigation to `/search/:query` carrying the
 *   scope, and searches nothing itself;
 * - the language switcher changes the active translation without navigating, and the selector shows
 *   the language the service actually has active, including a switch made by another switcher;
 * - sign-out clears the session **before** it navigates, which is the order AAP 0.7.1 and the W1
 *   sequence require, and the user menu closes with it;
 * - the menu opens and closes on the trigger and on `Escape`, driven by Angular state rather than
 *   the Bootstrap dropdown plugin, which needs the jQuery this build does not have.
 *
 * Providers, and what their absence proves. `AuthService` and `PermissionsService` are replaced by
 * stubs typed against the real classes, so the two cannot drift and the suite never assembles a
 * session or reads storage. No HTTP provider exists anywhere in the suite: the component injects no
 * Fineract service, so an attempt to reach the backend from it would fail with NG0201 rather than
 * passing silently (Rule 1 clause 5, Rule 2). The router is the real one with an empty route table
 * and its `navigate` spied, so the assertion is what the component asked for rather than a fake.
 */

/** The permission the clients route group declares, spelled out rather than imported from routes. */
const READ_CLIENT = 'READ_CLIENT';

/** The account name a restore resolves, which is what the user menu must show. */
const ACCOUNT_NAME = 'mifos';

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
};

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
    return this.granted().includes('ALL_FUNCTIONS') || this.granted().includes(code);
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

  it('renders none of the out-of-scope chrome the legacy navbar carried', () => {
    const text = host().textContent ?? '';

    // AAP 0.10.5 item 8: no hamburger, no notification bell and no Accounting / Reports / Admin
    // destination, because every screen behind them stays on the legacy application.
    expect(host().querySelector('.navbar-toggle')).toBeNull();
    expect(host().querySelector('.fa-bell')).toBeNull();
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

  it('navigates to the search route with the selected scope when the search control reports a search', () => {
    const field = find<HTMLInputElement>('#search');
    field.value = 'ada okafor';
    field.dispatchEvent(new Event('input'));
    find<HTMLFormElement>('app-global-search form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(['/search', 'ada okafor'], {
      queryParams: { scope: 'all' },
    });
  });

  it('switches the active language without navigating', () => {
    const use = vi.spyOn(translate, 'use').mockReturnValue(of({}));
    const selector = languageSelector();
    selector.value = 'fr';
    selector.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(use).toHaveBeenCalledWith('fr');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps the selector on the language actually in force when a switch does not take effect', () => {
    // A bundle that fails to load moves nothing: the service keeps the language it had and emits no
    // change, so the control must not go on advertising the one that was asked for.
    vi.spyOn(translate, 'use').mockReturnValue(of({}));
    const selector = languageSelector();
    selector.value = 'fr';
    selector.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(languageSelector().value).toBe('en');
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
