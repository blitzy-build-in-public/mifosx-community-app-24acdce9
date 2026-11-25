import { Injectable, signal, type Signal } from '@angular/core';

/**
 * Fineract's super-user wildcard code: a user holding it may do everything, whatever code a screen
 * asks about. The legacy gate answers it first and unconditionally
 * (`app/scripts/controllers/main/MainController.js:108-110`), and so does this service, which is why
 * no screen has to special-case a super user.
 */
export const ALL_FUNCTIONS = 'ALL_FUNCTIONS';

/**
 * Fineract's read-only wildcard code. A user holding it passes every `READ_` question and nothing
 * else — the legacy read-wildcard rule at
 * `app/scripts/controllers/main/MainController.js:112-114`, which grants the reads without granting
 * the matching writes.
 */
export const ALL_FUNCTIONS_READ = 'ALL_FUNCTIONS_READ';

/**
 * The prefix that makes a permission a read (`READ_CLIENT`, `READ_LOAN`). The legacy answer tests
 * the first five characters of the code — `permission.substring(0, 5) == "READ_"`
 * (`app/scripts/controllers/main/MainController.js:113`) — before it consults `ALL_FUNCTIONS_READ`.
 */
const READ_PREFIX = 'READ_';

/** The list a user with no session holds. Frozen once, so it can never be mutated into state. */
const NO_PERMISSIONS: readonly string[] = Object.freeze([]);

/**
 * The application's single source of truth for "may this user do this?" (AAP 0.7.1, row
 * `PermissionsService`: "answers permission questions with legacy semantics"). The navigation
 * entries, the action buttons and the route guard all ask it, so the template-side gate and the
 * guard cannot disagree about what a permission code means (AAP 0.1.1).
 *
 * `SessionService` owns the hand-over: `restore()` publishes the stored `userPermissions` list (the
 * one Fineract returned to the login, which wins over whatever the `GET /users/{id}` projection
 * reports, as it does in legacy) through `setPermissions()`, and `SessionService.clear()` — driven
 * by a logout and by a 401 response — withdraws it through `clear()`. Nothing else sets it, and no
 * other copy of the permission list is kept in the application.
 *
 * The legacy algebra is reproduced step for step (AAP 0.3.4 claim 12, the `has-permission` directive
 * at `app/scripts/directives/HasPermissionDirective.js:5-27` and the `$rootScope.hasPermission`
 * answer at `app/scripts/controllers/main/MainController.js:104-127`): codes are trimmed, a leading
 * `!` inverts the question, `ALL_FUNCTIONS` grants every code and `ALL_FUNCTIONS_READ` grants every
 * `READ_` code.
 *
 * The gate **fails closed** (AAP 0.1.1, "a permission gate that fails closed"): until a login has
 * supplied a list, every method answers `false`, a negated key such as `'!READ_CLIENT'` included —
 * the absence of a user is never read as permission. An authenticated user who genuinely holds an
 * empty list is answered honestly instead, so `has('!READ_CLIENT')` is then `true` because they do
 * lack it, which is what the legacy directive shows for such a user too.
 *
 * The service holds no HTTP client and no router: it answers from the list it is given, so every
 * answer is synchronous and the permission list is replaced in one place.
 */
@Injectable({ providedIn: 'root' })
export class PermissionsService {
  /**
   * True once a login has supplied a permission list, false before that and again after `clear()`.
   * It is a signal so that a gate reading `permissions` re-evaluates when a session ends, even when
   * the resulting list is empty in both states.
   */
  private readonly sessionPresent = signal(false);

  /** The permission strings the signed-in user holds, exactly as Fineract returned them. */
  private readonly granted = signal<readonly string[]>(NO_PERMISSIONS);

  /**
   * Read-only view of the list the session supplies, for a caller that has to render or count what
   * the user holds. It is empty before a login and after `clear()`, and it is the signal a template
   * effect tracks when a gate must be re-evaluated as permissions arrive or are withdrawn — the
   * replacement for the legacy `permissionsChanged` broadcast.
   */
  readonly permissions: Signal<readonly string[]> = this.granted.asReadonly();

