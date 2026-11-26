import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import { finalize } from 'rxjs';

import type { SearchResult } from '../../../core/api/search.service';
import { SearchService } from '../../../core/api/search.service';
import { ApiError } from '../../../core/http/api-error';
import { DataTableComponent, type ColumnDef } from '../../../shared/data-table/data-table.component';
import { EmptyStateComponent } from '../../../shared/empty-state/empty-state.component';
import { PanelCardComponent } from '../../../shared/panel-card/panel-card.component';
import type { StatusKey } from '../../../shared/status-key.util';
import { StatusSwatchComponent } from '../../../shared/status-swatch/status-swatch.component';
import { createTranslatedLabels } from '../../../shared/translated-label.util';
import type { Client, ClientListParams } from '../client.models';
import { isClosedClientStatus, toClientStatusKey } from '../client.models';
import { ClientService } from '../client.service';
import { FilterToolbarComponent } from './filter-toolbar/filter-toolbar.component';

/**
 * How many page links the pager renders at once — `dir-pagination-controls`' own `max-size` default.
 */
const PAGE_NUMBER_WINDOW = 9;

/**
 * One rendered row of the clients table: the six values the table prints, plus the key the loop tracks,
 * the id a row opens and the status code the "Show Closed" filter reads. The shape is the screen's own
 * rather than either payload's, because `GET /clients` names a client through `displayName`, `accountNo`,
 * `officeName` and `staffName` while `GET /search` names it through `entityName`, `entityAccountNo` and
 * `parentName`, so a row holding either payload would leave the template reading two vocabularies. A
 * text member is the empty string when the payload carried no value for it — never a dash, a zero or an
 * invented word, because the design shows an empty cell and legacy printed one (Rule 1 clause 3).
 */
export interface ClientListRow {
  /**
   * Stable key for the template's `track`, unique across both sources: the client's own id on a list
   * page, and the search row's entity type plus entity id on a search result, so a client found by name
   * and the same client found by an identifier never collide.
   */
  readonly key: string;

  /** The client id a row opens: the `:id` of `#/viewclient/:id`, from `id` or from `parentId`. */
  readonly clientId: number;

  /**
   * The name the table's first column prints: `displayName` on a page row, `entityName` on a client
   * result and `parentName` on an identifier result.
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
   * The status indicator's key for this row, from the family's single mapping (`toClientStatusKey`),
   * resolved once per row rather than once per change detection pass so the colour cannot drift between
   * renders. Colour only: it collapses the three terminal states (closed, rejected, withdrawn) into
   * `closed`, which is why it is not what the "Show Closed" filter reads.
   */
  readonly statusKey: StatusKey;

  /**
   * The raw Fineract client status code the payload carried — e.g. `'clientStatusType.closed'` — and the
   * empty string when it carried none; the input {@link isClosedClientStatus} decides "Show Closed" with.
   * Deliberately not {@link statusKey}: that key is the swatch's colour vocabulary and gives closed,
   * rejected and withdrawn the same colour, while the legacy list's checkbox hides one code only
   * (`app/views/clients/clients.html:65`; Rule 1 clause 3).
   */
  readonly statusCode: string;
}

