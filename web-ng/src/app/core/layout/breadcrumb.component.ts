import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Breadcrumb trail rendered by the signed-in shell (AAP 0.2.3 Component Inventory, `Breadcrumb`).
 *
 * Presentational only: the shell derives the crumbs from the deepest activated route's static
 * `data['breadcrumb']`, has them translated, and passes them in as labels. This component holds no
 * state, performs no navigation and carries no component-scoped CSS — the crumb's size and colour
 * come from the global `.breadcrumb` rule and Bootstrap 3's `.breadcrumb > .active`, which is what
 * keeps the migrated screens looking like the legacy application the design was captured from.
 */
@Component({
  selector: 'app-breadcrumb',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './breadcrumb.component.html',
})
export class BreadcrumbComponent {
  /**
   * Crumbs to render, already labelled for display and in trail order; the last entry is the
   * current page and carries Bootstrap's `active` state. An empty list renders nothing at all,
   * so a route that declares no `data['breadcrumb']` leaves no empty list occupying space.
   */
  readonly items = input<readonly { label: string }[]>([]);
}
