import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, isDevMode, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MissingTranslationHandler, TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { MissingTranslationHandlerParams } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  APP_OWNED_TRANSLATIONS,
  FineractMissingTranslationHandler,
  humaniseKey,
} from './missing-translation.handler';
import { provideTranslate, TRANSLATE_LOADER_PREFIX, TRANSLATE_LOADER_SUFFIX } from './translate.config';

/**
 * Stand-in for the legacy English bundle `app/global-translations/locale-en.json`.
 *
 * That file belongs to the read-only legacy checkout and is not present in this repository, so the
 * spec flushes an object of the same flat, dotted shape through `HttpTestingController` instead.
 * Flat keys are the point: the legacy bundles are not nested, and the migrated screens address
 * `label.heading.clients` and its neighbours directly.
 *
 * Test input only. This object is never an application translation source, adds no locale file and
 * is not derived from any translation text the build ships (Rule 1 clause 6).
 */
const LEGACY_EN_BUNDLE: Record<string, string> = {
  'label.heading.clients': 'Clients',
  'label.input.username': 'Username',
};

/**
 * Served path of the English bundle, written as a literal rather than composed from the loader
 * constants on purpose: `angular.json` maps `app/global-translations` to `global-translations` and
 * `index.html` declares `<base href="/">`, so the bundle sits at the site root with no `assets/`
 * segment and no leading slash. Composing the expectation from the constants would let a changed
 * prefix move the assertion with it and pass while every label 404s.
 */
const LEGACY_EN_BUNDLE_URL = 'global-translations/locale-en.json';

/**
 * A one-line host that renders a key the way both templates do — through `TranslatePipe` — so the
 * suite can prove the pipe path reaches this handler and not only `TranslateService.instant()`.
 *
 * The default key is the idle warning's sentence, because that is the string a user reads through the
 * pipe on a screen whose bundle cannot carry it (AAP 0.1.1 requirement 1).
 */
@Component({
  selector: 'app-translate-probe',
  imports: [TranslatePipe],
  template: '{{ key() | translate }}',
})
class TranslateProbeComponent {
  /** The key the probe renders; supplied by a case that needs a different one. */
  readonly key = input<string>('label.message.session.expiring');
}

/** The live i18n stack and the HTTP mock that serves its bundles. */
interface TranslateHarness {
  readonly translate: TranslateService;
  readonly httpMock: HttpTestingController;
}

/**
 * The two keys the application itself introduces, each with the English copy it must render.
 *
 * Written out rather than read back from `APP_OWNED_TRANSLATIONS`, so a changed default is reported
 * here as a difference instead of being compared against itself. Both are the application's own copy:
 * no legacy bundle carries an idle warning — AAP 0.1.1 requires one and the legacy `$idleTimeout`
 * handler logged out silently (`app/scripts/controllers/main/MainController.js:139-143`) — and the
 * bundles in `app/global-translations/` are read in place and never edited (Rule 1 clauses 1 and 6).
 */
const APP_OWNED_COPY: readonly (readonly [key: string, text: string])[] = [
  ['label.message.session.expiring', 'You have been inactive and will be signed out shortly.'],
  ['label.button.stay.signed.in', 'Stay signed in'],
];

/**
 * Composes the production i18n providers with the HTTP testing backend.
 *
 * Provider order matters: `provideHttpClientTesting()` replaces the backend of the `HttpClient`
 * installed by `provideHttpClient()`, and `provideTranslate()` deliberately does not provide
 * `HttpClient` itself, so both of the first two are required. Injecting `TranslateService` starts
 * its initial `use(lang)` load, which leaves exactly one bundle request outstanding.
 */
function createHarness(): TranslateHarness {
  TestBed.configureTestingModule({
    providers: [provideTranslate(), provideHttpClient(), provideHttpClientTesting()],
  });

  return { translate: TestBed.inject(TranslateService), httpMock: TestBed.inject(HttpTestingController) };
}

/**
 * Loads the legacy-shaped bundle through the real loader and fails the test on any request the
 * screen was not expected to make.
 *
 * @param harness stack under test
 * @param bundle flat, dotted translations to serve for `en`
 */
async function loadLegacyBundle(
  harness: TranslateHarness,
  bundle: Record<string, string> = LEGACY_EN_BUNDLE,
): Promise<void> {
  const loaded = firstValueFrom(harness.translate.use('en'));
  const request = harness.httpMock.expectOne(LEGACY_EN_BUNDLE_URL);

  request.flush(bundle);
  await loaded;
  harness.httpMock.verify();
}

/**
 * Builds the context ngx-translate hands the handler. Only `key` is read by the handler, and
 * `translateService` is the real instance, so no cast and no stub is needed.
 */
