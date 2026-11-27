import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Breadcrumb trail rendered by the signed-in shell (AAP 0.2.3 `Breadcrumb`), presentational only: the shell derives the crumbs, translates them and passes them in as labels, and the crumb's size and colour come from the global `.breadcrumb` rules that keep the migrated screens looking like legacy (Rule 1 clause 6). */
@Component({
  selector: 'app-breadcrumb',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './breadcrumb.component.html',
})
export class BreadcrumbComponent {
  /** Crumbs to render, already labelled for display and in trail order, the last entry carrying Bootstrap's `active` state; an empty list renders nothing at all. */
  readonly items = input<readonly { label: string }[]>([]);
}
