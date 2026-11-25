/**
 * The application's composition root — the single place where the router, the HTTP client with its
 * one interceptor, the translation stack and the start-up configuration are declared (AAP 0.4.3 rows
 * "Fineract REST API" and "Runtime configuration"; AAP 0.8.2 "Application entry and configuration";
 * AAP 0.11.1 row `app.config.ts`). `web-ng/src/main.ts` passes this object to
 * `bootstrapApplication` and nothing else in the application registers these providers, which is what
 * makes the ordering below the whole of the application's start-up contract.
 *
 * **No change-detection provider is declared.** Zoneless change detection is Angular 22's default
 * (AAP 0.4.1), so none is listed below: declaring it would only restate what the framework already
 * does. No zone-based provider can be registered either — no change-detection zone library is a
 * dependency of this application, and every view here is driven by signals.
 *
 * **Order is meaning.** The providers are listed in the order their contracts depend on each other:
 *
 * 1. `provideRouter(APP_ROUTES, withHashLocation())` — the tree `app.routes.ts` declares, mounted on
 *    the legacy URL scheme. The legacy application runs `$locationProvider.hashPrefix('')` with
 *    `html5Mode(false)` (`app/scripts/routes.js:1115-1116`), so hash URLs are what survive cutover and
 *    every route's URL keeps the `#/` form (AAP 0.3.4 claim 2, Rule 1 clause 5).
 * 2. `provideHttpClient(withInterceptors([fineractInterceptor]))` — the client every service injects,
 *    with the application's single interceptor as its only interceptor (Rule 1 clause 5). The
 *    interceptor owns the tenant and `Authorization` headers, the `ApiError` mapping and the 401
 *    handling, and rewrites no URL (AAP 0.4.3 row 1).
 * 3. `provideTranslate()` — `TranslateService` over the legacy `global-translations/locale-*.json`
 *    bundles and the missing-translation handler that never shows a raw key.
 *    `core/i18n/translate.config.ts` owns that composition as its single call site (AAP 0.4.3 row 4,
 *    AAP 0.7.1), including the handler registration that has to follow the translate stack so it wins
 *    over the library's key-echoing default. The stack needs `provideHttpClient()` in the same
 *    injector because its loader fetches the bundles through `HttpClient`, and this is that one place.
 * 4. `provideAppInitializer(...)` — the start-up sequence, awaited before the router performs its
 *    first navigation: the configuration is resolved, then the stored legacy session is restored.
 * 5. `{ provide: APP_CONFIG, ... }` — the resolved configuration as one immutable injection token, read
 *    through `inject(APP_CONFIG)`. It follows the initializer for the reason `app-config.token.ts`
 *    documents: by the time anything injects the token, `load()` has published the configuration, so
 *    the factory reads a resolved value instead of a signal that is still loading.
 *
 * **Why one initializer and not two.** Angular awaits the registered initializers concurrently — it
 * runs each function in turn, collects the returned promises and awaits them together — so a second
 * initializer performing the session restore would race the configuration read, and the restore issues
 * `GET /users/{id}` through the interceptor, which needs `apiUrl()` and therefore a resolved
 * configuration. Both steps are chained inside this one function, and it is the only function Angular
 * has to wait for. The two services are injected synchronously at the top because `inject()` is only
 * available in the injection context an initializer starts in; an `inject()` after an `await` would
 * throw.
 *
 * **What the sequence reproduces.** `AppConfigService.load()` resolves the configuration from
 * `src/assets/config.json`, the container entrypoint's rewrite of that file and the legacy
 * `?baseApiUrl=`/`?tenantIdentifier=` overrides, in that precedence (AAP 0.4.4 decision 5), and it
 * rejects rather than falling back to a demo host (Rule 2). `AuthService.restore()` then re-reads the
 * stored legacy session entry and revalidates it through `GET /users/{id}`, which is what makes a page
 * reload resume a signed-in session instead of sending a returning user back to the login screen
 * (AAP 0.3.4 claim 9; `app/scripts/services/SessionManager.js:36-48`).
 *
 * **Nothing here is a credential.** No host, tenant datum, key or password appears in this file: the
 * configuration comes from a served file and the session from `localStorage` (Rule 1 clause 9). The
 * authentication request itself is refused the `Authorization` header by the interceptor, so the
 * sequence above adds no request that could carry a stale key.
 */
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  inject,
  provideAppInitializer,
  type ApplicationConfig,
} from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';

import { APP_ROUTES } from './app.routes';
import { AuthService } from './core/auth/auth.service';
import type { AppConfig } from './core/config/app-config.model';
import { AppConfigService } from './core/config/app-config.service';
import { APP_CONFIG } from './core/config/app-config.token';
import { fineractInterceptor } from './core/http/fineract.interceptor';
import { provideTranslate } from './core/i18n/translate.config';

/**
 * The application's global providers, in start-up order: the hash-located router over `APP_ROUTES`,
 * the HTTP client with the single Fineract interceptor, the translation stack, the initializer that
 * resolves the configuration and restores the stored session, and the `APP_CONFIG` token the resolved
 * configuration is published on.
 *
 * Exported as one value because `web-ng/src/main.ts` bootstraps `AppComponent` with it and every unit
 * test composes its injector from it, so the providers a component runs against are the application's
 * own and never a parallel list kept in step by hand.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(APP_ROUTES, withHashLocation()),
    provideHttpClient(withInterceptors([fineractInterceptor])),
    provideTranslate(),
    // Configuration first, then the session restore that sends `GET /users/{id}` through the interceptor
    // and therefore needs `apiUrl()`. The header explains why both steps share this one initializer.
    provideAppInitializer(async (): Promise<void> => {
      const configuration = inject(AppConfigService);
      const session = inject(AuthService);

      await configuration.load();
      await session.restore();
    }),
    { provide: APP_CONFIG, useFactory: (): AppConfig => inject(AppConfigService).config },
  ],
};
