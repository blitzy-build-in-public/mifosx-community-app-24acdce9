import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

// The loans feature keeps one model module at its root (`features/loans/loan.models.ts`), which is
// two levels above this table's folder.
import type { RepaymentPeriod, RepaymentSchedule } from '../../loan.models';
import { DISPLAY_DATE_FORMAT, fromFineractDate } from '../../../../shared/date-format.util';
import { EmptyStateComponent } from '../../../../shared/empty-state/empty-state.component';

/**
 * A payment period as the table renders it: every member the payload's period carries, with the
 * two date members parsed. Derived from `RepaymentPeriod` rather than retyped, so the columns
 * cannot drift from the wire contract (AAP 0.7.2; Rule 1 clause 2).
 */
type LoanScheduleRow = Omit<RepaymentPeriod, 'fromDate' | 'dueDate'> & {
  readonly fromDate: Date | null;
  readonly dueDate: Date | null;
};

/**
 * The repayment-schedule section of the individual-loan record page: one row per period of the
 * `repaymentSchedule` that `GET /loans/{id}?associations=all` returns (AAP 0.7.1, 0.7.4).
 *
 * It renders the payload's own values and nothing else. No figure is recomputed, rounded, summed,
 * sorted, filtered, totalled or dressed with a status word, and no column is added, because the
 * schedule states what the server computed (Rule 1 clause 3). This table is the only consumer of that
 * payload's periods: the repayment screen issues no record read at all and seeds its amount from its
 * own transactions template, so nothing here feeds workflow W6. Nor may anything here be read as that
 * default — the first row is Fineract's disbursement pseudo-period, which carries no period number and
 * a `totalDueForPeriod` of 0.00, while the template's amount is the next period's total due
 * (AAP 0.10.1; AAP 0.7.3 row "W6 repayment").
 *
 * Read-only and self-contained: it issues no request, injects no service, holds no state and reads
 * no clock — the record page fetched the schedule and this component only displays it (AAP 0.14.1).
 * The look comes from the global Bootstrap 3 layer of `web-ng/src/styles.scss`, so the component
 * declares no styles of its own (Rule 1 clause 6; AAP 0.4.4 decision 4).
 */
@Component({
  selector: 'app-loan-schedule',
  imports: [DatePipe, DecimalPipe, TranslatePipe, EmptyStateComponent],
  templateUrl: './loan-schedule.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanScheduleComponent {
  /**
   * The loan's repayment schedule — `repaymentSchedule` of the record payload. Optional and
   * nullable because the record page passes it before the loan has loaded, and an absent schedule
   * renders no rows.
   */
  readonly schedule = input<RepaymentSchedule | null>(null);

  /**
   * The one date pattern the application shows and sends, taken from the shared constant so this
   * table cannot introduce a second format (AAP 0.7.2; Rule 1 clause 2).
   */
  protected readonly displayFormat = DISPLAY_DATE_FORMAT;

  /**
   * The table's rows: the periods in the order the server returned them, with both dates parsed
   * once here so no Fineract date shape reaches the template and each date cell pipes a real
   * `Date` (AAP 0.14.1).
   */
  protected readonly rows = computed<readonly LoanScheduleRow[]>(() =>
    (this.schedule()?.periods ?? []).map((period) => ({
      ...period,
      fromDate: fromFineractDate(period.fromDate),
      dueDate: fromFineractDate(period.dueDate),
    })),
  );
}
