import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, type ParamMap } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { finalize } from 'rxjs';

import { ApiError } from '../../../core/http/api-error';
import { HasPermissionDirective } from '../../../shared/has-permission.directive';
import type { Client } from '../client.models';
import { ClientService } from '../client.service';
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
 * The individual client record — `#/viewclient/:id`, the last screen of the "Sign in and open a
 * client record" flow and the entry point of workflow W3's record read, of the lifecycle actions and
 * of the loan, savings and edit screens this record links to (AAP 0.7.1 Features row `clients`;
 * AAP 0.7.4 "Client view (`#/viewclient/:id`)"; AAP 0.8.2 feature route `viewclient/:id`).
 *
 * **One read, owned by the family's service.** The screen issues exactly one request,
 * `ClientService.get(id)` — `GET /clients/{id}` (AAP 0.7.3 row "W3 search and view client") — and
 * hands the loaded record to the presentational blocks that already exist. The `General` tab's
 * accounts table and the `Identities` tab issue their own two reads through the same service, and
 * nothing else on this screen calls the API: this file holds no URL, host, API path, query
 * parameter, request body or HTTP client, because `ClientService` composes every one of them
 * (Rule 1 clauses 2 and 5; AAP 0.14.1 "Every URL literal lives in a service").
 *
 * **One id, one load per navigation.** The `:id` is read from `route.paramMap`, never from the
 * snapshot: the router reuses this component when the URL moves from one `#/viewclient/{id}` to
 * another, so every emission clears the previous client's record, message, selected tab and open
 * menu and re-reads the client the URL now names, exactly as `client-actions` and `loan-edit` handle
 * the same reuse. Because two reads can then be in flight, a response that arrives after the URL
 * moved on is discarded rather than painted, so one client's record can never appear under another
 * client's URL (see {@link loadSequence}).
 *
 * **Four states, and who owns each** (AAP 0.7.4 "States every list and record screen must
 * implement"). While the read is outstanding `loading` is true and nothing is painted — the design
 * carries no spinner, skeleton or placeholder (AAP 0.2.4). A 404, or a route that carries no id at
 * all (in which case no request is issued), drives `notFound`, which the template renders **in
 * place of the record** and leaves the shell usable. Any other 4xx drives `clientError`, whose
 * Fineract message the template renders verbatim, with the shell and its navigation left usable and
 * no control offered against a record the read did not return. A 5xx or transport failure
 * leaves both computeds null, because the single interceptor has already raised exactly one
 * notification for it and a second copy here would report the same problem twice (AAP 0.4.2). This
 * component therefore never calls `NotificationService`, never logs and never rethrows.
 *
 * **Two tabs, and nothing more.** `General` renders the summary block and the accounts table,
 * `Identities` renders the identifiers tab, and the record shows no third tab: Family Members,
 * Documents, Notes and Credit Report are out of scope (AAP 0.10.5 item 6). The strip itself is
 * `TabStripComponent`, which holds no tab list of its own, so a tab the plan excludes cannot appear
 * on the screen.
 *
 * **Every action is permission-gated, on legacy's own code.** The entry points the plan keeps are
 * `Edit`, `New Loan`, `New Saving` (rendered because Stretch ships, AAP 0.10.5 item 5) and `Close`,
 * plus the `More` menu holding `Activate`, `Reject`, `Withdraw` and `Reactivate` (AAP 0.7.4). Each
 * one carries the permission the legacy record gates it on — `UPDATE_CLIENT`, `CREATE_LOAN`,
 * `CREATE_SAVINGSACCOUNT`, `CLOSE_CLIENT`, `ACTIVATE_CLIENT`, `REJECT_CLIENT`, `WITHDRAW_CLIENT`
 * and `REACTIVATE_CLIENT` in `app/scripts/models/clientStatus.js` — through
 * `HasPermissionDirective`, the same service `permissionGuard` asks, so a button cannot outlive the
 * route that serves it (AAP 0.1.1 "a route guard and a template directive must agree"). The
 * lifecycle commands themselves are posted by `client-actions.component.ts` at
 * `#/client/:id/:action`; this screen only links to them, so no action is dispatched, confirmed or
 * gated a second time here. Controls AAP 0.10.5 excludes — client charges, transfer, staff
 * assignment, signature, avatar upload and camera — are not rendered.
 *
 * **Dates and status.** Nothing here formats a date or reads the clock: the record's dates belong
 * to the blocks that display them, which render through the one `DISPLAY_DATE_FORMAT` pattern and
 * parse Fineract values with `fromFineractDate` (AAP 0.7.2 "Date handling"). The status is the
 * design's colour indicator and never its word, and it is painted by `RecordHeaderComponent`
 * through `toClientStatusKey`, the family's delegate to the one mapping the whole application
 * shares in `web-ng/src/app/shared/status-key.util.ts` (AAP 0.10.5 item 11).
 *
 * **Presentation.** The template and the global Bootstrap 3 layer in `web-ng/src/styles.scss` own
 * every visual value, which is why this component declares no stylesheet, no inline style and no
 * colour (Rule 1 clause 6; AAP 0.4.4 decision 4). The design's joined action row is
 * `.btn-group > .btn`, its card is `.panel`, and the `More` menu is `.dropdown-menu` with Angular
 * state for its open and closed position, because Bootstrap's own plugin needs jQuery
 * (AAP 0.5.2 row "Dropdown menu"). Nothing is logged: no client id, no record body and no
 * credential reaches the console (Rule 1 clause 9).
 */
@Component({
  selector: 'app-client-view',
  imports: [
    RouterLink,
    TranslatePipe,
    HasPermissionDirective,
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
   * The right-hand profile card's rows: the client's own fields, in the order the design paints
   * them, with a field the record leaves unset rendered as the empty string rather than a
   * placeholder (AAP 0.7.4; Rule 1 clause 3).
   *
   * Four rows and no more — the client number, the external id, the office and the staff — because
   * every other value on the card (the activation date, the accounts, the performance history)
   * belongs to a block that already renders it, and a derived row would be an addition the legacy
   * record does not make. An unloaded record has no rows at all, so the card renders its heading and
   * an empty body rather than claiming values it does not have.
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
    ];
  });

  /**
   * Whether the `More` menu is open. Angular state rather than Bootstrap's dropdown plugin, which
   * needs jQuery and is not loaded (AAP 0.5.2 row "Dropdown menu").
   */
  readonly moreOpen = signal(false);

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
   * Permission of the `New Saving` entry point: legacy's own gate on the record's new-saving button
   * (`CREATE_SAVINGSACCOUNT`). The button is rendered because Stretch ships (AAP 0.10.5 item 5), and
   * the record is workflow W8's entry point (AAP 0.10.1 W8 row).
   */
  readonly newSavingPermission = 'CREATE_SAVINGSACCOUNT';

  /**
   * Permission of the `Activate` entry point: legacy's own gate on the record's activate button
   * (`ACTIVATE_CLIENT`), one of the five lifecycle commands `client-actions.component.ts` posts.
   */
  readonly activatePermission = 'ACTIVATE_CLIENT';

  /** Permission of the `Close` entry point: legacy's own gate (`CLOSE_CLIENT`). */
  readonly closePermission = 'CLOSE_CLIENT';

  /** Permission of the `Reject` entry point: legacy's own gate (`REJECT_CLIENT`). */
  readonly rejectPermission = 'REJECT_CLIENT';

  /** Permission of the `Withdraw` entry point: legacy's own gate (`WITHDRAW_CLIENT`). */
  readonly withdrawPermission = 'WITHDRAW_CLIENT';

  /**
   * Permission of the `Reactivate` entry point: legacy's own gate (`REACTIVATE_CLIENT`), which the
   * fork issues as permission id 618 and which legacy's `Closed` status carries as the one button
   * that state offers. It is deliberately not `ACTIVATE_CLIENT`: a user holding only the activation
   * code would then be shown a control the server refuses (Rule 1 clause 3; AAP 0.1.1).
   */
  readonly reactivatePermission = 'REACTIVATE_CLIENT';

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
   * never shows the earlier client's record, failure, selected tab or open menu while the new read
   * is outstanding. `loading` goes back to `true` for the same reason.
   */
  private reset(): void {
    this.client.set(null);
    this.error.set(null);
    this.missingId.set(false);
    this.loading.set(true);
    this.activeTabId.set('general');
    this.moreOpen.set(false);
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

  /** Opens the `More` menu when it is closed and closes it when it is open. */
  toggleMore(): void {
    this.moreOpen.update((open) => !open);
  }

  /**
   * Closes the `More` menu without opening it, which is what the Escape key inside the menu does:
   * the keyboard leaves the dropdown without the user aiming at the toggle again.
   */
  closeMore(): void {
    this.moreOpen.set(false);
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
