import { InjectionToken } from '@angular/core';
import type { AppConfig } from './app-config.model';

/** Injection handle for the resolved `AppConfig`, registered by `app.config.ts` after the initializer that awaits `load()`; the token supplies no provider and imports neither the composition file nor the service, so it stays a leaf both can depend on — read it through `inject(APP_CONFIG)` and derive nothing local from it. */
export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');
