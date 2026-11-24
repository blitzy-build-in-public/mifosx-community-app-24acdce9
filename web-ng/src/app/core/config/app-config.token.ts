import { InjectionToken } from '@angular/core';
import type { AppConfig } from './app-config.model';

/**
 * Injection handle for the configuration the application resolves once at startup, before
 * the first navigation.
 *
 * **Where it is provided.** `web-ng/src/app/app.config.ts` registers it in the application's
 * provider list as
 * `{ provide: APP_CONFIG, useFactory: () => inject(AppConfigService).config }`, placed after
 * the `provideAppInitializer` that awaits `AppConfigService.load()`. That order is what makes
 * the factory safe: the initializer settles first, so the factory reads a resolved config
 * rather than a signal that is still loading.
 *
 * **Why the token supplies nothing itself.** It is constructed with no options — no
 * root-scoped provider factory and no inline factory — because Angular evaluates such a
 * factory lazily, the first time the token is injected. An injection that fires before the
 * initializer settles would read the unresolved signal and throw, reporting missing
 * configuration as an opaque dependency-injection error instead of the service's own
 * message. Provider registration also belongs in the composition file `app.config.ts`, the
 * single place where providers are declared.
 *
 * **Why it imports neither `app.config.ts` nor `app-config.service.ts`.** Importing the
 * composition file would create a provider-registration cycle, and importing the service
 * would make this token non-leaf for no gain. The token stays a leaf that both the
 * composition file and every consuming component or service can depend on.
 *
 * **What a consumer receives.** The immutable resolved `AppConfig`: eight properties —
 * `apiBaseUrl`, `apiPath`, `tenantId`, `dateFormat` (the literal `dd MMMM yyyy`), `locale`
 * (the language the application starts in; the locale a date-bearing payload carries is
 * `AppConfigService.activeLocale`), `idleMinutes`, `warningSeconds` and `keepaliveMinutes`.
 * Read it through `inject(APP_CONFIG)` and derive nothing local from it, so every screen sends
 * the same tenant header and the same date format as the legacy application did.
 */
export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');
