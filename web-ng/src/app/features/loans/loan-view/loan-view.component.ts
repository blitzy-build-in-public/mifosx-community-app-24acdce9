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
import { ApiError } from '../../../core/http/api-error';
import { isResourceId } from '../../../core/http/path-segment.util';
import { HasPermissionDirective } from '../../../shared/has-permission.directive';
import { MoneyPipe } from '../../../shared/money/money.pipe';
import { PanelCardComponent } from '../../../shared/panel-card/panel-card.component';
import { RecordNotFoundComponent } from '../../../shared/record-not-found/record-not-found.component';
import type { StatusKey } from '../../../shared/status-key.util';
import { StatusSwatchComponent } from '../../../shared/status-swatch/status-swatch.component';
import { TabStripComponent, tabDomId, type TabDescriptor } from '../../../shared/tab-strip/tab-strip.component';
import { createTranslatedLabels } from '../../../shared/translated-label.util';
import {
  toLoanStatusKey,
  type LoanAccount,
  type LoanCharge,
  type LoanCommand,
  type RepaymentPeriod,
} from '../loan.models';
import { LoanService } from '../loan.service';
import { LoanChargesComponent } from './loan-charges/loan-charges.component';
import { LoanScheduleComponent } from './loan-schedule/loan-schedule.component';
import { LoanTransactionsComponent } from './loan-transactions/loan-transactions.component';
/** The id of the record's repayment-schedule tab: the first tab and the one the record opens on, because the schedule is what a loan officer reads first on a disbursed loan (AAP 0.7.4). */
const SCHEDULE_TAB = 'schedule';

/** The id of the record's transactions tab (AAP 0.7.4; AAP 0.7.3 row "W6 repayment"). */
const TRANSACTIONS_TAB = 'transactions';

/** The id of the record's charges tab (AAP 0.7.4; AAP 0.7.3 row "Loan charges"). */
const CHARGES_TAB = 'charges';

/** The three tabs this record serves, as the union their ids form: `TabStripComponent` deals in opaque ids, so the record's own ids are kept here as a union and the active-tab signal can then hold only one of the three, with a fourth id a compile error at the signal and at the tab list. */
export type LoanViewTab = typeof SCHEDULE_TAB | typeof TRANSACTIONS_TAB | typeof CHARGES_TAB;

/** One rendered row of the record's summary block: a legacy caption key and the figure the payload reported beneath it. `value` is `number | null` rather than `number`, because a figure the record's payload does not report must render an empty cell — never a zero the server never sent, and never a placeholder word (Rule 1 clause 3; AAP 0.7.4). */
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

/** The loan-wide balance a set of per-period outstanding members adds up to, or `null` when the schedule reports none of them — the source of the record's three balances, because the payload's `summary` object exists only for some loan states, so the record sums the schedule every state carries (Rule 1 clause 3). */
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

/** One action the record links to, as the template renders it: a stable id, the legacy bundle's caption key, the permission code the link is gated on, and the router commands it opens — exported beside {@link LOAN_ACTIONS} so the paired spec asserts the record's entry points against the declaration the template renders. */
export interface LoanActionLink {
  /** Stable DOM id of the link, which the end-to-end page objects also address. */
  readonly id: string;
  /** Legacy translation key of the link's caption, resolved by the template's `TranslatePipe`. */
  readonly labelKey: string;
  /** Fineract permission code the link is gated on: the member of {@link LOAN_ACTION_PERMISSIONS} or {@link LOAN_CHARGE_PERMISSION} that the route the link opens declares as its own `data.permission`, so the directive and that route's `permissionGuard` ask the same question (AAP 0.1.1, AAP 0.4.2, AAP 0.14.1). */
  readonly permission: string;
  /** Router commands of the screen the link opens. */
  readonly commands: readonly string[];
}

/** A row of {@link LOAN_ACTIONS}: a link, the loan states the legacy record offers it in, and the router commands it builds for the record being shown. */
export interface LoanActionDefinition extends Omit<LoanActionLink, 'commands'> {
  /** Fineract loan status ids — the numeric `LoanStatus.id` — the legacy record shows it under. */
  readonly statuses: readonly number[];
  /** Builds the link's router commands for the id of the loan the record shows. */
  readonly route: (id: string) => readonly string[];
}

