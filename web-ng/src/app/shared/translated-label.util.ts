import { computed, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';

/**
 * Label resolution for the screens whose fields take already-translated text (AAP 0.7.1, the
 * `shared/` helpers both savings screens use; AAP 0.14.2, "Public interfaces": every export carries a
 * doc comment).
 *
 * **Why a resolver exists at all.** `shared/select-field` and `shared/date-field` declare their
 * `label` as plain display text, so a screen cannot hand them a key and let `TranslatePipe` resolve
 * it. The key is therefore resolved by hand with `instant()`, and a field re-renders when the signal
 * holding that text changes.
 *
 * **Why `instant()` alone is not enough.** It answers from whatever bundle is loaded at that moment,
 * so the value it returns at first paint is frozen: a label painted before its bundle arrived would
 * keep the missing-translation handler's humanised wording for the life of the screen, and a language
 * switch would change every `TranslatePipe` caption while the field labels stayed in the old
 * language. The resolver therefore keeps a revision signal that `onLangChange` and
 * `onTranslationChange` bump, and every label signal reads it, so the text is re-resolved — not
 * frozen — when either event lands.
 *
 * **One copy, not two.** `savings-new` and `savings-action` each carried a verbatim copy of this
 * mechanism, which would drift the day one of them subscribed to a stream the other did not. This
 * module is the one copy both screens use, and it lives in `shared/` because `shared/` imports no
 * feature (AAP 0.14.1, "One direction of dependency").
 */

/**
 * Turns a legacy translation key into a signal of that key's text in the active language.
 *
 * Each call builds one signal, so a screen declares one field per label it renders and the template
 * binds `label()` to the field component's `label` input.
 */
export type TranslatedLabel = (key: string) => Signal<string>;

/**
 * Creates one label resolver for the component that calls it.
 *
 * **Must be called in an injection context** — a component field initializer or its constructor —
 * because it injects `TranslateService` and registers `takeUntilDestroyed()`. The two subscriptions
 * then end with the component that created them, so no screen outlives its listeners and no label
 * signal outlives the screen it was declared on.
 *
 * @returns the resolver a screen stores in one field and calls once per label it renders.
 */
export function createTranslatedLabels(): TranslatedLabel {
  const translate = inject(TranslateService);

  /**
   * Counts the moments at which a label must be resolved again: a language switch and a bundle
   * arriving. Read inside every label signal the resolver returns, so `instant()` is asked again
   * rather than answering with the text of a bundle that had not loaded yet.
   */
  const labelsRevision = signal(0);

  const refreshLabels = (): void => labelsRevision.update((revision) => revision + 1);

  translate.onLangChange.pipe(takeUntilDestroyed()).subscribe(refreshLabels);
  translate.onTranslationChange.pipe(takeUntilDestroyed()).subscribe(refreshLabels);

  return (key: string): Signal<string> =>
    computed(() => {
      labelsRevision();
      translate.currentLang();
      return translate.instant(key);
    });
}
