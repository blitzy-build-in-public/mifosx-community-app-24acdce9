/** The application's route tree: the legacy URL scheme in hash form (`#/…`, produced by the `withHashLocation()` that `app.config.ts` passes to `provideRouter`), with each screen's access code declared once in. */
import { inject } from '@angular/core';
import type { CanMatchFn, Route, Routes, UrlSegment } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';
import { AuthService } from './core/auth/auth.service';
import { permissionGuard } from './core/auth/permission.guard';
import { ShellComponent } from './core/layout/shell.component';
import { NotFoundComponent } from './features/not-found/not-found.component';

/** The `canMatch` predicate a lazy feature mount declares: it accepts a URL whose first segment is one of `firstSegments`, and refuses every other URL. **Why the mount needs it.** The two feature groups are siblings on. */
const mountsFirstSegment = (...firstSegments: readonly string[]): CanMatchFn =>
  (_route: Route, segments: readonly UrlSegment[]): boolean => {
    const first: string | undefined = segments.at(0)?.path;

    return first !== undefined && firstSegments.includes(first);
  };

/** The `canMatch` predicate the shell's catch-all declares: it accepts that branch only while a session is in effect. */
const inSession: CanMatchFn = (): boolean => inject(AuthService).isAuthenticated();

/** The single route table `app.config.ts` hands to `provideRouter`, in declaration order: the public login screen, the two landing redirects, the guarded shell with its lazy feature groups and its own not-found catch-all. */
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
      // One lazy group per Fineract resource family, mounted on the empty path: each group declares its own legacy paths in full, so the mount never prefixes them (AAP 0.8.2).
      {
        path: '',
        canMatch: [mountsFirstSegment('clients', 'createclient', 'editclient', 'viewclient', 'client')],
        loadChildren: () => import('./features/clients/clients.routes').then((m) => m.CLIENTS_ROUTES),
      },
      {
        path: '',
        canMatch: [
          mountsFirstSegment(
            'newclientloanaccount',
            'editloanaccount',
            'viewloanaccount',
            'loanaccount',
            'addloancharge',
            'loanaccountcharge',
          ),
        ],
        loadChildren: () => import('./features/loans/loans.routes').then((m) => m.LOANS_ROUTES),
      },
      {
        // The access code the AAP requires on every route — "each route declares its permission in `data.permission` so `permissionGuard` and the nav can share one source" (AAP 0.8.2) — with the guard that reads it, because a (AAP 0.14.1, Rule 1 clause 3).
        path: 'search/:query',
        loadComponent: () =>
          import('./features/search/search-results.component').then((m) => m.SearchResultsComponent),
        canActivate: [permissionGuard],
        data: { permission: 'READ_CLIENT', breadcrumb: ['label.heading.search'] },
      },
      // Last among the shell's children, so an unknown URL is matched here instead of backtracking out of the shell: a signed-in visitor keeps the navbar, the breadcrumb and the `.content-wrapper` main landmark — the.
      { path: '**', component: NotFoundComponent, canMatch: [inSession] },
    ],
  },
  // Last, and outside the guarded shell: an unknown URL renders the not-found screen for a visitor with no session — this is the branch the shell's own catch-all refuses through `inSession`, so a signed-out visitor is not.
  { path: '**', component: NotFoundComponent },
];

/** The same tree under the `<NAME>_ROUTES` name every group in `features/` uses, which is the name `app.config.ts` and `app.routes.spec.ts` import it by. */
export const APP_ROUTES: Routes = routes;
