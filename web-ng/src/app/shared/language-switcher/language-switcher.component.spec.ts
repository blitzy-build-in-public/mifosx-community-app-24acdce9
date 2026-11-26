import { signal, type Signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  LanguagePreferenceService,
  languagePreferenceKey,
} from '../../core/i18n/language-preference.service';
import { LanguageSwitcherComponent } from './language-switcher.component';

/**
 * Behaviour of the language switcher — the `LanguageSwitcher` row of the component inventory (AAP 0.2.3),
 * the login screen's row (Figma node `1:5`) and the navbar's (node `1:3`).
 *
 * It discharges AAP 0.11.1 (a unit spec beside every component), AAP 0.14.1 ("each screen lands with at
 * least one behavioural spec") and Rule 1 clause 8 (no spec without an `expect`). It pins the caller's label
 * and id with every offered language in the application's order, the language actually in force, one
 * `TranslateService.use()` per change reported only once the switch took effect, a bundle that cannot load
 * reported rather than swallowed with the select written back to the language in force (AAP 0.14.2), a blank
 * selection switching and reporting nothing, no colour or dimension of its own (AAP 0.2.3, Rule 1 clause 6),
 * and the choice remembered in the legacy `ls.Language` entry as the switch is made
 * (`app/scripts/controllers/main/MainController.js:343-345`; Rule 1 clause 3).
 *
 * The translate stack is a typed stand-in for the four members this component and `TranslatePipe` touch, so
 * a case can make one load fail; no HTTP provider exists, because the component reaches no host itself
 * (Rule 1 clause 5).
 */

/** The offered languages, standing in for `AVAILABLE_LANGS`. */
const LANGS: readonly string[] = ['en', 'fr', 'es'];

/** The language every fixture starts on. */
const ACTIVE = 'en';

/** The offered language a case switches to. */
const OTHER_LANG = 'fr';

/** The navbar's label key, which is the component's default. */
const NAVBAR_LABEL_KEY = 'label.heading.language';

/** The login screen's label key — legacy's own wording for the same row. */
const LOGIN_LABEL_KEY = 'label.input.changelanguage';

/** The login screen's select id, legacy's `langSelect`. */
const LOGIN_SELECT_ID = 'langSelect';

/**
 * Stand-in for the shipped bundles: one distinct value per key, so an assertion can tell which key
 * produced which text and can never pass on a raw dotted key. Test input only — it adds no locale
 * file and reproduces no shipped translation text (Rule 1 clause 6).
 */
const TRANSLATIONS: Readonly<Record<string, string>> = {
  [NAVBAR_LABEL_KEY]: 'Language',
  [LOGIN_LABEL_KEY]: 'Change language:',
};

/**
 * The ngx-translate surface this component and `TranslatePipe` use:
 *
 *  - `currentLang` — ngx-translate 18 declares it a `Signal<Language | null>`, `null` until a bundle
 *    is applied; a successful `use` moves it and a failing one leaves it where it was.
 *  - `use` — the load a change performs; subscribing to what it returns is what really switches.
 *  - `translate` — the member `TranslatePipe.transform` resolves the label key through.
 */
interface TranslateStub {
  readonly currentLang: Signal<string | null>;

  readonly use: Mock<(code: string) => Observable<unknown>>;

  translate(key: string): Signal<string>;

  /** The codes whose bundle was really subscribed to, in order: proof the observable actually ran. */
  readonly applied: readonly string[];

  /** Makes the next `use` answer on its error channel, the way a bundle that cannot load does. */
  failNextBundle(): void;
}

function createTranslateStub(): TranslateStub {
  const currentLang = signal<string | null>(ACTIVE);
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
    translate: (key: string): Signal<string> => signal(TRANSLATIONS[key] ?? key),
    failNextBundle(): void {
      failing = true;
    },
  };
}

