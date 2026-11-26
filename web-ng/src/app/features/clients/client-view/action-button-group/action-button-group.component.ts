import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { PermissionsService } from '../../../../core/auth/permissions.service';
import { HasPermissionDirective } from '../../../../shared/has-permission.directive';

/** One entry of the record's joined action group (AAP 0.2.3 row `ActionButtonGroup`; AAP 0.7.4), every field owned by the parent, so an out-of-scope action cannot appear here (AAP 0.10.5 items 5 and 8). */
export interface ClientActionButton {
  /** Legacy translation key of the button's label, resolved by `TranslatePipe` against the bundle served from `app/global-translations/` (Rule 1 clause 6). */
  readonly label: string;
  /** Font Awesome 4 class name without its `fa` prefix — `fa-edit`, `fa-times-circle-o` — or omitted when the entry shows no glyph, the font coming from `font-awesome` 4.7.0 via `styles.scss`. */
  readonly icon?: string;
  /** Fineract permission code the entry requires, as the backend reports it — `UPDATE_CLIENT`, `CREATE_LOAN` — gated by `HasPermissionDirective` through `PermissionsService`, which answers `ALL_FUNCTIONS` and a negated code as `permissionGuard` does (AAP 0.1.1). */
  readonly permission: string;
  /** Hash-router path the entry navigates to — `/editclient/2`, `/client/2/activate` — built by the parent from the record's id, so it is an in-application route and never a Fineract URL (AAP 0.7.4). */
  readonly routerLink: string;
  /** `true` when the entry belongs to the `More` dropdown rather than the visible row, as legacy's record placed it (Rule 1 clause 3). */
  readonly menu?: boolean;
}

/** The record's joined action group plus the `More` dropdown that closes it — the `ActionButtonGroup` row of AAP 0.2.3 in Figma node `1:4`, controlled by its parent and navigating only, with the legacy `.btn-group` styling in the global stylesheet (Rule 1 clause 6). */
@Component({
  selector: 'app-action-button-group',
  imports: [RouterLink, HasPermissionDirective, TranslatePipe],
  templateUrl: './action-button-group.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionButtonGroupComponent {
  /** The entries to render, in the parent's order. Defaults to none, so the group renders nothing before the record's descriptors arrive. */
  readonly actions = input<readonly ClientActionButton[]>([]);
  /** Answers whether the signed-in user may use an entry, the one question the published computeds ask; every element's own visibility is decided by `HasPermissionDirective` (AAP 0.1.1). */
  private readonly permissions = inject(PermissionsService);
  /** Whether the `More` dropdown is open: Angular state rather than Bootstrap's plugin, whose behaviour depends on the jQuery this migration forbids. */
  readonly moreOpen = signal(false);

  /** The entries belonging to the visible row, in the parent's order and unfiltered by permission, since each carries its own `[hasPermission]` gate that hides it where it stands (Rule 1 clause 3). */
  readonly topLevelActions = computed(() => this.actions().filter((action) => action.menu !== true));

  /** The entries the `More` menu holds, in the parent's order and unfiltered by permission, which is the list the template renders and the arrangement legacy's record had (Rule 1 clause 3). */
  readonly menuActions = computed(() => this.actions().filter((action) => action.menu === true));

  /** The `More` entries the user may use, reading `PermissionsService.can` so the answer follows the session's permissions as legacy's `permissionsChanged` did — published for a caller that owns the trigger markup. */
  readonly visibleMenuActions = computed(() =>
    this.actions().filter(
      (action) => action.menu === true && this.permissions.can(action.permission),
    ),
  );

  /** Whether the session may use any `More` entry at all; the template still renders every entry behind its own gate as legacy did, and a caller rendering its own trigger can omit one it could not use. */
  readonly hasMore = computed(() => this.visibleMenuActions().length > 0);

  /** Closes the `More` menu whenever the descriptors change: the router reuses the record component when the URL moves to another client, and reading the input is what subscribes the effect. */
  constructor() {
    effect(() => {
      this.actions();
      this.moreOpen.set(false);
    });
  }

  /** Opens the `More` dropdown when it is closed and closes it when it is open; it navigates nowhere and requests nothing. */
  toggleMore(): void {
    this.moreOpen.update((open) => !open);
  }

  /** Closes the `More` dropdown without opening it, which is what the Escape key inside the menu does. */
  closeMore(): void {
    this.moreOpen.set(false);
  }
}
