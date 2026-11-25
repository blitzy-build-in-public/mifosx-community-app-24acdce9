import { DOCUMENT, Injectable, computed, inject, signal, type Signal } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';

import { PermissionsService } from './permissions.service';
import type { SessionData, SessionUserResponse } from './session.model';

/**
 * The prefix the legacy storage wrapper is configured with — `.constant('prefix', 'mifosX')` at
 * `app/scripts/webstorage-configuration.js:3` — under which both front ends keep the shared session
 * (AAP 0.3.4 claim 9).
 */
export const LEGACY_STORAGE_PREFIX = 'mifosX';

/**
 * The entry name the legacy `SessionManager` uses: `webStorage.add("sessionData", {userId,
 * authenticationKey, userPermissions})` at `app/scripts/services/SessionManager.js:20-23`,
 * `webStorage.remove("sessionData")` at :31 and `webStorage.get('sessionData')` at :37.
 */
export const SESSION_ENTRY_KEY = 'sessionData';

/**
 * The key the legacy pair actually stores at.
 *
 * `angular-webstorage` composes `prefix + key` by raw string concatenation, with no separator, so
 * `'mifosX'` and `'sessionData'` make `'mifosXsessionData'` (AAP 0.3.4 claim 9): that spelling is the
 * one this application writes and removes. Releases of the same library from 0.11.0 on ignore the
 * `prefix` constant and store the bare `sessionData` key, and either front end may have written
 * either spelling on the origin the two share during cutover (AAP 0.4.2), so `read()` accepts both —
 * this composed spelling first — rather than losing the login a legacy screen wrote.
 *
 * This function is the single place that serialized key is derived (AAP 0.9.4 row 7): the exact key
 * the bower library produces is an open item of the plan until a legacy login is observed, and if the
 * observation differs from this composition the correction is this one expression and nothing else,
 * because every storage read, write and removal below goes through it.
 *
 * @param prefix the legacy wrapper's configured prefix; the application always uses the default.
 * @param entry the legacy entry name; the application always uses the default.
 * @returns the key the shared session entry is stored under.
 */
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

/**
 * A stored entry together with the key it was found under.
 *
 * The key travels with the value because `read()` accepts the composed `mifosXsessionData` spelling
 * and the bare `sessionData` one, and a value that turns out not to be a session has to be removed
 * from the very key it came from — removing the other spelling instead would leave the corrupt value
 * in place and drop a valid entry beside it.
 */
interface StoredEntry {
  /** The storage key the entry was read from. */
  readonly key: string;

  /** The entry's serialized value, still unparsed. */
  readonly raw: string;
}

/**
 * The stored entry as a `SessionData`, or `null` when it is anything else.
 *
 * The entry is whatever a previous release of either front end wrote to `localStorage`, so it is
 * parsed into `unknown` and narrowed field by field (Rule 1 clause 4): a session needs a finite
 * numeric `userId`, a non-empty string `authenticationKey` and a `userPermissions` array of strings
 * (AAP 0.7.2, row `SessionData`). Anything else — an absent field, a string id, a permission list
 * that is not an array of strings, `null`, an array — is not a session, and reporting it as one would
 * let the interceptor send an `Authorization` header and the gate a permission list that no login
 * produced.
 */
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

  // Filtered through a type predicate rather than a boolean test, so the list below is a `string[]`
  // this function has actually checked instead of the loosely typed array `Array.isArray` leaves
  // behind (Rule 1 clause 4). A single non-string entry makes the whole list unusable.
  const codes: string[] = userPermissions.filter((code): code is string => typeof code === 'string');
  if (codes.length !== userPermissions.length) {
    return null;
  }

  return { userId, authenticationKey, userPermissions: codes };
}

/**
 * Supplies the `GET /users/{id}` answer the restore needs (AAP 0.7.3 W1: `GET /users/{id}`,
 * `userResource`) without this service owning an HTTP call.
 *
 * The session restore re-reads the user Fineract's id belongs to —
 * `resourceFactory.userResource.get({userId: sessionData.userId})` at
 * `app/scripts/services/SessionManager.js:41` — and only a class that owns `HttpClient` may issue it:
 * `auth.service.ts` is one of the seven files AAP 0.8.2 and 0.14.1 exempt from the
 * `no-restricted-imports` ban on `HttpClient`, and `core/auth/session.service.ts` is not. The owning
 * service passes its call in, so this file holds no `HttpClient`, names no Fineract path and still
 * runs the legacy sequence unchanged.
 *
 * @param userId the `userId` of the stored session, forwarded verbatim to `GET /users/{id}`.
 * @returns an observable of the response's projection; only its first emission is read.
 */
