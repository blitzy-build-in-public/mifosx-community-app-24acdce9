import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

import { EmptyStateComponent } from '../../../../shared/empty-state/empty-state.component';
import {
  DISPLAY_DATE_FORMAT,
  fromFineractDate,
  type FineractDate,
} from '../../../../shared/date-format.util';
// `FineractDate` is read from the module that declares it, not from `loan.models`: the family's
// model module types `RepaymentPeriod.fromDate` and `dueDate` with the union but does not re-export
// it, and a second declaration of the same union is what the model module exists to prevent.
import type { RepaymentPeriod, RepaymentSchedule } from '../../loan.models';

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
 * describe a schedule Fineract did not calculate. The one transformation here is `toDate`, which
 * parses a response date through the shared util so no timezone shift moves a due date onto
 * another day; display stays at `DISPLAY_DATE_FORMAT` (`dd MMMM yyyy`), the pattern the legacy
 * screens render in every language (AAP 0.7.2 "Date handling").
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
   * `{{ toDate(period.dueDate) | date: displayFormat }}` so a due date reads `21 November 2026`
   * rather than a locale-defaulted `DatePipe` format (AAP 0.7.2 "Date handling").
   */
  protected readonly displayFormat: string = DISPLAY_DATE_FORMAT;

  /**
   * The server's periods, exactly as received: same members, same values, same order. The array
   * order is meaningful — it is the schedule's sequence — so nothing is sorted, filtered or
   * mapped (Rule 1 clause 3). An absent schedule yields an empty list rather than `undefined`, so
   * the template always iterates something.
   */
  protected readonly periods = computed<readonly RepaymentPeriod[]>(
    () => this.schedule()?.periods ?? [],
  );

  /**
   * `true` while no schedule has been calculated and after one that carried no periods, which is
   * what switches the template from the table to the shared empty state. Derived rather than
   * stored, so the two can never disagree.
   */
  protected readonly isEmpty = computed<boolean>(() => this.periods().length === 0);

  /**
   * Reads a period's `fromDate` or `dueDate` into the local-midnight `Date` the template formats.
   *
   * It exists as a member because a template expression reaches this component's members but not an
   * imported module function. The conversion itself is the shared `fromFineractDate` — the same
   * parser every screen uses — which is given the `FineractDate` shape `RepaymentPeriod` declares
   * and returns `null` for a value that names no calendar day; the null guard covers a payload that
   * omits the field at run time, and it is a guard, not a substituted date.
   */
  protected toDate(value: FineractDate | null | undefined): Date | null {
    return value == null ? null : fromFineractDate(value);
  }
}
