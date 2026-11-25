import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import type { FormControl, FormGroup } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { finalize } from 'rxjs';

import type { SearchResult } from '../../../core/api/search.service';
import { SearchService } from '../../../core/api/search.service';
import { ApiError } from '../../../core/http/api-error';
import { EmptyStateComponent } from '../../../shared/empty-state/empty-state.component';
import { HasPermissionDirective } from '../../../shared/has-permission.directive';
import type { StatusKey } from '../../../shared/status-key.util';
import { StatusSwatchComponent } from '../../../shared/status-swatch/status-swatch.component';
import type { Client, ClientListParams } from '../client.models';
import { toClientStatusKey } from '../client.models';
import { ClientService } from '../client.service';

/**
 * One rendered row of the clients table: the six values the table prints, resolved once per row from
 * whichever read produced it.
 *
 * Exported so the sibling spec types its expectations against the same declaration instead of
 * restating the shape, and `readonly` throughout so a row cannot be edited in place by a template.
 *
 * The shape is the screen's own rather than either payload's. `GET /clients` names a client through
 * `displayName`, `accountNo`, `officeName` and `staffName`, while `GET /search` names it through
 * `entityName`, `entityAccountNo` and `parentName`, so a row that held either payload would leave
 * the template reading two vocabularies. A text member is the empty string when the payload carried
 * no value for it — never a dash, a zero or an invented word, because the design shows an empty cell
 * and legacy printed one (Rule 1 clause 3).
 */
export interface ClientListRow {
  /**
   * Stable key for the template's `track`, unique across both sources: the client's own id for a row
   * of the list page, and the search row's entity type plus its entity id for a search result, so a
   * client found by name and the same client found by an identifier never collide.
   */
  readonly key: string;

  /** The client id a row opens: the `:id` of `#/viewclient/:id`, from `id` or from `parentId`. */
  readonly clientId: number;

  /**
   * The name the table's first column prints: `displayName` on a page row, `entityName` on a client
   * result and `parentName` on an identifier result — the client each of them names.
   */
  readonly name: string;

  /** The client number, `''` when the payload carried none. */
  readonly accountNo: string;

  /** The bank-assigned external id, `''` when the payload carried none. */
  readonly externalId: string;

  /** The office name, `''` when the payload carried none. */
  readonly officeName: string;

  /** The loan officer's name, `''` when the payload carried none. */
  readonly staffName: string;

  /**
   * The status indicator's key for this row, from the family's single mapping
   * (`toClientStatusKey`). Resolved once per row rather than once per change detection pass, so the
   * colour a row shows cannot drift between renders.
   */
  readonly statusKey: StatusKey;
}

/**
 * The values of the list's filter toolbar, stated as its own type so the builder constructs exactly
 * these three non-nullable controls.
 *
 * Without it the builder widens each starting value to its own literal type and the checkbox becomes
 * a control of `false`, which no later tick could satisfy; naming the shape keeps every control
 * non-nullable and each of its value types exact (Rule 1 clause 4).
 */
interface ClientListToolbarValues {
  filter: string;
  find: string;
  showClosed: boolean;
}

