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
 * **Source: the legacy switcher, restricted to the bundles served in place.** The set is the one
 * legacy's own switcher offered, read from `app/scripts/models/Langs.js`, which named 14 codes: en,
 * fr, es, pt, cs, zh_CN, hi, ka, lo, vi, my_MM, my, et and te. A code is offered here only once the
 * matching bundle really exists at `app/global-translations/locale-<code>.json`, because those
 * bundles are served in place through the `assets` mapping in `web-ng/angular.json` and never
 * copied (AAP 0.4.3 integration row "Legacy translations"; Rule 1 clause 6). `et` (Amharic) is the
 * one legacy code that ships no `locale-et.json`, so it could never load and is not offered; the
 * list below holds the other 13, every one of them backed by a served bundle.
 *
 * **Order.** Legacy's own order, `app/scripts/models/Langs.js` transcribed without the code no
 * bundle can serve: `en` first, because it is the fallback language every other bundle is completed
 * from (`FALLBACK_LANG` above) and therefore the language of the first paint, then each remaining
 * language in the position legacy listed it.
 *
 * **This is legacy parity, not a deliberate difference.** Both switchers therefore offer exactly
 * what legacy's offered, less only the code whose bundle is absent — which is what Rule 1 clause 3
 * requires of a reimplemented control, and why AAP 0.10.5's register of deliberate differences
 * carries no language-list entry: there is no difference from legacy left to record. Widening the
 * list to every served bundle would be such a difference, and Rule 1 clause 3 permits one only once
 * the Agent Action Plan lists it with a reason; a comment in this file cannot register one.
 *
 * **Adding a language** therefore means adding its code to this array and nothing else: the bundle
 * is referenced in place through `angular.json`, so no file is created, copied or added to
 * `src/assets` (Rule 1 clause 6), and no translation text is ever inlined here. Two conditions guard
 * the array all the same — the bundle has to be one the checkout really serves, and the language has
 * to be one legacy's switcher already offered, since a code outside that set would be a deliberate
 * difference from legacy that Rule 1 clause 3 admits only once the Agent Action Plan lists it.
 */
export const AVAILABLE_LANGS: readonly string[] = [
  'en', 'fr', 'es', 'pt', 'cs', 'zh_CN', 'hi',
  'ka', 'lo', 'vi', 'my_MM', 'my', 'te',
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
 * installs this stack with one `provideTranslate()` call, so prefix, suffix, `failOnError`, `lang`,
 * `fallbackLang` and handler class are composed here and nowhere else; the values stay exported so a
 * test can assert that loader contract without restating it.
 *
 * **`lang` is the starting language only.** It is `DEFAULT_APP_CONFIG.locale`, the build-time
 * configuration default, so that the first paint has text before `AppConfigService` resolves the
 * deployment's own `locale`. Changing the language afterwards is `TranslateService.use(code)` from
 * either switcher, which swaps the active bundle in place — no page reload and no re-bootstrap
 * (AAP 0.7.4) — and that selection is also the `locale` a date-bearing payload carries, because
 * `AppConfigService.activeLocale` reads the same service (AAP 0.1.1).
 *
 * **A bundle that fails to load is reported, not swallowed.** The loader is configured with
 * `failOnError: true`, against its own `false` default. With that default the loader catches a failed
 * bundle request, reports it and completes with `of({})`
 * (`@ngx-translate/http-loader` 18.1.0, `TranslateHttpLoader.getTranslation`), so
 * `TranslateService.use()` goes on to commit the requested language with nothing behind it and no
 * caller can observe the failure at all — a silently swallowed HTTP error, which AAP 0.14.2
 * ("Error handling": no `catch` swallows an error silently) does not allow. With `failOnError: true`
 * the loader rethrows instead, so `use()` delivers the error to its subscriber, and
 * `@ngx-translate/core` 18.1.0 leaves `currentLang` on the language in force, resetting it to the
 * previous one because the store holds nothing for the code that failed. The two switchers use that
 * in the two ways the library allows: the login screen reads the error channel to report the failure
 * and to put its `<select>` back, and the navbar reconciles its `<select>` against `currentLang()`.
 * Neither reads the shape of an emission as a signal: a switch that takes effect may deliver no
 * translations at all — a language whose translations come from a source other than this loader
 * produces exactly that, while the library still moves `currentLang` — so success and failure are
 * read from the library's own state and from this error channel alone, and a switch that took effect
 * is never undone.
 *
 * The consequence is stated rather than hidden: a *starting* language whose bundle cannot be
 * fetched now surfaces the same way. `provideTranslateService`'s own `use(configured lang)` takes the
 * error instead of a silent empty commit, `currentLang` stays unset so the shell reads
 * `FALLBACK_LANG`, and the missing-translation handler below still renders every label — no raw key
 * reaches the user — while the failure is reported rather than swallowed.
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
        failOnError: true,
      }),
      lang: DEFAULT_APP_CONFIG.locale,
      fallbackLang: FALLBACK_LANG,
    }),
    { provide: MissingTranslationHandler, useClass: FineractMissingTranslationHandler },
  ]);
}
