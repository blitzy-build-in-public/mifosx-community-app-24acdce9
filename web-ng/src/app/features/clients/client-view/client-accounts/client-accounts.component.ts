import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, catchError, map, of, switchMap } from 'rxjs';

import { ApiError } from '../../../../core/http/api-error';
import { EmptyStateComponent } from '../../../../shared/empty-state/empty-state.component';
import type { StatusKey } from '../../../../shared/status-key.util';
import { StatusSwatchComponent } from '../../../../shared/status-swatch/status-swatch.component';
import { toAccountStatusKey, type ClientAccountSummary } from '../../client.models';
import { ClientService } from '../../client.service';

/** One rendered row of the record's accounts table (AAP 0.7.2), exported so the paired spec types its expectations against it; `balance` stays `number | null` so a row with no figure shows an empty cell rather than a zero. */
export interface AccountRow {
  /** Account id: the `:id` a loan or savings record route would take. Carried through, never shown. */
  readonly id: number;
  /** Account number as Fineract formatted it, printed verbatim in the Account column. */
  readonly accountNo: string;
  /** Product name the account was opened under, printed verbatim in the Product column. */
  readonly productName: string;
  /** Status reduced to the indicator's key by `toAccountStatusKey`; painted as a colour swatch. */
  readonly status: StatusKey;
  /** The family's own balance figure — `loanBalance` for a loan, `accountBalance` for savings. */
  readonly balance: number | null;
}

/** The `General` tab's read-only accounts table: one `ClientService.accounts` call, `GET /clients/{id}/accounts`, rendered in the endpoint's order with the status as a swatch and every style from the global sheet (AAP 0.7.4; Rule 1 clause 6). */
@Component({
  selector: 'app-client-accounts',
  imports: [DecimalPipe, TranslatePipe, StatusSwatchComponent, EmptyStateComponent],
  templateUrl: './client-accounts.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientAccountsComponent {
  /** The clients family's one typed service, the component's single collaborator, so it never reaches Fineract directly (AAP 0.14.1; Rule 1 clause 5). */
  private readonly client = inject(ClientService);
  /** Id of the client whose accounts are shown, the `:id` of `#/viewclient/:id`; `string` is admitted because a route parameter arrives as text. A signal input, so navigating to another client re-loads. */
  readonly clientId = input.required<number | string>();
  /** The rows to render: loans then savings in the endpoint's own order; empty until the first response and after a failed one. */
  readonly rows = signal<readonly AccountRow[]>([]);

  /** Whether a response is outstanding. Starts `true` so the empty state cannot flash before the first response is read. */
  readonly loading = signal(true);

  /** Whether the last load failed: with {@link errorMessage} empty this says a 5xx or transport fault arrived that the interceptor has already notified, so no "no accounts" claim is made (AAP 0.7.4). */
  readonly failed = signal(false);

  /** Fineract's own failure text for a 4xx, or `null`: the interceptor notifies for status `0` and `>= 500` alone, so rendering those here too would report one problem twice (AAP 0.7.4; Rule 1 clause 9 — nothing is logged). */
  readonly errorMessage = signal<string | null>(null);

  /** Whether a completed, successful read found no account at all, which is what chooses the table or the empty state. */
  protected readonly isEmpty = computed<boolean>(() => this.rows().length === 0);

  /** Translation key of the empty state's message, resolved through `TranslatePipe`: the wording belongs to the legacy bundle's `label.nodata` (Rule 1 clause 6). */
  protected readonly emptyMessageKey = 'label.nodata';

  /** The client ids to load, one emission per id: a `Subject` because the signal input is bound after construction, so its first value can only be observed inside an effect. */
  private readonly clientIdChanges = new Subject<number | string>();

  constructor() {
    // Reading `clientId()` registers the input as the effect's dependency, so a record opened for another client emits again; the effect writes no signal, so it cannot loop.
    effect(() => this.clientIdChanges.next(this.clientId()));

    this.clientIdChanges
      .pipe(
        // `switchMap`, never `mergeMap` or `concatMap`: navigating to another record must abandon the first client's request, so a slow earlier response cannot overwrite the accounts on screen.
        switchMap((id) => {
          this.loading.set(true);
          this.failed.set(false);
          this.errorMessage.set(null);

          return this.client.accounts(id).pipe(
            map((summary) => this.toRows(summary)),
            // Handled inside the inner observable so the outer subscription survives and a later client still loads: a 4xx publishes Fineract's text, a 5xx or transport fault stays `null`.
            catchError((error: unknown) => {
              this.failed.set(true);
              this.errorMessage.set(
                error instanceof ApiError && error.status >= 400 && error.status < 500
                  ? error.message
                  : null,
              );

              return of<readonly AccountRow[]>([]);
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      });
  }

  /** Projects the endpoint's two account families into one row list: loans first, savings second, each in the order returned, with an omitted family contributing no row (Rule 1 clause 3). */
  private toRows(summary: ClientAccountSummary): readonly AccountRow[] {
    const loanRows: readonly AccountRow[] = (summary.loanAccounts ?? []).map((account) => ({
      id: account.id,
      accountNo: account.accountNo,
      productName: account.productName,
      status: toAccountStatusKey(account.status?.code),
      balance: account.loanBalance ?? null,
    }));

    const savingsRows: readonly AccountRow[] = (summary.savingsAccounts ?? []).map((account) => ({
      id: account.id,
      accountNo: account.accountNo,
      productName: account.productName,
      status: toAccountStatusKey(account.status?.code),
      balance: account.accountBalance ?? null,
    }));

    return [...loanRows, ...savingsRows];
  }
}
