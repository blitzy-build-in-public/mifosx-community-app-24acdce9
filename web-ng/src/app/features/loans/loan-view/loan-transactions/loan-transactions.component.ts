import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { DISPLAY_DATE_FORMAT, fromFineractDate } from '../../../../shared/date-format.util';
import { EmptyStateComponent } from '../../../../shared/empty-state/empty-state.component';
import type { LoanTransaction } from '../../loan.models';

/** One rendered row: a transaction's own values with `date` parsed. `Date | null` because `fromFineractDate` answers `null` for a value it cannot parse, so the cell renders empty. */
type TransactionRow = Omit<LoanTransaction, 'date'> & { readonly date: Date | null };

/** Transactions section of the loan record (`#/viewloanaccount/:id`): the read-only table of the `transactions` the parent's `GET /loans/{id}?associations=all` already loaded — no request, no collaborator, no written state (AAP 0.7.1, AAP 0.7.2, AAP 0.10.5). */
@Component({
  selector: 'app-loan-transactions',
  imports: [DatePipe, DecimalPipe, TranslatePipe, EmptyStateComponent],
  templateUrl: './loan-transactions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanTransactionsComponent {
  /** The loan's `transactions` from the parent's `GET /loans/{id}?associations=all`; defaults to empty so a loan with none renders the empty state, and `readonly` so the API's order cannot be rearranged here (AAP 0.7.3, 0.7.4). */
  readonly transactions = input<readonly LoanTransaction[]>([]);

  /** The one date pattern the template passes to `DatePipe` for each parsed row date (AAP 0.7.2 "Date handling"). */
  protected readonly displayFormat: string = DISPLAY_DATE_FORMAT;

  /** The rows: every transaction in the payload's order with `date` parsed and everything else untouched — nothing sorted, filtered, summed or recalculated (Rule 1 clause 3). */
  protected readonly rows = computed<readonly TransactionRow[]>(() =>
    this.transactions().map((transaction) => ({
      ...transaction,
      date: fromFineractDate(transaction.date),
    })),
  );

  /** Whether the loan has no transactions, the state in which the template renders the explicit empty state (AAP 0.7.4). */
  protected readonly isEmpty = computed<boolean>(() => this.rows().length === 0);
}
