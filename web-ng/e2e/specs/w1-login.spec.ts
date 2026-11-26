/** W1 — log in and log out: the Playwright proof of the workflow AAP 0.10.1 lists first, run against both front ends (AAP 0.11.1 row "specs/w1-login … w8-savings, chain-w2-w4-w5-w6"; AAP 0.10.3 criteria 3, 4 and 12; AAP (AAP 0.7.3, AAP 0.10.5, AAP 0.10.2, AAP 0.4.4). */
import { MASKED } from '../capture/network-capture';
import type { NormalizedExchange, NormalizedValue } from '../capture/network-capture';
import { expect, test } from '../fixtures/parity-fixture';
import type { LanguageOptionSummary, SessionEntrySummary } from '../pages/next/login.page';
import { API_PATH, LOCALE, readCredentials } from '../seed/fixtures';

/** The prefix the legacy storage wrapper writes every entry under, and the entry name the legacy session manager uses (`mifosX` + `sessionData` -> `mifosXsessionData`; AAP 0.4.4 decision 3, AAP 0.3.4 claim 9) (AAP 0.9.4). */
const LEGACY_SESSION_PREFIX = 'mifosX';
const SESSION_ENTRY_NAME = 'sessionData';

/** Where the hash settles after a successful login. `#/clients` in this application (AAP 0.10.5 item 3); the legacy baseline may also settle on `#/home`, because `MainController.js:175` ends its authentication-success. */
const NEXT_LANDING_HASH = '#/clients';
const LEGACY_LANDING_HASHES: readonly string[] = ['#/clients', '#/home'];

/** Where the hash settles after a sign-out: `#/login` in this application (the navbar's sign-out navigates there), `#/` or `#/login` in the legacy baseline, whose `logout()` ends in `location.path('/').replace()` with the. */
const NEXT_LOGIN_HASH = '#/login';
const LEGACY_LOGIN_HASHES: readonly string[] = ['#/', '#/login'];

/** The two calls AAP 0.7.3 assigns to W1, matched on the resource path with the API root removed (AAP 0.10.2). */
const AUTHENTICATION_CALL = /^\/authentication$/;
const USER_READ_CALL = /^\/users\/(?:\d+|\{[A-Za-z][A-Za-z0-9]*\})$/;

/** A request-body field naming a credential: the names the capture masks (Rule 1 clause 9). */
const CREDENTIAL_FIELD = /password/i;

/** The `localStorage` key of this page's own document marker, written before the language switch and read after it: a value that survives proves the switch swapped the active translation in place rather than reloading the (AAP 0.7.4, AAP 0.10.5). */
const DOCUMENT_MARKER_KEY = '__w1DocumentMarker';

/** The languages this spec is willing to switch to, in preference order, each with the spellings the two switchers can show for it: this application renders the code itself, while the legacy `uib-dropdown` renders the name. */
const SWITCHABLE_LANGUAGES: readonly { readonly code: string; readonly pattern: RegExp }[] = [
  { code: 'fr', pattern: /^(?:fr|français|francais)$/i },
  { code: 'es', pattern: /^(?:es|español|espanol)$/i },
  { code: 'pt', pattern: /^(?:pt|português|portugues)$/i },
];

const LANGUAGE_CODE = /^[a-z]{2}(?:[_-][A-Z]{2})?$/;

type CapturedJsonObject = { readonly [field: string]: NormalizedValue };

/** The resource path of a captured exchange with the API root taken off, e.g (AAP 0.7.3). */
function resourcePath(exchange: NormalizedExchange): string {
  return exchange.path.startsWith(API_PATH) ? exchange.path.slice(API_PATH.length) : exchange.path;
}

/** The position of the first recorded call that matches one method and one resource path, or `-1` when the page has not made it (yet). @param exchanges The capture's exchanges, in the order the page issued them. @param. */
function indexOfCall(
  exchanges: readonly NormalizedExchange[],
  method: string,
  pattern: RegExp,
): number {
  return exchanges.findIndex(
    (exchange) => exchange.method === method && pattern.test(resourcePath(exchange)),
  );
}

/** A captured body as a JSON object, or `null` when it is absent or is not an object (Rule 1 clause 4). */
function jsonObjectOf(body: NormalizedValue | null): CapturedJsonObject | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? body : null;
}

