import { HttpClient } from '@angular/common/http';
import { Injectable, inject, type Signal } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';

import { AppConfigService } from '../config/app-config.service';
import { ApiError } from '../http/api-error';
import type { AuthResponse, SessionData, SessionUserResponse } from './session.model';
import { SessionService, type SessionUserReader } from './session.service';

/**
 * The body of `POST /fineract-provider/api/v1/authentication`, the only credential exchange this
 * application performs (AAP 0.7.3 row "W1 login and logout"; legacy
 * `app/scripts/services/AuthenticationService.js:123`, which posts exactly these two fields).
 *
 * Two members and no others: no tenant, no locale, no remember-me flag. The tenant travels as the
 * `Fineract-Platform-TenantId` header the interceptor adds, and adding a field legacy never sent
 * would change the request the parity comparison reads (Rule 1 clause 2, clause 3).
 */
export interface AuthenticationRequest {
  /** The account name exactly as the user typed it; nothing trims or normalises it. */
  readonly username: string;

  /**
   * The submitted password, held in memory only long enough to be serialised into this body. It is
   * never stored on a service, never persisted, never logged and never included in a thrown error
   * (Rule 1 clause 9, AAP 0.10.4).
   */
  readonly password: string;
}

/**
 * The list `permissions()` answers with while no session is in effect. Frozen once and shared, so a
 * caller cannot mutate the absence of permissions into state, and a repeated call allocates nothing.
 */
const NO_PERMISSIONS: readonly string[] = Object.freeze([]);

/**
 * The message a `POST /authentication` response that cannot describe a session is refused with. It
 * names the members the response had to carry and never repeats a value it received, so no
 * authentication key or password can reach the login screen, a log or a captured exchange through an
 * error (Rule 1 clause 9, AAP 0.10.4).
 */
const MALFORMED_AUTHENTICATION_RESPONSE =
  'The authentication response did not carry a user id, an authentication key and a permission list, ' +
  'so no session was created.';

/**
 * Narrows the `POST /authentication` answer into the session this application stores, or `null` when
 * it cannot become one (AAP 0.7.2, row `AuthResponse`; AAP 0.4.3 row 2).
 *
 * The response is a network boundary, so its members are checked at run time rather than trusted from
 * the declared type: `userId` has to be a finite number, `base64EncodedAuthenticationKey` a non-empty
 * string and `permissions` an array of strings. A response missing one of them would otherwise persist
 * a partial entry or reach the interceptor as `Authorization: Basic undefined`. The two flags the
 * response also carries are deliberately not read here (AAP 0.10.5 item 13).
 *
 * This is the documented boundary where the wire value is narrowed (Rule 1 clause 4), and it answers
 * the stored shape rather than the wire shape, so `SessionService.write()` receives exactly the three
 * members the legacy entry holds.
 *
 * @param value the response body, still unverified.
 * @returns the session to store, or `null` when the body cannot describe one.
 */
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

  // Filtered through a type predicate rather than a boolean test, so the list below is a `string[]`
  // this function has actually checked instead of the loosely typed array `Array.isArray` leaves
  // behind. A single non-string entry makes the whole list unusable.
  const codes: string[] = permissions.filter((code): code is string => typeof code === 'string');

  if (codes.length !== permissions.length) {
    return null;
  }

  return { userId, authenticationKey, userPermissions: codes };
}

