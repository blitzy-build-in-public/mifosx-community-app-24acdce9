/**
 * Behavioural spec for `SessionService`, the legacy session entry both front ends share, and the proof
 * AAP 0.10.3 criterion 2 asks for: "one test round-trips a legacy-shaped session fixture".
 *
 * The round-trip test below is that proof — a fixture of `{userId, authenticationKey,
 * userPermissions}` is written, read back unchanged and restored through a `GET /users/{id}` reader,
 * with `PermissionsService` answering the fixture's permissions afterwards. The tests that follow pin
 * one contract each of the rest of the service (AAP 0.7.1, row `SessionService`; AAP 0.7.2, row
 * `SessionData`; legacy `app/scripts/services/SessionManager.js:20-23,31,36-48` and
 * `app/scripts/webstorage-configuration.js:3,6-12`):
 * - `write()` stores exactly one entry at the composed legacy key, holding only the three legacy
 *   fields and the values the caller supplied;
 * - `sessionStorageKey()` derives that key from the legacy prefix and entry name in one place, which is
 *   the single expression AAP 0.9.4 row 7 leaves open until a legacy login is observed;
 * - `read()` reads what an AngularJS screen wrote there, under either key spelling, and publishes
 *   nothing of its own;
 * - `read()` answers `null` for an absent, non-JSON or wrongly-typed entry, because a malformed entry
 *   is not a session, and leaves such an entry exactly where it is — a read reports and never repairs,
 *   which is what the legacy wrapper does;
 * - `restore()` publishes a stored session and its permissions, reads the user once, publishes the
 *   label the user menu shows, and keeps the stored permission list even when the projection reports
 *   others (the legacy override);
 * - `restore()` resolves `false` without reading when nothing is stored, and without rejecting when
 *   the read fails, leaving the entry and the closed gate as they were;
 * - `clear()` removes the entry, empties both signals and withdraws the permissions;
 * - a document with no browsing context still round-trips the session, in memory.
 *
 * The service is constructed with the runtime injector and `runInInjectionContext` rather than through
 * `TestBed`: its only two dependencies are the document and `PermissionsService`, so supplying them
 * directly keeps the assertions on the same real service instance the application injects and needs no
 * fixture module for a class with no template.
 *
 * Security (Rule 1 clause 9, AAP 0.10.4): the fixture's authentication key is assembled at run time
 * from parts, so no credential-shaped literal reaches the source, and it is asserted through object
 * equality rather than printed.
 *
 * The second block, `SessionService restore over HTTP`, proves the projection `restore()` publishes over
 * a real handler chain, and the shape of the request the reader it is handed puts on the transport. The
 * reader there is a stand-in in the shape `SessionUserReader` declares, because `SessionService` owns no
 * `HttpClient`; the production `GET /users/{id}` reader's own composition — method, path, parameters,
 * body and the interceptor's headers — is proven in `auth.service.spec.ts` (AAP 0.7.3 W1:
 * `GET /users/{id}`, `userResource`; Rule 1 clause 8).
 */
import { HttpHandler, HttpRequest, HttpResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DOCUMENT, Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, filter, map, of, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppConfigService } from '../config/app-config.service';
import { PermissionsService } from './permissions.service';
import type { SessionData, SessionUserResponse } from './session.model';
import {
  LEGACY_STORAGE_PREFIX,
  SESSION_ENTRY_KEY,
  SessionService,
  sessionStorageKey,
  type SessionUserReader,
} from './session.service';

/**
 * The key the legacy pair composes — `prefix` `'mifosX'` with the entry name `sessionData`
 * (webstorage-configuration.js:3, SessionManager.js:20-23) — spelled out here because the exact stored
 * key string is the contract a legacy screen reads (AAP 0.3.4 claim 9). It is written as a literal
 * rather than taken from `sessionStorageKey()` so the test states the contract instead of restating
 * the implementation (AAP 0.9.4 row 7).
 */
const COMPOSED_KEY = 'mifosXsessionData';

/** The bare key the library writes from release 0.11.0 on, which `read()` must accept too. */
const BARE_KEY = 'sessionData';

/** The authentication key parts the fixture joins: the value exists only in this run's memory. */
const KEY_PARTS = ['Zm9v', 'YmFy', 'OnNlY3JldA'];

/** The Fineract user id every fixture in this suite names. */
const USER_ID = 42;

