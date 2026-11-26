import { Routes } from '@angular/router';

import { LoginComponent } from './login/login.component';

/** The `auth` feature's lazy route group (AAP 0.7.1, AAP 0.8.2), loaded at path `login`, so its single entry is the empty path and the hash URL is `#/login` (AAP 0.3.4 claim 2); the catch-all not-found route is declared in `app.routes.ts` alone, and this public branch carries no guard and no access datum, because a signed-out visitor is exactly who must reach it (AAP 0.9.2). */
export const AUTH_ROUTES: Routes = [{ path: '', component: LoginComponent }];
