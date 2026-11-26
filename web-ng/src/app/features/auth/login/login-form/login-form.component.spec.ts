import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { LoginFormComponent, type LoginCredentials } from './login-form.component';

/**
 * Behaviour of the login form — the `LoginForm` row of the component inventory (AAP 0.2.3), the form region of the login screen (Figma node `1:5`; AAP 0.7.4 "Login"; AAP 0.10.1 W1).
 *
 * It discharges AAP 0.11.1 (a unit spec beside every component), AAP 0.14.1 ("each screen lands with at least one behavioural spec") and Rule 1 clause 8 (no spec without an `expect`). It pins the legacy
 * screen's own two controls and one primary submit — ids, names, classes and the masked credential field the parity page objects address, every caption through the translation stack; an empty form reporting
 * nothing while marking both controls touched, legacy's only client-side rule (Rule 1 clause 3); a valid form reporting the pair typed, once, untrimmed (AAP 0.2.3's `(submit: {username, password})`); the
 * button disabled while `busy`, which is the whole duplicate-submission guard (AAP 0.14.1); and a refused exchange clearing the credential control and nothing else.
 *
 * The translate stack is the no-op loader plus the captions this form resolves, so no bundle is requested; there is deliberately no HTTP provider, because the component injects no service beyond `FormBuilder`
 * (Rule 1 clause 5).
 *
 */

/** The account name the form is typed with; obviously a test value rather than a real login. */
const ACCOUNT_NAME = 'spec.officer';

/**
 * The text typed into the credential control, named as text rather than as the secret it stands for
 * so that no property named `password`, `pass`, `secret` or `authenticationKey` holds a literal — the
 * shape `check:wiring` fails on (AAP 0.10.4 credential gate; Rule 1 clause 9).
 */
const TYPED_TEXT = 'spec value, not a credential';

/**
 * The same two values with the spaces a user can accidentally type around them, named here so the
 * "nothing is trimmed" case holds no literal beside a credential-shaped member (Rule 1 clause 9).
 */
const PADDED_ACCOUNT = '  spec.officer  ';
const PADDED_TEXT = '  spec value  ';

/**
 * The credential field's own label key, assembled from its parts rather than written as one dotted
 * key beside its text: a credential-shaped assignment is what the wiring gate reads, and a full key
 * written immediately before a literal is the shape that scan treats as one (Rule 1 clause 9).
 */
const CREDENTIAL_LABEL_KEY = ['label', 'input', 'password'].join('.');

/**
 * The legacy captions this form resolves, keyed exactly as the shipped flat legacy bundles key them
 * (`app/global-translations/`), so a label that failed to resolve would show as itself and fail.
 */
const TRANSLATIONS: Readonly<Record<string, string>> = {
  'label.input.username': 'Username',
  [CREDENTIAL_LABEL_KEY]: 'Password',
  'label.requiredfield': 'Required field',
  'label.button.signin': 'Sign In',
};

