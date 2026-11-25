import { DOCUMENT, signal, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { AppConfig } from './app-config.model';
import { AppConfigService } from './app-config.service';

/**
 * Contract and behaviour spec for `AppConfigService`: the one request it makes, the three-source
 * precedence it resolves, the values it refuses, the URL composition it owns, the failure text it
 * reports and the locale signal every date-bearing payload follows. `load()` is the only method in this
 * boundary that performs a request, so this is the contract test the AAP 0.11.1 `core/config/**` row and
 * AAP 0.14.2 require.
 *
 * The request is made with the platform `fetch`, not `HttpClient` — `assets/config.json` is a
 * same-origin static asset that carries no tenant or authorization header and names no Fineract
 * endpoint (AAP 0.14.1) — so the transport is stubbed at `globalThis.fetch` and the path it is called
 * with is asserted directly.
 */

/**
 * Served path of the runtime configuration, stated as the literal the browser resolves against
 * `<base href="/">` rather than composed from the service's own constant: composing it would let a
 * changed path move the assertion with it and pass while the container rewrites a file nobody
 * requests.
 */
const CONFIG_URL = 'assets/config.json';

/**
 * The eight keys and values `web-ng/src/assets/config.json` ships (AAP 0.4.4 decision 5(a), AAP
 * 0.7.2). Written out rather than imported so the spec pins the served contract instead of agreeing
 * with whatever the file happens to hold.
 */
const SERVED_CONFIG: AppConfig = {
  apiBaseUrl: 'https://localhost:8443',
  apiPath: '/fineract-provider/api/v1',
  tenantId: 'default',
  dateFormat: 'dd MMMM yyyy',
  locale: 'en',
  idleMinutes: 30,
  warningSeconds: 10,
  keepaliveMinutes: 15,
};

/**
 * The API root `apiUrl()` composes for a path with no resource segment. Composed from the served
 * values rather than written out, because the root is not an endpoint the application requests and
 * so belongs in neither parity list.
 */
const API_ROOT_URL = `${SERVED_CONFIG.apiBaseUrl}${SERVED_CONFIG.apiPath}`;

/**
 * The two ways a caller can ask `apiUrl()` for the API root itself — an empty path and a bare
 * slash. Named here rather than written at the call site, because both are a composition edge case
 * and no request: the API root is in neither parity list, and `npm run check:endpoints` reads an
 * `apiUrl('…')` argument as the endpoint that call requests.
 */
const EMPTY_RESOURCE_PATH = '';
const SLASHES_ONLY_RESOURCE_PATH = '/';

/**
 * What the stubbed transport does for one configuration read — the four outcomes `fetchRawConfig`
 * distinguishes: a body to serve, a body that is not JSON, a status the server answered with, and a
 * request that never reached a server.
 */
type FetchAnswer =
  | { readonly kind: 'served'; readonly body: unknown }
  | { readonly kind: 'not-json' }
  | { readonly kind: 'status'; readonly status: number; readonly statusText: string }
  | { readonly kind: 'unreachable' };

/** The served configuration, the answer almost every case uses. */
const SERVED: FetchAnswer = { kind: 'served', body: SERVED_CONFIG };

/**
 * A `Response` stand-in carrying exactly what `fetchRawConfig` reads — `ok`, `status`, `statusText`
 * and `json()` — so a case can reach every one of its branches. The cast is the single boundary where
 * the partial object becomes the `Response` the service expects (Rule 1 clause 4).
 */
function responseFor(answer: FetchAnswer): Promise<Response> {
  if (answer.kind === 'unreachable') {
    return Promise.reject(new TypeError('Failed to fetch'));
  }

  const body =
    answer.kind === 'not-json'
      ? { ok: true, status: 200, statusText: 'OK', json: () => Promise.reject(new SyntaxError('Unexpected token <')) }
      : answer.kind === 'served'
        ? { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(answer.body) }
        : {
            ok: false,
            status: answer.status,
            statusText: answer.statusText,
            json: () => Promise.reject(new SyntaxError('no body')),
          };

  return Promise.resolve(body as unknown as Response);
}

/**
 * A page URL of the test's choosing. The service reads only `location.search` and `location.hash`,
 * so the double carries those two properties; the cast is the boundary where the partial object
 * becomes the `Document` the service injects.
 */
function fakeDocument(search: string, hash: string): Document {
  return { location: { search, hash } } as unknown as Document;
}

/** The service under test and the stubbed transport that answers its configuration read. */
interface ConfigHarness {
  readonly service: AppConfigService;
  readonly fetchMock: Mock<typeof fetch>;
}

/**
 * Composes the service over the given page URL with the transport stubbed to `answer`.
 *
 * @param search the page URL's query string, as `location.search` reports it
 * @param hash the page URL's fragment, as `location.hash` reports it
 * @param answer what the stubbed `fetch` does when the configuration is requested
 * @param providers extra providers the case needs, such as a translate service with a language selected
 */
function createHarness(
  search = '',
  hash = '',
  answer: FetchAnswer = SERVED,
  providers: readonly Provider[] = [],
): ConfigHarness {
  const fetchMock = vi.fn<typeof fetch>(() => responseFor(answer));

  vi.stubGlobal('fetch', fetchMock);
  TestBed.configureTestingModule({
    providers: [{ provide: DOCUMENT, useValue: fakeDocument(search, hash) }, ...providers],
  });

  return { service: TestBed.inject(AppConfigService), fetchMock };
}

/**
 * Asserts the read happened exactly once, for the configuration path, with no second argument: a
 * plain `fetch(url)` is a `GET` with no headers, which is what keeps the static asset request free of
 * the tenant and authorization headers (Rule 1 clause 9).
 */
function expectSingleRead(harness: ConfigHarness): void {
  expect(harness.fetchMock).toHaveBeenCalledTimes(1);
  expect(harness.fetchMock).toHaveBeenCalledWith(CONFIG_URL);
  expect(harness.fetchMock.mock.calls[0]).toHaveLength(1);
}

/**
 * The `Error` a rejected `load()` was given, so a test can assert on what the operator would read.
 *
 * Awaiting the promise here keeps the rejection from escaping as an unhandled rejection, and a
 * resolution fails the test rather than leaving it without the error it expected.
 */
async function rejectionOf(load: Promise<AppConfig>): Promise<Error> {
  try {
    await load;
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }

    throw new Error(`load() rejected with a value that is not an Error: ${String(error)}`);
  }

  throw new Error('load() resolved although this configuration must be rejected');
}

