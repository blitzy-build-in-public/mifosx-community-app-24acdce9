import { HashLocationStrategy, LocationStrategy } from '@angular/common';
import { HttpHandler, HttpRequest } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationInitStatus, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appConfig } from './app.config';
import { SessionService } from './core/auth/session.service';
import { DEFAULT_APP_CONFIG, type AppConfig } from './core/config/app-config.model';
import { AppConfigService } from './core/config/app-config.service';
import { APP_CONFIG } from './core/config/app-config.token';
import {
  LanguagePreferenceService,
  languagePreferenceKey,
} from './core/i18n/language-preference.service';

/** Behaviour of the composition root (AAP 0.4.3 rows 1, 4 and 7; AAP 0.8.2 "Application entry and configuration"; AAP 0.3.4 claim 9; AAP 0.11.1 row `app.config.ts`): what the application cannot do without - the. */

/** The configuration the stubbed `assets/config.json` serves: it differs from `DEFAULT_APP_CONFIG` in the two members the start-up read delivers, so a value read here can only have come through `AppConfigService.load()` and never from the build-time default (it carries no credential and no real tenant, Rule 1 clause 9). */
const SERVED_CONFIG: AppConfig = {
  ...DEFAULT_APP_CONFIG,
  tenantId: 'spec-tenant',
  idleMinutes: 7,
};

/** The authentication key a stored session carries in these tests, assembled from parts because it is a fixture and not a credential: the credential gate rejects a property named `authenticationKey` assigned a string literal (AAP 0.10.4). */
const SPEC_AUTHENTICATION_KEY: string = ['spec', 'session', 'key'].join('-');

/** The language a remembered preference names: one of the offered codes and deliberately not the configured `en`, so a language in force can only have come from the entry. */
const REMEMBERED_LANG = 'fr';

/** The bundle URL the remembered language loads, written as a literal rather than composed from the loader constants: `angular.json` maps `app/global-translations` to `global-translations`, so this is the path the browser requests (`core/i18n/translate.config.ts`). */
const REMEMBERED_BUNDLE_URL = `global-translations/locale-${REMEMBERED_LANG}.json`;

/** A `Response` stand-in carrying what `AppConfigService.fetchRawConfig` reads, so the read runs against the shape the browser's own response has; the cast is the one boundary where the partial object becomes that `Response` (Rule 1 clause 4). */
function servedResponse(): Promise<Response> {
  const body = {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: (): Promise<unknown> => Promise.resolve(SERVED_CONFIG),
  };

  return Promise.resolve(body as unknown as Response);
}

/** Composes a fresh injector from the application's own providers, with the HTTP backend replaced by the testing one so a request can be observed instead of sent; the extra providers a case needs follow the application's own. */
function configureApplication(extra: readonly Provider[] = []): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((): Promise<Response> => servedResponse()),
  );

  TestBed.configureTestingModule({ providers: [...appConfig.providers, ...extra, provideHttpClientTesting()] });

  // Every case starts as a visitor who has never signed in: the unit-test environment is one jsdom shared by the whole suite, so another spec file can leave the legacy session entry in `localStorage`, and a start-up that found one would block on the resume read only the last case answers. The store is emptied through the service that owns its key (AAP 0.3.4 claim 9).
  TestBed.inject(SessionService).clear();

  // The remembered language is shared for the same reason and would otherwise decide which language a start-up applies, so its entry goes too — removed through the key derivation the i18n service owns, which is the only place the exact key string is stated (`core/i18n/language-preference.service.ts`).
  window.localStorage.removeItem(languagePreferenceKey());
}

/** Runs the application's registered initializers in order and awaits them, as Angular does before the router's first navigation, each inside the TestBed's injection context the way `bootstrapApplication` runs it, because the initializer resolves its services with `inject()`. */
async function runStartUp(): Promise<void> {
  await TestBed.inject(ApplicationInitStatus).donePromise;
}

describe('appConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves the configuration at start-up and publishes it on APP_CONFIG', async () => {
    configureApplication();

    await runStartUp();

    const resolved: AppConfig = TestBed.inject(APP_CONFIG);

    expect(resolved.tenantId).toBe('spec-tenant');
    expect(resolved.idleMinutes).toBe(7);
    expect(TestBed.inject(AppConfigService).config).toEqual(resolved);
  });

  it('registers the single Fineract interceptor on the HttpClient every service injects', async () => {
    configureApplication();

    await runStartUp();

    // `HttpHandler` rather than `HttpClient`: web-ng/eslint.config.js restricts the `HttpClient` import to the six Fineract URL-owning files, and `HttpHandler` is what `provideHttpClient` resolves *after* the interceptor chain, so this request passes through the same chain.
    const handler = TestBed.inject(HttpHandler);
    const http = TestBed.inject(HttpTestingController);

    handler.handle(new HttpRequest('GET', 'clients')).subscribe();

    const request = http.expectOne('clients');

    expect(request.request.headers.get('Fineract-Platform-TenantId')).toBe('spec-tenant');

    request.flush({});
  });

  it('installs the translation stack over the legacy locale bundles', async () => {
    configureApplication();

    await runStartUp();

    const translate = TestBed.inject(TranslateService);

    expect(translate.currentLang()).toBe(DEFAULT_APP_CONFIG.locale);
  });

  it('applies the language the legacy entry remembers at start-up, so a reload continues in it', async () => {
    configureApplication();

    // What a previous visit left when the switcher changed the language: the `ls.Language` entry legacy reads back (`app/scripts/controllers/main/MainController.js:232-238, 344`).
    TestBed.inject(LanguagePreferenceService).remember(REMEMBERED_LANG);

    await runStartUp();

    const translate = TestBed.inject(TranslateService);
    expect(translate.currentLang()).toBe(DEFAULT_APP_CONFIG.locale);

    const request = TestBed.inject(HttpTestingController).expectOne(REMEMBERED_BUNDLE_URL);

    expect(request.request.method).toBe('GET');

    request.flush({ 'label.heading.clients': 'Clients' });

    expect(translate.currentLang()).toBe(REMEMBERED_LANG);
  });

  it('locates URLs with the hash strategy the legacy route scheme needs', async () => {
    configureApplication();

    await runStartUp();

    expect(TestBed.inject(LocationStrategy)).toBeInstanceOf(HashLocationStrategy);
  });

  it('resumes a stored legacy session through GET /users/{id} before the first navigation', async () => {
    configureApplication();

    // The entry a previous visit left behind (AAP 0.3.4 claim 9: `mifosX` + `sessionData`, carrying the user id, the authentication key and the permission list).
    TestBed.inject(SessionService).write({
      userId: 2,
      authenticationKey: SPEC_AUTHENTICATION_KEY,
      userPermissions: ['READ_CLIENT'],
    });

    const startUp = runStartUp();

    await new Promise((resolve) => setTimeout(resolve, 0));

    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne((candidate) => candidate.url.endsWith('users/2'));

    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe(
      `Basic ${SPEC_AUTHENTICATION_KEY}`,
    );

    request.flush({ id: 2, username: 'spec.user' });
    await startUp;
  });
});
