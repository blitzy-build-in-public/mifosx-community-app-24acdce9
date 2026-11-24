import { bootstrapApplication } from '@angular/platform-browser';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

/**
 * Boots the standalone root component with the application's global providers
 * (router with hash location, HttpClient + Fineract interceptor, ngx-translate,
 * AppConfig initializer) as declared in `app.config.ts` (AAP 0.8.2, 0.4.2).
 *
 * Zoneless: Angular 22's default change detection; no change-detection zone
 * library is imported anywhere in the application (AAP 0.4.1, 0.6.1).
 */
bootstrapApplication(AppComponent, appConfig).catch((err: unknown): void => {
  // Bootstrap-time failure only. Never log a credential, an authentication key,
  // a request body or a session entry here (Rule 1 clause 9).
  console.error(err);
});
