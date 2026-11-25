import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { DISPLAY_DATE_FORMAT, fromFineractDate } from '../../../../shared/date-format.util';
import { EmptyStateComponent } from '../../../../shared/empty-state/empty-state.component';
import type { LoanTransaction } from '../../loan.models';

/**
 * One rendered row of the loan record's transactions table: a transaction carrying Fineract's own
 * values, with its `date` parsed for display.
 *
 * Module-local and deliberately not exported, so no other file can come to depend on a
 * transformation that belongs to this component (AAP 0.7.2, AAP 0.14.2). `date` widens to
 * `Date | null` because `fromFineractDate` answers `null` for a value it cannot parse, and the
 * cell then renders empty instead of showing an invalid date.
 */
type TransactionRow = Omit<LoanTransaction, 'date'> & { readonly date: Date | null };

/**
 * Transactions section of the individual loan record (`#/viewloanaccount/:id`): the read-only
 * table of every transaction Fineract reported for the loan (AAP 0.7.1 row `loans`; AAP 0.7.2 row
 * `LoanTransaction`; AAP 0.7.4, whose list of surfaces requiring an explicit empty state includes
 * the loan view's transaction list).
 *
 * Presentational and read-only. It renders the `transactions` slice its parent already loaded
 * through `LoanService.get(id)` (`GET /loans/{id}?associations=all`, AAP 0.7.3 row "W6 repayment")
 * and issues no request of its own, so the record screen keeps making exactly the calls its typed
 * service owns (AAP 0.4.2; Rule 1 clause 2). It injects no collaborator, holds no state that it
 * writes, subscribes to nothing and handles no action: approving, disbursing, repaying and the
 * charge actions each belong to their own screen.
 *
 * What a row may and may not show, per Rule 1 clause 3 (match legacy, do not improve it):
 * - every transaction is rendered, in the order the API returned them — no sorting, filtering,
 *   paging, subtotal or recomputed balance;
 * - `type.value` is Fineract's own label and is rendered verbatim, never passed through
 *   `TranslatePipe`, because translating it would put words in the server's mouth;
 * - amounts go through `DecimalPipe`, the same grouping the legacy table's `number` filter applies;
 * - dates are parsed once by `fromFineractDate` into a local-midnight `Date` so no timezone shift
 *   moves a posting onto another day, and the template renders them through the shared
 *   `DISPLAY_DATE_FORMAT` pattern, the only display pattern the application has (AAP 0.7.2
 *   "Date handling").
 * This component therefore sets no `dateFormat` and no `locale`: serialising a date for a payload
 * is the service's job.
 *
 * Difference from legacy, reported rather than silently introduced: the legacy transactions tab
 * also carries transaction id and office columns, a penalty column, a sortable header, a default
 * "hide accrual transactions" filter and a `strikeoff` class on reversed rows. This section renders
 * the seven columns the loan model and this component's contract specify, so those extras are an
 * AAP 0.10.5 intentional-diff candidate for the plan owner; adding them here is out of this file's
 * scope, and no derived status text replaces them.
 *
 * The record's other sections — summary, repayment schedule and charges — are sibling components,
 * and the loan screens are outside the Figma flow, so the look comes entirely from the global
 * Bootstrap 3 classes in `web-ng/src/styles.scss`: this component declares no stylesheet, no inline
 * style and no colour (Rule 1 clause 6).
 */
@Component({
  selector: 'app-loan-transactions',
  imports: [DatePipe, DecimalPipe, TranslatePipe, EmptyStateComponent],
  templateUrl: './loan-transactions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanTransactionsComponent {
  /**
   * The loan's transactions from the parent's `GET /loans/{id}?associations=all` response
   * (AAP 0.7.3). The component issues no request: it only projects what it is handed.
   *
   * Defaults to an empty array so a loan with no transactions renders the empty state without the
   * parent having to pass anything, and is `readonly` so the array order — the API's own — cannot
   * be rearranged here.
   */
  readonly transactions = input<readonly LoanTransaction[]>([]);

  /**
   * The one date pattern the table displays, which the template passes to `DatePipe` for each
   * parsed row date (AAP 0.7.2 "Date handling"). A plain string rather than a signal: the pattern
   * is fixed for the application's lifetime, so the template reads it directly.
   */
  protected readonly displayFormat: string = DISPLAY_DATE_FORMAT;

  /**
   * The rows to render: every transaction in the payload's order, with `date` parsed for display
   * and every other field passed through untouched. Parsing is the only transformation — nothing is
   * sorted, filtered, summed or recalculated (Rule 1 clause 3).
   */
  protected readonly rows = computed<readonly TransactionRow[]>(() =>
    this.transactions().map((transaction) => ({
      ...transaction,
      date: fromFineractDate(transaction.date),
    })),
  );

  /**
   * Whether the loan has no transactions yet — the state in which the template renders the explicit
   * empty state instead of an empty table (AAP 0.7.4).
   */
  protected readonly isEmpty = computed<boolean>(() => this.rows().length === 0);
}
