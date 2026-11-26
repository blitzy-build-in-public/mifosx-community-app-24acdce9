/**
 * The application's route tree: the legacy URL scheme in hash form (`#/…`, produced by the
 * `withHashLocation()` that `app.config.ts` passes to `provideRouter`), with each screen's access code
 * declared once in `data.permission` — the declaration `permissionGuard` enforces and the navbar reads,
 * so a navigation entry cannot outlive its route.
 *
 * Feature paths are declared in their own route groups and mounted here on the empty path, so every URL
 * is exactly the legacy URL its route cuts over.
 */
import { inject } from '@angular/core';
import type { CanMatchFn, Route, Routes, UrlSegment } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';
import { AuthService } from './core/auth/auth.service';
import { permissionGuard } from './core/auth/permission.guard';
import { ShellComponent } from './core/layout/shell.component';
import { NotFoundComponent } from './features/not-found/not-found.component';

/**
 * The `canMatch` predicate a lazy feature mount declares: it accepts a URL whose first segment is one of
 * `firstSegments`, and refuses every other URL.
 *
 * **Why the mount needs it.** The three feature groups are siblings on `path: ''`, and an empty path
 * matches every URL, so the router must resolve a mount's children before it can tell whether that
 * group serves the URL — and resolving them runs `loadChildren`, downloading and parsing the group's
 * chunk. A cold deep link to a later group therefore paid for every group declared before it: a
 * `#/viewsavingaccount/:id` link fetched the clients and loans chunks first, and `#/search/:query`
 * fetched all three. The router evaluates `canMatch` before it asks for the children
 * (`recognize()`'s `matchWithChecks` runs the guards, then `getChildConfig` awaits `loadChildren`), so a
 * refused mount is a mount whose chunk is never fetched, and that discovery order is the whole of the
 * saving. Only the fetch changes: every URL, every path and every feature boundary stays as it was.
 *
 * **The list is part of the guard.** Each entry below is the first segment of a path that mount's own
 * `*.routes.ts` declares, and nothing else: a segment missing here makes that group's screens
 * unreachable, and a segment that is not in the group costs a fetch that cannot match. Adding or
 * removing a path in a feature array therefore means keeping this list in step with it —
 * `app.routes.spec.ts` proves the two agree for every in-scope path.
 *
 * @param firstSegments the first URL segments the guarded group's own routes begin with.
 * @returns the predicate the mount declares, as its `canMatch`.
 */
const mountsFirstSegment = (...firstSegments: readonly string[]): CanMatchFn =>
  (_route: Route, segments: readonly UrlSegment[]): boolean => {
    const first: string | undefined = segments.at(0)?.path;

    return first !== undefined && firstSegments.includes(first);
  };

/**
 * The `canMatch` predicate the shell's catch-all declares: it accepts that branch only while a session
 * is in effect.
 *
 * The in-shell catch-all is there so an unknown URL renders the not-found screen inside the
 * application's chrome, and that chrome belongs to a signed-in visitor. A signed-out one must not be
 * pulled into it: entering the shell is what hands the navigation to `authGuard`, which replaces it
 * with the login form, and a path that does not exist is not a missing credential. Refusing the branch
 * while no session is in effect lets the navigation fall through to the unguarded top-level catch-all,
 * which is where a signed-out visitor's unknown URL has to land.
 *
 * The answer is `AuthService.isAuthenticated()`, the one source `authGuard` itself reads, so the
 * predicate and the guard cannot disagree; nothing is cached and nothing is written.
 */
const inSession: CanMatchFn = (): boolean => inject(AuthService).isAuthenticated();

/**
 * The single route table `app.config.ts` hands to `provideRouter`, in declaration order: the public login
 * screen, the two landing redirects, the guarded shell with its lazy feature groups and its own
 * not-found catch-all, and the unguarded catch-all that renders the not-found screen for a visitor with
 * no session.
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
      // own legacy paths in full, so the mount never prefixes them. Each mount also carries the
      // `canMatch` predicate `mountsFirstSegment()` documents, naming the first segment of every path its
      // own array declares — the AAP 0.8.2 paths of the clients, loans and savings families — so a deep
      // link fetches the group that serves it and no group it does not, with every URL unchanged.
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
        path: '',
        canMatch: [
          mountsFirstSegment('new_client_saving_application', 'viewsavingaccount', 'savingaccount'),
        ],
        loadChildren: () => import('./features/savings/savings.routes').then((m) => m.SAVINGS_ROUTES),
      },
      {
        // The access code the AAP requires on every route — "each route declares its permission in
        // `data.permission` so `permissionGuard` and the nav can share one source" (AAP 0.8.2) — with the
        // guard that reads it, because a code no guard enforces is decorative (AAP 0.14.1). This is the
        // one in-scope route that declared none.
        //
        // `READ_CLIENT` is the read code of the family the results screen covers primarily: most rows
        // are clients, and the landing screen whose toolbar find issues the same `GET /search` is
        // declared on it too (`features/clients/clients.routes.ts`). A permission list is not the
        // alternative — `permissionGuard` answers a list with `PermissionsService.canAll()`, so a list
        // would demand both codes instead of either.
        //
        // The route-level code is a restriction the legacy route did not carry: legacy's
        // `/search/:query` gated nothing (Rule 1 clause 3). The AAP is the higher source and requires the
        // declaration, so the difference is deliberate; what it costs is stated here rather than left to
        // be discovered — a user holding `READ_LOAN` without `READ_CLIENT` is sent to the clients list by
        // this guard instead of reaching the screen, so the loan rows the screen gates one at a time
        // (`features/search/search-results.component.ts`, `row.permission`) are no longer shown to that
        // user at all. Client search is unaffected: the clients list's own find issues the same
        // `GET /search` from a route that declares its code without a guard.
        path: 'search/:query',
        loadComponent: () =>
          import('./features/search/search-results.component').then((m) => m.SearchResultsComponent),
        canActivate: [permissionGuard],
        data: { permission: 'READ_CLIENT', breadcrumb: ['label.heading.search'] },
      },
      // Last among the shell's children, so an unknown URL is matched here instead of backtracking out
      // of the shell: a signed-in visitor keeps the navbar, the breadcrumb and the `.content-wrapper`
      // main landmark — the application's only one — around the not-found screen, as the legacy
      // application renders `views/errors/404.html` inside its own chrome. The unguarded top-level `**`
      // below stays where it is; `canMatch` is what keeps it reachable, by refusing this branch for a
      // visitor with no session (`inSession`). Neither wildcard declares a `breadcrumb` or a
      // `permission`: the screen renders no data and names no capability, so an access code here would
      // deny a path that does not exist.
      { path: '**', component: NotFoundComponent, canMatch: [inSession] },
    ],
  },
  // Last, and outside the guarded shell: an unknown URL renders the not-found screen for a visitor with
  // no session — this is the branch the shell's own catch-all refuses through `inSession`, so a
  // signed-out visitor is not sent to the login form for a path that does not exist.
  { path: '**', component: NotFoundComponent },
];

/**
 * The same tree under the `<NAME>_ROUTES` name every group in `features/` uses, which is the name
 * `app.config.ts` and `app.routes.spec.ts` import it by.
 */
export const APP_ROUTES: Routes = routes;
