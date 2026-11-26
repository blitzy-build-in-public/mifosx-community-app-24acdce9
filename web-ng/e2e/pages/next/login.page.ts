/**
 * Page object for the new Angular application's login screen — the `next` project's side of
 * workflow W1 (log in and log out, AAP 0.10.1) and the screen every other workflow passes through
 * before it can start.
 *
 * **Route.** `#/login` (AAP 0.8.2 and `tools/parity/in-scope-routes.json`) is this application's only
 * anonymous screen: `/` and `/home` redirect to `#/clients`, so a successful login lands there
 * (AAP 0.10.5 item 3). `open()` goes to `#/login`; `readCurrentHash()` reports the hash a flow
 * actually settled on and asserts nothing — every judgement belongs to the specs under
 * `web-ng/e2e/specs/`.
 *
 * **Entry URL (Rule 2).** Every navigation composes `NEXT_URL` + `?baseApiUrl=` + `FINERACT_URL` +
 * `&tenantIdentifier=` + `TENANT_ID`. The application resolves its backend once, before the first
 * navigation, from `assets/config.json`, then the container's `API_BASE_URL`/`TENANT_ID`, then these
 * query parameters, which win (AAP 0.4.4 decision 5). That precedence is what lets the same bundle
 * address the local stack and a forwarded Codespaces host with no code difference (AAP 0.10.3), and
 * it is why no host literal appears in this file: `NEXT_URL` and `FINERACT_URL` are the only origins
 * and both come from `seed/fixtures.ts`.
 *
 * **Session entry (AAP 0.4.4 decision 3; AAP 0.9.4 row 7).** A login writes the legacy-shaped
 * session — `{userId, authenticationKey, userPermissions}` under the `mifosX` prefix — so one login
 * can be shared with screens that are still unmigrated. The exact serialised key string is an open
 * item settled by observing a login, and the application derives it in one place
 * (`core/auth/session.service.ts`), so `readSessionEntries()` enumerates every key and reports the
 * shape it found; it never looks up a hard-coded name.
 *
 * **Security (Rule 1 clause 9).** The authentication key, the parsed session object, the raw stored
 * JSON and the password never leave this class. `readSessionEntries()` returns key names and
 * booleans only — never the key's value — `fillCredentials()` writes a password it never echoes, and
 * `password` exists solely as a parameter name.
 *
 * **Locators.** Taken from the two templates this application renders here:
 * `features/auth/login/login.component.html` for the form, its language `<select>`, its error banner
 * and its submit, and `core/layout/navbar.component.html` for the user menu and its sign-out entry.
 * Each control is resolved through an ordered chain of selectors with a structural fallback, because
 * every visible label is translated at run time from the legacy locale bundles and may be in any of
 * the shipped languages.
 */
import type { Locator, Page } from '@playwright/test';

import { FINERACT_URL, NEXT_URL, TENANT_ID } from '../../seed/fixtures';

/**
 * One `localStorage` entry, described by its key and by the presence and type of the three fields the
 * session carries (AAP 0.3.4 claim 9).
 *
 * Shape only, by design: the entry's values stay in the browser and never reach a test report
 * (Rule 1 clause 9). `web-ng/e2e/pages/legacy/login.page.ts` declares the counterpart for the baseline
 * application, field for field: the same key, the same presence flags, the same four `userIdType`
 * readings, and `readSessionEntries()` returning the same array type from both sides. That shared
 * contract is what lets one spec text compare the two applications' session entries with no mapping
 * of either side's types.
 */
export interface SessionEntrySummary {
  /** The `localStorage` key exactly as the application wrote it. */
  readonly key: string;
  /** Whether the stored value carries a `userId` field. */
  readonly hasUserId: boolean;
  /**
   * `typeof` the stored `userId`: `'number'` or `'string'` when it holds one, `'missing'` when the
   * field is undefined or null, and `'other'` for any other present type — a boolean, an array, an
   * object.
   */
  readonly userIdType: 'number' | 'string' | 'missing' | 'other';
  /** Whether the stored value carries an `authenticationKey` field. */
  readonly hasAuthenticationKey: boolean;
  /** Whether that field holds a non-empty string — the form a usable key has. */
  readonly authenticationKeyIsNonEmptyString: boolean;
  /** Whether the stored value carries a `userPermissions` field. */
  readonly hasUserPermissions: boolean;
  /** Whether that field holds an array, which is what the permission gate iterates. */
  readonly userPermissionsIsArray: boolean;
}

