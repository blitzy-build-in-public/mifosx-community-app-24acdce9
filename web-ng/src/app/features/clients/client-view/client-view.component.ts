import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, type ParamMap } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { finalize } from 'rxjs';

import { AppConfigService } from '../../../core/config/app-config.service';
import { ApiError } from '../../../core/http/api-error';
import { fromFineractDate, toFineractDate } from '../../../shared/date-format.util';
import { PanelCardComponent } from '../../../shared/panel-card/panel-card.component';
import { toClientStatusKey, type Client } from '../client.models';
import { CLIENT_ACTION_PERMISSIONS } from '../client-actions/client-actions.component';
import { ClientService } from '../client.service';
import {
  ActionButtonGroupComponent,
  type ClientActionButton,
} from './action-button-group/action-button-group.component';
import { ClientAccountsComponent } from './client-accounts/client-accounts.component';
import { ClientIdentifiersComponent } from './client-identifiers/client-identifiers.component';
import { ClientSummaryComponent } from './client-summary/client-summary.component';
import { ProfileCardComponent, type ProfileCardField } from './profile-card/profile-card.component';
import { RecordHeaderComponent } from './record-header/record-header.component';
import { TabStripComponent, type TabDescriptor } from './tab-strip/tab-strip.component';

/**
 * The two tabs the client record renders: `General` and `Identities`, and nothing else
 * (AAP 0.7.4 "Client view"; AAP 0.10.5 deliberate difference 6, which keeps Family Members,
 * Documents, Notes and Credit Report off this record because each belongs to a migration unit
 * outside the scope).
 */
type ClientRecordTab = 'general' | 'identities';

/**
 * The tab ids as a lookup, so a `tabChange` emission can be validated against the union without a
 * cast and without a second list that could drift from it.
 *
 * `satisfies Record<ClientRecordTab, true>` makes a tab missing from this object, or one the union
 * no longer holds, a compile error; {@link isClientRecordTab} then carries that compile-time proof
 * into the type system instead of asserting it about a string.
 */
const CLIENT_RECORD_TABS = {
  general: true,
  identities: true,
} satisfies Record<ClientRecordTab, true>;

/**
 * Whether a tab id the strip reported is one of the record's two tabs.
 *
 * `Object.hasOwn` rather than `in`, so a value such as `toString` or `constructor` is refused
 * instead of passing on an inherited member of the object's prototype.
 *
 * @param value the id `TabStripComponent` emitted.
 * @returns true when the value names a tab this record renders.
 */
function isClientRecordTab(value: string): value is ClientRecordTab {
  return Object.hasOwn(CLIENT_RECORD_TABS, value);
}

/**
 * The `Performance History` rows the record's profile card renders, as the legacy bundle's label
 * keys and in the order legacy's `app/views/clients/viewclient.html` paints them.
 *
 * One exported list, so a label corrected after a screen comparison is fixed in one place. The value
 * beside each label is a `ClientSummary` member legacy reads (`loanCycle`, `lastLoanAmount`,
 * `activeLoans`, `totalSavings`, `activeSavings`); `Client` deliberately does not model that member,
 * because no in-scope workflow reads it, so every row renders its label beside an empty value rather
 * than a number the API never sent (AAP 0.7.4; Rule 1 clauses 3 and 4).
 */
export const CLIENT_HISTORY_LABEL_KEYS: readonly string[] = [
  'label.heading.numofloancycle',
  'label.lastloanamount',
  'label.numofactiveloans',
  'label.totalsavings',
  'label.numofactivesavings',
];

