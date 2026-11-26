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
import { CLIENT_ACTION_PERMISSIONS } from '../client-actions/client-actions.component';
import { toClientStatusKey, type Client } from '../client.models';
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

/** The record's two tabs, `General` and `Identities`, and nothing else: Family Members, Documents, Notes and Credit Report are outside the scope (AAP 0.7.4; AAP 0.10.5 item 6). */
type ClientRecordTab = 'general' | 'identities';

/** The tab ids as a lookup, so a `tabChange` emission can be validated against the union without a cast: `satisfies` keeps it in step with the union and {@link isClientRecordTab} carries that proof into the type system. */
const CLIENT_RECORD_TABS = {
  general: true,
  identities: true,
} satisfies Record<ClientRecordTab, true>;

/** Whether a tab id the strip reported is one of the record's two tabs; `Object.hasOwn` rather than `in`, so a value such as `toString` is refused instead of passing on an inherited prototype member. */
function isClientRecordTab(value: string): value is ClientRecordTab {
  return Object.hasOwn(CLIENT_RECORD_TABS, value);
}

/** The `Performance History` rows the profile card renders, as the legacy bundle's keys in legacy's own order (`app/views/clients/viewclient.html`), one exported list so a corrected label is fixed in one place; `Client` models none of those members, so each row shows its label beside an empty value (AAP 0.7.4; Rule 1 clauses 3 and 4). */
export const CLIENT_HISTORY_LABEL_KEYS: readonly string[] = [
  'label.heading.numofloancycle',
  'label.lastloanamount',
  'label.numofactiveloans',
  'label.totalsavings',
  'label.numofactivesavings',
];