/**
 * The clients list (`#/clients`) — the screen a signed-in user lands on after the login form is
 * submitted, the entry point of workflow W2 (its "Create Client" control) and of workflow W3 (a row
 * opened onto the record), and step 2 of 3 of the design flow "Sign in and open a client record"
 * (AAP 0.7.1 Features row `clients`; AAP 0.7.4 "Clients list (`#/clients`)"; AAP 0.8.2 route
 * `clients`; AAP 0.11.1 row for this folder).
 *
 * **The two reads the screen makes.** It reads one page of `GET /clients` — `offset` and `limit`
 * only — when it is constructed, and re-reads that same page when the find field is submitted while
 * empty. A submit that carries text runs the legacy find instead: `GET /search` with `query` and
 * `resource=clients,clientIdentifiers`, exactly the call the legacy `ClientController.search()` makes
 * (`globalSearch.search({query, resource: 'clients,clientIdentifiers'})`), which is how the legacy
 * screen finds a client by name, mobile number, client number, external id or identifier
 * (AAP 0.7.3 row "Shell: global search"; AAP 0.10.5 item 9). Both reads go through
 * `ClientService.list()` and `SearchService.search()` — the families' only typed Fineract callers —
 * so this file composes no URL, sets no header and injects no HTTP client: those two services are
 * the only places those URLs exist and `core/http/fineract.interceptor.ts` is the only place a
 * header, a mapped error or a 401 lives (Rule 1 clause 5; AAP 0.14.1 "Every URL literal lives in a
 * service"; AAP 0.4.2).
 *
 * **Why the find does not travel on the list request.** `searchText` is not a parameter of
 * `GET /clients`: the fork's `ClientsApiResource.retrieveAll` does not accept it, and this
 * application's `web-ng/tools/parity/endpoint-allowlist.json` declares `offset`, `limit`, `orderBy`
 * and `sortOrder` for that row and nothing else. Sent there, the parameter was ignored and the find
 * answered with the unfiltered first page — a search that silently did not search, and a request the
 * parity harness flags (Rule 1 clause 2). The search endpoint's own `query` and `resource` are the
 * pair both the allowlist and AAP 0.10.1's W3 row declare, and `exactMatch` is deliberately absent
 * because the find field offers no such choice (Rule 1 clause 3).
 *
 * **The row view is projected at receipt.** A page row and a search row carry the same display
 * values under different names, so each response is projected once, as it arrives, into the one
 * {@link ClientListRow} the table binds: the payload's field names and its status code are read in
 * exactly one place per source and neither reaches the template, which also keeps the status mapping
 * to one pass per response rather than one per change detection pass. A row the projection does not
 * describe — the loan row the search union admits but the `clients` scope never asks for — is
 * dropped rather than rendered as a blank line.
 *
 * **The two display filters are client-side.** The "Show Closed" checkbox and the filter field
 * narrow the rows already in hand and never become a query parameter, because the legacy screen
 * sends neither and inventing one would change the request the parity harness compares
 * (Rule 1 clauses 2 and 3). The server's order is kept exactly: nothing is sorted, ranked or
 * regrouped here.
 *
 * **What it deliberately does not do, per Rule 1 clause 3 (match legacy, do not improve it).**
 * No pager, no rows-per-page selector and no infinite scroll (AAP 0.5.4 leaves client-list
 * pagination an open item; the design paints five rows and no pager); no spinner, skeleton or
 * progress element (the design carries no loader asset — AAP 0.2.4); no sorting, renaming, trimming
 * or reformatting of a server value; no textual status anywhere, because the design paints a colour
 * swatch and a word would be an improvement the migration may not make (AAP 0.10.5 deliberate
 * difference 11); no "Import Clients" control, no left icon rail, no Accounting/Reports/Admin
 * navigation, no hamburger and no bell (AAP 0.9.2; AAP 0.10.5 items 4 and 8). Every lifecycle
 * action, the datatable gate that precedes it and the record itself belong to their own screens.
 *
 * **The signed-in shell is not rendered here.** The navbar, breadcrumb, global search, language
 * switcher and user menu come from `core/layout` through this route's `data.breadcrumb`, so this
 * folder renders the content card and nothing around it.
 *
 * **States.** Loaded renders the table; loading paints no rows yet and nothing invented; an empty
 * result set renders `app-empty-state` with no error; a failed read leaves the screen usable. A 4xx
 * renders Fineract's own message in place of the rows (the interceptor leaves 4xx to the caller),
 * while a 5xx or a transport failure raises no second surface at all, because the interceptor has
 * already raised the single notification carrying that message (AAP 0.7.4).
 *
 * **Errors are values.** Nothing here throws, rethrows, logs or notifies: a failure becomes an
 * {@link ApiError}'s message on a signal, so the template renders it and the screen stays mounted
 * (AAP 0.14.1).
 */