/**
 * The individual client record — `#/viewclient/:id`, the last screen of the "Sign in and open a client record"
 * flow and the entry point of workflow W3's record read and of the actions and edits it links to (AAP 0.7.1
 * Features row `clients`; AAP 0.7.4 "Client view (`#/viewclient/:id`)"; AAP 0.8.2 feature route
 * `viewclient/:id`).
 *
 * One read, owned by the family's service: `ClientService.get(id)` — `GET /clients/{id}` (AAP 0.7.3 row "W3
 * search and view client") — whose record the presentational blocks render, while the `General` tab's accounts
 * table and the `Identities` tab issue their own reads through that service. This file holds no URL, host, API
 * path, query parameter, request body or HTTP client (Rule 1 clauses 2 and 5; AAP 0.14.1 "Every URL literal
 * lives in a service").
 *
 * One id, one load per navigation: the `:id` comes from `route.paramMap`, never the snapshot, because the
 * router reuses this component between `#/viewclient/{id}` URLs as `client-actions` and `loan-edit` do, so
 * each emission clears the previous client's record, message and selected tab and re-reads the client the URL
 * names; a response arriving after the URL moved on is discarded rather than painted (see
 * {@link loadSequence}).
 *
 * Four states (AAP 0.7.4 "States every list and record screen must implement"): `loading` paints nothing, the
 * design carrying no spinner or placeholder (AAP 0.2.4); a 404 or a route with no id drives `notFound`,
 * rendered in place of the record; any other 4xx drives `clientError`, whose Fineract message renders
 * verbatim; a 5xx or transport failure leaves both null, the interceptor having raised exactly one
 * notification (AAP 0.4.2). Nothing here calls `NotificationService`, logs or rethrows.
 *
 * Two tabs and nothing more — `General` and `Identities`, painted by `TabStripComponent` from the descriptors
 * it is given, so Family Members, Documents, Notes and Credit Report cannot appear (AAP 0.10.5 item 6). Every
 * action is permission-gated on legacy's own code: `Edit`, `New Loan`, `Close` and the `More` menu's
 * `Activate`, `Reject`, `Withdraw` and `Reactivate`, the last only while the record is closed (AAP 0.7.4),
 * carrying the permissions of `app/scripts/models/clientStatus.js` on the descriptors {@link actionButtons}
 * builds, which `ActionButtonGroupComponent` gates through `HasPermissionDirective` — the service
 * `permissionGuard` asks — so a button cannot outlive its route (AAP 0.1.1). The action faces are posted by
 * `client-actions.component.ts` at `#/client/:id/:action`; client charges, transfer, staff assignment,
 * signature, avatar upload and camera are not rendered (AAP 0.10.5).
 *
 * The profile card's activation date is the only date formatted here, through `DISPLAY_DATE_FORMAT` in the
 * locale `AppConfigService.activeLocale` reports, and nothing reads the clock (AAP 0.7.2 "Date handling"). The
 * status is the design's colour indicator, never its word (AAP 0.10.5 item 11). Presentation belongs to the
 * template and the global Bootstrap 3 layer in `web-ng/src/styles.scss` (Rule 1 clause 6; AAP 0.4.4 decision
 * 4), and nothing is logged (Rule 1 clause 9).
 */
