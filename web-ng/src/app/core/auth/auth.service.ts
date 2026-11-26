import { HttpClient } from '@angular/common/http';
import { Injectable, inject, type Signal } from '@angular/core';
import { catchError, firstValueFrom, throwError, type Observable } from 'rxjs';

import { AppConfigService } from '../config/app-config.service';
import { ApiError, toDisplayableFailure } from '../http/api-error';
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

/** The message a sign-in that leaves no session in effect is refused with when no failed request explains it: it names the missing session and repeats no submitted value, so no account name, password or authentication key can reach a screen, a log or a capture through it (Rule 1 clause 9, AAP 0.10.4). */
const NO_SESSION_AFTER_SIGN_IN =
  'The sign-in was accepted but no session is in effect, so the user was not signed in.';

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

  /**
   * Authenticates with Fineract and puts the resulting session into effect: `POST /authentication`, the checked answer written as the legacy entry, then the restore that issues `GET /users/{id}`; an answer that cannot describe a session rejects before anything is kept (AAP 0.7.1 `login`, AAP 0.10.1 W1).
   *
   * A restore that leaves no session in effect rejects the login with the failure that caused it — the `ApiError` the interceptor built from the failed `GET /users/{id}`, or {@link NO_SESSION_AFTER_SIGN_IN} when nothing failed — so a correct password never ends in an unexplained return to the login form once `authGuard` reads the withdrawn session. The 4xx the interceptor deliberately leaves silent is the case this closes (AAP 0.14.2 "Error handling"); a 5xx or transport fault reaches the caller as the same `ApiError` its one notification already reported. The written entry stands or falls with that restore (AAP 0.4.2): status 401 removes it, and so does status 0 — the form a cross-origin 401 arrives in when the browser cannot read the answer, which a genuine transport fault is indistinguishable from — while every other failure leaves it where the interceptor's 401 branch can act on it.
   */
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

    // The cause of this call's own projection read is kept local to it, never in instance state, so two
    // logins in flight cannot read each other's failure. The reader rethrows it unchanged, which leaves
    // `SessionService.restore()`'s `Promise<boolean>` contract alone: it still resolves `false`, and it
    // removes the written entry for a refused credential (status 401, or the status 0 a cross-origin 401
    // arrives as) while every other failure leaves that entry in place.
    const captured: { cause?: unknown } = {};

    const readProjection: SessionUserReader = (userId: number) =>
      this.readUser(userId).pipe(
        catchError((cause: unknown) => {
          captured.cause = cause;
          return throwError(() => cause);
        }),
      );

    if (await this.sessions.restore(readProjection)) {
      return;
    }

    // No session is in effect, so the login did not happen: resolving would navigate a screen an empty
    // session then sends straight back here with nothing said — what a silent 4xx made indistinguishable
    // from a refused credential (AAP 0.14.2 "Error handling": every HTTP call path ends in a rendered
    // message). The status the failure arrived with is kept, so a 4xx is painted inline by the screen
    // and a 5xx or transport fault is left to the interceptor's one notification. The no-cause case
    // carries status 200 like the malformed-answer refusal above, the marker this codebase uses for a
    // locally raised error that no HTTP answer explains.
    //
    // This is a deliberate difference from legacy, which shows the user nothing on this path (Rule 1
    // clause 3): AAP 0.14.2 requires a rendered failure, and the sign-in form's one error region is
    // where it is rendered.
    throw 'cause' in captured
      ? toDisplayableFailure(captured.cause)
      : new ApiError(NO_SESSION_AFTER_SIGN_IN, 200);
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
