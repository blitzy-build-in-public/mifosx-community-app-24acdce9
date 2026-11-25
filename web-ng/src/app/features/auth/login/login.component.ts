import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../../core/auth/auth.service';
import { ApiError } from '../../../core/http/api-error';
import { AVAILABLE_LANGS, FALLBACK_LANG } from '../../../core/i18n/translate.config';
import { createSubmitGuard } from '../../../shared/submit-guard.util';

/** Legacy key of the message shown when a failure is not Fineract's own text. */
const GENERIC_FAILURE_KEY = 'error.connection.failed';

/** The post-login landing screen (AAP 0.2.1 step 1, AAP 0.10.5 item 3). */
const CLIENTS_ROUTE = '/clients';

/**
 * The login screen at `#/login` (AAP 0.7.1 `auth`, AAP 0.7.4 "Login", Figma flow step 1 / node
 * `1:5`), routed as `AUTH_ROUTES` by its sibling `auth.routes.ts`; template and spec are the sibling
 * files and every visual value lives in the global stylesheet, so this file declares no styles.
 */
@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, TranslatePipe],
  templateUrl: './login.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);

  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  private readonly translate = inject(TranslateService);

  /** The two credentials, and `Validators.required` is the whole rule legacy states (Rule 1 clause 3). */
  readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  /** Duplicate-submission protection: the template disables the button on `busy()` (AAP 0.14.1). */
  readonly guard = createSubmitGuard();

  /** The error region: Fineract's message verbatim, or a generic one, and `null` while idle. */
  readonly error = signal<string | null>(null);

  /**
   * Whether {@link error} currently reports a failed language switch rather than a sign-in failure.
   *
   * The screen has one error region and two writers, so the region records which of them filled it: a
   * switch that takes effect withdraws the message a failed switch left behind, while a credential
   * failure stays until the next {@link submit} attempt clears it. A plain field is enough, because
   * it is never rendered and never read in a template — only in this class.
   */
  private languageFailure = false;

  /** The application's single language list, shared with the navbar so the two cannot disagree. */
  readonly langs = AVAILABLE_LANGS;

  /**
   * The active language as a non-null string: ngx-translate types `currentLang` as a signal that is
   * `null` until a bundle loads, so the template reads `currentLang()`.
   */
  readonly currentLang: Signal<string> = computed(
    (): string => this.translate.currentLang() ?? FALLBACK_LANG,
  );

  /**
   * Authenticates and continues to the interrupted route or `#/clients`; an invalid form returns
   * before any request, and a failure renders the server's message while only the password clears.
   */
  async submit(): Promise<void> {
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      return;
    }

    await this.guard.runOnce(async (): Promise<void> => {
      // A new attempt starts from a clean region, and what it can write there is a sign-in failure,
      // never a language one: the record of a failed switch is withdrawn with the message it
      // described, so a switch that takes effect afterwards cannot hide this attempt's own message.
      this.error.set(null);
      this.languageFailure = false;

      const { username, password } = this.form.getRawValue();

      try {
        await this.auth.login(username, password);
      } catch (failure: unknown) {
        this.error.set(this.describe(failure));
        this.form.controls.password.reset('');
        return;
      }

      await this.router.navigateByUrl(this.destination());
    });
  }

  /**
   * Switches the active translation in place: no page reload and no navigation (AAP 0.7.4).
   *
   * `TranslateService.use()` performs the switch itself — it loads the bundle, applies it and then
   * moves its own `currentLang` signal — so the observable it returns is subscribed to exactly once:
   * a second subscription would issue a second load of the same bundle.
   *
   * Its `error` channel is where a bundle that failed to load arrives, because the loader is
   * configured with `failOnError: true` (`core/i18n/translate.config.ts`): a failed request is
   * rethrown instead of being completed as an empty set of translations, which is what makes the
   * failure observable at all (AAP 0.14.2 "Error handling"). What an emission carries is therefore
   * never taken as a signal: a switch that succeeds may deliver no translations at all — a language
   * whose translations come from any source other than this loader produces exactly that, while the
   * library still moves `currentLang` — so reading success or failure from the payload would undo
   * switches that took effect. This error channel is the only failure signal, and the library's own
   * state is the record of the language in force.
   *
   * The service has already put itself back on the error path: `@ngx-translate/core` 18.1.0 resets
   * `currentLang` to the language in force before it delivers the error, because the store holds
   * nothing for the code that failed. Nothing re-applies a language here for that reason — a second
   * `use(previous)` would be a second switch. What the service cannot restore is the element: the
   * `<select>`'s `[value]` binding never rewrites a control whose bound value did not change, so the
   * control still stands on the code the user picked, and it is written back from `currentLang()` in
   * {@link reportLanguageFailure}, as the navbar's switcher does. That also fills this screen's error
   * region, so the failure is rendered rather than swallowed (AAP 0.14.2).
   *
   * A switch that took effect withdraws a message a failed switch left in that region — but only
   * such a message, which {@link languageFailure} records, so a sign-in failure stays on screen until
   * {@link submit} clears it at the start of the next attempt.
   *
   * @param code the selected language code, one of {@link langs}.
   * @param select the select that reported the change, required because the `[value]` binding cannot
   * express a failure the service has already recovered from.
   */
  onLangChange(code: string, select: HTMLSelectElement): void {
    this.translate.use(code).subscribe({
      next: (): void => {
        if (this.languageFailure) {
          // A switch that took effect withdraws the message a failed switch left in the region, and
          // only that message: a sign-in failure is withdrawn by `submit()`, not by a language change.
          this.error.set(null);
          this.languageFailure = false;
        }
      },
      error: (): void => {
        this.reportLanguageFailure(select);
      },
    });
  }

  /**
   * The destination `submit()` continues to: the attempted route, or the clients list (AAP 0.7.4
   * "navigate to the attempted route or `#/clients`").
   *
   * The value is replayed from the `returnUrl` query string — the interceptor puts it there when a 401
   * clears the session and sends the user here (AAP 0.4.2, AAP 0.14.1) — so it is checked rather than
   * trusted. A single leading `/` admits every route this application declares, and the
   * protocol-relative `//host/…` form is rejected explicitly, so a crafted link cannot hand the
   * browser an origin of its own. An absolute URL, a bare segment such as `clients` and an empty value
   * all fall back to {@link CLIENTS_ROUTE}.
   *
   * @returns the in-app path to navigate to, never a value the caller has to re-check.
   */
  private destination(): string {
    const attempted: string | null = this.route.snapshot.queryParamMap.get('returnUrl');

    return attempted !== null && attempted.startsWith('/') && !attempted.startsWith('//')
      ? attempted
      : CLIENTS_ROUTE;
  }

  /**
   * Reports a language switch whose bundle failed to load and puts the switcher back on the language
   * actually in force.
   *
   * The service needs no help here: `TranslateService.use()` has already left `currentLang` on the
   * language in force when its load fails, so re-applying the previous code would be a second switch.
   * The element does need it, because its `[value]` binding is unchanged and Angular therefore never
   * rewrites it, and the message is resolved after that write so it reads in the language the screen
   * still shows. The message is recorded as a language failure ({@link languageFailure}), so a switch
   * that takes effect afterwards withdraws it, while a message reporting a sign-in failure is never
   * withdrawn by a language change.
   *
   * @param select the select that reported the change and is put back on the language in force.
   */
  private reportLanguageFailure(select: HTMLSelectElement): void {
    select.value = this.currentLang();
    this.error.set(this.translate.instant(GENERIC_FAILURE_KEY));
    this.languageFailure = true;
  }

  /** A failure's text: Fineract's own message when the interceptor mapped it, else the generic one. */
  private describe(failure: unknown): string {
    return failure instanceof ApiError
      ? failure.message
      : this.translate.instant(GENERIC_FAILURE_KEY);
  }
}
