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
 * - anything else, a list holding a non-string included: denied. A malformed declaration states no
 *   permission the gate can honour, and a permission gate fails closed (AAP 0.1.1).
 *
 * The verdict is not cached and no session state is read here: the service already fails closed while
 * no session is present, so an unauthenticated user is denied every gated route even if this guard
 * runs before `authGuard`.
 *
 * The pending `RouterStateSnapshot` is not consulted — no decision here depends on the target URL —
 * so it is not declared: the project's lint configuration fails an unused parameter, and the guard's
 * behaviour is the declaration's alone.
 *
 * @param route The route being activated; its `data.permission` is the only input.
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

  return deny();
};
