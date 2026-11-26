import { inject } from '@angular/core';
import {
  Router,
  type ActivatedRouteSnapshot,
  type CanActivateFn,
  type UrlTree,
} from '@angular/router';

import { PermissionsService } from './permissions.service';

/**
 * The route a denied navigation lands on. The in-scope route list holds no access-denied screen
 * (AAP 0.10.4, `web-ng/tools/parity/in-scope-routes.json`), and signing out is `authGuard`'s
 * decision rather than a permission answer, so the client list — the post-login landing screen — is
 * the one destination this guard can honestly send a user to.
 */
const DENIED_ROUTE: string = '/clients';

/**
 * The codes of an array-shaped permission declaration, or `null` when the declaration holds anything
 * except strings.
 *
 * The declaration is route configuration typed by the framework as `any`, so it reaches this function
 * as `unknown` entries and is narrowed one entry at a time (Rule 1 clause 4). A list that is partly
 * valid is not a permission list: `null` reports the malformed declaration so the caller can deny it,
 * rather than dropping the offending entry and enforcing a restriction nobody wrote.
 *
 * @param declared The array the route table declared in `data.permission`.
 * @returns The codes `PermissionsService.canAll()` decides, or `null` for a malformed declaration.
 */
function toPermissionCodes(declared: readonly unknown[]): readonly string[] | null {
  const codes: string[] = [];
  for (const entry of declared) {
    if (typeof entry !== 'string') {
      return null;
    }
    codes.push(entry);
  }
  return codes;
}

/**
 * Whether a value is a non-null object that is not an array — the shape a declaration's `codes` map
 * has.
 *
 * A type predicate rather than an assertion: the declaration is route configuration typed by the
 * framework as `any`, so every member reaches this file as `unknown` and is narrowed here instead of
 * being cast to a shape nothing has checked (Rule 1 clause 4).
 *
 * @param value The value to test.
 * @returns true when the value is an object a `codes` map could be read from.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The parameter name and the code map of a parameterised permission declaration, or `null` when the
 * declaration is not one.
 *
 * This is the shape a route that serves several commands from one path declares:
 * `{ param: 'action', codes: CLIENT_ACTION_PERMISSIONS }` names the route parameter whose value
 * selects the command and maps each of its values to that command's code
 * (`features/clients/clients.routes.ts` states it for `client/:id/:action`). The codes are copied
 * into a fresh `Record<string, string>` rather than kept by reference, so the guard reads a structure
 * its caller can no longer change, the copy carries no inherited member, and no prototype key can be
 * mistaken for a code the route wrote.
 *
 * A declaration missing either member, whose `param` is blank or not a string, whose `codes` is not a
 * plain object, or whose codes hold anything but strings, states no single restriction the gate can
 * enforce, so `null` reports it malformed and the caller denies it rather than honouring half of it.
 *
 * @param declared The object the route table declared in `data.permission`.
 * @returns The declaration's parameter name and its codes, or `null` for a malformed declaration.
 */
function toParameterisedPermission(
  declared: object,
): { readonly param: string; readonly codes: Readonly<Record<string, string>> } | null {
  if (!('param' in declared)) {
    return null;
  }

  if (!('codes' in declared)) {
    return null;
  }

  const param: unknown = declared.param;
  const declaredCodes: unknown = declared.codes;

  if (typeof param !== 'string' || param.trim().length === 0) {
    return null;
  }

  if (!isRecord(declaredCodes)) {
    return null;
  }

  const codes: Record<string, string> = {};
  for (const [value, code] of Object.entries(declaredCodes)) {
    if (typeof code !== 'string') {
      return null;
    }
    codes[value] = code;
  }

  return { param, codes };
}

