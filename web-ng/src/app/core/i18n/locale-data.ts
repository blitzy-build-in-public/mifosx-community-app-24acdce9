import { registerLocaleData } from '@angular/common';
import br from '@angular/common/locales/br';
import cs from '@angular/common/locales/cs';
import de from '@angular/common/locales/de';
import en from '@angular/common/locales/en';
import es from '@angular/common/locales/es';
import fr from '@angular/common/locales/fr';
import hi from '@angular/common/locales/hi';
import id from '@angular/common/locales/id';
import ka from '@angular/common/locales/ka';
import km from '@angular/common/locales/km';
import kn from '@angular/common/locales/kn';
import ko from '@angular/common/locales/ko';
import lo from '@angular/common/locales/lo';
import lt from '@angular/common/locales/lt';
import my from '@angular/common/locales/my';
import ne from '@angular/common/locales/ne';
import nl from '@angular/common/locales/nl';
import oc from '@angular/common/locales/oc';
import pl from '@angular/common/locales/pl';
import pt from '@angular/common/locales/pt';
import skr from '@angular/common/locales/skr';
import sv from '@angular/common/locales/sv';
import sw from '@angular/common/locales/sw';
import te from '@angular/common/locales/te';
import tr from '@angular/common/locales/tr';
import uk from '@angular/common/locales/uk';
import vi from '@angular/common/locales/vi';
import zhHans from '@angular/common/locales/zh-Hans';
import zhHant from '@angular/common/locales/zh-Hant';

/**
 * Angular's CLDR locale data for every language the application can be configured in, registered
 * once per code.
 *
 * **Why the data has to be registered.** Every date the application renders or sends is formatted
 * through Angular's `formatDate`, and `formatDate` takes the calendar names a pattern needs —
 * `MMMM`, the month name — from the CLDR data registered for that locale. English is the one
 * language that resolves without registration, because Angular itself ships the `en-US` data; for
 * any other code `formatDate` throws
 * `NG0701: Missing locale data for the locale "<code>".`; inside a payload builder that means the
 * request never reaches Fineract at all. Registering the data is what makes the active-locale date
 * AAP 0.7.2 asks for (`dd MMMM yyyy` in the language the body carries as `locale`, AAP 0.7.3)
 * possible outside English, and it is the fix for the review's F03 finding: the date-format spec
 * could pass while only English worked.
 *
 * **Which codes.** Every code the legacy bundle set ships: the 31 user-facing codes of the 32
 * `locale-*.json` files in `app/global-translations/`, served in place and never copied, with
 * TranslateWiki's `qqq` message-documentation pseudo-locale excluded. That is a superset of the 13
 * codes `AVAILABLE_LANGS` (`./translate.config`) offers, and deliberately so: a deployment may
 * configure its own starting `locale` from any served bundle, and `AppConfigService.activeLocale`
 * hands that locale to a date-bearing payload, so those 31 codes remain the whole set `formatDate`
 * must be able to answer. Codes are keyed in the normalised form Angular itself resolves a locale
 * to — lowercase, `_` for `-` — and the five the CLDR tree does not name identically use their base
 * language's module: `my_MM` → `my`, `pt_BR` → `pt`, `skr_arab` → `skr`, `zh_CN` → `zh-Hans`,
 * `zh_TW` → `zh-Hant`.
 *
 * **Cost and dependency.** No package is added (Rule 1 clause 7): the data ships inside the pinned
 * `@angular/common` 22.3.0 as its own `locales/*` entry points, and the 29 modules imported above
 * are about 55 KB of generated CLDR source inside the 1.5 MB initial-budget ceiling (AAP 0.1.1).
 * They are static imports, so their bytes are in the initial bundle whichever language a user
 * picks; what registering on first use saves is the run-time cost of filling Angular's locale cache
 * with 29 datasets in a session that stays in one language.
 *
 * **Nothing else lives here.** No `LOCALE_ID` provider, no translation, no formatting of its own:
 * this module only hands calendar data back to Angular, and `shared/date-format.util.ts` remains
 * the one place a date is formatted.
 */

