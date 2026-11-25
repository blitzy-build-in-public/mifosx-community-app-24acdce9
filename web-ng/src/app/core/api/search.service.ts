import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import { AppConfigService } from '../config/app-config.service';

/**
 * The scopes the global search offers: clients, loans, or both at once (AAP 0.7.1's supporting-
 * services row `SearchService`, AAP 0.8.2's route-and-service table, AAP 0.10.5 item 9).
 *
 * This is a cross-folder contract, not a private detail: `core/layout/global-search.component.ts`
 * types its scope control with it and `features/search/search-results.component.ts` reads it from
 * the route, so the two cannot disagree about which scopes exist. The legacy header offered six
 * scopes; the four this migration leaves to the legacy application — groups, savings, shares, and
 * client identifiers as a scope of their own — are out of scope, so they are absent from the type
 * rather than carried and refused at run time.
 */
export type SearchScope = 'clients' | 'loans' | 'all';

/**
 * The query of one `GET /search` call (AAP 0.7.3 row "Shell: global search"), as one object rather
 * than loose arguments so a parameter cannot be sent by accident: the service serialises these
 * three names and nothing else (AAP 0.7.2's typed-query precedent).
 */
export interface GlobalSearchParams {
  /** The text the user searched for, sent verbatim as `query`. */
  readonly query: string;

  /**
   * The selected scope, carried under the member name AAP 0.7.2 fixes for this model: the member is
   * the resource to search. Its value is one of {@link SearchScope}'s three, and
   * {@link toResourceParam} is the single place that turns it into the value of the wire's
   * `resource` parameter — the two names differ because the control offers a scope while the
   * endpoint takes a resource list.
   */
  readonly resource: SearchScope;

  /**
   * The optional `exactMatch` flag. Left undefined, nothing is sent; an explicit `false` is still
   * sent, because legacy's parameter distinguishes "false" from "absent" and dropping it would
   * change the request (Rule 1 clause 3).
   */
  readonly exactMatch?: boolean;
}

/**
 * The Fineract search row — the `SearchData` envelope's element — reduced to the fields an
 * in-scope results list reads (AAP 0.7.2's `SearchResult` row; AAP 0.10.2's displayed-data
 * comparison).
 *
 * **The one loose boundary this file declares, and why (Rule 1 clause 4).** `GET /search` returns a
 * heterogeneous array: one row shape per searched resource, discriminated by `entityType`, and each
 * resource's full row belongs to that resource's own model file in `features/`, which this file
 * neither restates nor overrides. Only the members a results list renders are declared here, and
 * the per-resource detail is deliberately not modelled: `CLIENT` rows come from the clients
 * feature's `Client`, `LOAN` rows from the loans feature's `LoanAccount`, and `CLIENTIDENTIFIER`
 * rows correspond to the identifiers section of the client record. A discriminator the server adds
 * later is therefore not modelled either — it reaches a consumer as a row this union does not
 * describe, which is the honest outcome rather than a silently wrong field read. The alternative,
 * `any` or an index signature, would make every such read compile while removing the check this
 * declaration exists to provide.
 */
interface SearchData {
  /** Identifier of the matched entity within its own resource — a client id or a loan id. */
  readonly entityId: number;

  /** The matched entity's display name: a client's full name, or the loan account's name. */
  readonly entityName: string;

  /** The matched account number, when the resource carries one. */
  readonly entityAccountNo?: string;

  /** The matched entity's external id, when the resource carries one. */
  readonly entityExternalId?: string;

  /** Client id owning the row, for a row that belongs to a client (a loan, an identifier). */
  readonly parentId?: number;

  /** Display name of that owning client, rendered beside the row when present. */
  readonly parentName?: string;

  /**
   * The entity's status as Fineract sends it — an object, not a bare string: `GET /search` returns
   * `{ id, code, value }` for every row that carries a status (Fineract's `EnumOptionData`, e.g.
   * `{ id: 300, code: 'clientStatusType.active', value: 'Active' }`). `id` is the numeric status
   * id, `code` the message code, `value` the server's English label.
   *
   * All three members are declared rather than the label alone, because legacy reads the object:
   * its global search assigns `result.entityStatus.value` and `result.entityStatus.code`
   * (`app/scripts/controllers/client/ClientController.js`), so a results list may key off `code` as
   * well as display `value`. Optional, because not every searched resource's row carries a status.
   */
  readonly entityStatus?: {
    readonly id: number;
    readonly code: string;
    readonly value: string;
  };
}

