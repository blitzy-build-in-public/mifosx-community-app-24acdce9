/**
 * The application's route tree — the one statement of which hash URL renders which screen, matching
 * the legacy application's own paths one for one (AAP 0.8.2 "Shell and navigation" and "Feature
 * routes"; AAP 0.3.4 claim 1: "the in-scope route list in 0.4.4 is a subset of these paths; unknown
 * paths render the not-found screen"; AAP 0.11.1 row `app.routes.ts`).
 *
 * **The shape, and why it is this shape.** Two branches hang off the root:
 *
 * - `login` is a *sibling* of the guarded subtree, not a child of it, because a signed-out visitor is
 *   exactly who must reach it. `authGuard` therefore never runs for it (the guard is on the layout
 *   route below, which is where `auth.guard.ts` documents it to be), and the screen is one lazy group
 *   of its own — `features/auth/auth.routes.ts`, mounted at `login` and declaring the empty path, so
 *   the hash URL is `#/login` and not `#/login/login`.
 * - the empty path is the *signed-in shell*: `ShellComponent` renders the navbar, the breadcrumb and
 *   the router outlet, and every authenticated screen is one of its children. `authGuard` sits on this
 *   route, so one declaration protects every screen beneath it, and a refused navigation arrives at
 *   the login screen carrying the attempted route as `returnUrl`.
 *
 * **The lazy groups mount at path `''`.** The three Fineract resource families are declared as
 * `loadChildren` entries on the empty path, and each of their arrays states the legacy path in full —
 * `clients`, `createclient`, `viewclient/:id`, `newclientloanaccount/:clientId` and so on. That is the
 * composition `tools/parity/in-scope-routes.json` records in its header ("full paths are app-level
 * parent segments joined with feature child segments; lazy groups mount at path ''"), and it is what
 * keeps every URL on the new application identical to the legacy URL it cuts over. The router tests
 * the empty-path redirect first and then each lazy group in declaration order, so `''` resolves to the
 * clients list while every other legacy path is matched by the family that declares it.
 *
 * **Redirects and the catch-all.** `''` and `home` both redirect to `clients`: the legacy application
 * lands a successful login on its dashboard, dashboards are out of scope, and the design shows
 * `#/clients` as the post-login landing screen, so the redirect is the deliberate difference
 * registered as AAP 0.10.5 item 3. `**` is last and renders `NotFoundComponent`, which is what makes
 * the not-found screen reachable at all — the legacy `.otherwise` fallback's counterpart
 * (`app/scripts/routes.js:1112`).
 *
 * **What each route declares, beside its component.** Every screen carries its breadcrumb trail in
 * `data['breadcrumb']` (translation keys, resolved by the shell against the legacy bundles served in
 * place, Rule 1 clause 6) and its access code in `data['permission']` (read by `permissionGuard` in the
 * feature arrays and by the navbar, so a menu entry cannot outlive its route — AAP 0.14.1). The two
 * routes below carry one exception each, and both are stated rather than implied: `clients` declares
 * its code but not the guard, because it is the destination `permissionGuard` sends a denied
 * navigation to and gating it would cancel that very navigation; and `search/:query` declares no code
 * because its results are gated per row (`SearchResultsComponent` states each row's own permission),
 * so one family code here would deny a user the other family's results, which legacy's search screen
 * never did (Rule 1 clause 3).
 *
 * **Nothing here is out of scope.** The nineteen paths below are exactly the entries
 * `tools/parity/in-scope-routes.json` holds; no route is added for a dashboard, an access-denied
 * screen, a report or an administrative module (AAP 0.9.2, AAP 0.10.5 items 3 and 8). The location
 * strategy is not a route's concern: `withHashLocation()` is set once, in `app.config.ts` (Rule 1
 * clause 5).
 */
import type { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';
import { ShellComponent } from './core/layout/shell.component';
import { NotFoundComponent } from './features/not-found/not-found.component';
import { SearchResultsComponent } from './features/search/search-results.component';

/**
 * Every route the application serves: the public login screen, the guarded shell with its lazy
 * feature groups, the global search results, and the catch-all that renders the not-found screen.
 *
 * Exported as the single array `app.config.ts` hands to `provideRouter`, so the URL scheme, the guards
 * and the screens are declared once and the parity route list has one thing to agree with.
 */
export const APP_ROUTES: Routes = [
  {
    path: 'login',
    loadChildren: () =>
      import('./features/auth/auth.routes').then((routes) => routes.AUTH_ROUTES),
  },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      // The post-login landing screen, and the dashboard's stand-in (AAP 0.10.5 item 3).
      { path: '', pathMatch: 'full', redirectTo: 'clients' },
      { path: 'home', pathMatch: 'full', redirectTo: 'clients' },

      // The three lazy feature groups, each mounted on the empty path and declaring its own legacy
      // paths. Order is irrelevant between them — their path sets are disjoint — but it is fixed here
      // in the order the plan lists the families.
      {
        path: '',
        loadChildren: () =>
          import('./features/clients/clients.routes').then((routes) => routes.CLIENTS_ROUTES),
      },
      {
        path: '',
        loadChildren: () =>
          import('./features/loans/loans.routes').then((routes) => routes.LOANS_ROUTES),
      },
      {
        path: '',
        loadChildren: () =>
          import('./features/savings/savings.routes').then((routes) => routes.SAVINGS_ROUTES),
      },

      // Global search over clients and loans (`#/search/:query`). No access code, for the reason this
      // file's header states: each result row carries its own.
      {
        path: 'search/:query',
        component: SearchResultsComponent,
        data: { breadcrumb: ['label.heading.search'] },
      },

      // Unknown paths render the not-found screen inside the shell, so a signed-in user keeps the
      // chrome the legacy `.otherwise` screen also kept. A signed-out visitor reaches the login screen
      // first, which is the correct order: they have no session to describe a record with.
      { path: '**', component: NotFoundComponent },
    ],
  },
];
