import { Component, provideZonelessChangeDetection, Signal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionsService } from '../core/auth/permissions.service';
import { HasPermissionDirective } from './has-permission.directive';

/**
 * Behavioural spec for `HasPermissionDirective`, the template-side permission gate the app shell's
 * navigation and action buttons hang off (AAP 0.7.1 row "`hasPermission` directive"; AAP 0.9.1
 * item 1; AAP 0.1.1 fail-closed requirement; AAP 0.3.4 claim 12 legacy semantics).
 *
 * Each test states one contract the directive owns:
 * - a gated element is hidden by inline `display` and stays in the document, never removed;
 * - a permission held before the first render shows it immediately, with no flash of a hidden
 *   control that has to be re-enabled later;
 * - `ALL_FUNCTIONS` shows any non-negated code;
 * - a leading `!` inverts the question, in both directions;
 * - an empty, whitespace-only or bare-`!` code fails closed, leaving the element hidden, and stays
 *   hidden even while `ALL_FUNCTIONS` grants every code — the directive's own blank-code
 *   precondition, not the service's answer, is what keeps a nameless gate shut;
 * - a permission granted after the first render reveals the element, which is the only proof that
 *   the directive tracks the permissions signal rather than reading it once.
 *
 * The permission algebra is not this directive's, so the suite supplies it at the real token. The
 * stub below mirrors the contract `core/auth/permissions.service.ts` publishes — the `can`/`has`
 * pair, `ALL_FUNCTIONS`, the leading `!` and the fail-closed answer — and is typed against the real
 * class so the two cannot drift. The real service is never instantiated here: it reads the session,
 * which a unit test has no business assembling.
 *
 * The host component holds the bound code in a signal because the application runs zoneless
 * (AAP 0.4.1), where a plain field would not mark the host view for refresh and a rebound code could
 * never reach the directive.
 */

/** The permission Fineract returns to a user who may do everything; spelled out, not imported. */
const ALL_FUNCTIONS = 'ALL_FUNCTIONS';

/**
 * The permissions the signed-in user holds, with the legacy answers for `!`, `ALL_FUNCTIONS` and a
 * code that names nothing, replacing `PermissionsService` only for this suite.
 */
class PermissionsStub implements Pick<PermissionsService, 'can' | 'has'> {
  private readonly granted = signal<readonly string[]>([]);

  /** Mirror of the service's public list, so a test can assert what the directive is reading. */
  readonly permissions: Signal<readonly string[]> = this.granted.asReadonly();

  /** Plain membership; `ALL_FUNCTIONS` grants every code, as it does in legacy. */
  can(key: string): boolean {
    const code = key.trim();
    return this.granted().includes(ALL_FUNCTIONS) || this.granted().includes(code);
  }

  /** The directive-facing question: a leading `!` asks for the permission's absence. */
  has(key: string): boolean {
    const code = key.trim();
    if (code.startsWith('!')) {
      const negated = code.slice(1).trim();
      return negated.length > 0 && !this.can(negated);
    }
    return this.can(code);
  }

  /** Replaces the granted list, the way a login or a permission refresh does. */
  grant(codes: readonly string[]): void {
    this.granted.set(codes);
  }
}

/** Two gated buttons: one binds a code the test chooses, the other always asks for the inverse. */
@Component({
  imports: [HasPermissionDirective],
  template: `
    <button id="gated" type="button" [hasPermission]="key()">A</button>
    <button id="negated" type="button" [hasPermission]="'!READ_CLIENT'">B</button>
  `,
})
class PermissionHostComponent {
  /** The code bound to `#gated`; each test sets it before the render it measures. */
  readonly key = signal('CLIENT_VIEW');
}

/**
 * The rendered button with the given id, or a named failure when the host template rendered none.
 * Narrowing with `instanceof` keeps the loosely typed `ComponentFixture.nativeElement` out of the
 * assertions and confines the boundary to this one helper.
 */
function buttonWithId(fixture: ComponentFixture<PermissionHostComponent>, id: string): HTMLElement {
  const element: unknown = fixture.nativeElement.querySelector(`#${id}`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`the host template rendered no #${id} element`);
  }
  return element;
}

