import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_FUNCTIONS, ALL_FUNCTIONS_READ, PermissionsService } from './permissions.service';
import type { SessionData } from './session.model';
import type { ApiBaseUrls } from './session-origin';
import { SessionService } from './session.service';

/** Behavioural spec for `PermissionsService`, the one answer to "may this user do this?" that both the `hasPermission` directive and the route guard read (AAP 0.7.1, row `PermissionsService`; AAP 0.3.4 claim 12; AAP 0.1.1): the permission algebra it pins is the one the gate answers with — `ALL_FUNCTIONS` grants every code, `ALL_FUNCTIONS_READ` every `READ_` code and nothing else, and with no session every answer is `false`, so the gate fails closed. */
describe('PermissionsService', () => {
  it('fails closed until a session supplies a permission list', () => {
    const service = new PermissionsService();
    expect(service.permissions()).toEqual([]);
    expect(service.can('READ_CLIENT')).toBe(false);
    expect(service.has('READ_CLIENT')).toBe(false);
    expect(service.has('!READ_CLIENT')).toBe(false);
    expect(service.canAny(['READ_CLIENT'])).toBe(false);
    expect(service.canAll([])).toBe(false);
  });

  it('answers membership of the permission list', () => {
    const service = new PermissionsService();
    service.setPermissions(['READ_CLIENT', 'CREATE_CLIENT']);
    expect(service.can('READ_CLIENT')).toBe(true);
    expect(service.can('CREATE_CLIENT')).toBe(true);
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
    expect(service.canAll([])).toBe(true);
    expect(service.permissions()).toEqual([]);
  });

  it('grants READ_ codes and no others while ALL_FUNCTIONS_READ is held', () => {
    const service = new PermissionsService();
    service.setPermissions([ALL_FUNCTIONS_READ]);
    expect(service.can('READ_CLIENT')).toBe(true);
    expect(service.can('READ_LOAN')).toBe(true);
    expect(service.can('CREATE_CLIENT')).toBe(false);
  });

  it('inverts a leading !, refuses a bare ! and tolerates surrounding whitespace', () => {
    const service = new PermissionsService();
    service.setPermissions(['READ_CLIENT']);

    expect(service.has('READ_CLIENT')).toBe(true);
    expect(service.has('READ_LOAN')).toBe(false);

    expect(service.has('!READ_CLIENT')).toBe(false);
    expect(service.has('!READ_LOAN')).toBe(true);

    expect(service.has('  READ_CLIENT  ')).toBe(true);
    expect(service.has(' ! CREATE_CLIENT ')).toBe(true);
    expect(service.has('  !  READ_CLIENT  ')).toBe(false);

    // A bare `!` names nothing to negate, so it is refused rather than answered with a blanket pass.
    expect(service.has('!')).toBe(false);
    expect(service.has('   !   ')).toBe(false);

    service.setPermissions([]);
    expect(service.has('!READ_CLIENT')).toBe(true);
  });

  it('fails the negation of a code that ALL_FUNCTIONS makes present', () => {
    const service = new PermissionsService();
    service.setPermissions([ALL_FUNCTIONS]);

    expect(service.has('!READ_CLIENT')).toBe(false);
    expect(service.has('READ_CLIENT')).toBe(true);
  });

  it('aggregates the same question over a list of codes', () => {
    const service = new PermissionsService();
    service.setPermissions(['READ_CLIENT']);
    expect(service.canAny(['READ_CLIENT', 'CREATE_CLIENT'])).toBe(true);
    expect(service.canAny(['CREATE_CLIENT', 'UPDATE_CLIENT'])).toBe(false);
    expect(service.canAny(['CREATE_CLIENT', '!CREATE_CLIENT'])).toBe(true);
    expect(service.canAny([])).toBe(false);
    expect(service.canAll(['READ_CLIENT'])).toBe(true);
    expect(service.canAll(['READ_CLIENT', 'CREATE_CLIENT'])).toBe(false);
    expect(service.canAll([])).toBe(true);
  });

  it('replaces the list on setPermissions and returns to failing closed on clear', () => {
    const service = new PermissionsService();
    const granted = ['READ_CLIENT'];
    service.setPermissions(granted);
    expect(service.permissions()).toEqual(['READ_CLIENT']);

    granted.push('CREATE_CLIENT');
    expect(service.can('CREATE_CLIENT')).toBe(false);
    expect(Object.isFrozen(service.permissions())).toBe(true);

    service.setPermissions(['CREATE_CLIENT']);
    expect(service.permissions()).toEqual(['CREATE_CLIENT']);
    expect(service.can('CREATE_CLIENT')).toBe(true);
    expect(service.can('READ_CLIENT')).toBe(false);

    service.clear();
    expect(service.permissions()).toEqual([]);
    expect(service.can('CREATE_CLIENT')).toBe(false);
    expect(service.has('!CREATE_CLIENT')).toBe(false);
  });
});

