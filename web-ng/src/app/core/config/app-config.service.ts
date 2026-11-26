// `DOCUMENT` is declared by `@angular/core`; `@angular/common` only re-exports the same token for code written before v20.
import { DOCUMENT, Injectable, Injector, computed, inject, signal, type Signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import { FINERACT_DATE_FORMAT, type AppConfig } from './app-config.model';

/** Path of the runtime configuration file, stated relative with no leading slash so it resolves against the served page's `<base href="/">`, which is what lets the container entrypoint rewrite it in place at `/assets/config.json`. */
const CONFIG_ASSET_URL = 'assets/config.json';

/** The two page-URL parameters that override the served file, under the exact names the legacy URL scheme and the parity harness use; nothing else in the page URL reaches the configuration. */
const BASE_API_URL_PARAM = 'baseApiUrl';
const TENANT_ID_PARAM = 'tenantIdentifier';

/** Every key `assets/config.json` must carry, tied to `AppConfig` by `satisfies`, so renaming or dropping a field breaks the build here instead of leaving validation checking a key that no longer exists. */
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

/** The only form `apiBaseUrl` may take: an absolute `http://` or `https://` URL with none of the characters `web-ng/docker/entrypoint.sh` refuses for `API_BASE_URL`, because the two layers accept the same setting — a relative value would be resolved against the application's own origin and every API call would receive the served `index.html`. */
const ABSOLUTE_HTTP_URL = /^https?:\/\/[^\s"\\\u0000-\u001F\u007F]+$/;

/** How an unacceptable `apiBaseUrl` is described: the same words for the served file and for the page-URL override, so the requirement cannot drift between the two paths that accept it. */
const ABSOLUTE_URL_REQUIREMENT =
  'must be an absolute URL (http:// or https://) without whitespace, control characters, a quote or a backslash';

/** The tenant identifier's characters: exactly the set `web-ng/docker/entrypoint.sh` allows for `TENANT_ID`, because the value travels as the `Fineract-Platform-TenantId` header and a value a browser refuses to send fails every request. */
const TENANT_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** A JSON object: the only shape `assets/config.json` may present. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The rejection text for a configuration read that failed: it names the file to serve, the fix an operator has and the fact that no fallback host exists, so `fetchRawConfig` supplies only what actually broke. */
function configReadError(detail: string): string {
  return (
    `Cannot read the application's runtime configuration from ${CONFIG_ASSET_URL} (${detail}). ` +
    'The application needs that configuration before it can start and will not fall back to a default or ' +
    'alternative Fineract host. Serve web-ng/src/assets/config.json — in a container the entrypoint writes it ' +
    'from API_BASE_URL and TENANT_ID — and reload.'
  );
}

/** Resolves the application's runtime configuration once, before the first navigation, and hands the result to everyone else: `apiBaseUrl`, `apiPath`, `tenantId`, the fixed `dateFormat`, the `locale` the deployment starts (AAP 0.4.4, AAP 0.7.1, AAP 0.1.1, AAP 0.10.5). */
@Injectable({ providedIn: 'root' })
export class AppConfigService {
  /** Injected rather than read off the `document` global, so a test can supply a document of its own. */
  private readonly document = inject(DOCUMENT);

  private readonly state = signal<AppConfig | null>(null);

  /** The resolved configuration, or `null` until `load()` has published one. */
  readonly changes: Signal<AppConfig | null> = this.state.asReadonly();

  /** Resolves the translate service only when `activeLocale` is read, never during construction. */
  private readonly injector = inject(Injector);

  /** The locale every date-bearing Fineract payload must carry: the locale of the selected language, as AAP 0.1.1's date discipline requires ("every date-bearing payload carries `dateFormat` and the `locale` of the selected (AAP 0.7.2). */
  readonly activeLocale: Signal<string> = computed(() => {
    const translate = this.injector.get<TranslateService | null>(TranslateService, null, {
      optional: true,
    });

    return translate?.currentLang() ?? this.requireConfig().locale;
  });

  /** Fetches, validates, overrides and publishes the configuration. */
  async load(): Promise<AppConfig> {
    const raw = await this.fetchRawConfig();
    const shipped = this.parseAppConfig(raw);
    const overrides = this.readQueryOverrides();

    // Overrides are applied as a new object rather than by mutation, so the resolved value is fixed at construction and no query parameter can reach a key other than these two.
    const resolved: AppConfig = {
      ...shipped,
      ...(overrides.baseApiUrl === undefined ? {} : { apiBaseUrl: overrides.baseApiUrl }),
      ...(overrides.tenantIdentifier === undefined ? {} : { tenantId: overrides.tenantIdentifier }),
    };

    this.state.set(resolved);
    return resolved;
  }

  /** The resolved configuration. Read by `app.config.ts` for the `APP_CONFIG` provider and by every service that needs the tenant, the date format or the configured starting language. @throws Error when read before `load()`. */
  get config(): AppConfig {
    return this.requireConfig();
  }

  /** The resolved configuration, or the throw documented on `config`. */
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

  /** Composes a Fineract URL from the configured `apiBaseUrl`, the configured `apiPath` and the relative resource path a service owns, with exactly one `/` at each join. @param path a relative resource path such as (Rule 1 clause 2). */
  apiUrl(path: string): string {
    const { apiBaseUrl, apiPath } = this.config;
    const base = apiBaseUrl.replace(/\/+$/, '');
    const root = apiPath.replace(/^\/+/, '').replace(/\/+$/, '');
    const resource = path.replace(/^\/+/, '');
    const suffix = [root, resource].filter((part) => part !== '').join('/');

    return suffix === '' ? base : `${base}/${suffix}`;
  }

  /** Reads the served file with the platform `fetch`. The body stays `unknown` because it is validated next, never cast: a file an operator edited by hand or a container rewrote is input, not a typed value (Rule 1 clause 4). */
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

  /** Validates the fetched body key by key and builds the `AppConfig` from it. */
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

    /** `apiBaseUrl` as this layer requires it: the absolute URL the container entrypoint would accept for `API_BASE_URL`. */
    const absoluteBaseUrl = (): string => {
      const value = text('apiBaseUrl');

      if (value === '' || ABSOLUTE_HTTP_URL.test(value)) {
        return value;
      }

      problems.push(`'apiBaseUrl' ${ABSOLUTE_URL_REQUIREMENT}`);
      return '';
    };

    /** `tenantId` as this layer requires it: non-empty and drawn from the characters the entrypoint allows for `TENANT_ID`, since the value becomes the `Fineract-Platform-TenantId` header. */
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

    /** The one format a date-bearing payload may carry. Fixed rather than merely type-checked: the Fineract contract pairs this string with the active locale, and a second format would change what the server parses (Rule 1 (Rule 1 clause 2). */
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

  /** The `?baseApiUrl=` and `?tenantIdentifier=` overrides, as the properties they replace, omitting whichever is absent so it cannot blank a configured value. */
  private readQueryOverrides(): { baseApiUrl?: string; tenantIdentifier?: string } {
    const hash = this.document.location.hash;
    const queryAt = hash.indexOf('?');
    const collected = new Map<string, string>();

    // Hash first, real query string second, so the query string wins: the parity harness always passes both parameters there, while a legacy deep link may carry them inside the hash.
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

  /** Adds one URL query string's non-blank parameters to `into`, later values replacing earlier ones so the caller's read order decides precedence. */
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
