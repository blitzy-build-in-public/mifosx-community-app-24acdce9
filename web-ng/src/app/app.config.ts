// The application's composition root - the single place the router, the HTTP client with its one interceptor, the translation stack and the start-up configuration are declared (AAP 0.4.3 rows 1, 4 and 7; AAP 0.8.2; AAP (AAP 0.11.1, AAP 0.4.1, AAP 0.3.4, Rule 1 clause 5).
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
import { LanguagePreferenceService } from './core/i18n/language-preference.service';
import { provideTranslate } from './core/i18n/translate.config';

/** The providers `web-ng/src/main.ts` bootstraps `AppComponent` with, and the list every unit test composes its injector from, so a component runs against the application's own providers and never a parallel list kept in step by hand. */
export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(APP_ROUTES, withHashLocation()),
    provideHttpClient(withInterceptors([fineractInterceptor])),
    provideTranslate(),
    // Configuration first, then the remembered language, then the session restore: load() resolves assets/config.json, the entrypoint's rewrite of it and the ?baseApiUrl=/?tenantIdentifier= overrides in that precedence (AAP 0.4.4 decision 5) and rejects rather than falling back to a demo host (Rule 2); the language restore re-applies the choice the legacy `ls.Language` entry holds before any screen renders, so a reload continues in the language the user picked rather than the configured one (legacy `MainController.js:232-238`, Rule 1 clause 3) and does not block on the bundle it asks for; restore() on the session then sends GET /users/{id} through the interceptor and so needs apiUrl(). One initializer, not two, because Angular awaits initializers concurrently and a second would race the configuration read.
    provideAppInitializer(async (): Promise<void> => {
      const configuration = inject(AppConfigService);
      const language = inject(LanguagePreferenceService);
      const session = inject(AuthService);

      await configuration.load();
      language.restore();
      await session.restore();
    }),
    { provide: APP_CONFIG, useFactory: (): AppConfig => inject(AppConfigService).config },
  ],
};
