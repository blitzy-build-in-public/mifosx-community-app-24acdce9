import { bootstrapApplication } from '@angular/platform-browser';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { renderBootstrapFailure } from './app/core/errors/bootstrap-failure';

// Boots the standalone root with the global providers `app.config.ts` declares (router on hash location, HttpClient with the Fineract interceptor, ngx-translate, the configuration initializer; AAP 0.8.2, 0.4.2), under Angular 22's default zoneless change detection (AAP 0.4.1, 0.6.1).
bootstrapApplication(AppComponent, appConfig).catch((err: unknown): void => {
  // Bootstrap-time failure only. Never log a credential, an authentication key, a request body or a session entry here (Rule 1 clause 9).
  console.error(err);
  // The same rejection also reaches the page: without it a deployment whose configuration cannot be resolved is a blank white screen and the only diagnostic sits in devtools.
  renderBootstrapFailure(err);
});
