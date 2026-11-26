import { Injectable, signal, type Signal } from '@angular/core';

/** Fineract's super-user wildcard code, which legacy answers first and unconditionally (`app/scripts/controllers/main/MainController.js:108-110`), so no screen has to special-case a super user. */
export const ALL_FUNCTIONS = 'ALL_FUNCTIONS';

/** Fineract's read-only wildcard: it passes every `READ_` question and nothing else — legacy's read-wildcard rule (`MainController.js:112-114`), which grants the reads without granting the matching writes. */
export const ALL_FUNCTIONS_READ = 'ALL_FUNCTIONS_READ';

/** The prefix that makes a permission a read (`READ_CLIENT`): legacy tests the first five characters of the code (`MainController.js:113`) before consulting `ALL_FUNCTIONS_READ`. */
const READ_PREFIX = 'READ_';

/** The list a user with no session holds. Frozen once, so it can never be mutated into state. */
const NO_PERMISSIONS: readonly string[] = Object.freeze([]);

/** The application's single source of truth for "may this user do this?" (AAP 0.7.1 `PermissionsService`; AAP 0.3.4 claim 12, `HasPermissionDirective.js:5-27` and `MainController.js:104-127`): codes are trimmed, a leading `!` inverts the question, `ALL_FUNCTIONS` grants everything and `ALL_FUNCTIONS_READ` every `READ_` code, and with no session every answer is `false`, because the gate fails closed (AAP 0.1.1). */
@Injectable({ providedIn: 'root' })
export class PermissionsService {
  /** True once a login has supplied a permission list, false before that and again after `clear()`; a signal, so a gate re-evaluates when a session ends even when the list is empty in both states. */
  private readonly sessionPresent = signal(false);

  /** The permission strings the signed-in user holds, exactly as Fineract returned them. */
  private readonly granted = signal<readonly string[]>(NO_PERMISSIONS);

  /** Read-only view of the list the session supplies, for a caller that renders or counts it — the signal a template effect tracks when a gate must re-evaluate, the replacement for legacy's `permissionsChanged` broadcast. */
  readonly permissions: Signal<readonly string[]> = this.granted.asReadonly();

  /** Replaces the permission list and marks the session as present; `SessionService.restore()` is its only caller and passes the stored `userPermissions`, never the `GET /users/{id}` projection. The list is copied and frozen, so neither the caller's array nor a reader of `permissions()` can change what the gate answers, and a second call replaces it. */
  setPermissions(permissions: readonly string[]): void {
    this.granted.set(Object.freeze([...permissions]));
    this.sessionPresent.set(true);
  }

  /** Empties the list and marks the session as absent — what a logout and a 401 response drive — so every question then answers `false` and the gate fails closed until the next login. */
  clear(): void {
    this.granted.set(NO_PERMISSIONS);
    this.sessionPresent.set(false);
  }

  /** Answers whether the user holds `key`, mirroring legacy's `$rootScope.hasPermission` (`MainController.js:104-127`): the code is trimmed, `ALL_FUNCTIONS` satisfies it outright, a `READ_` code is satisfied by `ALL_FUNCTIONS_READ`, and otherwise the code must be in the list. */
  can(key: string): boolean {
    if (!this.sessionPresent()) {
      return false;
    }

    const code = key.trim();
    const granted = this.granted();

    // The super-user wildcard answers before anything else, as in legacy, so a user holding it passes even a code that names no permission.
    if (granted.includes(ALL_FUNCTIONS)) {
      return true;
    }

    // A blank code names no permission: the wildcard has already answered, so this denies rather than matching the list — the position legacy's own `permission && permission != ""` guard runs in.
    if (code.length === 0) {
      return false;
    }

    if (code.startsWith(READ_PREFIX) && granted.includes(ALL_FUNCTIONS_READ)) {
      return true;
    }

    return granted.includes(code);
  }

  /** The question the template gate asks (AAP 0.7.1 `hasPermission` directive; AAP 0.3.4 claim 12): the code is trimmed and a leading `!` asks for that permission's absence; a bare `!` and a call with no session both answer `false`. */
  has(key: string): boolean {
    if (!this.sessionPresent()) {
      return false;
    }

    const code = key.trim();
    if (!code.startsWith('!')) {
      return this.can(code);
    }

    const remainder = code.slice(1).trim();
    if (remainder.length === 0) {
      // The one answer that knowingly differs from legacy: a bare `!` names nothing to negate, and a permission gate must fail closed (Rule 1 clause 3 yields here to AAP 0.1.1).
      return false;
    }

    return !this.can(remainder);
  }

  /** True when the user holds at least one entry of `keys`, each asked through `has()` so a `'!CODE'` entry contributes its inversion; an empty array and every call with no session answer `false`. */
  canAny(keys: readonly string[]): boolean {
    if (!this.sessionPresent()) {
      return false;
    }

    return keys.some((key) => this.has(key));
  }

  /** True only when the user holds every entry of `keys`, each asked through `has()`; an empty array is vacuously satisfied but still needs a session, so a picker that declares no permission stays closed to a signed-out user. */
  canAll(keys: readonly string[]): boolean {
    if (!this.sessionPresent()) {
      return false;
    }

    return keys.every((key) => this.has(key));
  }
}
