/**
 * The resolved runtime configuration of the application — the shape that
 * `web-ng/src/assets/config.json` carries and that `AppConfigService` hands to every
 * consumer once startup has resolved it.
 *
 * Three sources set it, lowest precedence first:
 *
 *   1. `web-ng/src/assets/config.json` as the build ships it.
 *   2. The container entrypoint's in-place rewrite of that same served file from the
 *      `API_BASE_URL` and `TENANT_ID` environment variables. It rewrites only
 *      `apiBaseUrl` and `tenantId`, so the other six keys have to survive a rewrite
 *      the application never sees.
 *   3. The page URL's `?baseApiUrl=` and `?tenantIdentifier=` query parameters, applied
 *      last and winning over both sources above.
 *
 * That order mirrors the legacy resolver at `app/scripts/initialTasks.js:5,33-44` in the
 * read-only legacy checkout, which is not part of this repository. Because the last
 * source wins, an operator can repoint a running build at another Fineract server from
 * the address bar — which is why the parity harness always passes both parameters
 * instead of trusting whatever the served file happens to hold.
 *
 * Declaration only: no imports, no classes, no functions, no validation. Loading,
 * overriding and rejecting a bad file belong to `AppConfigService`.
 */

/**
 * The one date format a date-bearing Fineract payload may send, always together with the
 * active `locale`. Fixed rather than configurable, so no screen can introduce a second
 * format and depart from the contract the legacy application established.
 */
export const FINERACT_DATE_FORMAT = 'dd MMMM yyyy' as const;

/**
 * The resolved configuration. Immutable once resolved: every consumer receives the same
 * value and no screen derives its own variation of one. In practice only `apiBaseUrl`
 * and `tenantId` differ between deployments; the rest are shared constants.
 */
export interface AppConfig {
  /** Scheme, host and port of the Fineract server, e.g. `https://localhost:8443` — no path, no `/fineract-provider`. */
  readonly apiBaseUrl: string;

  /** Fineract API root that `AppConfigService.apiUrl()` appends a resource path to. */
  readonly apiPath: string;

  /** Tenant sent on every request as the `Fineract-Platform-TenantId` header. */
  readonly tenantId: string;

  /** Literal-typed, so a date-bearing payload cannot be handed an arbitrary format. */
  readonly dateFormat: typeof FINERACT_DATE_FORMAT;

  /** Language sent alongside `dateFormat` on every date-bearing payload. */
  readonly locale: string;

  /** Idle minutes that elapse before the session times out (legacy 30). */
  readonly idleMinutes: number;

  /** Seconds of warning shown before the idle timeout fires (legacy 10). */
  readonly warningSeconds: number;

  /** Keepalive interval, in minutes, that resets the idle timer (legacy 15). */
  readonly keepaliveMinutes: number;
}

/**
 * The configuration the build ships with, and the value `AppConfigService` starts from.
 *
 * It exists so the type has a concrete value at compile time and so
 * `core/i18n/translate.config.ts` has a default `locale` to load before the first
 * translation is requested. It is deliberately not a fallback for a failed configuration
 * fetch: when `assets/config.json` cannot be read, `AppConfigService.load()` rejects and
 * the application does not start, rather than quietly calling a server nobody configured.
 */
export const DEFAULT_APP_CONFIG: AppConfig = {
  /** The only Fineract host this folder names; every other host arrives from configuration. */
  apiBaseUrl: 'https://localhost:8443',

  /** The Fineract API root every resource path in the services hangs from. */
  apiPath: '/fineract-provider/api/v1',

  /** Configuration rather than credential: it selects which tenant to call. */
  tenantId: 'default',

  dateFormat: FINERACT_DATE_FORMAT,

  /** The legacy default language. */
  locale: 'en',

  /** 30 / 10 / 15: the idle contract inherited from the legacy session configuration. */
  idleMinutes: 30,
  warningSeconds: 10,
  keepaliveMinutes: 15,
};
