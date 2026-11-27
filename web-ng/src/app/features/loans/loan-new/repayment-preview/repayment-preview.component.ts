import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

import { EmptyStateComponent } from '../../../../shared/empty-state/empty-state.component';
import { MoneyPipe } from '../../../../shared/money/money.pipe';
import { DISPLAY_DATE_FORMAT, fromFineractDate } from '../../../../shared/date-format.util';
import type { RepaymentPeriod, RepaymentSchedule } from '../../loan.models';

/** A payment period as this table renders it: every member the payload's period carries, with the two date members parsed once, in the `rows` projection below, into the local-midnight `Date` the template formats (AAP 0.7.2, Rule 1 clause 2). */
type RepaymentPreviewRow = Omit<RepaymentPeriod, 'fromDate' | 'dueDate'> & {
  readonly fromDate: Date | null;
  readonly dueDate: Date | null;
};

/** Repayment schedule preview of the individual-loan application: the periods `POST /loans?command=calculateLoanSchedule` returned, one table row each, in the order the server sent them (AAP 0.7.1 Features row `loans`, which names `LoanNewComponent` with `RepaymentPreviewComponent`; AAP 0.7.2, AAP 0.7.4, AAP 0.4.2, Rule 1 clause 5). */
@Component({
  selector: 'app-repayment-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MoneyPipe, TranslatePipe, EmptyStateComponent],
  templateUrl: './repayment-preview.component.html',
})
export class RepaymentPreviewComponent {
  /** The schedule to render, as `POST /loans?command=calculateLoanSchedule` returned it, or `null` before the applicant asks for the first preview (AAP 0.7.4). */
  readonly schedule = input<RepaymentSchedule | null>(null);

  /** The one pattern the table's date cells display, bound by the template as `{{ row.dueDate | date: displayFormat }}` so a due date reads `21 November 2026` rather than a locale-defaulted `DatePipe` format (AAP 0.7.2 "Date handling"). */
  protected readonly displayFormat: string = DISPLAY_DATE_FORMAT;

  /** The table's rows: the server's periods in the order the server returned them, each carrying the period's own figures unchanged and both of its dates parsed here, once (Rule 1 clause 3). */
  protected readonly rows = computed<readonly RepaymentPreviewRow[]>(() =>
    (this.schedule()?.periods ?? []).map((period) => ({
      ...period,
      fromDate: fromFineractDate(period.fromDate),
      dueDate: fromFineractDate(period.dueDate),
    })),
  );

  /** `true` while no schedule has been calculated and after one that carried no periods, which is what switches the template from the table to the shared empty state. */
  protected readonly isEmpty = computed<boolean>(() => this.rows().length === 0);
}
