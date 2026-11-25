/**
 * The application's composition root — the single place where the router, the HTTP client with its
 * one interceptor, the translation stack and the start-up configuration are declared (AAP 0.4.3 rows
 * "Fineract REST API" and "Runtime configuration"; AAP 0.8.2 "Application entry and configuration";
 * AAP 0.11.1 row `app.config.ts`). `web-ng/src/main.ts` passes this object to
 * `bootstrapApplication` and nothing else in the application registers these providers, which is what
 * makes the ordering below the whole of the application's start-up contract.
 *
 * **Order is meaning.** The providers are listed in the order their contracts depend on each other:
 *
 * 1. `provideZonelessChangeDetection()` — Angular 22's default, stated rather than assumed so the
 *    absence of a change-detection zone is a decision this file records (AAP 0.4.1: no zone.js is
 *    installed anywhere in `web-ng/`).
 * 2. `provideRouter(APP_ROUTES, withHashLocation())` — the tree `app.routes.ts` declares, mounted on
 *    the legacy URL scheme. The legacy application runs `$locationProvider.hashPrefix('')` with
 *    `html5Mode(false)` (`app/scripts/routes.js:1115-1116`), so hash URLs are what survive cutover and
 *    every route's URL keeps the `#/` form (AAP 0.3.4 claim 2, Rule 1 clause 5).
 * 3. `provideHttpClient(withInterceptors([fineractInterceptor]))` — the client every service injects,
 *    with the application's single interceptor as its only interceptor (Rule 1 clause 5). The
 *    interceptor owns the tenant and `Authorization` headers, the `ApiError` mapping and the 401
 *    handling, and rewrites no URL (AAP 0.4.3 row 1).
 * 4. `provideTranslate` — `TranslateService` over the legacy `global-translations/locale-*.json`
 *    bundles and the missing-translation handler that never shows a raw key. It declared this exact
 *    composition as its single call site (AAP 0.4.3 row 4), it requires `provideHttpClient()` in the
 *    same injector because its loader fetches the bundles through `HttpClient`, and this is that one
 *    place.
 * 5. `provideAppInitializer(...)` — the start-up sequence, awaited before the router performs its
 *    first navigation: the configuration is resolved, then the stored legacy session is restored.
 * 6. `{ provide: APP_CONFIG, ... }` — the resolved configuration as one immutable injection token, read
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
  provideZonelessChangeDetection,
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
 * The application's global providers, in start-up order: zoneless change detection, the hash-located
 * router over `APP_ROUTES`, the HTTP client with the single Fineract interceptor, the translation
 * stack, the initializer that resolves the configuration and restores the stored session, and the
 * `APP_CONFIG` token the resolved configuration is published on.
 *
 * Exported as one value because `web-ng/src/main.ts` bootstraps `AppComponent` with it and every unit
 * test composes its injector from it, so the providers a component runs against are the application's
 * own and never a parallel list kept in step by hand.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(APP_ROUTES, withHashLocation()),
    provideHttpClient(withInterceptors([fineractInterceptor])),
    provideTranslate(),
    provideAppInitializer((): Promise<void> => {
      const configuration = inject(AppConfigService);
      const session = inject(AuthService);

      // Awaited in this order, both inside this one initializer: the configuration has to be resolved
      // before the restore issues a request through the interceptor, and the first navigation has to
      // wait for the restore so a stored session is in effect when `authGuard` asks for it.
      return (async (): Promise<void> => {
        await configuration.load();
        await session.restore();
      })();
    }),
    { provide: APP_CONFIG, useFactory: (): AppConfig => inject(AppConfigService).config },
  ],
};
