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

import { EmptyStateComponent } from '../../../../shared/empty-state/empty-state.component';
import {
  StatusSwatchComponent,
  type StatusKey,
} from '../../../../shared/status-swatch/status-swatch.component';
import { toClientStatusKey, type ClientAccountSummary } from '../../client.models';
import { ClientService } from '../../client.service';

/**
 * One rendered row of the client record's accounts table (AAP 0.7.2 rows
 * `ClientLoanAccountSummary` and `ClientSavingsAccountSummary`): the four columns the section
 * paints, with the status already reduced to the indicator's own key.
 *
 * Module-local to this feature but exported, so the paired spec types its expectations against
 * the same declaration instead of restating the members. `balance` is `number | null` rather than
 * `number`, because each Fineract account family names its figure differently and either may be
 * absent: a row that has no figure shows an empty cell, never a fabricated zero (Rule 1 clause 3).
 */
export interface AccountRow {
  /** Account id: the `:id` a loan or savings record route would take. Carried through, never shown. */
  readonly id: number;

  /** Account number as Fineract formatted it, printed verbatim in the Account column. */
  readonly accountNo: string;

  /** Product name the account was opened under, printed verbatim in the Product column. */
  readonly productName: string;

  /** Status reduced to the indicator's key by `toClientStatusKey`; painted as a colour swatch. */
  readonly status: StatusKey;

  /** The family's own balance figure — `loanBalance` for a loan, `accountBalance` for savings. */
  readonly balance: number | null;
}

/**
 * The accounts section of the individual client record's `General` tab: a read-only table of the
 * client's loan and savings accounts (AAP 0.7.1 Features row `clients` — `ClientViewComponent`
 * with `ClientAccountsComponent`; AAP 0.7.4 `#/viewclient/:id`).
 *
 * **What it loads, and from where.** Exactly one call, `ClientService.accounts(clientId)`, which
 * is `GET /clients/{id}/accounts` (AAP 0.7.3 row "W3 search and view client", legacy
 * `clientAccountResource`). This file holds no URL, no HTTP method, no query parameter and no
 * request body: the family's single typed service owns the endpoint (Rule 1 clause 5), it is the
 * only collaborator injected here, and the response arrives already typed as
 * `ClientAccountSummary`.
 *
 * **Inert by design.** The section offers no action, no link, no chevron and no hover
 * affordance: opening an account, repaying it, approving it and transferring funds each belong to
 * the loans and savings screens, which are separate migration units. It also sorts nothing,
 * filters nothing, pages nothing and derives no total — the rows are rendered in the order the
 * endpoint returned them, loans first and then savings (Rule 1 clause 3; AAP 0.10.5). The status
 * column is a colour swatch and never a word — neither `StatusKey`'s mapping nor the server's
 * English `status.value` reaches the screen as text — which is the deliberate difference the plan
 * registers for every status indicator in this application (AAP 0.10.5 item 11).
 *
 * **Visual contract.** Every value this section produces — the white `.panel` with its shadow,
 * the `.table` header band and row rules, the 8px cell padding, the body type and the status
 * colours — comes from the global classes of `web-ng/src/styles.scss`, so this component declares
 * no stylesheet, no inline style and no colour of its own (Rule 1 clause 6, AAP 0.4.4 decision 4).
 * Figma file `DKm5TBFbXypfqyx4xUdhBw`, screen `1:4` (step 3 of "Sign in and open a client
 * record"), paints the section's `ACCOUNTS` heading and the top edge of its panel but no table
 * beneath them, so the flow's inherited global values are the whole specification for the rows.
 *
 * **States.** While the first response is in flight nothing but the section renders
 * (`loading`); an empty result — a client holding no accounts at all, which the endpoint answers
 * without either collection — renders the explicit empty state and no error (`isEmpty`); a
 * failure leaves the same explicit empty state on screen with the entered route intact, because
 * the interceptor has already raised the notification for the 5xx or network error (AAP 0.7.4:
 * "an explicit empty state and no error"). Nothing is logged: no client id, no account number and
 * no payload reaches the console (Rule 1 clause 9).
 */
