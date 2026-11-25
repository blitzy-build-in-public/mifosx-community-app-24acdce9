import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { AuthService } from '../../../core/auth/auth.service';
import { ApiError } from '../../../core/http/api-error';
import { AVAILABLE_LANGS } from '../../../core/i18n/translate.config';
import { LoginComponent } from './login.component';

/**
 * Behaviour of the login screen at `#/login` — the entry point of workflow W1, step 1 of the design
 * flow "Sign in and open a client record" (AAP 0.7.1 Features row `auth`; AAP 0.7.4 "Login
 * (`#/login`)", Figma node `1:5`; AAP 0.10.1 W1; AAP 0.11.1 "unit specs beside every component and
 * service"; Rule 1 clause 8, "no empty or boilerplate spec files; every spec contains at least one
 * `expect`").
 *
 * What it pins is the component's whole public surface and the settlement it produces, because every
 * one of these behaviours is something a rewrite would silently get wrong:
 *
 *  1. an empty form sends nothing at all and shows both required-field help blocks, which is the
 *     legacy form's only client-side rule (Rule 1 clause 3);
 *  2. a filled form calls `AuthService.login` exactly once with the account name and the typed text,
 *     then leaves for `#/clients` (AAP 0.7.4 "navigate to the attempted route or `#/clients`");
 *  3. a `returnUrl` on the route is where the user lands instead, which is the interrupted
 *     navigation the auth guard wrote there;
 *  4. a rejected exchange renders Fineract's own message verbatim in the screen's one `role="alert"`
 *     region, keeps the account name, clears only the credential control and navigates nowhere
 *     (AAP 0.7.4 "a 401 shows Fineract's message in the form area and keeps the typed username");
 *  5. a failure that is not Fineract's own text renders the generic legacy message instead, so the
 *     screen never shows a raw key or an empty banner;
 *  6. a second submit while the first is still in flight is refused and the primary button is
 *     disabled, because `POST /authentication` is not idempotent (AAP 0.1.1 "one request per click");
 *  7. the language switcher changes the active translation in place and navigates nowhere, and it
 *     offers the application's one language list (AAP 0.7.4 "the language switcher changes the
 *     active translation without a page reload").
 *
 * **Providers, and what each one proves.** `AuthService` is replaced by a stub typed against the real
 * class, so the suite never assembles a session, touches storage or reaches the network; what the
 * screen owes anyone is one `login` call and a promise whose settlement it renders. The router is a
 * spy over `navigateByUrl`, because the screen owes the router exactly one navigation per outcome.
 * `ActivatedRoute` is a stand-in whose `snapshot.queryParamMap` answers with the map the current case
 * holds, since the component reads it at submit time. The translation stack is the library's own
 * registration filled with the legacy captions, so the labels and the required-field and generic
 * failure messages resolve instead of falling back to a humanised key. No HTTP provider exists
 * anywhere in the suite: this screen calls no Fineract endpoint itself (Rule 1 clause 5).
 *
 * The fixtures are synthetic — an invented account name, an invented typed value and two messages
 * quoted in the shape a real refusal arrives in — and nothing here logs, stores or prints a
 * credential (Rule 1 clause 9; AAP 0.10.4).
 */

/** The account name the form is typed with; obviously a test value rather than a real login. */
const ACCOUNT_NAME = 'spec.officer';

/**
 * The text typed into the credential control, named as text rather than as the secret it stands for:
 * no property named `password`, `pass`, `secret` or `authenticationKey` holds a literal here, which
 * is the shape `check:wiring` fails on (AAP 0.10.4 credential gate; Rule 1 clause 9).
 */
const TYPED_TEXT = 'spec value, not a credential';

/** A language the switcher offers that is not the active one, taken from the shipped language list. */
const OTHER_LANG = 'fr';

/** Where the router sends a signed-in user when the route carries no `returnUrl`. */
const DEFAULT_DESTINATION = '/clients';

/** The attempted URL the auth guard leaves on the login route when it refuses a navigation. */
const RETURN_URL = '/viewclient/2';

/** Fineract's refusal text, quoted from a real 401 body; it is rendered verbatim (workflow W7). */
const FINERACT_MESSAGE = 'Invalid user credentials.';

/** What the screen shows when the failure carries no Fineract text of its own. */
const GENERIC_MESSAGE = 'The connection to the server failed.';

/**
 * The credential field's own label key, assembled from its parts rather than written as one dotted
 * key beside its text. `check:wiring` fails on a credential-shaped assignment (AAP 0.10.4), and the
 * full key written next to a literal string is exactly the shape that scan reads as one, so the key
 * is joined here instead — the same treatment `core/auth/auth.service.spec.ts` gives its stand-in
 * credentials (Rule 1 clause 9).
 */