/**
 * The application's login and logout entry point, and the only place a credential is exchanged
 * (AAP 0.7.1 core row "`AuthService`"; AAP 0.4.2 "Security architecture"; AAP 0.11.1 row 14).
 *
 * **What a login is.** `POST /authentication` with the two submitted fields, then the legacy session
 * entry written with the three members both front ends share, then the restore that re-reads the
 * authenticated user through `GET /users/{id}`. That is the recorded sequence of workflow W1
 * (AAP 0.10.1), and it is the sequence this class produces: one `POST`, exactly one `GET`, no third
 * call and no retry.
 *
 * **Why the restore is part of the login.** Legacy's `SessionManager.login` stores the entry and then
 * restores it, which is what fills the user label the navigation bar shows and publishes the
 * permission list the gates read (`app/scripts/services/SessionManager.js:20-48`). The restore runs
 * through `SessionService` with this service's own `GET /users/{id}` reader, so the request the
 * restore needs exists in a file allowed to own a Fineract URL and `SessionService` keeps none.
 *
 * **What this class deliberately does not own.**
 *
 *   - Headers. The interceptor sets `Authorization: Basic <key>` from the session and
 *     `Fineract-Platform-TenantId` from the configuration, which is why nothing here builds a
 *     header: a logout removes the authorization by removing the session (AAP 0.4.2).
 *   - Failure shaping. A Fineract error reaches the caller as the `ApiError` the interceptor
 *     produced, whose `message` is the server's `defaultUserMessage` verbatim, so the login screen
 *     renders the server's own words and keeps the typed username (AAP 0.4.4 decision 6). The one
 *     error this class raises itself is the `ApiError` for an authentication response that cannot
 *     describe a session, so a screen reads every login failure the same way.
 *   - Navigation. `login()` and `logout()` return before any route change; the login screen replays
 *     the `returnUrl` it kept, and the sign-out button and the idle timeout navigate.
 *   - The password policy, password renewal and two-factor authentication. None is a behaviour of the
 *     legacy login screen and all are out of scope, so the two flags on `AuthResponse` are typed,
 *     received and acted on by no branch here (AAP 0.9.2; AAP 0.10.5 item 13).
 *   - Duplicate-submission protection, which belongs to the screens through
 *     `shared/submit-guard.util.ts`; a second login call is a second login, as it is in legacy.
 *
 * **Nothing here is logged.** There is no `console` call in this file, and the authentication key the
 * response carries is only ever handed to `SessionService`, which persists it and nothing else
 * (Rule 1 clause 9, AAP 0.10.4 credential gate).
 *
 * The class is one of the seven Fineract URL owners `web-ng/eslint.config.js` exempts from the ban on
 * injecting `HttpClient`, and one of the six service files the narrower coverage gate measures
 * (AAP 0.8.2, AAP 0.10.3 criterion 2).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  /** The transport for the two calls a login makes; the interceptor attaches both headers. */
  private readonly http = inject(HttpClient);

  /** The owner of `apiBaseUrl` and `apiPath`, so this file holds no host and no API root (Rule 2). */
  private readonly config = inject(AppConfigService);

  /** The legacy session entry: the only persisted state a login produces, and the only logout target. */
  private readonly sessions = inject(SessionService);

  /**
   * The `GET /users/{id}` call `SessionService.restore()` needs, supplied as the reader that service
   * documents (`SessionUserReader`) because it holds no `HttpClient` of its own.
   *
   * An arrow-function property rather than a method so the reference keeps its `this`: the restore
   * invokes it as a plain function. The path is composed by `apiUrl()` and names only the resource —
   * `'users/' + userId` — so no host, API root or absolute URL appears in this file, and the
   * endpoint gate resolves the concatenation to the declared `/users/{id}` row.
   */
  private readonly readUser: SessionUserReader = (userId: number): Observable<SessionUserResponse> =>
    this.http.get<SessionUserResponse>(this.config.apiUrl('users/' + userId));

  /**
   * The session in effect, as a signal, so the shell can re-render when a login begins a session or a
   * logout ends one without injecting the storage service itself.
   *
   * It is published under the name `session` rather than `user` because the AAP-documented accessor
   * `user()` (AAP 0.7.1) already holds that name on this class, and one class cannot carry both; the
   * two read the same value, the accessor synchronously and this signal reactively.
   */
  readonly session: Signal<SessionData | null> = this.sessions.session;

  /**
   * The account name the navigation bar labels its user menu with — `username` from
   * `GET /users/{id}` — or `null` before a restore has resolved one.
   */
  readonly username: Signal<string | null> = this.sessions.username;

  /**
   * Authenticates with Fineract and puts the resulting session into effect (AAP 0.7.1
   * `login(username, password): Promise<void>`; AAP 0.10.1 W1).
   *
   * 1. `POST /authentication` with exactly `{username, password}` and no query parameter.
   * 2. The response is checked before anything is kept — a finite numeric `userId`, a non-empty
   *    `base64EncodedAuthenticationKey` and a `permissions` array of strings — and only then written
   *    as the legacy session entry, so an AngularJS screen on the same origin reads the same login.
   * 3. The entry is restored, which issues `GET /users/{id}` and publishes the user label and the
   *    permission list the gates read.
   *
   * A response that cannot describe a session rejects with the `ApiError` `toSession()` refuses it
   * with, before the entry is written: nothing is persisted, no session is published and no request
   * can carry `Authorization: Basic undefined` (AAP 0.4.3 row 2).
   *
   * A restore that resolves `false` does not fail the login: the entry is already written, and the
   * session it describes is not in effect, which is the state a 401 ends for good — a decision the
   * interceptor owns, not this method.
   *
   * @param username the account name, forwarded verbatim; it is neither trimmed nor validated here.
   * @param password the submitted password, used once inside the request body and then dropped.
   * @returns a promise that resolves once the session is in effect, and rejects with an `ApiError` —
   * whose `message` a screen renders verbatim — when the exchange fails or the response cannot
   * describe a session.
   */
  async login(username: string, password: string): Promise<void> {
    const request: AuthenticationRequest = { username, password };

    const response = await firstValueFrom(
      this.http.post<AuthResponse>(this.config.apiUrl('authentication'), request),
    );

    const session = toSession(response);

    if (session === null) {
      // Nothing has been persisted at this point, so refusing the response leaves no entry, no
      // session signal and no header behind.
      throw new ApiError(MALFORMED_AUTHENTICATION_RESPONSE, 200);
    }

    this.sessions.write(session);

    // The entry exists from here on even if the restore fails, so its result is deliberately not
    // tested: a projection read that failed is a request the interceptor answers, and failing the
    // login instead would report a credential rejection that never happened. With no session in
    // effect afterwards the permission gate is closed, which is the state a 401 settles.
    await this.sessions.restore(this.readUser);
  }

  /**
   * Resumes the session a stored legacy entry describes (AAP 0.3.4 claim 9: "restore re-reads it and
   * calls `userResource.get({userId})`"; AAP 0.7.1 `SessionService.restore(): Promise<boolean>`).
   *
   * The application start-up sequence calls this once, from the `provideAppInitializer` in
   * `web-ng/src/app/app.config.ts`, before the router performs its first navigation: a page reload
   * carries the session in `localStorage` but nothing in memory, so without this the `authGuard` would
   * read `isAuthenticated()` as false and send a returning user to the login screen. That is the
   * reload case of workflow W1, and the legacy application restored the same entry on every start
   * (`app/scripts/services/SessionManager.js:36-48`).
   *
   * It is this service's job rather than the initializer's because the projection read it needs is
   * `GET /users/{id}`, and the request itself lives here — the one file in the application allowed to
   * compose that URL (AAP 0.14.1). A failed projection resolves `false` rather than rejecting: the
   * entry stays where a 401 can act on it, and the permission gate stays closed, so start-up never
   * fails over a session the server has already refused.
   *
   * @returns whether a session is in effect once the restore has finished.
   */
  async restore(): Promise<boolean> {
    return this.sessions.restore(this.readUser);
  }

  /**
   * Ends the session (AAP 0.7.1 `logout(): void`).
   *
   * The stored entry, the session signals and the permission list all go through `SessionService`,
   * and the `Authorization` header disappears with them because the interceptor reads the key from
   * that session — the removal legacy performs explicitly at `HttpServiceProvider.js:50-53` is
   * therefore a consequence here rather than a second step. No HTTP call and no navigation: the
   * caller decides where the user lands.
   */
  logout(): void {
    this.sessions.clear();
  }

  /**
   * The session in effect, or `null` when there is none (AAP 0.7.1 `user()`).
   *
   * It carries the stored shape — `userId`, `authenticationKey` and `userPermissions` — which is what
   * a route guard, an initializer or a screen inspects when it has to act on the session as a whole.
   * Nothing renders the key: it is a bearer credential (Rule 1 clause 9).
   */
  user(): SessionData | null {
    return this.sessions.session();
  }

  /**
   * The signed-in user's permission codes, exactly as Fineract returned them, or an empty list when
   * there is no session (AAP 0.7.1 `permissions()`).
   *
   * It is a read of the session's own list, not a second copy: `PermissionsService` remains the one
   * owner of the answers a gate needs, and this accessor serves a caller that has to render or count
   * the codes themselves.
   */
  permissions(): readonly string[] {
    return this.sessions.session()?.userPermissions ?? NO_PERMISSIONS;
  }

  /**
   * Whether a session is in effect (AAP 0.7.1 `isAuthenticated()`): the guard's question, answered
   * from the same signal the interceptor and the navigation read, so no second notion of "signed in"
   * can drift from it.
   */
  isAuthenticated(): boolean {
    return this.sessions.session() !== null;
  }
}
