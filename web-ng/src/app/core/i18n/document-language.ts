import { DOCUMENT, effect, inject } from '@angular/core';
import type { TranslateService } from '@ngx-translate/core';

import { FALLBACK_LANG } from './translate.config';

/** Keeps the host page's `lang` attribute in step with the language the interface is actually in, and writes it once immediately so the first paint is announced correctly. **Why the attribute has to be written at run (AAP 0.7.4, AAP 0.4.1, AAP 0.7.1). */
export function bindDocumentLanguage(translate: TranslateService): void {
  const document = inject(DOCUMENT);

  /** The language in force: the active one, or the fallback while no bundle has resolved yet. */
  const languageInForce = (): string => translate.currentLang() ?? FALLBACK_LANG;

  document.documentElement.lang = languageInForce();

  effect((): void => {
    document.documentElement.lang = languageInForce();
  });
}
