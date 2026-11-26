import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  LANGUAGE_ENTRY_KEY,
  LanguagePreferenceService,
  LEGACY_LANGUAGE_PREFIX,
  languagePreferenceKey,
} from './language-preference.service';

/** Behaviour of `LanguagePreferenceService` — the owner of the `ls.Language` entry the legacy application keeps the chosen language in (`app/scripts/controllers/main/MainController.js:343-345` writes it, `:232-238` reads it back), and the proof that a full page load continues in the language the user picked (Rule 1 clause 3). It discharges AAP 0.11.1 (a unit spec beside every service), AAP 0.10.3 criterion 2 (the suite runs headless) and Rule 1 clause 8 (no spec without an `expect`). It pins the key as the exact string the legacy storage wrapper produces — its `'ls'` prefix with the period the wrapper appends, derived in one place — a remembered code written in the legacy JSON shape and read
 * back, `null` for nothing stored and for a value that is not JSON, a JSON value that is not an object or an object without a usable `code`, `null` and no bundle load for a stored code the application offers no bundle for, a store the browser refuses neither throwing out of `read()` nor out of `remember()`, `restore()` applying the code through `TranslateService.use()` and doing nothing when nothing is remembered, and a bundle that cannot be loaded leaving `restore()` silent so start-up never fails over a preference. The translate stack is a typed stand-in for the one member this service touches, so a case can make one bundle load fail; no HTTP provider exists, because the service reaches no
 * host itself (Rule 1 clause 5). */

/** The language every fixture stores: one of the offered codes, deliberately not the configured `en`, so a value read back can only have come from the entry. */
const REMEMBERED_LANG = 'fr';

const OTHER_LANG = 'es';

/** A code no start-up may hand to the bundle loader: outside `AVAILABLE_LANGS`, so the application serves no `global-translations/locale-<code>.json` for it, and path-shaped, which is the hand-edited entry value the validation has to stop before it becomes a request (Rule 1 clause 9). */
const UNOFFERED_CODE = '../../x';

/** The legacy wrapper's prefix, written out rather than read from the constant, so the exported value is asserted against the legacy source and not against itself (`app/scripts/modules/localstorage.js:4`). */
const LEGACY_PREFIX_LITERAL = 'ls';

/** The entry name legacy passes to `addToLocalStorage` at `MainController.js:344`, written out for the same reason. */
const LEGACY_ENTRY_LITERAL = 'Language';

const LEGACY_KEY_LITERAL = 'ls.Language';

interface TranslateStub {
  readonly use: Mock<(code: string) => Observable<unknown>>;

  readonly requested: readonly string[];

  /** Makes the next `use` answer on its error channel, the way a bundle that cannot load does. */
  failNextBundle(): void;
}

/** Builds the translate stand-in: `use` records the code at subscription time, the way the library starts its load, and can be made to fail once so the restore's error path is exercisable. */
function createTranslateStub(): TranslateStub {
  const requested: string[] = [];
  let failing = false;

  const use = vi.fn<(code: string) => Observable<unknown>>(
    (code: string): Observable<unknown> =>
      new Observable<unknown>((subscriber) => {
        requested.push(code);

        if (failing) {
          failing = false;
          subscriber.error(new Error('the bundle could not be loaded'));
          return;
        }

        subscriber.next({});
        subscriber.complete();
      }),
  );

  return {
    use,
    requested,
    failNextBundle(): void {
      failing = true;
    },
  };
}

interface Harness {
  readonly service: LanguagePreferenceService;
  readonly translate: TranslateStub;
}

/** Composes a fresh injector from the pieces the service injects: the document the storage is reached through — the page's own by default — and the one owner of the active language. */
function harnessFor(
  translate: TranslateStub = createTranslateStub(),
  view: Document = document,
): Harness {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: DOCUMENT, useValue: view },
      { provide: TranslateService, useValue: translate },
    ],
  });

  return { service: TestBed.inject(LanguagePreferenceService), translate };
}

/** Seats an entry under the legacy key the way another release of the front end would, so `read()` meets every shape a real store can hold and not only its own output. */
function seedEntry(value: string): void {
  window.localStorage.setItem(languagePreferenceKey(), value);
}

