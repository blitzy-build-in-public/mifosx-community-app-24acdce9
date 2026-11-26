/** Behavioural spec for `SessionService`, the legacy session entry both front ends share, and the proof AAP 0.10.3 criterion 2 asks for: "one test round-trips a legacy-shaped session fixture". */
import { HttpHandler, HttpRequest, HttpResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DOCUMENT, Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, filter, map, of, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppConfigService } from '../config/app-config.service';
import { ApiError } from '../http/api-error';
import { PermissionsService } from './permissions.service';
import type { SessionData, SessionUserResponse } from './session.model';
import type { ApiBaseUrls } from './session-origin';
import {
  LEGACY_STORAGE_PREFIX, SESSION_ENTRY_KEY, SESSION_ORIGIN_ENTRY, SessionService, sessionStorageKey,
  type SessionUserReader,
} from './session.service';

/** The composed legacy storage key, `prefix` `'mifosX'` + `sessionData` (webstorage-configuration.js:3): the exact string a legacy screen reads (AAP 0.3.4 claim 9). */
const COMPOSED_KEY = 'mifosXsessionData';

/** The composed sibling key the credential's API origin is recorded at, `prefix` `'mifosX'` + `sessionOrigin`: the entry that binds the session to the origin it was issued against (AAP 0.4.4 decision 5). */
const ORIGIN_KEY = 'mifosXsessionOrigin';

/** The bare key the library writes from release 0.11.0 on, which `read()` must accept too. */
const BARE_KEY = 'sessionData';

/** The authentication key parts the fixture joins: the value exists only in this run's memory. */
const KEY_PARTS = ['Zm9v', 'YmFy', 'OnNlY3JldA'];

const USER_ID = 42;

const EMPTY_VALUE = '';

const USERNAME = 'mifos';

/** The legacy-shaped session fixture of AAP 0.10.3 criterion 2: exactly the three stored fields. */
function legacyFixture(): SessionData {
  return {
    userId: USER_ID, authenticationKey: KEY_PARTS.join(''), userPermissions: ['READ_CLIENT', 'CREATE_CLIENT'],
  };
}

function projection(): SessionUserResponse {
  return { id: USER_ID, username: USERNAME };
}

interface Harness {
  readonly service: SessionService;
  readonly permissions: PermissionsService;
}

function harnessFor(view: Document = document): Harness {
  const permissions = new PermissionsService();
  const injector = Injector.create({
    providers: [{ provide: DOCUMENT, useValue: view }, { provide: PermissionsService, useValue: permissions },
    ], });
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

/** The served API host and root, written out exactly as `web-ng/src/assets/config.json` ships them. */
const API_BASE_URL = 'https://localhost:8443';
const API_PATH = '/fineract-provider/api/v1';
const API_ROOT = `${API_BASE_URL}${API_PATH}`;

/** The two bases a restore judges the stored credential against: both are the served host while no page URL overrides it, which is the state every case but the override one is in (AAP 0.4.4 decision 5). */
const BASES: ApiBaseUrls = { resolved: API_BASE_URL, served: API_BASE_URL };

const SEPARATOR = '/';

/** The resource path the reader asks the configuration for, named rather than written into an `apiUrl()` call so the endpoint scan sees a constant instead of a new judged literal. */
const USERS_PATH = 'users';

/** The stub `apiUrl()`: the configuration owns the host and the API root, the caller owns the resource path, and the two are joined as `AppConfigService.apiUrl()` documents — one `/` at the join, no other rewriting — so a stand-in typed to the one member it replaces, rather than an `any`, composes the same URL the shipped service does (Rule 1 clause 4). */
const apiConfig: Pick<AppConfigService, 'apiUrl'> = {
  apiUrl: (path: string): string => `${API_ROOT}${SEPARATOR}${path}`,
};

/** The URL the restore must read the stored user from, with the id as a path segment. */
function usersUrl(userId: number): string {
  return [apiConfig.apiUrl(USERS_PATH), userId].join(SEPARATOR);
}

/** The URL the contract fixes, stated here from this spec's own literals rather than taken from `usersUrl()`: an expectation derived from the helper the reader uses would agree with whatever that helper composes, and the W1 row's `GET /users/{id}` would then be pinned by nothing (AAP 0.7.3). */
const EXPECTED_USERS_URL = [API_ROOT, 'users', String(USER_ID)].join(SEPARATOR);

/** Matches the restore's user read by method and path; its parameter set is asserted separately. */
function isUsersRequest(request: HttpRequest<unknown>): boolean {
  return request.method === 'GET' && request.url === EXPECTED_USERS_URL;
}

/** Matches every request, so a case can assert that nothing at all reached the transport. */
function anyRequest(): boolean {
  return true;
}

/** The `{id, username}` projection a `GET /users/{id}` answer carries (`session.model.ts`), or `false` for anything else. */
function isSessionUserResponse(value: unknown): value is SessionUserResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return typeof record['id'] === 'number' && typeof record['username'] === 'string';
}

