import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * The pair of credentials the form reports when it is submitted — AAP 0.2.3's `LoginForm` prop
 * `(submit: {username, password})`.
 *
 * The values are exactly what the user typed: nothing is trimmed, trimmed twice or otherwise
 * normalised on the way out, because legacy's form posted its two field values as they stood and a
 * credential is not something this migration may decide to tidy (Rule 1 clause 3). The pair is
 * handed to the screen, which owns the request; this component never authenticates anything itself.
 */
export interface LoginCredentials {
  /** The account name as typed, which is the `username` field of `POST /authentication`. */
  readonly username: string;

  /**
   * The secret as typed, which is the second field of `POST /authentication`. It is passed straight
   * to the caller and never logged, stored, echoed or compared here (Rule 1 clause 9).
   */
  readonly password: string;
}

/**
 * The login screen's form: the `LoginForm` row of the component inventory (AAP 0.2.3), the two
 * labelled fields and the full-width primary button of Figma node `1:5` in the "Sign in and open a
 * client record" flow (AAP 0.7.4 "Login", AAP 0.10.1 W1).
 *
 * **It owns the form, the screen owns the request.** The typed non-nullable reactive form lives
 * here — `Validators.required` on both controls is the whole rule legacy states, and no client-side
 * rule legacy does not have is added (Rule 1 clause 3) — and submission is reported through
 * {@link submit}, never performed: `AuthService.login`, the router and the error region belong to
 * `LoginComponent`, which is the only place a credential reaches the transport. This component
 * injects no service other than `FormBuilder`, so it cannot issue a request (Rule 1 clause 5).
 *
 * **It renders the legacy markup unchanged.** Every id, `name`, class, placeholder, `aria-*`
 * binding and `.help-block` the parity page objects address — `uid`, `pwd`, `name="username"`,
 * `name="password"`, `login-button` — is the legacy screen's own (`app/index.html`), so the harness
 * drives the same controls on both applications. The `[disabled]` state of the button is
 * {@link busy}, which the screen drives from its submit guard: `POST /authentication` is not
 * idempotent, so one click must send one request (AAP 0.14.1 "one request per click").
 *
 * **It carries no CSS.** The uppercase 600 labels, the 34px `.form-control` fields with their 1px
 * `#E0E0E0` border and 2px radius, the `.alert`-free invalid treatment through `.has-error`/
 * `.help-block` and the brand-blue `.btn.btn-primary.btn-block` button are the global Bootstrap 3
 * layer compiled in `web-ng/src/styles.scss` (AAP 0.2.3's `LoginForm` visual specification, AAP
 * 0.5.2, Rule 1 clause 6), so this component declares no stylesheet, no colour and no dimension.
 *
 * **Nothing is logged.** The form holds the typed credential so the screen can post it; no value is
 * written to the console, a log or the DOM, and the credential field stays `type="password"`, so
 * what the user typed is never echoed on screen (Rule 1 clause 9).
 */
@Component({
  selector: 'app-login-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, TranslatePipe],
  templateUrl: './login-form.component.html',
})
export class LoginFormComponent {
  /**
   * The two credentials, and `Validators.required` is the whole rule legacy states (Rule 1 clause
   * 3). Non-nullable, so an emptied field is the empty string and {@link submitForm} has one shape
   * to read.
   */
  readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  /**
   * Whether a sign-in is in flight, which disables the primary button.
   *
   * The request belongs to the screen — it owns `AuthService` and its `runOnce` guard — so the form
   * renders the state it is given rather than keeping a copy. It defaults to `false`, the idle form
   * the design shows.
   */
  readonly busy = input<boolean>(false);

  /**
   * Reports the two typed credentials when the form is submitted and valid — AAP 0.2.3's
   * `(submit: {username, password})`.
   *
   * The name is fixed by the inventory row, and `submit` is also the name of a native DOM event,
   * which is what `no-output-native` warns about: a caller binds this output on the element that
   * hosts the component, and a native `submit` bubbling out of the inner form would reach that same
   * binding with an `Event` in place of the credential pair. {@link onNativeSubmit} is what keeps the
   * event inside this component, so the pair below is the only value a caller can ever receive.
   */
  readonly submit = output<LoginCredentials>(); // eslint-disable-line @angular-eslint/no-output-native -- name fixed by the AAP 0.2.3 inventory

  /**
   * Handles the inner form's native submit: cancels the browser's own navigation, keeps the event
   * from bubbling to the element the caller binds `(submit)` on, and then reports what the form
   * holds.
   *
   * `stopPropagation` is load-bearing rather than decorative. The output above carries the
   * inventory's name `submit`, which is also the native event's name, so without this the browser's
   * own submission would arrive at the caller's binding as an `Event` — observed on the running
   * application as an empty credential pair being posted when an invalid form was submitted. Keeping
   * the event here is what makes the output the single, typed way a submission leaves the form.
   *
   * @param event the form's native submit event.
   */
  onNativeSubmit(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.submitForm();
  }

  /**
   * Handles the form's own submit: every control is marked touched, so an invalid field shows the
   * legacy required message under itself, and a form that is still invalid reports nothing.
   *
   * A valid form is reported as the pair the user typed, untrimmed (see {@link LoginCredentials}).
   * Nothing is sent, nothing is navigated to and no second copy of the values is kept: the screen
   * that receives the pair runs the request and owns the duplicate-submission guard.
   */
  submitForm(): void {
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      return;
    }

    this.submit.emit(this.form.getRawValue());
  }

  /**
   * Clears the credential control and nothing else, which is what the login screen does when the
   * exchange is refused (AAP 0.7.4; workflow W7 compares the behaviour).
   *
   * The account name stays on screen so the operator can see which name was refused and retry it,
   * and the credential has to be retyped because the server did not accept it. Legacy's
   * `loginController` emptied the same field and kept the same one. The screen calls this, because
   * only it knows the exchange failed; the form itself has no error of its own.
   */
  resetPassword(): void {
    this.form.controls.password.reset('');
  }
}
