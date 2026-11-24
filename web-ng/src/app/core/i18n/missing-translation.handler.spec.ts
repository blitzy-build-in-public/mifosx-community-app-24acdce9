import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MissingTranslationHandler, TranslateService } from '@ngx-translate/core';
import type { MissingTranslationHandlerParams } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FineractMissingTranslationHandler, humaniseKey } from './missing-translation.handler';
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

/** The live i18n stack and the HTTP mock that serves its bundles. */
interface TranslateHarness {
  readonly translate: TranslateService;
  readonly httpMock: HttpTestingController;
}

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
  });
});

describe('humaniseKey', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['label.heading.clients', 'Clients'],
    ['label.input.user_name', 'User Name'],
    ['client.missing.camelCaseKey', 'Camel Case Key'],
    ['', ''],
    ['   ', ''],
  ];

  it.each(cases)('humanises %j as %j', (key: string, expected: string) => {
    expect(humaniseKey(key)).toBe(expected);
  });
});
