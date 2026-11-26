import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
  type Signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../../core/auth/auth.service';
import { ApiError, screenFailure } from '../../../core/http/api-error';
import { bindDocumentLanguage } from '../../../core/i18n/document-language';
import { AVAILABLE_LANGS, FALLBACK_LANG } from '../../../core/i18n/translate.config';
import { LanguageSwitcherComponent } from '../../../shared/language-switcher/language-switcher.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import { LoginFormComponent, type LoginCredentials } from './login-form/login-form.component';

/** Legacy key of the message shown when a failure is not Fineract's own text. */
const GENERIC_FAILURE_KEY = 'error.connection.failed';

/** The post-login landing screen (AAP 0.2.1 step 1, AAP 0.10.5 item 3). */
const CLIENTS_ROUTE = '/clients';

/**
 * The login screen at `#/login` (AAP 0.7.1 `auth`, AAP 0.7.4 "Login", Figma flow step 1 / node
 * `1:5`), routed as `AUTH_ROUTES` by its sibling `auth.routes.ts`; template and spec are the sibling
 * files and every visual value lives in the global stylesheet, so this file declares no styles.
 *
 * **It composes the inventory's components rather than re-authoring them.** The form is
 * `LoginFormComponent` (AAP 0.2.3's `LoginForm` row, `(submit: {username, password})`) and the
 * language row is the shared `LanguageSwitcherComponent` (the `LanguageSwitcher` row) — the same
 * component the navbar renders, so the two switchers can no longer drift. What stays here is what
 * only this screen owns: the request (`AuthService.login`), the duplicate-submission guard, the one
 * error region, the hero, the footer and the destination.
 */
@Component({
  selector: 'app-login',
  imports: [LanguageSwitcherComponent, LoginFormComponent, TranslatePipe],
  templateUrl: './login.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);

  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  private readonly translate = inject(TranslateService);

  /**
   * Binds the host page's `lang` attribute to the active language, so a screen-reader user is told the
   * language the page is actually in after a switch (AAP 0.7.4; WCAG 3.1.1). The same call runs in the
   * shell, which is the other place a language can change; it is one shared helper rather than a line
   * written twice (Rule 1 clause 3).
   */
  constructor() {
    bindDocumentLanguage(this.translate);
  }

  /**
   * The form component, held so a refused exchange can clear the credential control the form owns.
   *
   * A signal view query, so it is read at the moment of the failure rather than cached, and it
   * answers `undefined` only once the view is gone — the state in which there is no control left to
   * clear, which is why the call is optional.
   */
  private readonly loginForm = viewChild(LoginFormComponent);

  /** Duplicate-submission protection: the template disables the button on `busy()` (AAP 0.14.1). */
  readonly guard = createSubmitGuard();

  /** The error region: Fineract's message verbatim, or a generic one, and `null` while idle. */
  readonly error = signal<string | null>(null);

  /**
   * Whether {@link error} currently reports a failed language switch rather than a sign-in failure.
   *
   * The screen has one error region and two writers, so the region records which of them filled it: a
   * switch that takes effect withdraws the message a failed switch left behind, while a credential
   * failure stays until the next {@link onSubmit} attempt clears it. A plain field is enough, because
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
   * Authenticates with the credentials the form reported, then continues to the interrupted route or
   * `#/clients` (AAP 0.7.4 "navigate to the attempted route or `#/clients`"; AAP 0.10.1 W1).
   *
   * The form has already refused an invalid submission — it marks its controls touched and reports
   * nothing in that case — so what arrives here is a complete pair of typed values, which is the
   * legacy screen's whole rule set (Rule 1 clause 3). The request runs under this screen's
   * `runOnce` guard, so a re-entrant submit within one click reaches the service once (AAP 0.14.1,
   * "one request per click").
   *
   * A refused exchange writes the failure's message into the one error region and asks the form to
   * clear only the credential control, then returns without navigating: the user stays on the form
   * with the account name they typed. A successful one navigates to {@link destination}. The pair is
   * passed straight to `AuthService.login` and is not stored, echoed or logged here (Rule 1 clause 9).
   *
   * @param credentials the two values the form's `(submit)` output carries.
   */
  async onSubmit(credentials: LoginCredentials): Promise<void> {
    await this.guard.runOnce(async (): Promise<void> => {
      // A new attempt starts from a clean region, and what it can write there is a sign-in failure,
      // never a language one: the record of a failed switch is withdrawn with the message it
      // described, so a switch that takes effect afterwards cannot hide this attempt's own message.
      this.error.set(null);
      this.languageFailure = false;

      try {
        await this.auth.login(credentials.username, credentials.password);
      } catch (failure: unknown) {
        const message: string | null = this.describe(failure);

        if (message !== null) {
          this.error.set(message);
        }

        this.loginForm()?.resetPassword();
        return;
      }

      await this.router.navigateByUrl(this.destination());
    });
  }

  /**
   * Withdraws the message a failed language switch left in the error region, once a later switch has
   * taken effect — the login screen's half of the shared switcher's reporting outputs.
   *
   * Only such a message is withdrawn: {@link languageFailure} records which of the region's two
   * writers filled it, so a sign-in failure stays on screen until {@link onSubmit} clears it at the
   * start of the next attempt. The switch itself, its single `TranslateService.use()` and the
   * selector's reconciliation on failure all belong to `LanguageSwitcherComponent`, which is the one
   * place both switchers share.
   */
  onLangChange(): void {
    if (this.languageFailure) {
      this.error.set(null);
      this.languageFailure = false;
    }
  }

  /**
   * Renders a language switch whose bundle could not be loaded, which the shared switcher reports
   * once it has put its selector back on the language in force.
   *
   * This screen owns the application's login-time error region, so the failure is shown there rather
   * than swallowed (AAP 0.14.2): the message is legacy's own connection-failure key, resolved after
   * the selector was written back so it reads in the language the screen still shows. The message is
   * recorded as a language failure ({@link languageFailure}), so a switch that takes effect
   * afterwards withdraws it, while a message reporting a sign-in failure is never withdrawn by a
   * language change. Nothing is logged (Rule 1 clause 9).
   */
  onLangChangeFailed(): void {
    this.error.set(this.translate.instant(GENERIC_FAILURE_KEY));
    this.languageFailure = true;
  }

  /**
   * The destination {@link onSubmit} continues to: the attempted route, or the clients list (AAP 0.7.4
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
   * A failure's text, or `null` when the screen must paint nothing: Fineract's own message for a 4xx,
   * nothing at all for the statuses the interceptor has already reported in its one notification
   * (5xx and a transport fault), and the generic sentence for anything else (AAP 0.7.4; AAP 0.14.2).
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
