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

/** The login screen at `#/login` (AAP 0.7.1 `auth`, AAP 0.7.4 "Login", Figma flow step 1 / node `1:5`), routed as `AUTH_ROUTES` by its sibling `auth.routes.ts`; template and spec are the sibling files and every visual. */
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

  /** The error region: Fineract's message verbatim for the refusal it answered, the generic legacy sentence for a failure that never reached the server, and `null` while idle or when the interceptor's single notification is. */
  readonly error = signal<string | null>(null);

  /** Whether {@link error} currently reports a failed language switch rather than a sign-in failure. */
  private languageFailure = false;

  /** The application's single language list, shared with the navbar so the two cannot disagree. */
  readonly langs = AVAILABLE_LANGS;

  /** The active language as a non-null string: ngx-translate types `currentLang` as a signal that is `null` until a bundle loads, so the template reads `currentLang()`. */
  readonly currentLang: Signal<string> = computed(
    (): string => this.translate.currentLang() ?? FALLBACK_LANG,
  );

  /** Binds the host page's `lang` attribute to the active language, so the screen is announced, hyphenated and spell-checked in the language it is read in rather than in the static `<html lang="en">` default (WCAG 3.1.1, QA (AAP 0.7.4). */
  constructor() {
    bindDocumentLanguage(this.translate);
  }

  /** Authenticates and continues to the interrupted route or `#/clients`; an invalid form returns before any request, and a failed attempt paints what {@link describe} answers — Fineract's own message for the refusal it. */
  async submit(): Promise<void> {
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      return;
    }

    await this.guard.runOnce(async (): Promise<void> => {
      // A new attempt starts from a clean region, and what it can write there is a sign-in failure, never a language one: the record of a failed switch is withdrawn with the message it described, so a switch that takes effect.
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

  /** Switches the active translation in place: no page reload and no navigation (AAP 0.7.4) (AAP 0.14.2). */
  onLangChange(code: string, select: HTMLSelectElement): void {
    this.translate.use(code).subscribe({
      next: (): void => {
        if (this.languageFailure) {
          // A switch that took effect withdraws the message a failed switch left in the region, and only that message: a sign-in failure is withdrawn by `submit()`, not by a language change.
          this.error.set(null);
          this.languageFailure = false;
        }
      },
      error: (): void => {
        this.reportLanguageFailure(select);
      },
    });
  }

  /** The destination `submit()` continues to: the attempted route, or the clients list (AAP 0.7.4 "navigate to the attempted route or `#/clients`") (AAP 0.4.2, AAP 0.14.1). */
  private destination(): string {
    const attempted: string | null = this.route.snapshot.queryParamMap.get('returnUrl');

    return attempted !== null && attempted.startsWith('/') && !attempted.startsWith('//')
      ? attempted
      : CLIENTS_ROUTE;
  }

  /** Reports a language switch whose bundle failed to load and puts the switcher back on the language actually in force. */
  private reportLanguageFailure(select: HTMLSelectElement): void {
    select.value = this.currentLang();
    this.error.set(this.translate.instant(GENERIC_FAILURE_KEY));
    this.languageFailure = true;
  }

  /** The text the error region paints for a failed sign-in attempt, or `null` when that failure has already had its one surface (AAP 0.7.4, AAP 0.14.2). */
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