let savedStore: Storage | null = null;

let savedDescriptor: PropertyDescriptor | null = null;

/** Substitutes the page's `localStorage` for one case with the store a browser presents when it refuses access — a full quota, a read-only profile, storage blocked by the user — because the property is the only way to reach that state without a cast; `restoreStorage()` puts the real one back. */
function withStorage(getStore: () => Storage): void {
  savedDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage') ?? null;
  savedStore = window.localStorage;
  Object.defineProperty(window, 'localStorage', { configurable: true, get: getStore });
}

/** A store that refuses every call, the shape a full or read-only `localStorage` has when it throws from each member. */
function refusingStore(): Storage {
  const refuse = (): never => {
    throw new Error('the store is full');
  };

  return {
    length: 0,
    clear: refuse,
    getItem: refuse,
    key: refuse,
    removeItem: refuse,
    setItem: refuse,
  };
}

/** Puts the page's own store back and leaves the legacy entry as the case found it, because the unit-test environment is one jsdom shared by the whole suite. */
function restoreStorage(): void {
  if (savedDescriptor !== null) {
    Object.defineProperty(window, 'localStorage', savedDescriptor);
  } else if (savedStore !== null) {
    const store = savedStore;
    Object.defineProperty(window, 'localStorage', { configurable: true, get: (): Storage => store });
  }

  savedDescriptor = null;
  savedStore = null;
  window.localStorage.removeItem(languagePreferenceKey());
}