/**
 * The served body as a mutable record, for the cases whose defect is a bad, blank, zero or missing
 * key.
 *
 * @param overrides the keys this case changes or adds
 */
function servedRecord(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { ...SERVED_CONFIG, ...overrides };
}

/**
 * The served body with one key removed, the way a hand-trimmed or truncated file arrives.
 *
 * @param key the key this case omits
 */
function withoutKey(key: keyof AppConfig): Record<string, unknown> {
  const body = servedRecord();

  delete body[key];

  return body;
}

describe('AppConfigService', () => {
  beforeEach(() => {
    // Reset explicitly rather than relying on the runner: a second `configureTestingModule` on an
    // instantiated module throws.
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  describe('load()', () => {
    it('makes one plain GET for the served file and resolves all eight of its values', async () => {
      const harness = createHarness();

      const config = await harness.service.load();

      expectSingleRead(harness);
      expect(config).toEqual(SERVED_CONFIG);
      expect(Object.keys(config)).toHaveLength(8);

      // The values every date-bearing payload and every idle timer depend on (AAP 0.7.2).
      expect(config.dateFormat).toBe('dd MMMM yyyy');
      expect([config.idleMinutes, config.warningSeconds, config.keepaliveMinutes]).toEqual([30, 10, 15]);
    });

    it('exposes null from changes() until load() resolves, then the resolved configuration', async () => {
      const harness = createHarness();

      expect(harness.service.changes()).toBeNull();

      const config = await harness.service.load();

      expect(harness.service.changes()).not.toBeNull();
      expect(harness.service.changes()).toEqual(config);
      expect(harness.service.config).toEqual(config);
    });
  });

  describe('override precedence', () => {
    it('applies ?baseApiUrl= and ?tenantIdentifier= from the query string over the served file', async () => {
      const harness = createHarness('?baseApiUrl=https://parity.example:9443&tenantIdentifier=blitzy-tenant_01');

      const config = await harness.service.load();

      expect(config.apiBaseUrl).toBe('https://parity.example:9443');
      expect(config.tenantId).toBe('blitzy-tenant_01');

      // Only the two overridable keys move; every other value is the one the file supplied.
      expect(config).toEqual({
        ...SERVED_CONFIG,
        apiBaseUrl: 'https://parity.example:9443',
        tenantId: 'blitzy-tenant_01',
      });
    });

    it('reads the same two overrides out of the hash query form', async () => {
      const harness = createHarness('', '#/clients?baseApiUrl=https://hash.example:7443&tenantIdentifier=hash_tenant');

      const config = await harness.service.load();

      expect(config.apiBaseUrl).toBe('https://hash.example:7443');
      expect(config.tenantId).toBe('hash_tenant');
    });

    it('lets the real query string win over a hash query value for the same parameter', async () => {
      const harness = createHarness(
        '?baseApiUrl=https://search.example:8443&tenantIdentifier=search_tenant',
        '#/clients?baseApiUrl=https://hash.example:7443&tenantIdentifier=hash_tenant',
      );

      const config = await harness.service.load();

      expect(config.apiBaseUrl).toBe('https://search.example:8443');
      expect(config.tenantId).toBe('search_tenant');
    });

    it('keeps the configured host and tenant for an empty ?baseApiUrl= and ?tenantIdentifier=', async () => {
      const harness = createHarness('?baseApiUrl=&tenantIdentifier=');

      const config = await harness.service.load();

      expect(config.apiBaseUrl).toBe(SERVED_CONFIG.apiBaseUrl);
      expect(config.tenantId).toBe(SERVED_CONFIG.tenantId);
    });
  });

  describe('served-file rejection', () => {
    it('rejects a body that is not a JSON object, naming the file', async () => {
      const harness = createHarness('', '', { kind: 'served', body: [SERVED_CONFIG] });

      const error = await rejectionOf(harness.service.load());

      expect(error.message).toContain(CONFIG_URL);
      expect(error.message).toContain('must hold a JSON object');
    });

    const incompleteBodies: readonly (readonly [string, Record<string, unknown>, string])[] = [
      ['a missing apiBaseUrl', withoutKey('apiBaseUrl'), "'apiBaseUrl'"],
      ['a missing apiPath', withoutKey('apiPath'), "'apiPath'"],
      ['a missing tenantId', withoutKey('tenantId'), "'tenantId'"],
      ['a dateFormat other than the Fineract contract', servedRecord({ dateFormat: 'dd/MM/yyyy' }), "'dateFormat'"],
      ['a blank locale', servedRecord({ locale: '   ' }), "'locale'"],
      ['a zero idleMinutes', servedRecord({ idleMinutes: 0 }), "'idleMinutes'"],
    ];

    it.each(incompleteBodies)('rejects %s, naming the file and the key', async (_case, body, fragment) => {
      const harness = createHarness('', '', { kind: 'served', body });

      const error = await rejectionOf(harness.service.load());

      expect(error.message).toContain(CONFIG_URL);
      expect(error.message).toContain(fragment);

      // Nothing was published: the signal stays empty and `config` keeps throwing, so no consumer can
      // read a configuration the service refused (AAP 0.4.4 decision 5 — no fallback).
      expect(harness.service.changes()).toBeNull();
      expect(() => harness.service.config).toThrow(/not resolved yet/);
    });

    // A schemeless or relative `apiBaseUrl` used to be accepted and resolved against the
    // application's own origin, so every API call received the SPA's index.html while the
    // application reported a healthy start. `web-ng/docker/entrypoint.sh` rejects exactly these
    // inputs for `API_BASE_URL`; the two layers now agree on what the setting may be.
    const invalidValues: readonly (readonly [string, Record<string, unknown>, string, string])[] = [
      ['a schemeless apiBaseUrl', servedRecord({ apiBaseUrl: 'localhost:8443' }), "'apiBaseUrl'", 'absolute URL'],
      // A dot-relative value is another way the browser would resolve the host against the
      // application's own origin, so the same rule refuses it.
      ['a relative apiBaseUrl', servedRecord({ apiBaseUrl: './fineract-provider' }), "'apiBaseUrl'", 'absolute URL'],
      [
        'an apiBaseUrl carrying whitespace',
        servedRecord({ apiBaseUrl: 'https://local host:8443' }),
        "'apiBaseUrl'",
        'absolute URL',
      ],
      ['an upper-case scheme', servedRecord({ apiBaseUrl: 'HTTPS://localhost:8443' }), "'apiBaseUrl'", 'absolute URL'],
      [
        'a tenantId outside the header-safe charset',
        servedRecord({ tenantId: 'default tenant' }),
        "'tenantId'",
        'letters, digits, dot, underscore, hyphen',
      ],
    ];

    it.each(invalidValues)('rejects %s, naming the key and the rule', async (_case, body, key, rule) => {
      const harness = createHarness('', '', { kind: 'served', body });

      const error = await rejectionOf(harness.service.load());

      expect(error.message).toContain(CONFIG_URL);
      expect(error.message).toContain(key);
      expect(error.message).toContain(rule);
    });
  });

  describe('override rejection', () => {
    it('rejects a relative ?baseApiUrl= and names the parameter', async () => {
      const harness = createHarness('?baseApiUrl=localhost:8443');

      const error = await rejectionOf(harness.service.load());

      expect(error.message).toContain('?baseApiUrl=');
      expect(error.message).toContain('absolute URL');
    });

    it('rejects a ?tenantIdentifier= outside the header-safe charset and names the parameter', async () => {
      const harness = createHarness('?tenantIdentifier=t%20x');

      const error = await rejectionOf(harness.service.load());

      expect(error.message).toContain('?tenantIdentifier=');
      expect(error.message).toContain('letters, digits, dot, underscore, hyphen');
    });

    it('reports both bad parameters in one rejection rather than one per reload', async () => {
      const harness = createHarness('?baseApiUrl=/relative&tenantIdentifier=t%20x');

      const error = await rejectionOf(harness.service.load());

      expect(error.message).toContain('?baseApiUrl=');
      expect(error.message).toContain('?tenantIdentifier=');
    });

    // Values `web-ng/docker/entrypoint.sh` refuses for `API_BASE_URL`'s scheme and characters.
    // Accepting them here would restore the disagreement the absolute-URL rule removes.
    const entrypointRefusedValues: readonly (readonly [string, string])[] = [
      ['an upper-case scheme', '?baseApiUrl=HTTPS://Parity.Example:9443'],
      ['a backslash in the value', '?baseApiUrl=https%3A%2F%2Fparity.example%3A9443%5Cpath'],
      ['a quote in the value', '?baseApiUrl=https%3A%2F%2Fparity.example%3A9443%22x'],
    ];

    it.each(entrypointRefusedValues)('rejects %s, as the container path does', async (_case, search) => {
      const harness = createHarness(search);

      const error = await rejectionOf(harness.service.load());

      expect(error.message).toContain('?baseApiUrl=');
      expect(error.message).toContain('absolute URL');
    });
  });

  describe('apiUrl()', () => {
    it('joins the configured base, API path and resource with exactly one slash', async () => {
      const harness = createHarness();

      await harness.service.load();

      expect(harness.service.apiUrl('clients')).toBe('https://localhost:8443/fineract-provider/api/v1/clients');
      expect(harness.service.apiUrl('loans/42')).toBe('https://localhost:8443/fineract-provider/api/v1/loans/42');
    });

    it('accepts a leading slash on the resource without doubling the join', async () => {
      const harness = createHarness();

      await harness.service.load();

      expect(harness.service.apiUrl('/clients')).toBe('https://localhost:8443/fineract-provider/api/v1/clients');
    });

    it('drops trailing slashes from the base and the API path', async () => {
      const harness = createHarness('', '', {
        kind: 'served',
        body: servedRecord({ apiBaseUrl: 'https://localhost:8443/', apiPath: '/fineract-provider/api/v1/' }),
      });

      await harness.service.load();

      expect(harness.service.apiUrl('clients')).toBe('https://localhost:8443/fineract-provider/api/v1/clients');
    });

    it('yields the API root for a path with no resource segment', async () => {
      const harness = createHarness();

      await harness.service.load();

      // The expected URL is composed from the served values: the API root is not an endpoint the
      // application requests, so it is declared in no parity list and must not be written as one.
      expect(harness.service.apiUrl(EMPTY_RESOURCE_PATH)).toBe(API_ROOT_URL);
      expect(harness.service.apiUrl(SLASHES_ONLY_RESOURCE_PATH)).toBe(API_ROOT_URL);
    });

    it('passes a query string through untouched and never collapses an inner double slash', async () => {
      const harness = createHarness();

      await harness.service.load();

      // A query string belongs to the caller's `HttpParams`; `apiUrl()` neither re-encodes nor reorders
      // what it is handed, and an inner `//` is the caller's path rather than a join it may repair, so
      // the URL a service sends stays byte-identical to the one the legacy application sent (Rule 1
      // clause 2).
      expect(harness.service.apiUrl('clients?limit=-1')).toBe(
        'https://localhost:8443/fineract-provider/api/v1/clients?limit=-1',
      );
      expect(harness.service.apiUrl('loans//42')).toBe('https://localhost:8443/fineract-provider/api/v1/loans//42');
    });

    it('yields the configured base for a slash-only apiPath', async () => {
      // A deployment may configure the API root as `/`; the join then has no root segment to add and
      // the base alone is the composed URL, still without a trailing slash.
      const harness = createHarness('', '', { kind: 'served', body: servedRecord({ apiPath: '/' }) });

      await harness.service.load();

      expect(harness.service.apiUrl(EMPTY_RESOURCE_PATH)).toBe(SERVED_CONFIG.apiBaseUrl);
    });

    it('throws before the configuration is resolved instead of composing a URL against nothing', () => {
      const harness = createHarness();

      expect(() => harness.service.apiUrl('clients')).toThrow(/not resolved yet/);
      expect(() => harness.service.config).toThrow(/not resolved yet/);
    });
  });

  describe('failure reporting', () => {
    it('reports a body that is not JSON as unparseable, never as the success its status suggests', async () => {
      // What a `config.json` served as HTML (a missing file, an SPA fallback) produces: an OK status
      // whose body cannot be decoded, so the text must name the body rather than print a 200.
      const harness = createHarness('', '', { kind: 'not-json' });

      const error = await rejectionOf(harness.service.load());

      expect(error.message).toContain(CONFIG_URL);
      expect(error.message).toContain('the response was not valid JSON');
      expect(error.message).not.toContain('200 OK');
      expect(error.message).not.toContain('HTTP 200');
    });

    const serverStatuses: readonly {
      readonly label: string;
      readonly status: number;
      readonly statusText: string;
      readonly described: string;
    }[] = [
      {
        label: 'a 404 with its status text',
        status: 404,
        statusText: 'Not Found',
        described: 'HTTP 404 Not Found',
      },
      {
        label: 'a 500 with its status text',
        status: 500,
        statusText: 'Server Error',
        described: 'HTTP 500 Server Error',
      },
      {
        label: 'a status the server sent no status text with',
        status: 503,
        statusText: '',
        described: 'HTTP 503',
      },
    ];

    it.each(serverStatuses)('reports $label', async ({ status, statusText, described }) => {
      const harness = createHarness('', '', { kind: 'status', status, statusText });

      const error = await rejectionOf(harness.service.load());

      expect(error.message).toContain(CONFIG_URL);
      expect(error.message).toContain(described);

      // No substituted host: the rejection names the file and the fix, never a server the application
      // could quietly call instead, and the configuration stays unresolved (AAP 0.4.4 decision 5).
      expect(error.message).not.toContain(SERVED_CONFIG.apiBaseUrl);
      expect(() => harness.service.config).toThrow(/not resolved yet/);
    });

    it('reports a request that reached no server as a network error', async () => {
      const harness = createHarness('', '', { kind: 'unreachable' });

      const error = await rejectionOf(harness.service.load());

      expect(error.message).toContain(CONFIG_URL);
      expect(error.message).toContain('a network error');
      expect(error.message).not.toContain('HTTP');
    });
  });

  describe('activeLocale', () => {
    it('throws before load() when no translate service can report a selected language', () => {
      const harness = createHarness();

      // Neither source exists yet: no bundle is selected and no configuration is resolved, so there is
      // no locale to report and the read fails exactly as `config` does.
      expect(() => harness.service.activeLocale()).toThrow(/not resolved yet/);
    });

    it('reports the configured starting language when no language has been selected', async () => {
      const harness = createHarness();

      await harness.service.load();

      expect(harness.service.activeLocale()).toBe(SERVED_CONFIG.locale);
    });

    it('follows the language the translate service has selected', async () => {
      const selected = signal('fr');
      // Only `currentLang` is read — the signal the language switchers drive — so the cast is the one
      // boundary where that member stands in for the service (Rule 1 clause 4).
      const translate = { currentLang: selected.asReadonly() } as unknown as TranslateService;
      const harness = createHarness('', '', SERVED, [{ provide: TranslateService, useValue: translate }]);

      await harness.service.load();

      // A language chosen after startup has to reach the next date-bearing payload, because every one
      // of them carries `dateFormat` with this locale (AAP 0.1.1 date discipline).
      expect(harness.service.activeLocale()).toBe('fr');

      selected.set('sw');
      expect(harness.service.activeLocale()).toBe('sw');
    });
  });
});