/**
 * One row of `GET /search`, narrowed to the three entity types the in-scope scopes can return
 * (AAP 0.7.3 row "Shell: global search", AAP 0.10.5 item 9).
 *
 * **The declared boundary (Rule 1 clause 4).** The payload is Fineract's heterogeneous
 * `SearchData` envelope, whose per-resource row shapes are owned by the feature model files and are
 * not restated here; this union declares only which discriminator values global search can produce
 * and leaves the per-resource detail to {@link SearchData}'s members. A discriminator the server
 * adds beyond these three is therefore not modelled, and neither is it widened into `any` or an
 * index signature — an unmodelled row is one no consumer can read by accident.
 *
 * `CLIENTIDENTIFIER` is a member because `toResourceParam('clients')` sends `clientIdentifiers`
 * alongside `clients`: a client found by an identifier comes back as an identifier row whose
 * `parentId`/`parentName` name the client, which is how global search keeps finding a client by
 * identifier the way legacy does. `LOAN` covers the loans scope.
 */
export type SearchResult =
  | (SearchData & { readonly entityType: 'CLIENT' })
  | (SearchData & { readonly entityType: 'CLIENTIDENTIFIER' })
  | (SearchData & { readonly entityType: 'LOAN' });

/**
 * The `resource` query parameter a scope sends, and the registered mapping between the three
 * scopes on screen and the values legacy put on the wire (AAP 0.7.3 row "Shell: global search",
 * AAP 0.10.5 item 9).
 *
 * Exported rather than inlined so the mapping is asserted directly by the contract spec and so no
 * second derivation of it can appear anywhere else. The client-identifier expansion on `clients`
 * is deliberate, not incidental: it is the value legacy's client search sends, and it is what lets
 * a client be found by an identifier without offering identifiers as a scope of their own.
 *
 * @param scope The scope the user selected.
 * @returns the value of the `resource` parameter, as a comma-separated list of Fineract resources.
 */
export function toResourceParam(scope: SearchScope): string {
  // Exhaustive over SearchScope with no default branch, so adding a scope to the union without
  // deciding what it sends is a compile error rather than a silently unsearched one.
  switch (scope) {
    case 'clients':
      return 'clients,clientIdentifiers';
    case 'loans':
      return 'loans';
    case 'all':
      return 'clients,clientIdentifiers,loans';
  }
}

/**
 * One option of the `GET /search/template` answer: a loan product or an office the ad-hoc query
 * template offers for one of its two selects (AAP 0.7.3 row "Shell: global search").
 *
 * Narrowed to the `id`/`name` pair a select reads, following the precedent `core/auth`'s
 * `SessionUserResponse` sets for a payload larger than the screen needs: the server's loan-product
 * and office rows carry dozens of fields of their own, which belong to their own resources rather
 * than to this answer.
 */
export interface SearchTemplateOption {
  /** The option's identifier, as the ad-hoc query form sends it. */
  readonly id: number;

  /** The option's display name, as the server sends it and a select renders it. */
  readonly name: string;
}

/**
 * The `GET /search/template` answer (AAP 0.7.3 row "Shell: global search"): Fineract's **ad-hoc
 * query template**, the payload whose two option lists populate that query screen's loan-product and
 * office selects. It is not a list of searchable resources — the endpoint returns no such thing, and
 * the set the global search control offers is the client-side {@link SearchScope} union, fixed at
 * clients and loans (AAP 0.10.5 item 9), never derived from this answer.
 *
 * Both lists are declared as the fork's `AdHocSearchQueryData.template` builds them, each element
 * narrowed by {@link SearchTemplateOption}. The five matched-result members that the same payload
 * class carries (`officeName`, `loanProductName`, `count`, `loanOutStanding`, `percentage`) are
 * deliberately not modelled: they are `null` on a template read, so a declaration of them would be
 * a member no screen could prove the shape of (Rule 1 clause 3).
 */
