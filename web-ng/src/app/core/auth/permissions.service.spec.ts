import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_FUNCTIONS, ALL_FUNCTIONS_READ, PermissionsService } from './permissions.service';
import type { SessionData } from './session.model';
import { SessionService } from './session.service';

/** Behavioural spec for `PermissionsService`, the one answer to "may this user do this?" that both the `hasPermission` directive and the route guard read (AAP 0.7.1, row `PermissionsService`; AAP 0.3.4 claim 12; the (AAP 0.1.1). */
describe('PermissionsService', () => {
  it('fails closed until a session supplies a permission list', () => {
    const service = new PermissionsService();
    expect(service.permissions()).toEqual([]);
    expect(service.can('READ_CLIENT')).toBe(false);
    expect(service.has('READ_CLIENT')).toBe(false);
    // The absence of a user is never read as permission, so the inversion of a code answers false rather than passing for want of the permission.
    expect(service.has('!READ_CLIENT')).toBe(false);
    expect(service.canAny(['READ_CLIENT'])).toBe(false);
    expect(service.canAll([])).toBe(false);
  });

  it('answers membership of the permission list', () => {
    const service = new PermissionsService();
    service.setPermissions(['READ_CLIENT', 'CREATE_CLIENT']);
    expect(service.can('READ_CLIENT')).toBe(true);
    expect(service.can('CREATE_CLIENT')).toBe(true);
    // A code the list does not hold is not held, whatever other codes it does hold.
    expect(service.can('READ_LOAN')).toBe(false);
    // A code that names no permission is held by nobody: legacy refuses the blank answer.
    expect(service.can('')).toBe(false);
    expect(service.can('   ')).toBe(false);
  });

  it('grants every code while ALL_FUNCTIONS is held', () => {
    const service = new PermissionsService();
    service.setPermissions([ALL_FUNCTIONS]);
    expect(service.can('READ_CLIENT')).toBe(true);
    expect(service.can('CREATE_LOAN_PRODUCT')).toBe(true);
    // Nothing but the wildcard is in the list, so a code outside it passes only through the wildcard.
    expect(service.can('DELETE_CLIENT')).toBe(true);
    // A code that names no permission anywhere in the legacy sources is granted as well.
    expect(service.can('ANY_ARBITRARY_KIND')).toBe(true);
    expect(service.has('!ANY_ARBITRARY_KIND')).toBe(false);
  });

  it('denies every code for a signed-in user whose permission list is empty', () => {
    const service = new PermissionsService();
    service.setPermissions([]);
    expect(service.can('READ_CLIENT')).toBe(false);
    expect(service.canAny(['READ_CLIENT', 'CREATE_CLIENT'])).toBe(false);
    expect(service.canAll(['READ_CLIENT'])).toBe(false);
    // A session is present here, so the gate answers instead of failing closed: the empty list states no restriction and is vacuously satisfied.
    expect(service.canAll([])).toBe(true);
    expect(service.permissions()).toEqual([]);
  });

  it('grants READ_ codes and no others while ALL_FUNCTIONS_READ is held', () => {
    const service = new PermissionsService();
    service.setPermissions([ALL_FUNCTIONS_READ]);
    expect(service.can('READ_CLIENT')).toBe(true);
    expect(service.can('READ_LOAN')).toBe(true);
    // The read wildcard is not a blanket grant: the matching write is not held.
    expect(service.can('CREATE_CLIENT')).toBe(false);
  });

  it('inverts a leading !, refuses a bare ! and tolerates surrounding whitespace', () => {
    const service = new PermissionsService();
    service.setPermissions(['READ_CLIENT']);

    // Plain delegation to the membership question.
    expect(service.has('READ_CLIENT')).toBe(true);
    expect(service.has('READ_LOAN')).toBe(false);

    // The negation asks for the absence of the code, in both directions.
    expect(service.has('!READ_CLIENT')).toBe(false);
    expect(service.has('!READ_LOAN')).toBe(true);

    // Surrounding whitespace is trimmed on the code and on the remainder after the bang.
    expect(service.has('  READ_CLIENT  ')).toBe(true);
    expect(service.has(' ! CREATE_CLIENT ')).toBe(true);
    expect(service.has('  !  READ_CLIENT  ')).toBe(false);

    // A bare `!` names nothing to negate, so it is refused rather than answered with a blanket pass.
    expect(service.has('!')).toBe(false);
    expect(service.has('   !   ')).toBe(false);

    // An authenticated user who genuinely holds nothing passes the inversion.
    service.setPermissions([]);
    expect(service.has('!READ_CLIENT')).toBe(true);
  });

  it('fails the negation of a code that ALL_FUNCTIONS makes present', () => {
    const service = new PermissionsService();
    service.setPermissions([ALL_FUNCTIONS]);

    // The wildcard makes every code present.
    expect(service.has('!READ_CLIENT')).toBe(false);
    expect(service.has('READ_CLIENT')).toBe(true);
  });

  it('aggregates the same question over a list of codes', () => {
    const service = new PermissionsService();
    service.setPermissions(['READ_CLIENT']);
    expect(service.canAny(['READ_CLIENT', 'CREATE_CLIENT'])).toBe(true);
    expect(service.canAny(['CREATE_CLIENT', 'UPDATE_CLIENT'])).toBe(false);
    // A negated entry counts towards "any", so the list is satisfied by the absence it asks for.
    expect(service.canAny(['CREATE_CLIENT', '!CREATE_CLIENT'])).toBe(true);
    // An empty list holds nothing to satisfy.
    expect(service.canAny([])).toBe(false);
    expect(service.canAll(['READ_CLIENT'])).toBe(true);
    expect(service.canAll(['READ_CLIENT', 'CREATE_CLIENT'])).toBe(false);
    // An empty list states no restriction, so it is vacuously satisfied — for a signed-in user only.
    expect(service.canAll([])).toBe(true);
  });

  it('replaces the list on setPermissions and returns to failing closed on clear', () => {
    const service = new PermissionsService();
    const granted = ['READ_CLIENT'];
    service.setPermissions(granted);
    expect(service.permissions()).toEqual(['READ_CLIENT']);

    // The stored list is a frozen copy, so neither the caller's later mutation nor a reader can change what the gate answers.
    granted.push('CREATE_CLIENT');
    expect(service.can('CREATE_CLIENT')).toBe(false);
    expect(Object.isFrozen(service.permissions())).toBe(true);

    // A second call replaces the list rather than appending to it.
    service.setPermissions(['CREATE_CLIENT']);
    expect(service.permissions()).toEqual(['CREATE_CLIENT']);
    expect(service.can('CREATE_CLIENT')).toBe(true);
    expect(service.can('READ_CLIENT')).toBe(false);

    // Clearing empties the list and re-arms the fail-closed answer, negation included.
    service.clear();
    expect(service.permissions()).toEqual([]);
    expect(service.can('CREATE_CLIENT')).toBe(false);
    expect(service.has('!CREATE_CLIENT')).toBe(false);
  });
});