describe('LanguageSwitcherComponent', () => {
  let fixture: ComponentFixture<LanguageSwitcherComponent>;
  let component: LanguageSwitcherComponent;
  let translate: TranslateStub;

  /** Every code the component reported as switched, in emission order. */
  let switched: string[];

  /** How many times the component reported a bundle that could not be loaded. */
  let failures: number;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The select the row renders, addressed by the id its caller chose. */
  function selector(id: string = 'language-switcher'): HTMLSelectElement {
    const element = host().querySelector<HTMLSelectElement>(`select#${id}`);

    if (element === null) {
      throw new Error(`the switcher rendered no select#${id}`);
    }

    return element;
  }

  /** The row's wrapper element, which is where the global `.language-switcher` rule applies. */
  function wrapper(): HTMLElement {
    const element = host().querySelector<HTMLElement>('.language-switcher');

    if (element === null) {
      throw new Error('the switcher rendered no .language-switcher row');
    }

    return element;
  }

  /** Drives a selection the way the user does: the element's value, then its `change` event. */
  function choose(code: string): void {
    const select = selector();
    select.value = code;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
    // The jsdom store is shared by the whole suite, so a selection another case (or another spec
    // file) made must not decide what this one reads back; the key string is the i18n service's.
    window.localStorage.removeItem(languagePreferenceKey());
    translate = createTranslateStub();

    TestBed.configureTestingModule({
      imports: [LanguageSwitcherComponent],
      providers: [{ provide: TranslateService, useValue: translate }],
    });

    fixture = TestBed.createComponent(LanguageSwitcherComponent);
    component = fixture.componentInstance;
    switched = [];
    failures = 0;
    component.langChange.subscribe((code: string) => switched.push(code));
    component.langChangeFailed.subscribe(() => {
      failures += 1;
    });
  });

  /** Sets the two required inputs above and renders the row. */
  function render(langs: readonly string[] = LANGS, current: string = ACTIVE): void {
    fixture.componentRef.setInput('langs', langs);
    fixture.componentRef.setInput('current', current);
    fixture.detectChanges();
  }

  it('renders the caller’s label, the select under the caller’s id and every offered language in order', () => {
    render();

    const select = selector();

    expect(host().querySelector('label')?.textContent?.trim()).toBe(
      TRANSLATIONS[NAVBAR_LABEL_KEY],
    );
    expect(host().querySelector('label')?.getAttribute('for')).toBe('language-switcher');
    expect(Array.from(select.options, (option) => option.value)).toEqual([...LANGS]);
    expect(select.value).toBe(ACTIVE);
    // No colour and no dimension of the component's own: the global `.language-switcher` rule and
    // Bootstrap's `.btn.btn-default.btn-xs` supply every visual value (AAP 0.2.3, Rule 1 clause 6).
    expect(wrapper().getAttribute('style')).toBeNull();
    expect(select.className).toBe('btn btn-default btn-xs');
  });

  it('shows the language in force, marked as the active option even when it is not the first', () => {
    render(LANGS, 'es');

    const select = selector();

    expect(select.value).toBe('es');
    expect(select.selectedOptions).toHaveLength(1);
    expect(select.selectedOptions[0]?.value).toBe('es');
    expect(Array.from(select.options, (option) => option.selected)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('takes the label key and the select id from its caller, so each screen keeps its own wording and id', () => {
    // The login screen carries legacy's "Change language:" and the id the parity page objects drive.
    fixture.componentRef.setInput('labelKey', LOGIN_LABEL_KEY);
    fixture.componentRef.setInput('selectId', LOGIN_SELECT_ID);
    render();

    expect(host().querySelector('label')?.textContent?.trim()).toBe(
      TRANSLATIONS[LOGIN_LABEL_KEY],
    );
    expect(host().querySelector('label')?.getAttribute('for')).toBe(LOGIN_SELECT_ID);
    expect(selector(LOGIN_SELECT_ID).getAttribute('id')).toBe(LOGIN_SELECT_ID);
    expect(host().textContent).not.toContain('label.');
  });

  it('switches the bundle once and reports the code that took effect', () => {
    render();
    choose(OTHER_LANG);

    expect(translate.use).toHaveBeenCalledTimes(1);
    expect(translate.use).toHaveBeenCalledWith(OTHER_LANG);
    // The observable `use` returned was really subscribed to, so the switch happened rather than
    // being asked for.
    expect(translate.applied).toEqual([OTHER_LANG]);
    // Reported on the success channel, which is the only one a taken switch reaches.
    expect(switched).toEqual([OTHER_LANG]);
    expect(failures).toBe(0);
  });

  it('reports a bundle that could not be loaded and puts the select back on the language in force', () => {
    render();
    translate.failNextBundle();

    choose(OTHER_LANG);

    expect(translate.use).toHaveBeenCalledWith(OTHER_LANG);
    expect(translate.applied).toEqual([OTHER_LANG]);
    // The switch took no effect, so nothing is reported as switched and the failure is reported
    // instead of being swallowed (AAP 0.14.2).
    expect(switched).toEqual([]);
    expect(failures).toBe(1);
    // Written back by hand: the `[value]` binding never rewrites a control whose bound value — the
    // language in force — did not change.
    expect(selector().value).toBe(ACTIVE);
  });

  it('takes a later switch after a failure, so the failure does not disable the control', () => {
    render();
    translate.failNextBundle();
    choose(OTHER_LANG);

    choose('es');

    expect(translate.applied).toEqual([OTHER_LANG, 'es']);
    expect(switched).toEqual(['es']);
    expect(failures).toBe(1);
  });

  it('switches nothing and reports nothing for a blank selection', () => {
    render();

    choose('');

    // An empty option is not a language: no bundle is loaded and no output fires.
    expect(translate.use).not.toHaveBeenCalled();
    expect(switched).toEqual([]);
    expect(failures).toBe(0);
    expect(selector().value).toBe(ACTIVE);
  });

  it('remembers the selection in the legacy entry, so the next page load starts in it', () => {
    render();

    choose(OTHER_LANG);

    // The entry legacy's own `changeLang` writes (`MainController.js:344`), which the start-up in
    // `app.config.ts` applies again on the next load.
    expect(window.localStorage.getItem(languagePreferenceKey())).toBe(
      JSON.stringify({ code: OTHER_LANG }),
    );
    expect(TestBed.inject(LanguagePreferenceService).read()).toBe(OTHER_LANG);
  });

  it('keeps a selection whose bundle failed to load, as legacy stores it beside the failing switch', () => {
    render();
    translate.failNextBundle();

    choose(OTHER_LANG);

    // Reported as a failure, and still the language the next page load starts in: it was stored
    // before the bundle was asked for (`MainController.js:343-345`).
    expect(switched).toEqual([]);
    expect(failures).toBe(1);
    expect(TestBed.inject(LanguagePreferenceService).read()).toBe(OTHER_LANG);
  });
});
