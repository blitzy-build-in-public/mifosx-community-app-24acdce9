import { DOCUMENT, effect, inject } from '@angular/core';
import type { TranslateService } from '@ngx-translate/core';

import { FALLBACK_LANG } from './translate.config';

/** Keeps the host page's `lang` attribute in step with the language the interface is actually in, and writes it once immediately so the first paint is announced correctly (AAP 0.7.4, AAP 0.4.1, AAP 0.7.1).
 *
 * **Why the attribute has to be written at run time.** `web-ng/src/index.html` carries only the pre-render default (`<html lang="en">`) while the application switches language in place without a reload (AAP 0.7.4), so a French or Spanish interface that still declares English is announced, hyphenated and spell-checked as English (WCAG 3.1.1). */
export function bindDocumentLanguage(translate: TranslateService): void {
  const document = inject(DOCUMENT);

  /** The language in force: the active one, or the fallback while no bundle has resolved yet. */
  const languageInForce = (): string => translate.currentLang() ?? FALLBACK_LANG;

  document.documentElement.lang = languageInForce();

  effect((): void => {
    document.documentElement.lang = languageInForce();
  });
}