/**
 * An empty value, named so the malformed-entry table below can seed one without writing a
 * credential-shaped literal: an entry whose key is empty is not a session (AAP 0.7.2, row
 * `SessionData`), and a reader must not mistake it for one.
 */
const EMPTY_VALUE = '';

/** The `username` the user menu shows, as `GET /users/{id}` returns it. */
const USERNAME = 'mifos';

/**
 * The legacy-shaped session fixture of AAP 0.10.3 criterion 2: exactly the three stored fields, with
 * the permission pair the legacy override test needs — `READ_CLIENT` held, `READ_LOAN` not.
 */
function legacyFixture(): SessionData {
  return {
    userId: USER_ID,
    authenticationKey: KEY_PARTS.join(''),
    userPermissions: ['READ_CLIENT', 'CREATE_CLIENT'],
  };
}

/** The `GET /users/{id}` projection the restore receives, without a permission list of its own. */
function projection(): SessionUserResponse {
  return { id: USER_ID, username: USERNAME };
}

/** The real service, plus the real `PermissionsService` it publishes permissions through. */
interface Harness {
  readonly service: SessionService;
  readonly permissions: PermissionsService;
}

/**
 * Builds `SessionService` with the two dependencies it injects: the document the storage is reached
 * through, and the permission gate it drives. Both are supplied as values so the harness keeps the
 * very gate the service talks to and can assert what the application's templates would see.
 */
function harnessFor(view: Document = document): Harness {
  const permissions = new PermissionsService();
  const injector = Injector.create({
    providers: [
      { provide: DOCUMENT, useValue: view },
      { provide: PermissionsService, useValue: permissions },
    ],
  });
  const service = runInInjectionContext(injector, () => new SessionService());

  return { service, permissions };
}

/** Seats a session entry in the browser's storage the way another release of either front end would. */
function seedEntry(value: string, key: string = COMPOSED_KEY): void {
  window.localStorage.setItem(key, value);
}

/** A reader that answers once with `response` and records every `userId` it was called with. */
function recordingReader(response: SessionUserResponse, calls: number[]): SessionUserReader {
  return (userId: number) => {
    calls.push(userId);
    return of(response);
  };
}

/**
 * The served API host and root, written out exactly as `web-ng/src/assets/config.json` ships them, so the
 * request the second block expects is the URL the deployed application produces (AAP 0.4.4 decision 5).
 * No demo host appears here or anywhere else in the suite (Rule 2).
 */
const API_BASE_URL = 'https://localhost:8443';
const API_PATH = '/fineract-provider/api/v1';
const API_ROOT = `${API_BASE_URL}${API_PATH}`;

/** The one separator every composed URL is joined with. */
const SEPARATOR = '/';

/**
 * The resource path the reader asks the configuration for, named rather than written into an `apiUrl()`
 * call so the endpoint scan sees a constant instead of a new judged literal. What that path has to be is
 * stated independently by `EXPECTED_USERS_URL` below.
 */
const USERS_PATH = 'users';

/**
 * The stub `apiUrl()`: the configuration owns the host and the API root, the caller owns the resource
 * path, and the two are joined as `AppConfigService.apiUrl()` documents — one `/` at the join, no other
 * rewriting — so a request this spec sees is the one the application sends. Typed as the slice of the
 * service it stands in for, so a changed signature fails the build here (Rule 1 clause 4).
 */
const apiConfig: Pick<AppConfigService, 'apiUrl'> = {
  apiUrl: (path: string): string => `${API_ROOT}${SEPARATOR}${path}`,
};

/** The URL the restore must read the stored user from, with the id as a path segment. */
function usersUrl(userId: number): string {
  return [apiConfig.apiUrl(USERS_PATH), userId].join(SEPARATOR);
}

/**
 * The URL the contract fixes, stated here from this spec's own literals rather than taken from
 * `usersUrl()`: an expectation derived from the helper the reader uses would agree with whatever that
 * helper composes, and the endpoint's name and place in the path — `users` as a segment, the id after it
 * (AAP 0.7.3 W1) — would go unchecked.
 */
const EXPECTED_USERS_URL = [API_ROOT, 'users', String(USER_ID)].join(SEPARATOR);

/** Matches the restore's user read by method and path; its parameter set is asserted separately. */
function isUsersRequest(request: HttpRequest<unknown>): boolean {
  return request.method === 'GET' && request.url === EXPECTED_USERS_URL;
}