/** The Fineract code each `loanaccount/:id/:action` command requires, keyed by the `:action` segment that names it. This record is the one statement of those codes: `loans.routes.ts` declares it as that route's `data.permission` — `{ param: 'action', codes: LOAN_ACTION_PERMISSIONS }` — and every row of {@link LOAN_ACTIONS} opening the route is gated on the same member, so `HasPermissionDirective` and the route's `permissionGuard` ask one question and a user holding `APPROVE_LOAN` both sees the Approve link and reaches the form it opens (AAP 0.1.1, AAP 0.4.2, AAP 0.14.1). The codes are the legacy record's own (`ViewLoanDetailsController.js`) and the ones Fineract enforces for those commands, so nothing here is a difference from legacy (Rule 1 clause 3; AAP 0.10.5 registers none). `satisfies Record<LoanCommand | 'repayment', string>` makes a command the route serves without a code here a compile error, and a code added for a command the route does not serve one too. */
export const LOAN_ACTION_PERMISSIONS = {
  approve: 'APPROVE_LOAN',
  reject: 'REJECT_LOAN',
  disburse: 'DISBURSE_LOAN',
  undoapproval: 'APPROVALUNDO_LOAN',
  undodisbursal: 'DISBURSALUNDO_LOAN',
  repayment: 'REPAYMENT_LOAN',
} satisfies Record<LoanCommand | 'repayment', string>;

/** The Fineract code the add-charge form requires: `addloancharge/:id`'s `data.permission` in `loans.routes.ts` and the gate on the record's Add Loan Charge link, so the link and the screen it opens are one permission rather than two (AAP 0.1.1, AAP 0.14.1). It is the legacy record's own code for that form (Rule 1 clause 3). */
export const LOAN_CHARGE_PERMISSION = 'CREATE_LOANCHARGE';

/** The actions the legacy loan record offers, and the states it offers each one in, transcribed from `ViewLoanDetailsController.js`, whose `scope.buttons.singlebuttons` is built per loan status: submitted and pending (Rule 1 clause 3, AAP 0.7.4). Add-charge's provenance differs by state and does not narrow its `statuses`: legacy carries `button.addloancharge` in the button row (`singlebuttons`) for a submitted application and for an active loan, and in the `options` list for an approved loan, which `viewloanaccountdetails.html` renders as its "More" dropdown — this record shows both legacy lists as its one joined action group, so the row is offered in all three states exactly as the legacy record offers it. */
export const LOAN_ACTIONS: readonly LoanActionDefinition[] = [
  {
    id: 'loan-action-addcharge',
    labelKey: 'label.button.addloancharge',
    permission: LOAN_CHARGE_PERMISSION,
    statuses: [100, 200, 300],
    route: (id) => ['/addloancharge', id],
  },
  {
    id: 'loan-action-approve',
    labelKey: 'label.button.approve',
    permission: LOAN_ACTION_PERMISSIONS.approve,
    statuses: [100],
    route: (id) => ['/loanaccount', id, 'approve'],
  },
  {
    id: 'loan-action-edit',
    labelKey: 'label.button.modifyapplication',
    permission: 'UPDATE_LOAN',
    statuses: [100],
    route: (id) => ['/editloanaccount', id],
  },
  {
    id: 'loan-action-reject',
    labelKey: 'label.button.reject',
    permission: LOAN_ACTION_PERMISSIONS.reject,
    statuses: [100],
    route: (id) => ['/loanaccount', id, 'reject'],
  },
  {
    id: 'loan-action-disburse',
    labelKey: 'label.button.disburse',
    permission: LOAN_ACTION_PERMISSIONS.disburse,
    statuses: [200],
    route: (id) => ['/loanaccount', id, 'disburse'],
  },
  {
    id: 'loan-action-undoapproval',
    labelKey: 'label.button.undoapproval',
    permission: LOAN_ACTION_PERMISSIONS.undoapproval,
    statuses: [200],
    route: (id) => ['/loanaccount', id, 'undoapproval'],
  },
  {
    id: 'loan-action-repayment',
    labelKey: 'label.button.makerepayment',
    permission: LOAN_ACTION_PERMISSIONS.repayment,
    statuses: [300],
    route: (id) => ['/loanaccount', id, 'repayment'],
  },
  {
    id: 'loan-action-undodisbursal',
    labelKey: 'label.button.undodisbursal',
    permission: LOAN_ACTION_PERMISSIONS.undodisbursal,
    statuses: [300],
    route: (id) => ['/loanaccount', id, 'undodisbursal'],
  },
];

