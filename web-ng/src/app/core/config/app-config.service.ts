// `DOCUMENT` is declared by `@angular/core`; `@angular/common` only re-exports the same token for
// code written before v20, so the owning package is the import that cannot go stale.
import { DOCUMENT, Injectable, Injector, computed, inject, signal, type Signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import { FINERACT_DATE_FORMAT, type AppConfig } from './app-config.model';

/**
 * Path of the runtime configuration file, stated relative with no leading slash so it resolves
 * against the served page's `<base href="/">`. That is what lets the container entrypoint rewrite
 * the file in place at `/assets/config.json` and have this request read the rewritten content.
 */
const CONFIG_ASSET_URL = 'assets/config.json';

/**
 * The two page-URL parameters that override the served file, under the exact names the legacy URL
 * scheme and the parity harness use. Nothing else in the page URL can reach the configuration.
 */
const BASE_API_URL_PARAM = 'baseApiUrl';
const TENANT_ID_PARAM = 'tenantIdentifier';

/**
 * Every key `assets/config.json` must carry. Tied to `AppConfig` by `satisfies`, so renaming or
 * dropping a field breaks the build here instead of leaving validation checking a key that no
 * longer exists.
 */
const CONFIG_KEYS = [
  'apiBaseUrl',
  'apiPath',
  'tenantId',
  'dateFormat',
  'locale',
  'idleMinutes',
  'warningSeconds',
  'keepaliveMinutes',
] as const satisfies readonly (keyof AppConfig)[];

/**
 * The only form `apiBaseUrl` may take: an absolute `http://` or `https://` URL carrying none of the
 * characters `web-ng/docker/entrypoint.sh` refuses for `API_BASE_URL` — whitespace, a control
 * character, a quote or a backslash — with the scheme matched exactly as the entrypoint's own
 * `case` matches it, lower case only. The two layers accept the same setting and have to agree on
 * what it may be: a relative value is resolved by the browser against the application's own origin,
 * so every API call would receive the served `index.html` instead of Fineract's answer while the
 * application reported a healthy start.
 */
const ABSOLUTE_HTTP_URL = /^https?:\/\/[^\s"\\\u0000-\u001F\u007F]+$/;

/**
 * How an unacceptable `apiBaseUrl` is described: the same words for the served file and for the
 * page-URL override, so the requirement cannot drift between the two paths that accept it.
 */
const ABSOLUTE_URL_REQUIREMENT =
  'must be an absolute URL (http:// or https://) without whitespace, control characters, a quote or a backslash';

/**
 * The tenant identifier's characters: exactly the set `web-ng/docker/entrypoint.sh` allows for
 * `TENANT_ID`. The value travels as the `Fineract-Platform-TenantId` request header, and a value a
 * browser refuses to send fails every request, so the same rule is applied on this path too.
 */
const TENANT_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** A JSON object: the only shape `assets/config.json` may present. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The rejection text for a configuration read that failed. Every failure names the file to serve, the
 * fix an operator has and the fact that no fallback host exists, so the only part `fetchRawConfig`
 * supplies is what actually broke: a transport failure, a non-2xx status or a body that is not JSON.
 */
function configReadError(detail: string): string {
  return (
    `Cannot read the application's runtime configuration from ${CONFIG_ASSET_URL} (${detail}). ` +
    'The application needs that configuration before it can start and will not fall back to a default or ' +
    'alternative Fineract host. Serve web-ng/src/assets/config.json — in a container the entrypoint writes it ' +
    'from API_BASE_URL and TENANT_ID — and reload.'
  );
}

/**
 * Resolves the application's runtime configuration once, before the first navigation, and hands
 * the result to everyone else: `apiBaseUrl`, `apiPath`, `tenantId`, the fixed `dateFormat`, the
 * `locale` the deployment starts in, the `activeLocale` a date-bearing payload carries and the three
 * idle values (AAP 0.4.4 decision 5; AAP 0.7.1 core row "`AppConfigService`").
 *
 * **Two locales, one of them live.** `config.locale` is the configured starting language — the
 * deployment's default, fixed once `load()` resolves, and the language `app.config.ts` hands the
 * i18n stack once the configuration is in hand. `activeLocale` is the language the user currently
 * has selected, which is the locale AAP 0.1.1's date discipline requires every payload to carry;
 * the two read the same until a switcher selects another language.
 *
 * **Precedence, lowest first.** The `assets/config.json` this build ships; the same served file as
 * the container entrypoint rewrote it from `API_BASE_URL` and `TENANT_ID`; then the page URL's
 * `?baseApiUrl=` and `?tenantIdentifier=`, which win over both. The application never sees which of
 * the first two produced the file it read, and the third is applied last so an operator can repoint
 * a running build from the address bar — which is why the parity harness always passes both.
 *
 * **No fallback, by design.** When the file cannot be read or is incomplete, `load()` rejects and
 * the application does not start. It does not substitute a default host and does not keep going on
 * `DEFAULT_APP_CONFIG`: the legacy application's demo-host fallback is deliberately not reproduced
 * (AAP 0.10.5; Rule 2), because a front end that quietly calls a server nobody configured turns a
 * deployment mistake into wrong data in the wrong tenant.
 *
 * **The file is read with `fetch`, not `HttpClient`.** `assets/config.json` is a same-origin static
 * asset: it carries no tenant or authorization header, names no Fineract endpoint and owns no URL, so
 * this file is not one of the seven `HttpClient`-owning files AAP 0.14.1 exempts from the lint ban and
 * its read never passes through the HTTP interceptor.
 *
 * **This file is the only place `apiBaseUrl` and `apiPath` are joined.** Every service asks
 * `apiUrl()` for its URL, so a request's host and API root cannot drift between features, and the
 * HTTP interceptor rewrites no URL (AAP 0.4.2).
 */
@Injectable({ providedIn: 'root' })
export class AppConfigService {
  /** Injected rather than read off the `document` global, so a test can supply a document of its own. */
  private readonly document = inject(DOCUMENT);

  private readonly state = signal<AppConfig | null>(null);

  /**
   * The resolved configuration, or `null` until `load()` has published one.
   *
   * This nullable signal is the surface for callers that can run before resolution — an initializer, a
   * guard or a component that starts while the configuration read is still in flight. Such a caller
   * reads `changes()` and skips its work while the value is `null`; it must never read `config`, which
   * throws until resolution. The configuration read itself is not one of those callers: it runs on
   * `fetch` before anything else starts, so it carries no header and passes through no interceptor.
   */
  readonly changes: Signal<AppConfig | null> = this.state.asReadonly();

  /**
   * Resolves the translate service only when `activeLocale` is read, never during construction.
   *
   * Injecting `TranslateService` directly would construct it here, and its constructor immediately
   * loads the starting bundle (`use(lang)`), which issues an `HttpClient` request. That request runs
   * the application's single HTTP interceptor, and the interceptor resolves this very service to
   * read the tenant — so a request issued mid-construction would re-enter a service that does not
   * exist yet and Angular throws `NG0200: Circular dependency detected`. The translate HTTP loader
   * catches that failure and falls back to an empty bundle, so the application would start with no
   * translations at all and every label would render humanised, which is exactly what the
   * missing-translation handler is meant to stay ahead of. Resolving the service at read time keeps
   * the two out of each other's construction.
   */
  private readonly injector = inject(Injector);

  /**
   * The locale every date-bearing Fineract payload must carry: the locale of the selected language,
   * as AAP 0.1.1's date discipline requires ("every date-bearing payload carries `dateFormat` and
   * the `locale` of the selected language") and AAP 0.7.2's "Date handling" describes. It is the
   * language the user currently has selected, read from the translate service the language switchers
   * drive with `TranslateService.use(code)`, so a language chosen after startup reaches the next
   * payload rather than only the next screen.
   *
   * It equals the resolved configuration's `locale` — the language the deployment starts in — until
   * and unless a bundle is selected. With no translate service registered it stays on that
   * configured value for the lifetime of the injector.
   *
   * @throws Error, exactly as `config` does, when read before `load()` resolved and no translate
   * service is present: there is then neither a selected nor a configured language to report.
   */
  readonly activeLocale: Signal<string> = computed(() => {
    const translate = this.injector.get<TranslateService | null>(TranslateService, null, {
      optional: true,
    });

    return translate?.currentLang() ?? this.requireConfig().locale;
  });

  /**
   * Fetches, validates, overrides and publishes the configuration. Awaited by the
   * `provideAppInitializer` in `web-ng/src/app/app.config.ts` before the first navigation, so no
   * route, guard, component or interceptor runs against an unresolved signal.
   *
   * Called a second time it fetches and republishes again, which is harmless: the value it returns is
   * what the caller gets, and both of them describe the same file.
   *
   * @returns the resolved configuration, identical to what `changes()` then reports.
   * @throws Error when the file cannot be read, is not a JSON object, or lacks a well-formed key, and
   * when a `?baseApiUrl=` or `?tenantIdentifier=` override is not a value this layer can use.
   */
  async load(): Promise<AppConfig> {
    const raw = await this.fetchRawConfig();
    const shipped = this.parseAppConfig(raw);
    const overrides = this.readQueryOverrides();

    // Overrides are applied as a new object rather than by mutation, so the resolved value is fixed
    // at construction and no query parameter can reach a key other than these two.
    const resolved: AppConfig = {
      ...shipped,
      ...(overrides.baseApiUrl === undefined ? {} : { apiBaseUrl: overrides.baseApiUrl }),
      ...(overrides.tenantIdentifier === undefined ? {} : { tenantId: overrides.tenantIdentifier }),
    };

    this.state.set(resolved);
    return resolved;
  }

  /**
   * The resolved configuration. Read by `app.config.ts` for the `APP_CONFIG` provider and by every
   * service that needs the tenant, the date format or the configured starting language.
   *
   * @throws Error when read before `load()` resolved, because returning
   * `DEFAULT_APP_CONFIG` instead would let the application call a server nobody configured.
   */
  get config(): AppConfig {
    return this.requireConfig();
  }

  /**
   * The resolved configuration, or the throw documented on `config`. It is the one body behind
   * `config` and `activeLocale`, so both report an unresolved read with the same message instead of
   * each carrying its own copy of it.
   */
  private requireConfig(): AppConfig {
    const resolved = this.state();

    if (resolved === null) {
      throw new Error(
        'The application configuration is not resolved yet: AppConfigService.load() must be awaited before ' +
          'config, apiUrl() or the active locale reads it. web-ng/src/app/app.config.ts awaits load() in a ' +
          'provideAppInitializer, ahead of the first navigation.',
      );
    }

    return resolved;
  }

  /**
   * Composes a Fineract URL from the configured `apiBaseUrl`, the configured `apiPath` and the
   * relative resource path a service owns, with exactly one `/` at each join.
   *
   * @param path a relative resource path such as `'clients'` or `'loans/' + id`; a leading slash is
   * accepted and a trailing one is part of the path. An empty path yields the API root.
   * @returns the absolute URL to request.
   *
   * The path is used as given apart from its leading slashes: no encoding, decoding, `new URL()`
   * parsing or collapsing of inner `//`, because the URL a service sends has to be byte-identical to
   * the one the legacy application sent (Rule 1 clause 2) and `npm run check:endpoints` matches the
   * literal path the service owns. Query parameters belong in `HttpParams` at the call site, never
   * in `path`.
   */
  apiUrl(path: string): string {
    const { apiBaseUrl, apiPath } = this.config;
    const base = apiBaseUrl.replace(/\/+$/, '');
    const root = apiPath.replace(/^\/+/, '').replace(/\/+$/, '');
    const resource = path.replace(/^\/+/, '');
    const suffix = [root, resource].filter((part) => part !== '').join('/');

    return suffix === '' ? base : `${base}/${suffix}`;
  }

  /**
   * Reads the served file with the platform `fetch`. The body stays `unknown` because it is validated
   * next, never cast: a file an operator edited by hand or a container rewrote is input, not a typed
   * value (Rule 1 clause 4).
   *
   * The three ways the read can fail are distinguishable in the rejection's text — the request never
   * reached the server, the server answered with a status, the body was not JSON — but all of them name
   * the file and the operator's fix, because the caller's only recovery is to fix what is served.
   */
  private async fetchRawConfig(): Promise<unknown> {
    let response: Response;

    try {
      response = await fetch(CONFIG_ASSET_URL);
    } catch (error: unknown) {
      throw new Error(configReadError('a network error'), { cause: error });
    }

    if (!response.ok) {
      const status =
        response.statusText === '' ? `HTTP ${response.status}` : `HTTP ${response.status} ${response.statusText}`;

      throw new Error(configReadError(status));
    }

    try {
      const body: unknown = await response.json();

      return body;
    } catch (error: unknown) {
      throw new Error(configReadError('the response was not valid JSON'), { cause: error });
    }
  }

  /**
   * Validates the fetched body key by key and builds the `AppConfig` from it. Every problem is
   * collected before anything is thrown, so an operator fixing a hand-edited file sees all of them at
   * once instead of one per reload.
   */
  private parseAppConfig(raw: unknown): AppConfig {
    if (!isRecord(raw)) {
      const required = CONFIG_KEYS.map((key) => `'${key}'`).join(', ');

      throw new Error(
        `Invalid configuration in ${CONFIG_ASSET_URL}: the file must hold a JSON object with the keys ${required}. ` +
          'Fix web-ng/src/assets/config.json (in a container, set API_BASE_URL and TENANT_ID); the application will ' +
          'not start with an incomplete configuration and will not substitute a default host.',
      );
    }

    const record = raw;
    const problems: string[] = [];

    /** A present, non-blank string, trimmed of the whitespace a hand-edited file tends to carry. */
    const text = (key: keyof AppConfig): string => {
      const value = record[key];

      if (typeof value === 'string' && value.trim() !== '') {
        return value.trim();
      }

      problems.push(`'${key}' must be a non-empty string`);
      return '';
    };

    /**
     * `apiBaseUrl` as this layer requires it: the absolute URL the container entrypoint would accept
     * for `API_BASE_URL`. A value `text()` has already rejected is not reported twice.
     */
    const absoluteBaseUrl = (): string => {
      const value = text('apiBaseUrl');

      if (value === '' || ABSOLUTE_HTTP_URL.test(value)) {
        return value;
      }

      problems.push(`'apiBaseUrl' ${ABSOLUTE_URL_REQUIREMENT}`);
      return '';
    };

    /**
     * `tenantId` as this layer requires it: non-empty and drawn from the characters the entrypoint
     * allows for `TENANT_ID`, since the value becomes the `Fineract-Platform-TenantId` header.
     */
    const tenantIdentifier = (): string => {
      const value = text('tenantId');

      if (value === '' || TENANT_ID_PATTERN.test(value)) {
        return value;
      }

      problems.push("'tenantId' must be non-empty: letters, digits, dot, underscore, hyphen");
      return '';
    };

    /** A present, finite, positive number: all three numeric keys are durations that must be usable. */
    const positive = (key: keyof AppConfig): number => {
      const value = record[key];

      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
      }

      problems.push(`'${key}' must be a finite number greater than zero`);
      return 0;
    };

    /**
     * The one format a date-bearing payload may carry. Fixed rather than merely type-checked: the
     * Fineract contract pairs this string with the active locale, and a second format would change
     * what the server parses (Rule 1 clause 2).
     */
    const dateFormat = (): typeof FINERACT_DATE_FORMAT => {
      if (record['dateFormat'] === FINERACT_DATE_FORMAT) {
        return FINERACT_DATE_FORMAT;
      }

      problems.push(`'dateFormat' must be '${FINERACT_DATE_FORMAT}'`);
      return FINERACT_DATE_FORMAT;
    };

    const config: AppConfig = {
      apiBaseUrl: absoluteBaseUrl(),
      apiPath: text('apiPath'),
      tenantId: tenantIdentifier(),
      dateFormat: dateFormat(),
      locale: text('locale'),
      idleMinutes: positive('idleMinutes'),
      warningSeconds: positive('warningSeconds'),
      keepaliveMinutes: positive('keepaliveMinutes'),
    };

    if (problems.length > 0) {
      throw new Error(
        `Invalid configuration in ${CONFIG_ASSET_URL}: ${problems.join('; ')}. ` +
          'Fix web-ng/src/assets/config.json (in a container, set API_BASE_URL and TENANT_ID); the application will ' +
          'not start with an incomplete configuration and will not substitute a default host.',
      );
    }

    return config;
  }

  /**
   * The `?baseApiUrl=` and `?tenantIdentifier=` overrides, as the properties they replace, omitting
   * whichever is absent so it cannot blank a configured value.
   *
   * Both are held to the rules the served file's own values have already passed — an absolute
   * `apiBaseUrl` and a tenant identifier inside the header-safe character set — because an override
   * is the last writer of both and must not be the one path into `apiUrl()` or the tenant header that
   * skips them. `web-ng/docker/entrypoint.sh` applies the same two rules to the same settings.
   */
  private readQueryOverrides(): { baseApiUrl?: string; tenantIdentifier?: string } {
    const hash = this.document.location.hash;
    const queryAt = hash.indexOf('?');
    const collected = new Map<string, string>();

    // Hash first, real query string second, so the query string wins: the parity harness always passes
    // both parameters there, while a legacy deep link may carry them inside the hash. Both are read
    // because the legacy `$location.search()` saw the two alike.
    this.collectQuery(queryAt === -1 ? '' : hash.slice(queryAt + 1), collected);
    this.collectQuery(this.document.location.search, collected);

    const baseApiUrl = collected.get(BASE_API_URL_PARAM);
    const tenantIdentifier = collected.get(TENANT_ID_PARAM);
    const problems: string[] = [];

    if (baseApiUrl !== undefined && !ABSOLUTE_HTTP_URL.test(baseApiUrl)) {
      problems.push(`?${BASE_API_URL_PARAM}= ${ABSOLUTE_URL_REQUIREMENT}`);
    }

    if (tenantIdentifier !== undefined && !TENANT_ID_PATTERN.test(tenantIdentifier)) {
      problems.push(`?${TENANT_ID_PARAM}= must be non-empty: letters, digits, dot, underscore, hyphen`);
    }

    if (problems.length > 0) {
      throw new Error(
        `Invalid configuration override in the page URL: ${problems.join('; ')}. ` +
          'Correct or remove that parameter and reload: the application will not start on an override it cannot ' +
          'use, and will not fall back to a default host or tenant.',
      );
    }

    return {
      ...(baseApiUrl === undefined ? {} : { baseApiUrl }),
      ...(tenantIdentifier === undefined ? {} : { tenantIdentifier }),
    };
  }

  /**
   * Adds one URL query string's non-blank parameters to `into`, later values replacing earlier ones
   * so the caller's read order decides precedence. `URLSearchParams.forEach` reads the pairs without
   * relying on the object being iterable, so this file needs no lib beyond `DOM`.
   */
  private collectQuery(query: string, into: Map<string, string>): void {
    if (query === '') {
      return;
    }

    new URLSearchParams(query.startsWith('?') ? query.slice(1) : query).forEach((value, key) => {
      const trimmed = value.trim();

      // An empty `?baseApiUrl=` is a request to keep the configured host, not to blank it.
      if (trimmed !== '') {
        into.set(key, trimmed);
      }
    });
  }
}
