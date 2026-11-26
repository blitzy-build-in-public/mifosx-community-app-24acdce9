import { inject } from '@angular/core';
import {
  Router,
  type ActivatedRouteSnapshot,
  type CanActivateFn,
  type UrlTree,
} from '@angular/router';

import { PermissionsService } from './permissions.service';

/** The route a denied navigation lands on. The in-scope route list holds no access-denied screen (AAP 0.10.4, `web-ng/tools/parity/in-scope-routes.json`), and signing out is `authGuard`'s decision rather than a permission. */
const DENIED_ROUTE: string = '/clients';

/** The codes of an array-shaped permission declaration, or `null` when the declaration holds anything except strings (Rule 1 clause 4). */
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

/** Whether a value is a non-null object that is not an array — the shape a declaration's `codes` map has (Rule 1 clause 4). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The parameter name and the code map of a parameterised permission declaration, or `null` when the declaration is not one. */
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

/** Route guard for every screen whose route declares a permission (AAP 0.7.1, row `permissionGuard`; AAP 0.8.2, "each route declares its permission in `data.permission`") (AAP 0.14.1, AAP 0.1.1). */
export const permissionGuard: CanActivateFn = (route: ActivatedRouteSnapshot): boolean | UrlTree => {
  const permissions = inject(PermissionsService);
  const router = inject(Router);

  // Evaluated only on a denial, so an allowed navigation builds no tree it would then discard.
  const deny = (): UrlTree => router.createUrlTree([DENIED_ROUTE]);

  // Read once, into `unknown`. `Data`'s index signature is `any` in the framework's own types and `noPropertyAccessFromIndexSignature` confines it to bracket access, so the annotation is what stops that `any` here instead (Rule 1 clause 4).
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

    // A declaration the gate cannot read states no restriction it can honour, so it denies rather than letting the navigation through on a shape nobody intended.
    if (parameterised === null) {
      return deny();
    }

    const value = route.paramMap.get(parameterised.param);

    // No such parameter in the URL, or a value the map names no code for, leaves no code to ask about.
    if (value === null || !Object.hasOwn(parameterised.codes, value)) {
      return deny();
    }

    return permissions.has(parameterised.codes[value]) ? true : deny();
  }

  return deny();
};
