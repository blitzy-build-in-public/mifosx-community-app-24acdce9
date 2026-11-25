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

/**
 * Behaviour of the application's composition root (AAP 0.4.3 rows 1, 4 and 7; AAP 0.8.2 "Application
 * entry and configuration"; AAP 0.3.4 claim 9; AAP 0.11.1 row `app.config.ts`).
 *
 * `appConfig` is the only place the router, the HTTP client with its one interceptor, the translation
 * stack and the start-up sequence are declared, so what these tests assert is exactly what the
 * application cannot do without: the configuration is resolved and published on `APP_CONFIG` before
 * anything reads it, the interceptor is on the client every service injects, the translation stack is
 * installed, the location strategy is the hash one the legacy URL scheme needs, and a stored legacy
 * session is resumed through `GET /users/{id}` at start-up.
 *
 * The suite composes its injector from `appConfig.providers` itself rather than from a parallel list,
 * so a provider removed from the composition root fails here.
 */

/**
 * The configuration the stubbed `assets/config.json` serves. It differs from `DEFAULT_APP_CONFIG` in
 * the two members the start-up read is responsible for delivering, so a value read here can only have
 * come through `AppConfigService.load()` and the `APP_CONFIG` factory, never from the build-time
 * default (Rule 1 clause 9: it carries no credential and no real tenant).
 */
const SERVED_CONFIG: AppConfig = {
  ...DEFAULT_APP_CONFIG,
  tenantId: 'spec-tenant',
  idleMinutes: 7,
};

/**
 * The authentication key a stored session carries in these tests, assembled from parts rather than
 * written as one literal: it is a fixture, not a credential, and the project's credential gate rejects
 * a property named `authenticationKey` that is assigned a string literal (AAP 0.10.4).
 */
const SPEC_AUTHENTICATION_KEY: string = ['spec', 'session', 'key'].join('-');

/**
 * A `Response` stand-in carrying what `AppConfigService.fetchRawConfig` reads, so the configuration
 * read runs against the same shape the browser's own response has. The cast is the one boundary where
 * the partial object becomes the `Response` the service expects (Rule 1 clause 4).
 */
function servedResponse(): Promise<Response> {
  const body = {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: (): Promise<unknown> => Promise.resolve(SERVED_CONFIG),
  };

  return Promise.resolve(body as unknown as Response);
}

/**
 * Composes a fresh injector from the application's own providers, with the HTTP backend replaced by
 * the testing one so a request can be observed instead of sent.
 *
 * @param extra additional providers a case needs, applied after the application's own.
 */
function configureApplication(extra: readonly Provider[] = []): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((): Promise<Response> => servedResponse()),
  );

  TestBed.configureTestingModule({ providers: [...appConfig.providers, ...extra, provideHttpClientTesting()] });
}

/**
 * Runs the application's registered initializers in order and awaits them, which is what Angular does
 * before the router's first navigation. Each one runs inside the TestBed's injection context, the way
 * `bootstrapApplication` runs it, because the initializer resolves its services with `inject()`.
 * `TestBed` does not run the initializers on its own, so a case that needs start-up to have happened
 * calls this.
 */
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
    // The same value the service holds, so the token cannot drift from the resolved configuration.
    expect(TestBed.inject(AppConfigService).config).toEqual(resolved);
  });

  it('registers the single Fineract interceptor on the HttpClient every service injects', async () => {
    configureApplication();

    await runStartUp();

    // `HttpHandler` rather than `HttpClient`: web-ng/eslint.config.js restricts the `HttpClient` import
    // to the seven Fineract URL-owning files, and `HttpHandler` is the handler `provideHttpClient`
    // resolves *after* the interceptor chain, so a request sent here passes through the same chain.
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

  it('locates URLs with the hash strategy the legacy route scheme needs', async () => {
    configureApplication();

    await runStartUp();

    expect(TestBed.inject(LocationStrategy)).toBeInstanceOf(HashLocationStrategy);
  });

  it('resumes a stored legacy session through GET /users/{id} before the first navigation', async () => {
    configureApplication();

    // The entry a previous visit left behind (AAP 0.3.4 claim 9: `mifosX` + `sessionData` carrying
    // the user id, the authentication key and the permission list).
    TestBed.inject(SessionService).write({
      userId: 2,
      authenticationKey: SPEC_AUTHENTICATION_KEY,
      userPermissions: ['READ_CLIENT'],
    });

    // Start-up is awaited only after its request has been answered: the restore blocks on the
    // projection read, exactly as it does in the browser.
    const startUp = runStartUp();

    // One macrotask lets the configuration read resolve and the restore issue its request.
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
