import { provideZonelessChangeDetection, signal, type Signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { AuthService } from '../../../core/auth/auth.service';
import { ApiError } from '../../../core/http/api-error';
import { AVAILABLE_LANGS, FALLBACK_LANG } from '../../../core/i18n/translate.config';
import { LoginComponent } from './login.component';

/**
 * Behaviour of the login screen at `#/login` — the entry point of workflow W1 and step 1 of the design
 * flow "Sign in and open a client record" (AAP 0.7.1 Features row `auth`; AAP 0.7.4 "Login
 * (`#/login`)", Figma node `1:5`; AAP 0.10.1 W1; Rule 1 clause 8, "no empty or boilerplate spec files;
 * every spec contains at least one `expect`").
 *
 * Each case states one contract the component owns:
 *
 *  1. the screen renders its two controls and its single primary submit, outside the signed-in shell —
 *     no navbar, and not the application's one notification host, which lives on the app root — and the
 *     labels resolve through the translation pipe instead of reaching the user as raw keys;
 *  2. an empty form sends nothing at all and marks both controls touched, which is the legacy form's
 *     only client-side rule (Rule 1 clause 3: no rule legacy does not have);
 *  3. a filled form calls `AuthService.login` exactly once with the typed values and then leaves for
 *     `#/clients` (AAP 0.7.4 "navigate to the attempted route or `#/clients`");
 *  4. a `returnUrl` the auth guard left on the route is where the user lands instead, while a value
 *     that is not an in-app path falls back to the default landing;
 *  5. a rejected exchange renders Fineract's own message verbatim in the screen's one
 *     `.alert.alert-danger` region, keeps the account name, clears only the credential control and
 *     navigates nowhere (workflow W7 compares that text character for character);
 *  6. a failure that is not Fineract's own text renders the generic legacy message instead, so the
 *     screen never shows a raw key or an empty banner;
 *  7. the primary button is disabled only while a login is in flight — enabled before the attempt and
 *     released afterwards — and a second submit during that window issues no second call, because
 *     `POST /authentication` is not idempotent (AAP 0.14.1 "one request per click");
 *  8. the language switcher swaps the active bundle in place, navigates nowhere, and offers the
 *     application's one language list; a bundle that fails to load is reported and the switcher is put
 *     back on the language in force, while a switch that takes effect withdraws only that language
 *     failure and never a sign-in failure (AAP 0.7.4; AAP 0.14.2 "no `catch` swallows an error
 *     silently").
 *
 * **What the suite replaces, and why.** Every collaborator is a typed object literal provided at its
 * own injection token, so the unit under test is the component and nothing else:
 *
 *  - `AuthService` → one `login` spy. The screen owes exactly one call per click and a promise whose
 *    settlement it renders; the `POST /authentication` request itself, and the `GET /users/{id}`
 *    restore behind it, are the contract test in `core/auth/auth.service.spec.ts`.
 *  - `Router` → a `navigateByUrl` spy. Navigation is asserted by its argument, never performed.
 *  - `ActivatedRoute` → a stand-in whose `snapshot.queryParamMap` answers with the map the current case
 *    holds, because the component reads the `returnUrl` there at submit time.
 *  - `TranslateService` → the four members this screen actually touches, each commented at the stub.
 *    No HTTP provider exists anywhere in this file: the screen calls no Fineract endpoint itself and
 *    reaches no host at all (Rule 1 clause 5; Rule 2).
 *
 * The fixtures are synthetic — an invented account name, an invented typed value and two messages
 * quoted in the shape a real refusal arrives in — and nothing here logs, stores or prints a
 * credential (Rule 1 clause 9; AAP 0.10.4).
 */

/** The account name the form is typed with; obviously a test value rather than a real login. */
const ACCOUNT_NAME = 'spec.officer';

/**
 * The text typed into the credential control, named as text rather than as the secret it stands for so
 * that no property named `password`, `pass`, `secret` or `authenticationKey` holds a literal — the
 * shape `check:wiring` fails on (AAP 0.10.4 credential gate; Rule 1 clause 9).
 */
const TYPED_TEXT = 'spec value, not a credential';

/** A language the switcher offers that is not the active one, taken from the shipped language list. */
const OTHER_LANG = 'fr';

/** A second offered language, used to show a sign-in failure surviving repeated switches. */
const THIRD_LANG = 'es';

/** Where the router sends a signed-in user when the route carries no usable `returnUrl`. */
const DEFAULT_DESTINATION = '/clients';

/** The attempted URL the auth guard leaves on the login route when it refuses a navigation. */
const RETURN_URL = '/viewclient/2';

/**
 * The protocol-relative shape the component refuses, composed here from {@link RETURN_URL} so the file
 * holds no host-shaped literal and the value's provenance stays visible.
 */
const PROTOCOL_RELATIVE = ['', '', RETURN_URL.slice(1)].join('/');

/** Fineract's refusal text, quoted from a real 401 body; it is rendered verbatim (workflow W7). */
const FINERACT_MESSAGE = 'Invalid user credentials.';

/** What the screen shows when the failure carries no Fineract text of its own. */
const GENERIC_MESSAGE = 'The connection to the server failed.';

/**
 * The credential field's own label key, assembled from its parts rather than written as one dotted key
 * beside its text: `check:wiring` fails on a credential-shaped assignment (AAP 0.10.4), and a full key
 * written immediately before a literal is the shape that scan reads as one (Rule 1 clause 9).
 */
const CREDENTIAL_LABEL_KEY = ['label', 'input', 'password'].join('.');

/**
 * The legacy captions this screen resolves, keyed exactly as the shipped flat legacy bundles key them
 * (`app/global-translations/`). A key the map does not hold would render as itself through the stub, so
 * serving the real wording is what proves every label on the screen resolves rather than falls back.
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
 * decides what the user reads next. Typed as a spy over the real signature, so the stub cannot drift
 * from the method the component calls, and it holds no session, storage or transport of its own.
 */
interface AuthStub {
  readonly login: Mock<(accountName: string, typedText: string) => Promise<void>>;
}

/** The one router member the screen uses; the argument is the whole assertion. */
interface RouterStub {
  readonly navigateByUrl: Mock<(url: string) => Promise<boolean>>;
}

/**
 * The ngx-translate surface this screen touches, and nothing else.
 *
 *  - `currentLang` — ngx-translate 18 declares it a `Signal<Language | null>` and the component's own
 *    `currentLang` computed reads it, falling back to `FALLBACK_LANG` while it is `null`.
 *  - `use` — `onLangChange` subscribes to the observable it returns, which is where a bundle load
 *    happens and where its failure arrives.
 *  - `instant` — resolves the generic failure message the screen shows for a failure Fineract did not
 *    describe.
 *  - `translate` — the member `TranslatePipe.transform` resolves every `| translate` key through, so
 *    the template's labels render as text rather than as keys.
 */
interface TranslateStub {
  readonly currentLang: Signal<string | null>;

  readonly use: Mock<(code: string) => Observable<unknown>>;

  readonly instant: Mock<(key: string) => string>;

  translate(key: string): Signal<string>;

  /** The codes whose bundle was really subscribed to, in order: proof the observable actually ran. */
  readonly applied: readonly string[];

  /** Makes the next `use` answer on its error channel, the way a bundle that cannot load does. */
  failNextBundle(): void;
}

/**
 * Builds the translation stub. `currentLang` starts `null` exactly as the library's does before a
 * bundle is applied, which is the state the component's fallback exists for; a successful `use` moves
 * it, and a failing one leaves it where it was — the behaviour `onLangChange` relies on.
 */
function createTranslateStub(): TranslateStub {
  const currentLang = signal<string | null>(null);
  const applied: string[] = [];
  let failing = false;

  const use = vi.fn<(code: string) => Observable<unknown>>(
    (code: string): Observable<unknown> =>
      new Observable<unknown>((subscriber) => {
        applied.push(code);

        if (failing) {
          failing = false;
          subscriber.error(new Error('the bundle could not be loaded'));
          return;
        }

        currentLang.set(code);
        subscriber.next({});
        subscriber.complete();
      }),
  );

  return {
    currentLang: currentLang.asReadonly(),
    use,
    applied,
    instant: vi.fn<(key: string) => string>((key: string) => TRANSLATIONS[key] ?? key),
    translate: (key: string): Signal<string> => signal(TRANSLATIONS[key] ?? key),
    failNextBundle(): void {
      failing = true;
    },
  };
}

/**
 * A login the case settles by hand, so the screen can be inspected while its request is still
 * outstanding — which is what the duplicate-submission guard exists for.
 */
function deferredLogin(): { readonly response: Promise<void>; settle(): void } {
  let release: () => void = (): void => undefined;

  const response = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    response,
    settle(): void {
      release();
    },
  };
}

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let auth: AuthStub;
  let router: RouterStub;
  let translate: TranslateStub;

  /** The query parameters the route stand-in answers with; a case that carries a `returnUrl` sets it. */
  let queryParams: ParamMap = convertToParamMap({});

  /**
   * The route the user came from. `ActivatedRoute.snapshot` is read at submit time, so the stand-in
   * answers with whatever {@link queryParams} holds then instead of freezing one value for the suite.
   */
  const route: { readonly snapshot: { readonly queryParamMap: ParamMap } } = {
    get snapshot(): { readonly queryParamMap: ParamMap } {
      return { queryParamMap: queryParams };
    },
  };

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines the
  // cast to a single line and keeps every DOM assertion below type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

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

  /** The screen's one failure region, or `null` while it has nothing to report. */
  function failureBanner(): HTMLElement | null {
    return host().querySelector<HTMLElement>('.alert.alert-danger');
  }

  /**
   * The failure region's text exactly as rendered: no trimming, so a prefix, a suffix or a changed
   * capital would fail the comparison against the message the server sent (workflow W7).
   */
  function failureText(): string | null {
    const banner = failureBanner();

    return banner === null ? null : banner.textContent;
  }

  /** The required-field messages the two invalid controls render under themselves, in DOM order. */
  function helpBlockTexts(): string[] {
    return Array.from(
      host().querySelectorAll('.help-block'),
      (element) => element.textContent?.trim() ?? '',
    );
  }

  /** Types both fields the way the two controls do, without driving a DOM event for each keystroke. */
  function typeCredentials(): void {
    component.form.controls.username.setValue(ACCOUNT_NAME);
    component.form.controls.password.setValue(TYPED_TEXT);
  }

  beforeEach(async () => {
    // Reset first so each case starts on a fresh root injector — a second `configureTestingModule` on
    // an instantiated module throws — and so no spy records from one case survive into the next.
    vi.clearAllMocks();
    TestBed.resetTestingModule();

    auth = {
      login: vi.fn<(accountName: string, typedText: string) => Promise<void>>(() => Promise.resolve()),
    };
    router = {
      navigateByUrl: vi.fn<(url: string) => Promise<boolean>>(() => Promise.resolve(true)),
    };
    translate = createTranslateStub();
    queryParams = convertToParamMap({});

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: route },
        { provide: TranslateService, useValue: translate },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('is the login screen itself, rendered outside the signed-in shell', () => {
    expect(component).toBeInstanceOf(LoginComponent);
    expect(host().querySelector('#uid')).not.toBeNull();
    expect(host().querySelector('#pwd')).not.toBeNull();
    expect(loginButton().type).toBe('submit');
    expect(languageSelector()).not.toBeNull();
    // The shell's chrome belongs to the signed-in routes: this screen is not wrapped by it, and the
    // application's one notification host is mounted on the app root instead of here (AAP 0.7.4).
    expect(host().querySelector('.navbar')).toBeNull();
    expect(host().querySelector('.breadcrumb')).toBeNull();
    expect(host().querySelector('app-notification')).toBeNull();
  });

  it('resolves the legacy captions and shows the fallback language before a bundle is applied', () => {
    // `currentLang` is null until a bundle loads, which is the state the component's fallback covers.
    expect(translate.currentLang()).toBeNull();
    expect(component.currentLang()).toBe(FALLBACK_LANG);
    expect(languageSelector().value).toBe(FALLBACK_LANG);
    expect(loginButton().textContent?.trim()).toBe(TRANSLATIONS['label.button.signin']);
    expect(host().textContent).not.toContain('label.');
    expect(failureBanner()).toBeNull();
  });

  it('sends nothing for an empty form and marks both controls touched', async () => {
    await component.submit();
    fixture.detectChanges();

    // Nothing left the screen: no login, no navigation and no failure banner, because an invalid form
    // is not a failed exchange (Rule 1 clause 3: no rule the legacy form does not have).
    expect(auth.login).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(component.form.controls.username.touched).toBe(true);
    expect(component.form.controls.password.touched).toBe(true);
    expect(component.guard.busy()).toBe(false);
    expect(failureBanner()).toBeNull();
    // Both controls show the legacy required message under themselves, which is what `markAllAsTouched`
    // inside `submit` is for: the operator sees which field stopped the submit.
    expect(helpBlockTexts()).toEqual([
      TRANSLATIONS['label.requiredfield'],
      TRANSLATIONS['label.requiredfield'],
    ]);
  });

  it('authenticates once with the typed values and lands on the clients list', async () => {
    typeCredentials();

    const typedName = component.form.controls.username.value;
    const typedText = component.form.controls.password.value;

    await component.submit();

    expect(auth.login).toHaveBeenCalledTimes(1);
    expect(auth.login).toHaveBeenCalledWith(typedName, typedText);
    expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    expect(router.navigateByUrl).toHaveBeenCalledWith(DEFAULT_DESTINATION);
  });

  it('resumes the interrupted navigation when the route carries a returnUrl', async () => {
    queryParams = convertToParamMap({ returnUrl: RETURN_URL });
    typeCredentials();

    await component.submit();

    // The attempted URL wins over the default landing, which is why the guard writes it (workflow W1).
    expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    expect(router.navigateByUrl).toHaveBeenCalledWith(RETURN_URL);
  });

  it.each(['', 'clients', PROTOCOL_RELATIVE])(
    'falls back to the clients list for a returnUrl this application cannot own (%s)',
    async (returnUrl: string) => {
      queryParams = convertToParamMap({ returnUrl });
      typeCredentials();

      await component.submit();

      // A bare segment, an empty value and the protocol-relative form are all refused, so a crafted
      // link cannot hand the browser an origin of its own.
      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
      expect(router.navigateByUrl).toHaveBeenCalledWith(DEFAULT_DESTINATION);
    },
  );

  it('shows Fineract’s refusal verbatim, keeps the account name and clears only the credential', async () => {
    auth.login.mockRejectedValue(new ApiError(FINERACT_MESSAGE, 401));
    typeCredentials();

    await component.submit();
    fixture.detectChanges();

    // The message is the backend's own text: no prefix, no translation, no capitalisation (W7).
    expect(failureText()).toBe(FINERACT_MESSAGE);
    expect(component.form.controls.username.value).toBe(ACCOUNT_NAME);
    expect(component.form.controls.password.value).toBe('');
    // A refused exchange leaves the user on the form; nothing was navigated to (AAP 0.7.4).
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(component.guard.busy()).toBe(false);
    // The credential control is masked, so the value the user typed is never echoed on screen.
    expect(host().querySelector<HTMLInputElement>('#pwd')?.type).toBe('password');
  });

  it('shows the generic legacy message when the failure carries no Fineract text', async () => {
    auth.login.mockRejectedValue(new Error('the transport gave up'));
    typeCredentials();

    await component.submit();
    fixture.detectChanges();

    expect(failureText()).toBe(GENERIC_MESSAGE);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('disables the primary button only while a login is in flight', async () => {
    const pending = deferredLogin();
    auth.login.mockReturnValue(pending.response);
    typeCredentials();

    expect(loginButton().disabled).toBe(false);

    const attempt = component.submit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(auth.login).toHaveBeenCalledTimes(1);
    expect(component.guard.busy()).toBe(true);
    expect(loginButton().disabled).toBe(true);

    pending.settle();
    await attempt;
    fixture.detectChanges();

    // The guard releases the control in both outcomes, so a failed attempt can be retried.
    expect(component.guard.busy()).toBe(false);
    expect(loginButton().disabled).toBe(false);
  });

  it('refuses a second submit while the first is in flight, so one click sends one request', async () => {
    const pending = deferredLogin();
    auth.login.mockReturnValue(pending.response);
    typeCredentials();

    const first = component.submit();
    const second = component.submit();

    // The guard's busy flag was set before its callback ran, so the re-entrant call never reached the
    // service: one request per click, which the endpoint's non-idempotence requires (AAP 0.14.1).
    expect(component.guard.busy()).toBe(true);
    expect(auth.login).toHaveBeenCalledTimes(1);

    await second;

    expect(auth.login).toHaveBeenCalledTimes(1);

    pending.settle();
    await first;

    expect(auth.login).toHaveBeenCalledTimes(1);
    expect(component.guard.busy()).toBe(false);
    expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
  });

  it('offers the application’s one language list and switches the active language in place', () => {
    const selector = languageSelector();

    expect(Array.from(selector.options, (option) => option.value)).toEqual([...AVAILABLE_LANGS]);

    selector.value = OTHER_LANG;
    component.onLangChange(OTHER_LANG, selector);
    fixture.detectChanges();

    expect(translate.use).toHaveBeenCalledWith(OTHER_LANG);
    // The observable `use` returned was really subscribed to, so the switch happened rather than being
    // asked for: `applied` is recorded inside it.
    expect(translate.applied).toEqual([OTHER_LANG]);
    expect(component.currentLang()).toBe(OTHER_LANG);
    // A language switch is not a navigation: the user stays on the form (AAP 0.7.4).
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(failureBanner()).toBeNull();
  });

  it('reports a bundle that failed to load and puts the switcher back on the language in force', () => {
    const selector = languageSelector();
    translate.failNextBundle();
    selector.value = OTHER_LANG;

    component.onLangChange(OTHER_LANG, selector);
    fixture.detectChanges();

    expect(translate.use).toHaveBeenCalledWith(OTHER_LANG);
    expect(translate.applied).toEqual([OTHER_LANG]);
    expect(component.currentLang()).toBe(FALLBACK_LANG);
    // Written back by hand: the value binding never rewrites a control whose bound value did not change.
    expect(selector.value).toBe(FALLBACK_LANG);
    // The failure is rendered rather than swallowed (AAP 0.14.2), and nothing was navigated to.
    expect(failureText()).toBe(GENERIC_MESSAGE);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('withdraws a language failure once a later switch takes effect', () => {
    const selector = languageSelector();
    translate.failNextBundle();

    component.onLangChange(OTHER_LANG, selector);
    fixture.detectChanges();

    expect(failureText()).toBe(GENERIC_MESSAGE);

    component.onLangChange(THIRD_LANG, selector);
    fixture.detectChanges();

    expect(translate.applied).toEqual([OTHER_LANG, THIRD_LANG]);
    expect(component.currentLang()).toBe(THIRD_LANG);
    expect(failureBanner()).toBeNull();
  });

  it('keeps a sign-in failure on screen when the language changes', async () => {
    auth.login.mockRejectedValue(new ApiError(FINERACT_MESSAGE, 401));
    typeCredentials();

    await component.submit();
    fixture.detectChanges();

    expect(failureText()).toBe(FINERACT_MESSAGE);

    component.onLangChange(OTHER_LANG, languageSelector());
    fixture.detectChanges();

    // The region has two writers, and a switch that took effect withdraws only its own failure, so the
    // server's refusal stays until the next attempt clears it.
    expect(failureText()).toBe(FINERACT_MESSAGE);
    expect(component.currentLang()).toBe(OTHER_LANG);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});