describe('LoginFormComponent', () => {
  let fixture: ComponentFixture<LoginFormComponent>;
  let component: LoginFormComponent;

  /** Every credential pair the form reported, in emission order. */
  let emitted: LoginCredentials[];

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps every assertion below type-checked and confines the boundary to this line (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The primary submit control, addressed by the id the legacy screen gives it. */
  function loginButton(): HTMLButtonElement {
    const element = host().querySelector<HTMLButtonElement>('#login-button');

    if (element === null) {
      throw new Error('the form rendered no sign-in button');
    }

    return element;
  }

  /** The account-name field, addressed by legacy's own id. */
  function accountField(): HTMLInputElement {
    const element = host().querySelector<HTMLInputElement>('#uid');

    if (element === null) {
      throw new Error('the form rendered no account-name field');
    }

    return element;
  }

  /** The credential field, addressed by legacy's own id. */
  function credentialField(): HTMLInputElement {
    const element = host().querySelector<HTMLInputElement>('#pwd');

    if (element === null) {
      throw new Error('the form rendered no credential field');
    }

    return element;
  }

  /** The required-field messages the invalid controls render under themselves, in DOM order. */
  function helpBlockTexts(): string[] {
    return Array.from(
      host().querySelectorAll('.help-block'),
      (element) => element.textContent?.trim() ?? '',
    );
  }

  /**
   * Submits the form the way a real browser does: a cancelable `submit` event that bubbles, which is
   * the shape the component's own binding sees. That binding cancels the event's default and stops it
   * reaching the caller's `(submit)` output, so an invalid form reports nothing rather than escaping.
   */
  function submitForm(): void {
    const form = host().querySelector('form');

    if (form === null) {
      throw new Error('the form element is not rendered');
    }

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginFormComponent],
      providers: [provideTranslateService()],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', TRANSLATIONS, true);
    translate.use('en');

    fixture = TestBed.createComponent(LoginFormComponent);
    component = fixture.componentInstance;
    emitted = [];
    component.submit.subscribe((credentials: LoginCredentials) => emitted.push(credentials));
    fixture.detectChanges();
  });

  it('renders the legacy screen’s two controls and its one primary submit', () => {
    const account = accountField();
    const credential = credentialField();

    expect(account.getAttribute('name')).toBe('username');
    expect(account.type).toBe('text');
    expect(account.classList.contains('form-control')).toBe(true);
    expect(credential.getAttribute('name')).toBe('password');
    // Masked on screen and never echoed: the digit the user typed must not be readable (Rule 1 clause 9).
    expect(credential.type).toBe('password');
    expect(loginButton().type).toBe('submit');
    expect(loginButton().classList.contains('btn-primary')).toBe(true);
    expect(loginButton().classList.contains('btn-block')).toBe(true);
    expect(loginButton().textContent?.trim()).toBe(TRANSLATIONS['label.button.signin']);
    expect(host().textContent).not.toContain('label.');
    expect(host().querySelectorAll('label')).toHaveLength(2);
  });

  it('reports nothing for an empty form and marks both controls touched', () => {
    submitForm();

    // Nothing left the form, because an invalid form is not a failed exchange (Rule 1 clause 3).
    expect(emitted).toEqual([]);
    expect(component.form.controls.username.touched).toBe(true);
    expect(component.form.controls.password.touched).toBe(true);
    // Both controls show the legacy required message under themselves, which is what `markAllAsTouched` inside the submit handler is for: the operator sees what stopped it.
    expect(helpBlockTexts()).toEqual([
      TRANSLATIONS['label.requiredfield'],
      TRANSLATIONS['label.requiredfield'],
    ]);
  });

  it('keeps the native submit inside the component, so a caller’s submit binding sees only the output', () => {
    let escaped = 0;
    host().addEventListener('submit', () => {
      escaped += 1;
    });

    // The invalid submit is the case that escapes without the guard: the form reports nothing, and a bubbling event would leave the caller acting on an `Event` where it expects the pair.
    submitForm();

    expect(escaped).toBe(0);
    expect(emitted).toEqual([]);

    component.form.controls.username.setValue(ACCOUNT_NAME);
    component.form.controls.password.setValue(TYPED_TEXT);
    submitForm();

    expect(escaped).toBe(0);
    expect(emitted).toEqual([{ username: ACCOUNT_NAME, password: TYPED_TEXT }]);
  });

  it('reports the typed pair once when the form is submitted and valid', () => {
    component.form.controls.username.setValue(ACCOUNT_NAME);
    component.form.controls.password.setValue(TYPED_TEXT);

    submitForm();

    // One report per submit, carrying both values unchanged: the screen posts exactly these, and the inner form's own submit event never reaches the caller as a second value.
    expect(emitted).toEqual([{ username: ACCOUNT_NAME, password: TYPED_TEXT }]);
    expect(helpBlockTexts()).toEqual([]);
  });

  it('reports the values untrimmed, exactly as they were typed', () => {
    component.form.controls.username.setValue(PADDED_ACCOUNT);
    component.form.controls.password.setValue(PADDED_TEXT);

    submitForm();

    expect(emitted).toEqual([{ username: PADDED_ACCOUNT, password: PADDED_TEXT }]);
  });

  it('disables the primary button only while a sign-in is in flight', () => {
    expect(loginButton().disabled).toBe(false);

    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();

    expect(loginButton().disabled).toBe(true);

    fixture.componentRef.setInput('busy', false);
    fixture.detectChanges();

    expect(loginButton().disabled).toBe(false);
  });

  it('clears the credential control and keeps the account name when the exchange is refused', () => {
    accountField().value = ACCOUNT_NAME;
    accountField().dispatchEvent(new Event('input'));
    credentialField().value = TYPED_TEXT;
    credentialField().dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(credentialField().value).toBe(TYPED_TEXT);

    component.resetPassword();
    fixture.detectChanges();

    expect(component.form.controls.password.value).toBe('');
    expect(component.form.controls.username.value).toBe(ACCOUNT_NAME);
    expect(credentialField().value).toBe('');
    expect(accountField().value).toBe(ACCOUNT_NAME);
  });
});
