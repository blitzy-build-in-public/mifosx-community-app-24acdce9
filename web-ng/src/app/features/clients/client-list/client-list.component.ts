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

/** How many page links the pager renders at once — `dir-pagination-controls`' own `max-size` default, so a client list of a thousand rows paints nine links around the page in view rather than sixty-six. */
const PAGE_NUMBER_WINDOW = 9;

/** One rendered row of the clients table: the six values the table prints, plus the key the loop tracks, the id a row opens and the status code the "Show Closed" filter reads — resolved once per row from whichever read (Rule 1 clause 3). */
export interface ClientListRow {
  /** Stable key for the template's `track`, unique across both sources: the client's own id for a row of the list page, and the search row's entity type plus its entity id for a search result, so a client found by name and. */
  readonly key: string;
  /** The client id a row opens: the `:id` of `#/viewclient/:id`, from `id` or from `parentId`. */
  readonly clientId: number;
  /** The name the table's first column prints: `displayName` on a page row, `entityName` on a client result and `parentName` on an identifier result — the client each of them names. */
  readonly name: string;
  /** The client number, `''` when the payload carried none. */
  readonly accountNo: string;
  /** The bank-assigned external id, `''` when the payload carried none. */
  readonly externalId: string;
  /** The office name, `''` when the payload carried none. */
  readonly officeName: string;
  /** The loan officer's name, `''` when the payload carried none. */
  readonly staffName: string;
  /** The status indicator's key for this row, from the family's single mapping (`toClientStatusKey`). */
  readonly statusKey: StatusKey;
  /** The raw Fineract client status code the payload carried — e.g (Rule 1 clause 3). */
  readonly statusCode: string;
}

/** The values of the list's filter toolbar, stated as its own type so the builder constructs exactly these three non-nullable controls (Rule 1 clause 4). */
interface ClientListToolbarValues {
  filter: string;
  find: string;
  showClosed: boolean;
}