/** Whether a `localStorage` entry is the legacy session: its key starts with the `mifosX` prefix and names `sessionData` (AAP 0.9.4). */
function isSessionEntry(entry: SessionEntrySummary): boolean {
  const key = entry.key.toLowerCase();
  return (
    key.startsWith(LEGACY_SESSION_PREFIX.toLowerCase()) &&
    key.includes(SESSION_ENTRY_NAME.toLowerCase())
  );
}

/** Whether a switcher option names the locale under test. This application's options carry the code (`en`), the legacy switcher carries the language's own name (`English`), so both readings are accepted for English and the. */
function namesLocale(option: LanguageOptionSummary, locale: string): boolean {
  const code = locale.toLowerCase();
  return [option.value, option.label].some((shown) => {
    const text = shown.trim().toLowerCase();
    if (text === code || text.startsWith(`${code}-`) || text.startsWith(`${code}_`)) {
      return true;
    }
    return code === 'en' && text === 'english';
  });
}

/** A non-English language the switcher offers, as the code `selectLanguage()` takes, or `null` when the list names no second language this spec recognises. @param languages Every option the switcher reported. */
function pickSwitchableLanguage(languages: readonly LanguageOptionSummary[]): string | null {
  for (const candidate of SWITCHABLE_LANGUAGES) {
    const offered = languages.some(
      (option) =>
        candidate.pattern.test(option.value.trim()) || candidate.pattern.test(option.label.trim()),
    );
    if (offered) {
      return candidate.code;
    }
  }
  const codeShaped = languages.find(
    (option) => LANGUAGE_CODE.test(option.value.trim()) && !namesLocale(option, LOCALE),
  );
  return codeShaped === undefined ? null : codeShaped.value.trim();
}

