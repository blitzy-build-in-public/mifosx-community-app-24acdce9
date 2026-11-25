import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, type ParamMap } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { ApiError } from '../../../core/http/api-error';
import { HasPermissionDirective } from '../../../shared/has-permission.directive';
import {
  StatusSwatchComponent,
  type StatusKey,
} from '../../../shared/status-swatch/status-swatch.component';
import {
  TabStripComponent,
  type TabDescriptor,
} from '../../clients/client-view/tab-strip/tab-strip.component';
import {
  toLoanStatusKey,
  type LoanAccount,
  type LoanCharge,
  type RepaymentPeriod,
} from '../loan.models';
import { LoanService } from '../loan.service';
import { LoanChargesComponent } from './loan-charges/loan-charges.component';
import { LoanScheduleComponent } from './loan-schedule/loan-schedule.component';
import { LoanTransactionsComponent } from './loan-transactions/loan-transactions.component';

/**
 * The id of the record's repayment-schedule tab: the first tab and the one the record opens on,
 * because the schedule is what a loan officer reads first on a disbursed loan (AAP 0.7.4).
 */
const SCHEDULE_TAB = 'schedule';

/** The id of the record's transactions tab (AAP 0.7.4; AAP 0.7.3 row "W6 repayment"). */
const TRANSACTIONS_TAB = 'transactions';

/** The id of the record's charges tab (AAP 0.7.4; AAP 0.7.3 row "Loan charges"). */
const CHARGES_TAB = 'charges';

/**
 * The three tabs this record serves, as the union their ids form.
 *
 * `TabStripComponent` deals in opaque ids, so the record's own ids are kept here as a union: the
 * active-tab signal can then hold only one of the three, and a fourth id cannot be introduced without
 * a compile error at the signal and at the tab list.
 */
export type LoanViewTab = typeof SCHEDULE_TAB | typeof TRANSACTIONS_TAB | typeof CHARGES_TAB;

/**
 * One rendered row of the record's summary block: a legacy caption key and the figure the payload
 * reported beneath it.
 *
 * Exported so the paired spec types its expectations against this declaration instead of restating
 * the members. `value` is `number | null` rather than `number`, because a figure the record's
 * payload does not report must render an empty cell — never a zero the server never sent, and never
 * a placeholder word (Rule 1 clause 3; AAP 0.7.4).
 */
export interface LoanSummaryRow {
  /** Legacy translation key of the figure's caption, resolved by the template's `TranslatePipe`. */
  readonly labelKey: string;

  /** The figure as the payload reported it, or `null` when the payload reported none. */
  readonly value: number | null;
}

/** One per-period balance member of the schedule, the four the summary's balances are built from. */
type PeriodBalance =
  | 'principalOutstanding'
  | 'interestOutstanding'
  | 'feeChargesOutstanding'
  | 'penaltyChargesOutstanding';

/**
 * The loan-wide balance a set of per-period outstanding members adds up to, or `null` when the
 * schedule reports none of them.
 *
 * This is where the record's three balances come from. `GET /loans/{id}?associations=all` answers
 * with no `summary` member on this fork, and the schedule's own periods carry the server's
 * per-period outstanding amounts instead: `principalOutstanding`, `interestOutstanding`,
 * `feeChargesOutstanding` and `penaltyChargesOutstanding`, already net of everything repaid, waived
 * and written off against that period. Adding them up is the reading the fork itself applies — its
 * `CommonLoanSummaryDataProvider` totals `interestOutstanding` over the schedule the same way — and
 * the four sums together equal the schedule's `totalOutstanding` on every loan.
 *
 * A period that carries nothing outstanding for a member omits the member, the disbursement row
 * above all, so an absent member counts as zero. A schedule whose periods omit the member
 * everywhere reports no figure for it, and this function then answers `null`, which the template
 * renders as an empty value rather than as a zero (Rule 1 clause 3).
 *
 * @param periods The schedule's periods, in the server's order.
 * @param members The per-period members the balance is the sum of.
 * @returns The balance, or `null` when the payload reported no member of the set.
 */
