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
import { isResourceId } from '../../../core/http/path-segment.util';
import { ApiError } from '../../../core/http/api-error';
import { fromFineractDate, toFineractDate } from '../../../shared/date-format.util';
import { PanelCardComponent } from '../../../shared/panel-card/panel-card.component';
import { RecordNotFoundComponent } from '../../../shared/record-not-found/record-not-found.component';
import { normaliseStatusCode } from '../../../shared/status-key.util';
import { TabStripComponent, tabDomId, type TabDescriptor } from '../../../shared/tab-strip/tab-strip.component';
import { CLIENT_ACTION_PERMISSIONS, type Client } from '../client.models';
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

/** The two tabs the client record renders: `General` and `Identities`, and nothing else (AAP 0.7.4 "Client view";
 * AAP 0.10.5 item 6 keeps Family Members, Documents, Notes and Credit Report off this record, each belonging to a
 * migration unit outside the scope). */
type ClientRecordTab = 'general' | 'identities';

/**
 * The tab ids as a lookup, so a `tabChange` emission is validated against the union without a cast and without a
 * second list that could drift from it. `satisfies Record<ClientRecordTab, true>` makes a tab missing here, or one
 * the union no longer holds, a compile error; {@link isClientRecordTab} carries that proof into the type system.
 */
const CLIENT_RECORD_TABS = {
  general: true,
  identities: true,
} satisfies Record<ClientRecordTab, true>;

/**
 * Whether a tab id the strip reported is one of the record's two tabs. `Object.hasOwn` rather than `in`, so a value such as `toString` or `constructor` is refused
 * instead of passing on an inherited member of the prototype. @param value the id `TabStripComponent` emitted. @returns true when the value names a tab this record
 * renders.
 */
function isClientRecordTab(value: string): value is ClientRecordTab {
  return Object.hasOwn(CLIENT_RECORD_TABS, value);
}

/**
 * The `Performance History` rows the record's profile card renders, as the legacy bundle's label keys and in the order legacy's `app/views/clients/viewclient.html` paints them. One exported list, so a label
 * corrected after a screen comparison is fixed in one place. `Client` deliberately does not model the `ClientSummary` members beside those labels (`loanCycle`, `lastLoanAmount`, `activeLoans`, `totalSavings`,
 * `activeSavings`), because no in-scope workflow reads them, so every row renders its label beside an empty value rather than a number the API never sent (AAP 0.7.4; Rule 1 clauses 3 and 4).
 *
 */
export const CLIENT_HISTORY_LABEL_KEYS: readonly string[] = [
  'label.heading.numofloancycle',
  'label.lastloanamount',
  'label.numofactiveloans',
  'label.totalsavings',
  'label.numofactivesavings',
];

