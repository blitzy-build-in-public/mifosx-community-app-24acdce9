import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

/**
 * The language switcher: the `LanguageSwitcher` row of the component inventory (AAP 0.2.3), the
 * "Change language:" row the login screen opens with (Figma node `1:5`) and the same row on the
 * right of the signed-in navbar (node `1:3`, file `DKm5TBFbXypfqyx4xUdhBw`; AAP 0.7.4). Both
 * screens render this one component, so the two switchers the legacy application carried as
 * separate inline controls cannot drift apart (AAP 0.10.5 item 14 keeps the switcher itself).
 *
 * **It owns the switch, and the reconciliation a switch can need.** A change is a
 * `TranslateService.use()` call — no page reload and no navigation (AAP 0.7.4) — subscribed to
 * exactly once, because a second subscription would issue a second load of the same bundle. The
 * observable's `error` channel is where a bundle that failed to load arrives, since the loader is
 * configured with `failOnError: true` (`core/i18n/translate.config.ts`); what a `next` emission
 * carries is therefore never read as a signal of success, because a switch that takes effect may
 * deliver no translations at all while the library still moves its own `currentLang`.
 *
 * That leaves one thing the library cannot put right. On the error path it restores `currentLang`
 * to the language in force, but the native `<select>`'s `[value]` binding is *not* re-applied: it
 * only ever writes a value that changed, and the value it binds — {@link current} — did not. The
 * control would therefore go on advertising the language the user picked while the application
 * renders the previous one, so {@link onLangChange} writes the select back from {@link current}
 * itself. A successful load moves {@link current} and the binding takes over again on its own.
 *
 * **It reports both outcomes.** {@link langChange} tells the screen that a switch took effect,
 * {@link langChangeFailed} that one did not, so a screen with an error region can render the
 * failure rather than swallow it (AAP 0.14.2 "Error handling": no `catch` swallows an error
 * silently). Neither output carries a credential, a session field or a URL (Rule 1 clause 9).
 *
 * **It carries no CSS.** The label's 13px `#666F74` treatment and the select's 24px height over
 * Bootstrap's `.btn.btn-default.btn-xs` bordered look come from the `.language-switcher` rule of
 * `web-ng/src/styles.scss` (AAP 0.2.3's `LanguageSwitcher` visual specification, Rule 1 clause 6),
 * so this file declares no stylesheet, no colour and no dimension. The wrapper's own layout
 * classes are the *caller's*: the navbar floats it right with `.navbar-form.navbar-right` on the
 * host element and the login screen right-aligns its text, which is the placement each screen had
 * before the row was extracted.
 */
@Component({
  selector: 'app-language-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './language-switcher.component.html',
})
export class LanguageSwitcherComponent {
  /** The one owner of the active language and of the bundle loading a change performs. */
  private readonly translate = inject(TranslateService);

  /**
   * The language codes the select offers, in the order it renders them: `AVAILABLE_LANGS`, the
   * application's single language list (`core/i18n/translate.config.ts`), so no language can be
   * offered by one screen and missing from the other.
   *
   * Required, because a switcher with nothing to offer would be the broken affordance this
   * migration exists to avoid; omitting it is a `strictTemplates` error at the caller.
   */
  readonly langs = input.required<readonly string[]>();

  /**
   * The language actually in force — the code whose bundle is loaded, not the one the user last
   * asked for. It is what the select shows and what it is written back to when a load fails, so
   * the control never advertises a language the application is not rendering.
   */
  readonly current = input.required<string>();

  /**
   * The translation key of the label beside the select.
   *
   * An input rather than a constant because the two screens carry different keys, and legacy is
   * the source of both: the navbar reads `label.heading.language` ("Language") and the login screen
   * reads `label.input.changelanguage` ("Change language:") — the wording the design shows on node
   * `1:5`. Inventing one key for both would put wording on screen that the shipped bundles never
   * held (Rule 1 clause 3, Rule 1 clause 6). The default is the navbar's key.
   */
  readonly labelKey = input<string>('label.heading.language');

  /**
   * The `<select>`'s `id`, which its `<label for>` points at and which the harness addresses the
   * control by.
   *
   * The login screen keeps legacy's `langSelect` (`app/index.html`), because that is the id the
   * parity page objects drive; the navbar keeps `navbar-language`. Two switchers can therefore be
   * on screen — or in one spec — without a duplicate id, and each screen names its own.
   */
  readonly selectId = input<string>('language-switcher');

  /**
   * Reports the code whose switch took effect, after the library has applied it. The navbar and
   * the login screen each act on it; nothing navigates as a result, because switching a language
   * is not leaving the screen (AAP 0.7.4).
   */
  readonly langChange = output<string>();

  /**
   * Reports that the selected bundle could not be loaded, after the select has been put back on
   * {@link current}. A screen with an error region renders a message for it; the failure is never
   * swallowed (AAP 0.14.2).
   */
  readonly langChangeFailed = output<void>();

  /**
   * Switches the active translation to the selected code, and reconciles the control with the
   * language actually in force afterwards.
   *
   * The `use()` observable is subscribed to once: its `next` is the moment the switch took effect,
   * and it is reported through {@link langChange}; its `error` is a bundle that could not be
   * loaded, where the library keeps the language it had and this method writes the select back to
   * it (the reason is stated in the class comment) before reporting through
   * {@link langChangeFailed}.
   *
   * A blank selection is nothing to switch to: the select is put back and neither output fires, so
   * an empty option can never be reported as a language change.
   *
   * @param code the selected language code, one of {@link langs}.
   * @param select the select that reported the change, whose value is reconciled with the language
   *   in force — the element has to be handed over because a binding cannot express this write.
   */
  onLangChange(code: string, select: HTMLSelectElement): void {
    const language: string = code.trim();

    if (language.length === 0) {
      select.value = this.current();
      return;
    }

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
