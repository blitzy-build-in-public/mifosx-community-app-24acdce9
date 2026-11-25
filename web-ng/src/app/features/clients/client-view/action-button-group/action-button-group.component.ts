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

/**
 * One entry of the client record's joined action group — the descriptors the record's own component
 * hands to `ActionButtonGroupComponent` (AAP 0.2.3, row `ActionButtonGroup`; AAP 0.7.4, the client
 * view's action set).
 *
 * The parent owns every field, which is what keeps the plan's scope in the parent's hands: an action
 * the plan keeps out of scope cannot appear here, because no descriptor names it (AAP 0.10.5 items 5
 * and 8 — no client charges, no transfer, no staff assignment, and nothing behind the out-of-scope
 * modules). This component neither invents, renames nor reorders an entry.
 */
export interface ClientActionButton {
  /**
   * Legacy translation key of the button's label, resolved by `TranslatePipe` against the bundle
   * served from `app/global-translations/` — the same keys the legacy template binds, so the wording
   * is the legacy bundle's rather than this app's (Rule 1 clause 6: reuse the translations in place).
   */
  readonly label: string;

  /**
   * Font Awesome 4 class name without its `fa` prefix — `fa-edit`, `fa-plus`, `fa-times-circle-o` —
   * or omitted when the entry shows no glyph. The glyph font comes from `font-awesome` 4.7.0 through
   * `web-ng/src/styles.scss`, so the icon family is the one the legacy screens use and no image is
   * copied into this application.
   */
  readonly icon?: string;

  /**
   * Fineract permission code the entry requires, as the backend reports it — `UPDATE_CLIENT`,
   * `CREATE_LOAN`, `CLOSE_CLIENT`. The template gate `HasPermissionDirective` asks
   * `PermissionsService` about it, so `ALL_FUNCTIONS`, `ALL_FUNCTIONS_READ` and the leading `!` of a
   * negated code mean here exactly what they mean to `permissionGuard` (AAP 0.1.1, "a permission gate
   * that fails closed").
   */
  readonly permission: string;

  /**
   * Hash-router path the entry navigates to — `/editclient/2`, `/client/2/activate`. The parent
   * builds it from the id the record's URL names, so the entry is an in-application route and never a
   * Fineract URL: this component issues no request, and the lifecycle commands are posted by
   * `client-actions.component.ts` after the datatable gate (AAP 0.7.4).
   */
  readonly routerLink: string;

  /**
   * `true` when the entry belongs to the `More` dropdown rather than to the visible row; omitted or
   * `false` makes it a top-level button. The template renders the trigger and every entry either way
   * and lets each entry's own gate hide it, as legacy's record did (Rule 1 clause 3);
   * `hasMore` publishes the "is anything permitted?" answer for a caller that owns the trigger
   * markup of its own.
   */
  readonly menu?: boolean;
}

/**
 * The joined action group of the individual client record — the `ActionButtonGroup` row of the
 * component inventory (AAP 0.2.3), an element of the record screen in the "Sign in and open a client
 * record" flow (Figma node `1:4`, file `DKm5TBFbXypfqyx4xUdhBw`) — together with the `More`
 * dropdown that closes it.
 *
 * Presentational and controlled, like the record's tab strip: it renders the descriptors its parent
 * hands it, gates each one on the permission that descriptor names, and reports nothing back. It
 * holds no action list of its own, so the plan's action set — `Edit`, `New Loan`, `New Saving`,
 * `Close`, and `Activate`, `Reject`, `Withdraw` and `Reactivate` in the `More` menu (AAP 0.7.4) — is
 * stated in exactly one place, the parent.
 *
 * **It navigates and nothing else.** No command is posted, confirmed or dispatched here, the
 * datatable gate that every lifecycle action passes first is not run here, and no Fineract URL is
 * named: each entry is a link to one of the record's routes (AAP 0.14.1, "one direction of
 * dependency"). `PermissionsService` answers one published question about the session's permission
 * list — {@link visibleMenuActions} and {@link hasMore}, whether anything in the `More` menu is
 * permitted — which a caller that owns the trigger markup of its own would ask; the template renders
 * the trigger and every entry as legacy did and leaves visibility to each entry's own gate.
 *
 * **Styling is the legacy Bootstrap 3 one and lives in the global stylesheet.** The group is a
 * `.btn-group` of plain `.btn.btn-primary` links — joined, square-ended, separated by a 1px rule,
 * with a white Font Awesome glyph and a white label — so this component declares no styles and no
 * colour, size or radius of its own (Rule 1 clause 6; AAP 0.4.4 decision 4). The `More` trigger's
 * open state is Angular state bound to `moreOpen`, not Bootstrap's dropdown plugin, which would need
 * the jQuery the migration forbids.
 */
