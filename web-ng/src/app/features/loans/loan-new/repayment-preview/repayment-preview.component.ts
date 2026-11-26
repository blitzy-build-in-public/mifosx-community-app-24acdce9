import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

import { EmptyStateComponent } from '../../../../shared/empty-state/empty-state.component';
import { DISPLAY_DATE_FORMAT, fromFineractDate } from '../../../../shared/date-format.util';
import type { RepaymentPeriod, RepaymentSchedule } from '../../loan.models';

/**
 * A payment period as this table renders it: every member the payload's period carries, with the
 * two date members parsed once, in the `rows` projection below, into the local-midnight `Date` the
 * template formats. Derived from `RepaymentPeriod` rather than retyped, so the columns cannot drift
 * from the wire contract (AAP 0.7.2; Rule 1 clause 2).
 */
type RepaymentPreviewRow = Omit<RepaymentPeriod, 'fromDate' | 'dueDate'> & {
  readonly fromDate: Date | null;
  readonly dueDate: Date | null;
};

/**
 * Repayment schedule preview of the individual-loan application: the periods
 * `POST /loans?command=calculateLoanSchedule` returned, one table row each, in the order the
 * server sent them (AAP 0.7.1 Features row `loans` — "`LoanNewComponent` (with
 * `RepaymentPreviewComponent`)"; AAP 0.7.2 rows `RepaymentSchedule` / `RepaymentPeriod`; AAP 0.7.4
 * "`#/newclientloanaccount/:clientId` presents the product and terms fields from the loan template
 * with a 'Preview schedule' action that posts `calculateLoanSchedule` and renders the returned
 * periods as a table").
 *
 * Presentational and read-only. `loan.service.ts` owns `previewSchedule` and `loan-new` calls it
 * when the applicant asks for the preview, so this component issues no request, injects no
 * collaborator and holds no state that writes: it is the pure projection of the `schedule` its
 * parent passes, which is also why the preview cannot drift from the body `Submit` posts
 * (AAP 0.4.2, one direction of dependency `features` -> `shared`; Rule 1 clause 5).
 *
 * Every figure and every date is the server's own value (AAP 0.4.4 decision 6, behavioural
 * inheritance; Rule 1 clause 3). The array is read unchanged — no re-sorting, no reversal, no
 * filtering, no derived column and no computed total — because a client-side adjustment would
 * describe a schedule Fineract did not calculate. The one transformation here is the `rows`
 * projection, which parses each period's two response dates through the shared util once per
 * schedule change, so no timezone shift moves a due date onto another day and no wire date is
 * re-read on a change detection pass; display stays at `DISPLAY_DATE_FORMAT` (`dd MMMM yyyy`), the
 * pattern the legacy screens render in every language (AAP 0.7.2 "Date handling").
 *
 * The look is Bootstrap 3's table plus the legacy partials compiled into
 * `web-ng/src/styles.scss`, so this component declares no stylesheet, no inline style and no
 * colour (Rule 1 clause 6); an empty or absent schedule renders the shared explicit empty state
 * rather than an error (AAP 0.7.4 "States every list and record screen must implement").
 *
 * Open item: the template's translation keys are verified against the legacy
 * `app/global-translations` files at run time and belong to the template, so a key that must change
 * needs no change in this file.
 */
@Component({
  selector: 'app-repayment-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, TranslatePipe, EmptyStateComponent],
  templateUrl: './repayment-preview.component.html',
})
export class RepaymentPreviewComponent {
  /**
   * The schedule to render, as `POST /loans?command=calculateLoanSchedule` returned it, or `null`
   * before the applicant asks for the first preview.
   *
   * The default is `null` so the parent may bind its own signal from the moment the screen opens;
   * `isEmpty` then renders the empty state, which is the correct depiction of "no schedule has been
   * calculated yet" and not an error (AAP 0.7.4).
   */
  readonly schedule = input<RepaymentSchedule | null>(null);

  /**
   * The one pattern the table's date cells display, bound by the template as
   * `{{ row.dueDate | date: displayFormat }}` so a due date reads `21 November 2026`
   * rather than a locale-defaulted `DatePipe` format (AAP 0.7.2 "Date handling").
   */
  protected readonly displayFormat: string = DISPLAY_DATE_FORMAT;

  /**
   * The table's rows: the server's periods in the order the server returned them, each carrying the
   * period's own figures unchanged and both of its dates parsed here, once. The array order is
   * meaningful — it is the schedule's sequence — so nothing is sorted, filtered or recomputed
   * (Rule 1 clause 3), and an absent schedule yields no rows rather than `undefined`, so the
   * template always iterates something. Parsing inside the projection is what keeps the template
   * from re-reading a wire date on every change detection pass.
   */
  protected readonly rows = computed<readonly RepaymentPreviewRow[]>(() =>
    (this.schedule()?.periods ?? []).map((period) => ({
      ...period,
      fromDate: fromFineractDate(period.fromDate),
      dueDate: fromFineractDate(period.dueDate),
    })),
  );

  /**
   * `true` while no schedule has been calculated and after one that carried no periods, which is
   * what switches the template from the table to the shared empty state. Derived from `rows()`
   * rather than stored, so the two can never disagree.
   */
  protected readonly isEmpty = computed<boolean>(() => this.rows().length === 0);
}