describe('LanguagePreferenceService', () => {
  afterEach(() => {
    restoreStorage();
    vi.clearAllMocks();
  });

  it('derives the exact key the legacy storage wrapper writes, `ls.Language`', () => {
    expect(LEGACY_LANGUAGE_PREFIX).toBe(LEGACY_PREFIX_LITERAL);
    expect(LANGUAGE_ENTRY_KEY).toBe(LEGACY_ENTRY_LITERAL);
    expect(languagePreferenceKey()).toBe(LEGACY_KEY_LITERAL);
    expect(languagePreferenceKey('other', 'Entry')).toBe('other.Entry');
  });

  it('writes a remembered code into the legacy entry and reads it back', () => {
    const { service } = harnessFor();

    service.remember(REMEMBERED_LANG);

    expect(window.localStorage.getItem(LEGACY_KEY_LITERAL)).toBe(
      JSON.stringify({ code: REMEMBERED_LANG }),
    );
    expect(service.read()).toBe(REMEMBERED_LANG);
  });

  it('replaces an earlier selection rather than keeping both', () => {
    const { service } = harnessFor();

    service.remember(REMEMBERED_LANG);
    service.remember(OTHER_LANG);

    expect(window.localStorage.getItem(LEGACY_KEY_LITERAL)).toBe(
      JSON.stringify({ code: OTHER_LANG }),
    );
    expect(service.read()).toBe(OTHER_LANG);
  });

  it.each(['zh_CN', 'my_MM'])('still remembers and reads back the offered mixed-case code %s', (offered: string) => {
    // The codes whose case a looser test could lose: both are offered exactly as legacy spells them, so the entry validation must keep them and not fold their case.
    const { service } = harnessFor();

    service.remember(offered);

    expect(window.localStorage.getItem(LEGACY_KEY_LITERAL)).toBe(JSON.stringify({ code: offered }));
    expect(service.read()).toBe(offered);
  });

  it('reads the code of the whole language object a legacy switch stores', () => {
    // What `angular.toJson(lang)` wrote on a legacy screen: the `Langs` entry, of which the restore reads only `code` (`MainController.js:232-238`).
    seedEntry(JSON.stringify({ name: 'Français', code: REMEMBERED_LANG }));

    const { service } = harnessFor();

    expect(service.read()).toBe(REMEMBERED_LANG);
  });

  it('answers null when no language has been remembered', () => {
    window.localStorage.removeItem(languagePreferenceKey());

    const { service } = harnessFor();

    expect(service.read()).toBeNull();
  });

  it.each([
    ['not JSON at all', 'not a language'],
    ['JSON that is not an object', JSON.stringify(REMEMBERED_LANG)],
    ['JSON null', 'null'],
    ['an object with no code member', JSON.stringify({ name: 'Français' })],
    ['an object whose code is blank', JSON.stringify({ code: '   ' })],
    ['an object whose code is not a string', JSON.stringify({ code: 42 })],
    ['an object whose code the application does not offer', JSON.stringify({ code: UNOFFERED_CODE })],
  ])('answers null for an entry that is %s', (_shape: string, stored: string) => {
    seedEntry(stored);

    const { service } = harnessFor();

    expect(service.read()).toBeNull();
  });

  it('writes nothing for a code that names no language', () => {
    const { service } = harnessFor();

    service.remember('   ');

    expect(window.localStorage.getItem(LEGACY_KEY_LITERAL)).toBeNull();
  });

  it('writes nothing for a code the application offers no bundle for, so no later load can read one', () => {
    window.localStorage.removeItem(languagePreferenceKey());

    const { service } = harnessFor();

    service.remember(UNOFFERED_CODE);

    expect(window.localStorage.getItem(LEGACY_KEY_LITERAL)).toBeNull();
    expect(service.read()).toBeNull();
  });

  it('requests no bundle at all for a stored code the application does not offer', () => {
    // The security-relevant assertion: a hand-edited entry must never become a request for `global-translations/locale-../../x.json`, so `restore()` may not call `use()` even once.
    seedEntry(JSON.stringify({ code: UNOFFERED_CODE }));
    const translate = createTranslateStub();
    const { service } = harnessFor(translate);

    service.restore();

    expect(translate.use).not.toHaveBeenCalled();
    expect(translate.requested).toEqual([]);
  });

  it('absorbs a store that refuses to be read or written', () => {
    withStorage(refusingStore);

    const { service } = harnessFor();

    expect(service.read()).toBeNull();
    expect(() => service.remember(REMEMBERED_LANG)).not.toThrow();
  });

  it('absorbs a store the browser refuses to hand over at all', () => {
    // `localStorage` itself throwing on access is the third refusal a browser has — a document the user blocked storage for — and no entry can be read or written through it.
    withStorage((): Storage => {
      throw new Error('storage access is blocked');
    });

    const { service } = harnessFor();

    expect(service.read()).toBeNull();
    expect(() => service.remember(REMEMBERED_LANG)).not.toThrow();
  });

  it('answers null when the document has no storage to reach', () => {
    // A document made without a browsing context has no `defaultView`, which is the state a page whose storage the browser has taken away presents.
    const noStorage = document.implementation.createHTMLDocument('storage-unavailable');
    const { service } = harnessFor(createTranslateStub(), noStorage);

    expect(service.read()).toBeNull();
    expect(() => service.remember(REMEMBERED_LANG)).not.toThrow();
  });

  it('applies the remembered language through the translate service, subscribed to once', () => {
    const translate = createTranslateStub();
    const { service } = harnessFor(translate);

    service.remember(REMEMBERED_LANG);
    service.restore();

    expect(translate.use).toHaveBeenCalledTimes(1);
    expect(translate.use).toHaveBeenCalledWith(REMEMBERED_LANG);
    // `use()` only loads a bundle once what it returns is subscribed to, which is how the switch itself works in the switcher.
    expect(translate.requested).toEqual([REMEMBERED_LANG]);
  });

  it('applies nothing when no language has been remembered', () => {
    window.localStorage.removeItem(languagePreferenceKey());
    const translate = createTranslateStub();
    const { service } = harnessFor(translate);

    service.restore();

    expect(translate.use).not.toHaveBeenCalled();
    expect(translate.requested).toEqual([]);
  });

  it('does not throw when the remembered bundle cannot be loaded', () => {
    const translate = createTranslateStub();
    const { service } = harnessFor(translate);
    service.remember(REMEMBERED_LANG);
    translate.failNextBundle();

    expect(() => service.restore()).not.toThrow();
    // The load was still asked for: the library keeps the language it had and reports the failure itself, so start-up neither blocks nor fails (AAP 0.14.2).
    expect(translate.requested).toEqual([REMEMBERED_LANG]);
  });
});