test.describe('W1 log in and log out', () => {
  // The token `W1` in the title is what names this test's capture artefact (fixtures/parity-fixture.ts reads a workflow id from the title first), so the evidence a reader opens is recognisable.
  test('W1: a staff user signs in with the tenant header, keeps the legacy session and signs out', async ({
    runWorkflow,
  }) => {
    await runWorkflow('W1', async ({ page, pages, capture }) => {
      // Read at call time, never at import: an unconfigured environment breaks this test and leaves collection — and `npx playwright test --list` — working (AAP 0.10.3).
      const credentials = readCredentials();

      // 1. The entry screen. The page object composes the URL, query parameters included, so no host literal and no backend address appears in this file (Rule 2).
      await pages.login.open();

      const languages: readonly LanguageOptionSummary[] = await pages.login.readLanguages();
      expect(languages.length).toBeGreaterThan(0);
      expect(languages.some((option) => namesLocale(option, LOCALE))).toBe(true);

      const switchable = pickSwitchableLanguage(languages);
      if (switchable !== null) {
        const hashBeforeSwitch = await pages.login.readCurrentHash();
        const marker = 'w1-language-switch';
        await page.evaluate(
          (entry: { readonly key: string; readonly value: string }) => {
            (window as unknown as Record<string, unknown>)[entry.key] = entry.value;
          },
          { key: DOCUMENT_MARKER_KEY, value: marker },
        );

        await pages.login.selectLanguage(switchable);

        const keptMarker = await page.evaluate((key: string) => {
          const stored = (window as unknown as Record<string, unknown>)[key];
          return typeof stored === 'string' ? stored : null;
        }, DOCUMENT_MARKER_KEY);
        expect(keptMarker).toBe(marker);
        expect(await pages.login.readCurrentHash()).toBe(hashBeforeSwitch);

        const switched: readonly LanguageOptionSummary[] = await pages.login.readLanguages();
        expect(switched.length).toBe(languages.length);
        expect(await pages.login.readFormError()).toBe('');

        await pages.login.selectLanguage(LOCALE);
      }

      // 3. The credential exchange. The submit is enabled before the click on both sides — not the disabled state this application's button takes while its request is in flight, not the hidden one the legacy screen swaps in (AAP 0.14.1).
      await pages.login.fillCredentials(credentials.username, credentials.password);
      expect(await pages.login.readSubmitState()).toBe('enabled');
      await pages.login.submit();

      // 4. The landing screen. The hash is compared as the route it is, never as a full URL (AAP 0.10.2) (Rule 1 clause 3).
      await pages.login.waitForLanding();
      const landingHash = await pages.login.readCurrentHash();
      if (pages.uiProject === 'next') {
        expect(landingHash).toBe(NEXT_LANDING_HASH);
      } else {
        expect(LEGACY_LANDING_HASHES).toContain(landingHash);
      }
      // The anonymous screen is gone, and the submit-state reading now separates "the form went away" from "the button is disabled": this application unmounts its login component, so nothing is left to read and the state is (Rule 1 clause 3).
      if (pages.uiProject === 'next') {
        expect(await pages.login.readSubmitState()).toBe('absent');
      } else {
        expect(await pages.login.readSubmitState()).toBe('hidden');
      }

      // 5. The legacy-shaped session (AAP 0.4.4 decision 3): exactly one entry, under the legacy prefix and name, carrying the three fields the unmigrated screens read (Rule 1 clause 9).
      const signedInEntries: readonly SessionEntrySummary[] = await pages.login.readSessionEntries();
      const sessionEntries = signedInEntries.filter(isSessionEntry);
      expect(sessionEntries).toHaveLength(1);
      const session = sessionEntries[0];
      const sessionKey = session.key.toLowerCase();
      expect(sessionKey.startsWith(LEGACY_SESSION_PREFIX.toLowerCase())).toBe(true);
      expect(sessionKey).toContain(SESSION_ENTRY_NAME.toLowerCase());
      expect(session.hasUserId).toBe(true);
      expect(session.userIdType).toBe('number');
      expect(session.hasAuthenticationKey).toBe(true);
      expect(session.authenticationKeyIsNonEmptyString).toBe(true);
      expect(session.hasUserPermissions).toBe(true);
      expect(session.userPermissionsIsArray).toBe(true);

      // 6. The traffic W1 is defined by (AAP 0.7.3): the credential exchange, then the restore's user read, in that order.
      await expect
        .poll(() => indexOfCall(capture.capture.exchanges, 'GET', USER_READ_CALL), {
          message:
            "no GET of the authenticated user was recorded after the credential exchange: W1 is " +
            'POST /authentication followed by GET /users/{id} (AAP 0.7.3)',
        })
        .toBeGreaterThanOrEqual(0);

      const exchanges = capture.capture.exchanges;
      const authenticationIndex = indexOfCall(exchanges, 'POST', AUTHENTICATION_CALL);
      const userReadIndex = indexOfCall(exchanges, 'GET', USER_READ_CALL);
      expect(authenticationIndex).toBeGreaterThanOrEqual(0);
      expect(userReadIndex).toBeGreaterThan(authenticationIndex);

      const authentication = exchanges[authenticationIndex];
      const userRead = exchanges[userReadIndex];
      // The tenant header is on every call; the credential is not, because the exchange that produces it is the one being made — this application's interceptor attaches the key only once a session exists, exactly as the legacy.
      expect(authentication.hasTenantHeader).toBe(true);
      expect(authentication.hasAuthorizationHeader).toBe(false);
      expect(userRead.hasTenantHeader).toBe(true);
      expect(userRead.hasAuthorizationHeader).toBe(true);

      // The submitted user name, and the mask the capture put over the credential it travelled with (Rule 1 clause 9; AAP 0.10.2 "Session and auth material").
      const credentialBody = jsonObjectOf(authentication.requestBody);
      if (credentialBody === null) {
        throw new Error(
          'the captured credential exchange carried no JSON body, so the user name it submitted and ' +
            'the masking of its password could not be read (AAP 0.7.3 W1)',
        );
      }
      expect(credentialBody['username']).toBe(credentials.username);
      const credentialFields = Object.keys(credentialBody).filter((field) =>
        CREDENTIAL_FIELD.test(field),
      );
      expect(credentialFields.length).toBeGreaterThan(0);
      for (const field of credentialFields) {
        expect(credentialBody[field]).toBe(MASKED);
      }

      // 7. The sign-out (the last step of AAP 0.10.1 W1): the entry is gone from storage and the app is back on its login screen.
      await pages.login.signOut();
      const signedOutEntries: readonly SessionEntrySummary[] = await pages.login.readSessionEntries();
      expect(signedOutEntries.filter(isSessionEntry)).toHaveLength(0);

      const loginHash = await pages.login.readCurrentHash();
      if (pages.uiProject === 'next') {
        expect(loginHash).toBe(NEXT_LOGIN_HASH);
      } else {
        // The legacy baseline renders its login container at `#/`, which is where its own logout sends the user (Rule 1 clause 3: its behaviour, not an improvement on it).
        expect(LEGACY_LOGIN_HASHES).toContain(loginHash);
      }
      expect(await pages.login.readSubmitState()).toBe('enabled');
    });
  });
});