/** The individual client record (`#/viewclient/:id`), last screen of the design flow and W3's record read: one `ClientService.get(id)` — `GET /clients/{id}` — whose record the presentational blocks render, with one load (AAP 0.7.4, AAP 0.8.2). */
@Component({
  selector: 'app-client-view',
  imports: [
    TranslatePipe,
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
  /** The activated route, subscribed to for the `:id` of `#/viewclient/:id` so the id follows every emission instead of the value the URL held when the component was built. */
  private readonly route = inject(ActivatedRoute);
  /** Completes the route subscription, and cancels an outstanding record read, should the screen be destroyed before either settles. */
  private readonly destroyRef = inject(DestroyRef);

  /** Which load is the current one, incremented by every run of {@link load}: a superseded run writes nothing, so a late answer can neither paint the earlier client under the later client's URL nor clear the loading state of the run that replaced it. */
  private loadSequence = 0;

  /** Supplies the two tab labels and the profile card's row labels as display text, because both blocks take plain strings rather than keys a `TranslatePipe` could re-resolve. */
  private readonly translate = inject(TranslateService);

  /** Supplies the locale the one date this component prints is rendered in — `activeLocale`, the language the switcher currently has selected (AAP 0.7.2 "Date handling"). */
  private readonly config = inject(AppConfigService);

  /** The client id the URL currently names, kept as the raw segment rather than parsed with `Number()`: a signal fed by `route.paramMap`, never a `snapshot` read, because the router reuses this component on an in-place id change and both the read and every action href must see the id the URL names now. */
  readonly clientId = signal<string>('');

  /** Whether the record read is still outstanding. Starts `true` so no half-built record and no empty state can flash before the first response is read, and is cleared in `finalize`. */
  readonly loading = signal(true);

  /** The record the screen renders, or `null` until a response arrives and after a failed read. */
  readonly client = signal<Client | null>(null);

  /** The failure the read ended in, or `null`; the template derives its error branches from this. */
  readonly error = signal<ApiError | null>(null);

  /** Whether the client id the URL names is empty; cleared by {@link reset} and set again by {@link load} on every route emission, so it always describes the current URL. */
  private readonly missingId = signal(false);

  /** Whether the record does not exist — the route named no id, or Fineract answered 404 — in which case the template renders the not-found message in place of the record (AAP 0.7.4). */
  readonly notFound = computed<boolean>(() => this.missingId() || this.error()?.status === 404);

  /** The failure this screen renders itself: a 4xx other than 404, whose Fineract message the template shows verbatim with the shell left usable; a 5xx or a status-0 failure answers `null` because the interceptor has already notified, and a 404 answers `null` because `notFound` owns that state (AAP 0.7.4; W7). */
  readonly clientError = computed<ApiError | null>(() => {
    const failure = this.error();

    if (failure === null || failure.status < 400 || failure.status >= 500) {
      return null;
    }

    return failure.status === 404 ? null : failure;
  });

  /** The record's own crumb: the client's office name followed by the separator the design shows, derived from the loaded client as legacy's `{{client.officeName}}` in its own `.breadcrumb` is (`app/views/clients/viewclient.html:2-5`), so the trail describes the client on screen rather than the route that got there (AAP 0.7.4). */
  readonly officeCrumb = computed<string>(() => {
    const office = this.client()?.officeName;

    return office === undefined || office.length === 0 ? '' : `${office} /`;
  });

  /** The tabs the strip renders, in the design's order: `General` then `Identities`, labelled with the legacy bundle's own keys (`label.heading.general`, `label.heading.identities`), which are the headings legacy's (Rule 1 clause 6). */
  readonly tabs = computed<readonly TabDescriptor[]>(() => {
    // Read so a language switch re-renders the two labels rather than leaving the first language's wording on screen; the constructor bumps it on both translate events.
    this.labelsRevision();
    this.translate.currentLang();

    return [
      { id: 'general', label: this.translate.instant('label.heading.general') },
      { id: 'identities', label: this.translate.instant('label.heading.identities') },
    ];
  });

  /** The tab currently shown, starting on `General` as the design's record shows it (Figma node `1:4`, AAP 0.2.1 step 3). */
  readonly activeTabId = signal<ClientRecordTab>('general');

  /** The right-hand profile card's own rows: the client's fields, in the order the legacy record paints them, with a field the record leaves unset rendered as the empty string rather than a placeholder (AAP 0.7.4; Rule 1 (Rule 1 clause 3, AAP 0.7.2). */
  readonly profileFields = computed<readonly ProfileCardField[]>(() => {
    const record = this.client();

    if (record === null) {
      return [];
    }

    // The same language revision the tab labels read, for the same reason: the row labels are resolved text, not keys the template resolves itself.
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

  /** The rows under the card's `Performance History` sub-heading, in {@link CLIENT_HISTORY_LABEL_KEYS} order, each carrying an empty value because `Client` does not model the `ClientSummary` the values come from (AAP 0.7.4, Rule 1 clause 3). */
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

  /** Permission of the `New Loan` entry point: legacy's own gate on the record's new-loan button (`CREATE_LOAN`, `app/scripts/models/clientStatus.js`), which is the code the W4 loan application that this link opens is. */
  readonly newLoanPermission = 'CREATE_LOAN';

  /** Permission of the `New Saving` entry point: legacy's own gate on the record's new-saving button (`CREATE_SAVINGSACCOUNT`) (AAP 0.10.5, AAP 0.10.1). */
  readonly newSavingPermission = 'CREATE_SAVINGSACCOUNT';

  /** Permission of the `Activate` entry point: the code `CLIENT_ACTION_PERMISSIONS` declares for the command — legacy's own gate on the record's activate button — which is also the code the `client/:id/:action` route (AAP 0.1.1). */
  readonly activatePermission = CLIENT_ACTION_PERMISSIONS.activate;

  /** Permission of the `Close` entry point: the code `CLIENT_ACTION_PERMISSIONS` declares for the command, shared with the route guard and the action screen's submit control (AAP 0.1.1). */
  readonly closePermission = CLIENT_ACTION_PERMISSIONS.close;

  /** Permission of the `Reject` entry point: the code `CLIENT_ACTION_PERMISSIONS` declares for the command, shared with the route guard and the action screen's submit control (AAP 0.1.1). */
  readonly rejectPermission = CLIENT_ACTION_PERMISSIONS.reject;

  /** Permission of the `Withdraw` entry point: the code `CLIENT_ACTION_PERMISSIONS` declares for the command, shared with the route guard and the action screen's submit control (AAP 0.1.1). */
  readonly withdrawPermission = CLIENT_ACTION_PERMISSIONS.withdraw;

  /** Permission of the `Reactivate` entry point: the code `CLIENT_ACTION_PERMISSIONS` declares for the command, shared with the route guard and the action screen's submit control (AAP 0.1.1) (Rule 1 clause 3). */
  readonly reactivatePermission = CLIENT_ACTION_PERMISSIONS.reactivate;

  /** Whether the record on screen is a closed one, which is the single condition the action row adds `Reactivate` on (AAP 0.7.4, AAP 0.10.5, Rule 1 clause 3). */
  private readonly clientIsClosed = computed<boolean>(() => {
    const record = this.client();

    return record !== null && toClientStatusKey(record.status.code) === 'closed';
  });

  /** The record's action row, as the descriptors `ActionButtonGroupComponent` renders (AAP 0.2.3 row `ActionButtonGroup`; AAP 0.7.4 "Client view"): `Edit`, `New Loan`, `New Saving` and `Close` in the visible row, then. */
  readonly actionButtons = computed<readonly ClientActionButton[]>(() => {
    const clientId = this.clientId();

    // No id, no entry: every `routerLink` below is built from the id the URL names, so a route that names no client yields no descriptor rather than a link whose target is an empty segment.
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
        label: 'label.button.newsaving',
        icon: 'fa-plus',
        permission: this.newSavingPermission,
        routerLink: `/new_client_saving_application/${clientId}`,
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

    // The one state-dependent entry, appended where legacy's `Closed` status lists it: last in the menu, and absent from a record that is not closed because the command would be refused.
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

  /** Legacy key of the accounts section's heading. The section covers the client's loan and savings accounts together, and `label.heading.accountdetail` ("Account Detail") is the shipped bundle's own wording for exactly that (Rule 1 clause 6). */
  readonly accountsHeadingKey = 'label.heading.accountdetail';

  /** Counts the moments at which a label must be resolved again: a language switch and a bundle arriving. */
  private readonly labelsRevision = signal(0);

  /** Subscribes to the route's parameters, which is the screen's whole entry point. */
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

  /** Reads the client the URL names and paints it. A route that names no client issues no request: `missingId` drives the not-found branch and `loading` is cleared here, because no subscription will finalise it. */
  private load(): void {
    const load = ++this.loadSequence;
    const clientId = this.clientId();

    if (clientId.length === 0) {
      // No request is issued for a route that names no client, so this is the one path on which `loading` is cleared without a subscription finalising it: leaving it `true` would keep the screen on its loading state for ever.
      this.missingId.set(true);
      this.loading.set(false);

      return;
    }

    this.clients
      .get(clientId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          // Only the current run owns the loading state: a superseded one must not clear the flag the newer read set, or the screen would stop reporting that it is still filling.
          if (load === this.loadSequence) {
            this.loading.set(false);
          }
        }),
      )
      .subscribe({
        next: (loaded) => {
          // A superseded client's answer is dropped here rather than painted under the client the URL now names.
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

  /** Clears everything the previous client put on the screen, so a route emission for another client never shows the earlier client's record, failure or selected tab while the new read is outstanding. */
  private reset(): void {
    this.client.set(null);
    this.error.set(null);
    this.missingId.set(false);
    this.loading.set(true);
    this.activeTabId.set('general');
  }

  /** Shows the tab the strip reported, and only one this record renders: an id outside the union is ignored rather than written to the state a template branch reads. @param id the tab id `TabStripComponent` emitted. */
  selectTab(id: string): void {
    if (isClientRecordTab(id)) {
      this.activeTabId.set(id);
    }
  }

  /** The `ApiError` a failed read is reported as. The interceptor maps every `HttpErrorResponse` into an `ApiError` before rethrowing it, so the defensive branch is unreachable through the application and exists only so that. */
  private asApiError(cause: unknown): ApiError {
    if (cause instanceof ApiError) {
      return cause;
    }

    const message = cause instanceof Error && cause.message.length > 0 ? cause.message : 'HTTP 0';

    return new ApiError(message, 0);
  }
}
