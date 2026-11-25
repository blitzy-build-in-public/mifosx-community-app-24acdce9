import { Routes } from '@angular/router';

import { LoginComponent } from './login/login.component';

/**
 * The `auth` feature's lazy route group (AAP 0.7.1 `auth`, AAP 0.8.2 "Shell and navigation"), which
 * `app.routes.ts` loads with `loadChildren` at path `login`. The single entry is therefore the empty
 * path: the parent segment supplies `login`, so the hash URL is `#/login`, the legacy route this
 * screen cuts over (AAP 0.3.4 claim 2 — the legacy app runs `hashPrefix('')` with `html5Mode(false)`).
 * Writing `path: 'login'` here would render `#/login/login`. The location strategy is set once, by
 * `withHashLocation()` in `app.config.ts`, and is never a route's concern (Rule 1 clause 5).
 *
 * Two things are deliberately absent. The catch-all not-found route is declared in `app.routes.ts`
 * alone, because a second catch-all inside a lazy group would shadow the top-level one. And this
 * branch carries no guard and no route-level access datum: a signed-out visitor is exactly who must
 * reach the login screen, `authGuard` stands in front of the signed-in shell instead, and the guard
 * that reads a route's access datum has nothing to read on a public route. One destination only:
 * registration, password recovery, second-factor and OAuth routes are out of scope (Rule 1 clause 3,
 * AAP 0.9.2).
 */
export const AUTH_ROUTES: Routes = [{ path: '', component: LoginComponent }];
