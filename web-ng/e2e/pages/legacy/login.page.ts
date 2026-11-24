/**
 * Baseline page object for the legacy AngularJS application's login screen — the `legacy` project's
 * side of workflow W1 (log in and log out, AAP 0.10.1) and the screen of Figma node `1:5`
 * (AAP 0.2.1 Step 1).
 *
 * The route is `#/login` (AAP 0.8.2, `tools/parity/in-scope-routes.json`), and the design's login
 * form is the one `app/index.html` renders whenever no session exists — which is why the same screen
 * is also visible at `#/` / `#/home` (AAP 0.10.5 item 3 records those as the legacy dashboard paths).
 * `open()` accepts either reading and `readCurrentHash()` reports which one the build actually took;
 * this class never asserts it, because assertions belong to the specs under `web-ng/e2e/specs/`.
 *
 * **Entry URL (Rule 2).** Every navigation composes `LEGACY_URL` + `?baseApiUrl=` + `FINERACT_URL`
 * + `&tenantIdentifier=` + `TENANT_ID`. Without both query parameters the legacy app targets a public
 * demo host (app/scripts/initialTasks.js:5,33-44), which Rule 2 forbids; no host literal appears in
 * this file, and no Fineract path does either (Rule 1 clause 2).
 *
 * **Session storage open item (AAP 0.9.4 row 7).** Legacy writes its session with
 * `webStorage.add("sessionData", {userId, authenticationKey, userPermissions})` under the `mifosX`
 * prefix (app/scripts/services/SessionManager.js:20, app/scripts/webstorage-configuration.js:3), but
 * the bower `angular-webstorage` library is not vendored, so the serialised key string is known only
 * once a legacy login has been observed. `readSessionEntries()` therefore enumerates every key and
 * reports the shape it found: a hard-coded key would let both applications agree on a wrong one.
 *
 * **Security (Rule 1 clause 9).** The authentication key, the parsed session object, the raw stored
 * JSON and the password never leave this class: `readSessionEntries()` returns key names and booleans
 * only, `fillCredentials()` writes a password it never echoes, and `password` exists solely as a
 * parameter name.
 *
 * The legacy source tree is a read-only reference outside this checkout (clone at commit 45ec7b82),
 * so every locator and label below carries the legacy or AAP fact it derives from and must be
 * confirmed against the running legacy app.
 */
import type { Locator, Page } from '@playwright/test';

import { FINERACT_URL, LEGACY_URL, TENANT_ID } from '../../seed/fixtures.js';

/**
 * One `localStorage` entry, described by its key and by the presence and type of the three fields the
 * legacy session carries (AAP 0.3.4 claim 9).
 *
 * Shape only, by design: the entry's values stay in the browser and never reach a test report
 * (Rule 1 clause 9). `web-ng/e2e/pages/next/login.page.ts` declares the identical interface, so one
 * spec can compare the two applications' session entries against the same type.
 */
export interface SessionEntrySummary {
  /** The `localStorage` key exactly as the application wrote it. */
  key: string;
  /** Whether the stored value carries a `userId` field. */
  hasUserId: boolean;
  /** `typeof` the stored `userId`, with `'missing'` for an absent or null field. */
  userIdType: 'number' | 'string' | 'missing' | 'other';
  /** Whether the stored value carries an `authenticationKey` field. */
  hasAuthenticationKey: boolean;
  /** Whether that field holds a non-empty string — the form a usable key has. */
  authenticationKeyIsNonEmptyString: boolean;
  /** Whether the stored value carries a `userPermissions` field. */
  hasUserPermissions: boolean;
  /** Whether that field holds an array, which is what the permission gate iterates. */
  userPermissionsIsArray: boolean;
}

/**
 * One option of the login screen's language switcher (`LanguageSwitcher`, AAP 0.2.3; design node
 * `1:5` shows the row "Change language:" plus its control).
 *
 * `value` is the language code a native `<select>` submits (e.g. `en`, `zh_CN`), as the legacy
 * `mifosX.models.Langs` entries carry it. The legacy switcher renders only the language name, so on
 * that side `value` repeats the label — see `readLanguages()`.
 */
export interface LanguageOptionSummary {
  /** Code the switcher submits, or the visible label when the control exposes no code. */
  value: string;
  /** Visible option label, trimmed. */
  label: string;
}

/** How long the login form is given to appear on a fresh navigation (AAP 0.10.1 W1). */
const LOGIN_FORM_TIMEOUT_MS = 5_000;

/**
 * Ceiling for the translation bundle a language change loads. Legacy fetches
 * `global-translations/locale-<code>.json` (AAP 0.3.4 claim 5) the first time a language is chosen
 * and serves it from cache afterwards, so a miss is normal and never an error.
 */