export interface SearchTemplate {
  /** The loan products the ad-hoc query may be filtered by, when the server offers any. */
  readonly loanProducts?: readonly SearchTemplateOption[];

  /** The offices the ad-hoc query may be filtered by, when the server offers any. */
  readonly offices?: readonly SearchTemplateOption[];
}

/**
 * The application's one caller of the Fineract search endpoints: the navbar's global search and
 * the search results screen (AAP 0.7.1 supporting-services row `SearchService`, AAP 0.8.2).
 *
 * It owns both paths — `search` and `search/template` — and composes each URL through
 * `AppConfigService.apiUrl()`, so the host comes from the resolved configuration and never from a
 * literal (Rule 2). It attaches no header: the tenant header and the authorization header belong
 * to the single HTTP interceptor (AAP 0.4.2, Rule 1 clause 5), and neither endpoint carries a date,
 * so no `dateFormat`/`locale` pair is sent. Should a date-bearing body ever be added here, both
 * members become mandatory together (Rule 1 clause 2).
 *
 * It adds nothing legacy did not do: no debounce, no retry, no cache, no pagination and no mapping
 * of the server's rows into a different shape (Rule 1 clause 3), and it logs nothing at all — a
 * search carries a client's name or identifier in its own URL (Rule 1 clause 9).
 */
@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly http = inject(HttpClient);

  /** The only source of the Fineract host and API root; no URL in this file holds either. */
  private readonly config = inject(AppConfigService);

  /**
   * Runs the global search: `GET /search` with `query` and `resource`, plus `exactMatch` when the
   * caller supplies it (AAP 0.7.3 row "Shell: global search", AAP 0.10.1 W3's search half).
   *
   * The rows arrive as the server ordered them, typed by their own `entityType` discriminator; this
   * method neither filters nor sorts them (Rule 1 clause 3). A failure propagates unchanged so the
   * interceptor can map it into the message the screen shows (AAP 0.4.2).
   *
   * @param params The search text, the selected scope in its `resource` member, and the optional
   * exact-match flag.
   * @returns the matching rows, one element per result.
   */
  search(params: GlobalSearchParams): Observable<SearchResult[]> {
    let queryParams: HttpParams = new HttpParams()
      .set('query', params.query)
      .set('resource', toResourceParam(params.resource));

    // `!== undefined`, not truthiness: legacy sends `exactMatch=false` when the user turned exact
    // matching off, and omits the parameter when the flag was never set.
    if (params.exactMatch !== undefined) {
      queryParams = queryParams.set('exactMatch', String(params.exactMatch));
    }

    return this.http.get<SearchResult[]>(this.config.apiUrl('search'), { params: queryParams });
  }

  /**
   * Reads the search template: `GET /search/template`, with no parameters (AAP 0.7.3 row
   * "Shell: global search", AAP 0.10.4's template-coverage gate).
   *
   * The answer is Fineract's **ad-hoc query template** — the loan-product and office option lists
   * that query screen's two selects are built from — and not a list of searchable resources; see
   * {@link SearchTemplate}. It is returned as received, with no defaulting or reshaping (Rule 1
   * clause 3).
   *
   * **Why no in-scope screen calls this method** (AAP 0.10.3 criterion 4, AAP 0.12). Its only
   * legacy consumer is the ad-hoc query search screen
   * (`app/scripts/controllers/main/AdHocQuerySearchController.js`), which this migration leaves to
   * the legacy application (AAP 0.9.2); the shell search that is in scope
   * (`app/scripts/controllers/main/SearchController.js`) never requests it, issuing `GET /search`
   * alone. A screen or initialiser here that read this template would therefore add a request
   * legacy never makes, which the parity criterion records as a request difference in the search
   * workflow — the same reason the tenant business date is read by the harness and not by the
   * application (AAP 0.12). The method stays because the service must own the app's equivalent of
   * legacy's template call (AAP 0.7.1, AAP 0.10.3 criterion 6), and its contract spec asserts the
   * parameterless request it composes.
   *
   * @returns the ad-hoc query template as the server sends it.
   */
  template(): Observable<SearchTemplate> {
    return this.http.get<SearchTemplate>(this.config.apiUrl('search/template'));
  }
}