@Component({
  selector: 'app-client-view',
  imports: [
    TranslatePipe,
    PanelCardComponent,
    ActionButtonGroupComponent,
    RecordHeaderComponent,
    TabStripComponent,
    ClientSummaryComponent,
    ClientAccountsComponent,
    ClientIdentifiersComponent,
    ProfileCardComponent,
  ],
  templateUrl: './client-view.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientViewComponent {
  /** The clients family's one typed Fineract service; this component's only HTTP path (Rule 1 clause 5). */
  private readonly clients = inject(ClientService);

  /**
   * The activated route, subscribed to for the `:id` of `#/viewclient/:id` so the id follows every
   * emission instead of the value the URL held when the component was built.
   */
  private readonly route = inject(ActivatedRoute);

  /**
   * Completes the route subscription, and cancels an outstanding record read, should the screen be
   * destroyed before either settles.
   */
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Which load is the current one, incremented by every run of {@link load}.
   *
   * The router reuses this component when the URL moves from one `#/viewclient/{id}` to another, so
   * an in-place move starts a second read while the first can still be in flight and the earlier one
   * can answer last. A superseded run compares its own number with this one when its answer arrives
   * and writes nothing, so a late response can neither paint the earlier client under the later
   * client's URL nor clear the loading state of the run that replaced it — the guard
   * `loan-edit.component.ts` and `client-actions.component.ts` keep over their own load sequences.
   */
  private loadSequence = 0;

  /**
   * Supplies the two tab labels and the profile card's row labels as display text, because both
   * blocks take plain strings rather than keys a `TranslatePipe` could re-resolve.
   */
  private readonly translate = inject(TranslateService);

  /**
   * Supplies the locale the one date this component prints is rendered in — `activeLocale`, the
   * language the switcher currently has selected. Only the profile card's activation-date row needs
   * it: every other date on the record belongs to a block that formats it through the same single
   * pattern (AAP 0.7.2 "Date handling").
   */
  private readonly config = inject(AppConfigService);

  /**
   * The client id the URL currently names, as text: the `:id` of `#/viewclient/:id`. Empty when the
   * route carried none, which is the only case in which the record read is not issued.
   *
   * A signal fed by `route.paramMap`, never a `snapshot` read: the router reuses this component when
   * the URL moves from one `#/viewclient/{id}` to another, so the id has to follow every emission
   * and every reader of it — the read and each action href — has to see the client the URL names now
   * (`loan-edit.component.ts`, "one id, one load per navigation").
   *
   * Kept as the raw segment rather than parsed with `Number()`, because it is both the service's
   * `number | string` parameter and the route parameter of every link this record renders, so it is
   * spelled in the read and in the action URLs exactly as the route held it.
   */
  readonly clientId = signal<string>('');

  /**
   * Whether the record read is still outstanding. Starts `true` so no half-built record and no
   * empty state can flash before the first response is read, and is cleared in `finalize`.
   */
  readonly loading = signal(true);

  /** The record the screen renders, or `null` until a response arrives and after a failed read. */
  readonly client = signal<Client | null>(null);

  /** The failure the read ended in, or `null`; the template derives its error branches from this. */
  readonly error = signal<ApiError | null>(null);

  /**
   * Whether the client id the URL names is empty; cleared by {@link reset} and set again by
   * {@link load} on every route emission, so it always describes the current URL.
   */
  private readonly missingId = signal(false);

  /**
   * Whether the record does not exist — the route named no id, or Fineract answered 404 — in which
   * case the template renders the not-found message in place of the record (AAP 0.7.4).
   */
  readonly notFound = computed<boolean>(() => this.missingId() || this.error()?.status === 404);

  /**
   * The failure this screen renders itself: a 4xx other than 404, whose Fineract message the
   * template shows verbatim with the shell left usable (AAP 0.7.4; workflow W7's rule).
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
   * The record's own crumb: the client's office name followed by the separator the design shows —
   * `Head Office /` for the record the design captured, and the client's true office for every other
   * record.
   *
   * Derived from the loaded client rather than hard-coded and rather than read from the route's
   * static `data['breadcrumb']`, because that is what makes it truthful: legacy's record template
   * renders `{{client.officeName}}` in its own `.breadcrumb`
   * (`app/views/clients/viewclient.html:2-5`), so the trail describes the client on screen rather
   * than the route that got there. Empty until a record arrives, so a loading or a failed read paints
   * no crumb at all (AAP 0.7.4 "Client view").
   */
  readonly officeCrumb = computed<string>(() => {
    const office = this.client()?.officeName;

    return office === undefined || office.length === 0 ? '' : `${office} /`;
  });

  /**
   * The tabs the strip renders, in the design's order: `General` then `Identities`, labelled with
   * the legacy bundle's own keys (`label.heading.general`, `label.heading.identities`), which are
   * the headings legacy's `viewclient.html` gives these two tabs (Rule 1 clause 6).
   */
  readonly tabs = computed<readonly TabDescriptor[]>(() => {
    // Read so a language switch re-renders the two labels rather than leaving the first language's
    // wording on screen; the constructor bumps it on both translate events.
    this.labelsRevision();
    this.translate.currentLang();

    return [
      { id: 'general', label: this.translate.instant('label.heading.general') },
      { id: 'identities', label: this.translate.instant('label.heading.identities') },
    ];
  });

  /**
   * The tab currently shown, starting on `General` as the design's record shows it (Figma node
   * `1:4`, AAP 0.2.1 step 3). Only a value {@link selectTab} accepted can be written here.
   */
  readonly activeTabId = signal<ClientRecordTab>('general');

  /**
   * The right-hand profile card's own rows: the client's fields, in the order the legacy record
   * paints them, with a field the record leaves unset rendered as the empty string rather than a
   * placeholder (AAP 0.7.4; Rule 1 clause 3).
   *
   * Five rows — the client number, the external id, the office, the staff and the activation date —
   * which are the card's values the API actually supplies. The activation date is read from
   * `Client.activationDate`, the field `GET /clients/{id}` sends as a `FineractDate`, and formatted
   * once here through the one display pattern in the active locale rather than in the template,
   * because the card takes already-resolved strings (AAP 0.7.2 "Date handling"). A client still
   * pending carries no activation date, so that row's value is empty exactly as the design shows an
   * unfilled row. An unloaded record has no rows at all, so the card renders its heading and an empty
   * body rather than claiming values it does not have.
   */
  readonly profileFields = computed<readonly ProfileCardField[]>(() => {
    const record = this.client();

    if (record === null) {
      return [];
    }

    // The same language revision the tab labels read, for the same reason: the row labels are
    // resolved text, not keys the template resolves itself.
    this.labelsRevision();
    this.translate.currentLang();

    return [
      {
        label: this.translate.instant('label.heading.clientno'),
        value: record.accountNo ?? '',
      },
      {
        label: this.translate.instant('label.input.externalid'),
        value: record.externalId ?? '',
      },
      {
        label: this.translate.instant('label.input.office'),
        value: record.officeName ?? '',
      },
      {
        label: this.translate.instant('label.input.staff'),
        value: record.staffName ?? '',
      },
      {
        label: this.translate.instant('label.input.activationdate'),
        value:
          toFineractDate(fromFineractDate(record.activationDate), this.config.activeLocale()) ?? '',
      },
    ];
  });

  /**
   * The rows under the card's `Performance History` sub-heading, in {@link CLIENT_HISTORY_LABEL_KEYS}
   * order, each carrying an empty value because `Client` does not model the `ClientSummary` the values
   * come from.
   *
   * The rows are still rendered: legacy's record paints the five labels whether or not the summary is
   * present, and the design shows a card whose history rows carry no value, so omitting them would be
   * a change to what the screen shows rather than a simplification of it (AAP 0.7.4; Rule 1 clause 3).
   */
  readonly historyFields = computed<readonly ProfileCardField[]>(() => {
    if (this.client() === null) {
      return [];
    }

    this.labelsRevision();
    this.translate.currentLang();

    return CLIENT_HISTORY_LABEL_KEYS.map((labelKey: string) => ({
      label: this.translate.instant(labelKey),
      value: '',
    }));
  });

  /**
   * Permission of the `Edit` entry point: legacy's own gate on the record's edit button
   * (`UPDATE_CLIENT`, `app/scripts/models/clientStatus.js`), which is also the code the legacy edit
   * form gates its submit control on.
   */
  readonly editPermission = 'UPDATE_CLIENT';

  /**
   * Permission of the `New Loan` entry point: legacy's own gate on the record's new-loan button
   * (`CREATE_LOAN`, `app/scripts/models/clientStatus.js`), which is the code the W4 loan application
   * that this link opens is authorised by.
   */
  readonly newLoanPermission = 'CREATE_LOAN';

  /**
   * Permission of the `Activate` entry point: legacy's own gate on the record's activate button
   * (`ACTIVATE_CLIENT`), one of the five lifecycle commands `client-actions.component.ts` posts.
   */
  readonly activatePermission = CLIENT_ACTION_PERMISSIONS.activate;

  /** Permission of the `Close` entry point: legacy's own gate (`CLOSE_CLIENT`). */
  readonly closePermission = CLIENT_ACTION_PERMISSIONS.close;

  /** Permission of the `Reject` entry point: legacy's own gate (`REJECT_CLIENT`). */
  readonly rejectPermission = CLIENT_ACTION_PERMISSIONS.reject;

  /** Permission of the `Withdraw` entry point: legacy's own gate (`WITHDRAW_CLIENT`). */
  readonly withdrawPermission = CLIENT_ACTION_PERMISSIONS.withdraw;

  /**
   * Permission of the `Reactivate` entry point: legacy's own gate (`REACTIVATE_CLIENT`), which the
   * fork issues as permission id 618 and which legacy's `Closed` status carries as the one button
   * that state offers. It is deliberately not `ACTIVATE_CLIENT`: a user holding only the activation
   * code would then be shown a control the server refuses (Rule 1 clause 3; AAP 0.1.1).
   */
  readonly reactivatePermission = CLIENT_ACTION_PERMISSIONS.reactivate;

  /**
   * Whether the record on screen is a closed one, which is the single condition the action row adds
   * `Reactivate` on.
   *
   * Read through `toClientStatusKey`, the family's delegate to the one status mapping the whole
   * application shares, so the entry appears on exactly the records the design's closed colour marks
   * (AAP 0.7.4, "plus `Reactivate` for the states that allow it"; AAP 0.10.5 item 11). No other entry
   * is gated on the record's state: the plan keeps the rest of the action set fixed, and gating them
   * further would be the improvement Rule 1 clause 3 forbids. Legacy gates this control on its own
   * permission as well (`REACTIVATE_CLIENT` in `app/scripts/models/clientStatus.js`), which
   * {@link reactivatePermission} and the action group's gate still enforce.
   *
   * The key is the design's folded one, so it covers every terminal client state — closed, rejected,
   * withdrawn — each of which the legacy record answers with a command of its own (`undoReject`,
   * `undoWithdrawn`). Those two commands are outside this build's action set, so a terminal record
   * offers the one command the plan keeps for it rather than none.
   */
  private readonly clientIsClosed = computed<boolean>(() => {
    const record = this.client();

    return record !== null && toClientStatusKey(record.status.code) === 'closed';
  });

  /**
   * The record's action row, as the descriptors `ActionButtonGroupComponent` renders (AAP 0.2.3 row
   * `ActionButtonGroup`; AAP 0.7.4 "Client view"): `Edit`, `New Loan` and `Close` in
   * the visible row, then `Activate`, `Reject` and `Withdraw` in its `More` menu, in the order the
   * legacy record lays them out, with `Reactivate` appended for a closed record alone
   * ({@link clientIsClosed}).
   *
   * Every field is the legacy record's own — the shipped bundle's label key, the Font Awesome 4 class
   * the design shows, and the permission code the constants above name — so no key, glyph or code is
   * spelled twice and the plan's action set stays a single statement. Each `routerLink` is built from
   * {@link clientId} rather than from a snapshot, because the router reuses this component when the
   * URL moves from one `#/viewclient/{id}` to another: the new list is what tells the action group
   * that the row it renders now belongs to another client, and it is what closes the `More` menu the
   * previous client's record left open.
   */
  readonly actionButtons = computed<readonly ClientActionButton[]>(() => {
    const clientId = this.clientId();

    // No id, no entry: every `routerLink` below is built from the id the URL names, so a route that
    // names no client yields no descriptor rather than a link whose target is an empty segment.
    if (clientId.length === 0) {
      return [];
    }

    const actions: ClientActionButton[] = [
      {
        label: 'label.button.edit',
        icon: 'fa-edit',
        permission: this.editPermission,
        routerLink: `/editclient/${clientId}`,
      },
      {
        label: 'label.button.newloan',
        icon: 'fa-plus',
        permission: this.newLoanPermission,
        routerLink: `/newclientloanaccount/${clientId}`,
      },
      {
        label: 'label.button.close',
        icon: 'fa-times-circle-o',
        permission: this.closePermission,
        routerLink: `/client/${clientId}/close`,
      },
      {
        label: 'label.button.activate',
        permission: this.activatePermission,
        routerLink: `/client/${clientId}/activate`,
        menu: true,
      },
      {
        label: 'label.button.reject',
        permission: this.rejectPermission,
        routerLink: `/client/${clientId}/reject`,
        menu: true,
      },
      {
        label: 'label.button.withdraw',
        permission: this.withdrawPermission,
        routerLink: `/client/${clientId}/withdraw`,
        menu: true,
      },
    ];

    // The one state-dependent entry, appended where legacy's `Closed` status lists it: last in the
    // menu, and absent from a record that is not closed because the command would be refused.
    if (this.clientIsClosed()) {
      actions.push({
        label: 'label.button.reactivate',
        permission: this.reactivatePermission,
        routerLink: `/client/${clientId}/reactivate`,
        menu: true,
      });
    }

    return actions;
  });


  /** Legacy key of the not-found heading, the same one the unknown-path screen renders. */
  readonly notFoundHeadingKey = 'label.heading.notavailable';

  /** Legacy key of the not-found sentence, worded as the platform words a missing resource. */
  readonly notFoundMessageKey = 'error.msg.resource.not.found';

  /**
   * Legacy key of the accounts section's heading. The section covers the client's loan and savings
   * accounts together, and `label.heading.accountdetail` ("Account Detail") is the shipped bundle's
   * own wording for exactly that pairing — no locale bundle defines an `ACCOUNTS` heading, so no key
   * is invented for one (Rule 1 clause 6).
   */
  readonly accountsHeadingKey = 'label.heading.accountdetail';

  /**
   * Counts the moments at which a label must be resolved again: a language switch and a bundle
   * arriving. Both are read inside every label signal above, so a label resolved before its bundle
   * had loaded is replaced by the real wording instead of staying at the fallback for the life of
   * the screen.
   */
  private readonly labelsRevision = signal(0);

  /**
   * Subscribes to the route's parameters, which is the screen's whole entry point.
   *
   * One subscription, never a `snapshot` read beside it: Angular reuses this component when the URL
   * moves from one `#/viewclient/{id}` to another, so a value read once would leave the first
   * client's record, profile card and action hrefs on screen for the second client's URL. Every
   * emission therefore clears what the previous client put there and reads the client the URL now
   * names (`loan-edit.component.ts`, "one id, one load per navigation"; `client-actions.component.ts`,
   * which handles the same reuse for the lifecycle screens).
   */
  constructor() {
    const refreshLabels = (): void => this.labelsRevision.update((revision) => revision + 1);

    this.translate.onLangChange.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(refreshLabels);
    this.translate
      .onTranslationChange.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(refreshLabels);

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params: ParamMap) => {
        this.clientId.set(params.get('id') ?? '');
        this.reset();
        this.load();
      });
  }

  /**
   * Reads the client the URL names and paints it.
   *
   * A route that names no client issues no request: `missingId` drives the not-found branch and
   * `loading` is cleared here, because no subscription will finalise it.
   *
   * Every run takes the next {@link loadSequence} number and a run the route has since superseded
   * writes nothing at all — not the record, not the failure, and not `loading`, which belongs to the
   * run that replaced it. `takeUntilDestroyed` unsubscribes the read, so leaving the screen
   * mid-flight cancels it rather than letting its answer land on a destroyed component.
   */
  private load(): void {
    const load = ++this.loadSequence;
    const clientId = this.clientId();

    if (clientId.length === 0) {
      // No request is issued for a route that names no client, so this is the one path on which
      // `loading` is cleared without a subscription finalising it: leaving it `true` would keep the
      // screen on its loading state for ever and the not-found branch could never paint.
      this.missingId.set(true);
      this.loading.set(false);

      return;
    }

    this.clients
      .get(clientId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          // Only the current run owns the loading state: a superseded one must not clear the flag
          // the newer read set, or the screen would stop reporting that it is still filling.
          if (load === this.loadSequence) {
            this.loading.set(false);
          }
        }),
      )
      .subscribe({
        next: (loaded) => {
          // A superseded client's answer is dropped here rather than painted under the client the
          // URL now names.
          if (load === this.loadSequence) {
            this.client.set(loaded);
          }
        },
        // Never rethrown and never notified here: the interceptor has already raised the single
        // message a 5xx or transport failure gets, and a 4xx reaches the template through
        // `clientError` or `notFound`.
        error: (cause: unknown) => {
          if (load === this.loadSequence) {
            this.error.set(this.asApiError(cause));
          }
        },
      });
  }

  /**
   * Clears everything the previous client put on the screen, so a route emission for another client
   * never shows the earlier client's record, failure or selected tab while the new read is
   * outstanding. `loading` goes back to `true` for the same reason.
   *
   * The `More` menu is deliberately not part of this reset: `ActionButtonGroupComponent` owns its open
   * state and closes it whenever the descriptor list it renders changes, which a new {@link clientId}
   * makes it do, so the row can never paint with the previous client's menu open.
   */
  private reset(): void {
    this.client.set(null);
    this.error.set(null);
    this.missingId.set(false);
    this.loading.set(true);
    this.activeTabId.set('general');
  }

  /**
   * Shows the tab the strip reported, and only one this record renders: an id outside the union is
   * ignored rather than written to the state a template branch reads.
   *
   * @param id the tab id `TabStripComponent` emitted.
   */
  selectTab(id: string): void {
    if (isClientRecordTab(id)) {
      this.activeTabId.set(id);
    }
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
