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
  {
    path: 'login',
    loadChildren: () => import('./features/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
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
        // Either family's read code admits this screen, because the scope the user picks at run time decides which rows they may read: the global search control offers an "all" scope and a loans scope and is rendered for every user (AAP 0.7.4), each result row is gated on its own family's read code (`search-results.component.ts`), and legacy's own search route gates nothing while its search form renders for every user (Rule 1 clause 3).
        // So no single code can honour the scope, and a READ_LOAN-only user must not be turned away from the loan rows they may read (AAP 0.1.1, AAP 0.10.5 item 9, AAP 0.14.1). The declaration sits in the member `permissionGuard` and the nav share (AAP 0.8.2), with the guard that reads it.
        path: 'search/:query',
        loadComponent: () =>
          import('./features/search/search-results.component').then((m) => m.SearchResultsComponent),
        canActivate: [permissionGuard],
        data: {
          permission: { any: ['READ_CLIENT', 'READ_LOAN'] },
          breadcrumb: ['label.heading.search'],
        },
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