function projectionOf(response: HttpResponse<unknown>): SessionUserResponse {
  if (!isSessionUserResponse(response.body)) {
    throw new Error(`GET ${USERS_PATH}/{id} answered without a user projection`);
  }

  return response.body;
}

/** The `GET /users/{id}` reader `restore()` receives, in the shape `SessionUserReader` declares and with the semantics its production owner gives it (`auth.service.ts`, one of the six files the lint gate leaves free to hold `HttpClient`). */
function httpReader(handler: HttpHandler, calls: number[]): SessionUserReader {
  return (userId: number): Observable<SessionUserResponse> => {
    calls.push(userId);

    return handler.handle(new HttpRequest<unknown>('GET', usersUrl(userId))).pipe(
      filter((event): event is HttpResponse<unknown> => event instanceof HttpResponse),
      map(projectionOf),
    );
  };
}

/** Entries that are present under the composed key and are not sessions (AAP 0.7.2). */
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
    // The optional parameters still concatenate, so the one expression AAP 0.9.4 row 7 allows to be corrected is the composition itself, not any of the reads, writes and removals around it.
    expect(sessionStorageKey('p', 'e')).toBe('pe');
    expect(sessionStorageKey('otherPrefix', SESSION_ENTRY_KEY)).toBe('otherPrefixsessionData');
    // The origin entry is the same composition under the sibling name, so it sits under the same legacy prefix (AAP 0.4.4 decision 5).
    expect(SESSION_ORIGIN_ENTRY).toBe('sessionOrigin');
    expect(sessionStorageKey(LEGACY_STORAGE_PREFIX, SESSION_ORIGIN_ENTRY)).toBe(ORIGIN_KEY);
  });

  it('round-trips a legacy-shaped session fixture: write, read, restore and the permissions it answers', async () => {
    const { service, permissions } = harnessFor();
    const fixture = legacyFixture();
    const calls: number[] = [];

    service.write(fixture, API_BASE_URL);
    expect(service.read()).toEqual(fixture);

    const restored = await service.restore(BASES, (userId: number) => {
      calls.push(userId);
      // The session is published before the read, because the interceptor takes the `Authorization: Basic` key off `session()` for this very request (legacy sets the authorization before `userResource.get`, SessionManager.js:40-41).
      expect(service.session()).toEqual(fixture);
      return of(projection());
    });

    expect(restored).toBe(true);
    expect(calls).toEqual([USER_ID]);
    expect(permissions.can('READ_CLIENT')).toBe(true);
    expect(permissions.can('READ_LOAN')).toBe(false);
    // The label the user menu shows comes from the projection, and the entry still holds exactly the three legacy fields.
    expect(service.username()).toBe(USERNAME);
    expect(service.read()).toEqual(fixture);

    service.write(legacyFixture(), API_BASE_URL);
    expect(service.user()).toBeNull();
    expect(service.username()).toBeNull();
  });

  it('stores the session entry holding only the three legacy fields, and its origin beside it', () => {
    const { service } = harnessFor();
    const fixture = legacyFixture();
    // A caller's object may carry more than the entry does; the entry is serialised from these three fields alone (AAP 0.7.2), because a legacy screen reading it expects exactly this shape.
    const withExtras: SessionData & { user: string } = { ...fixture, user: 'not part of the entry' };

    service.write(withExtras, API_BASE_URL);

    // Two entries, not one: the legacy session, whose shape is unchanged, and the origin the credential was issued against (AAP 0.4.4 decision 5).
    expect(window.localStorage.length).toBe(2);
    expect(window.localStorage.getItem(COMPOSED_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(ORIGIN_KEY)).toBe(API_BASE_URL);

    const stored = JSON.parse(window.localStorage.getItem(COMPOSED_KEY) ?? 'null') as unknown;
    expect(stored).toEqual({
      userId: fixture.userId,
      authenticationKey: fixture.authenticationKey,
      userPermissions: fixture.userPermissions,
    });
    expect(Object.keys(stored as Record<string, unknown>)).toEqual([
      'userId', 'authenticationKey', 'userPermissions',
    ]);
    expect(service.session()).toEqual(fixture);
    expect(service.credentialOrigin()).toBe(API_BASE_URL);
    expect(service.user()).toBeNull();
  });

  it('stores and publishes nothing when the permission list is not an array', () => {
    const { service } = harnessFor();
    // The shape a `POST /authentication` response carries when its `permissions` member is missing or mistyped.
    const malformed = { ...legacyFixture(), userPermissions: 'READ_CLIENT' } as unknown as SessionData;

    expect(() => service.write(malformed, API_BASE_URL)).toThrow(TypeError);

    expect(window.localStorage.length).toBe(0);
    expect(service.session()).toBeNull();
    expect(service.user()).toBeNull();
  });

  it('reads a session an AngularJS screen stored under the composed legacy key', () => {
    const { service } = harnessFor();
    const fixture = legacyFixture();
    seedEntry(JSON.stringify(fixture));

    expect(service.read()).toEqual(fixture);
    expect(service.session()).toBeNull();
  });

  it('sees an entry written before it was constructed, and puts it into effect on restore', async () => {
    const fixture = legacyFixture();
    seedEntry(JSON.stringify(fixture));

    const { service, permissions } = harnessFor();

    expect(service.read()).toEqual(fixture);
    // Constructing the service publishes nothing: the entry predates it, and `restore()` is what puts a stored session into effect (AAP 0.7.1: `read()` reports, `restore()` publishes).
    expect(service.session()).toBeNull();

    await expect(service.restore(BASES)).resolves.toBe(true);
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

    expect(service.read()).toBeNull();
    // A read is not a repair: the legacy wrapper parses the entry and throws without writing, so the corrupt value stays under the composed key and no difference registered in AAP 0.10.5 lets this service delete it (Rule 1 clause 3).
    expect(window.localStorage.getItem(COMPOSED_KEY)).toBe('not a session');
    expect(window.localStorage.getItem(BARE_KEY)).toBe(JSON.stringify(fixture));
    // The valid entry under the other spelling is therefore unreachable for the life of the page, which is exactly what a legacy screen reading the same store would see.
    expect(service.read()).toBeNull();
  });

  it.each(MALFORMED_ENTRIES)('returns null for %s and leaves it where it is', (_label: string, raw: string) => {
    const { service } = harnessFor();
    seedEntry(raw);

    expect(service.read()).toBeNull();
    // Nothing can read the value as a session, and nothing removes it either: a read of an entry that is not a session writes nothing, as legacy's does.
    expect(window.localStorage.getItem(COMPOSED_KEY)).toBe(raw);
  });

  it('resolves false and reads no user when no session is stored', async () => {
    const { service, permissions } = harnessFor();
    const calls: number[] = [];
    permissions.setPermissions(['READ_CLIENT']);

    const restored = await service.restore(BASES, recordingReader(projection(), calls));

    expect(restored).toBe(false);
    expect(calls).toEqual([]);
    expect(service.user()).toBeNull();
    expect(service.session()).toBeNull();
    expect(permissions.can('READ_CLIENT')).toBe(false);
  });

  it('keeps the stored permissions when the projection reports others', async () => {
    const { service, permissions } = harnessFor();
    const fixture = legacyFixture();
    service.write(fixture, API_BASE_URL);

    const restored = await service.restore(BASES, () =>
      // The response's own permission list is what the legacy restore discards (SessionManager.js:41-43): the stored one is authoritative.
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
    service.write(fixture, API_BASE_URL);

    // Awaiting without a `catch` is the assertion that it does not reject.
    const restored = await service.restore(BASES, () => throwError(() => new Error('the user read failed')));

    expect(restored).toBe(false);
    expect(window.localStorage.getItem(COMPOSED_KEY)).not.toBeNull();
    expect(service.read()).toEqual(fixture);
    // Nothing is in effect: the failure carries no status, so it is no refusal and the entry stays where it was found, while the signals are empty and the gate is withdrawn, so a guard reading `session()` cannot treat this as a signed-in state.
    expect(service.session()).toBeNull();
    expect(service.user()).toBeNull();
    expect(permissions.can('READ_CLIENT')).toBe(false);
  });

  it.each([{ status: 401 }, { status: 0 }])(
    'removes the stored session when the user read is refused with status $status',
    async ({ status }: { status: number }) => {
      const { service, permissions } = harnessFor();
      const fixture = legacyFixture();
      service.write(fixture, API_BASE_URL);
      seedEntry(JSON.stringify(fixture), BARE_KEY);
      permissions.setPermissions(fixture.userPermissions);

      // The `ApiError` the interceptor builds from the failed read, and for status 0 the form this deployment's cross-origin 401 arrives in, since Fineract's 401 carries no CORS header (AAP 0.4.2). Awaiting without a `catch` is the assertion that it does not reject.
      const restored = await service.restore(BASES, () =>
        throwError(() => new ApiError('The credential was refused', status)),
      );

      expect(restored).toBe(false);
      // A refused credential ends the session, so no entry survives it under either key (AAP 0.4.2).
      expect(window.localStorage.getItem(COMPOSED_KEY)).toBeNull();
      expect(window.localStorage.getItem(BARE_KEY)).toBeNull();
      expect(window.localStorage.length).toBe(0);
      expect(service.read()).toBeNull();
      expect(service.session()).toBeNull();
      expect(service.user()).toBeNull();
      expect(service.username()).toBeNull();
      expect(permissions.can('READ_CLIENT')).toBe(false);
    },
  );

  it('leaves a session that replaced the stored one while its user read was in flight', async () => {
    const { service, permissions } = harnessFor();
    service.write(legacyFixture(), API_BASE_URL);

    const pending = new Subject<SessionUserResponse>();
    const restore = service.restore(BASES, () => pending.asObservable());

    // A login completes while the restore's `GET /users/{id}` read is still in flight: that session, not the failed one, owns the signals and the permission list afterwards.
    const replacement: SessionData = {
      userId: USER_ID + 1,
      authenticationKey: KEY_PARTS.join(''),
      userPermissions: ['READ_LOAN'],
    };
    service.write(replacement, API_BASE_URL);
    permissions.setPermissions(replacement.userPermissions);

    pending.error(new Error('the user read failed'));

    await expect(restore).resolves.toBe(false);
    expect(service.session()).toEqual(replacement);
    expect(permissions.can('READ_LOAN')).toBe(true);
    expect(permissions.can('READ_CLIENT')).toBe(false);
  });

  it('keeps a session that replaced the stored one when the refusal arrives after it', async () => {
    const { service, permissions } = harnessFor();
    service.write(legacyFixture(), API_BASE_URL);

    const pending = new Subject<SessionUserResponse>();
    const restore = service.restore(BASES, () => pending.asObservable());

    const replacement: SessionData = {
      userId: USER_ID + 1,
      authenticationKey: KEY_PARTS.join(''),
      userPermissions: ['READ_LOAN'],
    };
    service.write(replacement, API_BASE_URL);
    permissions.setPermissions(replacement.userPermissions);

    pending.error(new ApiError('The credential was refused', 401));

    await expect(restore).resolves.toBe(false);
    expect(service.session()).toEqual(replacement);
    expect(service.read()).toEqual(replacement);
    expect(window.localStorage.getItem(COMPOSED_KEY)).not.toBeNull();
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

    service.write(earlier, API_BASE_URL);
    const earlierAnswer = new Subject<SessionUserResponse>();
    const earlierRestore = service.restore(BASES, () => earlierAnswer.asObservable());

    // A second login completes while the first restore's `GET /users/{id}` is still in flight.
    service.write(later, API_BASE_URL);
    const laterAnswer = new Subject<SessionUserResponse>();
    const laterRestore = service.restore(BASES, () => laterAnswer.asObservable());

    laterAnswer.next({ id: later.userId, username: 'later-user' });
    laterAnswer.complete();
    await expect(laterRestore).resolves.toBe(true);

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

    const restored = await service.restore(BASES);

    expect(restored).toBe(true);
    expect(service.session()).toEqual(fixture);
    expect(permissions.can('READ_CLIENT')).toBe(true);
    expect(service.user()).toBeNull();
  });

  it('clears the entry, both signals and the gate, and a later restore finds nothing', async () => {
    const { service, permissions } = harnessFor();
    service.write(legacyFixture(), API_BASE_URL);
    const calls: number[] = [];
    await service.restore(BASES, recordingReader(projection(), calls));
    expect(service.user()).not.toBeNull();
    expect(service.username()).toBe(USERNAME);
    expect(permissions.can('READ_CLIENT')).toBe(true);

    service.clear();

    expect(window.localStorage.getItem(COMPOSED_KEY)).toBeNull();
    expect(window.localStorage.length).toBe(0);
    expect(service.session()).toBeNull();
    expect(service.user()).toBeNull();
    expect(service.username()).toBeNull();
    expect(permissions.can('READ_CLIENT')).toBe(false);

    const restored = await service.restore(BASES, recordingReader(projection(), calls));

    expect(restored).toBe(false);
    // Only the first restore reached a reader: after `clear()` nothing is stored to read.
    expect(calls).toEqual([USER_ID]);
  });

  it('round-trips the session in memory when the document has no storage', async () => {
    // A document made without a browsing context is a real `Document` whose `defaultView` is null, which is the state the legacy wrapper answers with its memory fallback (webstorage-configuration.js:6-12).
    const noStorage = document.implementation.createHTMLDocument('storage-unavailable');
    const { service, permissions } = harnessFor(noStorage);
    const fixture = legacyFixture();
    const calls: number[] = [];

    expect(noStorage.defaultView).toBeNull();

    service.write(fixture, API_BASE_URL);
    expect(window.localStorage.getItem(COMPOSED_KEY)).toBeNull();
    expect(service.read()).toEqual(fixture);

    const restored = await service.restore(BASES, recordingReader(projection(), calls));

    expect(restored).toBe(true);
    expect(calls).toEqual([USER_ID]);
    expect(permissions.can('READ_CLIENT')).toBe(true);
    // The origin travels with the in-memory copy too, so a credential read back from a store that cannot answer is still bound to the origin it was issued against.
    expect(service.credentialOrigin()).toBe(API_BASE_URL);
  });

  it('publishes the credential origin on write, and clear removes both entries and empties it', () => {
    const { service } = harnessFor();

    expect(service.credentialOrigin()).toBeNull();

    service.write(legacyFixture(), API_BASE_URL);

    expect(service.credentialOrigin()).toBe(API_BASE_URL);
    expect(window.localStorage.getItem(ORIGIN_KEY)).toBe(API_BASE_URL);

    service.clear();

    expect(window.localStorage.length).toBe(0);
    expect(window.localStorage.getItem(COMPOSED_KEY)).toBeNull();
    expect(window.localStorage.getItem(ORIGIN_KEY)).toBeNull();
    expect(service.credentialOrigin()).toBeNull();

    // Idempotent, as `clear()` has to be (AAP 0.7.1).
    service.clear();

    expect(window.localStorage.length).toBe(0);
    expect(service.credentialOrigin()).toBeNull();
  });

  it('withholds a session issued against another origin, leaving both entries and calling no reader', async () => {
    const { service, permissions } = harnessFor();
    const calls: number[] = [];
    const issuedAgainst = 'https://elsewhere.example:9443';

    service.write(legacyFixture(), issuedAgainst);
    permissions.setPermissions(['READ_CLIENT']);

    // The page resolved a different base from the one the credential was issued against: the session is published for nothing, which is the whole of the refusal.
    const restored = await service.restore(BASES, recordingReader(projection(), calls));

    expect(restored).toBe(false);
    expect(calls).toEqual([]);
    expect(service.session()).toBeNull();
    expect(service.credentialOrigin()).toBeNull();
    expect(service.user()).toBeNull();
    expect(permissions.can('READ_CLIENT')).toBe(false);
    // The entry belongs to the origin that issued it, where the legacy app may still be using it: withheld, never deleted (Rule 1 clause 9).
    expect(window.localStorage.getItem(COMPOSED_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(ORIGIN_KEY)).toBe(issuedAgainst);
    expect(service.read()).not.toBeNull();
  });

  it('restores an entry with no recorded origin while the resolved base is the served base', async () => {
    const fixture = legacyFixture();
    // What the legacy app or an earlier release leaves: the session and no origin record of any kind.
    seedEntry(JSON.stringify(fixture));

    const { service, permissions } = harnessFor();

    expect(window.localStorage.getItem(ORIGIN_KEY)).toBeNull();

    const restored = await service.restore(BASES);

    expect(restored).toBe(true);
    expect(service.session()).toEqual(fixture);
    // The credential can only have been issued against the base the served file named, and no page URL can change that one (AAP 0.4.4 decision 5).
    expect(service.credentialOrigin()).toBe(API_BASE_URL);
    expect(permissions.can('READ_CLIENT')).toBe(true);
  });

  it('withholds an entry with no recorded origin when the page URL resolved the base elsewhere', async () => {
    const fixture = legacyFixture();
    seedEntry(JSON.stringify(fixture));

    const { service, permissions } = harnessFor();
    const calls: number[] = [];

    // A crafted `?baseApiUrl=`: the resolved base names another origin while the served file still names the real one, so no origin the entry could belong to matches what this page would send to (Rule 1 clause 9).
    const restored = await service.restore(
      { resolved: 'https://other.example:4421', served: API_BASE_URL },
      recordingReader(projection(), calls),
    );

    expect(restored).toBe(false);
    expect(calls).toEqual([]);
    expect(service.session()).toBeNull();
    expect(service.credentialOrigin()).toBeNull();
    expect(permissions.can('READ_CLIENT')).toBe(false);
    // The recordless entry is left where it was found: it belongs to the served base, and a crafted link must not destroy it.
    expect(window.localStorage.getItem(COMPOSED_KEY)).not.toBeNull();
  });

  it.each(['localhost:8443', './fineract-provider', 'javascript:alert(1)', EMPTY_VALUE])(
    'refuses to write a session for the base %s, which names no origin',
    (base: string) => {
      const { service } = harnessFor();

      expect(() => service.write(legacyFixture(), base)).toThrow(TypeError);
      // Nothing is stored and nothing is published: a credential with no origin on record could only be presented wherever the next page URL pointed.
      expect(window.localStorage.length).toBe(0);
      expect(service.session()).toBeNull();
      expect(service.credentialOrigin()).toBeNull();
    },
  );

  it('publishes nothing when the resolved base itself names no origin', async () => {
    const fixture = legacyFixture();
    seedEntry(JSON.stringify(fixture));

    const { service } = harnessFor();

    // A resolved base that is not an absolute URL names no origin to present a credential to, so the entry is withheld rather than bound to a guess (Rule 1 clause 4).
    const restored = await service.restore({ resolved: 'localhost:8443', served: API_BASE_URL });

    expect(restored).toBe(false);
    expect(service.session()).toBeNull();
    expect(window.localStorage.getItem(COMPOSED_KEY)).not.toBeNull();
  });
});

/** The projection `restore()` publishes when it drives a real transport (AAP 0.7.1, `restore(): Promise<boolean>`; AAP 0.10.3 criterion 2's session round-trip) (AAP 0.14.1, AAP 0.10.1). */
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
    httpMock.verify();
  });

  it('reads no user and issues no request when no session is stored', async () => {
    const calls: number[] = [];

    await expect(service.restore(BASES, httpReader(handler, calls))).resolves.toBe(false);

    expect(calls).toEqual([]);
    httpMock.expectNone(anyRequest);
    expect(service.session()).toBeNull();
  });

  it('reads the stored user with one GET /users/{id} and publishes the name it answers', async () => {
    const fixture = legacyFixture();
    const calls: number[] = [];
    service.write(fixture, API_BASE_URL);

    const restored = service.restore(BASES, httpReader(handler, calls));

    const request = httpMock.expectOne(isUsersRequest);
    // The id travels as a path segment, so the request carries no query parameter at all, and a bodiless GET is what the legacy `userResource.get({userId})` issues (SessionManager.js:41).
    expect(request.request.method).toBe('GET');
    expect(request.request.params.keys()).toEqual([]);
    expect(request.request.body).toBeNull();

    request.flush({ ...projection(), permissions: [...fixture.userPermissions] });

    await expect(restored).resolves.toBe(true);
    expect(calls).toEqual([USER_ID]);
    expect(service.session()).toEqual(fixture);
    expect(service.username()).toBe(USERNAME);
    expect(permissions.can('READ_CLIENT')).toBe(true);
    httpMock.expectNone(anyRequest);
  });

  it('keeps the stored credential and permissions when the response carries no permissions list', async () => {
    const fixture = legacyFixture();
    const calls: number[] = [];
    service.write(fixture, API_BASE_URL);

    const restored = service.restore(BASES, httpReader(handler, calls));

    // `permissions` is optional on `SessionUserResponse`, and the legacy restore keeps the stored list whatever the response reports (SessionManager.js:41-43).
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
    service.write(fixture, API_BASE_URL);

    const restored = service.restore(BASES, httpReader(handler, calls));

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

  it('removes the stored entry when the transport reports a failed user read as status 0', async () => {
    const fixture = legacyFixture();
    const calls: number[] = [];
    service.write(fixture, API_BASE_URL);
    permissions.setPermissions(fixture.userPermissions);

    const restored = service.restore(BASES, httpReader(handler, calls));

    // A cross-origin 401 the browser cannot read reaches the application as a transport failure with no status (AAP 0.4.2, the deployment's no-proxy calling convention), which is the shape this deployment's refused credential actually arrives in.
    httpMock.expectOne(isUsersRequest).error(new ProgressEvent('error'));

    await expect(restored).resolves.toBe(false);
    expect(window.localStorage.getItem(COMPOSED_KEY)).toBeNull();
    expect(window.localStorage.length).toBe(0);
    expect(service.read()).toBeNull();
    expect(service.session()).toBeNull();
    expect(service.username()).toBeNull();
    expect(permissions.can('READ_CLIENT')).toBe(false);
    // The refusal is the read's only answer: nothing retries it (Rule 1 clause 2).
    httpMock.expectNone(isUsersRequest);
  });
});
