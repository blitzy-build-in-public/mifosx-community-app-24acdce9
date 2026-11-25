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
import { toStatusKey, type StatusKey } from '../../shared/status-key.util';
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
 * **Reading the parameters reactively.** The query is the `:query` path segment, and the two
 * parameters the request is made with travel beside it as the route's own query parameters: the
 * `scope` the user chose and legacy's `exactMatch` flag. All of them are read from the route's
 * observables and combined, so the component re-runs the search when any of them changes: the navbar
 * reuses this route for a second search, and a snapshot read would answer the first search for the
 * rest of the visit. The stream is switched, not merged, so an in-flight request is superseded
 * rather than racing its successor, and it emits once for the initial navigation — one call per
 * parameter set, never two.
 *
 * **Which scopes exist.** The route's `scope` parameter is matched against the three scopes the
 * control offers, and any other value — the legacy scopes this migration leaves with the legacy
 * application, an empty value, a missing one, a differently cased one — resolves to `all`
 * (AAP 0.10.5 item 9; AAP 0.9.2). The value is not lower-cased or otherwise repaired: a request for
 * an out-of-scope resource must not be silently turned into a different search (Rule 1 clause 3).
 *
 * **Errors are values, and only a 4xx is this screen's to say** (AAP 0.14.1, AAP 0.7.4). A refused
 * search becomes `ApiError.message` — Fineract's own text, verbatim, never translated, prefixed or
 * trimmed (Rule 1 clause 3) — on a signal the template renders, so the screen stays mounted and
 * usable and the rows already shown are kept. The text is limited to a 4xx, which is the convention
 * every sibling surface keeps and the plan's own state table sets: a 5xx or a transport failure is
 * reported by `core/http/fineract.interceptor.ts`, the owner of the single notification for exactly
 * those statuses, so showing the same problem inline as well would report it twice. A rejection that
 * is not an `ApiError` did not come from Fineract at all — the interceptor maps every
 * `HttpErrorResponse` into one — so its text, which can embed the request URL, is not put on screen
 * either. The component neither notifies nor logs: the interceptor is the only place a failure or a
 * session detail could reach an output (Rule 1 clause 9), and nothing here writes the query, a
 * payload or an identifier to any console output at all.
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
 * message above the rows when a 4xx refused the read; and the rows left standing, with the
 * interceptor's notification as the only report, when a 5xx or a transport failure stopped it.
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

  /**
   * The route whose `:query` segment and `scope` and `exactMatch` parameters select the search to
   * run.
   */
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

  /**
   * Fineract's own text for a 4xx of the last attempt, verbatim, or `null` when there is nothing to
   * show: a success, a 5xx, a transport failure, or a rejection that is not an `ApiError`.
   */
  private readonly failureMessage = signal<string | null>(null);

  /**
   * Whether the last attempt failed, whatever it had to say for itself.
   *
   * It is separate from {@link failureMessage} because a failure does not always carry text this
   * screen may show — a 5xx or a transport failure belongs to the interceptor alone — and the empty
   * state must not stand in for it: without this, a failed read that renders no message would look
   * exactly like a search that matched nothing (AAP 0.7.4).
   */
  private readonly failed = signal<boolean>(false);

  /**
   * Whether the search on screen has answered — an emptied query or a response, successful or not.
   * It is what keeps the empty state from painting in the frames before the first response, and
   * {@link failed} is what keeps it from standing in for a failure.
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
   * The message to render for the last attempt: Fineract's own text for a 4xx, verbatim and
   * untranslated, or `null` when there is nothing to show. Assigned to the template's alert region
   * and to nothing else — the interceptor has already raised its single notification for a 5xx, a
   * transport failure or a rejection that never reached Fineract, so reporting one of those here as
   * well would show one problem twice (AAP 0.7.4).
   */
  readonly error: Signal<string | null> = this.failureMessage.asReadonly();

  /**
   * Whether the completed search matched nothing — the state that renders the explicit empty state
   * and no error. All three conditions matter: a search must have answered (so the empty state cannot
   * flash before the first response), the attempt must not have failed (so a failed read is never
   * rendered as "no results", whether or not the failure carried text this screen may show), and it
   * must hold no rows.
   */
  readonly isEmpty: Signal<boolean> = computed<boolean>(
    () => this.searchCompleted() && !this.failed() && this.rows().length === 0,
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
          // stay on screen while it runs, but a previous message, the failure it recorded, and the
          // empty state they gate do not.
          this.failureMessage.set(null);
          this.failed.set(false);
          this.searchCompleted.set(false);
        }),
        switchMap((criteria: SearchCriteria) => this.search(criteria)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((outcome: SearchOutcome) => {
        this.searchCompleted.set(true);
        this.failureMessage.set(outcome.error);
        // `null` rows is the failure case: what is already rendered is left exactly as it was, and
        // the failure is remembered so the empty state cannot pass for an answer.
        this.failed.set(outcome.rows === null);

        if (outcome.rows !== null) {
          this.results.set(outcome.rows);
        }
      });
  }

  /**
   * The search one parameter set asks for: the trimmed query, the validated scope and the
   * exact-match flag.
   *
   * @param params The route's path parameters, carrying `:query`.
   * @param queryParams The route's query parameters, carrying `scope` and `exactMatch`.
   * @returns The three values the request is made with; the query is trimmed, the scope is never a
   * value outside the three the control offers, and the flag is legacy's own default when the URL
   * carries none.
   */
  private toCriteria(params: ParamMap, queryParams: ParamMap): SearchCriteria {
    return {
      query: (params.get('query') ?? '').trim(),
      scope: toScope(queryParams.get('scope')),
      exactMatch: toExactMatch(queryParams.get('exactMatch')),
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
   * @param criteria The trimmed query, validated scope and exact-match flag to search with.
   * @returns A stream of exactly one outcome: the rows, or the message to show beside the rows kept —
   * `null` when the failure is the interceptor's to report.
   */
  private search(criteria: SearchCriteria): Observable<SearchOutcome> {
    if (criteria.query === '') {
      return of<SearchOutcome>({ rows: [], error: null });
    }

    // The request carries the three parameters legacy's own controller forwards — the text, the
    // resource and the flag that asks for the literal string: `SearchController.js:9` calls
    // `globalSearch.search({query, resource, exactMatch})`, so all three are sent, and the flag is
    // sent even when it is `false`, because legacy distinguishes "false" from "absent" (AAP 0.7.2's
    // `GlobalSearchParams`; AAP 0.7.3 row "Shell: global search"). The scope reaches the model as
    // `resource`, and no other parameter is added to the call legacy made (Rule 1 clauses 2 and 3).
    const params: GlobalSearchParams = {
      query: criteria.query,
      resource: criteria.scope,
      exactMatch: criteria.exactMatch,
    };

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

  /**
   * The status indicator's colour key for this row, mapped once by {@link toStatusKey} — the single
   * mapping the whole application shares, from `web-ng/src/app/shared/status-key.util.ts`. The
   * vocabulary and its mapping are shared declarations, which is why this screen reads them from
   * `shared/` and not from a feature model: a feature may depend on `core` and `shared` and never on
   * another feature (AAP 0.14.1), and one code therefore has exactly one colour here and on the
   * clients list.
   */
  readonly status: StatusKey;

  /** The record the row opens: the client's or the loan's own in-scope route. */
  readonly link: UrlTree;

  /** The permission the link requires: the backend's own read code for the row's family. */
  readonly permission: 'READ_CLIENT' | 'READ_LOAN';
}

/** The three values one search is made with. */
interface SearchCriteria {
  /** The trimmed, unquoted search text; empty means there is nothing to search for. */
  readonly query: string;

  /** The scope to search, always one of the three the control offers. */
  readonly scope: SearchScope;

  /**
   * Whether the text arrived quoted — legacy's `exactMatch`, always sent and `false` when the route
   * carried no recognised value.
   */
  readonly exactMatch: boolean;
}

/**
 * What one search attempt produced: the rows to render, and the message to show beside the old ones
 * when the failure is one this screen reports itself.
 */
interface SearchOutcome {
  /** The rows to render, or `null` meaning "keep what is already on screen" (a failed attempt). */
  readonly rows: readonly SearchResult[] | null;

  /**
   * The text to render for a failed attempt — Fineract's own message for a 4xx — or `null` when
   * there is nothing for this screen to show: a success, a 5xx, a transport failure, or a rejection
   * that is not an `ApiError`, all of which are the interceptor's to report.
   */
  readonly error: string | null;
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
 * Legacy's `exactMatch` flag for the route's `exactMatch` parameter.
 *
 * Legacy derived the value in the navbar, put the literal `true` or `false` in its URL and let
 * `SearchController` forward whatever arrived, so the parameter is always part of the request:
 * only the literal `true` asks Fineract for the whole string, and an absent or unrecognised value is
 * legacy's own unquoted `false` rather than a reason to drop the parameter (AAP 0.3.4; AAP 0.7.2's
 * `GlobalSearchParams`; Rule 1 clauses 2 and 3). The value is compared exactly as it arrived — not
 * trimmed, not lower-cased — so `TRUE` is not repaired into a flag the caller did not send.
 *
 * @param raw The `exactMatch` query parameter exactly as the route delivered it, or `null` when the
 *   URL carried none.
 * @returns `true` only when the parameter asked for an exact match.
 */
function toExactMatch(raw: string | null): boolean {
  return raw === 'true';
}

/**
 * The message to render for a failed search.
 *
 * Only a 4xx of Fineract's own carries text here. `ApiError` is what the interceptor maps every
 * Fineract failure into, and for a 4xx its `message` is the server's own text, which is returned
 * unchanged — no prefix, suffix, capitalisation or translation, because a server message is
 * displayed exactly as the server wrote it (AAP 0.7.2 row `FineractError`; Rule 1 clause 3).
 *
 * Everything else answers `null`, and every case for the same reason: the screen must not report a
 * problem the interceptor already reported, and must not put text on screen that is not the
 * server's. A 5xx and a transport failure (status `0`) have already raised the interceptor's single
 * notification (`core/http/fineract.interceptor.ts:89-92`), so text here would show one problem
 * twice. A rejection that is not an `ApiError` never came from Fineract at all — the interceptor
 * maps every `HttpErrorResponse` into one — so a plain `Error`'s message is Angular's or the
 * application's own text, which can embed the request URL and disclose the configured API host, and
 * a rejection that is not an `Error` carries nothing to show. This is the same 4xx-only rule the
 * sibling surfaces keep (`client-list.component.ts`, `client-accounts.component.ts`; AAP 0.7.4).
 *
 * @param failure Whatever the request rejected with.
 * @returns Fineract's own message for a 4xx, or `null` when this screen has nothing to show.
 */
function toMessage(failure: unknown): string | null {
  return failure instanceof ApiError && failure.status >= 400 && failure.status < 500
    ? failure.message
    : null;
}