const USER_ID = 42;

/** The API base the fixture session is issued against, written as `web-ng/src/assets/config.json` ships it: the resolved and the served base are one while no page URL overrides them (AAP 0.4.4 decision 5). */
const API_BASE_URL = 'https://localhost:8443';

/** The two bases a restore judges the stored credential against: the same host twice, so the fixture entry is presented to the base it was written for. */
const BASES: ApiBaseUrls = { resolved: API_BASE_URL, served: API_BASE_URL };

const KEY_PARTS = ['c2Vzc2lv', 'bi1rZXk'];

/** A legacy-shaped session entry: exactly the three fields `SessionManager` stores (AAP 0.7.2). */
function sessionFixture(userPermissions: string[]): SessionData {
  return {
    userId: USER_ID, authenticationKey: KEY_PARTS.join(''), userPermissions, };
}

/** The gate as the application actually runs it: the injected `PermissionsService`, fed by the real `SessionService` from the real `window.localStorage`. */
describe('PermissionsService and the stored session', () => {
  beforeEach(() => {
    window.localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  it('denies every question, a negated one included, while SessionService holds no session', () => {
    const session = TestBed.inject(SessionService);
    const permissions = TestBed.inject(PermissionsService);
    expect(session.session()).toBeNull();
    expect(permissions.can('READ_CLIENT')).toBe(false);
    expect(permissions.has('!READ_CLIENT')).toBe(false);
    expect(permissions.canAny(['READ_CLIENT', 'CREATE_CLIENT'])).toBe(false);
    expect(permissions.canAll(['READ_CLIENT'])).toBe(false);
    expect(permissions.canAll([])).toBe(false);
    expect(permissions.permissions()).toEqual([]);
  });

  it('derives the permission signal from a session written after the service was constructed', async () => {
    const session = TestBed.inject(SessionService);
    const permissions = TestBed.inject(PermissionsService);
    const granted = ['READ_CLIENT', 'CREATE_CLIENT'];

    expect(permissions.permissions()).toEqual([]);
    session.write(sessionFixture(granted), API_BASE_URL);
    // `write()` owns the stored entry and the session signal; the permission list is published by the restore that reads that entry back.
    expect(session.session()).not.toBeNull();
    expect(permissions.permissions()).toEqual([]);
    await expect(session.restore(BASES)).resolves.toBe(true);
    expect(permissions.permissions()).toEqual(granted);
    expect(permissions.can('CREATE_CLIENT')).toBe(true);
    expect(permissions.has('!CREATE_CLIENT')).toBe(false);

    session.write(sessionFixture(['READ_LOAN']), API_BASE_URL);
    await expect(session.restore(BASES)).resolves.toBe(true);
    expect(permissions.permissions()).toEqual(['READ_LOAN']);
    expect(permissions.can('READ_CLIENT')).toBe(false);
  });

  it('withdraws every permission when the session is cleared, so a logged-out screen is denied', async () => {
    const session = TestBed.inject(SessionService);
    const permissions = TestBed.inject(PermissionsService);
    session.write(sessionFixture(['READ_CLIENT']), API_BASE_URL);
    await expect(session.restore(BASES)).resolves.toBe(true);
    expect(permissions.can('READ_CLIENT')).toBe(true);
    session.clear();
    expect(session.session()).toBeNull();
    expect(permissions.permissions()).toEqual([]);
    expect(permissions.can('READ_CLIENT')).toBe(false);
    expect(permissions.has('!READ_CLIENT')).toBe(false);
    expect(permissions.canAll([])).toBe(false);
  });
});
