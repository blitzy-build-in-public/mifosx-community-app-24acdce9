import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { HasPermissionDirective } from '../../../../shared/has-permission.directive';
import { DISPLAY_DATE_FORMAT, fromFineractDate } from '../../../../shared/date-format.util';
import { EmptyStateComponent } from '../../../../shared/empty-state/empty-state.component';
// The loans feature keeps one model module at its root (`features/loans/loan.models.ts`), which is
// two levels above this section's folder.
import type { LoanCharge } from '../../loan.models';

/**
 * One rendered row of the record's charges table: a loan charge carrying Fineract's own values, with
 * its `dueDate` parsed for display.
 *
 * Module-local and deliberately not exported, so no other file can come to depend on a
 * transformation that belongs to this component (AAP 0.7.2, AAP 0.14.2). `dueDate` widens to
 * `Date | null` because `fromFineractDate` answers `null` for a value it cannot parse, and for a
 * charge that falls due on disbursement and carries no date at all; the cell then renders empty
 * instead of showing an invalid date.
 */
type ChargeRow = Omit<LoanCharge, 'dueDate'> & { readonly dueDate: Date | null };

/**
 * Charges section of the individual-loan record (`#/viewloanaccount/:id`): the read-only table of the
 * charges the loan carries, with the two entry points that act on one of them (AAP 0.7.1 row `loans`,
 * which names `LoanChargesComponent`; AAP 0.7.2 row `LoanCharge`; AAP 0.7.4, whose list of surfaces
 * requiring an explicit empty state includes the loan view's charge list).
 *
 * **Where the rows come from.** The parent passes the loan record's own `charges` member, which
 * `GET /loans/{id}?associations=all` carries (AAP 0.7.3 row "W6 repayment"). This component issues no
 * request of its own, so the record screen keeps making
 * exactly the calls its typed service owns (AAP 0.4.2; Rule 1 clause 2), and it injects no
 * collaborator, subscribes to nothing and holds no state that it writes.
 *
 * **What a row shows, per Rule 1 clause 3 (match legacy, do not improve it).** The charge's name, the
 * date it falls due, the amount charged, the amount already paid and the amount still outstanding —
 * every one the server's own value, with amounts through `DecimalPipe`, the same grouping the legacy
 * table's `number` filter applies, and the due date through the shared `DISPLAY_DATE_FORMAT`, the only
 * display pattern the application has (AAP 0.7.2 "Date handling"). `name` is rendered as the server
 * sent it and is never passed through `TranslatePipe`, because translating a charge's own name would
 * put words in the server's mouth. Every caption the template renders resolves in the legacy bundles
 * (`label.nodata`, `label.heading.{name,amount,paid,outstanding,actions,dueasof}`,
 * `label.button.{paycharge,waivecharge}` — checked against `app/global-translations/locale-en.json`).
 * The legacy tab also carries a fee-or-penalty column, the charge's payment-due and calculation
 * types, a waived column, and edit and delete actions (`UPDATE_LOANCHARGE`, `DELETE_LOANCHARGE`)
 * while the loan is still pending approval; this section renders the five columns and the two actions
 * AAP 0.7.1's charge scope and AAP 0.7.2's `LoanCharge` row describe, so those extras are an AAP
 * 0.10.5 intentional-diff candidate for the plan owner and adding them here is out of this file's
 * scope.
 *
 * **The two charge actions are links, not forms.** `pay` and `waive` are `routerLink`s to
 * `#/loanaccountcharge/:id/:action/:chargeId`, the route `loans.routes.ts` declares and
 * `loan-charge-form.component.ts` serves, gated on the permission the record passes in — the single
 * code the record's own action group uses and the code that route's own guard requires, so a visible
 * link never leads somewhere the guard then refuses (AAP 0.1.1, "a route guard and a template
 * directive must agree").
 *
 * Legacy does decide per row there, in its controller: it marks a charge `actionFlag` when it is paid
 * or waived, falls due on disbursement, or belongs to a loan that is not `Active`, hides the waive
 * link on that flag, and shows the pay link only for a payable charge on an active loan. That is a
 * rendering rule of the row, so it belongs to this component's template rather than to its class — an
 * eligibility predicate declared here and read by no template would be dead code — and until the
 * template applies it this section shows both links for every charge and leaves the legality of the
 * command to the server. The difference is reported for the plan owner's intentional-difference
 * register rather than hidden by a comparison this class cannot render.
 *
 * The look comes entirely from the global Bootstrap 3 classes of `web-ng/src/styles.scss` — this
 * component declares no stylesheet, no inline style and no colour (Rule 1 clause 6; AAP 0.4.4
 * decision 4). The record page supplies the card, so this file adds no panel and no heading.
 */
@Component({
  selector: 'app-loan-charges',
  imports: [DatePipe, DecimalPipe, RouterLink, TranslatePipe, EmptyStateComponent, HasPermissionDirective],
  templateUrl: './loan-charges.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanChargesComponent {
  /**
   * The loan's charges, as the record's `charges` member reported them. Defaults to an empty array so
   * a loan with no charges renders the explicit empty state without the parent passing anything, and is
   * `readonly` so the array order — the API's own — cannot be rearranged here.
   */
  readonly charges = input<readonly LoanCharge[]>([]);

  /**
   * The loan the charges belong to: the `:id` of `#/loanaccountcharge/:id/:action/:chargeId`, and the
   * same record the section is rendered inside, so the two links cannot point at another loan.
   *
   * Typed for both because the id it names is a URL segment rather than a number in its own right:
   * the record passes the loan's numeric id, and a `:id` route parameter arrives as a string, so
   * either form segments into the same link without conversion.
   */
  readonly loanId = input.required<number | string>();

  /**
   * The permission the two charge actions are gated on. The record page passes `UPDATE_LOAN`, the
   * code `loans.routes.ts` guards `loanaccountcharge/:id/:action/:chargeId` with, so the directive
   * and the route guard cannot disagree about who may act (AAP 0.14.1, "Permissions are declared
   * once per route and once per action"). The record's own action group carries no value this
   * section shares: it gates each of its links on that step's own Fineract code.
   *
   * Legacy names finer codes for these operations — `CREATE_LOANCHARGE` to add a charge,
   * `PAY_LOANCHARGE` to pay one, `WAIVE_LOANCHARGE` to waive one — and they are not the code
   * `loanaccountcharge/:id/:action/:chargeId` guards, so gating a link on one of them would show a
   * user a link the route guard then refuses. The route's own write code is the one that keeps the
   * directive and the guard in step.
   */
  readonly actionPermission = input.required<string>();

  /**
   * The one date pattern the table displays, which the template passes to `DatePipe` for each parsed
   * row date (AAP 0.7.2 "Date handling"). A plain string rather than a signal: the pattern is fixed
   * for the application's lifetime, so the template reads it directly.
   */
  protected readonly displayFormat: string = DISPLAY_DATE_FORMAT;

  /**
   * The rows to render: every charge in the payload's order, with `dueDate` parsed for display and
   * every other field passed through untouched. Parsing is the only transformation — nothing is
   * sorted, filtered, summed or recalculated (Rule 1 clause 3).
   */
  protected readonly rows = computed<readonly ChargeRow[]>(() =>
    this.charges().map((charge) => ({
      ...charge,
      dueDate: fromFineractDate(charge.dueDate),
    })),
  );

  /**
   * Whether the loan carries no charges — the state in which the template renders the explicit empty
   * state instead of an empty table (AAP 0.7.4).
   */
  protected readonly isEmpty = computed<boolean>(() => this.rows().length === 0);
}