/**
 * Route guard for every screen whose route declares a permission (AAP 0.7.1, row `permissionGuard`;
 * AAP 0.8.2, "each route declares its permission in `data.permission`").
 *
 * The declaration is read once, from `route.data`, and the verdict is `PermissionsService`'s alone —
 * the same service the `hasPermission` directive asks. One read and one decision are what make the
 * route gate and the navigation entry that links to it provably agree (AAP 0.14.1): a menu entry
 * cannot outlive its route, because both ask one service about one declaration.
 *
 * The shapes the route table may declare, and what each means:
 * - no declaration (`undefined` or `null`): the route is not gated beyond `authGuard`, which is what
 *   the shell and the login screen need;
 * - a single code, `'READ_CLIENT'`: `PermissionsService.has()` answers it, so a leading `!` asks for
 *   that permission's absence exactly as the template gate does;
 * - a list of codes: `PermissionsService.canAll()` answers it, so every code must be held;
 * - a parameterised declaration, `{ param: 'action', codes: CLIENT_ACTION_PERMISSIONS }`: the route
 *   whose parameter decides which command is being asked for declares the parameter's name and a map
 *   from its values to codes, so `client/:id/:action` enforces the code of the command its URL names.
 *   The value is read once from `route.paramMap`, and the verdict is `PermissionsService.has()` on the
 *   code the map names — the same question the directive gating that screen's submit control asks,
 *   which is what makes the guard and the template agree (AAP 0.1.1). A parameter the route does not
 *   carry, a value the map names no code for, and a map entry that is not a string all deny;
 * - anything else, a list holding a non-string and a malformed parameterised declaration included:
 *   denied. A malformed declaration states no permission the gate can honour, and a permission gate
 *   fails closed (AAP 0.1.1).
 *
 * The verdict is not cached and no session state is read here: the service already fails closed while
 * no session is present, so an unauthenticated user is denied every gated route even if this guard
 * runs before `authGuard`.
 *
 * The pending `RouterStateSnapshot` is not consulted — no decision here depends on the target URL —
 * so it is not declared: the project's lint configuration fails an unused parameter, and the guard's
 * behaviour is the declaration's alone.
 *
 * @param route The route being activated; its `data.permission` and, for a parameterised declaration,
 * the route parameter that declaration names are the only inputs.
 * @returns `true` when the navigation may proceed, or the denial `UrlTree` the router redirects to.
 */
export const permissionGuard: CanActivateFn = (route: ActivatedRouteSnapshot): boolean | UrlTree => {
  const permissions = inject(PermissionsService);
  const router = inject(Router);

  // Evaluated only on a denial, so an allowed navigation builds no tree it would then discard.
  const deny = (): UrlTree => router.createUrlTree([DENIED_ROUTE]);

  // Read once, into `unknown`. `Data`'s index signature is `any` in the framework's own types and
  // `noPropertyAccessFromIndexSignature` confines it to bracket access, so the annotation is what
  // stops that `any` here instead of letting it reach a permission decision (Rule 1 clause 4).
  const declared: unknown = route.data['permission'];

  if (declared === undefined || declared === null) {
    return true;
  }

  if (typeof declared === 'string') {
    return permissions.has(declared) ? true : deny();
  }

  if (Array.isArray(declared)) {
    const codes: readonly string[] | null = toPermissionCodes(declared);
    return codes !== null && permissions.canAll(codes) ? true : deny();
  }

  if (typeof declared === 'object' && declared !== null) {
    const parameterised = toParameterisedPermission(declared);

    // A declaration the gate cannot read states no restriction it can honour, so it denies rather
    // than letting the navigation through on a shape nobody intended.
    if (parameterised === null) {
      return deny();
    }

    const value = route.paramMap.get(parameterised.param);

    // No such parameter in the URL, or a value the map names no code for, leaves no code to ask
    // about. `Object.hasOwn` rather than `in`, so a value such as `toString` is refused instead of
    // matching an inherited member of the map's prototype.
    if (value === null || !Object.hasOwn(parameterised.codes, value)) {
      return deny();
    }

    return permissions.has(parameterised.codes[value]) ? true : deny();
  }

  return deny();
};