export type SessionUserReader = (userId: number) => Observable<SessionUserResponse>;

/**
 * The legacy session entry both front ends share: reads and writes the `{userId, authenticationKey,
 * userPermissions}` JSON that `SessionManager` writes under the `mifosX` prefix, restores it through
 * `GET /users/{id}`, and clears it on logout and on a 401 (AAP 0.7.1, row `SessionService`:
 * `read(): SessionData | null`, `write(session)`, `clear()`, `restore(): Promise<boolean>`).
 *
 * **One login, two front ends.** During cutover a user's login is shared with the AngularJS screens
 * that are not migrated yet (AAP 0.4.2), which is why the storage key, the prefix and the JSON shape
 * are legacy's rather than a design of this application's own: the interceptor sends
 * `Authorization: Basic <authenticationKey>` from what this service publishes and a legacy screen
 * reads the same entry out of `localStorage` (AAP 0.3.4 claim 9).
 *
 * **The permission list has one owner.** `PermissionsService` answers every permission question, so
 * the restore publishes the stored `userPermissions` through it and keeps no second copy (AAP 0.7.1,
 * row `PermissionsService`). That is also the legacy behaviour: the restore overwrites the response's
 * own list with the stored one (`app/scripts/services/SessionManager.js:41-43`).
 *
 * **Nothing here is logged.** The authentication key is a bearer credential (Rule 1 clause 9,
 * AAP 0.10.4): it is persisted only in this entry and is never written to the console or to a log.
 *
 * Storage is reached through the injected `DOCUMENT`, and when the browser cannot provide
 * `localStorage` — a null `defaultView`, or a `localStorage` getter that throws — the entry is kept in
 * memory for the page's lifetime instead, the fallback the legacy wrapper itself selects
 * (`app/scripts/webstorage-configuration.js:6-12`, "Using memory storage: a page reload will clear all
 * stored data"). A storage exception never escapes this service.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  /**
   * Injected rather than read off the `document` global, so a test can supply a document with no
   * browsing context and the storage-unavailable path is exercisable.
   */
  private readonly document = inject(DOCUMENT);

  /**
   * The single owner of the permission list: `clear()` withdraws permissions through it and the
   * restore publishes the stored list through it, so the template gate and the route guard keep
   * answering from one list (AAP 0.1.1, "a permission gate that fails closed").
   */
  private readonly permissions = inject(PermissionsService);

  /** The session this application itself published, or `null` when none is in effect. */
  private readonly state = signal<SessionData | null>(null);

  /**
   * The last entry this instance wrote or found, kept so the session survives while the browser's
   * storage cannot answer — the memory fallback of `app/scripts/webstorage-configuration.js:6-12`.
   * It is a copy, never the source of truth while `localStorage` is readable.
   */
  private memoryEntry: string | null = null;

  /**
   * True while the browser's storage is the state this instance reads; false once a write or a
   * removal failed, from which point the in-memory copy is the only state worth trusting — a store
   * that refused a write still holds the entry it refused to replace, and reading that back would
   * answer with a session this instance has already left behind.
   */
  private storageInSync = true;

  /** The projection of the last restored session, which is what the user-menu label shows. */
  private readonly currentUser = signal<SessionUserResponse | null>(null);

  /**
   * The in-memory session the HTTP interceptor reads for `Authorization: Basic <authenticationKey>`
   * (AAP 0.4.2: one interceptor adds both that header and the tenant header).
   *
   * It is published by `write()` and by `restore()`, and emptied by `clear()`. A caller that needs the
   * credential — the interceptor — reads it here rather than from storage, so no request path parses
   * the stored JSON.
   */
  readonly session: Signal<SessionData | null> = this.state.asReadonly();

  /**
   * The projection of the restored session — `{id, username}` from `GET /users/{id}` — which is the
   * label the user menu shows. `write()` and `clear()` set it to `null`: a previous session's label
   * must not outlive the session it belongs to, and the user of a session this application has just
   * written arrives from the authentication response its caller holds.
   *
   * It carries no permissions: `PermissionsService` holds the only copy of those (AAP 0.7.1, row
   * `PermissionsService`).
   */
  readonly user: Signal<SessionUserResponse | null> = this.currentUser.asReadonly();

  /**
   * The account name the user menu is labelled with — `username` from `GET /users/{id}`, so `mifos`
   * after a login as `mifos` — or `null` until a restore has resolved one.
   *
   * It is a projection of `user()` rather than a state of its own, so the two cannot disagree, and it
   * is deliberately not part of the stored entry: `SessionData` keeps exactly the three legacy fields
   * (AAP 0.7.2, row `SessionData`), and `write()` and `clear()` empty the label with the session it
   * describes. `core/layout/navbar.component.ts` renders it and `AuthService` re-exposes it.
   */
  readonly username: Signal<string | null> = computed(() => this.currentUser()?.username ?? null);

  /**
   * The stored session entry, or `null` when there is no entry or the entry is not a well-formed
   * session (AAP 0.7.1, `read(): SessionData | null`).
   *
   * This is a pure storage read of the entry itself: it publishes nothing, so a caller can ask what is
   * stored without putting it into effect — `restore()` is what publishes. The composed
   * `mifosXsessionData` key from `sessionStorageKey()` is read first and the bare `sessionData`
   * spelling second, because either front end may have written either. A malformed entry under the
   * composed key is reported as `null` rather than falling through to the other spelling: a partly
   * valid entry beside a valid one is a corrupted session, not a session.
   *
   * An entry that is present but is not a session is removed from the key it was found under, so a
   * corrupt value cannot shadow a valid entry under the other spelling for the rest of the page's life
   * and the next login writes over nothing. That removal is the only write a read performs, and it
   * never touches an entry it could parse.
   */
  read(): SessionData | null {
    const entry = this.readEntry();

    if (entry === null) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.raw);
    } catch {
      // Not JSON, so there is no session in it.
      this.removeCorruptEntry(entry);
      return null;
    }

    const session = toSessionData(parsed);

    if (session === null) {
      this.removeCorruptEntry(entry);
    }

    return session;
  }

  /**
   * Persists `session` as the legacy entry and publishes it (AAP 0.7.1, `write(session)`).
   *
   * Exactly the three stored fields are serialised — nothing else the caller's object may carry —
   * because the entry is a contract with the legacy screens reading it (AAP 0.7.2, row `SessionData`).
   * The permission list is not published here: the caller that has the `POST /authentication`
   * response hands that list to `PermissionsService` itself, and this method's own job is the entry
   * and the session signal.
   *
   * `user()` is emptied because the label of the session being replaced does not describe the one just
   * written; it is filled again by the next `restore()` whose `readUser` projection supplies it.
   */
  write(session: SessionData): void {
    this.writeEntry(
      JSON.stringify({
        userId: session.userId,
        authenticationKey: session.authenticationKey,
        userPermissions: session.userPermissions,
      }),
    );

    this.state.set({
      userId: session.userId,
      authenticationKey: session.authenticationKey,
      userPermissions: [...session.userPermissions],
    });
    this.currentUser.set(null);
  }

  /**
   * Ends the session: the stored entry goes, both signals empty and the permission gate is withdrawn
   * (AAP 0.7.1, `clear()`; AAP 0.4.2, the interceptor's 401 handling).
   *
   * It is idempotent, because the logout button and a 401 response can both reach it for one session.
   * Both stored spellings are removed for the same reason `read()` accepts both: an entry left under
   * the other key would be picked up by the next `restore()` and sign the user back in, so `clear()`
   * would not fail closed.
   */
  clear(): void {
    this.removeEntry();
    this.state.set(null);
    this.currentUser.set(null);
    this.permissions.clear();
  }

  /**
   * Puts the stored session back into effect, in the order the legacy `SessionManager.restore` uses
   * (`app/scripts/services/SessionManager.js:36-48`; AAP 0.7.1, `restore(): Promise<boolean>`).
   *
   * The session is published **before** `readUser` is called, because the request that reads the user
   * carries `Authorization: Basic <authenticationKey>` and the interceptor takes that key from
   * `session()` — legacy sets the authorization before it calls `userResource.get` for the same
   * reason (:40-41).
   *
   * With `readUser`, the projection is read once for the stored `userId`, `user()` becomes its
   * `{id, username}`, and the stored `userPermissions` are published through `PermissionsService` —
   * the stored list wins over whatever the response reports, as it does in legacy (:42). With no
   * `readUser`, the stored session and its permissions are published with no request at all.
   *
   * A failing `readUser` — a rejection, an error emission or an empty completion — resolves `false`
   * and leaves the entry where it is, with nothing published and the permission gate withdrawn: the
   * session is not in effect, and the 401 that ends such a session for good is the interceptor's and
   * `AuthService`'s call, not this method's.
   *
   * @param readUser the `GET /users/{id}` call the owning HTTP service supplies, invoked at most once
   * with the stored `userId`.
   * @returns `true` when a stored session is in effect afterwards, `false` when there was none, it was
   * malformed, or the user projection could not be read.
   */
  async restore(readUser?: SessionUserReader): Promise<boolean> {
    const stored = this.read();

    if (stored === null) {
      // Nothing is stored, so no session is in effect: the signals empty and the gate is withdrawn,
      // because a permission list left over from an earlier session would answer for nobody
      // (AAP 0.1.1, "a permission gate that fails closed").
      this.state.set(null);
      this.currentUser.set(null);
      this.permissions.clear();
      return false;
    }

    this.state.set(stored);

    if (readUser === undefined) {
      this.permissions.setPermissions(stored.userPermissions);
      return true;
    }

    let projection: SessionUserResponse;
    try {
      projection = await firstValueFrom(readUser(stored.userId));
    } catch {
      // A stored entry whose user cannot be read is not a session in effect: the entry stays where the
      // caller that can act on the 401 will find it, and nothing is published — the session signal
      // empties so no interceptor sends a header for it, the user label empties, and the gate is
      // withdrawn rather than left open (AAP 0.1.1, "a permission gate that fails closed"). The
      // withdrawal is skipped when a session replaced this one while the read was in flight, because
      // that session, not the failed one, owns the signals and the permission list.
      if (this.state() === stored) {
        this.state.set(null);
        this.currentUser.set(null);
        this.permissions.clear();
      }
      return false;
    }

    this.currentUser.set({ id: projection.id, username: projection.username });
    this.permissions.setPermissions(stored.userPermissions);
    return true;
  }

  /**
   * The page's `localStorage`, or `null` when the document has no browsing context or the browser
   * refuses the storage — a `SecurityError` for a partitioned or disabled store, which is the state
   * the legacy wrapper answers with its memory fallback
   * (`app/scripts/webstorage-configuration.js:6-12`).
   */
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

  /**
   * The raw stored entry and the key it was found under: the composed legacy key first, the bare
   * spelling second, and the in-memory copy when the store cannot be read at all or has refused a
   * write. Every storage exception is absorbed here, so no caller has to handle one.
   *
   * The memory copy is reported under the composed key because that is the key it stands in for: it
   * holds what this instance last failed to store there, so a removal of it has to empty the copy
   * rather than a storage key.
   */
  private readEntry(): StoredEntry | null {
    const store = this.storageInSync ? this.store() : null;

    if (store === null) {
      return this.memoryEntry === null ? null : { key: sessionStorageKey(), raw: this.memoryEntry };
    }

    try {
      const composedKey = sessionStorageKey();
      const composed = store.getItem(composedKey);

      if (composed !== null) {
        return { key: composedKey, raw: composed };
      }

      const bare = store.getItem(SESSION_ENTRY_KEY);
      return bare === null ? null : { key: SESSION_ENTRY_KEY, raw: bare };
    } catch {
      return this.memoryEntry === null ? null : { key: sessionStorageKey(), raw: this.memoryEntry };
    }
  }

  /**
   * Drops an entry that is present but is not a session, from the key `read()` found it under.
   *
   * Only `read()` calls this, and only for a value it could not parse into a `SessionData`: a value
   * that is not a session serves no caller, and leaving it in place would let it shadow a valid entry
   * under the other spelling. A store that refuses the removal keeps the value, which nothing can read
   * as a session anyway, so the refusal is absorbed like every other storage exception here.
   *
   * This is the one place the service departs from the legacy behaviour of not touching what it
   * cannot use (Rule 1 clause 3): the legacy wrapper parses the entry on read and throws, so a corrupt
   * value breaks its page load, and dropping it is the only recovery. No entry that parses into a
   * session is ever removed, so no legacy screen loses a login it could have read.
   */
  private removeCorruptEntry(entry: StoredEntry): void {
    if (this.memoryEntry === entry.raw) {
      this.memoryEntry = null;
    }

    const store = this.store();
    if (store === null) {
      return;
    }

    try {
      store.removeItem(entry.key);
    } catch {
      // The store refused the removal; the signals stay empty and the next write replaces the value.
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
      // A full or read-only store leaves the memory copy as the session's home for this page.
      this.storageInSync = false;
    }
  }

  /** Removes both stored spellings of the entry and empties the in-memory copy. */
  private removeEntry(): void {
    this.memoryEntry = null;

    const store = this.store();
    if (store === null) {
      return;
    }

    try {
      store.removeItem(sessionStorageKey());
      store.removeItem(SESSION_ENTRY_KEY);
      this.storageInSync = true;
    } catch {
      // Nothing can be removed from a store that refuses access, and the signals are emptied anyway.
      // The store may still hold the entry it refused to drop, so the in-memory copy answers instead.
      this.storageInSync = false;
    }
  }
}
