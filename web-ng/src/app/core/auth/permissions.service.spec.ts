import { describe, expect, it } from 'vitest';

import { ALL_FUNCTIONS, ALL_FUNCTIONS_READ, PermissionsService } from './permissions.service';

/**
 * Behavioural spec for `PermissionsService`, the one answer to "may this user do this?" that both the
 * `hasPermission` directive and the route guard read (AAP 0.7.1, row `PermissionsService`; AAP 0.3.4
 * claim 12; the fail-closed requirement of AAP 0.1.1).
 *
 * Each test states one contract of the legacy algebra the service reproduces
 * (`app/scripts/directives/HasPermissionDirective.js:5-27` and the `$rootScope.hasPermission` answer
 * at `app/scripts/controllers/main/MainController.js:104-127`):
 * - nothing is permitted until a login supplies a permission list, a negated code included;
 * - a code is held when the list holds it, and a code that names nothing is held by nobody;
 * - `ALL_FUNCTIONS` grants every code while `ALL_FUNCTIONS_READ` grants only the `READ_` ones;
 * - `has()` inverts a leading `!`, refuses a bare `!` and tolerates surrounding whitespace;
 * - `ALL_FUNCTIONS` makes a code present, so its negation then fails;
 * - `canAny` and `canAll` aggregate that same question, an empty `canAll` list being vacuously true;
 * - `setPermissions` replaces the list instead of appending to it, and `clear()` returns the service
 *   to the fail-closed state.
 *
 * The service has no injected dependency — permission strings enter only through `setPermissions` —
 * so each test constructs it directly and drives the list the way `AuthService` does, with no
 * `TestBed`.
 */
describe('PermissionsService', () => {
  it('fails closed until a session supplies a permission list', () => {
    const service = new PermissionsService();

    expect(service.permissions()).toEqual([]);
    expect(service.can('READ_CLIENT')).toBe(false);
    expect(service.has('READ_CLIENT')).toBe(false);
    // The absence of a user is never read as permission, so the inversion of a code answers false
    // rather than passing for want of the permission.
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

    // An authenticated user who genuinely holds nothing passes the inversion, which is what the
    // legacy directive shows for them — unlike the signed-out answer asserted above.
    service.setPermissions([]);
    expect(service.has('!READ_CLIENT')).toBe(true);
  });

  it('fails the negation of a code that ALL_FUNCTIONS makes present', () => {
    const service = new PermissionsService();
    service.setPermissions([ALL_FUNCTIONS]);

    // The wildcard makes every code present, so asking for one's absence is answered false rather
    // than revealing a control the user has no reason to be offered.
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

    // The stored list is a frozen copy, so neither the caller's later mutation nor a reader can
    // change what the gate answers.
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
