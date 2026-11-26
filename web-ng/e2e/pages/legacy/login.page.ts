/** Baseline page object for the legacy AngularJS application's login screen — the `legacy` project's side of workflow W1 (log in and log out, AAP 0.10.1) and the screen of Figma node `1:5` (AAP 0.2.1 Step 1) (AAP 0.8.2, AAP 0.10.5, Rule 2, Rule 1 clause 2). */
import type { Locator, Page } from '@playwright/test';

import { FINERACT_URL, LEGACY_URL, TENANT_ID } from '../../seed/fixtures';

/** One `localStorage` entry, described by its key and by the presence and type of the three fields the legacy session carries (AAP 0.3.4 claim 9) (Rule 1 clause 9). */
export interface SessionEntrySummary {
  /** The `localStorage` key exactly as the application wrote it. */
  key: string;
  /** Whether the stored value carries a `userId` field. */
  hasUserId: boolean;
  /** `typeof` the stored `userId`, with `'missing'` for an absent or null field. */
  userIdType: 'number' | 'string' | 'missing' | 'other';
  /** Whether the stored value carries an `authenticationKey` field. */
  hasAuthenticationKey: boolean;
  authenticationKeyIsNonEmptyString: boolean;
  /** Whether the stored value carries a `userPermissions` field. */
  hasUserPermissions: boolean;
  userPermissionsIsArray: boolean;
}

/** One option of the login screen's language switcher (`LanguageSwitcher`, AAP 0.2.3; design node `1:5` shows the row "Change language:" plus its control). */
export interface LanguageOptionSummary {
  value: string;
  label: string;
}

/** What the login screen's submit control currently offers: `'absent'` when the screen renders no submit control at all, `'hidden'` when it renders one that is not visible, `'disabled'` when it is visible but cannot be clicked, and `'enabled'` when it can be clicked. */
export type SubmitState = 'absent' | 'hidden' | 'disabled' | 'enabled';

/** How long the login form is given to appear on a fresh navigation (AAP 0.10.1 W1). */
const LOGIN_FORM_TIMEOUT_MS = 5_000;

/** Ceiling for the translation bundle a language change loads. Legacy fetches `global-translations/locale-<code>.json` (AAP 0.3.4 claim 5) the first time a language is chosen and serves it from cache afterwards, so a miss is normal and never an error. */
const LANGUAGE_BUNDLE_TIMEOUT_MS = 2_000;

/** Ceiling for the post-login landing. The page itself is small; the wait covers `GET /users/{id}`, the session restore the legacy `SessionManager` runs before the shell renders (AAP 0.3.4 claim 9). */
const LANDING_TIMEOUT_MS = 20_000;

/** Ceiling for the navbar user menu to open, which legacy toggles on hover. */
const USER_MENU_TIMEOUT_MS = 2_000;

/** The hashes a successful login can land on: `#/clients` per AAP 0.2.1 Step 1, `#/home` because `MainController`'s `UserAuthenticationSuccessEvent` handler ends in `location.path('/home').replace()` (app/scripts/controllers/main/MainController.js). */
const LANDING_HASH_PATTERN = /#\/(?:clients|home)/;

/** The translation bundle a language change loads, relative to the legacy root (AAP 0.10.4). */
const LANGUAGE_BUNDLE_PATH = 'global-translations/locale-';

/** The language codes the legacy switcher offers, mapped to the names it renders (Rule 1 clause 9). */
const LEGACY_LANGUAGE_NAMES: ReadonlyMap<string, string> = new Map<string, string>([
  ['en', 'English'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['pt', 'Português'],
  ['cs', 'Čeština'],
  ['zh_CN', '中文'],
  ['hi', 'हिंदी'],
  ['ka', 'ქართული'],
  ['lo', 'ພາສາລາວ'],
  ['vi', 'tiếng Việt'],
  ['my_MM', 'မြန်မာ'],
  ['my', 'ဇော်ဂျီ'],
  ['et', 'አማርኛ'],
  ['te', 'తెలుగు'],
]);

/** The same codes as a lookup set, used to recognise which `<select>` is the language switcher. */
const LEGACY_LANGUAGE_CODES: ReadonlySet<string> = new Set<string>(LEGACY_LANGUAGE_NAMES.keys());

/** Runs inside the page: the value of every `<option>` of the element, in document order, or `[]` when the locator resolved to something other than a `<select>`. */
function readOptionValues(element: HTMLElement): string[] {
  if (!(element instanceof HTMLSelectElement)) {
    return [];
  }
  return Array.from(element.options).map((option) => option.value);
}

/** Runs inside the page: every `<option>` as `{ value, label }`, both trimmed, in document order. */
function readOptionSummaries(element: HTMLElement): LanguageOptionSummary[] {
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
      parsed = JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown;
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
      authenticationKeyIsNonEmptyString: typeof authenticationKey === 'string' && authenticationKey.length > 0,
      hasUserPermissions: record !== null && 'userPermissions' in record,
      userPermissionsIsArray: Array.isArray(userPermissions),
    };
  });
}


