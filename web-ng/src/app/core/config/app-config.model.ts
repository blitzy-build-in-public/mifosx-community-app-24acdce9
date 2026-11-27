/** The resolved runtime configuration — the shape `web-ng/src/assets/config.json` carries and `AppConfigService` hands to every consumer (AAP 0.4.4 decision 5): the served file, the container entrypoint's in-place rewrite of `apiBaseUrl` and `tenantId`, then the page URL's `?baseApiUrl=`/`?tenantIdentifier=`, which win (legacy `app/scripts/initialTasks.js:5,33-44`). Declaration only: loading, overriding and rejecting a bad file belong to `AppConfigService`. */

/** The one date format a date-bearing Fineract payload may send, always together with the active `locale`; fixed rather than configurable, so no screen can introduce a second format (Rule 1 clause 2). */
export const FINERACT_DATE_FORMAT = 'dd MMMM yyyy' as const;

/** The type of a date-bearing payload's `dateFormat` member — the literal `'dd MMMM yyyy'` — declared beside the constant so a feature model names one type instead of widening the member to `string`. */
export type AppDateFormat = typeof FINERACT_DATE_FORMAT;

/** The resolved configuration, immutable once resolved: every consumer receives the same value, and in practice only `apiBaseUrl` and `tenantId` differ between deployments. `locale` is the language the application starts in; a payload carries `AppConfigService.activeLocale`. */
export interface AppConfig {
  /** Scheme, host and port of the Fineract server, e.g. `https://localhost:8443` — no path, no `/fineract-provider`. */
  readonly apiBaseUrl: string;
  /** Fineract API root that `AppConfigService.apiUrl()` appends a resource path to. */
  readonly apiPath: string;
  /** Tenant sent on every request as the `Fineract-Platform-TenantId` header. */
  readonly tenantId: string;
  /** Literal-typed, so a date-bearing payload cannot be handed an arbitrary format. */
  readonly dateFormat: typeof FINERACT_DATE_FORMAT;
  /** The language the application starts in: the deployment's configured default, which seeds the i18n bootstrap so the first paint has text; a date-bearing payload carries `AppConfigService.activeLocale` once a language is selected. */
  readonly locale: string;
  /** Idle minutes that elapse before the session times out (legacy 30). */
  readonly idleMinutes: number;
  /** Seconds of warning shown before the idle timeout fires (legacy 10). */
  readonly warningSeconds: number;
  /** Keepalive interval, in minutes, that resets the idle timer (legacy 15). */
  readonly keepaliveMinutes: number;
}

/** The configuration the build ships with — the values `web-ng/src/assets/config.json` carries — present so the type has a compile-time value and `translate.config.ts` a starting `locale`; it is neither what `AppConfigService` starts from nor a fallback for a failed fetch, which rejects and stops the application. */
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
