import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, type Route, provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { APP_ROUTES } from './app.routes';
import { AuthService } from './core/auth/auth.service';
import { authGuard } from './core/auth/auth.guard';
import { permissionGuard } from './core/auth/permission.guard';
import { ShellComponent } from './core/layout/shell.component';
import { provideTranslate } from './core/i18n/translate.config';
import { NotFoundComponent } from './features/not-found/not-found.component';
import { SearchResultsComponent } from './features/search/search-results.component';

/**
 * Behaviour of the application's route tree (AAP 0.8.2 "Shell and navigation" and "Feature routes";
 * AAP 0.3.4 claims 1 and 2; AAP 0.10.4 route list; AAP 0.11.1 row `app.routes.ts`).
 *
 * The tree is the one statement of which hash URL renders which screen, and
 * `web-ng/tools/parity/in-scope-routes.json` is the list it has to agree with. These tests therefore
 * assert the agreement itself rather than a sample of it: every path the list declares, composed
 * through the lazy mounts exactly as the router composes it, and nothing beyond them. That is gate (c)
 * of `npm run check:wiring`, exercised at run time against the real `APP_ROUTES` value instead of
 * against the source text.
 *
 * The remaining tests pin what the list cannot state: the two dashboard redirects (AAP 0.10.5 item 3),
 * the catch-all that makes the not-found screen reachable, the guard on the signed-in subtree, and the
 * access code each gated route declares for `permissionGuard` and the navigation to share.
 */

/**
 * The nineteen paths `web-ng/tools/parity/in-scope-routes.json` declares, in its own order, with the
 * response status the list gives each of them. Restated here because the expected value of a gate is
 * part of the gate: a route added to or removed from the tree without this list changing must fail
 * here, and a spec that read the very list it checks would move with it.
 */
const IN_SCOPE_PATHS: readonly string[] = [
  'login',
  '',
  'home',
  'clients',
  'createclient',
  'editclient/:id',
  'viewclient/:id',
  'client/:id/:action',
  'newclientloanaccount/:clientId',
  'editloanaccount/:id',
  'viewloanaccount/:id',
  'loanaccount/:id/:action',
  'addloancharge/:id',
  'loanaccountcharge/:id/:action/:chargeId',
  'new_client_saving_application/:clientId',
  'viewsavingaccount/:id',
  'savingaccount/:id/:action',
  'search/:query',
  '**',
];

/**
 * Every full path the given route array resolves to, with each lazy group's children spliced in at the
 * path its mount declares — the composition `in-scope-routes.json` describes in its header ("full
 * paths are app-level parent segments joined with feature child segments; lazy groups mount at path
 * ''").
 *
 * The lazy `loadChildren` callbacks are invoked directly, which is what the router does on first
 * navigation, so the answer is the tree the application really serves and not the top-level skeleton.
 *
 * @param routes the route array to compose, at the prefix it is mounted under.
 * @param prefix the path segments of the mount point, already joined.
 * @returns one full path per leaf route, in declaration order.
 */
async function composePaths(routes: readonly Route[], prefix = ''): Promise<readonly string[]> {
  const paths: string[] = [];

  for (const route of routes) {
    const segment = route.path ?? '';
    const full = [prefix, segment].filter((part: string): boolean => part.length > 0).join('/');

    if (route.loadChildren !== undefined) {
      const loaded: unknown = await route.loadChildren();

      if (!Array.isArray(loaded)) {
        throw new Error(`A lazy group mounted at "${full}" did not resolve to a route array.`);
      }

      paths.push(...(await composePaths(loaded as readonly Route[], full)));
      continue;
    }

    if (route.children !== undefined) {
      paths.push(...(await composePaths(route.children, full)));
      continue;
    }

    paths.push(full);
  }

  return paths;
}

