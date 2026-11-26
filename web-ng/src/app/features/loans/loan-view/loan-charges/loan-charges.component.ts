import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { HasPermissionDirective } from '../../../../shared/has-permission.directive';
import { DISPLAY_DATE_FORMAT, fromFineractDate } from '../../../../shared/date-format.util';
import { EmptyStateComponent } from '../../../../shared/empty-state/empty-state.component';
import { MoneyPipe } from '../../../../shared/money/money.pipe';
// The loans feature keeps one model module at its root (`features/loans/loan.models.ts`), which is two levels above this section's folder.
import type { LoanCharge, LoanStatus } from '../../loan.models';

/** The fork's `LoanStatus.ACTIVE` value (`LoanStatus.java`, id 300): the one loan state in which the record offers either charge action. */
const ACTIVE_LOAN_STATUS_ID = 300;

/** The fork's `ChargeTimeType.DISBURSEMENT` value (`ChargeTimeType.java`, id 1): a charge that falls due at disbursement. */
const DISBURSEMENT_CHARGE_TIME_TYPE_ID = 1;

/** One rendered row of the record's charges table: a loan charge carrying Fineract's own values, with its `dueDate` parsed for display and the two eligibility decisions legacy makes per row (AAP 0.7.2, AAP 0.14.2, Rule 1 clause 3, AAP 0.10.5). */
type ChargeRow = Omit<LoanCharge, 'dueDate'> & {
  readonly dueDate: Date | null;

  /** Whether the row offers the waive action: legacy's `actionFlag`, inverted. */
  readonly canWaive: boolean;

  /** Whether the row offers the pay action: legacy's `chargePayable && status=='Active'`. */
  readonly canPay: boolean;
};

/** Charges section of the individual-loan record (`#/viewloanaccount/:id`): the read-only table of the charges the loan carries, with the two entry points that act on one of them (AAP 0.7.1 row `loans`, which names `LoanChargesComponent`; AAP 0.7.2, AAP 0.7.4, AAP 0.7.3, AAP 0.4.2). */
@Component({
  selector: 'app-loan-charges',
  imports: [DatePipe, MoneyPipe, RouterLink, TranslatePipe, EmptyStateComponent, HasPermissionDirective],
  templateUrl: './loan-charges.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanChargesComponent {
  /** The loan's charges, as the record's `charges` member reported them. */
  readonly charges = input<readonly LoanCharge[]>([]);

  /** The loan the charges belong to: the `:id` of `#/loanaccountcharge/:id/:action/:chargeId`, and the same record the section is rendered inside, so the two links cannot point at another loan. */
  readonly loanId = input.required<number | string>();

  /** The permission the two charge actions are gated on. The record page passes `UPDATE_LOAN`, the code `loans.routes.ts` guards `loanaccountcharge/:id/:action/:chargeId` with, so the directive and the route guard cannot disagree about who may act (AAP 0.14.1). */
  readonly actionPermission = input.required<string>();

  /** The loan's own lifecycle status, as the record's `status` member reported it — the state legacy tests before it offers either charge action, so a charge on a loan that is not `Active` offers neither (Rule 1 clause 3; `ViewLoanDetailsController.js:168-175`). */
  readonly loanStatus = input<LoanStatus | null>(null);

  /** The one date pattern the table displays, which the template passes to `DatePipe` for each parsed row date (AAP 0.7.2 "Date handling"). */
  protected readonly displayFormat: string = DISPLAY_DATE_FORMAT;

  /** The rows to render: every charge in the payload's order, with `dueDate` parsed for display, the two eligibility decisions legacy makes, and every other field passed through untouched (Rule 1 clause 3). */
  protected readonly rows = computed<readonly ChargeRow[]>(() => {
    // Legacy's own precondition: a loan that is not `Active` offers neither action, and a loan whose status the payload omitted is not known to be `Active`.
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

  /** Whether the loan carries no charges — the state in which the template renders the explicit empty state instead of an empty table (AAP 0.7.4). */
  protected readonly isEmpty = computed<boolean>(() => this.rows().length === 0);
}