  /**
   * Replaces the permission list and marks the session as present. `SessionService.restore()` is its
   * only caller and calls it once per restore with the stored `userPermissions` list — the list the
   * `POST /authentication` response supplied at login, never the `GET /users/{id}` projection — so a
   * login reaches this seam only through the restore that follows it.
   *
   * The list is copied and frozen rather than kept by reference, so neither the caller's array nor a
   * reader of `permissions()` can change what the gate answers, and a second call replaces the list
   * instead of appending to it. The entries themselves are stored as Fineract returns them: the
   * legacy app trims the code it is asked about, never the list.
   */
  setPermissions(permissions: readonly string[]): void {
    this.granted.set(Object.freeze([...permissions]));
    this.sessionPresent.set(true);
  }

  /**
   * Empties the list and marks the session as absent — what a logout and a 401 response drive. Every
   * question then answers `false`, a negated one included, so the gate fails closed until the next
   * successful login supplies a list.
   */
  clear(): void {
    this.granted.set(NO_PERMISSIONS);
    this.sessionPresent.set(false);
  }

  /**
   * Answers whether the user holds `key`, mirroring the legacy `$rootScope.hasPermission`
   * (`app/scripts/controllers/main/MainController.js:104-127`) in the same order: the code is
   * trimmed, `ALL_FUNCTIONS` satisfies it outright, a `READ_` code is satisfied by
   * `ALL_FUNCTIONS_READ`, and otherwise the code itself must be in the list.
   *
   * Answers `false` while no session is present, whatever the key: the gate fails closed.
   */
  can(key: string): boolean {
    if (!this.sessionPresent()) {
      return false;
    }

    const code = key.trim();
    const granted = this.granted();

    // The super-user wildcard answers before anything else is considered, as it does in legacy, so a
    // user holding it passes even a code that names no permission.
    if (granted.includes(ALL_FUNCTIONS)) {
      return true;
    }

    // A blank code names no permission. The wildcard has already answered, so this test decides only
    // the remaining case — a signed-in user without `ALL_FUNCTIONS`, whose blank code is denied
    // rather than matched against the list. Legacy's `permission && permission != ""` guard runs in
    // that same position, after its own wildcard branch has had its chance to answer.
    if (code.length === 0) {
      return false;
    }

    if (code.startsWith(READ_PREFIX) && granted.includes(ALL_FUNCTIONS_READ)) {
      return true;
    }

    return granted.includes(code);
  }

  /**
   * The question the template gate actually asks (AAP 0.7.1, row `hasPermission` directive; AAP
   * 0.3.4 claim 12, `app/scripts/directives/HasPermissionDirective.js:5-27`): the code is trimmed,
   * and a leading `!` asks for that permission's **absence**, so `'!READ_CLIENT'` is true for a user
   * who does not hold `READ_CLIENT`.
   *
   * A bare `!` names nothing to negate and answers `false`, the same fail-closed answer as any other
   * code that names no permission. With no session present the answer is `false` for both shapes, a
   * negated one included.
   */
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
      // This is the one answer that knowingly differs from the legacy gate, and Rule 1 clause 3's
      // "match legacy, don't improve it" yields here to the stricter rule the gate itself exists
      // for: a permission gate must fail closed. Legacy reads a bare `!` as "permission absent" and
      // shows the element; a code that names nothing to negate is denied instead. No template can
      // bind this shape — a caller always names a code — and a route guard reads it the same way.
      return false;
    }

    return !this.can(remainder);
  }

  /**
   * True when the user holds at least one entry of `keys`. Each entry is asked through `has()`, so a
   * `'!CODE'` entry contributes its inversion. An empty array answers `false` — there is no entry to
   * satisfy — and so does every call made while no session is present.
   */
  canAny(keys: readonly string[]): boolean {
    if (!this.sessionPresent()) {
      return false;
    }

    return keys.some((key) => this.has(key));
  }

  /**
   * True only when the user holds every entry of `keys`, each asked through `has()` so a `'!CODE'`
   * entry contributes its inversion.
   *
   * An empty array answers `true`: it is vacuously satisfied, and a caller that declares no
   * permission has stated no restriction for this service to enforce. A session still has to be
   * present for that answer, so the gate never opens for nobody — a picker or menu that declares no
   * permission stays closed to a signed-out user.
   */
  canAll(keys: readonly string[]): boolean {
    if (!this.sessionPresent()) {
      return false;
    }

    return keys.every((key) => this.has(key));
  }
}