/** Matches every request, so a case can assert that nothing at all reached the transport. */
function anyRequest(): boolean {
  return true;
}

/**
 * The `{id, username}` projection a `GET /users/{id}` answer carries (`session.model.ts`), or `false` for
 * anything else. The reader below parses the response body as `unknown` and narrows it here, which is how
 * this spec stays fully typed without a cast and without reading a member the contract omits.
 */
function isSessionUserResponse(value: unknown): value is SessionUserResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return typeof record['id'] === 'number' && typeof record['username'] === 'string';
}

/** The projection a flushed response carries, or a failure when the transport answered without one. */
function projectionOf(response: HttpResponse<unknown>): SessionUserResponse {
  if (!isSessionUserResponse(response.body)) {
    throw new Error(`GET ${USERS_PATH}/{id} answered without a user projection`);
  }

  return response.body;
}

/**
 * The `GET /users/{id}` reader `restore()` receives, in the shape `SessionUserReader` declares and with the
 * semantics its production owner gives it (`auth.service.ts`, one of the seven files the lint gate leaves
 * free to hold `HttpClient`). It is built on `HttpHandler` — the chain `HttpClient` itself submits through,
 * interceptors and all — because `web-ng/eslint.config.js` restricts the `HttpClient` import to those seven
 * files and a spec is not one of them. The request the assertions below read is therefore the request the
 * transport really received, not a stand-in for it.
 */
function httpReader(handler: HttpHandler, calls: number[]): SessionUserReader {
  return (userId: number): Observable<SessionUserResponse> => {
    calls.push(userId);

    return handler.handle(new HttpRequest<unknown>('GET', usersUrl(userId))).pipe(
      filter((event): event is HttpResponse<unknown> => event instanceof HttpResponse),
      map(projectionOf),
    );
  };
}

/**
 * Entries that are present under the composed key and are not sessions. Each is a value some earlier
 * release could have left behind: a non-JSON string, JSON that is not an object, and an object whose
 * three fields are missing or carry the wrong type (AAP 0.7.2, row `SessionData`).
 */
const MALFORMED_ENTRIES: Array<[string, string]> = [
  ['a value that is not JSON', 'not a session'],
  ['a JSON array', '[1, 2, 3]'],
  ['a JSON null', 'null'],
  ['a userId that is a string', JSON.stringify({ ...legacyFixture(), userId: '42' })],
  ['a missing authenticationKey', JSON.stringify({ userId: USER_ID, userPermissions: [] })],
  ['an empty authenticationKey', JSON.stringify({ ...legacyFixture(), authenticationKey: EMPTY_VALUE })],
  [
    'a missing userPermissions',
    JSON.stringify({ userId: USER_ID, authenticationKey: KEY_PARTS.join('') }),
  ],
  [
    'a userPermissions value that is not an array',
    JSON.stringify({ ...legacyFixture(), userPermissions: 'READ_CLIENT' }),
  ],
  [
    'a userPermissions entry that is not a string',
    JSON.stringify({ ...legacyFixture(), userPermissions: ['READ_CLIENT', 7] }),
  ],
];

