import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { LanguagePreferenceService } from '../../core/i18n/language-preference.service';

/** The language switcher: the `LanguageSwitcher` row of the component inventory, the "Change language:" row the login screen opens with (Figma node `1:5`) and the same row on the right of the signed-in navbar (node `1:3`). Both screens render this
 * one component, so the two switchers the legacy application carried as separate inline controls cannot drift apart. A change is a `TranslateService.use()` call — no reload and no navigation (AAP 0.7.4) — subscribed to exactly once, a second
 * subscription loading the same bundle twice; a failed load arrives on the observable's `error` channel, the loader being configured with `failOnError: true` (`core/i18n/translate.config.ts`), and a `next` emission is never read as success, because
 * a switch that takes effect may deliver no translations at all. The library restores `currentLang` on that error path but never re-applies the native `<select>`'s `[value]` binding, which only writes a value that changed, so {@link onLangChange}
 * writes the select back from {@link current} itself; the chosen code is remembered in the legacy `ls.Language` entry at the moment of the switch, before the bundle is asked for, as legacy's `changeLang` does
 * (`app/scripts/controllers/main/MainController.js:343-345`). {@link langChange} reports a switch that took effect and {@link langChangeFailed} one that did not, so a screen with an error region renders the failure rather than swallowing it;
 * neither output carries a credential, a session field or a URL. It carries no CSS: the label's 13px `#666F74` treatment and the select's 24px height over Bootstrap's `.btn.btn-default.btn-xs` look come from the `.language-switcher` rule of
 * `web-ng/src/styles.scss`, while the wrapper's layout classes are the caller's. */
@Component({
  selector: 'app-language-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './language-switcher.component.html',
})
export class LanguageSwitcherComponent {
  /** The one owner of the active language and of the bundle loading a change performs. */
  private readonly translate = inject(TranslateService);

  /** The owner of the remembered selection: the legacy `ls.Language` entry this component writes when the user picks a language, which the start-up in `app.config.ts` applies again on the next page load (`core/i18n/language-preference.service.ts`). */
  private readonly preference = inject(LanguagePreferenceService);

  /** The language codes the select offers, in the order it renders them: `AVAILABLE_LANGS`, the application's single language list (`core/i18n/translate.config.ts`), so no language can be offered by one screen and missing from the other. Required,
   * because a switcher with nothing to offer would be the broken affordance this migration exists to avoid; omitting it is a `strictTemplates` error at the caller. */
  readonly langs = input.required<readonly string[]>();

  /** The language actually in force — the code whose bundle is loaded, not the one the user last asked for. It is what the select shows and what it is written back to when a load fails, so the control never advertises a language the application is
   * not rendering. */
  readonly current = input.required<string>();

  /** The translation key of the label beside the select. An input rather than a constant because the two screens carry different keys, and legacy is the source of both: the navbar reads `label.heading.language` ("Language") and the login screen
   * reads `label.input.changelanguage` ("Change language:") — the wording the design shows on node `1:5`. Inventing one key for both would put wording on screen that the shipped bundles never held (Rule 1 clause 3). The default is the navbar's
   * key. */
  readonly labelKey = input<string>('label.heading.language');

  /** The `<select>`'s `id`, which its `<label for>` points at and which the harness addresses the control by. The login screen keeps legacy's `langSelect` (`app/index.html`), because that is the id the parity page objects drive; the navbar keeps
   * `navbar-language`. Two switchers can therefore be on screen — or in one spec — without a duplicate id, and each screen names its own. */
  readonly selectId = input<string>('language-switcher');

  /** Reports the code whose switch took effect, after the library has applied it. The navbar and the login screen each act on it; nothing navigates as a result, because switching a language is not leaving the screen (AAP 0.7.4). */
  readonly langChange = output<string>();

  /** Reports that the selected bundle could not be loaded, after the select has been put back on {@link current}. A screen with an error region renders a message for it; the failure is never swallowed (AAP 0.14.2). */
  readonly langChangeFailed = output<void>();

  /** Switches the active translation to the selected code, and reconciles the control with the language actually in force afterwards. The `use()` observable is subscribed to once: its `next` is the moment the switch took effect, reported through
   * {@link langChange}; its `error` is a bundle that could not be loaded, where the library keeps the language it had and this method writes the select back to it (the reason is in the class comment) before reporting {@link langChangeFailed}. A
   * blank selection is nothing to switch to, so the select is put back and neither output fires. The selection is remembered before the bundle is asked for, and unconditionally, so a switch whose bundle then fails is still the language the next
   * page load starts in. `@param code` the selected language code, one of {@link langs}; `@param select` the select that reported the change, whose value is reconciled with the language in force — the element has to be handed over because a binding
   * cannot express this write. */
  onLangChange(code: string, select: HTMLSelectElement): void {
    const language: string = code.trim();

    if (language.length === 0) {
      select.value = this.current();
      return;
    }

    this.preference.remember(language);

    this.translate.use(language).subscribe({
      next: (): void => {
        this.langChange.emit(language);
      },
      error: (): void => {
        select.value = this.current();
        this.langChangeFailed.emit();
      },
    });
  }
}