/** The clients list (`#/clients`) — the screen a signed-in user lands on after the login form is submitted, the entry point of workflow W2 (its "Create Client" control) and of workflow W3 (a row opened onto the record) (AAP 0.7.1, AAP 0.7.4, AAP 0.8.2, AAP 0.11.1). */
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
  /** The clients family's typed Fineract caller: the page read, and nothing else (Rule 1 clause 5). */
  private readonly clientService = inject(ClientService);

  /** The search endpoint's only application caller: the find field's server search (AAP 0.7.1 supporting-services row `SearchService`) (AAP 0.14.1). */
  private readonly searchService = inject(SearchService);

  /** The component's own lifetime, handed to `takeUntilDestroyed` for every read, so a response that arrives after the user has navigated away cannot write to a destroyed view. */
  private readonly destroyRef = inject(DestroyRef);

  /** The filter toolbar the design paints above the table: the client-side filter, the find field with its search button, and the "Show Closed" checkbox (AAP 0.2.3 row `FilterToolbar`) (Rule 1 clause 4). */
  readonly toolbar: FormGroup<{
    filter: FormControl<string>;
    find: FormControl<string>;
    showClosed: FormControl<boolean>;
  }> = inject(FormBuilder).nonNullable.group<ClientListToolbarValues>({
    filter: '',
    find: '',
    showClosed: false,
  });

  /** The rows the last successful read returned, projected at receipt into the table's own view and kept in the server's order (AAP 0.7.4). */
  readonly rows = signal<readonly ClientListRow[]>([]);

  /** Whether a read is in flight. The template uses it to avoid painting an empty-state message during the frame before the first response, and to disable the find submit button while its own request is out (AAP 0.2.4). */
  readonly loading = signal(false);

  /** Whether the last read failed. With {@link errorMessage} empty this is what tells the template a failure arrived without text it may render — a 5xx or a transport fault the interceptor has already notified — so the (AAP 0.7.4). */
  readonly failed = signal(false);

  /** Fineract's own failure text, verbatim, or `null` when there is nothing to show (AAP 0.7.4, Rule 1 clause 9). */
  readonly errorMessage = signal<string | null>(null);

  /** Whether the rows in hand are a find's answer rather than one page the server read (Rule 1 clause 3). */
  private readonly findAnswer = signal<boolean>(false);

  /** The filter control's text as a signal. It must be a signal rather than a read of `toolbar.controls.filter.value` inside the computed below: this view is zoneless and `OnPush`, so a plain property read would leave the. */
  private readonly filterText = toSignal(this.toolbar.controls.filter.valueChanges, {
    initialValue: this.toolbar.controls.filter.value,
  });

  /** The "Show Closed" checkbox as a signal, bridged for the same reason as {@link filterText}. */
  private readonly showClosed = toSignal(this.toolbar.controls.showClosed.valueChanges, {
    initialValue: this.toolbar.controls.showClosed.value,
  });

  /** The rows the table renders: the rows in hand with the two display filters applied, in the order legacy rendered them — display name ascending, compared case-insensitively. 1. a row whose client status code is `closed` (Rule 1 clause 3). */
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

    // Legacy's rendered order, kept as legacy produces it: `| orderBy:'displayName'` with `reverse` unset sorts ascending, and AngularJS 1.7.9's default comparator lower-cases both strings and only then compares them with (Rule 1 clause 3).
    visible.sort((a, b) => {
      const left = a.name.toLowerCase();
      const right = b.name.toLowerCase();

      return left < right ? -1 : left > right ? 1 : 0;
    });

    if (!this.findAnswer()) {
      return visible;
    }

    // Legacy's client-side page over a find's answer: the matched rows cut to the page in view, fifteen at a time (Rule 1 clause 3).
    const lastPage: number = Math.max(1, Math.ceil(visible.length / this.pageLimit));
    const pageInSlice: number = Math.min(this.page(), lastPage);
    const start: number = (pageInSlice - 1) * this.pageLimit;

    return visible.slice(start, start + this.pageLimit);
  });

  /** Whether a completed read matched nothing — the state that renders the explicit empty state and no error (AAP 0.7.4). */
  readonly isEmpty = computed<boolean>(
    () => !this.loading() && !this.failed() && this.visibleRows().length === 0,
  );

  /** Rows per page: the legacy client list's own fifteen, as the family's `ClientListParams` records it. */
  readonly pageLimit: number = 15;

  /** The page the table is showing, 1-based — the pager's own state and the `offset` the list read derives from it (`(page - 1) * 15`, exactly legacy's `offset: (page - 1) * clientsPerPage`). */
  readonly page = signal(1);

  /** How many rows the last read matched, which is what the pager counts its pages with: the paged envelope's `totalFilteredRecords` after a page read — the only member that can say how many pages exist, which is why {@link. */
  readonly totalRecords = signal(0);

  /** How many pages the last read's match spans — never fewer than one, so a single-page result is still the first of one rather than an empty pager. */
  readonly pageCount = computed<number>(() =>
    Math.max(1, Math.ceil(this.totalRecords() / this.pageLimit)),
  );

  /** The page numbers the pager renders: all of them for a match of nine pages or fewer, and otherwise a nine-page window centred on the page in view. */
  readonly pageNumbers = computed<readonly number[]>(() => {
    const pageCount = this.pageCount();
    const size = Math.min(PAGE_NUMBER_WINDOW, pageCount);
    const first = Math.min(
      Math.max(1, this.page() - Math.floor(PAGE_NUMBER_WINDOW / 2)),
      Math.max(1, pageCount - PAGE_NUMBER_WINDOW + 1),
    );

    return Array.from({ length: size }, (_, index) => first + index);
  });

  /** Reads the first page as soon as the screen is constructed, which is what makes `#/clients` the populated landing screen the design shows (AAP 0.7.4). */
  constructor() {
    this.load();
  }

  /** Runs the toolbar's find: the one place the find field reaches the server. */
  onFind(): void {
    const query = this.toolbar.controls.find.value.trim();

    if (query === '') {
      // Clearing the find returns to the start of the unfiltered list rather than to whatever page the user had paged to, because the rows it replaces came from a find rather than from the page the pager had moved the list to.
      this.page.set(1);
      this.load();
      return;
    }

    this.search(query);
  }

  /** Moves the table to another page — the pager's only entry point (AAP 0.1.1, Rule 1 clause 3). */
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

  /** Reads one page of `GET /clients` and replaces the rows it holds (AAP 0.7.3 row "Client list and edit") (Rule 1 clause 2, AAP 0.14.1). */
  private load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.errorMessage.set(null);
    // A page read is the server's paging again: whatever a find left in hand is replaced by the page this read asks for, so the client-side page over the find's answer ends here — which is what legacy does when the field is.
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
        // The endpoint answers with the paged envelope `{totalFilteredRecords, pageItems}` rather than a bare array, so the page's own rows are what the table holds and the envelope's count is what the pager counts pages with — a.
        next: (envelope) => {
          this.totalRecords.set(envelope.totalFilteredRecords);
          this.rows.set(envelope.pageItems.map(toPageRow));
        },
        error: (error: unknown) => this.onFailure(error),
      });
  }

  /** Runs the find as a server search and replaces the rows with its answer (AAP 0.7.3 row "Shell: global search"; AAP 0.10.1 W3's search half; AAP 0.10.5 item 9) (Rule 1 clause 2, AAP 0.7.2, Rule 1 clause 3). */
  private search(query: string): void {
    this.loading.set(true);
    this.failed.set(false);
    this.errorMessage.set(null);
    // The find replaces the rows with a search answer, which is one whole match rather than a page of the list: the view starts at its first page, and the rows are marked as a find's answer so the pager pages them client-side.
    this.page.set(1);
    this.findAnswer.set(true);
    this.totalRecords.set(0);

    // Legacy's own derivation, kept verbatim: only a quote at either end is removed, and the flag is true exactly when that removal changed the text (Rule 1 clause 2).
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
          // Legacy's own count for the find — `scope.totalClients = actualClients.length` — which is what gives the pager its pages over an answer the server never paged (`app/scripts/controllers/client/ClientController.js:81-83`).
          this.totalRecords.set(answer.length);
        },
        error: (error: unknown) => this.onFailure(error),
      });
  }

  /** Records a failed read: the rows are cleared, the failure is flagged, and Fineract's own message is published for a 4xx only (AAP 0.7.4, Rule 1 clause 9). */
  private onFailure(error: unknown): void {
    this.rows.set([]);
    this.failed.set(true);
    // Nothing measured the match, so the pager must not claim a page count from a failed read, and a failed read is no find's answer to page client-side either (Rule 1 clause 3).
    this.findAnswer.set(false);
    this.totalRecords.set(0);

    if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
      this.errorMessage.set(error.message);
      return;
    }

    this.errorMessage.set(null);
  }
}

/** Whether a row shows any of the filter field's text in a cell the table prints (AAP 0.10.5). */
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

/** Projects one `GET /clients` row onto the table's row view. The page payload's own names are read here and nowhere else: `displayName` is the name column, `accountNo` and `officeName` are carried as they arrived, and the (Rule 1 clause 3). */
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

/** Projects the search answer onto the table's row view, dropping the rows this screen does not render. @param results The rows `GET /search` answered with, in the server's order. @returns The rows the table renders, in. */
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

/** Projects one search result onto the table's row view, by the discriminator the result carries. */
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
