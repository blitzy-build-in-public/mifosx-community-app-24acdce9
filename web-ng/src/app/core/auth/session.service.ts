import { DOCUMENT, Injectable, computed, inject, signal, type Signal } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';

import { ApiError } from '../http/api-error';
import { PermissionsService } from './permissions.service';
import type { SessionData, SessionUserResponse } from './session.model';
import { apiOriginOf, credentialOriginFor, type ApiBaseUrls } from './session-origin';

/** The prefix the legacy storage wrapper is configured with (`.constant('prefix', 'mifosX')`, `app/scripts/webstorage-configuration.js:3`), under which both front ends keep the shared session (AAP 0.3.4 claim 9). */
export const LEGACY_STORAGE_PREFIX = 'mifosX';

/** The entry name the legacy `SessionManager` uses — `sessionData` — written at `SessionManager.js:20-23`, removed at :31 and read at :37. */
export const SESSION_ENTRY_KEY = 'sessionData';

/** The entry name this application records the credential's API origin under — `sessionOrigin` — a sibling of the session entry under the same legacy `mifosX` prefix, so the composed key is `mifosXsessionOrigin`. It is a separate entry and not a fourth member of the session, which keeps exactly its three legacy fields (AAP 0.7.2 row `SessionData`), and it holds a URL origin alone — never the authentication key, a password or any other session material (Rule 1 clause 9). */
export const SESSION_ORIGIN_ENTRY = 'sessionOrigin';

/** The key the legacy pair stores at: `prefix + key` by raw string concatenation, so `'mifosXsessionData'` (AAP 0.3.4 claim 9); later releases of the library ignore the prefix and either front end may have written either spelling on the shared origin (AAP 0.4.2), so `read()` accepts both — and this function is the single place that key is derived (AAP 0.9.4 row 7). */
export function sessionStorageKey(
  prefix: string = LEGACY_STORAGE_PREFIX,
  entry: string = SESSION_ENTRY_KEY,
): string {
  return prefix + entry;
}

