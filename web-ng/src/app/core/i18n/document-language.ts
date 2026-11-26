import { DOCUMENT, effect, inject } from '@angular/core';
import type { TranslateService } from '@ngx-translate/core';

import { FALLBACK_LANG } from './translate.config';

/**
 * Keeps the host page's `lang` attribute in step with the language the interface is actually in, and
 * writes it once immediately so the first paint is announced correctly.
 *
 * **Why the attribute has to be written at run time.** `web-ng/src/index.html` can only carry the
 * pre-render default — one static `<html lang="en">` — while the application switches language in
 * place, without a reload (AAP 0.7.4). A French or Spanish interface that still declares English is
 * announced by a screen reader in English and hyphenated and spell-checked as English, which is the
 * WCAG 3.1.1 defect QA report F14 records at `web-ng/src/index.html:2`. Nothing else in the tree
 * writes this attribute, so this function is its one owner.
 *
 * **It follows the language in force, not the language last requested.** The value is
 * `TranslateService.currentLang()` with `FALLBACK_LANG` for the moment before the first bundle
 * resolves, read inside an `effect()` so every change to that signal rewrites the attribute. A switch
 * whose bundle fails to load leaves `currentLang` on the language in force
 * (`@ngx-translate/core` 18.1.0, `use()`), so the attribute keeps describing the language the user
 * is really reading rather than the one that was asked for.
 *
 * **It must be called from an injection context.** `inject(DOCUMENT)` and `effect()` both need one,
 * which is why the two screens that host a language switcher — the signed-in shell and the login
 * screen — call it from their constructors. `DOCUMENT` is injected rather than read off the global
 * `document`, so the write reaches the same document the rest of the application uses and a unit
 * suite observes it. The effect belongs to the caller's injector and is destroyed with it, and the
 * attribute keeps its last value, which is the language the page was last served in.
 *
 * The reactive plumbing is a signal `effect()` rather than a subscription to `onLangChange`, because
 * the application is zoneless and its views and bindings are signal-driven (AAP 0.4.1).
 *
 * @param translate the application's one `TranslateService`, whose `currentLang` signal is the single
 *   statement of the active language (AAP 0.7.1, AAP 0.7.4).
 */
export function bindDocumentLanguage(translate: TranslateService): void {
  const document = inject(DOCUMENT);

  /** The language in force: the active one, or the fallback while no bundle has resolved yet. */
  const languageInForce = (): string => translate.currentLang() ?? FALLBACK_LANG;

  // Written before the effect runs, so the attribute is already correct on the first render rather
  // than only after the first change-detection pass.
  document.documentElement.lang = languageInForce();

  effect((): void => {
    document.documentElement.lang = languageInForce();
  });
}
