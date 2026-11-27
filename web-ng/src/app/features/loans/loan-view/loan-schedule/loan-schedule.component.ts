import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

// The loans feature keeps one model module at its root, two levels above this table's folder (Rule 1 clause 2).
import type { RepaymentPeriod, RepaymentSchedule } from '../../loan.models';
import { DISPLAY_DATE_FORMAT, fromFineractDate } from '../../../../shared/date-format.util';
import { EmptyStateComponent } from '../../../../shared/empty-state/empty-state.component';
import { MoneyPipe } from '../../../../shared/money/money.pipe';

/** A payment period as the table renders it: every member the payload's period carries, with the two date members parsed, derived from `RepaymentPeriod` so the columns cannot drift from the wire (AAP 0.7.2). */
type LoanScheduleRow = Omit<RepaymentPeriod, 'fromDate' | 'dueDate'> & {
  readonly fromDate: Date | null;
  readonly dueDate: Date | null;
};

/** Repayment-schedule section of the loan record: one row per period of the `repaymentSchedule` that `GET /loans/{id}?associations=all` returns, rendered as the server computed it (AAP 0.7.1, 0.7.4) (AAP 0.10.1, AAP 0.14.1). */
@Component({
  selector: 'app-loan-schedule',
  imports: [DatePipe, MoneyPipe, TranslatePipe, EmptyStateComponent],
  templateUrl: './loan-schedule.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanScheduleComponent {
  /** The record payload's `repaymentSchedule`; optional and nullable because the record page passes it before the loan has loaded. */
  readonly schedule = input<RepaymentSchedule | null>(null);

  /** The one date pattern the application shows and sends, from the shared constant so this table cannot introduce a second format (AAP 0.7.2). */
  protected readonly displayFormat = DISPLAY_DATE_FORMAT;

  /** The rows: the server's periods in its own order, both dates parsed once here so no Fineract date shape reaches the template (AAP 0.14.1). */
  protected readonly rows = computed<readonly LoanScheduleRow[]>(() =>
    (this.schedule()?.periods ?? []).map((period) => ({
      ...period,
      fromDate: fromFineractDate(period.fromDate),
      dueDate: fromFineractDate(period.dueDate),
    })),
  );
}
