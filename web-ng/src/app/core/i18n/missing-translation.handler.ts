import { isDevMode } from '@angular/core';
import type {
  MissingTranslationHandler,
  MissingTranslationHandlerParams,
} from '@ngx-translate/core';

/**
 * Keeps a missing translation key from reaching the user as the raw dotted key, and reports it to
 * the developer console in development builds only.
 *
 * ngx-translate's own handler returns `params.key` unchanged, which would render
 * `label.heading.clients` where "Clients" belongs. The migrated locale bundles are the flat,
 * dotted files the legacy application ships, so an absent key is a realistic case rather than a
 * theoretical one.
 *
 * The single warning issued from `handle` is the only sanctioned console output in the
 * application: a development-only notice of a missing translation key. It is guarded by
 * `isDevMode()` and carries the key alone — never a translated value, a request, a response or a
 * session field — so nothing confidential can reach the console or a captured log.
 */

/** Acronym run followed by a capitalised word, as in `IDField`: split before the last capital. */
const ACRONYM_TO_WORD_BOUNDARY = /([A-Z]+)([A-Z][a-z])/g;

/** Lower-case letter or digit followed by a capital, as in `camelCase`: split at the capital. */
const LOWER_TO_UPPER_BOUNDARY = /([a-z0-9])([A-Z])/g;

/** Whitespace run left behind by the boundary substitutions. */
const WHITESPACE_RUN = /\s+/g;

/**
 * Turns the last segment of a dotted translation key into a presentable label. Deterministic and
 * side-effect free: it performs no translation lookup, reads no language state and touches no DOM.
 *
 * Applied in order: split on `.` and keep the last segment that is not blank; split that segment on
 * `_`; insert a space between an acronym run and a following capitalised word; insert a space
 * between a lower-case letter or digit and a following capital; trim each word and drop the blanks;
 * upper-case the first character of every word and leave the rest as written; join the words with
 * one space. Capitalising each `_`-separated word rather than the whole segment alone is what
 * renders `label.input.user_name` as `User Name` instead of `User name`.
 *
 * Worked example: `'client.missing.camelCaseKey'` becomes `'Camel Case Key'`.
 *
 * @param key dotted key as the translate pipe, a directive or `TranslateService` hands it over
 * @returns the humanised last segment, or `''` when no segment holds a character
 */
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

/**
 * Replaces ngx-translate's key-echoing default handler, so a key that the active locale and the
 * fallback locale both lack is still rendered as a readable label. This is the guarantee that a
 * raw dotted key never appears in the interface.
 *
 * Registered as a provider for the `MissingTranslationHandler` token —
 * `{ provide: MissingTranslationHandler, useClass: FineractMissingTranslationHandler }` — in
 * `core/i18n/translate.config.ts` and in `src/app/app.config.ts`. It is therefore never injected by
 * name, which is why the class carries no decorator and takes no constructor argument: a
 * provider-registered class needs neither an injection site nor injection metadata.
 *
 * Humanising the key is a deliberate, minimal difference from the legacy angular-translate setup,
 * which renders the raw key. The dotted key space, the loader prefix and the fallback language are
 * untouched: ngx-translate calls this handler only after the configured fallback language has
 * already failed, so the handler neither retries a lookup nor translates the result.
 */
export class FineractMissingTranslationHandler implements MissingTranslationHandler {
  /**
   * Keys this handler instance has already reported, so a key rendered inside a list or a repeated
   * block warns once instead of on every change-detection pass.
   */
  private readonly warnedKeys = new Set<string>();

  /**
   * @param params ngx-translate's missing-key context; only `key` is read from it
   * @returns the humanised last segment of the missing key — never the key itself
   */
  handle(params: MissingTranslationHandlerParams): string {
    if (isDevMode() && !this.warnedKeys.has(params.key)) {
      this.warnedKeys.add(params.key);
      console.warn(`[i18n] missing translation key: ${params.key}`);
    }

    return humaniseKey(params.key);
  }
}