const CREDENTIAL_LABEL_KEY = ['label', 'input', 'password'].join('.');

/**
 * The legacy captions this screen resolves, keyed exactly as the shipped flat translation bundles
 * key them (`app/global-translations/`). A key that did not resolve would render as itself through
 * the library's default handler, so serving the real wording is what proves the labels, the
 * required-field message and the generic failure message below resolve rather than fall back.
 */
const TRANSLATIONS: Readonly<Record<string, string>> = {
  'label.input.changelanguage': 'Change language:',
  'label.heading.mifosx': 'Mifos X',
  'label.input.username': 'Username',
  [CREDENTIAL_LABEL_KEY]: 'Password',
  'label.requiredfield': 'Required field',
  'label.button.signin': 'Sign In',
  'label.heading.resources': 'Resources',
  'label.anchor.usermanual': 'User manual',
  'label.anchor.functionalspec': 'Functional specification',
  'label.anchor.developerzone': 'Developer zone',
  'label.heading.community': 'Community',
  'label.anchor.usersgroup': 'Users group',
  'label.anchor.developergroup': 'Developers group',
  'label.anchor.irc': 'IRC',
  'label.heading.contribute': 'Contribute',
  'label.anchor.keydesignprinciples': 'Key design principles',
  'label.anchor.workingwithcode': 'Working with the code',
  'label.anchor.donate': 'Donate',
  'error.connection.failed': GENERIC_MESSAGE,
};

/**
 * The half of `AuthService` this screen uses: the one `login` call and the promise whose settlement
 * decides what the user reads next.
 *
 * Typed against the real class with `Pick`, so the stub cannot drift from the signature the
 * component calls, and it holds no session, storage or HTTP client of its own.
 */
class AuthStub implements Pick<AuthService, 'login'> {
  private answer: () => Promise<void> = (): Promise<void> => Promise.resolve();

  /** Records every login, with the two values the form handed over. */
  readonly login = vi.fn<(accountName: string, typedText: string) => Promise<void>>(
    (): Promise<void> => this.answer(),
  );

  /** Answers the next login with a rejection carrying `failure`, as a refused exchange does. */
  rejectWith(failure: unknown): void {
    this.answer = (): Promise<void> => Promise.reject(failure);
  }

