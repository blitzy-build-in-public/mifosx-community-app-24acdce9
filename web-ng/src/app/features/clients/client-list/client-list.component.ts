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
import { isClosedClientStatus, toClientStatusKey } from '../client.models';
import { ClientService } from '../client.service';

/**
 * How many page links the pager renders at once — `dir-pagination-controls`' own `max-size` default,
 * so a client list of a thousand rows paints nine links around the page in view rather than sixty-six.
 */
const PAGE_NUMBER_WINDOW = 9;

/**
 * One rendered row of the clients table: the six values the table prints, plus the key the loop
 * tracks, the id a row opens and the status code the "Show Closed" filter reads — resolved once per
 * row from whichever read produced it.
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
   *
   * Colour only: it collapses the three terminal states (closed, rejected, withdrawn) into `closed`,
   * which is why it is not what the "Show Closed" filter reads.
   */
  readonly statusKey: StatusKey;

  /**
   * The raw Fineract client status code the payload carried — e.g. `'clientStatusType.closed'` — and
   * the empty string when it carried none. It is the input {@link isClosedClientStatus} decides the
   * "Show Closed" filter with.
   *
   * Deliberately not {@link statusKey}: that key is the swatch's colour vocabulary and gives closed,
   * rejected and withdrawn the same `closed`, while the legacy list's checkbox hides one code only
   * (`app/views/clients/clients.html:65`). Keeping the code as the payload sent it lets the filter
   * hide exactly what legacy hides without re-deriving a colour from it (Rule 1 clause 3).
   */
  readonly statusCode: string;
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
 * empty. A submit that carries text runs the legacy find instead: `GET /search` with `query`,
 * `resource=clients,clientIdentifiers` and the `exactMatch` flag, exactly the call the legacy
 * `ClientController.search()` makes
 * (`globalSearch.search({query, resource: 'clients,clientIdentifiers', exactMatch})`), which is how
 * the legacy screen finds a client by name, mobile number, client number, external id or identifier
 * (AAP 0.7.3 row "Shell: global search"; AAP 0.10.5 item 9). Both reads go through
 * `ClientService.list()` and `SearchService.search()` — the families' only typed Fineract callers —
 * so this file composes no URL, sets no header and injects no HTTP client: those two services are
 * the only places those URLs exist and `core/http/fineract.interceptor.ts` is the only place a
 * header, a mapped error or a 401 lives (Rule 1 clause 5; AAP 0.14.1 "Every URL literal lives in a
 * service"; AAP 0.4.2).
 *
 * **Why the find does not travel on the list request.** `searchText` is not a parameter of
 * `GET /clients`: the fork's `ClientsApiResource.retrieveAll` does not accept it, so a parameter
 * sent there is ignored and the find answers with the unfiltered first page — a search that
 * silently did not search, and a request the parity harness flags (Rule 1 clause 2). The search
 * endpoint's own `query`, `resource` and `exactMatch` are the three parameters legacy's find sends,
 * derived exactly as legacy derives them:
 * `ClientController.search()` strips the field's surrounding double quotes and sets `exactMatch`
 * from whether that stripping changed the text (`app/scripts/controllers/client/ClientController.js:44-62`),
 * so a quoted find reaches Fineract without its quotes and matches exactly (Rule 1 clause 2;
 * AAP 0.7.2 `GlobalSearchParams`).
 *
 * **The row view is projected at receipt.** A page row and a search row carry the same display
 * values under different names, so each response is projected once, as it arrives, into the one
 * {@link ClientListRow} the table binds: the payload's field names are read in exactly one place per
 * source and do not reach the template, and its status code is resolved there into the swatch's
 * colour key while staying on the row as the code the "Show Closed" filter reads — one pass per
 * response rather than one per change detection pass. A row the projection does not describe — the
 * loan row the search union admits but the `clients` scope never asks for — is dropped rather than
 * rendered as a blank line.
 *
 * **The two display filters and the rendered order are client-side.** The "Show Closed" checkbox
 * and the filter field narrow the rows already in hand and never become a query parameter, because
 * the legacy screen sends neither and inventing one would change the request the parity harness
 * compares (Rule 1 clauses 2 and 3). The rendered order is legacy's own:
 * `| orderBy:'displayName':reverse` with `reverse` unset sorts the page by display name ascending
 * before it paints, and AngularJS 1.7.9's default comparator lower-cases both names before it
 * compares them, so that sort is case-insensitive and leaves names equal after lower-casing in the
 * order the server sent them (`app/views/clients/clients.html:63`). {@link visibleRows} reproduces
 * it and {@link rows} keeps the order the server answered with.
 *
 * **What it deliberately does not do, per Rule 1 clause 3 (match legacy, do not improve it).**
 * Paging is legacy's own and nothing more: a page read asks the server for fifteen rows at a time, a
 * find's answer is paged client-side out of the rows already in hand
 * (`getResultsPage` slices `actualClients`, `app/scripts/controllers/client/ClientController.js:15-19`),
 * and the pager appears only when the match spans more than one page, which is what the legacy
 * `dir-pagination-controls` does and why the design's five-client capture paints none
 * (`app/views/clients/clients.html:79-82`; AAP 0.5.4 has `.pagination` supply the styling). No
 * rows-per-page selector and no infinite scroll: legacy carries neither, and the "Rows" control the
 * Figma raster paints belongs to a different generation of the product (Rule 1 clause 3). No
 * spinner, skeleton or
 * progress element (the design carries no loader asset — AAP 0.2.4); no ordering beyond that
 * display-name sort, and no renaming, trimming or reformatting of a server value; no textual status
 * anywhere, because the design paints a colour swatch and a word would be an improvement the
 * migration may not make (AAP 0.10.5 deliberate difference 11); no "Import Clients" control, no left
 * icon rail, no Accounting/Reports/Admin navigation, no hamburger and no bell (AAP 0.9.2; AAP 0.10.5
 * items 4 and 8). Every lifecycle action, the datatable gate that precedes it and the record itself
 * belong to their own screens.
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
   * Whether the rows in hand are a find's answer rather than one page the server read.
   *
   * A find is answered with the whole match at once, so this screen pages it the way legacy does: the
   * answer is kept whole, {@link totalRecords} counts it, and {@link visibleRows} cuts the page in
   * view out of the matched rows without asking the server again
   * (`app/scripts/controllers/client/ClientController.js:15-19,66-85`). A page read and a failed read
   * both clear it, which puts the server's own paging back in charge (Rule 1 clause 3).
   */
  private readonly findAnswer = signal<boolean>(false);

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
   * The rows the table renders: the rows in hand with the two display filters applied, in the order
   * legacy rendered them — display name ascending, compared case-insensitively.
   *
   * 1. a row whose client status code is `closed` is left out unless "Show Closed" is ticked — that
   *    one code only, the way the legacy list hides exactly `clientStatusType.closed`
   *    (`app/views/clients/clients.html:65`). A rejected or withdrawn client is terminal in the
   *    swatch's colour vocabulary yet stays on screen, which is why the filter asks
   *    {@link isClosedClientStatus} about the raw code rather than the row's colour key;
   * 2. a row that shows none of the filter text is left out when that text is non-empty, compared
   *    case-insensitively against every cell the table prints text in — the name, the client number,
   *    the external id, the office and the staff member ({@link matchesDisplayFilter});
   * 3. the survivors are ordered by name ascending, which is the order the legacy pipeline produces:
   *    `dir-paginate="client in clients | orderBy:'displayName':reverse | filter:filterText |
   *    itemsPerPage: clientsPerPage"` with `reverse` unset (`app/views/clients/clients.html:63`), so
   *    the server's page order is not what the table shows (Rule 1 clause 3). The comparison is that
   *    filter's own: AngularJS 1.7.9's default comparator lower-cases both display names and then
   *    compares them with `<`/`>`, so the order is case-insensitive rather than a locale collation,
   *    and two names equal after lower-casing keep the order the server sent them in.
   *
   * Both filters are client-side and issue no request (Rule 1 clause 3), and {@link rows} keeps the
   * order the server answered with: it is this rendered view, not the held data, that legacy's
   * `orderBy` reorders.
   *
   * Over a find's answer one more step follows the three above: the matched rows are cut to the page
   * in view, fifteen at a time, because legacy pages a search answer client-side out of the rows it
   * already holds — `getResultsPage` slices `actualClients` with no request
   * (`app/scripts/controllers/client/ClientController.js:15-19`) and the find keeps the first fifteen
   * of the same rows on screen (`:81-83`). A page the display filters have emptied is clamped to the
   * last page that still holds a match, so the table never stands empty while the answer has one
   * (Rule 1 clause 3).
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

    // Legacy's rendered order, kept as legacy produces it: `| orderBy:'displayName'` with `reverse`
    // unset sorts ascending, and AngularJS 1.7.9's default comparator lower-cases both strings and
    // only then compares them with `<`/`>` — `toLowerCase`, never `localeCompare`, so the comparison
    // is case-insensitive and still a code-unit one rather than a locale collation. A pair that is
    // equal after lower-casing compares equal here and keeps the order the server sent it in, which
    // is what `sort`'s stability does and what the legacy sort's own index tie-breaker leaves
    // (`app/views/clients/clients.html:63`; Rule 1 clause 3).
    visible.sort((a, b) => {
      const left = a.name.toLowerCase();
      const right = b.name.toLowerCase();

      return left < right ? -1 : left > right ? 1 : 0;
    });

    if (!this.findAnswer()) {
      return visible;
    }

    // Legacy's client-side page over a find's answer: the matched rows cut to the page in view,
    // fifteen at a time. A page the display filters have emptied is clamped to the last page that
    // still holds a match, so the table never stands empty while the answer has one
    // (`app/scripts/controllers/client/ClientController.js:15-19,81-83`; Rule 1 clause 3).
    const lastPage: number = Math.max(1, Math.ceil(visible.length / this.pageLimit));
    const pageInSlice: number = Math.min(this.page(), lastPage);
    const start: number = (pageInSlice - 1) * this.pageLimit;

    return visible.slice(start, start + this.pageLimit);
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
   * Rows per page: the legacy client list's own fifteen, as the family's `ClientListParams` records
   * it. Deliberately not the larger page a fresh screen might prefer — the request the parity
   * harness compares is the legacy request, and a different `limit` would show up as a difference in
   * every client-list workflow (Rule 1 clauses 2 and 3).
   */
  readonly pageLimit: number = 15;

  /**
   * The page the table is showing, 1-based — the pager's own state and the `offset` the list read
   * derives from it (`(page - 1) * 15`, exactly legacy's `offset: (page - 1) * clientsPerPage`).
   *
   * A signal rather than a plain field because the pager renders it and this view is zoneless and
   * `OnPush`, so a plain property would leave the pager marking the page it first painted.
   */
  readonly page = signal(1);

  /**
   * How many rows the last read matched, which is what the pager counts its pages with: the paged
   * envelope's `totalFilteredRecords` after a page read — the only member that can say how many
   * pages exist, which is why {@link ClientListPage} models it rather than flattening the envelope
   * to its rows — and the size of the answer after a find, exactly as legacy sets
   * `scope.totalClients = actualClients.length` over the rows it already holds
   * (`app/scripts/controllers/client/ClientController.js:81-83`). It stays `0` after a failed read,
   * because nothing measured the match then.
   */
  readonly totalRecords = signal(0);

  /**
   * How many pages the last read's match spans — never fewer than one, so a single-page result is
   * still the first of one rather than an empty pager.
   */
  readonly pageCount = computed<number>(() =>
    Math.max(1, Math.ceil(this.totalRecords() / this.pageLimit)),
  );

  /**
   * The page numbers the pager renders: all of them for a match of nine pages or fewer, and
   * otherwise a nine-page window centred on the page in view. Nine is `dir-pagination-controls`'
   * own `max-size` default, and the window is what keeps a tenant with thousands of clients from
   * painting one link per page.
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
   * filter at all, so clearing the field restores the first page, which is exactly what the legacy
   * controller does with an empty `searchText` (`ClientController.search()`). Exactly one request
   * goes out per submit, and an empty field never sends an empty `query` (Rule 1 clauses 2 and 3).
   */
  onFind(): void {
    const query = this.toolbar.controls.find.value.trim();

    if (query === '') {
      // Clearing the find returns to the start of the unfiltered list rather than to whatever page
      // the user had paged to, because the rows it replaces came from a find rather than from the
      // page the pager had moved the list to (`app/scripts/controllers/client/ClientController.js:15-27,53-55`:
      // an empty field re-reads the page).
      this.page.set(1);
      this.load();
      return;
    }

    this.search(query);
  }

  /**
   * Moves the table to another page — the pager's only entry point.
   *
   * The click is never a navigation: `href` exists only so the control is a focusable,
   * Enter-activatable link, and the default is always prevented so the hash route cannot change.
   * A page outside 1..{@link pageCount}, or the page already shown, is a no-op, so a second click on
   * the current page cannot send a second read (AAP 0.1.1 duplicate-submission protection).
   *
   * Over a find's answer the move costs no request at all: the answer is already in hand and legacy
   * pages it by slicing the rows it holds (`app/scripts/controllers/client/ClientController.js:15-19`),
   * so only {@link page} changes and {@link visibleRows} cuts the new page out of the same rows. Over
   * one page the server read, it asks the server for that page's `offset` as it always has
   * (Rule 1 clause 3).
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

    if (this.findAnswer()) {
      return;
    }

    this.load();
  }

  /**
   * Reads one page of `GET /clients` and replaces the rows it holds (AAP 0.7.3 row "Client list and
   * edit").
   *
   * The request carries `offset` and `limit` and nothing else. `offset` is the page in view's start,
   * `(page - 1) * 15`, which is how legacy pages the same endpoint. `orderBy` and `sortOrder` stay
   * unset because the in-scope screen offers no sort affordance and the legacy list sends neither;
   * `searchText` is deliberately not sent, because this endpoint does not accept it — the find is
   * the separate search read below. `dateFormat` and `locale` are absent because a list read carries
   * no date payload — the service applies that pair to the bodies that do (Rule 1 clause 2).
   *
   * The subscription is tied to the component's lifetime with `takeUntilDestroyed`, and `finalize`
   * clears {@link loading} whether the response arrived or the request failed. A failure becomes
   * state, never an exception escaping the component (AAP 0.14.1).
   */
  private load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.errorMessage.set(null);
    // A page read is the server's paging again: whatever a find left in hand is replaced by the page
    // this read asks for, so the client-side page over the find's answer ends here — which is what
    // legacy does when the field is cleared (`ClientController.js:15-27,53-55`).
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
   * Runs the find as a server search and replaces the rows with its answer (AAP 0.7.3 row "Shell:
   * global search"; AAP 0.10.1 W3's search half; AAP 0.10.5 item 9).
   *
   * The requested scope is `clients`, carried in the `resource` member `GlobalSearchParams`
   * declares, which the service serialises as `resource=clients,clientIdentifiers` — the value the
   * legacy client list's find sends, and the reason a client is still found by one of its
   * identifiers.
   *
   * The text and the flag are derived the way legacy derives them. `ClientController.search()`
   * removes the surrounding double quotes from the field's text, compares the result with the text
   * it started from, and passes both on:
   * `searchString = searchString.replace(/(^"|"$)/g, '')`,
   * `exactMatch = (searchString.localeCompare(raw) != 0)`, then
   * `globalSearch.search({query: searchString, resource: "clients,clientIdentifiers", exactMatch})`
   * (`app/scripts/controllers/client/ClientController.js:44-62`). So a quoted find searches for its
   * unquoted text and asks for an exact match, and an unquoted find searches for its text verbatim
   * with `exactMatch=false` — sent rather than omitted, because legacy's parameter distinguishes
   * "false" from "absent" (Rule 1 clause 2; AAP 0.7.2 `GlobalSearchParams`).
   *
   * The subscription follows {@link load}'s shape for the same reasons: bound to the component's
   * lifetime, `loading` cleared by `finalize` on either outcome, and a failure turned into state
   * through the same {@link onFailure} the page read uses.
   *
   * The answer is one whole match, not a page, so it is held as it arrived and paged here: legacy
   * counts it (`scope.totalClients = actualClients.length`), paints its first fifteen rows
   * (`scope.clients = scope.actualClients.slice(0, scope.clientsPerPage)`) and answers the pager's
   * later pages by slicing the same array without a request
   * (`app/scripts/controllers/client/ClientController.js:15-19,66-85`). {@link findAnswer} marks the
   * rows as that answer, {@link totalRecords} carries its size, and {@link visibleRows} cuts the page
   * in view (Rule 1 clause 3).
   *
   * @param query the trimmed find text; never empty, because an empty field re-reads the page.
   */
  private search(query: string): void {
    this.loading.set(true);
    this.failed.set(false);
    this.errorMessage.set(null);
    // The find replaces the rows with a search answer, which is one whole match rather than a page of
    // the list: the view starts at its first page, and the rows are marked as a find's answer so the
    // pager pages them client-side (ClientController.js:15-19,66-85).
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
          // Legacy's own count for the find — `scope.totalClients = actualClients.length` — which is
          // what gives the pager its pages over an answer the server never paged
          // (`app/scripts/controllers/client/ClientController.js:81-83`).
          this.totalRecords.set(answer.length);
        },
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
    // Nothing measured the match, so the pager must not claim a page count from a failed read, and a
    // failed read is no find's answer to page client-side either (Rule 1 clause 3).
    this.findAnswer.set(false);
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
 * The field's own label fixes what it searches: `label.input.filterbynameaccno` reads "Filter display
 * by name/client number/staff/office" (`app/global-translations/locale-en.json:726`), and legacy
 * narrowed the whole row with `| filter:filterText` (`app/views/clients/clients.html:63`). So every
 * cell this table prints text in is searched — the name, the client number, the external id, the
 * office and the staff member — each compared case-insensitively against the needle the filter has
 * already lower-cased and trimmed. The status cell prints no text at all (a colour swatch and no
 * word, AAP 0.10.5 item 11), so it holds nothing to match.
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
 * The page payload's own names are read here and nowhere else: `displayName` is the name column,
 * `accountNo` and `officeName` are carried as they arrived, and the two members the endpoint omits
 * when a client has none — `externalId` and `staffName` — become the empty string rather than a
 * stand-in the design never shows (Rule 1 clause 3). The key is the client's id because a client
 * appears at most once in one page. The status arrives as an object on every page row, so its code is
 * carried as received — the "Show Closed" filter's input — and mapped once to the swatch's colour key.
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
 * The status comes from `entityStatus`, the `{id, code, value}` object legacy reads the same members
 * of, for either kind of row; a result that carries none leaves the code empty, which the "Show
 * Closed" filter treats as an unclosed client rather than hiding the row on a status it never had.
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
