import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, type ParamMap, type UrlTree } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { catchError, combineLatest, map, of, switchMap, tap, type Observable } from 'rxjs';

import type { GlobalSearchParams, SearchResult, SearchScope } from '../../core/api/search.service';
import { SearchService } from '../../core/api/search.service';
import { ApiError } from '../../core/http/api-error';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { HasPermissionDirective } from '../../shared/has-permission.directive';
import type { StatusKey } from '../../shared/status-swatch/status-swatch.component';
import { StatusSwatchComponent } from '../../shared/status-swatch/status-swatch.component';

/**
 * The global search results screen: the destination of the signed-in navbar's search control, where
 * a client or a loan is found by name, account number or identifier (AAP 0.7.1 Features row `search`;
 * AAP 0.7.3 row "Shell: global search"; AAP 0.8.2 route `search/:query`; AAP 0.10.5 item 9;
 * AAP 0.11.1 row for this folder; Figma's flow covers the three in-scope screens and not this one,
 * so the look is the legacy Bootstrap 3 card and table the rest of the migration reuses).
 *
 * **One call per parameter set, and the URL lives elsewhere.** Results arrive through
 * `SearchService.search()` — the only caller of the endpoint and the only file that composes its URL
 * (Rule 1 clause 2; AAP 0.14.1 "Every URL literal lives in a service"). This file therefore holds no
 * host, path or query-parameter literal of any kind, injects no HTTP client and knows no fallback
 * host (Rule 1 clause 5; Rule 2), which is what keeps `npm run check:endpoints` silent about this
 * folder. The one string it composes is a client-side navigation target, built through `Router` from
 * the route paths the clients and loans route arrays declare — never `window.location`.
 *
 * **Reading the parameters reactively.** The query is the `:query` path segment and the scope is the
 * `scope` query parameter. Both are read from the route's own observables and combined, so the
 * component re-runs the search when either changes: the navbar reuses this route for a second
 * search, and a snapshot read would answer the first search for the rest of the visit. The stream is
 * switched, not merged, so an in-flight request is superseded rather than racing its successor, and
 * it emits once for the initial navigation — one call per parameter set, never two.
 *
 * **Which scopes exist.** The route's `scope` parameter is matched against the three scopes the
 * control offers, and any other value — the legacy scopes this migration leaves with the legacy
 * application, an empty value, a missing one, a differently cased one — resolves to `all`
 * (AAP 0.10.5 item 9; AAP 0.9.2). The value is not lower-cased or otherwise repaired: a request for
 * an out-of-scope resource must not be silently turned into a different search (Rule 1 clause 3).
 *
 * **Errors are values** (AAP 0.14.1). A failed search becomes `ApiError.message` — Fineract's own
 * text, verbatim, never translated, prefixed or trimmed (Rule 1 clause 3) — on a signal the template
 * renders, so the screen stays mounted and usable and the rows already shown are kept. The component
 * neither notifies nor logs: `core/http/fineract.interceptor.ts` owns the single notification and is
 * the only place a failure or a session detail could reach an output (Rule 1 clause 9), and nothing
 * here writes the query, a payload or an identifier to any console output at all.
 *
 * **What it deliberately does not do** (Rule 1 clause 3, AAP 0.7.4). No spinner, skeleton or
 * placeholder — the design carries no loader asset (AAP 0.2.4); no sorting, filtering, paging or
 * reconciliation of the server's rows, which are rendered in the order received; no scope control,
 * no filter toolbar and no export affordance, because the navbar owns the search and this screen
 * renders its answer; no textual status anywhere, because the indicator is a colour swatch and a word
 * would be an improvement the migration may not make (AAP 0.10.5 item 11); and no link to any
 * out-of-scope module (AAP 0.9.2).
 *
 * **States.** Nothing painted before the first response; the rows once they arrive; the explicit
 * empty state — and no error — when a completed search matched nothing (AAP 0.7.4); Fineract's
 * message above the rows when the read failed.
 */