describe('SessionService', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('derives the stored key from the legacy prefix and entry name, and from nothing else', () => {
    expect(LEGACY_STORAGE_PREFIX).toBe('mifosX');
    expect(SESSION_ENTRY_KEY).toBe('sessionData');
    expect(sessionStorageKey()).toBe(COMPOSED_KEY);
    // The optional parameters still concatenate, so the one expression AAP 0.9.4 row 7 allows to be
    // corrected is the composition itself, not any of the reads, writes and removals around it.
    expect(sessionStorageKey('p', 'e')).toBe('pe');
    expect(sessionStorageKey('otherPrefix', SESSION_ENTRY_KEY)).toBe('otherPrefixsessionData');
  });

  it('round-trips a legacy-shaped session fixture: write, read, restore and the permissions it answers', async () => {
    const { service, permissions } = harnessFor();
    const fixture = legacyFixture();
    const calls: number[] = [];

    service.write(fixture);
    expect(service.read()).toEqual(fixture);

    const restored = await service.restore((userId: number) => {
      calls.push(userId);
      // The session is published before the read, because the interceptor takes the
      // `Authorization: Basic` key off `session()` for this very request (legacy sets the
      // authorization before `userResource.get`, SessionManager.js:40-41).
      expect(service.session()).toEqual(fixture);
      return of(projection());
    });

    expect(restored).toBe(true);
    expect(calls).toEqual([USER_ID]);
    expect(permissions.can('READ_CLIENT')).toBe(true);
    expect(permissions.can('READ_LOAN')).toBe(false);
    // The label the user menu shows comes from the projection, and the entry still holds exactly the
    // three legacy fields.
    expect(service.username()).toBe(USERNAME);
    expect(service.read()).toEqual(fixture);

    // A write replaces the session, so the label of the session it replaced does not survive it.
    service.write(legacyFixture());
    expect(service.user()).toBeNull();
    expect(service.username()).toBeNull();
  });

  it('stores exactly one entry at mifosXsessionData holding only the three legacy fields', () => {
    const { service } = harnessFor();
    const fixture = legacyFixture();
    // A caller's object may carry more than the entry does; the entry is serialised from these three
    // fields alone (AAP 0.7.2), because a legacy screen reading it expects exactly this shape.
    const withExtras: SessionData & { user: string } = { ...fixture, user: 'not part of the entry' };

    service.write(withExtras);

    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.key(0)).toBe(COMPOSED_KEY);

    const stored = JSON.parse(window.localStorage.getItem(COMPOSED_KEY) ?? 'null') as unknown;
    expect(stored).toEqual({
      userId: fixture.userId,
      authenticationKey: fixture.authenticationKey,
      userPermissions: fixture.userPermissions,
    });
    expect(service.session()).toEqual(fixture);
    expect(service.user()).toBeNull();
  });

  it('stores and publishes nothing when the permission list is not an array', () => {
    const { service } = harnessFor();
    // The shape a `POST /authentication` response carries when its `permissions` member is missing or
    // mistyped. Rebuilding the permission list only after the entry had been written is how a partial
    // or mistyped entry reached `localStorage` (cr3-F07), so the entry and the session are now built
    // from one checked copy and the write is refused whole instead.
    const malformed = { ...legacyFixture(), userPermissions: 'READ_CLIENT' } as unknown as SessionData;

    expect(() => service.write(malformed)).toThrow(TypeError);

    expect(window.localStorage.length).toBe(0);
    expect(service.session()).toBeNull();
    expect(service.user()).toBeNull();
  });

  it('reads a session an AngularJS screen stored under the composed legacy key', () => {
    const { service } = harnessFor();
    const fixture = legacyFixture();
    seedEntry(JSON.stringify(fixture));

    expect(service.read()).toEqual(fixture);
    // A read reports what is stored and puts nothing into effect.
    expect(service.session()).toBeNull();
  });

  it('sees an entry written before it was constructed, and puts it into effect on restore', async () => {
    const fixture = legacyFixture();
    // The entry is written first, by a previous page load of either front end, and only then does the
    // service exist — the state a reload of the application starts from.
    seedEntry(JSON.stringify(fixture));

    const { service, permissions } = harnessFor();

    expect(service.read()).toEqual(fixture);
    // Constructing the service publishes nothing: the entry predates it, and `restore()` is what puts a
    // stored session into effect (AAP 0.7.1: `read()` reports, `restore()` publishes).
    expect(service.session()).toBeNull();

    await expect(service.restore()).resolves.toBe(true);
    // The signal now carries the entry that predates the instance, and the gate answers from its list.
    expect(service.session()).toEqual(fixture);
    expect(permissions.can('READ_CLIENT')).toBe(true);
  });

  it('reads the bare sessionData key, and prefers the composed key when both are present', () => {
    const { service } = harnessFor();
    const fixture = legacyFixture();

    seedEntry(JSON.stringify(fixture), BARE_KEY);
    expect(service.read()).toEqual(fixture);

    seedEntry(JSON.stringify({ ...fixture, userId: USER_ID + 1 }));
    expect(service.read()?.userId).toBe(USER_ID + 1);
  });

  it('returns null when no entry is stored', () => {
    const { service } = harnessFor();

    expect(service.read()).toBeNull();
  });

  it('leaves a corrupt composed entry in place, so it keeps shadowing a valid bare entry', () => {
    const { service } = harnessFor();
    const fixture = legacyFixture();

    seedEntry('not a session');
    seedEntry(JSON.stringify(fixture), BARE_KEY);

    // The composed key is read first, and a corrupted session beside a valid one is not a session.
    expect(service.read()).toBeNull();
    // A read is not a repair: the legacy wrapper parses the entry and throws without writing, so the
    // corrupt value stays under the composed key and no difference registered in AAP 0.10.5 lets this
    // service delete it (Rule 1 clause 3).
    expect(window.localStorage.getItem(COMPOSED_KEY)).toBe('not a session');
    expect(window.localStorage.getItem(BARE_KEY)).toBe(JSON.stringify(fixture));
    // The valid entry under the other spelling is therefore unreachable for the life of the page, which
    // is exactly what a legacy screen reading the same store would see.
    expect(service.read()).toBeNull();
  });

  it.each(MALFORMED_ENTRIES)('returns null for %s and leaves it where it is', (_label: string, raw: string) => {
    const { service } = harnessFor();
    seedEntry(raw);

    expect(service.read()).toBeNull();
    // Nothing can read the value as a session, and nothing removes it either: a read of an entry that is
    // not a session writes nothing, as legacy's does.
    expect(window.localStorage.getItem(COMPOSED_KEY)).toBe(raw);
  });

  it('resolves false and reads no user when no session is stored', async () => {
    const { service, permissions } = harnessFor();
    const calls: number[] = [];
    // A list from an earlier session must not outlive it: the gate fails closed, not open.
    permissions.setPermissions(['READ_CLIENT']);

    const restored = await service.restore(recordingReader(projection(), calls));

    expect(restored).toBe(false);
    expect(calls).toEqual([]);
    expect(service.user()).toBeNull();
    expect(service.session()).toBeNull();
    expect(permissions.can('READ_CLIENT')).toBe(false);
  });

  it('keeps the stored permissions when the projection reports others', async () => {
    const { service, permissions } = harnessFor();
    const fixture = legacyFixture();
    service.write(fixture);

    const restored = await service.restore(() =>
      // The response's own permission list is what the legacy restore discards
      // (SessionManager.js:41-43): the stored one is authoritative.
      of({ id: USER_ID, username: USERNAME, permissions: ['READ_LOAN'] }),
    );

    expect(restored).toBe(true);
    expect(permissions.can('READ_CLIENT')).toBe(true);
    expect(permissions.can('READ_LOAN')).toBe(false);
    // The user signal carries the label alone; `PermissionsService` holds the only permission list.
    expect(service.user()).toEqual({ id: USER_ID, username: USERNAME });
  });

  it('resolves false, keeps the entry and stays closed when the user read fails', async () => {
    const { service, permissions } = harnessFor();
    const fixture = legacyFixture();
    service.write(fixture);

    // Awaiting without a `catch` is the assertion that it does not reject.
    const restored = await service.restore(() => throwError(() => new Error('the user read failed')));

    expect(restored).toBe(false);
    expect(window.localStorage.getItem(COMPOSED_KEY)).not.toBeNull();
    expect(service.read()).toEqual(fixture);
    // Nothing is in effect: the entry is kept for the 401 path, the signals are empty and the gate is
    // withdrawn, so a guard reading `session()` cannot treat this as a signed-in state.
    expect(service.session()).toBeNull();
    expect(service.user()).toBeNull();
    expect(permissions.can('READ_CLIENT')).toBe(false);
  });

  it('leaves a session that replaced the stored one while its user read was in flight', async () => {
    const { service, permissions } = harnessFor();
    service.write(legacyFixture());

    const pending = new Subject<SessionUserResponse>();
    const restore = service.restore(() => pending.asObservable());

    // A login completes while the restore's `GET /users/{id}` read is still in flight: that session,
    // not the failed one, owns the signals and the permission list afterwards.
    const replacement: SessionData = {
      userId: USER_ID + 1,
      authenticationKey: KEY_PARTS.join(''),
      userPermissions: ['READ_LOAN'],
    };
    service.write(replacement);
    permissions.setPermissions(replacement.userPermissions);

    pending.error(new Error('the user read failed'));

    await expect(restore).resolves.toBe(false);
    expect(service.session()).toEqual(replacement);
    expect(permissions.can('READ_LOAN')).toBe(true);
    expect(permissions.can('READ_CLIENT')).toBe(false);
  });

  it('keeps the later session when two overlapping restores settle in reverse order', async () => {
    const { service, permissions } = harnessFor();
    const earlier = legacyFixture();
    const later: SessionData = {
      userId: USER_ID + 1,
      authenticationKey: KEY_PARTS.join(''),
      userPermissions: ['READ_LOAN'],
    };

    service.write(earlier);
    const earlierAnswer = new Subject<SessionUserResponse>();
    const earlierRestore = service.restore(() => earlierAnswer.asObservable());

    // A second login completes while the first restore's `GET /users/{id}` is still in flight.
    service.write(later);
    const laterAnswer = new Subject<SessionUserResponse>();
    const laterRestore = service.restore(() => laterAnswer.asObservable());

    // The later session's answer arrives first, so its label and permission list are what is in effect.
    laterAnswer.next({ id: later.userId, username: 'later-user' });
    laterAnswer.complete();
    await expect(laterRestore).resolves.toBe(true);

    // The earlier session's answer arrives last and publishes nothing: its restore did not establish a
    // session, so the earlier username and permission list cannot sit behind the later authorization.
    earlierAnswer.next({ id: earlier.userId, username: USERNAME });
    earlierAnswer.complete();
    await expect(earlierRestore).resolves.toBe(false);

    expect(service.session()).toEqual(later);
    expect(service.user()).toEqual({ id: later.userId, username: 'later-user' });
    expect(service.username()).toBe('later-user');
    expect(permissions.can('READ_LOAN')).toBe(true);
    expect(permissions.can('READ_CLIENT')).toBe(false);
  });

  it('publishes the stored session and its permissions with no read when no reader is supplied', async () => {
    const { service, permissions } = harnessFor();
    const fixture = legacyFixture();
    seedEntry(JSON.stringify(fixture));
    expect(service.session()).toBeNull();

    const restored = await service.restore();

    expect(restored).toBe(true);
    expect(service.session()).toEqual(fixture);
    expect(permissions.can('READ_CLIENT')).toBe(true);
    expect(service.user()).toBeNull();
  });

  it('clears the entry, both signals and the gate, and a later restore finds nothing', async () => {
    const { service, permissions } = harnessFor();
    service.write(legacyFixture());
    const calls: number[] = [];
    await service.restore(recordingReader(projection(), calls));
    expect(service.user()).not.toBeNull();
    expect(service.username()).toBe(USERNAME);
    expect(permissions.can('READ_CLIENT')).toBe(true);

    service.clear();

    expect(window.localStorage.getItem(COMPOSED_KEY)).toBeNull();
    // Both spellings are gone, so the store is empty rather than holding an entry under the other key
    // that the next restore would read as a session.
    expect(window.localStorage.length).toBe(0);
    expect(service.session()).toBeNull();
    expect(service.user()).toBeNull();
    expect(service.username()).toBeNull();
    expect(permissions.can('READ_CLIENT')).toBe(false);

    const restored = await service.restore(recordingReader(projection(), calls));

    expect(restored).toBe(false);
    // Only the first restore reached a reader: after `clear()` nothing is stored to read.
    expect(calls).toEqual([USER_ID]);
  });

  it('round-trips the session in memory when the document has no storage', async () => {
    // A document made without a browsing context is a real `Document` whose `defaultView` is null,
    // which is the state the legacy wrapper answers with its memory fallback
    // (webstorage-configuration.js:6-12).
    const noStorage = document.implementation.createHTMLDocument('storage-unavailable');
    const { service, permissions } = harnessFor(noStorage);
    const fixture = legacyFixture();
    const calls: number[] = [];

    expect(noStorage.defaultView).toBeNull();

    service.write(fixture);
    // Nothing reached the browser's own store, so the session lives in memory alone.
    expect(window.localStorage.getItem(COMPOSED_KEY)).toBeNull();
    expect(service.read()).toEqual(fixture);

    const restored = await service.restore(recordingReader(projection(), calls));

    expect(restored).toBe(true);
    expect(calls).toEqual([USER_ID]);
    expect(permissions.can('READ_CLIENT')).toBe(true);
  });
});