/**
 * The clients list (`#/clients`) — the screen a signed-in user lands on after the login form is submitted, the
 * entry point of workflow W2 (its "Create Client" control) and of workflow W3 (a row opened onto the record),
 * and step 2 of 3 of the design flow "Sign in and open a client record" (AAP 0.7.1 Features row `clients`;
 * AAP 0.7.4 "Clients list (`#/clients`)"; AAP 0.8.2 route `clients`; AAP 0.11.1 row for this folder).
 *
 * It composes the inventory's three controls — `app-panel-card` (AAP 0.2.3 row `PanelCard`),
 * `app-filter-toolbar` (AAP 0.2.3 row `FilterToolbar`, which owns its typed form and publishes
 * `(filterChange)`, `(search)` and `(showClosedChange)`) and `app-data-table` (AAP 0.2.3 row
 * `ClientList / DataTable`) — with the legacy ids, classes and captions unchanged (Rule 1 clauses 3 and 6).
 * What it adds is the state and the traffic: the rows, the two display filters, the pager and the two reads.
 *
 * Both reads go through the families' typed callers, so this file composes no URL, sets no header and injects
 * no HTTP client (Rule 1 clause 5; AAP 0.14.1 "Every URL literal lives in a service"; AAP 0.4.2):
 * `ClientService.list()` for one page of `GET /clients`, `offset` and `limit` only, and
 * `SearchService.search()` for the legacy find `GET /search` with `query`, `resource=clients,clientIdentifiers`
 * and `exactMatch` (AAP 0.7.3 row "Shell: global search"; AAP 0.10.5 item 9). `searchText` never travels on
 * the list request, because `GET /clients` does not accept it and
 * `web-ng/tools/parity/endpoint-allowlist.json` declares only `offset`, `limit`, `orderBy` and `sortOrder` for
 * that row (Rule 1 clause 2); the find's parameters are derived as legacy derives them, the surrounding double
 * quotes stripped and `exactMatch` set from whether that stripping changed the text
 * (`app/scripts/controllers/client/ClientController.js:44-62`; AAP 0.7.2 `GlobalSearchParams`).
 *
 * The two display filters and the rendered order are client-side and become no query parameter (Rule 1 clauses
 * 2 and 3): {@link visibleRows} reproduces legacy's `| orderBy:'displayName':reverse` with `reverse` unset
 * (`app/views/clients/clients.html:63`) and {@link rows} keeps the server's order. Paging is legacy's own,
 * fifteen rows a read (`app/views/clients/clients.html:79-82`; AAP 0.5.4 styles `.pagination`), and nothing is
 * improved on the legacy screen (Rule 1 clause 3): no rows-per-page selector or infinite scroll, no spinner or
 * skeleton (AAP 0.2.4), no textual status (AAP 0.10.5 deliberate difference 11), no "Import Clients" control,
 * left icon rail, Accounting/Reports/Admin navigation, hamburger or bell (AAP 0.9.2; AAP 0.10.5 items 4 and
 * 8). The signed-in shell comes from `core/layout` through this route's `data.breadcrumb`.
 *
 * States: loaded renders the table, loading paints nothing invented, an empty result set renders
 * `app-empty-state` with no error, and a failed read leaves the screen usable — a 4xx rendering Fineract's own
 * message and a 5xx raising no second surface, the interceptor having already notified (AAP 0.7.4; AAP 0.14.1).
 */
