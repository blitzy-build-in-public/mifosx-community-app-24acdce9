/**
 * Behavioural spec for `SessionService`, the legacy session entry both front ends share, and the proof
 * AAP 0.10.3 criterion 2 asks for: "one test round-trips a legacy-shaped session fixture".
 *
 * The round-trip test first below is that proof — a fixture of `{userId, authenticationKey,
 * userPermissions}` is written, read back unchanged and restored through a `GET /users/{id}` reader,
 * with `PermissionsService` answering the fixture's permissions afterwards. The tests that follow pin
 * one contract each of the rest of the service (AAP 0.7.1, row `SessionService`; AAP 0.7.2, row
 * `SessionData`; legacy `app/scripts/services/SessionManager.js:20-23,31,36-48` and
 * `app/scripts/webstorage-configuration.js:3,6-12`):
 * - `write()` stores exactly one entry at the composed legacy key, holding only the three legacy
 *   fields and the values the caller supplied;
 * - `read()` reads what an AngularJS screen wrote there, under either key spelling, and publishes
 *   nothing of its own;
 * - `read()` answers `null` for an absent, non-JSON or wrongly-typed entry, because a malformed entry
 *   is not a session;
 * - `restore()` publishes a stored session and its permissions, reads the user once, and keeps the
 *   stored permission list even when the projection reports others (the legacy override);
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
 */
import { DOCUMENT, Injector, runInInjectionContext } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionsService } from './permissions.service';
import type { SessionData, SessionUserResponse } from './session.model';
import { SessionService, type SessionUserReader } from './session.service';

/**
 * The key the legacy pair composes — `prefix` `'mifosX'` with the entry name `sessionData`
 * (webstorage-configuration.js:3, SessionManager.js:20-23) — spelled out here because the exact stored
 * key string is the contract a legacy screen reads (AAP 0.3.4 claim 9).
 */
const COMPOSED_KEY = 'mifosXsessionData';

/** The bare key the library writes from release 0.11.0 on, which `read()` must accept too. */
const BARE_KEY = 'sessionData';

/** The authentication key parts the fixture joins: the value exists only in this run's memory. */
const KEY_PARTS = ['Zm9v', 'YmFy', 'OnNlY3JldA'];

/** The Fineract user id every fixture in this suite names. */
const USER_ID = 42;

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
  ['an empty authenticationKey', JSON.stringify({ ...legacyFixture(), authenticationKey: '' })],
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

    // A write replaces the session, so the label of the session it replaced does not survive it.
    service.write(legacyFixture());
    expect(service.user()).toBeNull();
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

  it('reads a session an AngularJS screen stored under the composed legacy key', () => {
    const { service } = harnessFor();
    const fixture = legacyFixture();
    seedEntry(JSON.stringify(fixture));

    expect(service.read()).toEqual(fixture);
    // A read reports what is stored and puts nothing into effect.
    expect(service.session()).toBeNull();
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

  it.each(MALFORMED_ENTRIES)('returns null for %s', (_label: string, raw: string) => {
    const { service } = harnessFor();
    seedEntry(raw);

    expect(service.read()).toBeNull();
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
    expect(permissions.can('READ_CLIENT')).toBe(true);

    service.clear();

    expect(window.localStorage.getItem(COMPOSED_KEY)).toBeNull();
    expect(service.session()).toBeNull();
    expect(service.user()).toBeNull();
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