describe('APP_ROUTES', () => {
  it('composes exactly the nineteen in-scope paths and nothing else', async () => {
    const composed: readonly string[] = await composePaths(APP_ROUTES);

    expect(composed).toHaveLength(IN_SCOPE_PATHS.length);
    expect([...composed].sort()).toEqual([...IN_SCOPE_PATHS].sort());
  });

  it('mounts the login screen beside the guarded shell, not beneath it', () => {
    const login = APP_ROUTES.find((route: Route): boolean => route.path === 'login');

    expect(login).toBeDefined();
    expect(login?.loadChildren).toBeTypeOf('function');
    // The login branch is a top-level sibling: it carries no guard, because a signed-out visitor is
    // exactly who must reach it (auth.guard.ts documents the same placement).
    expect(login?.canActivate).toBeUndefined();
  });

  it('guards the signed-in subtree with authGuard on the shell route', () => {
    const shell = APP_ROUTES.find((route: Route): boolean => route.component === ShellComponent);

    expect(shell).toBeDefined();
    expect(shell?.path).toBe('');
    expect(shell?.canActivate).toContain(authGuard);
  });

  it('loads the search screen lazily, so its chunk stays out of the initial bundle', async () => {
    const shell = APP_ROUTES.find((route: Route): boolean => route.component === ShellComponent);
    const search = shell?.children?.find((route: Route): boolean => route.path === 'search/:query');

    expect(search?.component).toBeUndefined();
    expect(search?.loadComponent).toBeTypeOf('function');
    await expect(search?.loadComponent?.()).resolves.toBe(SearchResultsComponent);
  });

  it("redirects '' and 'home' to the clients list, the dashboard's stand-in", () => {
    const root = APP_ROUTES.find(
      (route: Route): boolean => route.path === '' && route.redirectTo !== undefined,
    );
    const home = APP_ROUTES.find((route: Route): boolean => route.path === 'home');

    expect(root?.redirectTo).toBe('clients');
    expect(root?.pathMatch).toBe('full');
    expect(home?.redirectTo).toBe('clients');
    expect(home?.pathMatch).toBe('full');
  });

  it('renders the not-found screen for an unknown path through a catch-all route', () => {
    const wildcards: readonly Route[] = APP_ROUTES.filter(
      (route: Route): boolean => route.path === '**',
    );

    expect(wildcards).toHaveLength(1);
    expect(wildcards[0]?.component).toBe(NotFoundComponent);
    // Last in the array, so it can never shadow a declared screen.
    expect(APP_ROUTES.at(-1)).toBe(wildcards[0]);
    // Top level, outside the guarded shell: a path that does not exist is not a permission problem, so a
    // signed-out visitor sees the not-found screen instead of the login form.
    expect(wildcards[0]?.canActivate ?? []).not.toContain(authGuard);
  });

  it('gives every gated route an access code and the guard that reads it', async () => {
    const gated: Route[] = [];

    const collect = async (routes: readonly Route[]): Promise<void> => {
      for (const route of routes) {
        if (route.loadChildren !== undefined) {
          collect((await route.loadChildren()) as readonly Route[]);
        }

        if (route.children !== undefined) {
          await collect(route.children);
        }

        if (route.data !== undefined && route.data['permission'] !== undefined) {
          gated.push(route);
        }
      }
    };

    await collect(APP_ROUTES);

    expect(gated.length).toBeGreaterThan(0);

    for (const route of gated) {
      expect(route.data?.['permission']).toMatch(/^[A-Z][A-Z_]+$/);

      if (route.path === 'clients') {
        // The landing screen declares its code for the navigation entry but carries no guard: it is
        // the destination permissionGuard sends a denied navigation to (clients.routes.ts states it).
        expect(route.canActivate ?? []).not.toContain(permissionGuard);
        continue;
      }

      expect(route.canActivate ?? []).toContain(permissionGuard);
    }
  });

  it('is the tree the router instantiates: a real navigation resolves against it', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslate(),
        provideRouter(APP_ROUTES),
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: (): boolean => true,
            session: signal(null),
            username: signal('spec.user'),
            permissionsSignal: signal([]),
          },
        },
      ],
    });

    const router = TestBed.inject(Router);

    // The URL resolves against the real tree: the shell route matches, the lazy clients group loads,
    // and the composed URL is the legacy one.
    await router.navigateByUrl('/clients');

    expect(router.url).toBe('/clients');
  });
});
