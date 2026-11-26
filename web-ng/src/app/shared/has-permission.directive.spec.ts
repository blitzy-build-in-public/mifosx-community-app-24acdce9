import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionsService } from '../core/auth/permissions.service';
import { HasPermissionDirective } from './has-permission.directive';

/** Behavioural spec for `HasPermissionDirective`, the template-side permission gate the app shell's navigation and action buttons hang off (AAP 0.7.1 row "`hasPermission` directive"; AAP 0.9.1 item 1; AAP 0.1.1 fail-closed (AAP 0.3.4, AAP 0.4.1). */

/** The permission Fineract returns to a user who may do everything; spelled out, not imported. */
const ALL_FUNCTIONS = 'ALL_FUNCTIONS';

/** The permission answers `PermissionsService` gives in the state a test puts it in — none while no session is present, and the legacy answers for the list, `!` and `ALL_FUNCTIONS` once one is — replacing the real service. */
class PermissionsStub implements Pick<PermissionsService, 'can' | 'has'> {
  private readonly granted = signal<readonly string[]>([]);

  /** True once a login has supplied a list, false before that and again after `clear()`, exactly as the real service's own gate holds it: a session that never arrived is not a user who holds nothing. */
  private readonly sessionPresent = signal(false);

  /** Plain membership; `ALL_FUNCTIONS` grants every code, as it does in legacy. */
  can(key: string): boolean {
    if (!this.sessionPresent()) {
      return false;
    }

    const code = key.trim();
    return this.granted().includes(ALL_FUNCTIONS) || this.granted().includes(code);
  }

  /** The directive-facing question: a leading `!` asks for the permission's absence. */
  has(key: string): boolean {
    if (!this.sessionPresent()) {
      return false;
    }

    const code = key.trim();
    if (code.startsWith('!')) {
      const negated = code.slice(1).trim();
      return negated.length > 0 && !this.can(negated);
    }
    return this.can(code);
  }

  /** Replaces the granted list and marks the session present, the way a login or a restore does. */
  grant(codes: readonly string[]): void {
    this.granted.set(codes);
    this.sessionPresent.set(true);
  }

  /** Empties the list and marks the session absent, the way a logout and a 401 response do. */
  clear(): void {
    this.granted.set([]);
    this.sessionPresent.set(false);
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

/** The rendered button with the given id, or a named failure when the host template rendered none. */
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
    // Reset first so each test starts on a fresh root injector: a permission granted by one test must never reach the next, and a second `configureTestingModule` on an instantiated module throws.
    TestBed.resetTestingModule();
    stub = new PermissionsStub();
    TestBed.configureTestingModule({
      imports: [PermissionHostComponent],
      providers: [provideZonelessChangeDetection(), { provide: PermissionsService, useValue: stub }],
    });
    fixture = TestBed.createComponent(PermissionHostComponent);
  });

  it('hides the gated element without removing it while no permission is held', () => {
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
    // `ALL_FUNCTIONS` answers true for any code the service is asked about, so the directive's own blank-code precondition is what keeps a nameless gate shut here: the element must stay hidden rather than inherit a blanket.
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

    expect(gated.style.display).toBe('');

    stub.grant(['UPDATE_CLIENT']);
    fixture.detectChanges();

    expect(gated.style.display).toBe('none');
  });

  it('hides both elements while no session is present and reveals only the negated one once one is', () => {
    fixture.detectChanges();

    const gated = buttonWithId(fixture, 'gated');
    const negated = buttonWithId(fixture, 'negated');

    expect(gated.style.display).toBe('none');
    expect(negated.style.display).toBe('none');
    expect(negated.isConnected).toBe(true);

    stub.grant([]);
    fixture.detectChanges();

    expect(negated.style.display).toBe('');
    expect(gated.style.display).toBe('none');

    stub.clear();
    fixture.detectChanges();

    expect(gated.style.display).toBe('none');
    expect(negated.style.display).toBe('none');
  });
});