function missingKeyParams(key: string, translateService: TranslateService): MissingTranslationHandlerParams {
  return { key, translateService };
}

/** Silences `console.warn` for one test and returns the captured arguments as plain strings. */
function captureWarnings(): string[] {
  const messages: string[] = [];

  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]): void => {
    messages.push(args.map((arg: unknown) => String(arg)).join(' '));
  });

  return messages;
}

describe('FineractMissingTranslationHandler', () => {
  beforeEach(() => {
    // Reset explicitly rather than relying on the runner: a second `configureTestingModule` on an
    // instantiated module throws.
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    // Restore every spy so a `console.warn` stub from one test cannot mask a warning in the next.
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  describe('legacy bundle loading', () => {
    it('loads the bundle from the in-place asset path and resolves flat dotted keys unchanged', async () => {
      const { translate, httpMock } = createHarness();
      const handle = vi.spyOn(FineractMissingTranslationHandler.prototype, 'handle');

      const loaded = firstValueFrom(translate.use('en'));
      const request = httpMock.expectOne(LEGACY_EN_BUNDLE_URL);

      expect(request.request.method).toBe('GET');
      expect(request.request.url).toBe('global-translations/locale-en.json');
      expect(request.request.url.startsWith('/')).toBe(false);
      expect(request.request.url).not.toContain('assets/');

      // The loader constants are the parity contract behind that path, pinned here so a change to
      // either half is reported by this spec rather than by a missing label in the running app.
      expect(TRANSLATE_LOADER_PREFIX).toBe('global-translations/locale-');
      expect(TRANSLATE_LOADER_SUFFIX).toBe('.json');

      request.flush(LEGACY_EN_BUNDLE);
      await loaded;
      httpMock.verify();

      expect(translate.instant('label.heading.clients')).toBe('Clients');
      expect(translate.instant('label.input.username')).toBe('Username');

      // A key the bundle answers never reaches the missing-translation handler.
      expect(handle).not.toHaveBeenCalled();
    });

    it('renders a humanised label for a missing key instead of the raw dotted key', async () => {
      const harness = createHarness();

      await loadLegacyBundle(harness);

      expect(TestBed.inject(MissingTranslationHandler)).toBeInstanceOf(FineractMissingTranslationHandler);

      const warnings = captureWarnings();
      const missing = harness.translate.instant('label.heading.missing');

      expect(missing).toBe('Missing');
      expect(missing).not.toBe('label.heading.missing');
      expect(missing).not.toBe('');

      // One key, one warning, however many times the view asks for it.
      expect(warnings).toHaveLength(1);
    });
  });

  describe('handler', () => {
    it('humanises a camel-cased missing key when the handler is called directly', async () => {
      const harness = createHarness();

      await loadLegacyBundle(harness);
      captureWarnings();

      const handler = new FineractMissingTranslationHandler();

      expect(handler.handle(missingKeyParams('client.missing.camelCaseKey', harness.translate))).toBe(
        'Camel Case Key',
      );
    });

    it('returns an empty string for an empty key and for a key of blanks instead of throwing', async () => {
      const harness = createHarness();

      await loadLegacyBundle(harness);
      captureWarnings();

      const handler = new FineractMissingTranslationHandler();

      expect(() => handler.handle(missingKeyParams('', harness.translate))).not.toThrow();
      expect(handler.handle(missingKeyParams('', harness.translate))).toBe('');
      expect(handler.handle(missingKeyParams('   ', harness.translate))).toBe('');
    });

    it('warns exactly once per missing key and puts nothing but the key in the message', async () => {
      const harness = createHarness();

      await loadLegacyBundle(harness);

      const warnings = captureWarnings();
      const handler = new FineractMissingTranslationHandler();
      const params = missingKeyParams('label.heading.missing', harness.translate);

      handler.handle(params);
      handler.handle(params);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('label.heading.missing');

      // Rule 1 clause 9: the single sanctioned console line carries the key and nothing else — no
      // translated value, no request payload and no credential, session or tenant material.
      expect(warnings[0]).not.toContain('Clients');
      expect(warnings[0]).not.toContain('Username');
      expect(warnings[0]).not.toMatch(/authorization|authentication|password|base64|tenant|bearer/i);
    });

    it('stays silent outside development mode and still returns the humanised label', async () => {
      const harness = createHarness();

      await loadLegacyBundle(harness);

      const warnings = captureWarnings();
      const handler = new FineractMissingTranslationHandler();
      const params = missingKeyParams('label.heading.missing', harness.translate);

      // Angular's `isDevMode()` reads the global `ngDevMode`, and a production build defines it as
      // `false` — the very value `enableProdMode()` writes. Writing that global puts the handler in
      // its production branch here without mocking the function that is under proof. The development
      // bundle installs an object under the same name for its own diagnostics, so its descriptor is
      // kept and put back: deleting the global outright would leave later Angular code unable to
      // read it at all.
      const original: PropertyDescriptor | undefined = Reflect.getOwnPropertyDescriptor(
        globalThis,
        'ngDevMode',
      );

      try {
        Reflect.set(globalThis, 'ngDevMode', false);

        // Not vacuous: the flag really reads false while the handler below runs.
        expect(isDevMode()).toBe(false);

        expect(handler.handle(params)).toBe('Missing');
        expect(handler.handle(params)).toBe('Missing');
        expect(warnings).toHaveLength(0);
      } finally {
        if (original === undefined) {
          Reflect.deleteProperty(globalThis, 'ngDevMode');
        } else {
          Reflect.defineProperty(globalThis, 'ngDevMode', original);
        }
      }

      // The restore itself is pinned, so a leaked flag cannot silence the dev-mode warning above.
      expect(isDevMode()).toBe(true);
    });

    it.each(APP_OWNED_COPY)(
      'answers the application-owned key %s with its default copy and reports nothing',
      async (key: string, expected: string) => {
        const harness = createHarness();

        await loadLegacyBundle(harness);

        const warnings = captureWarnings();

        // The key reaches the handler — the bundle below carries neither of the two — and the
        // application's own copy comes back instead of a humanised key, which is what makes the idle
        // warning translatable rather than frozen English (AAP 0.1.1 requirement 1; AAP 0.7.4).
        expect(harness.translate.instant(key)).toBe(expected);
        expect(harness.translate.instant(key)).not.toBe(key);

        // An application-owned key is not a missing key, so it never reaches the console (AAP 0.14.2).
        expect(warnings).toHaveLength(0);
      },
    );

    it('holds exactly the two keys the application introduces, so no legacy key is shadowed', () => {
      // A third entry would answer a key a served bundle is meant to own, and a missing entry would
      // leave the idle warning humanised — both would be silent at run time, so the set is pinned here.
      expect([...APP_OWNED_TRANSLATIONS.keys()]).toEqual(APP_OWNED_COPY.map(([key]) => key));

      for (const [key, text] of APP_OWNED_COPY) {
        expect(APP_OWNED_TRANSLATIONS.get(key)).toBe(text);
      }
    });

    it('still humanises and warns once for an unrelated key after answering an application-owned one', async () => {
      const harness = createHarness();

      await loadLegacyBundle(harness);

      const warnings = captureWarnings();

      expect(harness.translate.instant('label.button.stay.signed.in')).toBe('Stay signed in');
      expect(warnings).toHaveLength(0);

      // The map answers two keys, not the key space: every other absent key keeps the humanised label
      // and the single development-only warning the handler has always emitted.
      expect(harness.translate.instant('label.heading.missing')).toBe('Missing');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('label.heading.missing');
    });
  });

  describe('through the translation pipe', () => {
    it.each(APP_OWNED_COPY)(
      'renders the application-owned key %s as its default copy rather than as the key',
      async (key: string, expected: string) => {
        const harness = createHarness();
        const warnings = captureWarnings();

        // Rendered before the bundle is flushed, so the key really is absent at the moment the pipe
        // asks for it — the state the idle warning is in on every screen of the application.
        const fixture = TestBed.createComponent(TranslateProbeComponent);
        fixture.componentRef.setInput('key', key);
        fixture.detectChanges();

        await loadLegacyBundle(harness);
        fixture.detectChanges();

        // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines
        // the boundary cast to this line (Rule 1 clause 4).
        const rendered: string = (fixture.nativeElement as HTMLElement).textContent?.trim() ?? '';

        // The template renders the application's own English copy: not the raw key, not a humanised
        // label, and nothing reported to the console (AAP 0.1.1 requirement 1, AAP 0.14.2).
        expect(rendered).toBe(expected);
        expect(rendered).not.toBe(key);
        expect(warnings).toHaveLength(0);
      },
    );
  });
});

describe('humaniseKey', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['label.heading.clients', 'Clients'],
    ['label.input.user_name', 'User Name'],
    ['client.missing.camelCaseKey', 'Camel Case Key'],
    ['client.missing.IDField', 'ID Field'],
    ['label.input.CLIENT_ID', 'CLIENT ID'],
    ['', ''],
    ['   ', ''],
  ];

  it.each(cases)('humanises %j as %j', (key: string, expected: string) => {
    expect(humaniseKey(key)).toBe(expected);
  });
});
