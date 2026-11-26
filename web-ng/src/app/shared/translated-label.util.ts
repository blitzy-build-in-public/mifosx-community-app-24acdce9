import { computed, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';

/** Label resolution for the screens whose fields take already-translated text (AAP 0.7.1 `shared/` helpers, AAP 0.14.2 public interfaces) (AAP 0.14.1). */

/** Turns a legacy translation key into a signal of that key's text in the active language: each call builds one signal, so a screen declares one field per label it renders and the template binds `label()` to the field component's `label` input. */
export type TranslatedLabel = (key: string) => Signal<string>;

/** Creates one label resolver for the component that calls it. Must be called in an injection context — a component field initializer or its constructor — because it injects `TranslateService` and registers `takeUntilDestroyed()`, so the two subscriptions end with the component that created them and no label signal outlives the screen it was declared on. */
export function createTranslatedLabels(): TranslatedLabel {
  const translate = inject(TranslateService);

  /** Counts the moments at which a label must be resolved again — a language switch and a bundle arriving — and is read inside every label signal the resolver returns, so `instant()` is asked again rather than answering with the text of a bundle that had not loaded yet. */
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