const LANGUAGE_BUNDLE_TIMEOUT_MS = 2_000;

/**
 * Ceiling for the post-login landing. The page itself is small; the wait covers `GET /users/{id}`,
 * the session restore the legacy `SessionManager` runs before the shell renders (AAP 0.3.4 claim 9).
 */
const LANDING_TIMEOUT_MS = 20_000;

/** Ceiling for the navbar user menu to open, which legacy toggles on hover. */
const USER_MENU_TIMEOUT_MS = 2_000;

/**
 * The hashes a successful login can land on: `#/clients` per AAP 0.2.1 Step 1, `#/home` because
 * `MainController`'s `UserAuthenticationSuccessEvent` handler ends in
 * `location.path('/home').replace()` (app/scripts/controllers/main/MainController.js).
 */
const LANDING_HASH_PATTERN = /#\/(?:clients|home)/;

/**
 * The translation bundle a language change loads, relative to the legacy root. Held without a
 * leading slash and matched against a response URL so that this file carries no URL literal:
 * `check:endpoints` scans `web-ng/e2e/` for those (AAP 0.10.4).
 */
const LANGUAGE_BUNDLE_PATH = 'global-translations/locale-';

/**
 * The language codes the legacy switcher offers, mapped to the names it renders.
 *
 * Transcribed from `app/scripts/models/Langs.js`, where `changeLang(lang, $event)` applies
 * `lang.code` while the menu shows `lang.name` — so the code a spec asks for is not in the DOM and
 * has to be resolved through this map. The names are legacy data, not tenant data (Rule 1 clause 9),
 * and a build whose list differs shows up as an unmatched option rather than as a silent pass.
 */
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

/**
 * Runs inside the page: the value of every `<option>` of the element, in document order, or `[]` when
 * the locator resolved to something other than a `<select>`.
 */
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

/**
 * Runs inside the page: every `localStorage` entry's key and shape, and nothing else.
 *
 * The stored value is unmodelled legacy storage — `angular-webstorage` writes whatever the caller
 * passed, keyed by a prefix the library does not expose here — so it is parsed into `unknown` and
 * narrowed field by field (Rule 1 clause 4). A value that is not JSON object yields an entry with
 * every flag false and `userIdType` `'missing'`, which is the honest reading: no session fields were
 * found under that key. Only key names and booleans leave the page (Rule 1 clause 9).
 */
function summariseSessionEntries(): SessionEntrySummary[] {
  function userIdKind(value: unknown): SessionEntrySummary['userIdType'] {
    if (value === undefined || value === null) {
      return 'missing';
    }
    if (typeof value === 'number') {
      return 'number';
    }
    if (typeof value === 'string') {
      return 'string';
    }
    return 'other';
  }

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
    return {
      key,
      hasUserId: record !== null && 'userId' in record,
      userIdType: userIdKind(userId),
      hasAuthenticationKey: record !== null && 'authenticationKey' in record,
      authenticationKeyIsNonEmptyString: typeof authenticationKey === 'string' && authenticationKey.length > 0,
      hasUserPermissions: record !== null && 'userPermissions' in record,
      userPermissionsIsArray: Array.isArray(userPermissions),
    };
  });
}


/**
 * Drives the legacy application's login screen: entry, credentials, language, landing, session shape
 * and sign-out (AAP 0.10.1 W1).
 *
 * Everything here is a locator or a typed reader — no assertion, and no filtering of what the baseline
 * renders: differences belong in the parity report (AAP 0.10.5), not in this page object.
 */