@Component({
  selector: 'app-client-list',
  imports: [
    TranslatePipe,
    StatusSwatchComponent,
    EmptyStateComponent,
    PanelCardComponent,
    DataTableComponent,
    FilterToolbarComponent,
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
   * supporting-services row `SearchService`; Rule 1 clauses 2 and 5; AAP 0.14.1).
   */
  private readonly searchService = inject(SearchService);

  /**
   * The component's own lifetime, handed to `takeUntilDestroyed` for every read, so a response that
   * arrives after the user has navigated away cannot write to a destroyed view.
   */
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The legacy bundle's key for each of the table's six captions, resolved through
   * `shared/translated-label.util.ts` so a language switch or a late-arriving bundle repaints them, which
   * is what the legacy `translate` filter did on the same six keys
   * (`app/views/clients/clients.html:53-60`; Rule 1 clause 3).
   */
  private readonly label = createTranslatedLabels();

  /** One signal per caption, in the legacy table's column order. */
  private readonly columnLabels = {
    name: this.label('label.heading.name'),
    clientNumber: this.label('label.heading.clientno'),
    externalId: this.label('label.heading.externalid'),
    status: this.label('label.heading.status'),
    office: this.label('label.heading.office'),
    staff: this.label('label.heading.staff'),
  } as const;

  /**
   * The six columns the table prints, in the legacy table's own order — name, client number, external id,
   * status, office, staff — each headed by that table's own bundle key and each reading one member of
   * {@link ClientListRow} (AAP 0.2.3 row `ClientList / DataTable`; AAP 0.7.4; Figma node `1:3`;
   * `app/views/clients/clients.html:53-60`). Computed from {@link columnLabels} rather than fixed at
   * construction, so the captions follow the active language. The Status column contributes no text — the
   * design paints a colour swatch and no word (AAP 0.10.5 deliberate difference 11) — so its `value` is
   * the empty string.
   */
  readonly columns = computed<readonly ColumnDef<ClientListRow>[]>(() => [
    { key: 'name', header: this.columnLabels.name(), value: (row) => row.name },
    { key: 'clientNumber', header: this.columnLabels.clientNumber(), value: (row) => row.accountNo },
    { key: 'externalId', header: this.columnLabels.externalId(), value: (row) => row.externalId },
    { key: 'status', header: this.columnLabels.status(), value: () => '' },
    { key: 'office', header: this.columnLabels.office(), value: (row) => row.officeName },
    { key: 'staff', header: this.columnLabels.staff(), value: (row) => row.staffName },
  ]);

  /**
   * The key the table's body loop tracks a row by: the row's own {@link ClientListRow.key}, unique across a
   * page and a search answer alike, so the loop never falls back to the index (AAP 0.2.3 row
   * `ClientList / DataTable`).
   */
  readonly rowKey = (row: ClientListRow): string => row.key;

  /**
   * The destination a row opens: `#/viewclient/:id`, the record the legacy cell's `routeTo(client.id)`
   * opened and workflow W3's entry point — the whole row is the link, as the legacy table made every cell
   * one (AAP 0.7.4; Figma node `1:3`; Rule 1 clause 3).
   */
  readonly rowLink = (row: ClientListRow): readonly (string | number)[] => [
    '/viewclient',
    row.clientId,
  ];

  /**
   * The rows the last successful read returned, projected at receipt into the table's own view and kept in
   * the server's order: the list page after a page read, the search answer after a find, because the screen
   * shows one or the other. Until the first response arrives, and after a failed read, it is empty, which
   * keeps the table area blank rather than showing invented rows (AAP 0.7.4).
   */
  readonly rows = signal<readonly ClientListRow[]>([]);

  /**
   * Whether a read is in flight: the template uses it to avoid painting an empty-state message during the
   * frame before the first response, and — through the toolbar's `busy` input — to disable the find submit
   * button while its own request is out. It paints nothing itself: the design has no spinner (AAP 0.2.4).
   */
  readonly loading = signal(false);

  /**
   * Whether the last read failed. With {@link errorMessage} empty this is what tells the template a failure
   * arrived without text it may render — a 5xx or a transport fault the interceptor has already notified —
   * so the screen shows neither rows nor a "no clients" claim (AAP 0.7.4).
   */
  readonly failed = signal(false);

  /**
   * Fineract's own failure text, verbatim, or `null` when there is nothing to show. Populated for a 4xx
   * only: the interceptor maps every failure into an {@link ApiError} but raises its single notification for
   * status `0` and `>= 500` alone, so rendering those here as well would report the same problem twice
   * (AAP 0.7.4; Rule 1 clause 9 — nothing about the failure is logged).
   */
  readonly errorMessage = signal<string | null>(null);

  /**
   * The filter field's text, as the toolbar published it. The toolbar owns the field; this screen owns what
   * the text does, which is narrow the rows already in hand. A signal rather than a read of the toolbar's
   * form inside {@link visibleRows}, because this view is zoneless and `OnPush`, so a plain property read
   * would leave the computed holding its first verdict for ever.
   */
  private readonly filterText = signal('');

  /** The "Show Closed" flag, as the toolbar published it — the second display filter's own state. */
  private readonly showClosed = signal(false);

  /**
   * Whether the rows in hand are a find's answer rather than one page of the list — the difference that
   * decides who pages them. The list read pages on the server (`offset`/`limit`), while a find answers with
   * the whole match, so its rows are paged here in the view (Rule 1 clause 3).
   */
  private readonly findAnswer = signal<boolean>(false);

  /**
   * The rows the table renders: the rows in hand with the two display filters applied, in the order legacy
   * rendered them — a `closed` row left out unless "Show Closed" is ticked (that one code only, as
   * `app/views/clients/clients.html:65` hides exactly `clientStatusType.closed`, so a rejected or withdrawn
   * client stays on screen), a row showing none of the non-empty filter text left out (compared case-insensitively
   * against every text cell, {@link matchesDisplayFilter}), and the survivors ordered by name ascending as
   * `| orderBy:'displayName':reverse` with `reverse` unset produces, whose AngularJS 1.7.9 default comparator
   * lower-cases both names before comparing them (`app/views/clients/clients.html:63`; Rule 1 clause 3). Both
   * filters are client-side and issue no request, and {@link rows} keeps the order the server answered with.
   */
  readonly visibleRows = computed<readonly ClientListRow[]>(() => {
    const needle = this.filterText().trim().toLowerCase();
    const includeClosed = this.showClosed();
    const visible: ClientListRow[] = [];

    for (const row of this.rows()) {
      if (!includeClosed && isClosedClientStatus(row.statusCode)) {
        continue;
      }

      if (needle !== '' && !matchesDisplayFilter(row, needle)) {
        continue;
      }

      visible.push(row);
    }

    // Legacy's rendered order, kept as legacy produces it: `| orderBy:'displayName'` with `reverse` unset
    // sorts ascending, and AngularJS 1.7.9's default comparator lower-cases both strings and only then
    // compares them with `<`/`>` — `toLowerCase`, never `localeCompare`, so the comparison is a
    // case-insensitive code-unit one rather than a locale collation. A pair equal after lower-casing keeps
    // the order the server sent it in, which `sort`'s stability gives and the legacy sort's own index
    // tie-breaker leaves (`app/views/clients/clients.html:63`; Rule 1 clause 3).
    visible.sort((a, b) => {
      const left = a.name.toLowerCase();
      const right = b.name.toLowerCase();

      return left < right ? -1 : left > right ? 1 : 0;
    });

    if (!this.findAnswer()) {
      return visible;
    }

    // Legacy's client-side page over a find's answer: the matched rows cut to the page in view,
    // fifteen at a time, because the search endpoint returns one whole answer and never a page of it
    // (`app/scripts/controllers/client/ClientController.js:81-83`; Rule 1 clause 3).
    const lastPage: number = Math.max(1, Math.ceil(visible.length / this.pageLimit));
    const pageInSlice: number = Math.min(this.page(), lastPage);
    const start: number = (pageInSlice - 1) * this.pageLimit;

    return visible.slice(start, start + this.pageLimit);
  });

  /**
   * Whether a completed read matched nothing — the state that renders the explicit empty state and no error.
   * All three conditions matter: nothing may be in flight (so the empty state cannot flash before the first
   * response), the last read must not have failed (so a failed read is never rendered as "no clients"), and
   * no row may survive the two display filters (AAP 0.7.4 "States every list and record screen must
   * implement").
   */
  readonly isEmpty = computed<boolean>(
    () => !this.loading() && !this.failed() && this.visibleRows().length === 0,
  );

  /**
   * Rows per page: the legacy client list's own fifteen, as the family's `ClientListParams` records it.
   * Deliberately not the larger page a fresh screen might prefer — the request the parity harness compares
   * is the legacy request, and a different `limit` would show up as a difference in every client-list
   * workflow (Rule 1 clauses 2 and 3).
   */
  readonly pageLimit: number = 15;

  /**
   * The page the table is showing, 1-based — the pager's own state and the `offset` the list read derives
   * from it (`(page - 1) * 15`, exactly legacy's `offset: (page - 1) * clientsPerPage`). A signal rather
   * than a plain field because the pager renders it and this view is zoneless and `OnPush`.
   */
  readonly page = signal(1);

  /**
   * How many rows the last read matched across every page, as the envelope's `totalFilteredRecords` reports
   * them — the only member that can say how many pages exist, which is why {@link ClientListPage} models it
   * rather than flattening the envelope to its rows. `0` after a find, because a search answer is not paged,
   * and `0` after a failed read, because nothing measured the match then.
   */
  readonly totalRecords = signal(0);

  /**
   * How many pages the last read's match spans — never fewer than one, so a single-page result is still the
   * first of one rather than an empty pager.
   */
  readonly pageCount = computed<number>(() =>
    Math.max(1, Math.ceil(this.totalRecords() / this.pageLimit)),
  );

  /**
   * The page numbers the pager renders: all of them for a match of nine pages or fewer, and otherwise a
   * nine-page window centred on the page in view — `dir-pagination-controls`' own `max-size`, which keeps a
   * tenant with thousands of clients from painting one link per page.
   */
  readonly pageNumbers = computed<readonly number[]>(() => {
    const pageCount = this.pageCount();
    const size = Math.min(PAGE_NUMBER_WINDOW, pageCount);
    const first = Math.min(
      Math.max(1, this.page() - Math.floor(PAGE_NUMBER_WINDOW / 2)),
      Math.max(1, pageCount - PAGE_NUMBER_WINDOW + 1),
    );

    return Array.from({ length: size }, (_, index) => first + index);
  });

  /**
   * Reads the first page as soon as the screen is constructed, which is what makes `#/clients` the populated
   * landing screen the design shows (AAP 0.7.4).
   */
  constructor() {
    this.load();
  }

  /**
   * Takes the filter field's text from the toolbar (AAP 0.2.3 row `FilterToolbar`): a display filter and
   * nothing more, narrowing the rows already in hand without a request (Rule 1 clauses 2 and 3).
   *
   * @param text the field's text exactly as the toolbar published it; {@link visibleRows} normalises it.
   */
  protected onFilterChange(text: string): void {
    this.filterText.set(text);
  }

  /**
   * Takes the "Show Closed" flag from the toolbar (AAP 0.2.3 row `FilterToolbar`): the second display
   * filter, hiding one status code and issuing no request (Rule 1 clause 3).
   *
   * @param showClosed whether closed clients are shown.
   */
  protected onShowClosedChange(showClosed: boolean): void {
    this.showClosed.set(showClosed);
  }

  /**
   * Runs the toolbar's find: the one place the find field reaches the server, driven by the toolbar's `(search)`
   * output. The text is trimmed: carrying something, the find runs as a search — `GET /search`, the call legacy
   * makes for the same field; cleared, the list is re-read with no filter at all, restoring the first page, as the
   * legacy controller does with an empty `searchText` (`ClientController.search()`). Exactly one request goes out
   * per submit, and an empty field never sends an empty `query` (Rule 1 clauses 2 and 3).
   *
   * @param text the find field's text as the toolbar published it, trimmed here as legacy trimmed it.
   */
  onFind(text: string): void {
    const query = text.trim();

    if (query === '') {
      // Clearing the find returns to the start of the unfiltered list rather than to whatever page
      // the user had paged to, because the search that replaced the rows was never paged.
      this.page.set(1);
      this.load();
      return;
    }

    this.search(query);
  }

  /**
   * Moves the table to another page of the same read — the pager's only entry point.
   *
   * The click is a read, never a navigation: `href` exists only so the control is a focusable,
   * Enter-activatable link, and the default is always prevented so the hash route cannot change. A page
   * outside 1..{@link pageCount}, or the page already shown, is a no-op, so a second click on the current
   * page cannot send a second read (AAP 0.1.1 duplicate-submission protection).
   *
   * @param event the anchor's click event, whose default navigation is suppressed.
   * @param page the 1-based page the user picked.
   */
  goToPage(event: Event, page: number): void {
    event.preventDefault();

    if (page < 1 || page > this.pageCount() || page === this.page()) {
      return;
    }

    this.page.set(page);
    this.load();
  }

  /**
   * Reads one page of `GET /clients` and replaces the rows it holds (AAP 0.7.3 row "Client list and edit").
   *
   * The request carries `offset` and `limit` and nothing else: `offset` is `(page - 1) * 15`, which is how legacy
   * pages the same endpoint. `orderBy` and `sortOrder` stay unset because the screen offers no sort affordance and
   * the legacy list sends neither; `searchText` is not sent because the endpoint does not accept it and the
   * allowlist does not declare it; `dateFormat` and `locale` are absent because a list read carries no date payload
   * (Rule 1 clause 2). The subscription is tied to the component's lifetime with `takeUntilDestroyed`, and
   * `finalize` clears {@link loading} on either outcome (AAP 0.14.1).
   */
  private load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.errorMessage.set(null);
    // A page read is the server's paging again: whatever a find left in hand is replaced by the page
    // this read asks for, so the client-side page over the find's answer ends here (Rule 1 clause 3).
    this.findAnswer.set(false);

    const params: ClientListParams = {
      offset: (this.page() - 1) * this.pageLimit,
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
        // than a bare array, so the page's own rows are what the table holds and the envelope's count
        // is what the pager counts pages with — a row list alone could not say how many pages exist.
        next: (envelope) => {
          this.totalRecords.set(envelope.totalFilteredRecords);
          this.rows.set(envelope.pageItems.map(toPageRow));
        },
        error: (error: unknown) => this.onFailure(error),
      });
  }

  /**
   * Runs the find as a server search and replaces the rows with its answer (AAP 0.7.3 row "Shell: global search";
   * AAP 0.10.1 W3's search half; AAP 0.10.5 item 9).
   *
   * The requested scope is `clients`, the `resource` member `GlobalSearchParams` declares, which the service
   * serialises as `resource=clients,clientIdentifiers` — the value the legacy client list's find sends, which is why
   * a client is still found by one of its identifiers. Text and flag are derived as legacy derives them:
   * `ClientController.search()` removes the surrounding double quotes, sets `exactMatch` from whether that removal
   * changed the text, then calls `globalSearch.search({query, resource: "clients,clientIdentifiers", exactMatch})`
   * (`app/scripts/controllers/client/ClientController.js:44-62`) — so an unquoted find sends `exactMatch=false`
   * rather than omitting it, because legacy's parameter distinguishes "false" from "absent" (Rule 1 clause 2;
   * AAP 0.7.2 `GlobalSearchParams`). The subscription follows {@link load}'s shape: bound to the component's
   * lifetime, `loading` cleared by `finalize` on either outcome, and a failure turned into state through the same
   * {@link onFailure}.
   *
   * @param query the trimmed find text; never empty, because an empty field re-reads the page.
   */
  private search(query: string): void {
    this.loading.set(true);
    this.failed.set(false);
    this.errorMessage.set(null);
    // The find replaces the rows with a search answer, which is not a page of the list: the pager
    // starts again at the view's first page and is not offered over an answer that carries no count.
    this.page.set(1);
    this.findAnswer.set(true);
    this.totalRecords.set(0);

    // Legacy's own derivation, kept verbatim: only a quote at either end is removed, and the flag is
    // true exactly when that removal changed the text. `exactMatch` is always a member of the
    // request, so an unquoted find sends `exactMatch=false` instead of omitting it (Rule 1 clause 2).
    const stripped = query.replace(/(^"|"$)/g, '');

    this.searchService
      .search({ query: stripped, resource: 'clients', exactMatch: stripped !== query })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (results) => {
          const answer: readonly ClientListRow[] = toSearchRows(results);
          this.rows.set(answer);
          // Legacy's own count for a find — `scope.totalClients = actualClients.length` — which is
          // what gives the pager its pages over an answer the server never paged.
          this.totalRecords.set(answer.length);
        },
        error: (error: unknown) => this.onFailure(error),
      });
  }

  /**
   * Records a failed read: the rows are cleared, the failure is flagged, and Fineract's own message is
   * published for a 4xx only.
   *
   * A 5xx or a transport fault sets no message, because `core/http/fineract.interceptor.ts` has already
   * raised the single notification that carries it; reporting it here as well would show the same problem
   * twice, and nothing is logged, rethrown or notified from this file (AAP 0.7.4; Rule 1 clause 9).
   *
   * @param error the rejection the read produced; narrowed here because an observable's error channel is
   *   untyped.
   */
  private onFailure(error: unknown): void {
    this.rows.set([]);
    this.failed.set(true);
    // A failed read is no find's answer to page client-side either (Rule 1 clause 3).
    this.findAnswer.set(false);
    // Nothing measured the match, so the pager must not claim a page count from a failed read.
    this.totalRecords.set(0);

    if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
      this.errorMessage.set(error.message);
      return;
    }

    this.errorMessage.set(null);
  }
}

