import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, type ParamMap } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { ApiError, screenFailure, toDisplayableFailure } from '../../../core/http/api-error';
import { DISPLAY_DATE_FORMAT, fromFineractDate } from '../../../shared/date-format.util';
import { EmptyStateComponent } from '../../../shared/empty-state/empty-state.component';
import { HasPermissionDirective } from '../../../shared/has-permission.directive';
import type { StatusKey } from '../../../shared/status-key.util';
import { StatusSwatchComponent } from '../../../shared/status-swatch/status-swatch.component';
import { toSavingsStatusKey, type SavingsAccount } from '../savings.models';
import { SavingsService } from '../savings.service';

/**
 * One rendered row of the record page's transactions table: a `SavingsTransaction` reduced to the
 * four values the table paints, with its date parsed for display.
 *
 * Exported so the paired spec types its expectations against this declaration instead of restating
 * the members. `date` widens to `Date | null` because `fromFineractDate` answers `null` for a value
 * it cannot parse, and the cell then renders empty rather than an invalid date; `balance` widens to
 * `number | null` because the server includes `runningBalance` only for some transaction types, and a
 * row that carries none shows an empty cell instead of a zero the server never reported (Rule 1
 * clause 3). Every member is `readonly`: a row is a projection of the response, never edited in place.
 */
export interface SavingsTransactionRow {
  /** Transaction identifier, carried through from the payload; never shown as a column of its own. */
  readonly id: number;

  /** The transaction's date, parsed to local midnight for display, or `null` when unparseable. */
  readonly date: Date | null;

  /** The row's own transaction type text (`transactionType.value`), rendered verbatim. */
  readonly type: string;

  /** The amount the server reported for the transaction, as its own number — never recomputed. */
  readonly amount: number;

  /** Balance after the transaction when the server included it, `null` otherwise. */
  readonly balance: number | null;
}

/**
 * The record page of a savings account (`#/viewsavingaccount/:id`), the last screen of workflow W8:
 * open an account, approve it, activate it, deposit 1,000, withdraw 200, and read the record back
 * (AAP 0.9.1 scope group 4, AAP 0.10.1 W8 row, AAP 0.7.1 Features row `savings`).
 *
 * **One request, owned by the family's service.** The page issues exactly one call,
 * `SavingsService.get(id)` — `GET /savingsaccounts/{id}?associations=all` (AAP 0.7.3 "W8 savings
 * (Stretch)") — which carries the status, the three balance figures and the transaction list
 * together. This file holds no URL, host, port, API path, HTTP method, query parameter or body:
 * `SavingsService` composes the request through `AppConfigService.apiUrl()` and is the only HTTP
 * holder in this feature (Rule 1 clause 5; Rule 2). Nothing here reads a business date either — that
 * belongs to the harness (AAP 0.10.5 item 15).
 *
 * **Four states, and who owns each.** While the read is outstanding `loading` is true and no
 * half-built record is painted. A loaded record renders the summary and the transaction rows.
 * A 404 — or a route that carries no id, in which case no request is issued at all — drives
 * `notFound`, which the template renders **in place of the record**, leaving the shell usable
 * (AAP 0.7.4). Any other 4xx drives `clientError`, the Fineract message shown verbatim with the
 * screen still usable; a 5xx or transport failure leaves both computeds null, because the single
 * interceptor has already raised exactly one notification for it, and a second copy here would
 * report the same problem twice (AAP 0.4.2, AAP 0.7.4). This component therefore never calls
 * `NotificationService`, never logs and never rethrows.
 *
 * **Action gating.** Every action on the record is behind `actionPermission`
 * (`READ_SAVINGSACCOUNT`), applied in the template through `HasPermissionDirective`. The plan
 * supplies only `READ_SAVINGSACCOUNT` and `CREATE_SAVINGSACCOUNT` for this family: there is
 * deliberately no update-scoped permission and no per-action code, and no action may be left
 * ungated. Which lifecycle step is legal is the server's decision, not this screen's, so no action
 * is enabled, disabled or reordered by the account's status (Rule 1 clause 3).
 *
 * **Two deviations from the folder brief, both stated here so a reader does not take them for
 * omissions.** `Router` and `TranslateService` are not injected: every navigation on this screen is
 * a permission-gated `routerLink`, never a programmatic `navigate`, and every string is resolved in
 * the template by `TranslatePipe`, which reaches `TranslateService` through DI itself — either
 * injection would be a dead field. The status mapper is `toSavingsStatusKey`, the name
 * `savings.models.ts` actually exports (the brief's `toStatusKey` exists nowhere in this
 * repository), so the Fineract status code never reaches the swatch component. Relative imports
 * climb three levels to `core/` and `shared/`, which is what this folder's depth requires.
 *
 * The look comes entirely from the global Bootstrap 3 classes of `web-ng/src/styles.scss` — this
 * component declares no stylesheet, no inline style and no colour (Rule 1 clause 6) — and the
 * status indicator is the existing `StatusSwatchComponent`, which paints a colour and never a word
 * (AAP 0.10.5 deliberate difference 11).
 *
 * **One id, one load per navigation.** `:id` is read from `route.paramMap`, never from the snapshot:
 * the router reuses this component when the URL moves from one `#/viewsavingaccount/{id}` to another,
 * so a single read would leave the first account's figures and action links on screen under the second
 * account's URL and would issue no request at all. Every emission therefore clears the previous record
 * and re-reads the account the URL now names, exactly as `loan-edit`, `client-actions` and `loan-view`
 * handle the same reuse; an answer that arrives after the URL moved on is discarded rather than
 * painted, and leaving the screen cancels the read it left outstanding.
 */