function sumPeriodBalances(
  periods: readonly RepaymentPeriod[],
  members: readonly PeriodBalance[],
): number | null {
  let balance = 0;
  let reported = false;

  for (const period of periods) {
    for (const member of members) {
      const value = period[member];

      if (typeof value === 'number') {
        reported = true;
        balance += value;
      }
    }
  }

  return reported ? balance : null;
}

/**
 * The individual-loan record — `#/viewloanaccount/:id`, the screen the loan route tree mounts for
 * its one record path (AAP 0.8.2 "Feature routes, matching legacy paths exactly"; AAP 0.7.1 Features
 * row `loans`, which names this component `LoanViewComponent`; AAP 0.7.4's `#/viewloanaccount/:id`
 * row).
 *
 * **One request, owned by the family's service.** The page reads the loan once,
 * `LoanService.get(id)` — `GET /loans/{id}?associations=all` (AAP 0.7.3 row "W6 repayment") — which
 * carries the repayment schedule and with it every figure the summary block prints, the transactions,
 * and the loan's `charges`, the rows the charge section lists (AAP 0.7.3's W6 row names all three
 * among what this answer carries, and the legacy record read the same members from the same call).
 * That is the whole read of the screen: no section issues a request of its own and no charge-list call
 * is made (Rule 1 clauses 2 and 3). This file holds no URL, host, port,
 * API path, HTTP method, query parameter or body, and it injects no `HttpClient`: `LoanService`
 * composes the requests through `AppConfigService.apiUrl()` and is the only HTTP holder in this
 * feature (Rule 1 clause 5, Rule 1 clause 2, Rule 2; AAP 0.14.1). It reads no business date either —
 * that belongs to the harness (AAP 0.10.5 item 15).
 *
 * **Four states, and who owns each** (AAP 0.7.4, "States every list and record screen must
 * implement"). While the read is outstanding `loading` is true and nothing is painted, because the
 * design carries no spinner, skeleton or placeholder. A 404 — or a route that names no id, in which
 * case no request is issued at all — drives `notFound`, whose message the template renders **in
 * place of the record**, leaving the shell usable. Any other 4xx drives `clientError`: Fineract's own
 * message, shown verbatim, with the screen still usable. A 5xx or transport failure leaves both
 * computeds empty, because the single interceptor has already raised exactly one notification for
 * it and a second copy here would report the same problem twice (AAP 0.4.2, AAP 0.14.1 "errors are
 * values"). This component therefore never calls `NotificationService`, never logs and never
 * rethrows.
 *
 * **What the record renders.** The head carries the status indicator, the loan product's name and
 * the three inline runs the record identifies itself by — account number, client name and principal.
 * The status is the design's colour and never its word, so it goes through `StatusSwatchComponent`
 * with `toLoanStatusKey(status?.code)` and the server's own status label is never read (AAP 0.10.5
 * deliberate difference 11; Rule 1 clause 3). The summary block prints the five figures AAP 0.7.2's
 * `LoanSummary` row names — total expected repayment, total outstanding, and the principal, interest
 * and fee balances — taken from the one place this fork publishes them, the loan's
 * `repaymentSchedule` (see {@link LoanViewComponent.summaryRows}); the payload's separate `summary`
 * object is not declared on the model and no screen reads it, and a figure the payload omits renders
 * an empty cell rather than a zero or a word this
 * screen would have invented (Rule 1 clause 3). Below them the record shows three tabs through the
 * application's one tab component, `app-tab-strip`: the repayment schedule in `app-loan-schedule`,
 * the transactions in `app-loan-transactions` and the charges in `app-loan-charges`, each the
 * committed, read-only section component that owns its table and none of them re-implemented here.
 *
 * **Charges arrive with the record.** `GET /loans/{id}?associations=all` carries the loan's `charges`
 * rows besides the schedule and the transactions (AAP 0.7.3's W6 row names all three), so the screen
 * hands the payload's own rows to the charges section and issues no second request — the same single
 * call the legacy record made, and no charge-list endpoint is used (Rule 1 clauses 2 and 3).
 *
 * **Action entry points.** Every lifecycle command and the repayment form is a permission-gated
 * `routerLink` to the segment `loan-action.component.ts` serves — `/loanaccount/:id/approve`,
 * `undoapproval`, `reject`, `disburse`, `undodisbursal` and `repayment` — plus `/addloancharge/:id`
 * for the charge form. All of them are gated by `HasPermissionDirective` on the single named code
 * {@link LoanViewComponent.actionPermission}, so no action can be left ungated and the gate has one
 * home. Which of those steps is legal is the server's decision and not this screen's, so no action
 * is enabled, disabled or reordered by the loan's status (Rule 1 clause 3).
 *
 * **One id, one load per navigation.** `:id` is read from `route.paramMap`, never from the snapshot:
 * the router reuses this component when the URL moves from one `#/viewloanaccount/{id}` to another,
 * so a single read would leave the first loan's record, figures and action links on screen under the
 * second loan's URL and would issue no request at all. Every emission therefore clears the previous
 * record and re-reads the loan the URL now names, exactly as `loan-edit` and `client-actions` handle
 * the same reuse. Because two reads can then be in flight, an answer that arrives after the URL moved
 * on is discarded rather than applied, so one loan's record and hrefs can never appear under another
 * loan's URL (see {@link LoanViewComponent.load}). Leaving the screen cancels the read it left
 * outstanding, because both reads are tied to this component's lifetime.
 *
 * The look comes entirely from the global Bootstrap 3 classes of `web-ng/src/styles.scss` — this
 * component declares no stylesheet, no `styles` array, no inline style and no colour (Rule 1
 * clause 6; AAP 0.4.4 decision 4). Every visible string is a legacy bundle key resolved by
 * `TranslatePipe`, or — for the two tab captions, which the tab strip takes as plain text — by
 * {@link LoanViewComponent.translated}, exactly as `savings-new.component.ts` resolves the labels its
 * shared fields take; no copy is inlined here (AAP 0.10.2; Rule 1 clause 3).
 */