/**
 * One module of Angular's generated CLDR data, named the way the library names it.
 *
 * This is a documented `any` boundary of Rule 1 clause 4: `registerLocaleData` declares its first
 * parameter as `any`, so the value is opaque calendar data whose shape comes from the CLDR
 * generator and not from this application. It is only ever handed straight back to
 * `registerLocaleData` and is never read, indexed or compared here, which is why deriving the type
 * from the library's own signature is more truthful than modelling a structure the app does not
 * touch — and why the literal `any` is never written.
 */
type LocaleDataModule = Parameters<typeof registerLocaleData>[0];

/**
 * The module carrying each served language's CLDR data, keyed by the normalised code
 * `ensureLocaleData` looks a locale up by. Enumerated with `en` first — it is the fallback language
 * and the language of the first paint — and the rest ascending by code.
 *
 * `ReadonlyMap` rather than an object literal so a lookup cannot walk the prototype chain: a code
 * such as `constructor` or `toString` must miss here and be reported, not resolve to something that
 * is not locale data.
 */
const LOCALE_DATA: ReadonlyMap<string, LocaleDataModule> = new Map<string, LocaleDataModule>([
  ['en', en],
  ['br', br],
  ['cs', cs],
  ['de', de],
  ['es', es],
  ['fr', fr],
  ['hi', hi],
  ['id', id],
  ['ka', ka],
  ['km', km],
  ['kn', kn],
  ['ko', ko],
  ['lo', lo],
  ['lt', lt],
  ['my', my],
  ['my_mm', my],
  ['ne', ne],
  ['nl', nl],
  ['oc', oc],
  ['pl', pl],
  ['pt', pt],
  ['pt_br', pt],
  ['skr_arab', skr],
  ['sv', sv],
  ['sw', sw],
  ['te', te],
  ['tr', tr],
  ['uk', uk],
  ['vi', vi],
  ['zh_cn', zhHans],
  ['zh_tw', zhHant],
]);

/** Codes already handed to `registerLocaleData`, so the second and later calls are no-ops. */
const registeredCodes = new Set<string>();

/**
 * Makes Angular's CLDR data available for `locale`, so `formatDate` can render a month or day name
 * in that language instead of throwing `NG0701`.
 *
 * Called at the boundary where a date becomes a Fineract payload value — `toFineractDate` — with the
 * same locale the body carries as `locale` (AAP 0.7.3). The code is normalised first (`'pt_BR'` and
 * `'pt-BR'` name the same locale), the whole code is looked up and, when no module of its own
 * exists, its language subtag is used, so a regional code such as `fr_CA` formats with French
 * names — the same widening Angular applies when it resolves a locale. The data is
 * registered under the normalised code itself (`zh_CN` as `zh-CN`), which is the id `formatDate`
 * resolves the caller's locale argument to. A code already registered is skipped, so formatting
 * thousands of dates costs one registration.
 *
 * A locale whose language the application ships no data for is reported, never softened: silently
 * registering English instead would send Fineract `21 November 2026` from a screen the user is
 * reading in another language, which is exactly the mismatch between a payload and its `locale` a
 * server validation message cannot explain.
 *
 * @param locale Locale code of the selected language, e.g. `'fr'`, `'pt_BR'`; taken from
 *   `AppConfigService.activeLocale`, the same value the payload carries.
 * @throws Error when no CLDR data is shipped for `locale` or for its language subtag.
 */
export function ensureLocaleData(locale: string): void {
  const code = locale.trim().toLowerCase().replace(/-/g, '_');

  if (registeredCodes.has(code)) {
    return;
  }

  const separator = code.indexOf('_');
  const language = separator === -1 ? code : code.slice(0, separator);
  const data = LOCALE_DATA.get(code) ?? LOCALE_DATA.get(language);

  if (data === undefined) {
    throw new Error(
      `No Angular locale data is shipped for the locale "${locale}": a date is not formatted in a ` +
        `language this application cannot render, so the request is reported here instead of ` +
        `carrying another language's month names. Add the language's CLDR module to ` +
        `web-ng/src/app/core/i18n/locale-data.ts.`,
    );
  }

  registerLocaleData(data, code.replace(/_/g, '-'));
  registeredCodes.add(code);
}