@Component({
  selector: 'app-client-list',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    TranslatePipe,
    StatusSwatchComponent,
    EmptyStateComponent,
    HasPermissionDirective,
  ],
  templateUrl: './client-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientListComponent {
  /**
   * The clients family's typed Fineract caller: the page read, and nothing else (Rule 1 clause 5).
   */
  private readonly clientService = inject(ClientService);

  /**
   * The search endpoint's only application caller: the find field's server search (AAP 0.7.1
   * supporting-services row `SearchService`). Injected rather than reached through `ClientService`,
   * because `GET /search` belongs to the search family and this screen composes no URL of its own
   * (Rule 1 clauses 2 and 5; AAP 0.14.1).
   */
  private readonly searchService = inject(SearchService);

  /**
   * The component's own lifetime, handed to `takeUntilDestroyed` for every read, so a response that
   * arrives after the user has navigated away cannot write to a destroyed view.
   */
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The filter toolbar the design paints above the table: the client-side filter, the find field
   * with its search button, and the "Show Closed" checkbox (AAP 0.2.3 row `FilterToolbar`).
   *
   * A typed, non-nullable reactive form, so each control's value type is known to `strictTemplates`
   * and a control can never be `null` — the two string controls start empty and the checkbox starts
   * unticked, which is the state the design shows (Rule 1 clause 4).
   */
  readonly toolbar: FormGroup<{
    filter: FormControl<string>;
    find: FormControl<string>;
    showClosed: FormControl<boolean>;
  }> = inject(FormBuilder).nonNullable.group<ClientListToolbarValues>({
    filter: '',
    find: '',
    showClosed: false,
  });

  /**
   * The rows the last successful read returned, projected at receipt into the table's own view and
   * kept in the server's order. It holds the list page after a page read and the search answer after
   * a find, because the screen shows one or the other, never both. Until the first response arrives
   * (and after a failed read) it is empty, which is what makes the table area blank rather than
   * showing invented rows (AAP 0.7.4).
   */
  readonly rows = signal<readonly ClientListRow[]>([]);

  /**
   * Whether a read is in flight. The template uses it to avoid painting an empty-state message
   * during the frame before the first response, and to disable the find submit button while its own
   * request is out. It paints nothing itself: the design has no spinner (AAP 0.2.4).
   */
  readonly loading = signal(false);

  /**
   * Whether the last read failed. With {@link errorMessage} empty this is what tells the template a
   * failure arrived without text it may render — a 5xx or a transport fault the interceptor has
   * already notified — so the screen shows neither rows nor a "no clients" claim (AAP 0.7.4).
   */
  readonly failed = signal(false);

  /**
   * Fineract's own failure text, verbatim, or `null` when there is nothing to show. Populated for a
   * 4xx only: the interceptor maps every failure into an {@link ApiError} but raises its single
   * notification for status `0` and `>= 500` alone, so rendering those here as well would report
   * the same problem twice (AAP 0.7.4; Rule 1 clause 9 — nothing about the failure is logged).
   */
  readonly errorMessage = signal<string | null>(null);

  /**
   * The filter control's text as a signal. It must be a signal rather than a read of
   * `toolbar.controls.filter.value` inside the computed below: this view is zoneless and `OnPush`,
   * so a plain property read would leave the computed holding its first verdict for ever.
   */
  private readonly filterText = toSignal(this.toolbar.controls.filter.valueChanges, {
    initialValue: this.toolbar.controls.filter.value,
  });

  /** The "Show Closed" checkbox as a signal, bridged for the same reason as {@link filterText}. */
  private readonly showClosed = toSignal(this.toolbar.controls.showClosed.valueChanges, {
    initialValue: this.toolbar.controls.showClosed.value,
  });

  /**
   * The rows the table renders: the rows in hand with the two display filters applied, in the
   * server's order.
   *
   * 1. a row whose status key is `closed` is left out unless "Show Closed" is ticked — `closed` is
   *    the key the three terminal states (closed, rejected, withdrawn) share, which is the design's
   *    own vocabulary;
   * 2. a row whose name does not contain the filter text is left out when that text is non-empty,
   *    compared case-insensitively and against the name column the filter belongs to;
   * 3. the survivors are rendered as they are, because each row was already projected into a
   *    {@link ClientListRow} and its status mapped when its response arrived.
   *
   * Both filters are client-side and issue no request (Rule 1 clause 3). Nothing is sorted, ranked
   * or regrouped here: the order is the one the server answered with.
   */
  readonly visibleRows = computed<readonly ClientListRow[]>(() => {
    const needle = this.filterText().trim().toLowerCase();
    const includeClosed = this.showClosed();
    const visible: ClientListRow[] = [];

    for (const row of this.rows()) {
      if (!includeClosed && row.statusKey === 'closed') {
        continue;
      }

      if (needle !== '' && !row.name.toLowerCase().includes(needle)) {
        continue;
      }

      visible.push(row);
    }

    return visible;
  });

  /**
   * Whether a completed read matched nothing — the state that renders the explicit empty state and
   * no error. All three conditions matter: nothing may be in flight (so the empty state cannot flash
   * before the first response), the last read must not have failed (so a failed read is never
   * rendered as "no clients", which would claim something the screen does not know), and no row may
   * survive the two display filters (AAP 0.7.4 "States every list and record screen must
   * implement").
   */
  readonly isEmpty = computed<boolean>(
    () => !this.loading() && !this.failed() && this.visibleRows().length === 0,
  );

  /**
   * Rows to skip — the first page, because the screen renders none of the pager's controls.
   *
   * The pair with {@link pageLimit} is the whole of this screen's paging: the family's
   * `ClientListParams` records that the legacy list pages with `offset: (page - 1) * clientsPerPage`
   * and `limit: clientsPerPage`, and the design paints no pager inside the card, so both values live
   * in these two constants for a single correction to reach.
   */
  readonly pageOffset: number = 0;

  /**
   * Rows per page: the legacy client list's own fifteen, as the family's `ClientListParams` records
   * it. Deliberately not the larger page a fresh screen might prefer — the request the parity
   * harness compares is the legacy request, and a different `limit` would show up as a difference in
   * every client-list workflow (Rule 1 clauses 2 and 3).
   */
  readonly pageLimit: number = 15;

  /**
   * Reads the first page as soon as the screen is constructed, which is what makes `#/clients` the
   * populated landing screen the design shows (AAP 0.7.4).
   */
  constructor() {
    this.load();
  }

  /**
   * Runs the toolbar's find: the one place the find field reaches the server.
   *
   * The field's text is trimmed. When it carries something the find runs as a search — `GET /search`,
   * the call legacy makes for the same field. When it has been cleared the list is re-read with no
   * filter at all, so clearing the field restores the full page, which is exactly what the legacy
   * controller does with an empty `searchText` (`ClientController.search()`). Exactly one request
   * goes out per submit, and an empty field never sends an empty `query` (Rule 1 clauses 2 and 3).
   */
  onFind(): void {
    const query = this.toolbar.controls.find.value.trim();

    if (query === '') {
      this.load();
      return;
    }

    this.search(query);
  }

  /**
   * Reads one page of `GET /clients` and replaces the rows it holds (AAP 0.7.3 row "Client list and
   * edit").
   *
   * The request carries `offset` and `limit` and nothing else. `orderBy` and `sortOrder` stay unset
   * because the in-scope screen offers no sort affordance and the legacy list sends neither;
   * `searchText` is deliberately not sent, because this endpoint does not accept it and the
   * allowlist does not declare it — the find is the separate search read below. `dateFormat` and
   * `locale` are absent because a list read carries no date payload — the service applies that pair
   * to the bodies that do (Rule 1 clause 2).
   *
   * The subscription is tied to the component's lifetime with `takeUntilDestroyed`, and `finalize`
   * clears {@link loading} whether the response arrived or the request failed. A failure becomes
   * state, never an exception escaping the component (AAP 0.14.1).
   */
  private load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.errorMessage.set(null);

    const params: ClientListParams = {
      offset: this.pageOffset,
      limit: this.pageLimit,
    };

    this.clientService
      .list(params)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        // The endpoint answers with the paged envelope `{totalFilteredRecords, pageItems}` rather
        // than a bare array, so the page's own rows are what the table holds. `totalFilteredRecords`
        // is deliberately not kept: this screen renders no pager, so nothing would read it.
        next: (page) => this.rows.set(page.pageItems.map(toPageRow)),
        error: (error: unknown) => this.onFailure(error),
      });
  }

  /**
   * Runs the find as a server search and replaces the rows with its answer (AAP 0.7.3 row "Shell:
   * global search"; AAP 0.10.1 W3's search half; AAP 0.10.5 item 9).
   *
   * The requested scope is `clients`, carried in the `resource` member `GlobalSearchParams`
   * declares, which the service serialises as `resource=clients,clientIdentifiers` — the value the
   * legacy client list's find sends, and the reason a client is still found by one of its
   * identifiers. `exactMatch` is left unset because the find field offers no such choice and the
   * allowlist declares `query` and `resource` only for this endpoint (Rule 1 clauses 2 and 3).
   *
   * The subscription follows {@link load}'s shape for the same reasons: bound to the component's
   * lifetime, `loading` cleared by `finalize` on either outcome, and a failure turned into state
   * through the same {@link onFailure} the page read uses.
   *
   * @param query the trimmed find text; never empty, because an empty field re-reads the page.
   */
  private search(query: string): void {
    this.loading.set(true);
    this.failed.set(false);
    this.errorMessage.set(null);

    this.searchService
      .search({ query, resource: 'clients' })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (results) => this.rows.set(toSearchRows(results)),
        error: (error: unknown) => this.onFailure(error),
      });
  }

  /**
   * Records a failed read: the rows are cleared, the failure is flagged, and Fineract's own message
   * is published for a 4xx only.
   *
   * A 5xx or a transport fault sets no message, because `core/http/fineract.interceptor.ts` has
   * already raised the single notification that carries it; reporting it here as well would show the
   * same problem twice. Nothing is logged, rethrown or notified from this file — the screen simply
   * stays mounted with its toolbar usable (AAP 0.7.4; Rule 1 clause 9).
   *
   * @param error the rejection the read produced; narrowed here because an observable's error
   *   channel is untyped.
   */
  private onFailure(error: unknown): void {
    this.rows.set([]);
    this.failed.set(true);

    if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
      this.errorMessage.set(error.message);
      return;
    }

    this.errorMessage.set(null);
  }
}