export class LoginPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Opens the login screen (AAP 0.10.1 W1's entry step).
   *
   * Two readings of the entry path are in play: AAP 0.8.2 and `tools/parity/in-scope-routes.json`
   * name a `login` route, while AAP 0.2.1 Step 1 records the login screen at `#/` — `app/index.html`
   * shows that container whenever no session exists, and `routes.js` sends `/` to the dashboard. The
   * `#/login` reading is tried first, the bare entry URL second, and only then does this throw,
   * naming both. The settled hash is reported by `readCurrentHash()`, never asserted here.
   */
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

  /**
   * Switches the interface language (AAP 0.2.3 `LanguageSwitcher`; AAP 0.10.2 compares a non-English
   * locale too), without navigating: legacy changes the active translation in place.
   *
   * A native `<select>` is driven directly. The legacy switcher is a `uib-dropdown` of language links
   * instead (app/index.html), so it is opened, the entry for `code` is clicked, and the translation
   * bundle that change loads is awaited with a ceiling a cached bundle is allowed to exceed.
   */
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

  /**
   * The language switcher's options in document order (AAP 0.2.3 `LanguageSwitcher`).
   *
   * A native `<select>` reports its `value`/`label` pairs. The legacy switcher renders the language
   * name only — the code lives in the controller, not the DOM — so there `value` repeats the label,
   * which is why `selectLanguage()` resolves a code through `LEGACY_LANGUAGE_NAMES`.
   */
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

  /**
   * Types the credentials into the login form (AAP 0.10.1 W1).
   *
   * The username field's existing value is overwritten, never blanked beforehand: legacy keeps the
   * typed username after a rejected login and clears only the password (`LoginFormController` on
   * `UserAuthenticationFailureEvent`). Neither value is echoed anywhere (Rule 1 clause 9).
   */
  async fillCredentials(username: string, password: string): Promise<void> {
    // Both fields are resolved through the ordered chain `resolveLoginField()` documents: the legacy
    // `name` attribute, the design's translated placeholder, the design's label, then control order.
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

  /**
   * Clicks the form's primary submit — the one full-width "Sign In" button of AAP 0.2.3 `LoginForm`.
   *
   * `click()` waits for the button to be visible and enabled, which is the only guard added: legacy
   * swaps it for a "loading..." primary button while `POST /authentication` is in flight, so a second
   * click waits for the first submission to finish instead of sending a second request.
   */
  async submit(): Promise<void> {
    await this.submitButton().click();
  }

  /** Signs in and waits for the landing screen (AAP 0.10.1 W1: log in, then the client list). */
  async signIn(username: string, password: string): Promise<void> {
    await this.fillCredentials(username, password);
    await this.submit();
    await this.waitForLanding();
  }

  /**
   * Waits for the landing screen — the destination of AAP 0.10.1 W1's login step.
   *
   * The primary signal is the hash: `#/clients` per AAP 0.2.1 Step 1, or `#/home`, because
   * `MainController`'s `UserAuthenticationSuccessEvent` handler ends in
   * `location.path('/home').replace()` and AAP 0.10.5 item 3 records `/` and `/home` as the legacy
   * dashboard paths. A build that lands anywhere else is recognised by the signed-in navbar's global
   * search control, which the anonymous screen does not render (AAP 0.2.3 `GlobalSearch`).
   */
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

  /**
   * Whether the primary submit is unavailable (AAP 0.2.3 `LoginForm`: the button disables while its
   * request is in flight).
   *
   * "Unavailable" covers both forms the two applications express it in: the new app disables the
   * button, while legacy hides it and shows a "loading..." primary button instead (`app/index.html`,
   * `data-ng-show="!load"` on the submit and `data-ng-show="load"` on the loading one). A hidden
   * submit is therefore reported as disabled, as is a form that carries no submit at all.
   */
  async isSubmitDisabled(): Promise<boolean> {
    const button = this.submitButton();
    if ((await button.count()) === 0 || !(await button.isVisible())) {
      return true;
    }
    return button.isDisabled();
  }

  /**
   * The login form's error text, trimmed, or `''` when none is shown — the failure path of
   * AAP 0.10.1 W1.
   *
   * The region is `div.alert.alert-danger` inside the login container, shown by
   * `ng-show="authenticationFailed"` and carrying the translated `error.login.failed` ("Invalid
   * credentials. Please try again." in `locale-en`, app/index.html). The design draws no error region
   * at rest (AAP 0.2.1 Step 1), so `''` is the ordinary answer, and reading it needs no navigation:
   * the form stays where the rejected attempt left it.
   */
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

  /**
   * Every `localStorage` entry's key and shape, after a login or a sign-out (AAP 0.10.1 W1: the entry
   * is present after login and gone after logout; AAP 0.3.4 claim 9 fixes the three session fields).
   *
   * Keys are enumerated rather than looked up, because the exact key string the bower
   * `angular-webstorage` writes is an open item (AAP 0.9.4 row 7) and a hard-coded one would let both
   * applications agree on a wrong value. Only the key and booleans are returned: the authentication
   * key, the parsed session object, the raw JSON and the array contents stay in the browser
   * (Rule 1 clause 9).
   */
  async readSessionEntries(): Promise<SessionEntrySummary[]> {
    return this.page.evaluate(summariseSessionEntries);
  }

  /**
   * Signs out through the navbar user menu (AAP 0.10.1 W1's last step) and waits for the login form.
   *
   * Legacy opens that menu on hover (`ng-mouseenter` sets `li.user.status.isopen` on `li#user-menu`),
   * so hovering is tried first and the menu's own toggle is clicked when the entry stays hidden. The
   * click ends in `logout()`, which clears the session and routes to `#/` (MainController.js), where
   * `app/index.html` shows the login container again; a build that lands elsewhere is sent to
   * `#/login` once before this throws.
   */
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

  /**
   * The design's login form: the `form.form` that owns the `#login-button` submit.
   *
   * AAP 0.2.1 Step 1 and AAP 0.2.3 `LoginForm` describe this markup — `.form-control` fields under
   * uppercase `USERNAME` / `PASSWORD` labels, and one full-width `.btn.btn-primary` reading "Sign In"
   * — and `app/index.html` carries it. The `#/login` route renders `app/views/login.html`, a second,
   * minimal form (`#loginButton`, no `.form-control`), and `app/index.html` keeps `<div ng-view>`
   * beside the design's form, so both can be in the DOM at once; the hyphenated id separates them.
   * Confirm when the legacy app runs.
   */
  private get loginForm(): Locator {
    return this.page.locator('form.form').filter({ has: this.page.locator('button#login-button') });
  }

  /**
   * The legacy language switcher group: a `uib-dropdown` button beside `ul.lang-dropdown`
   * (app/index.html; the row the design labels "Change language:", locale-en
   * `label.input.changelanguage`). Confirm when the legacy app runs.
   */
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

  /**
   * The navbar user menu (`li#user-menu`, app/views/_topnavbar.html), which opens on hover or on a
   * click of its toggle. Confirm when the legacy app runs.
   */
  private get userMenu(): Locator {
    return this.page.locator('#user-menu');
  }

  /** The menu's own `a#user-dropdown` toggle, for the build that does not open on hover. */
  private get userMenuToggle(): Locator {
    return this.userMenu.locator('a#user-dropdown, a[uib-dropdown-toggle]').first();
  }

  /**
   * The menu's sign-out entry: `a#logout`, labelled "Sign Out" (locale-en `label.anchor.logout`) and
   * wired to `logout()`. Confirm when the legacy app runs.
   */
  private get signOutEntry(): Locator {
    return this.page.locator('#logout');
  }

  /**
   * The signed-in navbar's global search input (`input#search`, AAP 0.2.3 `GlobalSearch`), rendered
   * only once a session exists, which makes it the landing fallback `waitForLanding()` uses.
   */
  private get globalSearch(): Locator {
    return this.page.locator('input#search');
  }

  /**
   * The legacy entry URL for an optional hash, carrying both query parameters the legacy app needs to
   * reach the Blitzy Fineract backend rather than a public demo host (Rule 2; AAP 0.3.4).
   */
  private entryUrl(hash?: string): string {
    return (
      `${LEGACY_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}` +
      `&tenantIdentifier=${TENANT_ID}${hash ?? ''}`
    );
  }

  /**
   * Navigates to a fragment of the already-loaded app, keeping the query string of the current URL,
   * and waits for the destination's root locator.
   *
   * `page.goto('#/...')` resolves against the current URL, so the entry parameters survive the move.
   * When the AngularJS router does not react to the fragment change, assigning `window.location.hash`
   * is the same event a link click produces, so the router picks it up; the root locator then has to
   * appear or this throws, rather than returning on a screen that never arrived.
   */
  private async gotoHash(hash: string, root: Locator): Promise<void> {
    await this.page.goto(hash);
    if (await this.waitForVisible(root, LOGIN_FORM_TIMEOUT_MS)) {
      return;
    }
    await this.page.evaluate((target: string) => {
      window.location.hash = target;
    }, hash);
    await root.first().waitFor({ state: 'visible' });
  }

  /**
   * The first of `candidates` that resolves to a visible field inside the login form.
   *
   * The order is chosen for stability: the legacy `name` attribute is language-independent, the
   * design's placeholder is rendered from the active translation (so it disappears in another locale
   * — AAP 0.2.3 `LoginForm`), the label beside `#uid` / `#pwd` is the design's uppercase text, and the
   * form's own `.form-control` order is the last resort. A miss names the field and the selectors
   * tried, never a typed value (Rule 1 clause 9).
   */
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

  /**
   * The `<select>` that is the language switcher, or `null` when the screen carries none.
   *
   * The legacy login screen has no `<select>` at all, so this is the design reading of AAP 0.2.3
   * `LanguageSwitcher` and the control the new application renders. A `<select>` qualifies only when
   * one of its option values is a language code, which keeps an unrelated select from being taken for
   * the switcher.
   */
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

  /**
   * Starts waiting for the translation bundle a language change loads and never rejects: the bundle
   * is fetched once per language and served from cache afterwards, so an expired wait is an expected
   * outcome rather than a failure, and the change applies either way.
   */
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
