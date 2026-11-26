/** Page object for the new Angular application's login screen — the `next` project's side of workflow W1 (log in and log out, AAP 0.10.1) and the screen every other workflow passes through before it can start. **Route.** (AAP 0.8.2, AAP 0.10.5, Rule 2, AAP 0.4.4). */
import type { Locator, Page } from '@playwright/test';

import { FINERACT_URL, NEXT_URL, TENANT_ID } from '../../seed/fixtures';

/** One `localStorage` entry, described by its key and by the presence and type of the three fields the session carries (AAP 0.3.4 claim 9) (Rule 1 clause 9). */
export interface SessionEntrySummary {
  readonly key: string;
  readonly hasUserId: boolean;
  /** `typeof` the stored `userId`: `'number'` or `'string'` when it holds one, `'missing'` when the field is undefined or null, and `'other'` for any other present type — a boolean, an array, an object. */
  readonly userIdType: 'number' | 'string' | 'missing' | 'other';
  readonly hasAuthenticationKey: boolean;
  readonly authenticationKeyIsNonEmptyString: boolean;
  readonly hasUserPermissions: boolean;
  readonly userPermissionsIsArray: boolean;
}

/** One option of the login screen's language switcher (`LanguageSwitcher`, AAP 0.2.3; design node `1:5` shows the row "Change language:" plus its control). */
export interface LanguageOptionSummary {
  readonly value: string;
  readonly label: string;
}

/** What the login screen's submit control currently offers: `'absent'` when the screen renders no submit control at all, `'hidden'` when it renders one that is not visible, `'disabled'` when it is visible but cannot be. */
export type SubmitState = 'absent' | 'hidden' | 'disabled' | 'enabled';

const ROOT_SELECTOR = 'app-login';

/** The language switcher. The screen renders one bare native `<select>` (the Angular-native replacement for the legacy plugin, AAP 0.10.5 item 2), so no wrapper component element is involved and this is the only `<select>`. */
const LANGUAGE_SELECT_SELECTOR = 'select';

/** The username control, in the order it is tried: the reactive form's control name, then the `.form-control` that follows the label naming the field, then the screen's only non-search text input. */
const USERNAME_SELECTORS: readonly string[] = [
  'input[formcontrolname="username"]',
  'input[name="username"]',
  '.form-group:has(> label:text-matches("user\\s*name", "i")) input.form-control',
  'input[type="text"]:not([type="search"])',
];

const PASSWORD_SELECTORS: readonly string[] = [
  'input[type="password"]',
  'input[formcontrolname="password"]',
  'input[name="password"]',
];

const SUBMIT_SELECTORS: readonly string[] = [
  '.btn.btn-primary',
  'button#login-button',
  'button[type="submit"]',
];

const FORM_ERROR_SELECTOR = '.alert.alert-danger';

/** The signed-in client list: the landing screen a successful login reaches (AAP 0.10.5 item 3). */
const CLIENT_LIST_SELECTOR = 'app-client-list';

const LANDING_HASH = '#/clients';

const USER_MENU_TOGGLE_SELECTORS: readonly string[] = [
  '#user-dropdown',
  '.dropdown-toggle',
  '.dropdown > a',
];

/** The list the user menu reveals. It is in the DOM while closed and hidden by the `.open` class. */
const USER_MENU_LIST_SELECTOR = 'app-navbar .dropdown-menu';

const SIGN_OUT_LABEL_PATTERN = /sign\s*out|log\s*out/i;

const LOGIN_FORM_TIMEOUT_MS = 10_000;

/** Ceiling for the post-login landing. The page itself is small; the wait covers `POST /authentication`, the stored session, the redirect and the client list's own `GET /clients`. */
const LANDING_TIMEOUT_MS = 30_000;

const USER_MENU_TIMEOUT_MS = 5_000;

/** Runs inside the page: every `<option>` of the language switcher as `{ value, label }`, both trimmed, in document order. */
function readLanguageOptions(element: HTMLElement): LanguageOptionSummary[] {
  if (!(element instanceof HTMLSelectElement)) {
    return [];
  }
  return Array.from(element.options).map((option) => ({
    value: option.value.trim(),
    label: (option.textContent ?? '').trim(),
  }));
}