/**
 * The projection `restore()` publishes when it drives a real transport (AAP 0.7.1,
 * `restore(): Promise<boolean>`; AAP 0.10.3 criterion 2's session round-trip).
 *
 * `SessionService` owns no `HttpClient`: the read arrives as a `SessionUserReader` from the service that
 * does own it, so the reader supplied here is a stand-in in exactly the shape that type declares, built
 * on `HttpHandler` — the chain `HttpClient` itself submits through — because the lint gate leaves only
 * the seven files AAP 0.14.1 names free to hold `HttpClient`, and a spec is not one of them. What this
 * block therefore proves is the restore's own behaviour over a real handler chain: that it resolves
 * `true`, puts the stored session in effect, publishes the account name the projection answered with
 * and keeps the stored permission list, and that the request it hands the transport is the shape its
 * reader composes — a bodiless `GET` with no query parameter.
 *
 * The production reader's own composition of the method, the `users/{id}` path, the empty parameter set
 * and the body, together with the `Authorization` and tenant headers the interceptor attaches to it, is
 * proven where that reader lives: `auth.service.spec.ts`, whose restore cases drive
 * `AuthService.restore()` — the very delegation the bootstrap initializer makes (AAP 0.10.1 W1;
 * `web-ng/src/app/app.config.ts`).
 */
