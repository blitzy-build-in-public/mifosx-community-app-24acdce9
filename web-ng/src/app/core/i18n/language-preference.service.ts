import { DOCUMENT, Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import { AVAILABLE_LANGS } from './translate.config';

/** The prefix the legacy storage wrapper is configured with — `.value('prefix', 'ls')` at `app/scripts/modules/localstorage.js:4` — before the period the wrapper appends to it (`:21-22`), so an entry it writes sits under `ls.<name>` (Rule 1 clause 3). */
export const LEGACY_LANGUAGE_PREFIX = 'ls';

/** The entry name the legacy shell writes the chosen language under: `localStorageService.addToLocalStorage('Language', lang)` at `app/scripts/controllers/main/MainController.js:344`. */
export const LANGUAGE_ENTRY_KEY = 'Language';

/** The exact key both front ends find the chosen language at — `prefix + '.' + entry`, which is `ls.Language` — derived here and nowhere else, because it is the string a legacy screen reads and a spec asserts (AAP 0.3.4 claim 9, Rule 1 clause 3). */
export function languagePreferenceKey(
  prefix: string = LEGACY_LANGUAGE_PREFIX,
  entry: string = LANGUAGE_ENTRY_KEY,
): string {
  return `${prefix}.${entry}`;
}

/** A JSON object: the only shape a stored language entry may present. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether the application can serve a bundle for `language`: exact membership of `AVAILABLE_LANGS`, the one language list both switchers offer (`core/i18n/translate.config.ts`). Legacy applies a stored entry only when its code matches an entry of `mifosX.models.Langs` exactly and offers nothing outside it (`app/scripts/controllers/main/MainController.js:232-238`; `app/scripts/models/Langs.js`), so this is the same test, not an added one (Rule 1 clause 3). The comparison is exact on the trimmed value, because the loader interpolates the code into `global-translations/locale-<code>.json`: a value outside the list names a bundle no `angular.json` asset mapping serves, so it must never reach the load. */
function isOfferedLanguage(language: string): boolean {
  return AVAILABLE_LANGS.includes(language);
}

/** The language code a stored entry names, or `null`: legacy stores the whole `Langs` entry and reads only its `code` back (`app/scripts/controllers/main/MainController.js:232-238`), so that one member is the contract and everything else — another release's shape, a hand-edited value, a bare string — is input rather than a typed value (Rule 1 clause 4). A blank code names no language, and a code the application offers no bundle for names none either, so both answer `null` instead of being handed to a bundle load that cannot resolve them. */
function toLanguageCode(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const code = value['code'];

  if (typeof code !== 'string') {
    return null;
  }

  const language = code.trim();

  return isOfferedLanguage(language) ? language : null;
}

/** The chosen language, kept where the legacy application keeps it so a full page load continues in it: the service that owns the `ls.Language` entry, the way `SessionService` owns the legacy session entry, writing the selection when the language switcher changes it (AAP 0.2.3 `LanguageSwitcher`; `app/scripts/controllers/main/MainController.js:343-345`) and applying the remembered one before the first screen renders (`:232-238`; Rule 1 clause 3). Only a code `AVAILABLE_LANGS` carries is ever applied or written, because legacy applies a remembered entry only when it matches its own language list exactly (`:232-238`) and the loader turns the code into a bundle path. It holds no state, so nothing here needs a signal, a subscription kept alive, or a copy of what the translate service already publishes; and the code it reads or writes is never logged (Rule 1 clause 9). */
@Injectable({ providedIn: 'root' })
export class LanguagePreferenceService {
  /** Injected rather than read off the `document` global, so a test can supply a document with no browsing context and the storage-unavailable path stays exercisable — the `SessionService` precedent (AAP 0.7.1). */
  private readonly document = inject(DOCUMENT);

  /** The one owner of the active language and of the bundle loading that applying a language performs, so a restore is the same `TranslateService.use()` call the switcher makes and no second path to the library exists (AAP 0.7.1). */
  private readonly translate = inject(TranslateService);

  /** The remembered language's code, or `null` when there is no usable one: an absent entry, a value that is not JSON, a JSON value that is not an object, an object without a non-empty string `code`, an object whose `code` `AVAILABLE_LANGS` does not carry, and a document whose storage cannot be read all answer `null`, because none of them names a language this application can switch to (Rule 1 clause 4). */
  read(): string | null {
    const store = this.store();

    if (store === null) {
      return null;
    }

    let raw: string | null;

    try {
      raw = store.getItem(languagePreferenceKey());
    } catch {
      // A store the browser refuses to read has nothing to offer this load, which is the state the legacy wrapper treats as an unsupported browser.
      return null;
    }

    if (raw === null) {
      return null;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    return toLanguageCode(parsed);
  }

  /** Records `code` as the chosen language in the legacy shape — `{"code": "<code>"}`, which is what the wrapper's `angular.toJson` write degenerates to for the one member legacy reads back — so the next page load starts in it (`MainController.js:232-238, 344`; Rule 1 clause 3). The selection is remembered whether or not its bundle arrives, and a code that names no language writes nothing rather than an entry no start-up can use — a blank one, or one the application offers no bundle for, which legacy never applies either because it matches the stored entry against its own language list (`:232-238`); a store that is full, read-only or absent from the document leaves the switch in effect for this page and the next load on the configured language, because a preference is not worth failing a screen over (AAP 0.14.2). */
  remember(code: string): void {
    const language = code.trim();

    if (!isOfferedLanguage(language)) {
      return;
    }

    const store = this.store();

    if (store === null) {
      return;
    }

    try {
      store.setItem(languagePreferenceKey(), JSON.stringify({ code: language }));
    } catch {
    }
  }

  /** Puts the remembered language back into effect at start-up by applying its code through `TranslateService.use()`, the same call the switcher makes, subscribed to once so the bundle is requested once (`MainController.js:232-238`; Rule 1 clause 3). It never throws, never blocks the caller and never waits for the bundle: with nothing remembered it does nothing and requests no bundle at all, which is where a stored entry the application offers no bundle for also lands because `read()` answers it as `null`, and a bundle that cannot be loaded leaves the language in force as it was — the library reverts `currentLang` and warns on its own console, which is exactly what a failed switch does on the legacy screens. */
  restore(): void {
    const remembered = this.read();

    if (remembered === null) {
      return;
    }

    this.translate.use(remembered).subscribe({
      next: (): void => {
        // The library has moved `currentLang` and emitted `onLangChange` by now, which is the whole effect a restore asks for, and the switchers read `currentLang` themselves.
      },
      error: (): void => {
      },
    });
  }

  /** The page's `localStorage`, or `null` when the document has no browsing context or the browser refuses the store — the two conditions the legacy wrapper answers with its cookie fallback (`app/scripts/modules/localstorage.js:28-36`), which this application has no reason to reproduce for a preference. */
  private store(): Storage | null {
    const view = this.document.defaultView;

    if (view === null) {
      return null;
    }

    try {
      return view.localStorage;
    } catch {
      return null;
    }
  }
}