@Component({
  selector: 'app-search-results',
  imports: [
    RouterLink,
    TranslatePipe,
    EmptyStateComponent,
    StatusSwatchComponent,
    HasPermissionDirective,
  ],
  templateUrl: './search-results.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchResultsComponent {
  /** The search endpoint's only application caller: this screen composes no request of its own. */
  private readonly searchService = inject(SearchService);

  /** The route whose `:query` segment and `scope` parameter select the search to run. */
  private readonly route = inject(ActivatedRoute);

  /**
   * Navigation only: each row carries the `UrlTree` of the record it opens, built here from the
   * clients and loans route paths, so the template links without composing a path of its own.
   */
  private readonly router = inject(Router);

  /** Ends the parameter subscription with the component, so no late response writes a dead view. */
  private readonly destroyRef = inject(DestroyRef);

  /** The trimmed `:query` segment of the search on screen. */
  private readonly currentQuery = signal<string>('');

  /** The validated `scope` parameter of the search on screen. */
  private readonly currentScope = signal<SearchScope>('all');

  /** The rows the last successful search returned, in the server's order; kept when a later one fails. */
  private readonly results = signal<readonly SearchResult[]>([]);

  /** Fineract's failure text for the last attempt, verbatim, or `null` when it succeeded. */
  private readonly failureMessage = signal<string | null>(null);

  /**
   * Whether the search on screen has answered — an emptied query or a response, successful or not.
   * It is what keeps the empty state from painting in the frames before the first response and from
   * standing in for a failure.
   */
  private readonly searchCompleted = signal<boolean>(false);

  /** The trimmed `:query` segment the screen is showing (AAP 0.7.1's `query: Signal<string>`). */
  readonly query: Signal<string> = this.currentQuery.asReadonly();

  /** The validated scope the screen is showing, one of the three the control offers. */
  readonly scope: Signal<SearchScope> = this.currentScope.asReadonly();

  /** The rows to render: every result mapped to the table's own view model, in the server's order. */
  readonly rows: Signal<readonly SearchResultRow[]> = computed<readonly SearchResultRow[]>(() => {
    const rendered: SearchResultRow[] = [];

    for (const result of this.results()) {
      const row = this.toRow(result);
      if (row !== null) {
        rendered.push(row);
      }
    }

    return rendered;
  });

  /**
   * Fineract's own message for the last attempt, verbatim, or `null` when there is nothing to say.
   * Assigned to the template's alert region and to nothing else: the interceptor has already raised
   * its single notification for a platform-level failure, so reporting it here again would show one
   * problem twice (AAP 0.7.4).
   */
  readonly error: Signal<string | null> = this.failureMessage.asReadonly();

  /**
   * Whether the completed search matched nothing — the state that renders the explicit empty state
   * and no error. All three conditions matter: a search must have answered (so the empty state cannot
   * flash before the first response), the answer must not be a failure (so a failed read is never
   * rendered as "no results"), and it must hold no rows.
   */
  readonly isEmpty: Signal<boolean> = computed<boolean>(
    () =>
      this.searchCompleted() && this.failureMessage() === null && this.rows().length === 0,
  );

  /**
   * The legacy translation key that names each row's family, so the Entity column carries a
   * translated word rather than the untranslated discriminator the API sends (`CLIENT`, `LOAN`).
   *
   * The two keys are the legacy bundle's own, and naming the family is what the legacy results screen
   * did on its `<Entity>: CLIENT | Office: …` line; no key for a results heading exists in those
   * bundles, so this screen adds no wording of its own (Rule 1 clauses 3 and 6). The record is
   * exhaustive over the two kinds the table renders, so a third kind would be a compile error rather
   * than an empty cell.
   */
  protected readonly entityLabelKey: Readonly<Record<SearchResultRow['kind'], string>> = {
    client: 'label.heading.client',
    loan: 'label.heading.loan',
  };

  /**
   * Runs one search for the route's current parameters, and another whenever either of them changes.
   *
   * The two parameter observables are combined rather than read from a snapshot, because a second
   * search through the same route instance must replace the first one's results. `switchMap` makes
   * the newest parameter set win and cancels the previous request's answer, so one search can never
   * overwrite the results of the search after it, and `takeUntilDestroyed` ends the subscription with
   * the component.
   */
  constructor() {
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(
        map(([params, queryParams]) => this.toCriteria(params, queryParams)),
        tap((criteria: SearchCriteria) => {
          this.currentQuery.set(criteria.query);
          this.currentScope.set(criteria.scope);
          // A new search starts with nothing to report and no completed answer: the previous rows
          // stay on screen while it runs, but a previous message and the empty state it would gate
          // do not.
          this.failureMessage.set(null);
          this.searchCompleted.set(false);
        }),
        switchMap((criteria: SearchCriteria) => this.search(criteria)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((outcome: SearchOutcome) => {
        this.searchCompleted.set(true);
        this.failureMessage.set(outcome.error);

        // `null` rows is the failure case: what is already rendered is left exactly as it was.
        if (outcome.rows !== null) {
          this.results.set(outcome.rows);
        }
      });
  }

  /**
   * The search one parameter set asks for: the trimmed query and the validated scope.
   *
   * @param params The route's path parameters, carrying `:query`.
   * @param queryParams The route's query parameters, carrying `scope`.
   * @returns The pair the request is made with; the query is trimmed and the scope is never a value
   * outside the three the control offers.
   */
  private toCriteria(params: ParamMap, queryParams: ParamMap): SearchCriteria {
    return {
      query: (params.get('query') ?? '').trim(),
      scope: toScope(queryParams.get('scope')),
    };
  }

  /**
   * Issues the search, or answers immediately with nothing to search for.
   *
   * An empty or whitespace-only query is never sent: the screen empties its table and shows the
   * empty state instead (the navbar reports no empty query either, so this guards a hand-typed URL).
   * A failure is caught here and returned as a value, so the parameter subscription survives it and
   * the next search still runs (AAP 0.14.1).
   *
   * @param criteria The trimmed query and validated scope to search with.
   * @returns A stream of exactly one outcome: the rows, or Fineract's message with the rows kept.
   */
  private search(criteria: SearchCriteria): Observable<SearchOutcome> {
    if (criteria.query === '') {
      return of<SearchOutcome>({ rows: [], error: null });
    }

    // The request body is exactly the two properties the screen knows: the text the user searched
    // for and the scope they chose. `exactMatch` is left undefined because the navbar emits no such
    // choice, and no other parameter is added to the call legacy made (Rule 1 clauses 2 and 3).
    const params: GlobalSearchParams = { query: criteria.query, scope: criteria.scope };

    return this.searchService.search(params).pipe(
      map((results: readonly SearchResult[]): SearchOutcome => ({ rows: results, error: null })),
      catchError((failure: unknown) => of<SearchOutcome>({ rows: null, error: toMessage(failure) })),
    );
  }

  /**
   * Projects one result of the search envelope onto the table's row.
   *
   * The three entity types the in-scope scopes can return are read by their own fields, with the
   * discriminator the service declares and no cast and no `any` (Rule 1 clause 4). What each row
   * carries, and why, follows the payload the backend actually builds (verified in the running
   * fork's search query):
   *
   *   - a `CLIENT` row names the client in `entityName` and its account in `entityAccountNo`; that
   *     payload's `parentName` is the client's **office**, not a client, so it is deliberately not
   *     rendered as the row's client;
   *   - a `CLIENTIDENTIFIER` row is a client matched by one of its identifiers: `parentId` is the
   *     client's id and `parentName` its display name, so the row opens that client exactly as the
   *     legacy screen's `#/viewclient/{parentId}` did, and its own `entityName` is the identifier
   *     value that matched;
   *   - a `LOAN` row's `entityName` is the loan **product**'s name, `parentName` the owning client
   *     and `entityAccountNo` the loan account, so `name` and `product` carry the same string and the
   *     table renders it once, as the row's own label.
   *
   * @param result One element of the search answer, discriminated by its `entityType`.
   * @returns The row to render, or `null` for a row the union does not describe — a discriminator the
   * server added beyond the three this application models, which is skipped rather than guessed at.
   */
  private toRow(result: SearchResult): SearchResultRow | null {
    switch (result.entityType) {
      case 'CLIENT':
        return {
          key: `client:${result.entityId}`,
          kind: 'client',
          accountNo: result.entityAccountNo ?? '',
          name: result.entityName,
          clientName: '',
          product: '',
          status: toStatusKey(result.entityStatus?.code),
          link: this.router.createUrlTree(['/viewclient', String(result.entityId)]),
          permission: 'READ_CLIENT',
        };

      case 'CLIENTIDENTIFIER': {
        const clientId: number = result.parentId ?? result.entityId;

        return {
          key: `clientIdentifier:${result.entityId}`,
          kind: 'client',
          accountNo: result.entityAccountNo ?? '',
          name: result.entityName,
          clientName: result.parentName ?? '',
          product: '',
          status: toStatusKey(result.entityStatus?.code),
          link: this.router.createUrlTree(['/viewclient', String(clientId)]),
          permission: 'READ_CLIENT',
        };
      }

      case 'LOAN':
        return {
          key: `loan:${result.entityId}`,
          kind: 'loan',
          accountNo: result.entityAccountNo ?? '',
          name: result.entityName,
          clientName: result.parentName ?? '',
          product: result.entityName,
          status: toStatusKey(result.entityStatus?.code),
          link: this.router.createUrlTree(['/viewloanaccount', String(result.entityId)]),
          permission: 'READ_LOAN',
        };

      default:
        return null;
    }
  }
}

/**
 * One rendered row of the results table: the fields the table binds, resolved once per row rather
 * than once per change-detection pass.
 *
 * Module-local and deliberately not exported: nothing outside this screen has a use for a projection
 * of the search envelope, so no other file can come to depend on the shape of this table.
 */
interface SearchResultRow {
  /**
   * Stable, unique key for the template's `track`: the row's entity type and its own id, so two
   * results never share a key and the loop never falls back to `$index`.
   */
  readonly key: string;

  /**
   * Which family the row came from. A client matched by an identifier is still a client row: it
   * opens the client's record, and the status it paints is the client's.
   */
  readonly kind: 'client' | 'loan';

  /** The account number the row carries, or `''` when the resource reported none. */
  readonly accountNo: string;

  /** The row's own label: a client's display name, or the loan product's name for a loan row. */
  readonly name: string;

  /** Display name of the client the row belongs to, or `''` when the row is the client itself. */
  readonly clientName: string;

  /** The loan product's name for a loan row; `''` for a client row, which has no product. */
  readonly product: string;

  /** The status indicator's colour key for this row, mapped once by {@link toStatusKey}. */
  readonly status: StatusKey;

  /** The record the row opens: the client's or the loan's own in-scope route. */
  readonly link: UrlTree;

  /** The permission the link requires: the backend's own read code for the row's family. */
  readonly permission: 'READ_CLIENT' | 'READ_LOAN';
}

/** The two values one search is made with. */
interface SearchCriteria {
  /** The trimmed search text; empty means there is nothing to search for. */
  readonly query: string;

  /** The scope to search, always one of the three the control offers. */
  readonly scope: SearchScope;
}

/** What one search attempt produced: the rows to render, or the message to show beside the old ones. */
interface SearchOutcome {
  /** The rows to render, or `null` meaning "keep what is already on screen" (a failed attempt). */
  readonly rows: readonly SearchResult[] | null;

  /** Fineract's own failure text, verbatim, or `null` when the attempt succeeded. */
  readonly error: string | null;
}

/**
 * The status codes the results can carry, mapped to the four keys `StatusSwatchComponent` paints.
 *
 * Keys are the codes' normalised form (see {@link normaliseStatusCode}), so the client family's
 * `clientStatusType.active` and the loan family's `loanStatusType.active` land on the same entry.
 * Client and loan rows both reach this table, which is why the table covers both families' codes
 * rather than one family's: a client's pending state and a loan awaiting approval are the same
 * colour, and every terminal state shares `closed`, which is the design's own vocabulary
 * (AAP 0.2.3 row `StatusSwatch`; AAP 0.10.5 item 11).
 *
 * The entries are the two families' complete enumerations, read from the backend the rows come from
 * (`ClientStatus.java:28-35` — invalid, pending, active, transfer in progress, transfer on hold,
 * closed, rejected, withdraw — and `LoanStatus.java:28-39` — invalid, submitted and pending
 * approval, approved, transfer in progress, transfer on hold, withdrawn by client, rejected, closed
 * obligations met, closed written off, closed reschedule outstanding amount, overpaid). A loan that
 * is approved but not yet disbursed is `pending` rather than `active`, because nothing has been paid
 * out; the states this four-key vocabulary has no colour for — the two transfers, an overpaid loan
 * and an invalid record — are deliberately absent and paint `other`.
 *
 * The clients and loans feature models keep their own family tables for their own screens; this
 * screen may not import either, because a feature may depend on `core` and `shared` and never on
 * another feature (AAP 0.14.1).
 */
const STATUS_KEY_BY_CODE: Readonly<Partial<Record<string, StatusKey>>> = {
  active: 'active',
  approved: 'pending',
  pending: 'pending',
  submittedandpendingapproval: 'pending',
  closed: 'closed',
  closedobligationsmet: 'closed',
  closedrescheduleoutstandingamount: 'closed',
  closedwrittenoff: 'closed',
  rejected: 'closed',
  withdraw: 'closed',
  withdrawnbyclient: 'closed',
};

/**
 * The normalisation a status code is reduced to before it is looked up: lower-cased, its family's
 * message-code prefix removed when the payload carried one, and every separator dropped, so
 * `loanStatusType.submitted.and.pending.approval` and `SUBMITTED_AND_PENDING_APPROVAL` both become
 * `submittedandpendingapproval`.
 *
 * @param code The `code` of a result's status object, as Fineract sent it.
 * @returns The key to look up in {@link STATUS_KEY_BY_CODE}.
 */
function normaliseStatusCode(code: string): string {
  return code
    .toLowerCase()
    .replace(/^[a-z]+statustype\./, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * The status indicator's key for a result's status code.
 *
 * Failure is neutral, never `active`: a code this table does not recognise — a transfer in progress,
 * an overpaid loan, a missing status — paints `other`, which carries a colour of its own without
 * claiming a state. Pure and total, so it can run for every row.
 *
 * @param code The `code` of the row's status object, or `undefined` when the row carried none.
 * @returns One of the four keys `StatusSwatchComponent` renders.
 */
function toStatusKey(code: string | undefined): StatusKey {
  if (code === undefined) {
    return 'other';
  }

  return STATUS_KEY_BY_CODE[normaliseStatusCode(code)] ?? 'other';
}

/**
 * The scope the route's `scope` parameter names.
 *
 * Only the three scopes the navigation control offers are accepted, and everything else is `all`:
 * the legacy application's groups, savings, shares and identifier scopes belong to migration units
 * that are out of scope (AAP 0.9.2, AAP 0.10.5 item 9), so a URL asking for one searches both
 * in-scope families rather than being refused or silently rewritten to a third family. The value is
 * compared exactly as it arrived — not trimmed, not lower-cased — so `ALL` is not repaired into a
 * scope the caller did not name (Rule 1 clause 3).
 *
 * @param raw The `scope` query parameter exactly as the route delivered it, or `null` when absent.
 * @returns The scope to search with.
 */
function toScope(raw: string | null): SearchScope {
  switch (raw) {
    case 'clients':
      return 'clients';
    case 'loans':
      return 'loans';
    default:
      return 'all';
  }
}

/**
 * The message to render for a failed search.
 *
 * `ApiError` is what the interceptor maps every Fineract failure into, and its `message` is the
 * server's own text, which is returned unchanged — no prefix, suffix, capitalisation or translation,
 * because a server message is displayed exactly as the server wrote it (AAP 0.7.2 row
 * `FineractError`; Rule 1 clause 3). A failure that is not an `ApiError` still answers with whatever
 * its own `Error` carries, and anything else renders no message rather than an invented one.
 *
 * @param failure Whatever the request rejected with.
 * @returns The text to show, or `''` when the failure carried none.
 */
function toMessage(failure: unknown): string {
  if (failure instanceof ApiError) {
    return failure.message;
  }

  if (failure instanceof Error) {
    return failure.message;
  }

  return '';
}