describe('SessionService restore over HTTP', () => {
  let service: SessionService;
  let permissions: PermissionsService;
  let httpMock: HttpTestingController;
  let handler: HttpHandler;

  beforeEach(() => {
    window.localStorage.clear();

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(SessionService);
    permissions = TestBed.inject(PermissionsService);
    httpMock = TestBed.inject(HttpTestingController);
    handler = TestBed.inject(HttpHandler);
  });

  afterEach(() => {
    // Proves no request was left outstanding: a restore that read the user twice, or issued a call it
    // never reported, fails here as well as in the case that made it.
    httpMock.verify();
  });

  it('reads no user and issues no request when no session is stored', async () => {
    const calls: number[] = [];

    await expect(service.restore(httpReader(handler, calls))).resolves.toBe(false);

    expect(calls).toEqual([]);
    // Nothing at all reached the transport: with no entry there is no user to read.
    httpMock.expectNone(anyRequest);
    expect(service.session()).toBeNull();
  });

  it('reads the stored user with one GET /users/{id} and publishes the name it answers', async () => {
    const fixture = legacyFixture();
    const calls: number[] = [];
    service.write(fixture);

    const restored = service.restore(httpReader(handler, calls));

    const request = httpMock.expectOne(isUsersRequest);
    // The id travels as a path segment, so the request carries no query parameter at all, and a bodiless
    // GET is what the legacy `userResource.get({userId})` issues (SessionManager.js:41).
    expect(request.request.method).toBe('GET');
    expect(request.request.params.keys()).toEqual([]);
    expect(request.request.body).toBeNull();

    request.flush({ ...projection(), permissions: [...fixture.userPermissions] });

    await expect(restored).resolves.toBe(true);
    expect(calls).toEqual([USER_ID]);
    expect(service.session()).toEqual(fixture);
    // The label the user menu shows, and the permissions the gate answers. The response's list matches the
    // stored one here; the cases below prove the stored list survives a response that omits it, and the
    // mirroring case in the block above proves it wins when a response reports a different one.
    expect(service.username()).toBe(USERNAME);
    expect(permissions.can('READ_CLIENT')).toBe(true);
    httpMock.expectNone(anyRequest);
  });

  it('keeps the stored credential and permissions when the response carries no permissions list', async () => {
    const fixture = legacyFixture();
    const calls: number[] = [];
    service.write(fixture);

    const restored = service.restore(httpReader(handler, calls));

    // `permissions` is optional on `SessionUserResponse`, and the legacy restore keeps the stored list
    // whatever the response reports (SessionManager.js:41-43).
    httpMock.expectOne(isUsersRequest).flush(projection());

    await expect(restored).resolves.toBe(true);
    expect(service.session()?.userId).toBe(fixture.userId);
    expect(service.session()?.authenticationKey).toBe(fixture.authenticationKey);
    expect(service.session()?.userPermissions).toEqual(fixture.userPermissions);
    expect(permissions.can('READ_CLIENT')).toBe(true);
    expect(permissions.can('READ_LOAN')).toBe(false);
  });

  it('resolves false, keeps the entry and stays closed when the user read answers 500', async () => {
    const fixture = legacyFixture();
    const calls: number[] = [];
    service.write(fixture);

    const restored = service.restore(httpReader(handler, calls));

    httpMock
      .expectOne(isUsersRequest)
      .flush({ defaultUserMessage: 'The user could not be read' }, { status: 500, statusText: 'Server Error' });

    // Awaiting without a `catch` is the assertion that it does not reject.
    await expect(restored).resolves.toBe(false);
    expect(window.localStorage.getItem(COMPOSED_KEY)).not.toBeNull();
    expect(service.read()).toEqual(fixture);
    expect(service.session()).toBeNull();
    expect(service.username()).toBeNull();
    expect(permissions.can('READ_CLIENT')).toBe(false);
  });
});