/** Runs inside the page: every `localStorage` entry's key and shape, and nothing else (Rule 1 clause 4, Rule 1 clause 9). */
function summariseSessionEntries(): SessionEntrySummary[] {
  return Object.keys(window.localStorage).map((key): SessionEntrySummary => {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(window.localStorage.getItem(key) ?? 'null');
    } catch {
      parsed = null;
    }
    const record: Record<string, unknown> | null =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    const userId = record === null ? undefined : record['userId'];
    const authenticationKey = record === null ? undefined : record['authenticationKey'];
    const userPermissions = record === null ? undefined : record['userPermissions'];
    let userIdType: SessionEntrySummary['userIdType'] = 'other';
    if (userId === undefined || userId === null) {
      userIdType = 'missing';
    } else if (typeof userId === 'number') {
      userIdType = 'number';
    } else if (typeof userId === 'string') {
      userIdType = 'string';
    }
    return {
      key,
      hasUserId: record !== null && 'userId' in record,
      userIdType,
      hasAuthenticationKey: record !== null && 'authenticationKey' in record,
      authenticationKeyIsNonEmptyString:
        typeof authenticationKey === 'string' && authenticationKey.length > 0,
      hasUserPermissions: record !== null && 'userPermissions' in record,
      userPermissionsIsArray: Array.isArray(userPermissions),
    };
  });
}

/** Drives the new application's login screen: entry, credentials, language, landing, session shape and sign-out (AAP 0.10.1 W1) (AAP 0.10.5). */
export class LoginPage {
  constructor(private readonly page: Page) {}

  /** Opens the login screen (the entry step of AAP 0.10.1 W1) and waits for the form. */
  async open(): Promise<void> {
    await this.navigate('/login');
    await this.root().waitFor({ state: 'visible', timeout: LOGIN_FORM_TIMEOUT_MS });
  }

  /** Switches the interface language (AAP 0.10.2 compares a non-English locale too) without navigating: the switcher calls the translate service in place, so no reload happens and the hash is unchanged. */
  async selectLanguage(code: string): Promise<void> {
    await this.languageSelect().selectOption({ value: code });
  }

  /** The language switcher's options in document order (AAP 0.2.3 `LanguageSwitcher`). */
  async readLanguages(): Promise<LanguageOptionSummary[]> {
    return this.languageSelect().evaluate(readLanguageOptions);
  }

  /** Fills both credential fields (AAP 0.10.1 W1). `fill()` replaces whatever the field held, so a rejected attempt leaves a clean form for the next one; nothing is typed character by character and nothing is read back (Rule 1 clause 9). */
  async fillCredentials(username: string, password: string): Promise<void> {
    const usernameField = await this.resolveControl(USERNAME_SELECTORS, 'username');
    await usernameField.fill(username);
    const passwordField = await this.resolveControl(PASSWORD_SELECTORS, 'password');
    await passwordField.fill(password);
  }

  /** Clicks the form's primary submit once. No extra readiness step and no retry: the button disables itself while `POST /authentication` is in flight (`[disabled]="guard.busy()"`), which is the duplicate-submission. */
  async submit(): Promise<void> {
    const button = await this.resolveControl(SUBMIT_SELECTORS, 'submit');
    await button.click();
  }

  /** Signs in and waits for the landing screen (AAP 0.10.1 W1: log in, then the client list) (AAP 0.10.2). */
  async signIn(username: string, password: string): Promise<void> {
    await this.fillCredentials(username, password);
    await this.submit();
    await this.waitForLanding();
  }

  /** What the screen's submit control currently is, in the four readings a caller can tell apart: `'absent'` when the login screen renders no submit control at all, `'hidden'` when it renders one that is not visible (Rule 1 clause 3, Rule 1 clause 4). */
  async readSubmitState(): Promise<SubmitState> {
    const button = await this.findControl(SUBMIT_SELECTORS);
    if (button === null) {
      return 'absent';
    }
    if (!(await button.isVisible())) {
      return 'hidden';
    }
    return (await button.isDisabled()) ? 'disabled' : 'enabled';
  }

  /** The login form's error text, trimmed, or `''` when no failure is shown — the rejected-login path of AAP 0.10.1 W1, and the surface a Fineract validation message reaches on this screen (AAP 0.7.4, AAP 0.10.2, AAP 0.2.1). */
  async readFormError(): Promise<string> {
    const alert = this.root().locator(FORM_ERROR_SELECTOR).first();
    if ((await alert.count()) === 0) {
      return '';
    }
    return ((await alert.textContent()) ?? '').trim();
  }

