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
      this.error.set(null);

      const { username, password } = this.form.getRawValue();

      try {
        await this.auth.login(username, password);
      } catch (failure: unknown) {
        this.error.set(this.describe(failure));
        this.form.controls.password.reset('');
        return;
      }

      await this.router.navigateByUrl(
        this.route.snapshot.queryParamMap.get('returnUrl') ?? '/clients',
      );
    });
  }

  /** Switches the active translation in place: no page reload and no navigation (AAP 0.7.4). */
  onLangChange(code: string): void {
    this.translate.use(code).subscribe({
      error: (): void => {
        this.error.set(this.translate.instant(GENERIC_FAILURE_KEY));
      },
    });
  }

  /** A failure's text: Fineract's own message when the interceptor mapped it, else the generic one. */
  private describe(failure: unknown): string {
    return failure instanceof ApiError
      ? failure.message
      : this.translate.instant(GENERIC_FAILURE_KEY);
  }
}