/** The individual-loan record — `#/viewloanaccount/:id`, the screen the loan route tree mounts for its one record path (AAP 0.8.2 "Feature routes, matching legacy paths exactly"; AAP 0.7.1 row `loans`; AAP 0.7.4) (AAP 0.7.3, Rule 2, AAP 0.10.5, AAP 0.4.2). */
@Component({
  selector: 'app-loan-view',
  imports: [
    RouterLink,
    MoneyPipe,
    TranslatePipe,
    StatusSwatchComponent,
    HasPermissionDirective,
    PanelCardComponent,
    TabStripComponent,
    LoanScheduleComponent,
    LoanTransactionsComponent,
    LoanChargesComponent,
    RecordNotFoundComponent,
  ],
  templateUrl: './loan-view.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanViewComponent {
  /** The loans family's one typed Fineract service; this component's only HTTP path (Rule 1 clause 5). */
  private readonly loans = inject(LoanService);
  /** The activated route, subscribed to for the `:id` of `#/viewloanaccount/:id`: the router reuses this component across records, so the id is followed rather than sampled once. */
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  /** The loan id from the route, as text — the `:id` of `#/viewloanaccount/:id`, empty when the route carried none. Neither an empty id nor one that is not a Fineract resource identifier ({@link isResourceId}) issues a read, because neither addresses a loan; a signal rather than a snapshot value because the router reuses this component when the URL moves from one record to another. */
  readonly loanId = signal('');
  /** Which read is the current one, incremented by every run of {@link LoanViewComponent.load}: the router reuses this component across records, so a superseded run compares its own number after each await and returns instead of writing, and a late response can neither paint the earlier loan under the later loan's URL nor clear the loading state of the run that replaced it. */
  private loadSequence = 0;
  /** Whether the last read is still outstanding; starts `true` so no half-built record can paint before the first response is read, and is cleared in the subscription's `finalize`. */
  readonly loading = signal(true);
  readonly loan = signal<LoanAccount | null>(null);
  /** The loan's charges, as the record's `charges` member reported them — `[]` for a loan that carries none, and `null` until the read answers, which keeps the charges tab's empty state off the screen before the rows are known. */
  readonly charges = signal<readonly LoanCharge[] | null>(null);
  readonly error = signal<ApiError | null>(null);
  /** Whether the id the URL names addresses no loan at all — it is empty, or it is not a Fineract resource identifier ({@link isResourceId}); cleared by {@link LoanViewComponent.reset} and set again by {@link LoanViewComponent.load} on every route emission, so it always describes the current URL. */
  private readonly missingId = signal(false);
  /** Resolves the record's tab captions through the one shared label helper, `shared/translated-label.util.ts`, so the `Translation → string` boundary and the language-change and bundle-arrival subscriptions that re-resolve a caption exist once in the application rather than once per screen; this record needs it because `TabStripComponent` takes plain display text rather than keys `TranslatePipe` could re-resolve, so the three tab captions are the only labels on the page that cannot go through the pipe (Rule 1 clauses 3 and 4; AAP 0.14.1). Declared before the caption fields because field initializers run in declaration order. */
  private readonly labels = createTranslatedLabels();
  /** Already-translated caption of the repayment-schedule tab (legacy `label.heading.repaymentschedule`). */
  private readonly scheduleTabLabel = this.labels('label.heading.repaymentschedule');
  private readonly transactionsTabLabel = this.labels('label.heading.transactions');
  private readonly chargesTabLabel = this.labels('label.heading.charges');
  /** Whether the record does not exist — the route named no loan id or an id that is not a Fineract resource identifier, or Fineract answered 404 — in which case the template renders the not-found message in place of the record (AAP 0.7.4). */
  readonly notFound = computed<boolean>(() => this.missingId() || this.error()?.status === 404);
  /** The failure this screen must render itself: a 4xx other than 404, whose Fineract message is shown verbatim with the screen still usable (AAP 0.7.4). The discriminator is deliberate: a 5xx or a transport failure (`status` 0) has already produced exactly one notification in the interceptor, so it answers `null` here and the message is never shown twice, and a 404 answers `null` because `notFound` owns that state. */
  readonly clientError = computed<ApiError | null>(() => {
    const failure = this.error();
    if (failure === null || failure.status < 400 || failure.status >= 500) {
      return null;
    }
    return failure.status === 404 ? null : failure;
  });
  /** The status indicator's key for the loan, reduced by the family's single mapping `toLoanStatusKey`: the Fineract status code never reaches the swatch component, and a loan that is not loaded yet paints the neutral key rather than claiming a state. */
  readonly statusKey = computed<StatusKey>(() => {
    const loaded = this.loan();
    return loaded === null ? 'other' : toLoanStatusKey(loaded.status?.code);
  });
  /** The five figures the summary block prints, in the order the block reads them: the loan-wide total and outstanding balance first, passed through from the schedule untouched, then the three balances {@link sumPeriodBalances} sums over the schedule's periods. Nothing is rounded, recalculated from other members or defaulted — a figure the payload does not report becomes `null`, which the template renders as an empty cell (Rule 1 clause 3; AAP 0.7.2 row `LoanSummary`). */
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
  /** The links the record renders: the rows of {@link LOAN_ACTIONS} the loan's current state offers, each carrying the router commands for the id on screen. The only derivation is that filter — the loan's numeric status id against each row's `statuses` — so the entry points are the legacy record's own, in its order, each gated on the code the screen it opens declares: {@link LOAN_ACTION_PERMISSIONS} or {@link LOAN_CHARGE_PERMISSION}, which `loans.routes.ts` reads as those routes' `data.permission`, so the link and that route's guard cannot disagree (AAP 0.1.1, AAP 0.4.2, AAP 0.14.1); a loan that has not loaded, or whose payload reported no status, offers no action at all, the reading the legacy record itself takes (Rule 1 clause 3). */
  readonly actions = computed<readonly LoanActionLink[]>(() => {
    const status = this.loan()?.status;
    if (status === undefined) {
      return [];
    }
    return LOAN_ACTIONS.filter((action) => action.statuses.includes(status.id)).map(
      (action): LoanActionLink => ({
        id: action.id,
        labelKey: action.labelKey,
        permission: action.permission,
        commands: action.route(this.loanId()),
      }),
    );
  });
  /** The permission the charge section's own pay and waive links are gated on — `UPDATE_LOAN`, the code `loans.routes.ts` declares for the charge screens those links reach — handed to `app-loan-charges` unchanged, while the record's own entry points each carry their code in {@link LOAN_ACTIONS} (AAP 0.14.1). */
  readonly actionPermission = 'UPDATE_LOAN';
  /** The record's tabs, in the order they are shown: the repayment schedule first, the transactions second, the charges third (AAP 0.7.4). Every caption is the legacy bundle's own tab heading — the same three headings `app/views/loans/viewloanaccountdetails.html` gives its tabs — resolved to display text here because the tab strip renders its labels verbatim. */
  readonly tabs = computed<readonly TabDescriptor[]>(() => [
    { id: SCHEDULE_TAB, label: this.scheduleTabLabel() },
    { id: TRANSACTIONS_TAB, label: this.transactionsTabLabel() },
    { id: CHARGES_TAB, label: this.chargesTabLabel() },
  ]);
  readonly activeTab = signal<LoanViewTab>(SCHEDULE_TAB);
  /** Whether the repayment-schedule section is the one on screen; the template branches on this rather than comparing the active id to a literal, so the three tab ids keep one home in this file. */
  readonly showSchedule = computed<boolean>(() => this.activeTab() === SCHEDULE_TAB);
  readonly showTransactions = computed<boolean>(() => this.activeTab() === TRANSACTIONS_TAB);
  readonly showCharges = computed<boolean>(() => this.activeTab() === CHARGES_TAB);
  /** The id the shared strip gives the tab whose own id is passed in, as each section's `aria-labelledby` uses it: the section on screen is the panel of the active tab and names that tab's element by the same id the strip put on it (AAP 0.2.3 row `TabStrip`). */
  protected readonly tabDomId = tabDomId;
  constructor() {
    // One subscription, never a `snapshot` read beside it: the router reuses this component when the URL moves from one record to another, and a single read would leave the first loan's record, figures and action links on screen under the second loan's URL. Each emission therefore resets the screen and re-runs the read for the loan the URL now names, the way `loan-edit` and `client-actions` handle the same reuse.
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params: ParamMap) => {
        this.loanId.set(params.get('id') ?? '');
        this.reset();
        void this.load();
      });
  }
  /** Clears everything the previous loan put on the screen, so an emission for another record never shows the earlier one's figures, charges, failure or action links: `loading` goes back to `true` until the new read settles, the record reopens on its first tab, and the not-found outcome of the previous route is dropped. */
  private reset(): void {
    this.loan.set(null);
    this.charges.set(null);
    this.error.set(null);
    this.missingId.set(false);
    this.activeTab.set(SCHEDULE_TAB);
    this.loading.set(true);
  }
  /** Reads the loan for the emission that is current, then paints the record and its charges together — one read, because the record carries the schedule, the transactions and the loan's charges (AAP 0.14.2). A route that names no loan issues no request: `missingId` drives the not-found branch and `loading` is cleared here, because no read will settle either. A route whose id is not a Fineract resource identifier — `#/viewloanaccount/abc`, a truncated or hand-typed link — takes that same branch: it names no loan either, so no request is issued and the not-found message replaces the record instead of the id reaching a path segment `LoanService.get` would have to refuse (AAP 0.7.4; Rule 1 clause 2). */
  private async load(): Promise<void> {
    const load = ++this.loadSequence;
    const loanId = this.loanId();
    if (loanId.length === 0) {
      // No request is issued for a route that names no loan, so this is the one path on which `loading` is cleared without a read settling it: leaving it `true` would keep the screen on its loading state for ever and the not-found branch could never paint.
      this.missingId.set(true);
      this.loading.set(false);
      return;
    }
    if (!isResourceId(loanId)) {
      // The URL names something that is not a loan, so no request is issued and the not-found branch paints. Asking the predicate before the read — rather than catching the refusal `resourceId()` would throw inside `LoanService.get` — keeps a request off the wire for an address that cannot be addressed and keeps `loading` from being raised for a read that never runs; `missingId` is the same signal the branch above drives, so the two cases in which the route names no loan reach the screen through one state (AAP 0.7.4; Rule 1 clause 2).
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
      if (this.isCurrent(load)) {
        this.loading.set(false);
      }
    }
  }
  /** Whether a run still speaks for the screen — it is the newest run, and the screen it belongs to has not been destroyed — so a read the route or the teardown cancelled can neither paint nor clear the loading state of whatever replaced it. */
  private isCurrent(load: number): boolean {
    return !this.destroyRef.destroyed && load === this.loadSequence;
  }
  /** Shows the tab the user picked in the strip: the strip reports an opaque id, so an id this record does not serve is ignored rather than stored, and `activeTab` can only ever hold one of the three tabs. @param id the id. */
  activateTab(id: string): void {
    if (id === SCHEDULE_TAB || id === TRANSACTIONS_TAB || id === CHARGES_TAB) {
      this.activeTab.set(id);
    }
  }
  /** The `ApiError` a failed read is reported as: the interceptor maps every `HttpErrorResponse` into an `ApiError` before rethrowing it, so the defensive branch is unreachable through the application and exists only so that a future failure shape degrades into the same type instead of escaping as an unhandled value. */
  private asApiError(cause: unknown): ApiError {
    if (cause instanceof ApiError) {
      return cause;
    }
    const message = cause instanceof Error && cause.message.length > 0 ? cause.message : 'HTTP 0';
    return new ApiError(message, 0);
  }
}
