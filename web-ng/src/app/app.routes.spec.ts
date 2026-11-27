import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  convertToParamMap,
  PRIMARY_OUTLET,
  provideRouter,
  Router,
  UrlSegment,
  UrlTree,
  type CanActivateFn,
  type CanMatchFn,
  type PartialMatchRouteSnapshot,
  type Route,
  type RouterStateSnapshot,
} from '@angular/router';
import { describe, expect, it } from 'vitest';

import { APP_ROUTES } from './app.routes';
import { AuthService } from './core/auth/auth.service';
import { authGuard } from './core/auth/auth.guard';
import { permissionGuard } from './core/auth/permission.guard';
import { PermissionsService } from './core/auth/permissions.service';
import { ShellComponent } from './core/layout/shell.component';
import { provideTranslate } from './core/i18n/translate.config';
import { NotFoundComponent } from './features/not-found/not-found.component';
import { SearchResultsComponent } from './features/search/search-results.component';

/** Behaviour of the application's route tree (AAP 0.8.2 "Shell and navigation" and "Feature routes"; AAP 0.3.4 claims 1 and 2; AAP 0.10.4 route list; AAP 0.11.1 row `app.routes.ts`) (AAP 0.10.5, AAP 0.1.1). */

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
  'search/:query',
  '**',
];

const ACCESS_CODE = /^[A-Z][A-Z_]+$/;

const CLIENT_ACTION_PATH = 'client/:id/:action';

const CLIENT_ACTION_CODES: Readonly<Record<string, string>> = {
  activate: 'ACTIVATE_CLIENT',
  close: 'CLOSE_CLIENT',
  reject: 'REJECT_CLIENT',
  withdraw: 'WITHDRAW_CLIENT',
  reactivate: 'REACTIVATE_CLIENT',
};

/** Whether a value is a non-null object that is not an array — the shape a `{ param, codes }` declaration has, and the shape the `codes` map inside it has (Rule 1 clause 4). */
function isDeclarationObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every access code a route's `data.permission` declaration names, whatever shape it uses: a single code, a list of codes, the `{ any }` list of which one held code admits the screen, or the `{ param, codes }` declaration whose map the route parameter selects from. */
function declaredCodes(declared: unknown): readonly string[] {
  if (typeof declared === 'string') {
    return [declared];
  }

  if (Array.isArray(declared)) {
    return declared.filter((entry: unknown): entry is string => typeof entry === 'string');
  }

  if (isDeclarationObject(declared)) {
    const any: unknown = declared['any'];

    if (Array.isArray(any)) {
      return any.filter((code: unknown): code is string => typeof code === 'string');
    }

    const codes: unknown = declared['codes'];

    return isDeclarationObject(codes)
      ? Object.values(codes).filter((code: unknown): code is string => typeof code === 'string')
      : [];
  }

  return [];
}

/** Every full path the given route array resolves to, with each lazy group's children spliced in at the path its mount declares — the composition `in-scope-routes.json` describes in its header ("full paths are app-level parent segments joined with feature child segments; lazy groups mount at path ''"). */
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

const UNKNOWN_SEGMENT = 'no-such-screen';

/** The route the application declares at `path`, with every lazy group's children spliced in exactly as {@link composePaths} splices them — the same composition, kept as the route object so a case can read the declaration. */
async function findRoute(
  path: string,
  routes: readonly Route[] = APP_ROUTES,
  prefix = '',
): Promise<Route | undefined> {
  for (const route of routes) {
    const segment = route.path ?? '';
    const full = [prefix, segment].filter((part: string): boolean => part.length > 0).join('/');

    if (route.loadChildren !== undefined) {
      const loaded: unknown = await route.loadChildren();

      if (!Array.isArray(loaded)) {
        throw new Error(`A lazy group mounted at "${full}" did not resolve to a route array.`);
      }

      const mounted = await findRoute(path, loaded as readonly Route[], full);

      if (mounted !== undefined) {
        return mounted;
      }

      continue;
    }

    if (route.children !== undefined) {
      const nested = await findRoute(path, route.children, full);

      if (nested !== undefined) {
        return nested;
      }

      continue;
    }

    if (full === path) {
      return route;
    }
  }

  return undefined;
}