/**
 * Whether a row shows any of the filter field's text in a cell the table prints.
 *
 * The field's own label fixes what it searches: `label.input.filterbynameaccno` reads "Filter display by
 * name/client number/staff/office" (`app/global-translations/locale-en.json:726`), and legacy narrowed the whole row
 * with `| filter:filterText` (`app/views/clients/clients.html:63`). So every cell this table prints text in is
 * searched — name, client number, external id, office, staff — each compared case-insensitively against the needle
 * the filter has already lower-cased and trimmed; the status cell prints no text at all (AAP 0.10.5 item 11).
 *
 * @param row The row under consideration.
 * @param needle The filter text as the caller normalised it: trimmed and lower-cased.
 * @returns true when the row must stay on screen.
 */
function matchesDisplayFilter(row: ClientListRow, needle: string): boolean {
  const cells: readonly string[] = [
    row.name,
    row.accountNo,
    row.externalId,
    row.officeName,
    row.staffName,
  ];

  return cells.some((cell) => cell.toLowerCase().includes(needle));
}

/**
 * Projects one `GET /clients` row onto the table's row view.
 *
 * The page payload's own names are read here and nowhere else: `displayName` is the name column, `accountNo` and
 * `officeName` are carried as they arrived, and the two members the endpoint omits when a client has none —
 * `externalId` and `staffName` — become the empty string rather than a stand-in the design never shows (Rule 1
 * clause 3). The key is the client's id, because a client appears at most once in one page; the status arrives as
 * an object, so its code is carried as received — the "Show Closed" filter's input — and mapped once to the
 * swatch's colour key.
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
    statusCode: client.status.code,
    statusKey: toClientStatusKey(client.status.code),
  };
}

/**
 * Projects the search answer onto the table's row view, dropping the rows this screen does not render.
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
 * A `CLIENT` row names the client in `entityName`, its account in `entityAccountNo`, its external id in
 * `entityExternalId` and its office in `parentName`, and its own `entityId` opens the record — the five values the
 * legacy controller copies from the same result. A `CLIENTIDENTIFIER` row is a client found by one of its
 * identifiers: `parentName` is its name and `parentId` its id, so the row opens that client as legacy's
 * `#/viewclient/{parentId}` did, and the cells it carries no value for stay empty. The status comes from
 * `entityStatus`, the `{id, code, value}` object legacy reads the same members of; a result carrying none leaves the
 * code empty, which "Show Closed" treats as unclosed rather than hiding the row on a status it never had.
 *
 * @param result One element of the search answer, discriminated by its `entityType`.
 * @returns The row to render, or `null` for a result this screen does not render — a `LOAN` row the union admits but
 *   the `clients` scope never asks for, or a discriminator the server adds beyond the union, dropped rather than
 *   guessed at.
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
        statusCode: result.entityStatus?.code ?? '',
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
        statusCode: result.entityStatus?.code ?? '',
        statusKey: toClientStatusKey(result.entityStatus?.code),
      };

    default:
      return null;
  }
}