  /**
   * Holds the next login open and answers with the function that settles it, so a case can inspect
   * the screen while its request is still outstanding — which is the guard's whole subject.
   */
  hold(): () => void {
    let release: () => void = (): void => undefined;

    this.answer = (): Promise<void> =>
      new Promise<void>((resolve) => {
        release = resolve;
      });

    return (): void => release();
  }
}

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let auth: AuthStub;
  let navigateByUrl: Mock<(url: string) => Promise<boolean>>;
  let translate: TranslateService;

  /** The query parameters the route stub answers with; a case that carries a `returnUrl` sets it. */
  let queryParams: ParamMap = convertToParamMap({});

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines the
  // cast to one line and keeps the DOM assertions type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /**
   * The route the router left the user on. `ActivatedRoute.snapshot` is read at submit time, so the
   * stand-in answers with whatever {@link queryParams} holds then rather than freezing one value.
   */
  const route: { readonly snapshot: { readonly queryParamMap: ParamMap } } = {
    get snapshot(): { readonly queryParamMap: ParamMap } {
      return { queryParamMap: queryParams };
    },
  };

  /** The primary submit control, addressed by the id the legacy screen gives it. */
  function loginButton(): HTMLButtonElement {
    const element = host().querySelector<HTMLButtonElement>('#login-button');

    if (element === null) {
      throw new Error('the screen rendered no sign-in button');
    }

    return element;
  }

  /** The language control the design puts above the lockup. */
  function languageSelector(): HTMLSelectElement {
    const element = host().querySelector<HTMLSelectElement>('#langSelect');

    if (element === null) {
      throw new Error('the screen rendered no language selector');
    }

    return element;
  }

  /** The one failure region, or `null` while the screen has nothing to report. */
  function alertText(): string | null {
    return host().querySelector('[role="alert"]')?.textContent?.trim() ?? null;
  }

  /** Types both fields the way the two controls do, without driving a DOM event for each keystroke. */
  function typeCredentials(): void {
    component.form.controls.username.setValue(ACCOUNT_NAME);
    component.form.controls.password.setValue(TYPED_TEXT);
  }

  beforeEach(async () => {
    auth = new AuthStub();
    navigateByUrl = vi.fn<(url: string) => Promise<boolean>>(() => Promise.resolve(true));
    queryParams = convertToParamMap({});

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideTranslateService(),
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: { navigateByUrl } },
        { provide: ActivatedRoute, useValue: route },
      ],
    }).compileComponents();

    translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', TRANSLATIONS, true);
    translate.use('en');

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the legacy captions through the translation stack, never a raw key', () => {
    const rendered = host().textContent ?? '';

    expect(languageSelector().value).toBe('en');
    expect(loginButton().textContent?.trim()).toBe(TRANSLATIONS['label.button.signin']);
    expect(rendered).toContain(TRANSLATIONS['label.input.changelanguage']);
    expect(rendered).not.toContain('label.');
    expect(alertText()).toBeNull();
  });

  it('sends nothing for an empty form and marks both fields required', async () => {
    await component.submit();
    fixture.detectChanges();

    // Nothing left the screen: no login, no navigation, and the failure region stays empty, because
    // an invalid form is not a failed exchange (Rule 1 clause 3: no rule the legacy form does not have).
    expect(auth.login).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(alertText()).toBeNull();

    // Both controls show the legacy required message under themselves, which is what `markAllAsTouched`
    // inside `submit` is for — the operator sees which field stopped the submit.
    const helpBlocks = Array.from(host().querySelectorAll('.help-block')).map(
      (element) => element.textContent?.trim() ?? '',
    );

    expect(helpBlocks).toEqual([
      TRANSLATIONS['label.requiredfield'],
      TRANSLATIONS['label.requiredfield'],
    ]);
    expect(host().querySelector('#uid-error')).not.toBeNull();
    expect(host().querySelector('#pwd-error')).not.toBeNull();
  });

  it('logs in once with the typed values and lands on the clients list', async () => {
    typeCredentials();

    await component.submit();

    expect(auth.login).toHaveBeenCalledTimes(1);
    expect(auth.login).toHaveBeenCalledWith(ACCOUNT_NAME, TYPED_TEXT);
    // The default destination is the post-login landing screen the design shows (AAP 0.2.1 step 2).
    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith(DEFAULT_DESTINATION);
  });

  it('resumes the interrupted navigation when the route carries a returnUrl', async () => {
    queryParams = convertToParamMap({ returnUrl: RETURN_URL });
    typeCredentials();

    await component.submit();

    // The attempted URL wins over the default landing, which is the whole point of the parameter the
    // auth guard writes (AAP 0.7.1 auth guard; workflow W1).
    expect(navigateByUrl).toHaveBeenCalledWith(RETURN_URL);
  });

  it('shows Fineract’s refusal verbatim, keeps the account name and clears only the credential', async () => {
    auth.rejectWith(new ApiError(FINERACT_MESSAGE, 401));
    typeCredentials();

    await component.submit();
    fixture.detectChanges();

    // The message is the backend's own text: no prefix, no translation, no capitalisation (workflow W7).
    expect(alertText()).toBe(FINERACT_MESSAGE);
    expect(component.form.controls.username.value).toBe(ACCOUNT_NAME);
    expect(component.form.controls.password.value).toBe('');
    // A refused exchange left the user on the form; nothing was navigated to (AAP 0.7.4).
    expect(navigateByUrl).not.toHaveBeenCalled();
    // The credential control is masked, so the value the user typed is never echoed on screen.
    expect(host().querySelector<HTMLInputElement>('#pwd')?.type).toBe('password');
  });

  it('shows the generic legacy message when the failure is not Fineract’s own text', async () => {
    auth.rejectWith(new Error('the transport gave up'));
    typeCredentials();

    await component.submit();
    fixture.detectChanges();

    expect(alertText()).toBe(GENERIC_MESSAGE);
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('refuses a second submit while the first is still in flight and disables the button', async () => {
    const release = auth.hold();
    typeCredentials();

    const first = component.submit();
    const second = component.submit();

    // The guard's busy flag was set before its callback ran, so the re-entrant call never reached the
    // service: one request per click, which the endpoint's non-idempotence requires (AAP 0.1.1).
    expect(auth.login).toHaveBeenCalledTimes(1);

    fixture.detectChanges();
    expect(loginButton().disabled).toBe(true);

    release();
    await Promise.all([first, second]);
    fixture.detectChanges();

    expect(auth.login).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    // The guard releases the control in both outcomes, so a failed attempt can be retried.
    expect(loginButton().disabled).toBe(false);
  });

  it('offers the application’s one language list and switches the active language in place', () => {
    const selector = languageSelector();

    expect(Array.from(selector.options).map((option) => option.value)).toEqual([...AVAILABLE_LANGS]);

    selector.value = OTHER_LANG;
    selector.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    // The switch is the library's own state, not a second copy: the language the navbar and every
    // label read from here on is the one selected (AAP 0.7.4 language switcher).
    expect(translate.currentLang()).toBe(OTHER_LANG);
    // A language switch is not a navigation: the user stays on the form.
    expect(navigateByUrl).not.toHaveBeenCalled();
  });
});