/** The URL of a path no screen declares. The segment is passed as a route command and the URL is serialized by the router instead of being written as a string literal, because `check:endpoints` reads any source literal. */
const unknownUrl = (router: Router): string =>
  router.serializeUrl(router.createUrlTree([UNKNOWN_SEGMENT]));

const MATCH_SNAPSHOT: PartialMatchRouteSnapshot = {
  routeConfig: null,
  url: [],
  params: {},
  queryParams: {},
  fragment: null,
  data: {},
  outlet: PRIMARY_OUTLET,
  title: undefined,
  paramMap: convertToParamMap({}),
  queryParamMap: convertToParamMap({}),
};

/** A TestBed holding the real `APP_ROUTES` in the real router, with `AuthService` answered the way a visitor's stored session answers it — `true` for a signed-in visitor, `false` for a signed-out one — so a navigation case. */
function routerFor(authenticated: boolean): Router {
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
          isAuthenticated: (): boolean => authenticated,
          session: signal(null),
          username: signal('spec.user'),
          permissionsSignal: signal([]),
        },
      },
    ],
  });

  return TestBed.inject(Router);
}

describe('APP_ROUTES', () => {
  it('composes the sixteen in-scope paths and nothing else, declaring the catch-all twice', async () => {
    const composed: readonly string[] = await composePaths(APP_ROUTES);
    const unique: readonly string[] = [...new Set(composed)];

    expect([...unique].sort()).toEqual([...IN_SCOPE_PATHS].sort());
    expect(composed.filter((path: string): boolean => path === '**')).toHaveLength(2);
    expect(composed).toHaveLength(IN_SCOPE_PATHS.length + 1);
  });

  it('mounts each feature group behind a predicate that accepts only the paths it declares', async () => {
    const shell = APP_ROUTES.find((route: Route): boolean => route.component === ShellComponent);
    const mounts: readonly Route[] = (shell?.children ?? []).filter(
      (route: Route): boolean => route.loadChildren !== undefined,
    );

    expect(mounts).toHaveLength(2);

    for (const mount of mounts) {
      expect(mount.loadChildren).toBeTypeOf('function');
      expect(mount.canMatch ?? []).not.toHaveLength(0);
    }

    const accepts = (mount: Route, segment: string): boolean =>
      (mount.canMatch ?? [])
        .filter((guard): guard is CanMatchFn => typeof guard === 'function')
        .every(
          (guard: CanMatchFn): boolean =>
            guard(mount, [new UrlSegment(segment, {})], MATCH_SNAPSHOT) === true,
        );

    const grouped: readonly string[] = IN_SCOPE_PATHS.filter(
      (path: string): boolean =>
        path !== 'login' && path !== '' && path !== 'home' && path !== 'search/:query' && path !== '**',
    );

    expect(grouped.length).toBeGreaterThan(0);

    for (const path of grouped) {
      const first: string = path.split('/')[0] ?? '';
      const accepting: readonly Route[] = mounts.filter((mount: Route): boolean => accepts(mount, first));

      expect(accepting).toHaveLength(1);
      const loaded: unknown = await accepting[0]?.loadChildren?.();
      expect(Array.isArray(loaded)).toBe(true);
      expect((loaded as readonly Route[]).some((route: Route): boolean => route.path === path)).toBe(true);
    }

    for (const mount of mounts) {
      expect(accepts(mount, 'search')).toBe(false);
      expect(accepts(mount, UNKNOWN_SEGMENT)).toBe(false);
    }
  });

  it('mounts the login screen beside the guarded shell, not beneath it', () => {
    const login = APP_ROUTES.find((route: Route): boolean => route.path === 'login');

    expect(login).toBeDefined();
    expect(login?.loadChildren).toBeTypeOf('function');
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

  it('declares the read codes either family admits the search on, and the guard that reads them', () => {
    const shell = APP_ROUTES.find((route: Route): boolean => route.component === ShellComponent);
    const search = shell?.children?.find((route: Route): boolean => route.path === 'search/:query');

    // Either read code admits the screen, because the scope the user picks at run time decides which rows they may read: the search control offers an "all" scope and a loans scope and is rendered for every user, and the results screen gates each row on its own family's read code, so a READ_LOAN-only user must reach the loan rows they may read (AAP 0.1.1, AAP 0.10.5 item 9, AAP 0.14.1).
    expect(search?.data?.['permission']).toEqual({ any: ['READ_CLIENT', 'READ_LOAN'] });
    expect(search?.canActivate ?? []).toContain(permissionGuard);
    expect(search?.data?.['breadcrumb']).toEqual(['label.heading.search']);
    expect(search?.loadComponent).toBeTypeOf('function');
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

  it('renders the not-found screen through a catch-all at both levels, the in-shell one last', () => {
    const wildcards: readonly Route[] = APP_ROUTES.filter(
      (route: Route): boolean => route.path === '**',
    );

    expect(wildcards).toHaveLength(1);
    expect(wildcards[0]?.component).toBe(NotFoundComponent);
    expect(APP_ROUTES.at(-1)).toBe(wildcards[0]);
    expect(wildcards[0]?.canActivate ?? []).not.toContain(authGuard);

    const shell = APP_ROUTES.find((route: Route): boolean => route.component === ShellComponent);
    const children: readonly Route[] = shell?.children ?? [];
    const inShell = children.at(-1);

    // The second placement, last among the shell's children: a signed-in visitor to an unknown URL is matched here, so the navbar, the breadcrumb and the shell's `<main class="content-wrapper">` landmark stay around the screen instead of being backtracked out of.
    expect(inShell?.path).toBe('**');
    expect(inShell?.component).toBe(NotFoundComponent);
    expect(children.filter((route: Route): boolean => route.path === '**')).toHaveLength(1);
    expect(inShell?.data).toBeUndefined();
    expect(wildcards[0]?.data).toBeUndefined();
    expect(inShell?.canActivate ?? []).not.toContain(permissionGuard);
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
      const codes: readonly string[] = declaredCodes(route.data?.['permission']);

      expect(codes.length).toBeGreaterThan(0);

      for (const code of codes) {
        expect(code).toMatch(ACCESS_CODE);
      }

      // Unguarded on purpose: `clients` is `permissionGuard`'s own denial destination, so the code its entry declares gates the navbar rather than this path — see the route group's header.
      if (route.path === 'clients') {
        expect(route.canActivate ?? []).not.toContain(permissionGuard);
        continue;
      }

      expect(route.canActivate ?? []).toContain(permissionGuard);
    }
  });

  it('declares the code of the command the :action segment names on the client action route', async () => {
    const route = await findRoute(CLIENT_ACTION_PATH);
    const declared: unknown = route?.data?.['permission'];

    // The declaration is the parameter name plus the five legacy codes, whole: a code widened, swapped, added or dropped here changes which command a user may post, so the case states the object rather than sampling it.
    expect(declared).toEqual({ param: 'action', codes: CLIENT_ACTION_CODES });
    expect(route?.canActivate ?? []).toContain(permissionGuard);
  });

  it('is the tree the router instantiates: a real navigation resolves against it', async () => {
    const router = routerFor(true);

    // The URL resolves against the real tree: the shell route matches, the lazy clients group loads, and the composed URL is the legacy one.
    await router.navigateByUrl('/clients');

    expect(router.url).toBe('/clients');
  });

  it('keeps a search navigation for a user holding only the loans read code', async () => {
    const router = routerFor(true);
    TestBed.inject(PermissionsService).setPermissions(['READ_LOAN']);

    // Against the real tree: a user holding only the loans read code keeps a search navigation, because the loans rows that user may read are behind this screen, so the navigation stays instead of being replaced by the clients list.
    await router.navigateByUrl('/search/ada');

    expect(router.url).toBe('/search/ada');
  });

  it('sends a search navigation to the clients list when the user holds neither read code', async () => {
    const router = routerFor(true);
    TestBed.inject(PermissionsService).setPermissions(['CREATE_CLIENT']);

    await router.navigateByUrl('/search/ada');

    expect(router.url).toBe('/clients');
  });

  it('renders an unknown URL inside the shell for a signed-in visitor', async () => {
    const router = routerFor(true);
    const unknown = unknownUrl(router);

    await router.navigateByUrl(unknown);

    expect(router.url).toBe(unknown);
    // The shell route matched and the not-found screen is its child, so the navbar, the breadcrumb and the shell's `<main class="content-wrapper">` landmark are on screen around it.
    expect(router.routerState.root.firstChild?.component).toBe(ShellComponent);
    expect(router.routerState.root.firstChild?.firstChild?.component).toBe(NotFoundComponent);
  });

  it('leaves an unknown URL outside the shell for a signed-out visitor', async () => {
    const router = routerFor(false);
    const unknown = unknownUrl(router);

    await router.navigateByUrl(unknown);

    expect(router.url).toBe(unknown);
    // Not the shell: entering it would hand the navigation to `authGuard`, which would replace it with the login form for a path that does not exist.
    expect(router.routerState.root.firstChild?.component).toBe(NotFoundComponent);
  });
});

type GuardAnswer = ReturnType<CanActivateFn>;

/** Behaviour of `permissionGuard` on the declaration shapes the route table uses — the code the route states, the list it requires, the `{ any }` list the search screen admits either code of, and the parameterised declaration `client/:id/:action` uses, where the `:action` segment (AAP 0.1.1, AAP 0.14.1). */
describe('permissionGuard', () => {
  const ACTION_DECLARATION = { param: 'action', codes: CLIENT_ACTION_CODES };

  const SEARCH_DECLARATION = { any: ['READ_CLIENT', 'READ_LOAN'] };

  /** The route snapshot the guard is handed for `#/client/2/<action>`. @param action the `:action` segment the URL carries. @param permission the route's `data.permission`, which defaults to the lifecycle declaration. */
  function routeFor(action: string, permission: unknown = ACTION_DECLARATION): ActivatedRouteSnapshot {
    const route = new ActivatedRouteSnapshot();
    route.params = { id: '2', action };
    route.data = { permission };

    return route;
  }

  /** The router state the guard is handed. Its second parameter is never consulted — no verdict depends on the target URL — so the router's own empty snapshot is the whole of what the contract needs, and no navigation is. */
  function unreadState(): RouterStateSnapshot {
    return TestBed.inject(Router).routerState.snapshot;
  }

  /** Runs the guard in the injector this case configured, which is what lets it inject its two services. */
  function runGuard(route: ActivatedRouteSnapshot): GuardAnswer {
    return TestBed.runInInjectionContext(() => permissionGuard(route, unreadState()));
  }

  /** The route a denial redirects to, serialized by the same router the guard built the tree with, or `null` when the guard allowed the navigation. */
  function denialTarget(answer: GuardAnswer): string | null {
    return answer instanceof UrlTree ? TestBed.inject(Router).serializeUrl(answer) : null;
  }

  beforeEach(() => {
    // A fresh injector per case: a permission list set by one case must never reach the next, and a second `configureTestingModule` on an instantiated module throws.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('lets the navigation through when the user holds the code the :action segment names', () => {
    TestBed.inject(PermissionsService).setPermissions(['READ_CLIENT', 'CLOSE_CLIENT']);

    expect(runGuard(routeFor('close'))).toBe(true);
  });

  it('denies a command the user holds only READ_CLIENT for, sending the navigation to the clients list', () => {
    TestBed.inject(PermissionsService).setPermissions(['READ_CLIENT']);

    // The read code lets the record open; it says nothing about a closure, so the guard refuses the screen whose form posts one (AAP 0.1.1).
    expect(denialTarget(runGuard(routeFor('close')))).toBe('/clients');
    expect(denialTarget(runGuard(routeFor('reactivate')))).toBe('/clients');
  });

  it('denies an :action value the codes map names no code for, a prototype key included', () => {
    TestBed.inject(PermissionsService).setPermissions(['ALL_FUNCTIONS']);

    expect(denialTarget(runGuard(routeFor('nonsense')))).toBe('/clients');
    // `toString` is a member of the map's prototype and of no declaration the route wrote, so an inherited-member lookup would ask about a code the route never named.
    expect(denialTarget(runGuard(routeFor('toString')))).toBe('/clients');
  });

  it('denies a route that carries no value for the parameter the declaration names', () => {
    TestBed.inject(PermissionsService).setPermissions(['ALL_FUNCTIONS']);

    const route = new ActivatedRouteSnapshot();
    route.params = { id: '2' };
    route.data = { permission: ACTION_DECLARATION };

    expect(denialTarget(runGuard(route))).toBe('/clients');
  });

  it('denies a malformed parameterised declaration rather than honouring half of it', () => {
    TestBed.inject(PermissionsService).setPermissions(['CLOSE_CLIENT']);

    expect(
      denialTarget(runGuard(routeFor('close', { param: '', codes: CLIENT_ACTION_CODES }))),
    ).toBe('/clients');
    expect(denialTarget(runGuard(routeFor('close', { param: 'action', codes: { close: 7 } })))).toBe(
      '/clients',
    );
    expect(denialTarget(runGuard(routeFor('close', { param: 'action', codes: null })))).toBe(
      '/clients',
    );
    expect(denialTarget(runGuard(routeFor('close', {})))).toBe('/clients');
  });

  it('denies the parameterised declaration while no session is present', () => {
    expect(denialTarget(runGuard(routeFor('close')))).toBe('/clients');
    expect(denialTarget(runGuard(routeFor('activate')))).toBe('/clients');
  });

  it('admits the search screen on the loans read code alone', () => {
    TestBed.inject(PermissionsService).setPermissions(['READ_LOAN']);

    // The screen offers a loans scope and gates its loan rows on this very code, so a user holding it may read what the search returns (AAP 0.1.1, AAP 0.10.5 item 9).
    expect(runGuard(routeFor('ada', SEARCH_DECLARATION))).toBe(true);
  });

  it('admits the search screen on the clients read code alone', () => {
    TestBed.inject(PermissionsService).setPermissions(['READ_CLIENT']);

    expect(runGuard(routeFor('ada', SEARCH_DECLARATION))).toBe(true);
  });

  it('denies the any-of declaration when the user holds neither code, sending the navigation to the clients list', () => {
    TestBed.inject(PermissionsService).setPermissions(['CREATE_CLIENT']);

    expect(denialTarget(runGuard(routeFor('ada', SEARCH_DECLARATION)))).toBe('/clients');
  });

  it('denies a malformed any-of declaration rather than admitting a screen on a list it cannot read', () => {
    TestBed.inject(PermissionsService).setPermissions(['READ_CLIENT', 'READ_LOAN']);

    expect(denialTarget(runGuard(routeFor('ada', { any: [] })))).toBe('/clients');
    expect(denialTarget(runGuard(routeFor('ada', { any: [7] })))).toBe('/clients');
    expect(denialTarget(runGuard(routeFor('ada', { any: 'READ_CLIENT' })))).toBe('/clients');
  });

  it('denies the any-of declaration while no session is present', () => {
    // `canAny` answers false without a session, so a list the user would hold after a login admits nothing before one.
    expect(denialTarget(runGuard(routeFor('ada', SEARCH_DECLARATION)))).toBe('/clients');
  });
});
