import { isDevMode } from '@angular/core';
import type {
  MissingTranslationHandler,
  MissingTranslationHandlerParams,
} from '@ngx-translate/core';

/** Keeps a missing translation key from reaching the user as the raw dotted key, and reports it to the developer console in development builds only. ngx-translate's own handler returns `params.key` unchanged, which would. */

/** Acronym run followed by a capitalised word, as in `IDField`: split before the last capital. */
const ACRONYM_TO_WORD_BOUNDARY = /([A-Z]+)([A-Z][a-z])/g;

/** Lower-case letter or digit followed by a capital, as in `camelCase`: split at the capital. */
const LOWER_TO_UPPER_BOUNDARY = /([a-z0-9])([A-Z])/g;

/** Whitespace run left behind by the boundary substitutions. */
const WHITESPACE_RUN = /\s+/g;

/** Turns the last segment of a dotted translation key into a presentable label. */
export function humaniseKey(key: string): string {
  const last: string | undefined = key
    .split('.')
    .filter((segment: string) => segment.trim().length > 0)
    .at(-1);

  if (last === undefined) {
    return '';
  }

  const words: string[] = last
    .split('_')
    .map((word: string) => word.replace(ACRONYM_TO_WORD_BOUNDARY, '$1 $2'))
    .map((word: string) => word.replace(LOWER_TO_UPPER_BOUNDARY, '$1 $2'))
    .map((word: string) => word.replace(WHITESPACE_RUN, ' ').trim())
    .filter((word: string) => word.length > 0)
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1));

  return words.join(' ');
}

/** The application's own default copy for the strings this application introduces, keyed exactly as the templates render them. **Why the application has to carry them.** Every other label in this migration resolves through the legacy `app/global-translations/locale-*.json` bundles `translate.config.ts` loads in place (AAP 0.4.3, AAP 0.1.1), and no bundle carries a key for the 10-second idle warning AAP 0.1.1 requires, so this copy is the application's one deliberate difference from the legacy bundles: it is English-only in every language the switchers offer, and it is registered, with that limitation, in the deliberate-difference register the parity report renders (`web-ng/e2e/report/difference-register.ts`, AAP 0.10.5). A legacy or build-owned bundle carrying either key takes precedence automatically, because ngx-translate reaches this handler only for a key the active and fallback bundles both lack — which is also why no key is invented in the read-only `app/` tree (Rule 1 clause 6). */
export const APP_OWNED_TRANSLATIONS: ReadonlyMap<string, string> = new Map<string, string>([
  ['label.message.session.expiring', 'You have been inactive and will be signed out shortly.'],
  ['label.button.stay.signed.in', 'Stay signed in'],
]);

/** Replaces ngx-translate's key-echoing default handler, so a key that the active locale and the fallback locale both lack is still rendered as a readable label. */
export class FineractMissingTranslationHandler implements MissingTranslationHandler {
  /** Keys this handler instance has already reported, so a key rendered inside a list or a repeated block warns once instead of on every change-detection pass. */
  private readonly warnedKeys = new Set<string>();

  /** @param params ngx-translate's missing-key context; only `key` is read from it @returns the application's own default copy for a key it introduces, else the humanised last segment of the missing key — never the key itself */
  handle(params: MissingTranslationHandlerParams): string {
    const appOwned: string | undefined = APP_OWNED_TRANSLATIONS.get(params.key);

    if (appOwned !== undefined) {
      return appOwned;
    }

    if (isDevMode() && !this.warnedKeys.has(params.key)) {
      this.warnedKeys.add(params.key);
      console.warn(`[i18n] missing translation key: ${params.key}`);
    }

    return humaniseKey(params.key);
  }
}