/**
 * Projects one `GET /clients` row onto the table's row view.
 *
 * The page payload's own names are read here and nowhere else: `displayName` is the name column,
 * `accountNo` and `officeName` are carried as they arrived, and the two members the endpoint omits
 * when a client has none — `externalId` and `staffName` — become the empty string rather than a
 * stand-in the design never shows (Rule 1 clause 3). The key is the client's id because a client
 * appears at most once in one page.
 *
 * @param client One element of the page envelope's `pageItems`, as the endpoint sent it.
 * @returns The row the table renders for it.
 */
function toPageRow(client: Client): ClientListRow {
  return {
    key: `client:${client.id}`,
    clientId: client.id,
    name: client.displayName,
    accountNo: client.accountNo,
    externalId: client.externalId ?? '',
    officeName: client.officeName,
    staffName: client.staffName ?? '',
    statusKey: toClientStatusKey(client.status.code),
  };
}

/**
 * Projects the search answer onto the table's row view, dropping the rows this screen does not
 * render.
 *
 * @param results The rows `GET /search` answered with, in the server's order.
 * @returns The rows the table renders, in the same order.
 */
function toSearchRows(results: readonly SearchResult[]): readonly ClientListRow[] {
  const rows: ClientListRow[] = [];

  for (const result of results) {
    const row = toSearchRow(result);

    if (row !== null) {
      rows.push(row);
    }
  }

  return rows;
}

