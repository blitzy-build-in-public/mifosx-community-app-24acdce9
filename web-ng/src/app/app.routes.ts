/**
 * The application's route tree: the legacy URL scheme in hash form (`#/…`, produced by the
 * `withHashLocation()` that `app.config.ts` passes to `provideRouter`), with each screen's access code
 * declared once in `data.permission` — the declaration `permissionGuard` enforces and the navbar reads,
 * so a navigation entry cannot outlive its route.
 *
 * Feature paths are declared in their own route groups and mounted here on the empty path, so every URL
 * is exactly the legacy URL its route cuts over.
 */
import type { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';
import { ShellComponent } from './core/layout/shell.component';
import { NotFoundComponent } from './features/not-found/not-found.component';

/**
 * The single route table `app.config.ts` hands to `provideRouter`, in declaration order: the public login
 * screen, the two landing redirects, the guarded shell with its lazy feature groups, and the catch-all
 * that renders the not-found screen.
 */
export const routes: Routes = [
  // Outside the shell and unguarded: a signed-out visitor is exactly who must reach it.
  {
    path: 'login',
    loadChildren: () => import('./features/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
  // Dashboards are out of scope, so the post-login landing screen is the clients list.
  { path: '', pathMatch: 'full', redirectTo: 'clients' },
  { path: 'home', pathMatch: 'full', redirectTo: 'clients' },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      // One lazy group per Fineract resource family, mounted on the empty path: each group declares its
      // own legacy paths in full, so the mount never prefixes them.
      {
        path: '',
        loadChildren: () => import('./features/clients/clients.routes').then((m) => m.CLIENTS_ROUTES),
      },
      {
        path: '',
        loadChildren: () => import('./features/loans/loans.routes').then((m) => m.LOANS_ROUTES),
      },
      {
        path: '',
        loadChildren: () => import('./features/savings/savings.routes').then((m) => m.SAVINGS_ROUTES),
      },
      {
        // No access code: the screen gates each result with its own family's read code, and the legacy
        // search route carried no gate either — one route-level code here would hide the other family's
        // results from a user allowed to read them.
        path: 'search/:query',
        loadComponent: () =>
          import('./features/search/search-results.component').then((m) => m.SearchResultsComponent),
        data: { breadcrumb: ['label.heading.search'] },
      },
    ],
  },
  // Last, and outside the guarded shell: an unknown URL renders the not-found screen for every visitor,
  // instead of sending a signed-out one to the login form for a path that does not exist.
  { path: '**', component: NotFoundComponent },
];

/**
 * The same tree under the `<NAME>_ROUTES` name every group in `features/` uses, which is the name
 * `app.config.ts` and `app.routes.spec.ts` import it by.
 */
export const APP_ROUTES: Routes = routes;
