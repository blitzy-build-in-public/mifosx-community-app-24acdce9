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
import { ApiError, screenFailure } from '../../../core/http/api-error';
import { bindDocumentLanguage } from '../../../core/i18n/document-language';
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

  /**
   * The error region: Fineract's message verbatim for the refusal it answered, the generic legacy
   * sentence for a failure that never reached the server, and `null` while idle or when the
   * interceptor's single notification is that failure's one surface.
   */
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
   * Binds the host page's `lang` attribute to the active language, so the screen is announced,
   * hyphenated and spell-checked in the language it is read in rather than in the static
   * `<html lang="en">` default (WCAG 3.1.1, QA F14).
   *
   * This screen hosts the application's second language switcher (AAP 0.7.4), so it is one of the two
   * places that owe the write while no signed-in shell is mounted.
   * `core/i18n/document-language.ts` owns it, and it has to be called from a constructor because
   * `inject(DOCUMENT)` and `effect()` both need an injection context.
   */
  constructor() {
    bindDocumentLanguage(this.translate);
  }

  /**
   * Authenticates and continues to the interrupted route or `#/clients`; an invalid form returns
   * before any request, and a failed attempt paints what {@link describe} answers — Fineract's own
   * message for the refusal it sent, nothing when the interceptor's notification is already that
   * failure's one surface — while only the password clears.
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

  /**
   * The text the error region paints for a failed sign-in attempt, or `null` when that failure has
   * already had its one surface.
   *
   * Three cases, and the first that matches answers:
   *
   * 1. A 4xx is Fineract's own answer to the submitted credentials — the 401 a refused login arrives
   *    as — and its `defaultUserMessage` is painted verbatim: no prefix, no translation, no
   *    capitalisation (AAP 0.7.4 "a 401 shows Fineract's message in the form area"; workflow W7).
   *    `screenFailure` in `core/http/api-error.ts` is the shared rule for that case.
   * 2. A status of `0` or one at or above `500` has had exactly one notification raised for it by
   *    `core/http/fineract.interceptor.ts`, so this screen paints nothing and that notification
   *    stays the failure's only report (AAP 0.7.4; AAP 0.14.2 "every HTTP call path ends in either a
   *    rendered message or a notification").
   * 3. A rejection that is not an HTTP answer never reaches the interceptor's notification, so the
   *    region is filled rather than left empty: the `ApiError` `AuthService.login` raises with status
   *    `200` for a response that cannot describe a session carries the sentence that says so, and any
   *    other fault becomes the legacy generic sentence, so the screen shows neither a raw key nor an
   *    empty banner (AAP 0.14.2 "no `catch` swallows an error silently").
   *
   * @param failure Whatever the failed sign-in attempt rejected with.
   * @returns The text to render, or `null` when the interceptor's notification is the only report.
   */
  private describe(failure: unknown): string | null {
    const refusal = screenFailure(failure);

    if (refusal !== null) {
      return refusal.message;
    }

    if (failure instanceof ApiError) {
      return failure.status === 0 || failure.status >= 500 ? null : failure.message;
    }

    return this.translate.instant(GENERIC_FAILURE_KEY);
  }
}