/** A JSON object: the only shape a stored session entry may present. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The HTTP `status` a failed request reaches the restore as, or `null` when the caught value carries none: the `ApiError` the interceptor builds declares one, a raw `HttpErrorResponse` carries one too, and anything else is a failure that was never a response — so the value is narrowed member by member rather than asserted (Rule 1 clause 4). */
function failureStatus(cause: unknown): number | null {
  if (!isRecord(cause)) {
    return null;
  }

  const status = cause['status'];

  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

/** Whether a failed read is this application's own request bound firing on a request Fineract never answered — the `timedOut` mark `fineract.interceptor.ts` sets on the `TimeoutError` it replaces with an `ApiError` — rather than anything the server said. The status cannot tell the two apart: an unanswered read carries the transport-failure status `0`, which is also the form this deployment's refused cross-origin credential arrives in, while an unanswered read says nothing whatever about the key (AAP 0.7.2, AAP 0.4.2). */
function isUnansweredRead(cause: unknown): boolean {
  return cause instanceof ApiError && cause.timedOut;
}

/** The stored entry as a `SessionData`, or `null` when it is anything else: whatever a previous release of either front end wrote is input rather than a typed value, so it is parsed into `unknown` and narrowed field by field (Rule 1 clause 4, AAP 0.7.2 row `SessionData`). */
function toSessionData(value: unknown): SessionData | null {
  if (!isRecord(value)) {
    return null;
  }

  const userId = value['userId'];
  const authenticationKey = value['authenticationKey'];
  const userPermissions = value['userPermissions'];

  if (typeof userId !== 'number' || !Number.isFinite(userId)) {
    return null;
  }

  if (typeof authenticationKey !== 'string' || authenticationKey.length === 0) {
    return null;
  }

  if (!Array.isArray(userPermissions)) {
    return null;
  }

  // A type predicate rather than a boolean test, so the list below is a `string[]` this function has checked (Rule 1 clause 4).
  const codes: string[] = userPermissions.filter((code): code is string => typeof code === 'string');
  if (codes.length !== userPermissions.length) {
    return null;
  }

  return { userId, authenticationKey, userPermissions: codes };
}

/** Supplies the `GET /users/{id}` answer the restore needs (AAP 0.7.3 W1) — legacy's `userResource.get({userId})` at `SessionManager.js:41` — so this service owns no HTTP call and names no Fineract path: only `auth.service.ts` of the two may hold `HttpClient` (AAP 0.8.2, AAP 0.14.1), and the owning service passes its call in. */
export type SessionUserReader = (userId: number) => Observable<SessionUserResponse>;

/** The legacy session entry both front ends share, bound to the API origin it was issued against: reads, writes and removes the `{userId, authenticationKey, userPermissions}` JSON `SessionManager` writes under the `mifosX` prefix, restores it through `GET /users/{id}`, and clears it on logout and on an observed refusal of the credential (AAP 0.7.1 `SessionService`; AAP 0.4.2; AAP 0.3.4 claim 9), with `PermissionsService` the one owner of the list and the key never logged (Rule 1 clause 9). A refusal is a received 401 or the status-0 form a refused cross-origin 401 arrives in; a read the application's own request bound cut off is not one — it is indeterminate, so the stored entry is kept for the next start-up to re-validate, exactly as legacy's `SessionManager.restore()` keeps an entry it could not validate (AAP 0.7.2, Rule 1 clause 3). Each write also records that origin in the sibling `mifosXsessionOrigin` entry and each restore publishes it, so the interceptor presents the key only to the origin it was issued against (AAP 0.4.4 decision 5). A credential whose recorded origin is not the origin this page resolved is withheld rather than deleted: the stored entry belongs to another origin, where the legacy app may still be using it, so it is left exactly where it was found (Rule 1 clause 9, Rule 1 clause 3). */
@Injectable({ providedIn: 'root' })
export class SessionService {
  /** Injected rather than read off the `document` global, so a test can supply a document with no browsing context and the storage-unavailable path stays exercisable. */
  private readonly document = inject(DOCUMENT);

  /** The single owner of the permission list: `clear()` withdraws through it and the restore publishes the stored list through it, so the template gate and the route guard answer from one list (AAP 0.1.1). */
  private readonly permissions = inject(PermissionsService);

  /** The session this application itself published, or `null` when none is in effect. */
  private readonly state = signal<SessionData | null>(null);

  /** The API origin the session's credential was issued against, or `null` when no credential is published; `write()` and `restore()` publish it, `clear()` empties it (AAP 0.4.4 decision 5). */
  private readonly origin = signal<string | null>(null);

  /** The last entry this instance wrote or found, kept so the session survives while the browser's storage cannot answer — the memory fallback of `app/scripts/webstorage-configuration.js:6-12`. */
  private memoryEntry: string | null = null;

  /** The recorded origin of `memoryEntry`, kept for the same reason: a store that cannot answer still has to tell the interceptor which origin the in-memory credential belongs to. */
  private memoryOrigin: string | null = null;

  /** True while the browser's storage is the state this instance reads; false once a write or a removal failed, from which point the in-memory copy is the only state worth trusting. */
  private storageInSync = true;

  /** The projection of the last restored session, which is what the user-menu label shows. */
  private readonly currentUser = signal<SessionUserResponse | null>(null);

  /** The in-memory session the interceptor reads for `Authorization: Basic <authenticationKey>` (AAP 0.4.2): published by `write()` and `restore()`, emptied by `clear()`, so no request path parses the stored JSON. */
  readonly session: Signal<SessionData | null> = this.state.asReadonly();

  /** The API origin the published credential was issued against, or `null` when none is published — the interceptor presents the key only where `apiOriginOf(request.url)` is this origin, so a page URL naming another base receives no credential (AAP 0.4.4 decision 5, Rule 1 clause 9). Empty until a `write()` or a `restore()` publishes one. */
  readonly credentialOrigin: Signal<string | null> = this.origin.asReadonly();

  /** The `{id, username}` projection of the restored session, which is the label the user menu shows; `write()` and `clear()` empty it, and it carries no permissions, because `PermissionsService` holds the only copy (AAP 0.7.1). */
  readonly user: Signal<SessionUserResponse | null> = this.currentUser.asReadonly();

  /** The account name the user menu is labelled with — `username` from `GET /users/{id}` — or `null` until a restore has resolved one; a projection of `user()`, deliberately not part of the stored entry (AAP 0.7.2 row `SessionData`). */
  readonly username: Signal<string | null> = computed(() => this.currentUser()?.username ?? null);

  /** The stored session entry, or `null` when there is none or it is not well formed (AAP 0.7.1 `read`): a pure storage read that publishes nothing, the composed `mifosXsessionData` key first and the bare `sessionData` spelling second, a malformed entry under the composed key reported rather than falling through, and every unreadable entry left where it was found, as legacy leaves it (Rule 1 clause 3). */
  read(): SessionData | null {
    const raw = this.readEntry();

    if (raw === null) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    return toSessionData(parsed);
  }

  /** Persists `session` as the legacy entry — exactly its three stored fields, because the entry is a contract with the legacy screens (AAP 0.7.2 `SessionData`) — records the API origin the credential was issued against beside it, and publishes both (AAP 0.7.1 `write`, AAP 0.4.4 decision 5): the session and the base are checked, normalised and serialised before anything is persisted, the permissions are published by the `restore()` that follows (`SessionManager.js:41-43`), and `user()` empties with the label it described. @param apiBaseUrl the resolved base the credential exchange was made against, whose origin the key may be presented to and no other (Rule 1 clause 9). */
  write(session: SessionData, apiBaseUrl: string): void {
    const data = toSessionData(session);

    if (data === null) {
      throw new TypeError(
        'SessionService.write() needs a session shaped like the legacy entry: a finite numeric ' +
          'userId, a non-empty authenticationKey and a userPermissions array of strings.',
      );
    }

    const origin = apiOriginOf(apiBaseUrl);

    if (origin === null) {
      // A credential with no origin of record could never be presented again — or worse, would be presented wherever the next page URL pointed — so the write is refused rather than left half bound. The message names the requirement and never the value it received, which could carry more than a host (Rule 1 clause 9).
      throw new TypeError(
        'SessionService.write() needs the absolute API base URL the credential was issued against: ' +
          'an http:// or https:// URL, because the origin it names is the only one the key may be ' +
          'presented to (AAP 0.4.4 decision 5).',
      );
    }

    this.writeEntry(
      JSON.stringify({
        userId: data.userId,
        authenticationKey: data.authenticationKey,
        userPermissions: data.userPermissions,
      }),
    );
    this.writeOrigin(origin);

    this.state.set(data);
    this.origin.set(origin);
    this.currentUser.set(null);
  }

  /** Ends the session: the stored session entry and its recorded origin both go, the signals empty and the permission gate is withdrawn (AAP 0.7.1 `clear`; AAP 0.4.2). It is idempotent, and both stored spellings of the session are removed so a leftover entry cannot sign the user back in. */
  clear(): void {
    this.removeEntry();
    this.state.set(null);
    this.origin.set(null);
    this.currentUser.set(null);
    this.permissions.clear();
  }

  /** Puts the stored session back into effect in legacy's order (`SessionManager.js:36-48`; AAP 0.7.1 `restore`), but only for the origin its credential belongs to: the recorded origin is compared with the bases this page resolved, and a session issued against another origin is not published at all — no session, no credential origin, no user and no permissions, no `readUser` call, and both stored entries left exactly where they were, because they belong to that other origin and the legacy app may still be using them (AAP 0.4.4 decision 5, Rule 1 clause 9). Otherwise the session and its origin are published before `readUser` runs, since that request carries its key (:40-41), then the projection fills `user()` and the stored `userPermissions` are published through `PermissionsService` (:42) — and it publishes only for the session it started on, resolving `false` for a superseded or unreadable one. @param bases the base this page resolved and the base the served file named, which together decide whether the stored credential may be presented (see `credentialOriginFor`). */
  async restore(bases: ApiBaseUrls, readUser?: SessionUserReader): Promise<boolean> {
    const stored = this.read();
    const origin = stored === null ? null : credentialOriginFor(this.readOrigin(), bases);

    if (stored === null || origin === null) {
      // Nothing is in effect: either nothing is stored, or what is stored belongs to another API origin (AAP 0.1.1). No stored entry is removed here, so a credential withheld from this page survives for the one it was issued against (Rule 1 clause 9).
      this.state.set(null);
      this.origin.set(null);
      this.currentUser.set(null);
      this.permissions.clear();
      return false;
    }

    this.state.set(stored);
    this.origin.set(origin);

    if (readUser === undefined) {
      this.permissions.setPermissions(stored.userPermissions);
      return true;
    }

    let projection: SessionUserResponse;
    try {
      projection = await firstValueFrom(readUser(stored.userId));
    } catch (cause: unknown) {
      if (this.state() === stored) {
        const status = failureStatus(cause);

        if (!isUnansweredRead(cause) && (status === 401 || status === 0)) {
          // A credential the server refuses ends the session, so its entry goes with the signals instead of being left behind. That departs from Rule 1 clause 3, whose legacy `SessionManager` keeps an entry it could not validate, because AAP 0.4.2 requires a refused session to be cleared. The browser calling the API cross-origin reports this deployment's 401 as status 0 (no proxy, AAP 0.4.2), so the refusal is recognised where it is observed, not only in the interceptor — and the departure is narrowed to an observed refusal, because a read this application's own bound cut off never was one and takes the branch below.
          this.clear();
        } else {
          // The read failed for a reason that is no refusal — a server failure, or a read the application's own 30-second bound cut off before anything answered, which is indeterminate rather than refused — so the entry stays where a later restore can use it, exactly as legacy's `SessionManager.restore()` keeps an entry it could not validate (Rule 1 clause 3), while nothing is in effect: the credential origin empties with the session it described.
          this.state.set(null);
          this.origin.set(null);
          this.currentUser.set(null);
          this.permissions.clear();
        }
      }
      return false;
    }

    if (this.state() !== stored) {
      return false;
    }

    this.currentUser.set({ id: projection.id, username: projection.username });
    this.permissions.setPermissions(stored.userPermissions);
    return true;
  }

  /** The page's `localStorage`, or `null` when the document has no browsing context or the browser refuses the store — the state the legacy wrapper answers with its memory fallback (`app/scripts/webstorage-configuration.js:6-12`). */
  private store(): Storage | null {
    const view = this.document.defaultView;

    if (view === null) {
      return null;
    }

    try {
      return view.localStorage;
    } catch {
      return null;
    }
  }

  /** The raw stored entry: the composed legacy key first, the bare spelling second, the in-memory copy when the store cannot be read or has refused a write; every storage exception is absorbed here. */
  private readEntry(): string | null {
    const store = this.storageInSync ? this.store() : null;

    if (store === null) {
      return this.memoryEntry;
    }

    try {
      const composed = store.getItem(sessionStorageKey());

      if (composed !== null) {
        return composed;
      }

      return store.getItem(SESSION_ENTRY_KEY);
    } catch {
      return this.memoryEntry;
    }
  }

  /** Writes the entry under the composed legacy key, keeping the in-memory copy in step. */
  private writeEntry(entry: string): void {
    this.memoryEntry = entry;

    const store = this.store();
    if (store === null) {
      return;
    }

    try {
      store.setItem(sessionStorageKey(), entry);
      this.storageInSync = true;
    } catch {
      this.storageInSync = false;
    }
  }

  /** The composed key the origin entry is stored at: the legacy prefix with the sibling entry name, so `mifosXsessionOrigin` (AAP 0.7.2 row `SessionData`, AAP 0.9.4 row 7). */
  private originKey(): string {
    return sessionStorageKey(LEGACY_STORAGE_PREFIX, SESSION_ORIGIN_ENTRY);
  }

  /** The raw stored origin, or the in-memory copy when the store cannot be read or has refused a write — the same answer the session entry's read gives, so one state decides both (app/scripts/webstorage-configuration.js:6-12). */
  private readOriginEntry(): string | null {
    const store = this.storageInSync ? this.store() : null;

    if (store === null) {
      return this.memoryOrigin;
    }

    try {
      return store.getItem(this.originKey());
    } catch {
      return this.memoryOrigin;
    }
  }

  /** The origin the stored credential was issued against, or `null` when none was recorded — an entry the legacy screens or an older release wrote — or when the recorded value is not an absolute http(s) URL. A corrupt or foreign value therefore binds the credential to nothing rather than to whatever it happens to spell (AAP 0.4.4 decision 5, Rule 1 clause 4). */
  private readOrigin(): string | null {
    const raw = this.readOriginEntry();

    return raw === null ? null : apiOriginOf(raw);
  }

  /** Writes the origin entry under the composed sibling key, keeping the in-memory copy in step with the session entry it belongs to. */
  private writeOrigin(origin: string): void {
    this.memoryOrigin = origin;

    const store = this.store();
    if (store === null) {
      return;
    }

    try {
      store.setItem(this.originKey(), origin);
      this.storageInSync = true;
    } catch {
      this.storageInSync = false;
    }
  }

  /** Removes both stored spellings of the session entry and the origin entry, and empties both in-memory copies. */
  private removeEntry(): void {
    this.memoryEntry = null;
    this.memoryOrigin = null;

    const store = this.store();
    if (store === null) {
      return;
    }

    try {
      store.removeItem(sessionStorageKey());
      store.removeItem(SESSION_ENTRY_KEY);
      store.removeItem(this.originKey());
      this.storageInSync = true;
    } catch {
      this.storageInSync = false;
    }
  }
}