/** Drives the legacy application's login screen: entry, credentials, language, landing, session shape and sign-out (AAP 0.10.1 W1) (AAP 0.10.5). */
export class LoginPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Opens the login screen (AAP 0.10.1 W1's entry step). Two readings of the entry path are in play: AAP 0.8.2 and `tools/parity/in-scope-routes.json` name a `login` route, while AAP 0.2.1 Step 1 records the login screen at `#/`. */
  async open(): Promise<void> {
    await this.page.goto(this.entryUrl('#/login'));
    if (await this.waitForLoginForm()) {
      return;
    }
    await this.page.goto(this.entryUrl());
    if (await this.waitForLoginForm()) {
      return;
    }
    throw new Error(
      'The legacy login form did not appear at either reading of the login route: ' +
        `${this.entryUrl('#/login')} (AAP 0.8.2, the "login" route of in-scope-routes.json) or ` +
        `${this.entryUrl()} (AAP 0.2.1 Step 1, the login screen at "#/"). Check that the legacy app ` +
        'serves on LEGACY_URL and that it reached Fineract with the baseApiUrl and tenantIdentifier ' +
        'parameters these URLs carry.',
    );
  }

  /** Switches the interface language (AAP 0.2.3 `LanguageSwitcher`; AAP 0.10.2 compares a non-English locale too), without navigating: legacy changes the active translation in place. */
  async selectLanguage(code: string): Promise<void> {
    const bundle = this.awaitLanguageBundle(code);
    const select = await this.resolveLanguageSelect();
    if (select !== null) {
      await select.selectOption({ value: code });
      await bundle;
      return;
    }
    if ((await this.legacyLanguageGroup.count()) === 0) {
      throw new Error(
        `The login screen offers no language switcher for "${code}": no <select> whose options carry ` +
          'language codes, and no legacy "ul.lang-dropdown". Confirm the switcher markup when the ' +
          'legacy app runs.',
      );
    }
    await this.legacyLanguageToggle.click();
    const name = LEGACY_LANGUAGE_NAMES.get(code);
    const entry = this.legacyLanguageEntries.getByText(name ?? code, { exact: true }).first();
    if ((await entry.count()) === 0) {
      const offered = (await this.legacyLanguageEntries.allTextContents())
        .map((label) => label.trim())
        .join(', ');
      throw new Error(
        `The legacy language switcher offers no entry for "${code}"` +
          `${name === undefined ? '' : ` ("${name}")`}. Offered: ${offered === '' ? 'none' : offered}.`,
      );
    }
    await entry.click();
    await bundle;
  }

  /** The language switcher's options in document order (AAP 0.2.3 `LanguageSwitcher`). */
  async readLanguages(): Promise<LanguageOptionSummary[]> {
    const select = await this.resolveLanguageSelect();
    if (select !== null) {
      return select.evaluate(readOptionSummaries);
    }
    if ((await this.legacyLanguageEntries.count()) === 0) {
      return [];
    }
    const labels = await this.legacyLanguageEntries.allTextContents();
    return labels.map((label) => {
      const trimmed = label.trim();
      return { value: trimmed, label: trimmed };
    });
  }

  /** Types the credentials into the login form (AAP 0.10.1 W1). The username field's existing value is overwritten, never blanked beforehand: legacy keeps the typed username after a rejected login and clears only the password (Rule 1 clause 9). */
  async fillCredentials(username: string, password: string): Promise<void> {
    // Both fields are resolved through the ordered chain `resolveLoginField()` documents: the legacy `name` attribute, the design's translated placeholder, the design's label, then control order.
    const usernameField = await this.resolveLoginField(
      [
        'input[name="username"]',
        'input[placeholder="username"]',
        'label[for="uid"] + input',
        'input.form-control',
      ],
      'username',
    );
    await usernameField.fill(username);
    const passwordField = await this.resolveLoginField(
      ['input[name="password"]', 'input[type="password"]', 'label[for="pwd"] + input'],
      'password',
    );
    await passwordField.fill(password);
  }

  /** Clicks the form's primary submit — the one full-width "Sign In" button of AAP 0.2.3 `LoginForm`. */
  async submit(): Promise<void> {
    await this.submitButton().click();
  }

  /** Signs in and waits for the landing screen (AAP 0.10.1 W1: log in, then the client list). */
  async signIn(username: string, password: string): Promise<void> {
    await this.fillCredentials(username, password);
    await this.submit();
    await this.waitForLanding();
  }

  /** Waits for the landing screen — the destination of AAP 0.10.1 W1's login step (AAP 0.2.1, AAP 0.10.5, AAP 0.2.3). */
  async waitForLanding(): Promise<void> {
    const onLandingHash = await this.page
      .waitForURL(LANDING_HASH_PATTERN, { timeout: LANDING_TIMEOUT_MS })
      .then(() => true, () => false);
    if (onLandingHash) {
      return;
    }
    if (await this.waitForVisible(this.globalSearch, LANDING_TIMEOUT_MS)) {
      return;
    }
    throw new Error(
      'The legacy app reached neither landing signal: the hash never matched "#/clients" (AAP 0.2.1 ' +
        'Step 1) or "#/home" (MainController.js routes a successful login to "/home"), and the ' +
        'signed-in navbar search control never became visible.',
    );
  }

  /** What the baseline screen's submit control currently is, in the four readings a caller can tell apart: `'absent'` when the screen renders no submit control at all, `'hidden'` when it renders one that is not visible (Rule 1 clause 3, Rule 1 clause 4). */
  async readSubmitState(): Promise<SubmitState> {
    const button = this.submitButton();
    if ((await button.count()) === 0) {
      return 'absent';
    }
    if (!(await button.isVisible())) {
      return 'hidden';
    }
    return (await button.isDisabled()) ? 'disabled' : 'enabled';
  }

  /** The login form's error text, trimmed, or `''` when none is shown — the failure path of AAP 0.10.1 W1 (AAP 0.2.1). */
  async readFormError(): Promise<string> {
    const alert = this.page
      .locator('.container[data-ng-controller="LoginFormController"] .alert.alert-danger')
      .first();
    if ((await alert.count()) === 0 || !(await alert.isVisible())) {
      return '';
    }
    return ((await alert.textContent()) ?? '').trim();
  }

  /** The current fragment, e.g. `#/clients` — what the spec compares, since `open()` asserts none. */
  async readCurrentHash(): Promise<string> {
    return this.page.evaluate(() => window.location.hash);
  }

  /** Every `localStorage` entry's key and shape, after a login or a sign-out (AAP 0.10.1 W1: the entry is present after login and gone after logout; AAP 0.3.4 claim 9 fixes the three session fields) (AAP 0.9.4, Rule 1 clause 9). */
  async readSessionEntries(): Promise<SessionEntrySummary[]> {
    return this.page.evaluate(summariseSessionEntries);
  }

  /** Signs out through the navbar user menu (AAP 0.10.1 W1's last step) and waits for the login form. */
  async signOut(): Promise<void> {
    await this.userMenu.hover();
    if (!(await this.waitForVisible(this.signOutEntry, USER_MENU_TIMEOUT_MS))) {
      await this.userMenuToggle.click();
      await this.signOutEntry.waitFor({ state: 'visible' });
    }
    await this.signOutEntry.click();
    if (await this.waitForLoginForm()) {
      return;
    }
    await this.gotoHash('#/login', this.loginForm);
  }

  /** The design's login form: the `form.form` that owns the `#login-button` submit (AAP 0.2.1, AAP 0.2.3). */
  private get loginForm(): Locator {
    return this.page.locator('form.form').filter({ has: this.page.locator('button#login-button') });
  }

  /** The legacy language switcher group: a `uib-dropdown` button beside `ul.lang-dropdown` (app/index.html; the row the design labels "Change language:", locale-en `label.input.changelanguage`). */
  private get legacyLanguageGroup(): Locator {
    return this.page
      .locator('div.btn-group[uib-dropdown]')
      .filter({ has: this.page.locator('ul.lang-dropdown') });
  }

  /** The switcher's dropdown button, which opens the `ul.lang-dropdown` list of languages. */
  private get legacyLanguageToggle(): Locator {
    return this.legacyLanguageGroup.locator('button[uib-dropdown-toggle]').first();
  }

  /** One `li > a` per language, labelled with `lang.name` and wired to `changeLang(lang, $event)`. */
  private get legacyLanguageEntries(): Locator {
    return this.legacyLanguageGroup.locator('ul.lang-dropdown li a');
  }

  /** The navbar user menu (`li#user-menu`, app/views/_topnavbar.html), which opens on hover or on a click of its toggle. */
  private get userMenu(): Locator {
    return this.page.locator('#user-menu');
  }

  /** The menu's own `a#user-dropdown` toggle, for the build that does not open on hover. */
  private get userMenuToggle(): Locator {
    return this.userMenu.locator('a#user-dropdown, a[uib-dropdown-toggle]').first();
  }

  /** The menu's sign-out entry: `a#logout`, labelled "Sign Out" (locale-en `label.anchor.logout`) and wired to `logout()`. */
  private get signOutEntry(): Locator {
    return this.page.locator('#logout');
  }

  /** The signed-in navbar's global search input (`input#search`, AAP 0.2.3 `GlobalSearch`), rendered only once a session exists, which makes it the landing fallback `waitForLanding()` uses. */
  private get globalSearch(): Locator {
    return this.page.locator('input#search');
  }

  /** The legacy entry URL for an optional hash, carrying both query parameters the legacy app needs to reach the Blitzy Fineract backend rather than a public demo host (Rule 2; AAP 0.3.4). */
  private entryUrl(hash?: string): string {
    return (
      `${LEGACY_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}` +
      `&tenantIdentifier=${encodeURIComponent(TENANT_ID)}${hash ?? ''}`
    );
  }

  /** Navigates to a fragment of the loaded app — or opens {@link entryUrl} when the page is not on it yet — keeping the query string, and waits for the destination's root locator (Rule 2). */
  private async gotoHash(hash: string, root: Locator): Promise<void> {
    const current = this.page.url();
    if (current.startsWith(LEGACY_URL)) {
      await this.page.goto(new URL(hash, current).href);
    } else {
      await this.page.goto(this.entryUrl(hash));
    }
    if (await this.waitForVisible(root, LOGIN_FORM_TIMEOUT_MS)) {
      return;
    }
    await this.page.evaluate((target: string) => {
      window.location.hash = target;
    }, hash);
    await root.first().waitFor({ state: 'visible' });
  }

  /** The first of `candidates` that resolves to a visible field inside the login form (AAP 0.2.3, Rule 1 clause 9). */
  private async resolveLoginField(candidates: readonly string[], fieldName: string): Promise<Locator> {
    for (const candidate of candidates) {
      const field = this.loginForm.locator(candidate).first();
      if ((await field.count()) > 0 && (await field.isVisible())) {
        return field;
      }
    }
    throw new Error(
      `The legacy login form has no visible ${fieldName} field. Tried: ${candidates.join(', ')}. ` +
        'Confirm the form markup when the legacy app runs.',
    );
  }

  /** The `<select>` that is the language switcher, or `null` when the screen carries none (AAP 0.2.3). */
  private async resolveLanguageSelect(): Promise<Locator | null> {
    const selects = this.page.locator('select');
    const total = await selects.count();
    for (let index = 0; index < total; index += 1) {
      const select = selects.nth(index);
      const values = await select.evaluate(readOptionValues);
      if (values.some((value) => LEGACY_LANGUAGE_CODES.has(value.trim()))) {
        return select;
      }
    }
    return null;
  }

  /** The form's primary submit: its first `.btn.btn-primary`, which is `#login-button` in legacy. */
  private submitButton(): Locator {
    return this.loginForm.locator('button.btn.btn-primary').first();
  }

  private awaitLanguageBundle(code: string): Promise<void> {
    return this.page
      .waitForResponse((response) => response.url().includes(`${LANGUAGE_BUNDLE_PATH}${code}.json`), {
        timeout: LANGUAGE_BUNDLE_TIMEOUT_MS,
      })
      .then(() => undefined, () => undefined);
  }

  /** Whether the design's login form became visible within `timeout`. */
  private async waitForLoginForm(timeout: number = LOGIN_FORM_TIMEOUT_MS): Promise<boolean> {
    return this.waitForVisible(this.loginForm, timeout);
  }

  /** Whether `locator`'s first match became visible within `timeout`, without throwing on a miss. */
  private async waitForVisible(locator: Locator, timeout: number): Promise<boolean> {
    return locator
      .first()
      .waitFor({ state: 'visible', timeout })
      .then(() => true, () => false);
  }
}
