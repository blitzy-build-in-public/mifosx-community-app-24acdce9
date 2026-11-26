import { Directive, ElementRef, Renderer2, effect, inject, input } from '@angular/core';

import { PermissionsService } from '../core/auth/permissions.service';

/** Template-side permission gate for the signed-in shell: the host element is hidden, never removed, whenever the user lacks the permission the caller names (AAP 0.7.1 `hasPermission` row; AAP 0.9.1 item 1 (AAP 0.3.4, AAP 0.1.1). */
@Directive({ selector: '[hasPermission]', standalone: true, exportAs: 'hasPermission', })
export class HasPermissionDirective {
  /** The permission code that decides the host element's visibility; `'CLIENT_VIEW'` and `'!READ_CLIENT'` are the two shapes a caller writes. A signal input, so rebinding it from the host template re-runs the effect and the element follows the new code without the host re-rendering its structure; required, because a gated element that names no code names nothing to check. */
  readonly hasPermission = input.required<string>();
  private readonly permissions = inject(PermissionsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  constructor() {
    this.renderer.setStyle(this.host.nativeElement, 'display', 'none');
    effect(() => {
      const code = this.hasPermission().trim();
      // The algebra — the leading `!`, `ALL_FUNCTIONS` and the answer for an unknown code — lives in `PermissionsService`, so this directive and `permission.guard.ts` cannot disagree about what a permission code means; reading (Rule 1 clause 3).
      if (code.length > 0 && this.permissions.has(code)) {
        this.renderer.removeStyle(this.host.nativeElement, 'display');
      } else {
        this.renderer.setStyle(this.host.nativeElement, 'display', 'none');
      }
    });
  }
}
