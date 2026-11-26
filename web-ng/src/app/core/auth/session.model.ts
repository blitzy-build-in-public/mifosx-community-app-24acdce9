/** The legacy session entry, stored in `localStorage` and read by both front ends: this application writes it through `SessionService` and the AngularJS screens still in service read it through `SessionManager` (`app/scripts/services/SessionManager.js`), so the member names and types below are that stored contract. */
export interface SessionData {
  /** Fineract id of the authenticated user, read on restore by `GET /users/{id}`. */
  userId: number;
  /** The `base64EncodedAuthenticationKey` from `POST /authentication`: a bearer credential the interceptor sends as `Authorization: Basic <key>`, never logged and persisted only in this entry (Rule 1 clause 9). */
  authenticationKey: string;
  /** Permission strings consulted by `PermissionsService`, `permissionGuard` and `hasPermission`. */
  userPermissions: string[];
}

/** The body of Fineract's `POST /authentication`, whose `userId`, `username`, `base64EncodedAuthenticationKey` and `permissions` `AuthService` reads. */
export interface AuthResponse {
  /** Fineract id of the authenticated user, from `POST /authentication`; becomes `SessionData.userId`. */
  userId: number;
  /** The name the user authenticated with, from `POST /authentication`; labels the user menu. */
  username: string;
  /** The Basic credential from `POST /authentication`, sent as `Authorization: Basic <key>` and persisted only in the legacy session entry. */
  base64EncodedAuthenticationKey: string;
  /** The permission strings from `POST /authentication`, consulted through `PermissionsService` and the permission guard, `ALL_FUNCTIONS` allowing everything. */
  permissions: string[];
  /** Read and deliberately ignored: password renewal is out of scope (AAP 0.9.2, AAP 0.10.5 item 13); typed so the response is fully described and no code path acts on it. */
  shouldRenewPassword?: boolean;
  /** Read and deliberately ignored: two-factor authentication is out of scope (AAP 0.9.2, AAP 0.10.5 item 13); typed so the response is fully described and no code path acts on it. */
  isTwoFactorAuthenticationRequired?: boolean;
}

/** A partial projection of the far larger `GET /users/{id}` body the restore reads: `permissions` reconciles the stored permission list and `username` labels the user menu, and the remaining fields are intentionally unmodelled, which is how Rule 1 clause 4 is met without declaring a hundred unused members. */
export interface SessionUserResponse {
  /** Fineract user id, and the `{id}` the restore reads `GET /users/{id}` with. */
  id: number;
  /** The account name the user-menu label shows, held in `SessionService`'s user signal. */
  username: string;
  /** The tenant permission list the restore reconciles the stored `userPermissions` against; absent when the response omits it. */
  permissions?: string[];
}
