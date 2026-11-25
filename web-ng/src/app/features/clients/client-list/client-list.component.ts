import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import type { FormControl, FormGroup } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { finalize } from 'rxjs';

import { ApiError } from '../../../core/http/api-error';
import { EmptyStateComponent } from '../../../shared/empty-state/empty-state.component';
import { HasPermissionDirective } from '../../../shared/has-permission.directive';
import type { StatusKey } from '../../../shared/status-swatch/status-swatch.component';
import { StatusSwatchComponent } from '../../../shared/status-swatch/status-swatch.component';
import type { Client, ClientListParams } from '../client.models';
import { toClientStatusKey } from '../client.models';
import { ClientService } from '../client.service';

/**
 * One rendered row of the clients table: the API's client plus the colour key the status indicator
 * paints for it, mapped exactly once.
 *
 * Exported so the sibling spec types its expectations against the same declaration instead of
 * restating the pair, and `readonly` throughout so a row cannot be edited in place by a template.
 */
export interface ClientListRow {
  /** The row as `GET /clients` returned it, untouched: no field renamed, trimmed or defaulted. */
  readonly client: Client;

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
 * **What it does.** It reads one page of `GET /clients` when it is constructed and again for each
 * find it submits, and it renders the rows in the order the server returned them. Reads go through
 * `ClientService.list()` — the family's only typed Fineract caller — so this file composes no URL,
 * sets no header and injects no HTTP client: the service is the single place a client URL exists and
 * `core/http/fineract.interceptor.ts` is the single place a header, a mapped error or a 401 lives
 * (Rule 1 clause 5; AAP 0.14.1 "Every URL literal lives in a service"; AAP 0.4.2).
 *
 * **What it sends.** `offset` and `limit`, plus `searchText` only when the find field carries one —
 * the parameter set the family's `ClientListParams` declares and AAP 0.7.3 records for the legacy
 * client resource. The "Show Closed" checkbox and the client-side filter are display filters: they
 * narrow the rows already in hand and never become a query parameter, because the legacy screen
 * sends neither and inventing one would change the request the parity harness compares
 * (Rule 1 clauses 2 and 3).
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
  /** The clients family's typed Fineract caller: the list read, and nothing else (Rule 1 clause 5). */
  private readonly clientService = inject(ClientService);

  /**
   * The component's own lifetime, handed to `takeUntilDestroyed` for every list read, so a response
   * that arrives after the user has navigated away cannot write to a destroyed view.
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
   * The page `GET /clients` last returned, in the server's order. Until the first response arrives
   * (and after a failed read) it is empty, which is what makes the table area blank rather than
   * showing invented rows (AAP 0.7.4).
   */
  readonly rows = signal<readonly Client[]>([]);

  /**
   * Whether a list read is in flight. The template uses it to avoid painting an empty-state message
   * during the frame before the first response, and to disable the find control while its own
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
   * The rows the table renders: the loaded page with two display filters applied and each surviving
   * client mapped to exactly one status key.
   *
   * 1. a client whose status key is `closed` is left out unless "Show Closed" is ticked — `closed` is
   *    the key the three terminal states (closed, rejected, withdrawn) share, which is the design's
   *    own vocabulary;
   * 2. a client whose `displayName` does not contain the filter text is left out when that text is
   *    non-empty, compared case-insensitively and against the name column the filter belongs to;
   * 3. every survivor becomes a {@link ClientListRow}, so the status is mapped once per row.
   *
   * Both filters are client-side and issue no request (Rule 1 clause 3). The server's order is kept
   * exactly — nothing is sorted, ranked or regrouped here.
   */
  readonly visibleRows = computed<readonly ClientListRow[]>(() => {
    const needle = this.filterText().trim().toLowerCase();
    const includeClosed = this.showClosed();
    const visible: ClientListRow[] = [];

    for (const client of this.rows()) {
      const statusKey = toClientStatusKey(client.status.code);

      if (!includeClosed && statusKey === 'closed') {
        continue;
      }

      if (needle !== '' && !client.displayName.toLowerCase().includes(needle)) {
        continue;
      }

      visible.push({ client, statusKey });
    }

    return visible;
  });

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
   * Runs the toolbar's find: the one place a search reaches the server.
   *
   * The find field's text is trimmed and sent as `searchText` when it carries something; when it has
   * been cleared the list is re-read with no search at all, so clearing the field restores the full
   * page. Either way exactly one `GET /clients` goes out per submit — submitting an empty field never
   * sends an empty `searchText` parameter, which the legacy resource does not send either
   * (Rule 1 clauses 2 and 3).
   */
  onFind(): void {
    const searchText = this.toolbar.controls.find.value.trim();

    this.load(searchText === '' ? undefined : searchText);
  }

  /**
   * Reads one page of `GET /clients` and replaces the rows it holds (AAP 0.7.3 row "Client list and
   * edit").
   *
   * The request carries `offset` and `limit` and, only when a search was submitted, `searchText`:
   * `orderBy` and `sortOrder` stay unset because the in-scope screen offers no sort affordance and
   * the legacy list sends neither. `dateFormat` and `locale` are absent because a list read carries
   * no date payload — the service applies that pair to the bodies that do (Rule 1 clause 2).
   *
   * The subscription is tied to the component's lifetime with `takeUntilDestroyed`, and `finalize`
   * clears {@link loading} whether the response arrived or the request failed. A failure becomes
   * state, never an exception escaping the component (AAP 0.14.1).
   *
   * @param searchText the trimmed find text to send, or `undefined` for the unfiltered page.
   */
  private load(searchText?: string): void {
    this.loading.set(true);
    this.failed.set(false);
    this.errorMessage.set(null);

    const params: ClientListParams = {
      offset: this.pageOffset,
      limit: this.pageLimit,
      ...(searchText === undefined ? {} : { searchText }),
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
        next: (page) => this.rows.set(page.pageItems),
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
   * @param error the rejection the list read produced; narrowed here because an observable's error
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
