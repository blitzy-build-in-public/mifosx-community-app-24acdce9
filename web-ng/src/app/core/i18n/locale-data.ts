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

/** Angular's CLDR locale data for every language the application can be configured in, registered once per code: `formatDate` takes calendar names from it and throws `NG0701` for any code other than `en-US` without it, so each configured code is registered here before `formatDate` is asked for it (AAP 0.7.2, AAP 0.7.3, Rule 1 clause 7). */

/** One module of Angular's generated CLDR data, named the way the library names it. A documented `any` boundary of Rule 1 clause 4: `registerLocaleData` declares its first parameter `any`, the value is opaque calendar data, and it is only ever handed straight back, which is why deriving the type from the library's own signature is more truthful than modelling a structure the application does not touch. */
type LocaleDataModule = Parameters<typeof registerLocaleData>[0];

/** The module carrying each served language's CLDR data, keyed by the normalised code `ensureLocaleData` looks a locale up by, `en` first and the rest ascending. A `ReadonlyMap`, so a code such as `constructor` misses here and is reported instead of resolving to something that is not locale data. */
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

/** Makes Angular's CLDR data available for `locale`, so `formatDate` renders a month or day name instead of throwing `NG0701`: the code is normalised, looked up whole and then by language subtag, and registered under the id `formatDate` resolves to, while a locale no shipped module covers is reported rather than softened to English (AAP 0.7.3). */
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