/**
 * One option of the login screen's language switcher (`LanguageSwitcher`, AAP 0.2.3; design node `1:5`
 * shows the row "Change language:" plus its control).
 *
 * `web-ng/e2e/pages/legacy/login.page.ts` declares the counterpart for the baseline application, whose
 * `readLanguages()` returns the same `{ value, label }` pairs, so one spec text compares the two
 * switchers with no mapping of either side's types.
 */
export interface LanguageOptionSummary {
  /** The language code the option submits — the code `selectLanguage()` takes. */
  readonly value: string;
  /** The text the option shows, trimmed. */
  readonly label: string;
}

/**
 * What the login screen's submit control currently offers: `'absent'` when the screen renders no submit
 * control at all, `'hidden'` when it renders one that is not visible, `'disabled'` when it is visible
 * but cannot be clicked, and `'enabled'` when it can be clicked.
 *
 * `web-ng/e2e/pages/legacy/login.page.ts` deliberately declares the identical union on its own, the way
 * both sides declare `SessionEntrySummary` and `LanguageOptionSummary` independently, so one spec text
 * drives both projects and neither page object imports the other's types.
 */
export type SubmitState = 'absent' | 'hidden' | 'disabled' | 'enabled';

/** Root of the login screen: every other locator in this file is scoped to it. */
const ROOT_SELECTOR = 'app-login';

/**
 * The language switcher. The screen renders one bare native `<select>` (the Angular-native
 * replacement for the legacy plugin, AAP 0.10.5 item 2), so no wrapper component element is involved
 * and this is the only `<select>` on the page.
 */
const LANGUAGE_SELECT_SELECTOR = 'select';

/**
 * The username control, in the order it is tried: the reactive form's control name, then the
 * `.form-control` that follows the label naming the field, then the screen's only non-search text
 * input. The label match is a case-insensitive regex because the label text is translated.
 */
const USERNAME_SELECTORS: readonly string[] = [
  'input[formcontrolname="username"]',
  'input[name="username"]',
  '.form-group:has(> label:text-matches("user\\s*name", "i")) input.form-control',
  'input[type="text"]:not([type="search"])',
];

/** The password control: its input type is not translated, so the control name is only a fallback. */
const PASSWORD_SELECTORS: readonly string[] = [
  'input[type="password"]',
  'input[formcontrolname="password"]',
  'input[name="password"]',
];

/**
 * The form's single primary submit, in the order it is tried: the Bootstrap primary button the
 * screen renders full width, then the id that button carries, then the type-based fallback.
 */
const SUBMIT_SELECTORS: readonly string[] = [
  '.btn.btn-primary',
  'button#login-button',
  'button[type="submit"]',
];

/** The form's own error banner, rendered above the form only while a failure is being shown. */
const FORM_ERROR_SELECTOR = '.alert.alert-danger';

/** The signed-in client list: the landing screen a successful login reaches (AAP 0.10.5 item 3). */
const CLIENT_LIST_SELECTOR = 'app-client-list';

/** The hash a successful login settles on. */
const LANDING_HASH = '#/clients';

/**
 * The user menu's toggle, in the order it is tried: its own id, then Bootstrap's toggle class, then
 * the dropdown's direct child anchor.
 */
const USER_MENU_TOGGLE_SELECTORS: readonly string[] = [
  '#user-dropdown',
  '.dropdown-toggle',
  '.dropdown > a',
];

/** The list the user menu reveals. It is in the DOM while closed and hidden by the `.open` class. */
const USER_MENU_LIST_SELECTOR = 'app-navbar .dropdown-menu';