@Component({
  selector: 'app-action-button-group',
  imports: [RouterLink, HasPermissionDirective, TranslatePipe],
  templateUrl: './action-button-group.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionButtonGroupComponent {
  /**
   * The entries to render, in the parent's order. Defaults to none, so the group renders nothing
   * before the record's descriptors arrive and the parent never has to bind `undefined`.
   */
  readonly actions = input<readonly ClientActionButton[]>([]);

  /**
   * Answers whether the signed-in user may use an entry, which is the one question the component's
   * published computeds ask — whether anything in the `More` menu is permitted. No element's
   * visibility is decided here: the template asks `HasPermissionDirective` per entry, so the gate that
   * hides a button and the gate `permissionGuard` uses are the same one.
   */
  private readonly permissions = inject(PermissionsService);

  /**
   * Whether the `More` dropdown is open. Angular state rather than Bootstrap's dropdown plugin, whose
   * behaviour depends on the jQuery this migration forbids; the template binds it to the group's
   * `open` class exactly as the legacy record's markup did.
   */
  readonly moreOpen = signal(false);

  /**
   * The entries belonging to the visible row, in the parent's order and **unfiltered by permission**:
   * each one carries its own `[hasPermission]` gate, which hides the host element instead of removing
   * it, so the record holds the same buttons legacy rendered and the gate remains the single authority
   * on their visibility.
   */
  readonly topLevelActions = computed(() => this.actions().filter((action) => action.menu !== true));

  /**
   * The entries the `More` menu holds, in the parent's order and **unfiltered by permission**, which is
   * the list the template renders: each entry carries its own `[hasPermission]` gate, so a code the
   * user does not hold hides that entry where it stands instead of dropping it from the menu — the
   * legacy record's own arrangement, and the one Rule 1 clause 3 requires be matched rather than
   * improved. Filtering happens only in {@link visibleMenuActions}, which no template branch reads.
   */
  readonly menuActions = computed(() => this.actions().filter((action) => action.menu === true));

  /**
   * The entries the `More` menu offers, in the parent's order, limited to those the user may use.
   *
   * Reading `PermissionsService.can` here is what makes the answer appear once a session's permissions
   * arrive after the first render, and disappear again when that session is withdrawn — the legacy
   * `permissionsChanged` behaviour, carried by signals. Only `can` is asked, because a descriptor
   * names a plain backend code and `can` already answers `ALL_FUNCTIONS` and `ALL_FUNCTIONS_READ`.
   *
   * This is the component's published answer for a caller that owns the trigger markup, not the list
   * the template renders: the template deliberately renders every menu entry exactly as legacy did
   * (Rule 1 clause 3) and lets each one's own gate hide it.
   */
  readonly visibleMenuActions = computed(() =>
    this.actions().filter(
      (action) => action.menu === true && this.permissions.can(action.permission),
    ),
  );

  /**
   * Whether the session may use any entry of the `More` menu at all.
   *
   * This is the component's published answer for a caller that owns the trigger markup of its own,
   * not the decision the record's template makes: the template deliberately renders the trigger and
   * every entry exactly as legacy did, each entry behind its own gate (Rule 1 clause 3), so a user
   * holding none of these codes opens a menu whose entries are all hidden. Legacy showed its trigger
   * whenever any option existed (`app/views/clients/viewclient.html:199`, with `buttonsArray.options`
   * hard-coded to a single entry in `ViewClientController.js:265-271`) and hid the options one by one,
   * which is the arrangement this template reproduces; answering "is anything permitted?" alongside it
   * lets a caller that renders its own trigger omit one the session could not use.
   */
  readonly hasMore = computed(() => this.visibleMenuActions().length > 0);

  /**
   * Closes the `More` menu whenever the descriptors change.
   *
   * The router reuses the record component when the URL moves from one `#/viewclient/{id}` to another,
   * and that component hands this one a fresh descriptor list for the client it now shows. Without
   * this, a menu the previous client's record was left open would still be open over the new client's
   * row — a control the user opened against another record — and the action group has no other way to
   * learn that the list it renders is no longer the one the menu was opened on. Reading the input is
   * what subscribes the effect to it; the value itself is never needed, only the change.
   */
  constructor() {
    effect(() => {
      this.actions();
      this.moreOpen.set(false);
    });
  }

  /**
   * Opens the `More` dropdown when it is closed and closes it when it is open. It navigates nowhere and
   * requests nothing: the entries it reveals are ordinary links.
   */
  toggleMore(): void {
    this.moreOpen.update((open) => !open);
  }

  /**
   * Closes the `More` dropdown without opening it, which is what the Escape key inside the menu does:
   * the keyboard leaves the dropdown without the user aiming at the trigger again.
   */
  closeMore(): void {
    this.moreOpen.set(false);
  }
}
