import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { HasPermissionDirective } from '../../../../shared/has-permission.directive';
import { DISPLAY_DATE_FORMAT, fromFineractDate } from '../../../../shared/date-format.util';
import { EmptyStateComponent } from '../../../../shared/empty-state/empty-state.component';
// The loans feature keeps one model module at its root (`features/loans/loan.models.ts`), which is
// two levels above this section's folder.
import type { LoanCharge, LoanStatus } from '../../loan.models';

/**
 * The fork's `LoanStatus.ACTIVE` value (`LoanStatus.java`, id 300): the one loan state in which the
 * record offers either charge action.
 *
 * Legacy tests `loan.status.value != 'Active'` before it shows a charge's actions, so a charge on a
 * loan in any other state offers neither of them
 * (`app/scripts/controllers/loanAccount/ViewLoanDetailsController.js:168-175`).
 */
const ACTIVE_LOAN_STATUS_ID = 300;

/**
 * The fork's `ChargeTimeType.DISBURSEMENT` value (`ChargeTimeType.java`, id 1): a charge that falls
 * due at disbursement.
 *
 * Legacy treats such a charge as settled for the purposes of the waive action — its `actionFlag` is
 * set by `charge.chargeTimeType.value == 'Disbursement'` — so the record never offers to waive it.
 * The numeric id decides, exactly as it does in the fork's own `ChargeTimeType.fromInt`, rather than
 * the display text, which is translated.
 */
const DISBURSEMENT_CHARGE_TIME_TYPE_ID = 1;

/**
 * One rendered row of the record's charges table: a loan charge carrying Fineract's own values, with
 * its `dueDate` parsed for display and the two eligibility decisions legacy makes per row.
 *
 * Module-local and deliberately not exported, so no other file can come to depend on a
 * transformation that belongs to this component (AAP 0.7.2, AAP 0.14.2). `dueDate` widens to
 * `Date | null` because `fromFineractDate` answers `null` for a value it cannot parse, and for a
 * charge that falls due on disbursement and carries no date at all; the cell then renders empty
 * instead of showing an invalid date.
 *
 * `canWaive` and `canPay` are legacy's own per-row rule, reproduced (Rule 1 clause 3; AAP 0.10.5
 * registers no difference for it): the record's controller sets a charge `actionFlag` when it is paid
 * or waived, falls due on disbursement, or belongs to a loan that is not `Active`
 * (`ViewLoanDetailsController.js:168-175`); the template hides the waive link on that flag
 * (`app/views/loans/viewloanaccountdetails.html:865`) and shows the pay link only for
 * `charge.chargePayable && status=='Active'` (`:868`). Both are read from the payload's own flags —
 * the fork's `isChargePayable()` already folds in "account transfer, not paid, not waived" — so no
 * amount is compared here.
 */
type ChargeRow = Omit<LoanCharge, 'dueDate'> & {
  readonly dueDate: Date | null;

  /** Whether the row offers the waive action: legacy's `actionFlag`, inverted. */
  readonly canWaive: boolean;

  /** Whether the row offers the pay action: legacy's `chargePayable && status=='Active'`. */
  readonly canPay: boolean;
};

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
 * Legacy decides per row there, and this section reproduces that rule rather than leaving a step's
 * legality to the server alone: the record's controller marks a charge `actionFlag` when it is paid
 * or waived, falls due on disbursement, or belongs to a loan that is not `Active`
 * (`ViewLoanDetailsController.js:168-175`), the template hides the waive link on that flag (`:865`),
 * and it shows the pay link only for a payable charge on an active loan (`:868`). {@link ChargeRow}
 * carries the two decisions as `canWaive` and `canPay`, worked out once per row by {@link rows}, and
 * the template hides — never removes — the ineligible link with Bootstrap's global `.hidden` utility,
 * so this rule and the permission gate stay two independent conditions on the same anchor.
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
   * The loan's own lifecycle status, as the record's `status` member reported it — the state legacy
   * tests before it offers either charge action, so a charge on a loan that is not `Active` offers
   * neither (Rule 1 clause 3; `ViewLoanDetailsController.js:168-175`).
   *
   * Typed {@link LoanStatus} rather than the raw payload because the row rule reads one thing from
   * it, the numeric id the fork's `LoanStatus.ACTIVE` names. Defaults to `null`, the state a record
   * that reported no status leaves: no loan is `Active` then, so no action is offered, which is the
   * conservative reading legacy takes when its two conditions match neither.
   */
  readonly loanStatus = input<LoanStatus | null>(null);

  /**
   * The one date pattern the table displays, which the template passes to `DatePipe` for each parsed
   * row date (AAP 0.7.2 "Date handling"). A plain string rather than a signal: the pattern is fixed
   * for the application's lifetime, so the template reads it directly.
   */
  protected readonly displayFormat: string = DISPLAY_DATE_FORMAT;

  /**
   * The rows to render: every charge in the payload's order, with `dueDate` parsed for display, the
   * two eligibility decisions legacy makes, and every other field passed through untouched. Parsing
   * and those two decisions are the only transformations — nothing is sorted, filtered, summed or
   * recalculated (Rule 1 clause 3).
   */
  protected readonly rows = computed<readonly ChargeRow[]>(() => {
    // Legacy's own precondition: a loan that is not `Active` offers neither action, and a loan whose
    // status the payload omitted is not known to be `Active`.
    const loanActive = this.loanStatus()?.id === ACTIVE_LOAN_STATUS_ID;

    return this.charges().map((charge) => ({
      ...charge,
      dueDate: fromFineractDate(charge.dueDate),
      canWaive:
        loanActive &&
        !charge.paid &&
        !charge.waived &&
        charge.chargeTimeType.id !== DISBURSEMENT_CHARGE_TIME_TYPE_ID,
      canPay: loanActive && charge.chargePayable,
    }));
  });

  /**
   * Whether the loan carries no charges — the state in which the template renders the explicit empty
   * state instead of an empty table (AAP 0.7.4).
   */
  protected readonly isEmpty = computed<boolean>(() => this.rows().length === 0);
}
