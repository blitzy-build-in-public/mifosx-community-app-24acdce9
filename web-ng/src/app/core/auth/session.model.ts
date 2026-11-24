/**
 * The legacy session entry, stored in `localStorage` and read by both front ends: this
 * application writes it through `SessionService`, and the AngularJS screens still in
 * service read the same entry through the legacy `SessionManager`
 * (`app/scripts/services/SessionManager.js`). The member names and types below are that
 * stored contract, so renaming a member or persisting an extra one breaks the shared
 * login and the parity it depends on.
 */
export interface SessionData {
  /** Fineract id of the authenticated user, read on restore by `GET /users/{id}`. */
  userId: number;

  /**
   * The `base64EncodedAuthenticationKey` returned by `POST /authentication`. It is a
   * bearer credential: the interceptor sends it on every request as
   * `Authorization: Basic <key>`, it is never logged, and it is persisted nowhere except
   * in the legacy session entry.
   */
  authenticationKey: string;

  /** Permission strings consulted by `PermissionsService`, `permissionGuard` and `hasPermission`. */
  userPermissions: string[];
}

/**
 * The body of Fineract's `POST /authentication` call (under the configured API path).
 * `AuthService` reads `userId`, `username`, `base64EncodedAuthenticationKey` and
 * `permissions` from it and keeps the submitted password in memory only for the call.
 */
export interface AuthResponse {
  userId: number;
  username: string;
  base64EncodedAuthenticationKey: string;
  permissions: string[];

  /**
   * Read and deliberately ignored: the password-renewal flow is out of scope
   * (AAP 0.9.2, 0.10.5 item 13). Typed so the response is fully described; no code path
   * acts on it.
   */
  shouldRenewPassword?: boolean;

  /**
   * Read and deliberately ignored: two-factor authentication is out of scope
   * (AAP 0.9.2, 0.10.5 item 13). Typed so the response is fully described; no code path
   * acts on it.
   */
  isTwoFactorAuthenticationRequired?: boolean;
}

/**
 * A partial projection of the far larger `GET /users/{id}` body read by the session
 * restore. Only these three members are used — `permissions` reconciles the stored
 * permission list and `username` feeds `SessionService`'s user signal behind the
 * user-menu label — and the remaining fields of the real response are intentionally
 * unmodelled, which is how Rule 1 clause 4 is met without declaring a hundred unused
 * members.
 */
export interface SessionUserResponse {
  id: number;
  username: string;
  permissions?: string[];
}
