import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { defer, type Observable } from 'rxjs';

import { AppConfigService } from '../config/app-config.service';

/** The scopes the global search offers: clients, loans, or both at once (AAP 0.7.1's supporting- services row `SearchService`, AAP 0.8.2's route-and-service table, AAP 0.10.5 item 9). */
export type SearchScope = 'clients' | 'loans' | 'all';

/** The query of one `GET /search` call (AAP 0.7.3 row "Shell: global search"), as one object rather than loose arguments so a parameter cannot be sent by accident: the service serialises these three names and nothing else (AAP 0.7.2). */
export interface GlobalSearchParams {
  /** The text the user searched for, sent verbatim as `query`. */
  readonly query: string;
  /** The selected scope, carried under the member name AAP 0.7.2 fixes for this model: the member is the resource to search. */
  readonly resource: SearchScope;
  /** The optional `exactMatch` flag. Left undefined, nothing is sent; an explicit `false` is still sent, because legacy's parameter distinguishes "false" from "absent" and dropping it would change the request (Rule 1 clause 3). */
  readonly exactMatch?: boolean;
}

/** The Fineract search row — the `SearchData` envelope's element — reduced to the fields an in-scope results list reads (AAP 0.7.2's `SearchResult` row; AAP 0.10.2's displayed-data comparison). **The one loose boundary (Rule 1 clause 4).** The rest of the element is left unmodelled — the `SearchData` members no in-scope results list reads — rather than typed from guesswork. */
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
  /** The entity's status as Fineract sends it — an object, not a bare string: `GET /search` returns `{ id, code, value }` for every row that carries a status (Fineract's `EnumOptionData`, e.g. `{ id: 300, code: 'clientStatusType.active', value: 'Active' }`). */
  readonly entityStatus?: {
    readonly id: number;
    readonly code: string;
    readonly value: string;
  };
}

/** One row of `GET /search`, narrowed to the three entity types the in-scope scopes can return (AAP 0.7.3 row "Shell: global search", AAP 0.10.5 item 9). **The declared boundary (Rule 1 clause 4).** The payload is the `SearchData` envelope element, modelled only as far as the in-scope results list reads it, so its remaining members are left unmodelled rather than guessed. */
export type SearchResult =
  | (SearchData & { readonly entityType: 'CLIENT' })
  | (SearchData & { readonly entityType: 'CLIENTIDENTIFIER' })
  | (SearchData & { readonly entityType: 'LOAN' });

/** The `resource` query parameter a scope sends, and the registered mapping between the three scopes on screen and the values legacy put on the wire (AAP 0.7.3 row "Shell: global search", AAP 0.10.5 item 9). */
export function toResourceParam(scope: SearchScope): string {
  switch (scope) {
    case 'clients':
      return 'clients,clientIdentifiers';
    case 'loans':
      return 'loans';
    case 'all':
      return 'clients,clientIdentifiers,loans';
  }
}

/** One option of the `GET /search/template` answer: a loan product or an office the ad-hoc query template offers for one of its two selects (AAP 0.7.3 row "Shell: global search"). */
export interface SearchTemplateOption {
  /** The option's identifier, as the ad-hoc query form sends it. */
  readonly id: number;
  /** The option's display name, as the server sends it and a select renders it. */
  readonly name: string;
}

/** The `GET /search/template` answer (AAP 0.7.3 row "Shell: global search"): Fineract's **ad-hoc query template**, the payload whose two option lists populate that query screen's loan-product and office selects (AAP 0.10.5, Rule 1 clause 3). */
export interface SearchTemplate {
  /** The loan products the ad-hoc query may be filtered by, when the server offers any. */
  readonly loanProducts?: readonly SearchTemplateOption[];
  /** The offices the ad-hoc query may be filtered by, when the server offers any. */
  readonly offices?: readonly SearchTemplateOption[];
}

/** The application's one caller of the Fineract search endpoints: the navbar's global search and the search results screen (AAP 0.7.1 supporting-services row `SearchService`, AAP 0.8.2) (Rule 2, AAP 0.4.2, Rule 1 clause 5, Rule 1 clause 2). */
@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly http = inject(HttpClient);

  /** The only source of the Fineract host and API root; no URL in this file holds either. */
  private readonly config = inject(AppConfigService);

  /** Runs the global search: `GET /search` with `query` and `resource`, plus `exactMatch` when the caller supplies it (AAP 0.7.3 row "Shell: global search", AAP 0.10.1 W3's search half) (Rule 1 clause 3, AAP 0.4.2). */
  search(params: GlobalSearchParams): Observable<SearchResult[]> {
    return defer(() => {
      let queryParams: HttpParams = new HttpParams()
        .set('query', params.query)
        .set('resource', toResourceParam(params.resource));

      // `!== undefined`, not truthiness: legacy sends `exactMatch=false` when the user turned exact matching off, and omits the parameter when the flag was never set.
      if (params.exactMatch !== undefined) {
        queryParams = queryParams.set('exactMatch', String(params.exactMatch));
      }

      return this.http.get<SearchResult[]>(this.config.apiUrl('search'), { params: queryParams });
    });
  }

  /** Reads the search template: `GET /search/template`, with no parameters (AAP 0.7.3 row "Shell: global search", AAP 0.10.4's template-coverage gate) (Rule 1 clause 3, AAP 0.12). No in-scope screen calls it yet: the endpoint's only consumer in the
   * legacy application is the ad-hoc query search screen (`#/advsearch`), whose controller reads `globalSearchTemplateResource`
   * (`app/scripts/controllers/main/AdHocQuerySearchController.js:16`, defined at `app/scripts/services/ResourceFactoryProvider.js:281`), and AAP 0.9.2 keeps that reporting screen on the legacy app, so the loan-product and office lists this answer
   * carries fill no form here. The method stays, and is not dead code to be deleted: `GET /search/template` is the "Shell: global search" row's second endpoint (AAP 0.7.3), and `tools/parity/check-templates.ts` declares the expected `{ id:
   * 'search-template', canonicalPath: '/search/template' }` row, satisfied only by a non-spec file under `src/app` that holds the `search/template` literal, so deleting this method fails `npm run check:templates` (AAP 0.10.3 criterion 6).
   * `SearchTemplate` types this call's answer and nothing else. */
  template(): Observable<SearchTemplate> {
    return defer(() => this.http.get<SearchTemplate>(this.config.apiUrl('search/template')));
  }
}