@Component({
  selector: 'app-loan-view',
  imports: [
    RouterLink,
    DecimalPipe,
    TranslatePipe,
    StatusSwatchComponent,
    HasPermissionDirective,
    TabStripComponent,
    LoanScheduleComponent,
    LoanTransactionsComponent,
    LoanChargesComponent,
  ],
  templateUrl: './loan-view.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanViewComponent {
  /** The loans family's one typed Fineract service; this component's only HTTP path (Rule 1 clause 5). */
  private readonly loans = inject(LoanService);

  /**
   * The activated route, subscribed to for the `:id` of `#/viewloanaccount/:id`: the router reuses
   * this component across records, so the id is followed rather than sampled once.
   */
  private readonly route = inject(ActivatedRoute);

  /** Ties the single outstanding read to this component's lifetime, so leaving cancels it. */
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The one owner of the active language, used only to resolve the two tab captions: the tab strip
   * takes plain display text rather than keys, so those two strings cannot go through
   * `TranslatePipe` (see {@link LoanViewComponent.translated}).
   */
  private readonly translate = inject(TranslateService);

  /**
   * The loan id from the route, as text: the `:id` of `#/viewloanaccount/:id`. Empty when the route
   * carried none, which is the only case in which the read is not issued.
   *
   * A signal, not a snapshot value: the router reuses this component when the URL moves from one
   * record to another, so the id has to follow every emission of `route.paramMap` and the read of
   * each emission has to address the loan the URL now names.
   */
  readonly loanId = signal('');

  /**
   * Which read is the current one, incremented by every run of {@link LoanViewComponent.load}.
   *
   * The router reuses this component across records, so moving in place starts a second read while
   * the first is still in flight and the earlier one can answer last. A superseded run compares its
   * own number with this one after each await and returns instead of writing, so a late response can
   * neither paint the earlier loan under the later loan's URL nor clear the loading state of the run
   * that replaced it — the guard `loan-edit` and `client-actions` keep over their own load sequence.
   */
  private loadSequence = 0;

  /**
   * Whether the last read is still outstanding. Starts `true` so no half-built record can paint
   * before the first response is read, and is cleared in the subscription's `finalize`.
   */
  readonly loading = signal(true);

  /** The loan the record renders, or `null` until a response arrives and after a failed read. */
  readonly loan = signal<LoanAccount | null>(null);

  /**
   * The loan's charges, as the record's `charges` member reported them — `[]` for a loan that carries
   * none, and `null` until the read answers, which is what keeps the charges tab's empty state off the
   * screen before the rows are known.
   */
  readonly charges = signal<readonly LoanCharge[] | null>(null);

  /** The failure the read ended in, or `null`; the template derives its error branches from this. */
  readonly error = signal<ApiError | null>(null);

  /** Whether the route carried no loan id at all; set by the load of the emission that named none. */
  private readonly missingId = signal(false);

  /**
   * Counts the moments at which a tab caption must be resolved again: a language switch and a
   * bundle arriving. Read inside every caption signal below, so a caption resolved before its
   * bundle had loaded is replaced by the real legacy wording instead of staying at the fallback for
   * the life of the screen — the same mechanism `savings-new.component.ts` uses for the labels its
   * shared fields take.
   */
  private readonly labelsRevision = signal(0);

  /** Already-translated caption of the repayment-schedule tab (legacy `label.heading.repaymentschedule`). */
  private readonly scheduleTabLabel = this.translated('label.heading.repaymentschedule');

  /** Already-translated caption of the transactions tab (legacy `label.heading.transactions`). */
  private readonly transactionsTabLabel = this.translated('label.heading.transactions');

  /** Already-translated caption of the charges tab (legacy `label.heading.charges`). */
  private readonly chargesTabLabel = this.translated('label.heading.charges');

  /**
   * Whether the record does not exist — the route named no id, or Fineract answered 404 — in which
   * case the template renders the not-found message in place of the record (AAP 0.7.4).
   */
  readonly notFound = computed<boolean>(() => this.missingId() || this.error()?.status === 404);

  /**
   * The failure this screen must render itself: a 4xx other than 404, whose Fineract message is
   * shown verbatim with the screen still usable (AAP 0.7.4).
   *
   * The discriminator is deliberate. A 5xx or a transport failure (`status` 0) has already produced
   * exactly one notification in the interceptor, so it answers `null` here and the message is never
   * shown twice; a 404 answers `null` because `notFound` owns that state.
   */
  readonly clientError = computed<ApiError | null>(() => {
    const failure = this.error();

    if (failure === null || failure.status < 400 || failure.status >= 500) {
      return null;
    }

    return failure.status === 404 ? null : failure;
  });

  /**
   * The status indicator's key for the loan, reduced by the family's single mapping,
   * `toLoanStatusKey`. The Fineract status code never reaches the swatch component, and a loan that
   * is not loaded yet paints the neutral key rather than claiming a state.
   */
  readonly statusKey = computed<StatusKey>(() => {
    const loaded = this.loan();

    // The mapper accepts an absent code, so a payload that omits the status paints the neutral key
    // instead of throwing inside a computed and taking the whole record down with it.
    return loaded === null ? 'other' : toLoanStatusKey(loaded.status?.code);
  });

  /**
   * The five figures the summary block prints, in the order the block reads them: the loan-wide
   * total and outstanding balance first, then the three balances.
   *
   * Both loan-wide figures are the schedule's own, passed through untouched — `totalRepaymentExpected`
   * is what the borrower repays over the loan's life and `totalOutstanding` is the balance still
   * owed — and the three balances are the sums {@link sumPeriodBalances} takes over the schedule's
   * periods. Nothing is rounded, recalculated from other members, or defaulted: a figure the payload
   * does not report becomes `null`, which the template renders as an empty cell (Rule 1 clause 3;
   * AAP 0.7.2's `LoanSummary` row, whose figures this fork publishes in the schedule instead).
   */
  readonly summaryRows = computed<readonly LoanSummaryRow[]>(() => {
    const schedule = this.loan()?.repaymentSchedule;
    const periods = schedule?.periods ?? [];

    return [
      { labelKey: 'label.heading.total', value: schedule?.totalRepaymentExpected ?? null },
      { labelKey: 'label.heading.outstanding', value: schedule?.totalOutstanding ?? null },
      {
        labelKey: 'label.heading.principal.outstanding',
        value: sumPeriodBalances(periods, ['principalOutstanding']),
      },
      {
        labelKey: 'label.heading.interest.outstanding',
        value: sumPeriodBalances(periods, ['interestOutstanding']),
      },
      {
        labelKey: 'label.heading.fees',
        value: sumPeriodBalances(periods, ['feeChargesOutstanding', 'penaltyChargesOutstanding']),
      },
    ];
  });

  /**
   * The permission every action on this record is gated on: `UPDATE_LOAN`, the code
   * `loans.routes.ts` declares as `data.permission` for the `loanaccount/:id/:action` route
   * (`loan-action.component.ts` records exactly that for the screen those links reach).
   *
   * It is one named member so every entry point in the template binds the same code rather than
   * transcribing the string seven times, and so the charge form's links state the code they use
   * beside the lifecycle ones. The route table remains the only route declaration; this constant
   * repeats one permission code, not the routes (AAP 0.14.1, "Permissions are declared once per
   * route and once per action").
   */
  readonly actionPermission = 'UPDATE_LOAN';

  /**
   * The record's tabs, in the order they are shown: the repayment schedule first, the transactions
   * second, the charges third (AAP 0.7.4's "summary, repayment schedule, transactions and charges").
   * Every caption is the legacy bundle's own tab heading — the same three headings
   * `app/views/loans/viewloanaccountdetails.html` gives its tabs — resolved to display text here
   * because the tab strip renders its labels verbatim.
   */
  readonly tabs = computed<readonly TabDescriptor[]>(() => [
    { id: SCHEDULE_TAB, label: this.scheduleTabLabel() },
    { id: TRANSACTIONS_TAB, label: this.transactionsTabLabel() },
    { id: CHARGES_TAB, label: this.chargesTabLabel() },
  ]);

  /** The tab currently shown; the record opens on the repayment schedule. */
  readonly activeTab = signal<LoanViewTab>(SCHEDULE_TAB);

  /**
   * Whether the repayment-schedule section is the one on screen. The template branches on this
   * rather than comparing the active id to a literal, so the three tab ids keep one home in this file.
   */
  readonly showSchedule = computed<boolean>(() => this.activeTab() === SCHEDULE_TAB);

  /** Whether the transactions section is the one on screen. */
  readonly showTransactions = computed<boolean>(() => this.activeTab() === TRANSACTIONS_TAB);

  /** Whether the charges section is the one on screen. */
  readonly showCharges = computed<boolean>(() => this.activeTab() === CHARGES_TAB);

  constructor() {
    const refreshLabels = (): void => this.labelsRevision.update((revision) => revision + 1);
    this.translate.onLangChange.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(refreshLabels);
    this.translate.onTranslationChange.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(refreshLabels);

    // One subscription, never a `snapshot` read beside it: the router reuses this component when the
    // URL moves from one record to another, and a single read would leave the first loan's record,
    // figures and action links on screen under the second loan's URL. Each emission therefore resets
    // the screen and re-runs the read for the loan the URL now names, the way `loan-edit` and
    // `client-actions` handle the same reuse.
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params: ParamMap) => {
        this.loanId.set(params.get('id') ?? '');
        this.reset();
        void this.load();
      });
  }

  /**
   * Clears everything the previous loan put on the screen, so an emission for another record never
   * shows the earlier one's figures, charges, failure or action links.
   *
   * `loading` goes back to `true` until the new read settles, the record reopens on its first tab, and
   * the not-found outcome of the previous route is dropped: every one of them describes the loan the
   * URL has left.
   */
  private reset(): void {
    this.loan.set(null);
    this.charges.set(null);
    this.error.set(null);
    this.missingId.set(false);
    this.activeTab.set(SCHEDULE_TAB);
    this.loading.set(true);
  }

  /**
   * Reads the loan for the emission that is current, then paints the record and its charges together.
   *
   * One read: the record carries the schedule, the transactions and the loan's charges. A failed read
   * becomes {@link LoanViewComponent.error}: it is not rethrown and not notified here, because the
   * interceptor has already raised the single message a 5xx or transport failure gets, and a 4xx
   * reaches the template through `clientError` or `notFound` (AAP 0.14.2).
   *
   * Every run takes the next {@link LoanViewComponent.loadSequence} number, and the read is tied to
   * this component's lifetime, so a run the route has since superseded — or that the screen outlived —
   * writes nothing at all: not the record, charges, failure or not-found state, and not `loading`,
   * which belongs to the run that replaced it.
   */
  private async load(): Promise<void> {
    const load = ++this.loadSequence;
    const loanId = this.loanId();

    if (loanId.length === 0) {
      // No request is issued for a route that names no loan, so this is the one path on which
      // `loading` is cleared without a read settling it: leaving it `true` would keep the screen on
      // its loading state for ever and the not-found branch could never paint.
      this.missingId.set(true);
      this.loading.set(false);

      return;
    }

    try {
      const loaded = await firstValueFrom(
        this.loans.get(loanId).pipe(takeUntilDestroyed(this.destroyRef)),
      );

      if (!this.isCurrent(load)) {
        return;
      }

      this.loan.set(loaded);
      this.charges.set(loaded.charges ?? []);
    } catch (cause: unknown) {
      if (!this.isCurrent(load)) {
        return;
      }

      this.error.set(this.asApiError(cause));
    } finally {
      // Only the current run owns the loading state: the superseded one must not clear the flag the
      // newer read set, or the card would stop reporting that it is still filling.
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

  /**
   * Shows the tab the user picked in the strip.
   *
   * The tab strip reports an opaque id, so an id this record does not serve is ignored rather than
   * stored: `activeTab` can then only ever hold one of the three tabs, and an unknown id cannot leave
   * the record showing nothing.
   *
   * @param id the id `TabStripComponent` emitted.
   */
  activateTab(id: string): void {
    if (id === SCHEDULE_TAB || id === TRANSACTIONS_TAB || id === CHARGES_TAB) {
      this.activeTab.set(id);
    }
  }

  /**
   * Builds one caption signal from a legacy translation key.
   *
   * The key is resolved with `instant()`, because `TabStripComponent` takes its labels as plain
   * display text rather than as keys the `TranslatePipe` could re-resolve. `instant()` answers from
   * whatever bundle is loaded at that moment, so the computed also reads `labelsRevision`, which the
   * constructor bumps on a language switch and on a bundle arriving: the first paint shows the
   * missing-translation handler's wording, and the real legacy text replaces it as soon as the
   * bundle lands.
   *
   * @param key legacy key from `app/global-translations/`, served in place (Rule 1 clause 6).
   * @returns the signal the tab descriptor list reads for that caption.
   */
  private translated(key: string): Signal<string> {
    return computed((): string => {
      this.labelsRevision();
      this.translate.currentLang();

      // `TranslateService.instant` is typed `Translation`, which ngx-translate declares as
      // `StrictTranslation | any` because a bundle may hold a nested object. Every caption this
      // screen reads is a flat string in the legacy bundles, so the value is narrowed to `string`
      // here once, at the one boundary where the library's type stops being exact (Rule 1 clause 4).
      return this.translate.instant(key) as string;
    });
  }

  /**
   * The `ApiError` a failed read is reported as.
   *
   * The interceptor maps every `HttpErrorResponse` into an `ApiError` before rethrowing it, so the
   * defensive branch is unreachable through the application and exists only so that a future
   * failure shape degrades into the same type instead of escaping as an unhandled value: status `0`
   * (the transport-failure status the mapper uses) carries no `clientError`, and the interceptor's
   * transport-failure notification is the message the user sees.
   *
   * @param cause whatever the read rejected with.
   * @returns the failure as the one error type a component renders.
   */
  private asApiError(cause: unknown): ApiError {
    if (cause instanceof ApiError) {
      return cause;
    }

    const message = cause instanceof Error && cause.message.length > 0 ? cause.message : 'HTTP 0';

    return new ApiError(message, 0);
  }
}