/** The menu entry that ends the session, matched on its translated label. */
const SIGN_OUT_LABEL_PATTERN = /sign\s*out|log\s*out/i;

/** How long the login form is given to appear on a fresh navigation. */
const LOGIN_FORM_TIMEOUT_MS = 10_000;

/**
 * Ceiling for the post-login landing. The page itself is small; the wait covers `POST /authentication`,
 * the stored session, the redirect and the client list's own `GET /clients`.
 */
const LANDING_TIMEOUT_MS = 30_000;

/** Ceiling for the navbar user menu to open and reveal its entry. */
const USER_MENU_TIMEOUT_MS = 5_000;

/**
 * Runs inside the page: every `<option>` of the language switcher as `{ value, label }`, both trimmed,
 * in document order. A locator that resolved to something other than a `<select>` yields `[]` rather
 * than a screen-reader dump of some other control.
 */
function readLanguageOptions(element: HTMLElement): LanguageOptionSummary[] {
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
 * The stored value is unmodelled browser storage — the application writes the legacy session object
 * and other tools may write unrelated keys — so it is parsed into `unknown` and narrowed field by
 * field (Rule 1 clause 4). A value that is not a JSON object yields an entry whose flags are all
 * false and whose `userIdType` is `'missing'`, which is the honest reading: no session fields live
 * under that key. Only key names and booleans leave the page (Rule 1 clause 9).
 *
 * It declares no inner functions, because a transpiler that preserves function names would emit a
 * helper call into the serialised source that does not exist in the page: `userIdType` is therefore
 * classified inline, and by the same four readings the legacy sibling classifies it by.
 */
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

/**
 * Drives the new application's login screen: entry, credentials, language, landing, session shape and
 * sign-out (AAP 0.10.1 W1).
 *
 * Everything here is a locator or a typed reader — no assertion, and no filtering of what the screen
 * renders: differences belong in the parity report (AAP 0.10.5), not in this page object.
 *
 * **Shared reader contract.** `web-ng/e2e/pages/legacy/login.page.ts` declares the counterpart that
 * drives the baseline application's same screen, and the two page objects agree on every shape a spec
 * helper shared by both projects consumes: `readSessionEntries()` returns a `SessionEntrySummary[]`
 * on either side, with the same four `userIdType` readings; `readLanguages()` returns the same
 * `{ value, label }` pairs; `readSubmitState()` answers in the same `SubmitState` union; and
 * `readFormError()` returns `''` — never `null` — when no error is shown,
 * and the trimmed message otherwise. What differs is only what the parity report exists to measure:
 * the entry URL, the selectors, and the wait each application's landing needs.
 */
export class LoginPage {
  constructor(private readonly page: Page) {}

  /**
   * Opens the login screen (the entry step of AAP 0.10.1 W1) and waits for the form.
   *
   * Every other route is guarded, so opening `#/clients` without a session redirects to
   * `/login?returnUrl=…`: a spec therefore signs in first (W1) or reuses a storage state, and a
   * redirect that arrives here surfaces as a timeout naming `app-login` rather than as a silent pass.
   */
  async open(): Promise<void> {
    await this.navigate('/login');
    await this.root().waitFor({ state: 'visible', timeout: LOGIN_FORM_TIMEOUT_MS });
  }

  /**
   * Switches the interface language (AAP 0.10.2 compares a non-English locale too) without
   * navigating: the switcher calls the translate service in place, so no reload happens and the hash
   * is unchanged.
   *
   * The values are the language codes the bundles are named by; a code the switcher does not offer
   * fails on the option itself rather than being silently ignored.
   */
  async selectLanguage(code: string): Promise<void> {
    await this.languageSelect().selectOption({ value: code });
  }

  /**
   * The language switcher's options in document order (AAP 0.2.3 `LanguageSwitcher`). Each option's
   * `value` is the language code the control submits — the code {@link selectLanguage} takes — and its
   * `label` is the text the option shows, which this screen renders as that same code.
   *
   * `web-ng/e2e/pages/legacy/login.page.ts` returns the same `{ value, label }` pairs from the baseline
   * switcher, so one spec text compares the two lists with no mapping of either side's types.
   */
  async readLanguages(): Promise<LanguageOptionSummary[]> {
    return this.languageSelect().evaluate(readLanguageOptions);
  }

  /**
   * Fills both credential fields (AAP 0.10.1 W1).
   *
   * `fill()` replaces whatever the field held, so a rejected attempt leaves a clean form for the next
   * one; nothing is typed character by character and nothing is read back. Neither value is stored on
   * the instance or echoed anywhere (Rule 1 clause 9); `readSessionEntries()` is the only session
   * reader on this class and it returns shape only.
   */
  async fillCredentials(username: string, password: string): Promise<void> {
    const usernameField = await this.resolveControl(USERNAME_SELECTORS, 'username');
    await usernameField.fill(username);
    const passwordField = await this.resolveControl(PASSWORD_SELECTORS, 'password');
    await passwordField.fill(password);
  }

  /**
   * Clicks the form's primary submit once.
   *
   * No extra readiness step and no retry: the button disables itself while `POST /authentication` is
   * in flight (`[disabled]="guard.busy()"`), which is the duplicate-submission protection, and the
   * capture counts a single authentication request per click.
   */
  async submit(): Promise<void> {
    const button = await this.resolveControl(SUBMIT_SELECTORS, 'submit');
    await button.click();
  }

  /**
   * Signs in and waits for the landing screen (AAP 0.10.1 W1: log in, then the client list).
   *
   * Returns nothing a caller could compare literally: the created session's ids and the resulting
   * backend state are read by the specs from the network capture and the state snapshot, because
   * generated identifiers are compared by their role in the sequence, never by value (AAP 0.10.2).
   */
  async signIn(username: string, password: string): Promise<void> {
    await this.fillCredentials(username, password);
    await this.submit();
    await this.waitForLanding();
  }

  /**
   * What the screen's submit control currently is, in the four readings a caller can tell apart:
   * `'absent'` when the login screen renders no submit control at all, `'hidden'` when it renders one
   * that is not visible, `'disabled'` when it is visible but cannot be clicked, and `'enabled'` when it
   * can be clicked.
   *
   * The four readings exist because the answer after a successful login differs per side and each is
   * its own application's behaviour: this one unmounts its login component when the route changes, so
   * its submit is `'absent'`, while the legacy screen keeps its `LoginFormController` container in the
   * DOM under `data-ng-hide="currentSession.user != null"` (`app/index.html`), so its submit is present
   * but `'hidden'`. Reporting that difference rather than one uniform reading is what Rule 1 clause 3
   * ("match legacy behaviour; don't improve it") requires, and a boolean that folded the absent case
   * into "disabled" could not tell "the form went away" from "the button is disabled".
   *
   * The answer is typed by {@link SubmitState} — no `any`, no cast, no `as` (Rule 1 clause 4) — and the
   * control is resolved through the same ordered selector chain {@link submit} clicks.
   */
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

  /**
   * The login form's error text, trimmed, or `''` when no failure is shown — the rejected-login path
   * of AAP 0.10.1 W1, and the surface a Fineract validation message reaches on this screen.
   *
   * The text is returned exactly as rendered: no prefix, no capitalisation, no translation and no
   * truncation, because the parity comparison holds it against the message the backend sent (AAP 0.7.4,
   * AAP 0.10.2). The region is scoped to the login element so the application's global notification
   * host can never be read in its place. `''` is the ordinary answer — the design draws no error region
   * at rest (AAP 0.2.1 Step 1) — and also the answer a banner carrying blank text gives;
   * `web-ng/e2e/pages/legacy/login.page.ts` returns `''` for both, so one spec text can compare the two
   * applications' failure paths.
   */
  async readFormError(): Promise<string> {
    const alert = this.root().locator(FORM_ERROR_SELECTOR).first();
    if ((await alert.count()) === 0) {
      return '';
    }
    return ((await alert.textContent()) ?? '').trim();
  }

  /**
   * Waits for the landing screen: the hash is `#/clients` and the client list is visible.
   *
   * The list is awaited first, so the hash is read once the navigation has settled. A flow that ends
   * anywhere else throws with both observations, naming the hash that was reached — the report keeps
   * that text, which is how a landing difference between the two applications becomes visible.
   */
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

  /**
   * Every `localStorage` entry's key and shape, after a login or a sign-out — W1 records the session
   * entry as present after a login and absent after a logout (AAP 0.10.1).
   *
   * Keys are enumerated rather than looked up: the exact serialised name is an open item settled by
   * observation (AAP 0.9.4 row 7), and a hard-coded one would let both applications agree on a wrong
   * value. Which entry is the session is decided by the caller, and comparing the two applications'
   * keys is the parity report's job, not this reader's. The authentication-key value, the parsed
   * object and the array contents stay in the browser (Rule 1 clause 9).
   */
  async readSessionEntries(): Promise<SessionEntrySummary[]> {
    return this.page.evaluate(summariseSessionEntries);
  }

  /**
   * Signs out through the navbar user menu (the last step of AAP 0.10.1 W1) and waits for the login
   * form.
   *
   * The menu is Bootstrap 3 markup whose open state is an Angular-bound `.open` class, because no
   * Bootstrap script is loaded, so the toggle is clicked only when the menu is closed and the entry is
   * not already reachable. The click ends in `AuthService.logout()`, which clears the stored session
   * and the in-memory one, and the router then shows the login screen.
   */
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

  /** The login screen's root element; every other locator on this class is scoped to it. */
  private root(): Locator {
    return this.page.locator(ROOT_SELECTOR).first();
  }

  /** The client list, the landing screen's root element. */
  private clientList(): Locator {
    return this.page.locator(CLIENT_LIST_SELECTOR).first();
  }

  /** The signed-in navbar, which owns the user menu `signOut()` drives. */
  private navbar(): Locator {
    return this.page.locator('app-navbar').first();
  }

  /** The language switcher, the screen's only `<select>`. */
  private languageSelect(): Locator {
    return this.root().locator(LANGUAGE_SELECT_SELECTOR).first();
  }

  /**
   * The user menu's sign-out entry: the menu's own anchor whose label reads "Sign Out" in the active
   * language, or the menu's last entry when the label is one this file does not recognise — the entry
   * stays addressable either way, which is what keeps a translated build drivable.
   */
  private signOutEntry(): Locator {
    const menu = this.page.locator(USER_MENU_LIST_SELECTOR).first();
    const labelled = menu.locator('a').filter({ hasText: SIGN_OUT_LABEL_PATTERN });
    return labelled.or(menu.locator('li a').last()).first();
  }

  /**
   * The first candidate selector that resolved to an element inside `scope`, or `null` when none did.
   * Candidates are structural and language-independent, so a translated screen resolves the same
   * controls; `scope` defaults to the login screen and is the navbar for the signed-in chrome.
   */
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

  /**
   * {@link findControl}, or a throw naming the control and every selector that was tried — the screen
   * renders the control, so a miss is a real failure rather than a state to report.
   */
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

  /**
   * The entry URL for a route: this application's origin, both query parameters that select the
   * backend, then the fragment (Rule 2; AAP 0.4.4 decisions 3 and 5).
   */
  private screenUrl(route: string): string {
    return (
      `${NEXT_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}` +
      `&tenantIdentifier=${encodeURIComponent(TENANT_ID)}#${route}`
    );
  }

  /**
   * Opens a route of this application and makes sure the fragment took effect.
   *
   * The navigation uses {@link screenUrl}, never a fragment on its own: Playwright resolves a
   * fragment-only address against the configured `baseURL`, which replaces the whole address with the
   * project's origin, discards `?baseApiUrl=` and `?tenantIdentifier=`, and would leave the
   * application addressing its configured default backend instead of `FINERACT_URL` (Rule 2). When the
   * router does not react to the fragment the address already carries, assigning
   * `window.location.hash` is the same event a link click produces, so the router picks it up.
   */
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
