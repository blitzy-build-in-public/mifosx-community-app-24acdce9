import { HttpClient } from '@angular/common/http';
import { Injectable, inject, type Signal } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';

import { AppConfigService } from '../config/app-config.service';
import { ApiError } from '../http/api-error';
import type { AuthResponse, SessionData, SessionUserResponse } from './session.model';
import { SessionService, type SessionUserReader } from './session.service';

/** The body of `POST /authentication`, the only credential exchange this application performs (legacy `app/scripts/services/AuthenticationService.js:123`): two members and no others, so the request the parity comparison reads is unchanged (Rule 1 clauses 2 and 3). */
export interface AuthenticationRequest {
  /** The account name exactly as the user typed it; nothing trims or normalises it. */
  readonly username: string;
  /** The submitted password, held in memory only long enough to be serialised: never stored, persisted, logged or put in a thrown error (Rule 1 clause 9, AAP 0.10.4). */
  readonly password: string;
}

/** The list `permissions()` answers with while no session is in effect: frozen once and shared, so it cannot be mutated into state. */
const NO_PERMISSIONS: readonly string[] = Object.freeze([]);

/** The message a `POST /authentication` answer that cannot describe a session is refused with; it names the members and never repeats a received value, so no authentication key or password reaches a screen, a log or a capture (Rule 1 clause 9). */
const MALFORMED_AUTHENTICATION_RESPONSE =
  'The authentication response did not carry a user id, an authentication key and a permission list, ' +
  'so no session was created.';

/** Narrows the `POST /authentication` answer into the session this application stores, or `null` when a member it needs is not of the right shape — the documented wire boundary of Rule 1 clause 4, and why no request can carry `Authorization: Basic undefined` (AAP 0.7.2 row `AuthResponse`). */
function toSession(value: unknown): SessionData | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const response = value as Record<string, unknown>;
  const userId = response['userId'];
  const authenticationKey = response['base64EncodedAuthenticationKey'];
  const permissions = response['permissions'];

  if (typeof userId !== 'number' || !Number.isFinite(userId)) {
    return null;
  }

  if (typeof authenticationKey !== 'string' || authenticationKey.length === 0) {
    return null;
  }

  if (!Array.isArray(permissions)) {
    return null;
  }

  // A type predicate rather than a boolean test, so the list below is a `string[]` this function has checked.
  const codes: string[] = permissions.filter((code): code is string => typeof code === 'string');

  if (codes.length !== permissions.length) {
    return null;
  }

  return { userId, authenticationKey, userPermissions: codes };
}

/** The application's login and logout entry point and the only place a credential is exchanged (AAP 0.7.1 `AuthService`; AAP 0.4.2; AAP 0.11.1 row 14): `POST /authentication`, the legacy session entry written from its checked answer, then the `GET /users/{id}` restore that labels the user menu and publishes the permissions (AAP 0.10.1 W1); it owns no header, no failure shaping, no navigation and no password policy, and logs nothing (Rule 1 clause 9, AAP 0.10.4). */
@Injectable({ providedIn: 'root' })
export class AuthService {
  /** The transport for the two calls a login makes; the interceptor attaches both headers. */
  private readonly http = inject(HttpClient);

  /** The owner of `apiBaseUrl` and `apiPath`, so this file holds no host and no API root (Rule 2). */
  private readonly config = inject(AppConfigService);

  /** The legacy session entry: the only persisted state a login produces, and the only logout target. */
  private readonly sessions = inject(SessionService);

  /** The `GET /users/{id}` reader `SessionService.restore()` needs, supplied as an arrow property so the restore can invoke it as a plain function; this file owns that URL and that service keeps none. */
  private readonly readUser: SessionUserReader = (userId: number): Observable<SessionUserResponse> =>
    this.http.get<SessionUserResponse>(this.config.apiUrl('users/' + userId));

  /** The session in effect, as a signal, so the shell re-renders when a login begins one or a logout ends one; published as `session` because `user()` already holds that name on this class (AAP 0.7.1). */
  readonly session: Signal<SessionData | null> = this.sessions.session;

  /** The account name the navigation bar labels its user menu with — `username` from `GET /users/{id}` — or `null` before a restore has resolved one. */
  readonly username: Signal<string | null> = this.sessions.username;

  /** Authenticates with Fineract and puts the resulting session into effect: `POST /authentication`, the checked answer written as the legacy entry, then the restore that issues `GET /users/{id}`; an answer that cannot describe a session rejects before anything is kept (AAP 0.7.1 `login`, AAP 0.10.1 W1). */
  async login(username: string, password: string): Promise<void> {
    const request: AuthenticationRequest = { username, password };

    const response = await firstValueFrom(
      this.http.post<AuthResponse>(this.config.apiUrl('authentication'), request),
    );

    const session = toSession(response);

    if (session === null) {
      // Nothing has been persisted at this point, so refusing the response leaves no entry, signal or header behind.
      throw new ApiError(MALFORMED_AUTHENTICATION_RESPONSE, 200);
    }

    this.sessions.write(session);

    // The entry exists from here on even if the restore fails, so its result is deliberately not tested: a 401, not a failed login, is what ends such a session.
    await this.sessions.restore(this.readUser);
  }

  /** Resumes the session a stored legacy entry describes by re-reading `GET /users/{id}`, called once from the app initializer before the first navigation (AAP 0.3.4 claim 9; AAP 0.7.1 `restore`); a failed projection resolves `false` rather than rejecting, leaving the gate closed. */
  async restore(): Promise<boolean> {
    return this.sessions.restore(this.readUser);
  }

  /** Ends the session: the stored entry, the signals and the permission list go through `SessionService`, and the `Authorization` header disappears with them; no HTTP call and no navigation (AAP 0.7.1 `logout`). */
  logout(): void {
    this.sessions.clear();
  }

  /** The session in effect, or `null` when there is none: the stored `{userId, authenticationKey, userPermissions}` shape, whose key nothing renders (Rule 1 clause 9). */
  user(): SessionData | null {
    return this.sessions.session();
  }

  /** The signed-in user's permission codes as Fineract returned them, or an empty list when there is no session — a read of `PermissionsService`'s own list, not a second copy (AAP 0.7.1 `permissions`). */
  permissions(): readonly string[] {
    return this.sessions.session()?.userPermissions ?? NO_PERMISSIONS;
  }

  /** Whether a session is in effect (AAP 0.7.1 `isAuthenticated`): the guard's question, answered from the same signal the interceptor and the navigation read. */
  isAuthenticated(): boolean {
    return this.sessions.session() !== null;
  }
}