@Component({
  selector: 'app-savings-view',
  imports: [
    RouterLink,
    DatePipe,
    DecimalPipe,
    TranslatePipe,
    StatusSwatchComponent,
    EmptyStateComponent,
    HasPermissionDirective,
  ],
  templateUrl: './savings-view.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavingsViewComponent {
  /** The savings family's one typed Fineract service; this component's only HTTP path (Rule 1 clause 5). */
  private readonly savings = inject(SavingsService);

  /**
   * The activated route, subscribed to for the `:id` of `#/viewsavingaccount/:id`: the router reuses
   * this component across records, so the id is followed rather than sampled once.
   */
  private readonly route = inject(ActivatedRoute);

  /** Ties the outstanding read to this component's lifetime, so leaving cancels it. */
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The account id from the route, as text: the `:id` of `#/viewsavingaccount/:id`. Empty when the
   * route carried none, which is the only case in which the read is not issued.
   *
   * A signal, not a snapshot value: the router reuses this component when the URL moves from one
   * record to another, so the id has to follow every emission of `route.paramMap` and the read of each
   * emission has to address the account the URL now names.
   */
  readonly accountId = signal('');

  /**
   * Which read is the current one, incremented by every run of {@link SavingsViewComponent.load}.
   *
   * The router reuses this component across records, so moving in place starts a second read while the
   * first is still in flight and the earlier one can answer last. A superseded run compares its own
   * number with this one after the await and returns instead of writing, so a late response can neither
   * paint the earlier account under the later account's URL nor clear the loading state of the run that
   * replaced it — the guard `loan-edit` and `loan-view` keep over their own load sequence.
   */
  private loadSequence = 0;

  /**
   * Whether the last read is still outstanding. Starts `true` so the record's empty states cannot
   * flash before the first response is read, and is cleared in the subscription's `finalize`.
   */
  readonly loading = signal(true);

  /** The account the record renders, or `null` until a response arrives and after a failed read. */
  readonly account = signal<SavingsAccount | null>(null);

  /** The failure the read ended in, or `null`; the template derives its error branches from this. */
  readonly error = signal<ApiError | null>(null);

  /** Whether the route carried no account id at all; set by the load of the emission that named none. */
  private readonly missingId = signal(false);

  /**
   * Whether the record does not exist — the route named no id, or Fineract answered 404 — in which
   * case the template renders the not-found message in place of the record (AAP 0.7.4).
   */
  readonly notFound = computed<boolean>(() => this.missingId() || this.error()?.status === 404);

  /**
   * The failure this screen must render itself: a 4xx other than 404, whose Fineract message is
   * shown verbatim with the screen still usable (AAP 0.7.4, workflow W7's rule).
   *
   * The discriminator is the shared `screenFailure` in `core/http/api-error.ts`: it answers the
   * failure for a 4xx and `null` for a 5xx or a transport failure (`status` 0), which has already
   * produced exactly one notification in the interceptor, so its message is never shown twice. A 404
   * answers `null` here because `notFound` owns that state.
   */
  readonly clientError = computed<ApiError | null>(() => {
    const failure = this.error();

    return failure === null || failure.status === 404 ? null : screenFailure(failure);
  });

  /**
   * The status indicator's key for the account, reduced by the family's single mapping,
   * `toSavingsStatusKey`. The Fineract status code never reaches the swatch component, and an
   * account that is not loaded yet paints the neutral key rather than claiming a state.
   */
  readonly statusKey = computed<StatusKey>(() => {
    const loaded = this.account();

    // The mapper accepts an absent code, so a payload that omits the status paints the neutral key
    // instead of throwing inside a computed and taking the whole record down with it.
    return loaded === null ? 'other' : toSavingsStatusKey(loaded.status?.code);
  });

  /**
   * The transaction rows the table renders: every transaction in the order the server returned it —
   * nothing sorted, filtered, paged or resummarised — with its date parsed for display and its type
   * text passed through verbatim (Rule 1 clause 3).
   */
  readonly transactionRows = computed<readonly SavingsTransactionRow[]>(() =>
    (this.account()?.transactions ?? []).map((transaction) => ({
      id: transaction.id,
      date: fromFineractDate(transaction.date),
      // The row's own type text is Fineract's, so it is rendered as it arrived and never translated;
      // an absent type leaves an empty cell rather than the text "undefined" (AAP UI8).
      type: transaction.transactionType?.value ?? '',
      amount: transaction.amount,
      balance: transaction.runningBalance ?? null,
    })),
  );

  /**
   * The one date pattern the record displays, passed to `DatePipe` for each parsed row date and for
   * every date on the page (AAP 0.7.2 "Date handling"): the same pattern a date-bearing payload
   * carries, so a display date and a posted date cannot drift apart.
   */
  readonly dateFormat: string = DISPLAY_DATE_FORMAT;

  /**
   * Number format for every amount on the page: minimum integer digits 1, minimum fraction digits 0
   * (no decimals the payload does not carry), maximum fraction digits 3 (the payload's own digits are
   * never rounded away).
   *
   * Never the `currency` form: the account read carries no currency code with its summary figures,
   * so a symbol here would be invented (Rule 1 clause 3).
   */
  readonly amountFormat = '1.0-3';

  /**
   * The permission every action on this record is gated on.
   *
   * The plan supplies only `READ_SAVINGSACCOUNT` and `CREATE_SAVINGSACCOUNT` for this family: there
   * is deliberately no update-scoped permission and no per-action code, and no action may be left
   * ungated (AAP 0.7.1, AAP 0.9.1 item 1).
   */
  readonly actionPermission = 'READ_SAVINGSACCOUNT';

  /**
   * Subscribes to the route's parameters, which is the screen's whole entry point.
   *
   * One subscription, never a `snapshot` read beside it: the router reuses this component when the URL
   * moves from one record to another, and a single read would leave the first account's figures and
   * action links on screen under the second account's URL. Each emission therefore resets the screen and
   * re-runs the one read, the way `loan-edit` and `loan-view` handle the same reuse.
   */
  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params: ParamMap) => {
        this.accountId.set(params.get('id') ?? '');
        this.reset();
        void this.load();
      });
  }

  /**
   * Clears everything the previous account put on the screen, so an emission for another record never
   * shows the earlier one's figures, failure or action links.
   *
   * `loading` goes back to `true` until the new read settles, and the not-found outcome of the previous
   * route is dropped: both describe the account the URL has left.
   */
  private reset(): void {
    this.account.set(null);
    this.error.set(null);
    this.missingId.set(false);
    this.loading.set(true);
  }

  /**
   * Reads the account the current emission names.
   *
   * A `404` drives `notFound` and any other failure is kept for `clientError`, which the template
   * renders in place of the record; neither is rethrown and neither is notified here, because the
   * interceptor has already raised the single message a 5xx or transport failure gets (AAP 0.4.2,
   * AAP 0.7.4).
   *
   * Every run takes the next {@link SavingsViewComponent.loadSequence} number, and the read is tied to
   * this component's lifetime, so a run the route has since superseded — or that the screen outlived —
   * writes nothing at all, and `loading` is only cleared by the run that is still current.
   */
  private async load(): Promise<void> {
    const load = ++this.loadSequence;
    const accountId = this.accountId();

    if (accountId.length === 0) {
      // No request is issued for a route that names no account, so this is the one path on which
      // `loading` is cleared without a read settling it: leaving it `true` would keep the screen on its
      // loading state for ever and the not-found branch could never paint.
      this.missingId.set(true);
      this.loading.set(false);

      return;
    }

    try {
      const loaded = await firstValueFrom(
        this.savings.get(accountId).pipe(takeUntilDestroyed(this.destroyRef)),
      );

      if (this.isCurrent(load)) {
        this.account.set(loaded);
      }
    } catch (cause: unknown) {
      if (this.isCurrent(load)) {
        this.error.set(toDisplayableFailure(cause));
      }
    } finally {
      // Only the current run owns the loading state: the superseded one must not clear the flag the
      // newer read set, or the record would stop reporting that it is still filling.
      if (this.isCurrent(load)) {
        this.loading.set(false);
      }
    }
  }

  /**
   * Whether a run still speaks for the screen: it is the newest run, and the screen it belongs to has
   * not been destroyed, so a read the route or the teardown cancelled can neither paint nor clear the
   * loading state of whatever replaced it.
   *
   * @param load the run's sequence number.
   */
  private isCurrent(load: number): boolean {
    return !this.destroyRef.destroyed && load === this.loadSequence;
  }
}