describe('HasPermissionDirective', () => {
  let stub: PermissionsStub;
  let fixture: ComponentFixture<PermissionHostComponent>;

  beforeEach(() => {
    // Reset first so each test starts on a fresh root injector: a permission granted by one test
    // must never reach the next, and a second `configureTestingModule` on an instantiated module
    // throws.
    TestBed.resetTestingModule();
    stub = new PermissionsStub();
    TestBed.configureTestingModule({
      imports: [PermissionHostComponent],
      providers: [provideZonelessChangeDetection(), { provide: PermissionsService, useValue: stub }],
    });
    fixture = TestBed.createComponent(PermissionHostComponent);
  });

  it('hides the gated element without removing it while no permission is held', () => {
    // Hidden by the constructor, before the code is bound or any verdict exists: a gated control is
    // never painted in the window where its permission is still unknown.
    const gated = buttonWithId(fixture, 'gated');
    expect(gated.style.display).toBe('none');

    stub.grant([]);
    fixture.detectChanges();

    expect(gated.style.display).toBe('none');
    expect(gated.isConnected).toBe(true);
    expect(gated.textContent).toBe('A');
  });

  it('shows the gated element on the first render when the permission is already held', () => {
    stub.grant(['CLIENT_VIEW']);
    fixture.detectChanges();

    expect(buttonWithId(fixture, 'gated').style.display).toBe('');
  });

  it('shows a gated element for any non-negated code while ALL_FUNCTIONS is held', () => {
    stub.grant([ALL_FUNCTIONS]);
    fixture.componentInstance.key.set('UPDATE_LOAN_PRODUCT');
    fixture.detectChanges();

    expect(buttonWithId(fixture, 'gated').style.display).toBe('');
  });

  it('hides a negated code while the permission is held and shows it once the permission is dropped', () => {
    stub.grant(['READ_CLIENT', 'CLIENT_VIEW']);
    fixture.detectChanges();

    const negated = buttonWithId(fixture, 'negated');

    expect(negated.style.display).toBe('none');
    expect(buttonWithId(fixture, 'gated').style.display).toBe('');

    stub.grant([]);
    fixture.detectChanges();

    expect(negated.style.display).toBe('');
    expect(buttonWithId(fixture, 'gated').style.display).toBe('none');
  });

  it('hides the gated element for an empty, a whitespace-only and a bare-negation code', () => {
    stub.grant(['CLIENT_VIEW']);
    fixture.detectChanges();

    const gated = buttonWithId(fixture, 'gated');

    expect(gated.style.display).toBe('');

    fixture.componentInstance.key.set('');
    fixture.detectChanges();
    expect(gated.style.display).toBe('none');

    fixture.componentInstance.key.set('   ');
    fixture.detectChanges();
    expect(gated.style.display).toBe('none');

    fixture.componentInstance.key.set('!');
    fixture.detectChanges();
    expect(gated.style.display).toBe('none');
  });

  it('keeps a blank code hidden even while ALL_FUNCTIONS grants every code', () => {
    // `ALL_FUNCTIONS` answers true for any code the service is asked about, so the directive's own
    // blank-code precondition is what keeps a nameless gate shut here: the element must stay hidden
    // rather than inherit a blanket grant.
    stub.grant([ALL_FUNCTIONS]);
    fixture.detectChanges();

    expect(buttonWithId(fixture, 'gated').style.display).toBe('');

    fixture.componentInstance.key.set('');
    fixture.detectChanges();

    expect(buttonWithId(fixture, 'gated').style.display).toBe('none');
  });

  it('reveals the gated element when the permission arrives after the first render', () => {
    stub.grant([]);
    fixture.detectChanges();

    const gated = buttonWithId(fixture, 'gated');

    expect(gated.style.display).toBe('none');

    stub.grant(['CLIENT_VIEW']);
    fixture.detectChanges();

    expect(stub.permissions()).toEqual(['CLIENT_VIEW']);
    expect(gated.style.display).toBe('');
  });
});