@Component({
  selector: 'app-client-accounts',
  imports: [TranslatePipe, StatusSwatchComponent, EmptyStateComponent],
  templateUrl: './client-accounts.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientAccountsComponent {
  /**
   * The clients family's one typed service, injected as the component's single collaborator so
   * the component never reaches Fineract directly (AAP 0.14.1; Rule 1 clause 5).
   */
  private readonly client = inject(ClientService);

  /**
   * Id of the client whose accounts are shown: the `:id` of `#/viewclient/:id`, as the route
   * hands it over. `string` is admitted as well as `number` because a route parameter arrives as
   * text, and the service accepts either.
   *
   * A signal input, so a record navigated to another client re-loads instead of showing the
   * previous client's accounts. Reading it is the only thing any caller has to do.
   */
  readonly clientId = input.required<number | string>();

  /**
   * The rows to render: the client's loans followed by its savings accounts, in the endpoint's
   * own order, each with its status reduced to the indicator's key. Empty until the first
   * response arrives, and empty again when the client holds no accounts or the load failed.
   */
  readonly rows = signal<readonly AccountRow[]>([]);

  /**
   * Whether a response is outstanding. Starts `true` so the empty state cannot flash before the
   * first response has been read — a client that does have accounts would otherwise show "no
   * accounts" for one frame.
   */
  readonly loading = signal(true);

  /**
   * Whether the last load failed. The section then renders its explicit empty state rather than
   * an error of its own: the interceptor has already mapped the failure and raised the
   * notification, and re-reporting it here would show the same problem twice (AAP 0.7.4).
   */
  readonly failed = signal(false);

  /**
   * Whether there is nothing to list — either because the client holds no accounts or because
   * the load failed. The template decides between the table and the empty state from this, with
   * `loading` guarding the frame before the first response.
   */
  protected readonly isEmpty = computed<boolean>(() => this.rows().length === 0);

  /**
   * Translation key of the empty state's message, resolved in the template through
   * `TranslatePipe`. A key rather than a sentence: `EmptyStateComponent` takes already-translated
   * text, and the wording belongs to the legacy bundle in `app/global-translations/`, which
   * `label.nodata` ("No Data") already carries (Rule 1 clause 6).
   */
  protected readonly emptyMessageKey = 'label.nodata';

  /**
   * The client ids to load, one emission per id the input takes. A `Subject` rather than a
   * plain call because the id is a signal input: it is bound by the parent after this component
   * is constructed, so its first value can only be observed inside an effect.
   */
  private readonly clientIdChanges = new Subject<number | string>();

  constructor() {
    // The effect's only job is to hand the current id to the stream below. It writes no signal,
    // so it can neither loop nor be skipped: reading `clientId()` here is what registers the
    // input as its dependency, so a record opened for another client emits again.
    effect(() => this.clientIdChanges.next(this.clientId()));

    this.clientIdChanges
      .pipe(
        // `switchMap`, never `mergeMap` or `concatMap`: navigating from one client record to
        // another must abandon the first client's request, so a slow earlier response can never
        // overwrite the accounts of the record now on screen.
        switchMap((id) => {
          this.loading.set(true);
          this.failed.set(false);

          return this.client.accounts(id).pipe(
            map((summary) => this.toRows(summary)),
            // A failed load becomes an empty result plus the `failed` flag: the section then
            // shows its empty state while the interceptor's notification carries Fineract's own
            // message, so the screen stays usable and no error is reported twice.
            catchError(() => {
              this.failed.set(true);
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

  /**
   * Projects the endpoint's two account families into the one row list the table renders.
   *
   * Loans come first and savings second, each in the order the endpoint returned them, so the
   * table's order is deterministic and no sort, filter or regrouping happens here (Rule 1 clause
   * 3). A family the response omits contributes no row rather than an error, which is why both
   * collections are optional in `ClientAccountSummary`: the endpoint leaves out a key instead of
   * sending an empty array.
   *
   * The balance is each family's own figure (`loanBalance` for a loan, `accountBalance` for
   * savings) and becomes `null` when it is absent, so the cell renders empty instead of a zero
   * the server never reported.
   *
   * The status code is reduced by this family's single mapping, `toClientStatusKey`, and never by
   * stripping a prefix here: one table decides every status colour in the clients feature. An
   * account status carries its own family's code (`loanStatusType.active`,
   * `savingsAccountStatusType.active`), which that table does not claim, so such a row paints the
   * indicator's neutral colour (`other`) rather than guessing a state — a colour this build cannot
   * vouch for is worse than a neutral one, and the unrecognised result is `other`, never `active`.
   * Colouring account-level states would mean either importing another family's mapping, which the
   * module's dependency boundary excludes, or a second table inside the clients feature, which is
   * exactly the duplicate verdict this arrangement avoids.
   *
   * @param summary the `GET /clients/{id}/accounts` response for the client now on screen.
   * @returns one row per loan account followed by one per savings account.
   */
  private toRows(summary: ClientAccountSummary): readonly AccountRow[] {
    const loanRows: readonly AccountRow[] = (summary.loanAccounts ?? []).map((account) => ({
      id: account.id,
      accountNo: account.accountNo,
      productName: account.productName,
      status: toClientStatusKey(account.status?.code),
      balance: account.loanBalance ?? null,
    }));

    const savingsRows: readonly AccountRow[] = (summary.savingsAccounts ?? []).map((account) => ({
      id: account.id,
      accountNo: account.accountNo,
      productName: account.productName,
      status: toClientStatusKey(account.status?.code),
      balance: account.accountBalance ?? null,
    }));

    return [...loanRows, ...savingsRows];
  }
}