/**
 * The individual client record — `#/viewclient/:id`, the last screen of the "Sign in and open a client record" flow and the entry point of W3's record read and of the actions and edits it links to (AAP 0.7.1
 * Features row `clients`; AAP 0.7.4 "Client view (`#/viewclient/:id`)"; AAP 0.8.2 route `viewclient/:id`). One read, owned by the family's service: `ClientService.get(id)` — `GET /clients/{id}` (AAP 0.7.3 row
 * "W3 search and view client") — whose record the presentational blocks render, while the `General` tab's accounts table and the `Identities` tab issue their own reads through that service. This file holds no
 * URL, host, API path, query parameter, request body or HTTP client (Rule 1 clauses 2 and 5; AAP 0.14.1 "Every URL literal lives in a service").
 *
 * One id, one load per navigation: the `:id` comes from `route.paramMap`, never the snapshot, because the router reuses this component between `#/viewclient/{id}` URLs as `client-actions` and `loan-edit` do,
 * so each emission clears the previous client's record, message and selected tab and re-reads the client the URL names; a response arriving after the URL moved on is discarded rather than painted (see {@link
 * loadSequence}).
 *
 * Four states (AAP 0.7.4 "States every list and record screen must implement"): `loading` paints nothing, the design carrying no spinner or placeholder (AAP 0.2.4); a 404, or a route carrying no client id at
 * all — no id, or one that is not a Fineract identifier, which `isResourceId` answers before any request is issued — drives `notFound`, rendered in place of the record with the shell left usable; any other 4xx
 * drives `clientError`, whose Fineract message renders verbatim; a 5xx or transport failure leaves both computeds null, the single interceptor having already raised exactly one notification (AAP 0.4.2).
 * Nothing here notifies, logs or rethrows.
 *
 * Two tabs and nothing more, painted by `TabStripComponent` from the descriptors it is given (AAP 0.10.5 item 6). Every action is permission-gated on legacy's own code: `Edit`, `New Loan`, `Close` and the
 * `More` menu's `Activate`, `Reject`, `Withdraw` and `Reactivate`, the last only in the states that allow it (AAP 0.7.4), carrying `UPDATE_CLIENT`, `CREATE_LOAN`, `CLOSE_CLIENT`, `ACTIVATE_CLIENT`,
 * `REJECT_CLIENT`, `WITHDRAW_CLIENT` and `REACTIVATE_CLIENT` from `app/scripts/models/clientStatus.js` on the descriptors {@link actionButtons} builds, which `ActionButtonGroupComponent` gates through
 * `HasPermissionDirective` — the service `permissionGuard` asks — so a button cannot outlive its route (AAP 0.1.1). The action faces are posted by `client-actions.component.ts` at `#/client/:id/:action`;
 * client charges, transfer, staff assignment, signature, avatar upload and camera are not rendered (AAP 0.10.5).
 *
 * Which of them a record offers is its own status's set, exactly as legacy builds the list per state in `app/scripts/models/clientStatus.js`: pending offers `Edit` and `Close` with `Activate`, `Reject` and
 * `Withdraw` in the menu; active `Edit`, `New Loan` and `Close` and no menu entry; closed `Reactivate` alone; and a rejected, withdrawn or transferred record — or an invalid, unrecognised or absent code —
 * nothing, because the commands legacy answers those states with (`undoReject`, `undoWithdrawn`, the transfer commands) are outside this build's action set and `Reactivate`, which the lifecycle machine accepts
 * from a closed record only, would be refused there (Rule 1 clause 3). {@link clientLifecycleState} reads the state from the status code through `normaliseStatusCode`, never from the swatch's colour key, which
 * paints `closed` apart from the `rejected` and `withdraw` records it keeps on screen beside it (AAP 0.2.3). Every `routerLink` is built from {@link clientId} rather than a snapshot, so the row follows the URL
 * when the router reuses this component for another client's record (AAP 0.7.4).
 *
 * The profile card's activation date is the only date formatted here, through `DISPLAY_DATE_FORMAT` and `fromFineractDate`/`toFineractDate`, in the locale `AppConfigService.activeLocale` reports, and nothing
 * reads the clock; every other date on the record belongs to the block that displays it (AAP 0.7.2 "Date handling"). The status is the design's colour indicator and never its word — `RecordHeaderComponent`
 * paints it through `toClientStatusKey`, the family's delegate to the one mapping the whole application shares in `web-ng/src/app/shared/status-key.util.ts` (AAP 0.10.5 item 11) — and the same normalisation
 * decides which actions the record's state allows ({@link clientLifecycleState}). Presentation belongs to the template and the global Bootstrap 3 layer in `web-ng/src/styles.scss`, so this component declares
 * no stylesheet, inline style or colour (Rule 1 clause 6; AAP 0.4.4 decision 4): the action row is `ActionButtonGroupComponent`'s `.btn-group > .btn` with Bootstrap's own `.dropdown-menu` `More` menu in
 * Angular state, the plugin needing jQuery (AAP 0.5.2 row "Dropdown menu"), and the record's card is `.panel`. Nothing is logged: no client id, record body or credential reaches the console (Rule 1 clause 9).
 *
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
    RecordNotFoundComponent,
  ],
  templateUrl: './client-view.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientViewComponent {
  /** The clients family's one typed Fineract service; this component's only HTTP path (Rule 1 clause 5). */
  private readonly clients = inject(ClientService);

  /** The route, subscribed to for the `:id` of `#/viewclient/:id` so the id follows every emission, not the URL the component was built with. */
  private readonly route = inject(ActivatedRoute);

  /** Completes the route subscription and cancels an outstanding record read should the screen be destroyed first. */
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Which load is the current one, incremented by every run of {@link load}. The router reuses this component when the URL moves from one `#/viewclient/{id}` to another, so an in-place move starts a second
   * read while the first can still answer last; a superseded run compares its own number with this one and writes nothing, so a late response can neither paint the earlier client under the later client's URL
   * nor clear the newer run's loading state — the guard `loan-edit.component.ts` and `client-actions.component.ts` keep over their own load sequences.
   *
   */
  private loadSequence = 0;

  /** Supplies the two tab labels and the profile card's row labels as display text, because both blocks take plain strings rather than keys a `TranslatePipe` could re-resolve. */
  private readonly translate = inject(TranslateService);

  /** Supplies the locale the one date this component prints is rendered in — `activeLocale`, the language the switcher has selected (AAP 0.7.2 "Date handling"). */
  private readonly config = inject(AppConfigService);

  /**
   * The client id the URL currently names, as text: the `:id` of `#/viewclient/:id`, empty when the route carried none. Neither an empty id nor one that is not a Fineract identifier issues a read, because
   * neither addresses a client. A signal fed by `route.paramMap`, never a `snapshot` read, so the id follows every emission and each reader — the read and every action href — sees the client the URL names now.
   * Kept as the raw segment rather than parsed with `Number()`, because it is both the service's `number | string` parameter and the route parameter of every link this record renders (AAP 0.7.4).
   *
   */
  readonly clientId = signal<string>('');

  /** Whether the record read is still outstanding. Starts `true` so no half-built record and no empty state can flash before the first response, and is cleared in `finalize`. */
  readonly loading = signal(true);

  /** The record the screen renders, or `null` until a response arrives and after a failed read. */
  readonly client = signal<Client | null>(null);

  /** The failure the read ended in, or `null`; the template derives its error branches from this. */
  readonly error = signal<ApiError | null>(null);

  /**
   * Whether the id the URL names addresses no client at all — it is empty, or it is not a Fineract identifier
   * ({@link isResourceId}); cleared by {@link reset} and set again by {@link load} on every route emission, so it
   * always describes the current URL.
   */
  private readonly missingId = signal(false);

  /**
   * Whether the record does not exist — the route named no client, or Fineract answered 404 — in which case the
   * template renders the not-found message in place of the record (AAP 0.7.4).
   */
  readonly notFound = computed<boolean>(() => this.missingId() || this.error()?.status === 404);

  /**
   * The failure this screen renders itself: a 4xx other than 404, whose Fineract message the template shows verbatim with the shell left usable (AAP 0.7.4; workflow W7's rule). A 5xx or a transport failure
   * (`status` 0) has already produced exactly one notification in the interceptor, so it answers `null` and the message is never shown twice; a 404 answers `null` because `notFound` owns that state.
   *
   */
  readonly clientError = computed<ApiError | null>(() => {
    const failure = this.error();

    if (failure === null || failure.status < 400 || failure.status >= 500) {
      return null;
    }

    return failure.status === 404 ? null : failure;
  });

  /**
   * The record's own crumb: the client's office name and the design's separator — `Head Office /` for the record the design captured, the client's true office for every other. Derived from the loaded client
   * because that is what makes it truthful: legacy's record template renders `{{client.officeName}}` in its own `.breadcrumb` (`app/views/clients/viewclient.html:2-5`), so the trail describes the client on
   * screen rather than the route that got there. Empty until a record arrives, so a loading or failed read paints no crumb (AAP 0.7.4 "Client view").
   *
   */
  readonly officeCrumb = computed<string>(() => {
    const office = this.client()?.officeName;

    return office === undefined || office.length === 0 ? '' : `${office} /`;
  });

  /**
   * The tabs the strip renders, in the design's order: `General` then `Identities`, labelled with the legacy bundle's
   * own keys, the headings legacy's `viewclient.html` gives these two tabs (Rule 1 clause 6).
   */
  readonly tabs = computed<readonly TabDescriptor[]>(() => {
    // Read so a language switch re-renders the two labels rather than leaving the first language's wording on screen; the constructor bumps the revision on both translate events.
    this.labelsRevision();
    this.translate.currentLang();

    return [
      { id: 'general', label: this.translate.instant('label.heading.general') },
      { id: 'identities', label: this.translate.instant('label.heading.identities') },
    ];
  });

  /** The tab currently shown, starting on `General` as the design's record shows it (Figma node `1:4`, AAP 0.2.1 step 3). Only a value {@link selectTab} accepted can be written here. */
  readonly activeTabId = signal<ClientRecordTab>('general');

  /** The id the strip gives the tab whose own id is passed in, as the tab body's `aria-labelledby` uses it ({@link TabStripComponent}; AAP 0.2.3 row `TabStrip`). */
  protected readonly tabDomId = tabDomId;

  /**
   * The right-hand profile card's own rows: the client's fields, in the order the legacy record paints them, with a field the record leaves unset rendered as the empty string rather than a placeholder (AAP
   * 0.7.4; Rule 1 clause 3). Five rows — client number, external id, office, staff and activation date — the card's values the API actually supplies. The activation date is read from `Client.activationDate`,
   * the field `GET /clients/{id}` sends as a `FineractDate`, and formatted once here through the one display pattern in the active locale rather than in the template, because the card takes already-resolved
   * strings (AAP 0.7.2 "Date handling"). A client still pending carries no activation date, so that row's value is empty as the design shows an unfilled row, and an unloaded record has no rows at all, so the
   * card renders its heading and an empty body rather than claiming values.
   *
   */
  readonly profileFields = computed<readonly ProfileCardField[]>(() => {
    const record = this.client();

    if (record === null) {
      return [];
    }

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
   * The rows under the card's `Performance History` sub-heading, in {@link CLIENT_HISTORY_LABEL_KEYS} order, each carrying an empty value because `Client` does not model the `ClientSummary` the values come
   * from. The rows are still rendered: legacy's record paints the five labels whether or not the summary is present, and the design shows a card whose history rows carry no value, so omitting them would change
   * what the screen shows rather than simplify it (AAP 0.7.4; Rule 1 clause 3).
   *
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

  /** Permission of the `Edit` entry point: legacy's own gate on the record's edit button (`UPDATE_CLIENT`, `app/scripts/models/clientStatus.js`), which is also the code the legacy edit form gates its submit control on. */
  readonly editPermission = 'UPDATE_CLIENT';

  /** Permission of the `New Loan` entry point: legacy's own gate (`CREATE_LOAN`, `app/scripts/models/clientStatus.js`), the code the W4 loan application this link opens is authorised by. */
  readonly newLoanPermission = 'CREATE_LOAN';

  /** Permission of the `Activate` entry point: legacy's own gate (`ACTIVATE_CLIENT`), one of the five lifecycle commands `client-actions.component.ts` posts. */
  readonly activatePermission = CLIENT_ACTION_PERMISSIONS.activate;

  /** Permission of the `Close` entry point: legacy's own gate (`CLOSE_CLIENT`). */
  readonly closePermission = CLIENT_ACTION_PERMISSIONS.close;

  /** Permission of the `Reject` entry point: legacy's own gate (`REJECT_CLIENT`). */
  readonly rejectPermission = CLIENT_ACTION_PERMISSIONS.reject;

  /** Permission of the `Withdraw` entry point: legacy's own gate (`WITHDRAW_CLIENT`). */
  readonly withdrawPermission = CLIENT_ACTION_PERMISSIONS.withdraw;

  /**
   * Permission of the `Reactivate` entry point: legacy's own gate (`REACTIVATE_CLIENT`), which the fork issues as permission id 618 and which legacy's `Closed` status carries as the one button that state
   * offers. Deliberately not `ACTIVATE_CLIENT`: a user holding only the activation code would then be shown a control the server refuses (Rule 1 clause 3; AAP 0.1.1).
   *
   */
  readonly reactivatePermission = CLIENT_ACTION_PERMISSIONS.reactivate;

  /**
   * The lifecycle state of the loaded record, as the one normalisation the whole application shares flattens its Fineract status code: `pending`, `active`, `closed`, `rejected`, `withdraw`,
   * `transferinprogress`, `transferonhold` or `invalid` for the codes the fork's `ClientStatus` enum declares, and the empty string while no record is loaded. Legacy keys its action list on exactly these
   * states — `statusTypes` in `app/scripts/models/clientStatus.js` — so {@link actionButtons} reads this one value rather than testing each entry against a status of its own, and a code no case names falls
   * through to the empty set instead of matching an entry by accident (Rule 1 clause 3). It is asked of the status code and never of the swatch's colour key, because that key deliberately separates `closed`
   * from the two terminal states the clients list keeps on screen beside it, so the two have to be told apart here (AAP 0.2.3; AAP 0.14.1).
   *
   */
  private readonly clientLifecycleState = computed<string>(() => {
    const record = this.client();

    return record === null ? '' : normaliseStatusCode(record.status.code);
  });

  /**
   * The record's action row, as the descriptors `ActionButtonGroupComponent` renders (AAP 0.2.3 row `ActionButtonGroup`; AAP 0.7.4 "Client view"): `Edit` and `Close` in the visible row with `Activate`,
   * `Reject` and `Withdraw` in its `More` menu for a pending record; `Edit`, `New Loan` and `Close` in the row, and no menu entry, for an active one; and `Reactivate` alone, in the menu, for a closed one. The
   * set follows the record's own state, because legacy builds it per state in `app/scripts/models/clientStatus.js` and an entry that state does not allow could only end in the server's refusal (Rule 1 clause
   * 3; {@link clientLifecycleState}).
   *
   * Every field is the legacy record's own — the shipped bundle's label key, the Font Awesome 4 class the design shows, and the permission code the constants above name — so no key, glyph or code is spelled
   * twice. Each `routerLink` is built from {@link clientId} rather than a snapshot, because the router reuses this component when the URL moves to another client: the new list tells the action group the row
   * now belongs to another client, and it closes the `More` menu the previous record left open.
   *
   */
  readonly actionButtons = computed<readonly ClientActionButton[]>(() => {
    const clientId = this.clientId();

    // No id, no entry: every `routerLink` below is built from the id the URL names, so a route that names no client yields no descriptor rather than a link whose target is an empty segment.
    if (clientId.length === 0) {
      return [];
    }

    // One descriptor per command the record may offer, each spelled once: a state below selects the entries it allows, in legacy's order, instead of restating their fields.
    const edit: ClientActionButton = {
      label: 'label.button.edit',
      icon: 'fa-edit',
      permission: this.editPermission,
      routerLink: `/editclient/${clientId}`,
    };
    const newLoan: ClientActionButton = {
      label: 'label.button.newloan',
      icon: 'fa-plus',
      permission: this.newLoanPermission,
      routerLink: `/newclientloanaccount/${clientId}`,
    };
    const close: ClientActionButton = {
      label: 'label.button.close',
      icon: 'fa-times-circle-o',
      permission: this.closePermission,
      routerLink: `/client/${clientId}/close`,
    };
    const activate: ClientActionButton = {
      label: 'label.button.activate',
      permission: this.activatePermission,
      routerLink: `/client/${clientId}/activate`,
      menu: true,
    };
    const reject: ClientActionButton = {
      label: 'label.button.reject',
      permission: this.rejectPermission,
      routerLink: `/client/${clientId}/reject`,
      menu: true,
    };
    const withdraw: ClientActionButton = {
      label: 'label.button.withdraw',
      permission: this.withdrawPermission,
      routerLink: `/client/${clientId}/withdraw`,
      menu: true,
    };
    const reactivate: ClientActionButton = {
      label: 'label.button.reactivate',
      permission: this.reactivatePermission,
      routerLink: `/client/${clientId}/reactivate`,
      menu: true,
    };

    switch (this.clientLifecycleState()) {
      // Legacy's `Pending`: the application may still be committed or abandoned, so the row closes it and the menu carries the three lifecycle commands, in that state's own order.
      case 'pending':
        return [edit, close, activate, reject, withdraw];
      // Legacy's `Active`: the client is live, so the row opens a loan application and closes the record; no menu command belongs to it.
      case 'active':
        return [edit, newLoan, close];
      // Legacy's `Closed`: reactivation is the one command that state answers.
      case 'closed':
        return [reactivate];
      default:
        // Rejected, withdrawn, transfer in progress or on hold, invalid, unrecognised and no record at all: legacy's lists for these states name only commands this
        // build does not implement, so no entry is offered rather than one the server would refuse.
        return [];
    }
  });

  /**
   * Legacy key of the accounts section's heading. The section covers the client's loan and savings accounts together,
   * and `label.heading.accountdetail` ("Account Detail") is the shipped bundle's own wording for exactly that pairing
   * — no locale bundle defines an `ACCOUNTS` heading, so no key is invented for one (Rule 1 clause 6).
   */
  readonly accountsHeadingKey = 'label.heading.accountdetail';

  /**
   * Counts the moments at which a label must be resolved again: a language switch and a bundle arriving. Both are read
   * inside every label signal above, so a label resolved before its bundle had loaded is replaced by the real wording
   * instead of staying at the fallback for the life of the screen.
   */
  private readonly labelsRevision = signal(0);

  /**
   * Subscribes to the route's parameters, which is the screen's whole entry point. One subscription, never a `snapshot` read beside it: Angular reuses this component when the URL moves to another
   * `#/viewclient/{id}`, so a value read once would leave the first client's record, profile card and action hrefs on screen for the second client's URL (`loan-edit.component.ts`, "one id, one load per
   * navigation"; `client-actions.component.ts`, which handles the same reuse for the lifecycle screens).
   *
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
   * Reads the client the URL names and paints it. A route that names no client issues no request: `missingId` drives the not-found branch and `loading` is cleared here, because no subscription will finalise
   * it. A route whose id is not a Fineract identifier — `#/viewclient/abc`, a truncated or hand-typed link — takes that same branch: it names no client either, so no read is issued and the not-found message
   * replaces the record instead of the id reaching a path segment `ClientService.get` would have to refuse (AAP 0.7.4; Rule 1 clause 2). Every run takes the next {@link loadSequence} number and a run the route
   * has since superseded writes nothing at all — not the record, not the failure, and not `loading`, which belongs to the run that replaced it. `takeUntilDestroyed` unsubscribes the read, so leaving the screen
   * mid-flight cancels it rather than letting its answer land on a destroyed component.
   *
   */
  private load(): void {
    const load = ++this.loadSequence;
    const clientId = this.clientId();

    if (clientId.length === 0) {
      // No request is issued for a route that names no client, so this is the one path on which `loading` is cleared without a subscription finalising it: leaving it
      // `true` would keep the screen on its loading state for ever and the not-found branch could never paint.
      this.missingId.set(true);
      this.loading.set(false);

      return;
    }

    if (!isResourceId(clientId)) {
      // The URL names something that is not a client, so no request is issued and the not-found branch paints. Asking the predicate before the read — rather than catching the refusal `resourceId()` would throw
      // inside `ClientService.get` — keeps a request off the wire for an address that cannot be addressed and keeps `loading` from being raised for a read that never runs; `missingId` is the same signal the
      // branch above drives, so the two no-client cases reach the screen through one state (AAP 0.7.4; AAP 0.14.2).
      this.missingId.set(true);
      this.loading.set(false);

      return;
    }

    this.clients
      .get(clientId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (load === this.loadSequence) {
            this.loading.set(false);
          }
        }),
      )
      .subscribe({
        next: (loaded) => {
          if (load === this.loadSequence) {
            this.client.set(loaded);
          }
        },
        // Never rethrown and never notified here: the interceptor has already raised the single message a 5xx or transport failure gets, and a 4xx reaches the template through `clientError` or `notFound`.
        error: (cause: unknown) => {
          if (load === this.loadSequence) {
            this.error.set(this.asApiError(cause));
          }
        },
      });
  }

  /**
   * Clears everything the previous client put on the screen, so a route emission for another client never shows the
   * earlier client's record, failure or selected tab while the new read is outstanding; `loading` goes back to `true`
   * for the same reason. The `More` menu is deliberately not part of this reset: `ActionButtonGroupComponent` owns its
   * open state and closes it whenever the descriptor list it renders changes, which a new {@link clientId} makes it do.
   */
  private reset(): void {
    this.client.set(null);
    this.error.set(null);
    this.missingId.set(false);
    this.loading.set(true);
    this.activeTabId.set('general');
  }

  /**
   * Shows the tab the strip reported, and only one this record renders: an id outside the union is ignored rather than written to the state a template branch reads.
   * @param id the tab id `TabStripComponent` emitted.
   */
  selectTab(id: string): void {
    if (isClientRecordTab(id)) {
      this.activeTabId.set(id);
    }
  }

  /**
   * The `ApiError` a failed read is reported as. The interceptor maps every `HttpErrorResponse` into an `ApiError` before rethrowing it, so the defensive branch is
   * unreachable through the application and exists only so that a future failure shape degrades into the same type instead of escaping as an unhandled value: status
   * `0` (the transport-failure status the mapper uses) carries no `clientError`, and the interceptor's notification is the message the user sees. @param cause whatever
   * the read rejected with. @returns the failure as the one error type a component renders.
   */
  private asApiError(cause: unknown): ApiError {
    if (cause instanceof ApiError) {
      return cause;
    }

    const message = cause instanceof Error && cause.message.length > 0 ? cause.message : 'HTTP 0';

    return new ApiError(message, 0);
  }
}
