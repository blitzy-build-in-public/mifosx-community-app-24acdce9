import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import { MissingTranslationHandler, provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

import { DEFAULT_APP_CONFIG } from '../config/app-config.model';
import { FineractMissingTranslationHandler } from './missing-translation.handler';

/** The application's i18n provider contract: the translate service wired to the legacy `locale-*.json` bundles `app/global-translations/` ships and `web-ng/angular.json` serves in place (Rule 1 clause 6), plus the handler that keeps a missing key from reaching the user as a raw dotted key (AAP 0.7.1 row "i18n bootstrap + missing handler"; AAP 0.4.3 "Legacy translations"), all as standalone providers because ngx-translate 18 has no NgModule entry point (AAP 0.3.1). */

/** Prefix of every translation bundle URL: `lang: 'en'` resolves to `global-translations/locale-en.json`, the legacy path byte for byte — a parity requirement (Rule 1 clause 2), not a style choice — because `angular.json` maps the legacy folder to the site root. */
export const TRANSLATE_LOADER_PREFIX = 'global-translations/locale-';

/** Suffix of every translation bundle URL, stated explicitly rather than left to the loader's default so the pair reads as one value that cannot drift: the legacy bundles are named `<prefix><code>.json`. */
export const TRANSLATE_LOADER_SUFFIX = '.json';

/** The language ngx-translate falls back to, fixed at `en` because the English bundle is the one carrying the complete legacy key space; deliberately independent of `DEFAULT_APP_CONFIG.locale`, which is configuration and may legitimately start the application elsewhere. */
export const FALLBACK_LANG = 'en';

/** The one language list of the application, offered by both switchers (AAP 0.7.1 `core/layout` inputs, AAP 0.7.4): legacy's own codes from `app/scripts/models/Langs.js` less `et`, whose bundle no checkout serves, in legacy's order with `en` first as the fallback — legacy parity rather than a deliberate difference, so AAP 0.10.5 registers no entry, and adding a language means adding its code here and nothing else (Rule 1 clauses 3 and 6). */
export const AVAILABLE_LANGS: readonly string[] = [
  'en', 'fr', 'es', 'pt', 'cs', 'zh_CN', 'hi',
  'ka', 'lo', 'vi', 'my_MM', 'my', 'te',
];

/** Provides the i18n stack: `TranslateService` with the legacy-prefixed loader, the initial and fallback languages, and `FineractMissingTranslationHandler` registered after the service providers so it wins; it requires (AAP 0.7.4, AAP 0.14.2). */
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
