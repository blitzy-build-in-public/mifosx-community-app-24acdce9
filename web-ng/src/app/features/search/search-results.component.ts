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
import { PanelCardComponent } from '../../shared/panel-card/panel-card.component';

/** The global search results screen: the destination of the signed-in navbar's search control, where a client or a loan is found by name, account number or identifier (AAP 0.7.1 Features row `search`; AAP 0.7.3 row "Shell: global search"; AAP 0.8.2, AAP 0.10.5, AAP 0.11.1, Rule 1 clause 2). */
@Component({
  selector: 'app-search-results',
  imports: [
    RouterLink,
    TranslatePipe,
    EmptyStateComponent,
    HasPermissionDirective,
    PanelCardComponent,
  ],
  templateUrl: './search-results.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchResultsComponent {
  /** The search endpoint's only application caller: this screen composes no request of its own. */
  private readonly searchService = inject(SearchService);

  /** The route whose `:query` segment and `scope` and `exactMatch` parameters select the search to run. */
  private readonly route = inject(ActivatedRoute);

  /** Navigation only: each row carries the `UrlTree` of the record it opens, built here from the clients and loans route paths, so the template links without composing a path of its own. */
  private readonly router = inject(Router);

  /** Ends the parameter subscription with the component, so no late response writes a dead view. */
  private readonly destroyRef = inject(DestroyRef);

  /** The trimmed `:query` segment of the search on screen. */
  private readonly currentQuery = signal<string>('');

  /** The validated `scope` parameter of the search on screen. */
  private readonly currentScope = signal<SearchScope>('all');

  /** The rows the last successful search returned, in the server's order; kept when a later one fails. */
  private readonly results = signal<readonly SearchResult[]>([]);

  /** Fineract's own text for a 4xx of the last attempt, verbatim, or `null` when there is nothing to show: a success, a 5xx, a transport failure, or a rejection that is not an `ApiError`. */
  private readonly failureMessage = signal<string | null>(null);

  /** Whether the last attempt failed, whatever it had to say for itself (AAP 0.7.4). */
  private readonly failed = signal<boolean>(false);

  /** Whether the search on screen has answered — an emptied query or a response, successful or not. */
  private readonly searchCompleted = signal<boolean>(false);

  /** The trimmed `:query` segment the screen is showing (AAP 0.7.1's `query: Signal<string>`). */
  readonly query: Signal<string> = this.currentQuery.asReadonly();

  /** The validated scope the screen is showing, one of the three the control offers. */
  readonly scope: Signal<SearchScope> = this.currentScope.asReadonly();

  /** The answer the results list renders, with legacy's own bound applied (Rule 1 clause 3). */
  private readonly cappedResults: Signal<SearchCap> = computed<SearchCap>(() =>
    capToLegacyLimit(this.results()),
  );

  /** The results to render: every result of the bounded answer mapped to the results list's own view model, in the server's order. */
  readonly rows: Signal<readonly SearchResultRow[]> = computed<readonly SearchResultRow[]>(() => {
    const rendered: SearchResultRow[] = [];

    for (const result of this.cappedResults().results) {
      const row = this.toRow(result);
      if (row !== null) {
        rendered.push(row);
      }
    }

    return rendered;
  });

  /** Whether the answer the screen holds was longer than legacy's own notice threshold, which is what makes the results list render the bundle's `label.search.query.matched.results.exceeds.max.length` above the blocks it kept (Rule 1 clause 3). */
  readonly exceedsMaxLength: Signal<boolean> = computed<boolean>(
    () => this.cappedResults().exceedsMaxLength,
  );

  /** The message to render for the last attempt: Fineract's own text for a 4xx, verbatim and untranslated, or `null` when there is nothing to show (AAP 0.7.4). */
  readonly error: Signal<string | null> = this.failureMessage.asReadonly();

  /** Whether the completed search matched nothing — the state that renders the explicit empty state and no error. */
  readonly isEmpty: Signal<boolean> = computed<boolean>(
    () => this.searchCompleted() && !this.failed() && this.rows().length === 0,
  );

  /** The legacy translation key that names each row's family, so the `Entity:` line carries a translated word rather than the untranslated discriminator the API sends (`CLIENT`, `LOAN`). */
  protected readonly entityLabelKey: Readonly<Record<SearchResultRow['kind'], string>> = {
    client: 'label.heading.client',
    loan: 'label.heading.loan',
  };

  /** Runs one search for the route's current parameters, and another whenever either of them changes. */
  constructor() {
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(
        map(([params, queryParams]) => this.toCriteria(params, queryParams)),
        tap((criteria: SearchCriteria) => {
          this.currentQuery.set(criteria.query);
          this.currentScope.set(criteria.scope);
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
        // `null` rows is the failure case: what is already rendered is left exactly as it was, and the failure is remembered so the empty state cannot pass for an answer.
        this.failed.set(outcome.rows === null);

        if (outcome.rows !== null) {
          this.results.set(outcome.rows);
        }
      });
  }

  /** The search one parameter set asks for: the trimmed query, the validated scope and the exact-match flag. @param params The route's path parameters, carrying `:query`. @param queryParams The route's query parameters. */
  private toCriteria(params: ParamMap, queryParams: ParamMap): SearchCriteria {
    return {
      query: (params.get('query') ?? '').trim(),
      scope: toScope(queryParams.get('scope')),
      exactMatch: toExactMatch(queryParams.get('exactMatch')),
    };
  }

  /** Issues the search, or answers immediately with nothing to search for (AAP 0.14.1). */
  private search(criteria: SearchCriteria): Observable<SearchOutcome> {
    if (criteria.query === '') {
      return of<SearchOutcome>({ rows: [], error: null });
    }

    // The request carries the three parameters legacy's own controller forwards — the text, the resource and the flag that asks for the literal string: `SearchController.js:9` calls `globalSearch.search({query, resource, exactMatch})` (AAP 0.7.2, AAP 0.7.3).
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

  /** Projects one result of the search envelope onto the block the results list renders (Rule 1 clause 4). */
  private toRow(result: SearchResult): SearchResultRow | null {
    switch (result.entityType) {
      case 'CLIENT':
        return {
          key: `client:${result.entityId}`,
          kind: 'client',
          accountNo: result.entityAccountNo ?? '',
          name: result.entityName,
          printsAccountNo: true,
          parentName: result.parentName ?? '',
          parentLabelKey: 'label.heading.office',
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
          printsAccountNo: false,
          parentName: result.parentName ?? '',
          parentLabelKey: 'label.heading.client',
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
          printsAccountNo: true,
          parentName: result.parentName ?? '',
          parentLabelKey: 'label.heading.client',
          link: this.router.createUrlTree(['/viewloanaccount', String(result.entityId)]),
          permission: 'READ_LOAN',
        };

      default:
        return null;
    }
  }
}

/** One rendered block of the results list: the fields the template binds, resolved once per row rather than once per change-detection pass. */
interface SearchResultRow {
  /** Stable, unique key for the template's `track`: the row's entity type and its own id, so two results never share a key and the loop never falls back to `$index`. */
  readonly key: string;
  /** Which family the row came from. A client matched by an identifier is still a client row: it opens the client's record and prints the client family's wording. */
  readonly kind: 'client' | 'loan';
  /** The account number the row carries, or `''` when the resource reported none. */
  readonly accountNo: string;
  /** The row's own label: a client's display name, or the loan product's name for a loan row. */
  readonly name: string;
  /** Whether the block prints legacy's `| #<accountNo>` segment after the name. */
  readonly printsAccountNo: boolean;
  /** The name the block prints after the parent label: the client's office for a `CLIENT` result, the owning client for a `LOAN` result and for a client matched by an identifier, or `''` when the payload carried none — no placeholder or invented word stands in for it (Rule 1 clause 3). */
  readonly parentName: string;
  /** The legacy translation key that names what {@link parentName} is for this row's family: the client's office, or the client the row belongs to. */
  readonly parentLabelKey: 'label.heading.office' | 'label.heading.client';
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
  /** Whether the text arrived quoted — legacy's `exactMatch`, always sent and `false` when the route carried no recognised value. */
  readonly exactMatch: boolean;
}

/** What one search attempt produced: the rows to render, and the message to show beside the old ones when the failure is one this screen reports itself. */
interface SearchOutcome {
  /** The rows to render, or `null` meaning "keep what is already on screen" (a failed attempt). */
  readonly rows: readonly SearchResult[] | null;
  /** The text to render for a failed attempt — Fineract's own message for a 4xx — or `null` when there is nothing for this screen to show: a success, a 5xx, a transport failure, or a rejection that is not an `ApiError`, all. */
  readonly error: string | null;
}

/** The answer as the results list renders it, with legacy's own bound applied: the results to project, and whether the answer was long enough for legacy's own notice to be shown above them. */
interface SearchCap {
  /** The results to project: the answer unchanged, or its first {@link LEGACY_SEARCH_ROW_CAP} rows. */
  readonly results: readonly SearchResult[];
  /** Whether the answer held more than {@link LEGACY_SEARCH_NOTICE_THRESHOLD} results. */
  readonly exceedsMaxLength: boolean;
}

/** The answer length above which legacy shows its notice: its controller tests `data.length > 200` before it cuts anything (`app/scripts/controllers/main/SearchController.js:10`). */
const LEGACY_SEARCH_NOTICE_THRESHOLD = 200;

/** The rows legacy keeps when it cuts an answer short: `data.slice(0, 201)`, one more than the threshold (`app/scripts/controllers/main/SearchController.js:11`). */
const LEGACY_SEARCH_ROW_CAP = 201;

/** Applies legacy's own bound to the search answer. The search endpoint takes no `limit` this application sets, so the whole answer arrives and the screen decides how much of it to render — exactly the decision legacy's controller took (Rule 1 clause 3). */
function capToLegacyLimit(results: readonly SearchResult[]): SearchCap {
  return results.length > LEGACY_SEARCH_NOTICE_THRESHOLD
    ? { results: results.slice(0, LEGACY_SEARCH_ROW_CAP), exceedsMaxLength: true }
    : { results, exceedsMaxLength: false };
}

/** The scope the route's `scope` parameter names. Only the three scopes the navigation control offers are accepted, and everything else is `all`: the legacy application's groups, savings, shares and identifier scopes (AAP 0.9.2, AAP 0.10.5, Rule 1 clause 3). */
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

/** Legacy's `exactMatch` flag for the route's `exactMatch` parameter (AAP 0.3.4, AAP 0.7.2). */
function toExactMatch(raw: string | null): boolean {
  return raw === 'true';
}

/** The message to render for a failed search. Only a 4xx of Fineract's own carries text here (AAP 0.7.2, Rule 1 clause 3, AAP 0.7.4). */
function toMessage(failure: unknown): string | null {
  return failure instanceof ApiError && failure.status >= 400 && failure.status < 500
    ? failure.message
    : null;
}
