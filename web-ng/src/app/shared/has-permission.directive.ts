import { Directive, ElementRef, Renderer2, effect, inject, input } from '@angular/core';

import { PermissionsService } from '../core/auth/permissions.service';

/**
 * Template-side permission gate for the signed-in shell: the host element is hidden, never removed,
 * whenever the user lacks the permission the caller names (AAP 0.7.1 row "`hasPermission` directive";
 * AAP 0.9.1 item 1, "permission-gated navigation and action buttons").
 *
 * The semantics are the legacy `has-permission` directive's (AAP 0.3.4 claim 12,
 * `app/scripts/directives/HasPermissionDirective.js:5-27`): the attribute carries a permission code
 * as a string, a leading `!` asks for that permission's absence, and the verdict is re-read whenever
 * the answer can change — here from signals rather than the legacy `permissionsChanged` broadcast.
 * `ALL_FUNCTIONS` allows everything, as it does in legacy.
 *
 * The gate **fails closed**: the element is hidden in the constructor, before any verdict exists, and
 * is only revealed once `PermissionsService` says the permission is held. That is what keeps the
 * directive in step with the route guard `permission.guard.ts` (AAP 0.1.1, "a route guard and a
 * template directive must agree, or a user reaches a screen they cannot act on"): an empty or
 * whitespace-only code, a code the user does not hold and the bare `!` all leave the element hidden
 * rather than visible, and a host that binds no code at all fails its required input instead of
 * rendering an ungated control.
 *
 * Visibility is the inline `display` style alone, because `ngIf`-style DOM removal is not what legacy
 * did and Bootstrap 3 lays the surrounding markup out around the element's declared box. The element
 * therefore keeps its place in the document, its accessibility state and any listener the parent
 * attached to it while it is hidden.
 *
 * Typical use, on a menu entry or an action button:
 * `[hasPermission]="'CLIENT_VIEW'"`, or `[hasPermission]="'!READ_CLIENT'"` for the inverse.
 */
@Directive({
  selector: '[hasPermission]',
  standalone: true,
  exportAs: 'hasPermission',
})
export class HasPermissionDirective {
  /**
   * The permission code that decides the host element's visibility; `'CLIENT_VIEW'` and
   * `'!READ_CLIENT'` are the two shapes a caller writes.
   *
   * A signal input, so rebinding it from the host template re-runs the effect below and the element
   * follows the new code without the host re-rendering its structure. It is required: a gated
   * element that names no code names nothing to check, which is a template mistake rather than a
   * permission decision.
   */
  readonly hasPermission = input.required<string>();

  private readonly permissions = inject(PermissionsService);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly renderer = inject(Renderer2);

  constructor() {
    // Hidden before the first verdict: a gated control must never be painted, clicked or announced
    // in the window between the element being created and the permissions being known.
    this.renderer.setStyle(this.host.nativeElement, 'display', 'none');

    effect(() => {
      const code = this.hasPermission().trim();

      // The algebra — the leading `!`, `ALL_FUNCTIONS` and the answer for an unknown code — lives in
      // `PermissionsService`, so this directive and `permission.guard.ts` cannot disagree about what
      // a permission code means. Reading the code and the permission list inside the effect is also
      // what re-renders the element when a permission arrives after login, when one is withdrawn, or
      // when the caller rebinds the code.
      //
      // The blank check is the directive's own fail-closed precondition, not part of that algebra: an
      // empty or whitespace-only code names nothing, so the element stays hidden however the
      // permission list is populated. A bare `!` needs no check here — the service answers its empty
      // remainder false — and every other code is the service's decision alone.
      if (code.length > 0 && this.permissions.has(code)) {
        this.renderer.removeStyle(this.host.nativeElement, 'display');
      } else {
        this.renderer.setStyle(this.host.nativeElement, 'display', 'none');
      }
    });
  }
}