  /** Waits for the landing screen: the hash is `#/clients` and the client list is visible. */
  async waitForLanding(): Promise<void> {
    const listVisible = await this.clientList()
      .waitFor({ state: 'visible', timeout: LANDING_TIMEOUT_MS })
      .then(
        () => true,
        () => false,
      );
    const hash = await this.readCurrentHash();
    if (listVisible && hash === LANDING_HASH) {
      return;
    }
    throw new Error(
      `The new application did not land on the client list after signing in: the hash is ` +
        `"${hash === '' ? '(none)' : hash}" and the client list is ` +
        `${listVisible ? 'visible' : 'not visible'}. A successful login lands on "${LANDING_HASH}" ` +
        '(AAP 0.10.5 item 3), so check the credentials, that NEXT_URL serves this application, and ' +
        'that the entry URL reached FINERACT_URL rather than another backend.',
    );
  }

  /** The current fragment, e.g. `#/clients`; an empty string when the address carries none. */
  async readCurrentHash(): Promise<string> {
    return this.page.evaluate(() => window.location.hash);
  }

  /** Every `localStorage` entry's key and shape, after a login or a sign-out — W1 records the session entry as present after a login and absent after a logout (AAP 0.10.1) (AAP 0.9.4, Rule 1 clause 9). */
  async readSessionEntries(): Promise<SessionEntrySummary[]> {
    return this.page.evaluate(summariseSessionEntries);
  }

  /** Signs out through the navbar user menu (the last step of AAP 0.10.1 W1) and waits for the login form. */
  async signOut(): Promise<void> {
    const entry = this.signOutEntry();
    if (!(await entry.isVisible())) {
      const menuOpen = (await this.navbar().locator('li.dropdown.open').count()) > 0;
      if (!menuOpen) {
        const toggle = await this.resolveControl(
          USER_MENU_TOGGLE_SELECTORS,
          'user menu toggle',
          this.navbar(),
        );
        await toggle.click();
      }
    }
    await entry.waitFor({ state: 'visible', timeout: USER_MENU_TIMEOUT_MS });
    await entry.click();
    await this.root().waitFor({ state: 'visible', timeout: LOGIN_FORM_TIMEOUT_MS });
  }

  private root(): Locator {
    return this.page.locator(ROOT_SELECTOR).first();
  }

  private clientList(): Locator {
    return this.page.locator(CLIENT_LIST_SELECTOR).first();
  }

  private navbar(): Locator {
    return this.page.locator('app-navbar').first();
  }

  private languageSelect(): Locator {
    return this.root().locator(LANGUAGE_SELECT_SELECTOR).first();
  }

  private signOutEntry(): Locator {
    const menu = this.page.locator(USER_MENU_LIST_SELECTOR).first();
    const labelled = menu.locator('a').filter({ hasText: SIGN_OUT_LABEL_PATTERN });
    return labelled.or(menu.locator('li a').last()).first();
  }

  private async findControl(
    selectors: readonly string[],
    scope: Locator = this.root(),
  ): Promise<Locator | null> {
    for (const selector of selectors) {
      const candidate = scope.locator(selector).first();
      if ((await candidate.count()) > 0) {
        return candidate;
      }
    }
    return null;
  }

  private async resolveControl(
    selectors: readonly string[],
    description: string,
    scope: Locator = this.root(),
  ): Promise<Locator> {
    const control = await this.findControl(selectors, scope);
    if (control === null) {
      throw new Error(
        `The screen renders no ${description} control. Tried: ${selectors.join(', ')}. Confirm the ` +
          'markup in the component templates under web-ng/src/app and that the screen, not another ' +
          'one, is open.',
      );
    }
    return control;
  }

  /** The entry URL for a route: this application's origin, both query parameters that select the backend, then the fragment (Rule 2; AAP 0.4.4 decisions 3 and 5). */
  private screenUrl(route: string): string {
    return (
      `${NEXT_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}` +
      `&tenantIdentifier=${encodeURIComponent(TENANT_ID)}#${route}`
    );
  }

  /** Opens a route of this application and makes sure the fragment took effect (Rule 2). */
  private async navigate(route: string): Promise<void> {
    await this.page.goto(this.screenUrl(route));
    const settled = await this.page.evaluate(
      (target: string) => window.location.hash === '#' + target,
      route,
    );
    if (!settled) {
      await this.page.evaluate((target: string) => {
        window.location.hash = '#' + target;
      }, route);
    }
  }
}