/** The Fineract user id every session fixture names; `restore()` reads it out of the stored entry. */
const USER_ID = 42;

/** The parts the fixture's authentication key is joined from at test time. */
const KEY_PARTS = ['c2Vzc2lv', 'bi1rZXk'];

/** A legacy-shaped session entry: exactly the three fields `SessionManager` stores (AAP 0.7.2). */
function sessionFixture(userPermissions: string[]): SessionData {
  return {
    userId: USER_ID, authenticationKey: KEY_PARTS.join(''), userPermissions, };
}

/** The gate as the application actually runs it: the injected `PermissionsService`, fed by the real `SessionService` from the real `window.localStorage`. */
describe('PermissionsService and the stored session', () => {
  beforeEach(() => {
    // Each test starts from the state of a fresh browser profile: no stored entry to restore.
    window.localStorage.clear();
    // Reset first so the two services are built per test rather than reused from the previous one.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  it('denies every question, a negated one included, while SessionService holds no session', () => {
    const session = TestBed.inject(SessionService);
    const permissions = TestBed.inject(PermissionsService);
    expect(session.session()).toBeNull();
    expect(permissions.can('READ_CLIENT')).toBe(false);
    // The absence of a user is never read as permission, so the inversion of a code answers false rather than passing for want of the permission.
    expect(permissions.has('!READ_CLIENT')).toBe(false);
    expect(permissions.canAny(['READ_CLIENT', 'CREATE_CLIENT'])).toBe(false);
    expect(permissions.canAll(['READ_CLIENT'])).toBe(false);
    // Even the vacuously satisfied empty list stays closed: a control that declares no permission is still not offered to a signed-out user.
    expect(permissions.canAll([])).toBe(false);
    expect(permissions.permissions()).toEqual([]);
  });

  it('derives the permission signal from a session written after the service was constructed', async () => {
    const session = TestBed.inject(SessionService);
    const permissions = TestBed.inject(PermissionsService);
    const granted = ['READ_CLIENT', 'CREATE_CLIENT'];

    // Constructed and still closed: what the signal reports comes from the session, never from the list the service happened to hold when it was created.
    expect(permissions.permissions()).toEqual([]);
    session.write(sessionFixture(granted));
    // `write()` owns the stored entry and the session signal; the permission list is published by the restore that reads that entry back.
    expect(session.session()).not.toBeNull();
    expect(permissions.permissions()).toEqual([]);
    await expect(session.restore()).resolves.toBe(true);
    expect(permissions.permissions()).toEqual(granted);
    expect(permissions.can('CREATE_CLIENT')).toBe(true);
    expect(permissions.has('!CREATE_CLIENT')).toBe(false);

    // A second session replaces the list instead of adding to it, and the signal a screen re-renders from reports the replacement.
    session.write(sessionFixture(['READ_LOAN']));
    await expect(session.restore()).resolves.toBe(true);
    expect(permissions.permissions()).toEqual(['READ_LOAN']);
    expect(permissions.can('READ_CLIENT')).toBe(false);
  });

  it('withdraws every permission when the session is cleared, so a logged-out screen is denied', async () => {
    const session = TestBed.inject(SessionService);
    const permissions = TestBed.inject(PermissionsService);
    session.write(sessionFixture(['READ_CLIENT']));
    await expect(session.restore()).resolves.toBe(true);
    expect(permissions.can('READ_CLIENT')).toBe(true);
    session.clear();
    expect(session.session()).toBeNull();
    expect(permissions.permissions()).toEqual([]);
    expect(permissions.can('READ_CLIENT')).toBe(false);
    // Fail-closed again for the negated shape too: a logged-out user is not offered the complement of what a signed-in user would hold.
    expect(permissions.has('!READ_CLIENT')).toBe(false);
    expect(permissions.canAll([])).toBe(false);
  });
});