/**
 * Projects one search result onto the table's row view, by the discriminator the result carries.
 *
 * What each of the two in-scope result kinds carries is the payload the search endpoint answers with:
 *
 *   - a `CLIENT` row names the client in `entityName`, its account in `entityAccountNo`, its external
 *     id in `entityExternalId` and its office in `parentName`, and its own `entityId` opens the
 *     record — the five values the legacy controller copies from the same result;
 *   - a `CLIENTIDENTIFIER` row is a client found by one of its identifiers: `parentName` is the
 *     client's name and `parentId` its id, so the row opens that client exactly as legacy's
 *     `#/viewclient/{parentId}` did. The row carries no account number, office or staff the client
 *     list shows, so those cells are empty rather than borrowed from another member.
 *
 * @param result One element of the search answer, discriminated by its `entityType`.
 * @returns The row to render, or `null` for a result this screen does not render — a `LOAN` row the
 *   union admits but the `clients` scope never asks for, or a discriminator the server adds beyond
 *   the union, which is dropped rather than guessed at.
 */
function toSearchRow(result: SearchResult): ClientListRow | null {
  switch (result.entityType) {
    case 'CLIENT':
      return {
        key: `client:${result.entityId}`,
        clientId: result.entityId,
        name: result.entityName,
        accountNo: result.entityAccountNo ?? '',
        externalId: result.entityExternalId ?? '',
        officeName: result.parentName ?? '',
        staffName: '',
        statusKey: toClientStatusKey(result.entityStatus?.code),
      };

    case 'CLIENTIDENTIFIER':
      return {
        key: `clientIdentifier:${result.entityId}`,
        clientId: result.parentId ?? result.entityId,
        name: result.parentName ?? '',
        accountNo: '',
        externalId: '',
        officeName: '',
        staffName: '',
        statusKey: toClientStatusKey(result.entityStatus?.code),
      };

    default:
      return null;
  }
}
