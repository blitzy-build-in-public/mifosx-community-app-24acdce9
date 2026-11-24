import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import { MissingTranslationHandler, provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

import { DEFAULT_APP_CONFIG } from '../config/app-config.model';
import { FineractMissingTranslationHandler } from './missing-translation.handler';

/**
 * The reference implementation of the application's i18n provider contract: the translate service
 * wired to the legacy locale bundles, and the handler that keeps a missing key from reaching the
 * user as a raw dotted key (AAP 0.7.1 row "i18n bootstrap + missing handler"; AAP 0.4.3 integration
 * row "Legacy translations"; AAP 0.4.3 decision 3 "Compatibility preserved by design").
 *
 * The bundles are the flat, dotted `locale-*.json` files the legacy application ships in
 * `app/global-translations/`. They are served in place through the `assets` mapping in
 * `web-ng/angular.json` — never copied into `src/assets` and never regenerated (Rule 1
 * clause 6) — so the key space (`label.heading.clients` and the rest) stays exactly what the
 * legacy screens used. ngx-translate resolves such a key by walking the object and then
 * falling back to a literal lookup of the whole dotted key, which is why the flat files work
 * unchanged (AAP 0.3.1).
 *
 * Standalone providers only: ngx-translate 18 removed the library's NgModule entry point, so there
 * is no module import and no `forRoot()` registration here, and no NgModule-based bootstrap
 * anywhere in the application (AAP 0.3.1; Rule 1 clause 5).
 */

/**
 * Prefix of every translation bundle URL: `lang: 'en'` resolves to
 * `global-translations/locale-en.json`.
 *
 * Both the prefix and the suffix override the loader's own defaults
 * (`@ngx-translate/http-loader` 18.1.0). `.json` happens to match the legacy suffix, while the
 * loader's default prefix points into its own bundled translation folder — a directory this
 * application never creates. The legacy naming is reproduced byte for byte, not approximated:
 * the served path has no `assets/` segment because `angular.json` maps `app/global-translations`
 * to `global-translations` and `src/index.html` declares `<base href="/">`, so the bundle sits at
 * the site root. Reproducing the legacy URL exactly is a parity requirement (Rule 1 clause 2),
 * not a style choice, and the path is static content rather than a Fineract endpoint, so it
 * belongs in no `tools/parity` endpoint allowlist.
 */
export const TRANSLATE_LOADER_PREFIX = 'global-translations/locale-';

/**
 * Suffix of every translation bundle URL, stated explicitly rather than left to the loader's
 * default so the pair above and below reads as one value that cannot drift in half. The legacy
 * bundles are named `<prefix><code>.json`.
 */
export const TRANSLATE_LOADER_SUFFIX = '.json';

/**
 * Language ngx-translate falls back to when the active language lacks a key. Fixed at `en` because
 * the English bundle is the one that carries the complete legacy key space, so it is the bundle
 * that can answer a key the active language never translated.
 *
 * Deliberately independent of `DEFAULT_APP_CONFIG.locale`: the initial language is configuration
 * and may legitimately start the application in another locale, while the fallback is a property of
 * the bundles themselves. With both set to `en` today the distinction is invisible; it keeps a
 * deployment that configures a different starting language from silently falling back to that same
 * language and rendering humanised keys where English text exists.
 */
export const FALLBACK_LANG = 'en';

/**
 * The one language list of the application, offered by both switchers — the navbar's and the
 * login screen's (AAP 0.7.1 `core/layout` inputs `langs`/`currentLang`; AAP 0.7.4). No second
 * list may exist anywhere, so a language can never be offered in one switcher and missing from
 * the other.
 *
 * **Source: the legacy bundles, served in place.** A code belongs here only once the corresponding
 * bundle exists at `app/global-translations/locale-<code>.json`. That tree ships exactly 32
 * `locale-*.json` files, served in place through the `assets` mapping in `web-ng/angular.json` and
 * never copied (AAP 0.3.4 claim 5; AAP 0.6.2 row "`app/global-translations/locale-*.json`";
 * AAP 0.4.3 integration row "Legacy translations"; Rule 1 clause 6). The list below holds the 31
 * user-facing codes of those 32: `qqq` is deliberately not offered, because it is TranslateWiki's
 * message-documentation pseudo-locale rather than a language anyone reads — 814 of its 855 values
 * carry a TranslateWiki maintenance marker (`{{Identical|…}}` and the like), which offering it would
 * put on screen where the product shows text.
 *
 * **Order.** `en` first, because it is the fallback language every other bundle is completed from
 * (`FALLBACK_LANG` above) and therefore the language of the first paint; the rest ascend by code,
 * which is the order both switchers list them in.
 *
 * **How this differs from legacy, and why.** The legacy switcher read its own list from
 * `app/scripts/models/Langs.js`, which offered 14 codes: en, fr, es, pt, cs, zh_CN, hi, ka, lo, vi,
 * my_MM, my, et and te. One of them, `et`, ships no bundle at all, so it could never load; it is not
 * offered here. The remaining served bundles are offered, so the switcher actually switches and
 * AAP 0.10.2's i18n comparison "checked in English and one non-English locale" is exercisable. That
 * widening is the deliberate difference from legacy this array registers (Rule 1 clause 3), and it
 * stays inside the same rule the code above applies: every code offered is a bundle the checkout
 * really serves, so a user cannot pick a language and get a failed load.
 *
 * **Adding a language** therefore still means adding its code to this array and nothing else: the
 * bundle is referenced in place through `angular.json`, so no file is created, copied or added to
 * `src/assets` (Rule 1 clause 6), and no translation text is ever inlined here. Enumerating
 * speculative codes would offer a switcher entry whose load fails.
 */
export const AVAILABLE_LANGS: readonly string[] = [
  'en',
  'br', 'cs', 'de', 'es', 'fr', 'hi', 'id',
  'ka', 'km', 'kn', 'ko', 'lo', 'lt', 'my', 'my_MM',
  'ne', 'nl', 'oc', 'pl', 'pt', 'pt_BR', 'skr-arab',
  'sv', 'sw', 'te', 'tr', 'uk', 'vi', 'zh_CN', 'zh_TW',
];

/**
 * Provides the i18n stack: `TranslateService` with the legacy-prefixed HTTP loader, the initial and
 * fallback languages, and `FineractMissingTranslationHandler` in place of the library's
 * key-echoing default handler.
 *
 * **Requires `provideHttpClient()` in the same injector.** The loader resolves bundles through
 * `HttpClient`, so an injector composed from this function alone throws a
 * `NullInjectorError: No provider for HttpClient` when the initial language is first loaded —
 * which happens at start-up, not on the first screen that translates something.
 * `src/app/app.config.ts` owns `provideHttpClient(withInterceptors([fineractInterceptor]))` and
 * composes this same stack inline; the two compositions must stay identical in prefix, suffix,
 * `lang`, `fallbackLang` and handler class, which is why those values are exported from here.
 *
 * **`lang` is the starting language only.** It is `DEFAULT_APP_CONFIG.locale`, the build-time
 * configuration default, so that the first paint has text before `AppConfigService` resolves the
 * deployment's own `locale`. Changing the language afterwards is `TranslateService.use(code)` from
 * either switcher, which swaps the active bundle in place — no page reload and no re-bootstrap
 * (AAP 0.7.4) — and that selection is also the `locale` a date-bearing payload carries, because
 * `AppConfigService.activeLocale` reads the same service (AAP 0.1.1).
 *
 * The handler is registered as an explicit provider object for the `MissingTranslationHandler`
 * token rather than through the config object's `missingTranslationHandler` slot, whose accepted
 * type differs between majors; and it is registered after the service providers so it wins over the
 * `DefaultMissingTranslationHandler` that `provideTranslateService` installs.
 *
 * @returns environment providers for the i18n stack, scoped to the injector that receives them
 */
export function provideTranslate(): EnvironmentProviders {
  return makeEnvironmentProviders([
    ...provideTranslateService({
      loader: provideTranslateHttpLoader({
        prefix: TRANSLATE_LOADER_PREFIX,
        suffix: TRANSLATE_LOADER_SUFFIX,
      }),
      lang: DEFAULT_APP_CONFIG.locale,
      fallbackLang: FALLBACK_LANG,
    }),
    { provide: MissingTranslationHandler, useClass: FineractMissingTranslationHandler },
  ]);
}
