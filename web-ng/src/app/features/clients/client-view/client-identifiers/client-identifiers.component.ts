import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  type Signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, catchError, finalize, map, of, switchMap, type Observable } from 'rxjs';

import { ApiError } from '../../../../core/http/api-error';
import { EmptyStateComponent } from '../../../../shared/empty-state/empty-state.component';
import type { ClientIdentifier, ClientIdentifierTemplate } from '../../client.models';
import { ClientService } from '../../client.service';

/**
 * One rendered row of the `Identities` tab: the display columns of one identity document, projected
 * from a `ClientIdentifier` (AAP 0.7.2 row `ClientIdentifier`; AAP 0.7.3 row "W3 search and view
 * client").
 *
 * Every member is a display string except `id`, which is the row's tracking key and is never shown.
 * A member the payload leaves unset becomes the empty string rather than a dash, a zero or a
 * translated stand-in, so an absent value reads as an empty cell exactly as the record's own
 * label/value rows do (AAP 0.7.4 "States every list and record screen must implement"; Rule 1
 * clause 3).
 *
 * Declared here and not in `client.models.ts`: it describes this tab's own projection, not a
 * Fineract payload, and the models module is owned by the clients family alone.
 */
export interface ClientIdentifierRow {
  /** Identifier id from `ClientIdentifier.id`; the row's tracking key, never rendered. */
  readonly id: number;

  /**
   * Document-type name, e.g. `'Passport'`. The payload's own name when it carries one, otherwise the
   * name resolved from `GET clients/{id}/identifiers/template`, otherwise the empty string — never
   * the numeric document-type id, and never a name this component invented (Rule 1 clauses 2 and 3).
   */
  readonly documentTypeName: string;

  /** The document's key value, e.g. a passport number, rendered verbatim. */
  readonly documentKey: string;

  /** Free-text description, empty when the record carries none. */
  readonly description: string;

  /** Identifier status as the endpoint sent it — plain text, not a status object. */
  readonly status: string;
}

/**
 * The rows of a load that found nothing: an empty payload, or a load whose `identifiers` read
 * rejected. Shared and frozen by type (`readonly`) so neither a template nor a later pass can append
 * to the state a rejected load left behind.
 */
const NO_ROWS: readonly ClientIdentifierRow[] = [];

/**
 * The name map used when no name has to be resolved and when the template read itself rejected: an
 * empty map, so a name that could not be resolved renders as the empty string.
 */
const NO_DOCUMENT_TYPE_NAMES: ReadonlyMap<number, string> = new Map<number, string>();

/**
 * A payload string as display text: the value itself, or the empty string when the member is absent.
 *
 * `client.models.ts` types `documentKey` as required and `description` and `status` as optional, but a
 * wire value the server omits would otherwise print `undefined` in a cell, which no screen in this
 * application may show (Rule 1 clause 3).
 */
function displayText(value: string | undefined): string {
  return value ?? '';
}

/**
 * The document-type name the payload itself carried for one identifier, or the empty string when it
 * carried none.
 *
 * Read defensively rather than trusted: `ClientIdentifier.documentType` is typed as a `ClientOption`
 * carrying a `name`, yet a payload can arrive with the type's id and no name — the very state this
 * tab's conditional template read exists to resolve. Nothing is looked up here; resolution happens
 * through the template map in {@link resolvedDocumentTypeName}.
 */
function receivedDocumentTypeName(identifier: ClientIdentifier): string {
  const name = identifier.documentType?.name;

  return typeof name === 'string' ? name : '';
}

/**
 * Whether one identifier's document type needs its name resolved from the template: true when the
 * payload carried no name, or only whitespace where a name belongs.
 */
function needsDocumentTypeName(identifier: ClientIdentifier): boolean {
  return receivedDocumentTypeName(identifier).trim() === '';
}

/**
 * The document-type id-to-name map of `GET clients/{id}/identifiers/template`
 * (`ClientIdentifierTemplate.allowedDocumentTypes`).
 *
 * The types belong to the tenant, so they are read from the endpoint and never held as constants in
 * the application (AAP 0.7.3 row "W3 search and view client"; Rule 1 clause 2). An option without a
 * usable name is left out of the map, so a lookup for it answers with the empty string instead of a
 * blank label standing in for a type.
 */
function documentTypeNameMap(template: ClientIdentifierTemplate): ReadonlyMap<number, string> {
  const names = new Map<number, string>();

  for (const documentType of template.allowedDocumentTypes) {
    if (typeof documentType.name === 'string' && documentType.name.trim() !== '') {
      names.set(documentType.id, documentType.name);
    }
  }

  return names;
}

/**
 * The name of one identifier's document type: what the payload sent, else the template's name for
 * the type's id, else the empty string.
 *
 * The payload's own name wins because it is what the record holds; the template supplies a name only
 * where the payload carried none. The numeric id is deliberately never a fallback — a raw `1` in
 * place of `Passport` would be a value the server never sent for that column (Rule 1 clause 3).
 */
function resolvedDocumentTypeName(
  identifier: ClientIdentifier,
  documentTypeNames: ReadonlyMap<number, string>,
): string {
  const received = receivedDocumentTypeName(identifier);

  if (received !== '') {
    return received;
  }

  const documentTypeId = identifier.documentType?.id;

  return documentTypeId === undefined ? '' : (documentTypeNames.get(documentTypeId) ?? '');
}

/**
 * Projects one `ClientIdentifier` into the row the template renders.
 *
 * A projection only: nothing is reformatted, sorted, filtered or derived beyond the document-type name
 * resolution and the empty-string coalescing every row member goes through (Rule 1 clause 3).
 */
function toRow(
  identifier: ClientIdentifier,
  documentTypeNames: ReadonlyMap<number, string>,
): ClientIdentifierRow {
  return {
    id: identifier.id,
    documentTypeName: resolvedDocumentTypeName(identifier, documentTypeNames),
    documentKey: displayText(identifier.documentKey),
    description: displayText(identifier.description),
    status: displayText(identifier.status),
  };
}

/**
 * The `Identities` tab of the individual client record (`#/viewclient/:id`): the read-only list of the
 * client's identity documents, loaded by this component from the two reads AAP 0.7.3 row "W3 search
 * and view client" assigns it.
 *
 * **What it loads.** `GET clients/{id}/identifiers` for the documents themselves, through
 * `ClientService.identifiers()` — the family's single typed HTTP service, which owns the URL, and the
 * only data-layer collaborator this file injects. When, and only when, at least one document arrived
 * with a document-type id but no name, it makes exactly one further read,
 * `GET clients/{id}/identifiers/template` through `ClientService.identifiersTemplate()`, and uses the
 * template's option list to fill the missing names. A payload whose names are all present therefore
 * costs one request, and a template read that rejects degrades to empty names rather than to a failed
 * tab. No URL, query string or path is composed here, and no repository interface is called directly
 * (AAP 0.14.1 "Every URL literal lives in a service"; Rule 1 clauses 2 and 5).
 *
 * **What it never does.** It writes nothing: no add, edit or delete of an identity document, no
 * sorting, filtering, search, pagination or column-visibility control, and no client-side validation,
 * because the legacy tab offers none of those and this migration adds no capability legacy lacks
 * (Rule 1 clause 3). It raises no notification of its own: a failure is mapped once, by
 * `core/http/fineract.interceptor.ts`, which also notifies for a 5xx or a network failure. A 4xx is
 * the one failure that interceptor does not notify, so the tab renders Fineract's own text verbatim
 * in an alert region (`errorMessage`); a 5xx or a transport fault renders nothing, because the
 * notification already carries the same message and repeating it would show one problem twice
 * (AAP 0.7.4, AAP 0.14.2). Nothing is logged — not the client identifier, not a document key, not a
 * description (Rule 1 clause 9).
 *
 * **State.** Four signals are the whole public surface, plus the `clientId` input the parent binds:
 * `rows` in the server's order, `loading` while a read is in flight, `failed` when the last load
 * rejected, and `errorMessage` carrying Fineract's own text for a 4xx. A load is keyed to the input so
 * re-opening the tab for another client refreshes, and a `switchMap` cancels the pass it replaces, so a
 * slow response for a previous client can never overwrite a newer one. While a pass is in flight the
 * tab paints nothing at all, so one client's documents are never left on screen under another client's
 * record (AAP 0.7.4).
 *
 * **Presentation.** No stylesheet, no inline style and no colour: the table, the panel and the empty
 * state are styled by the global legacy Bootstrap 3 layer in `web-ng/src/styles.scss`, and the two
 * imports the component carries are the shared `EmptyStateComponent` the template renders when the
 * client has no identity document at all, and `TranslatePipe`, which resolves the four column headers
 * and that empty state from the legacy bundles in `app/global-translations/` so the tab follows the
 * language switcher (AAP 0.1.1, AAP 0.4.4 decision 4, AAP 0.7.4; Rule 1 clause 6).
 *
 * Figma: file `DKm5TBFbXypfqyx4xUdhBw`, frame `2:2` ("Legacy"), flow "Sign in and open a client
 * record" — Login `1:5` → Clients list `1:3` → Individual client view `1:4` (end of flow). This
 * component is the `Identities` tab of that last screen: `node_id` `1:4`,
 * `parent_screen_node_id` `1:4`, `figma_screen_id` `1:4`, `file_key` `DKm5TBFbXypfqyx4xUdhBw`. The tab
 * is drawn there as tab 6 of 9 and is the only other tab in scope besides `General`, but the captured
 * frame has `General` active, so the design shows no identifiers table, no column set, no status
 * treatment, no empty state and no add/edit/delete control. Those are therefore specified by the
 * Agent Action Plan alone, and this class renders none of them itself.
 */
@Component({
  selector: 'app-client-identifiers',
  imports: [TranslatePipe, EmptyStateComponent],
  templateUrl: './client-identifiers.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientIdentifiersComponent {
  /**
   * The client whose identity documents the tab shows — the `:id` of `#/viewclient/:id`, bound by the
   * parent as `<app-client-identifiers [clientId]="…" />`.
   *
   * A `number | string` because it arrives as a route parameter, exactly as the service's own
   * signatures accept it. Every change re-runs the load.
   */
  readonly clientId = input.required<number | string>();

  /** The clients family's typed HTTP service: the only collaborator this component injects. */
  private readonly clients = inject(ClientService);

  /** The rows the last load produced, in the server's order; empty before the first load settles. */
  private readonly rowsState = signal<readonly ClientIdentifierRow[]>(NO_ROWS);

  /** Whether a load is in flight. */
  private readonly loadingState = signal(false);

  /** Whether the last load rejected. */
  private readonly failedState = signal(false);

  /** Fineract's own failure text for the last rejected load, or `null` when none may be rendered. */
  private readonly errorMessageState = signal<string | null>(null);

  /**
   * The input values to load, in order.
   *
   * A `Subject` rather than a direct subscription in the `effect` below, because the pipeline that
   * reads it needs `switchMap`, `catchError` and `takeUntilDestroyed` — operators an `effect` cannot
   * express — while the input remains the single source of the value.
   */
  private readonly requestedClientIds = new Subject<number | string>();

  /**
   * The rows of the client's identity documents from `GET clients/{id}/identifiers` (AAP 0.7.3 row
   * "W3 search and view client"), in the order the endpoint returned them.
   *
   * Read-only and never reordered here: no sorting, filtering or paging is applied, because the legacy
   * tab applies none (Rule 1 clause 3). Empty is a successful answer — a client with no identity
   * document is not an error — and the template renders its explicit empty state for it.
   */
  readonly rows: Signal<readonly ClientIdentifierRow[]> = this.rowsState.asReadonly();

  /**
   * Whether a load is in flight.
   *
   * Set when a pass starts and cleared when it settles, whichever way it settles, so a superseded pass
   * cannot leave the tab spinning.
   */
  readonly loading: Signal<boolean> = this.loadingState.asReadonly();

  /**
   * Whether the last load rejected.
   *
   * The template uses it only to withhold the empty state while a failed load's absence of rows means
   * "could not read", not "has none". With {@link errorMessage} empty the failure was one the
   * interceptor has already notified — a 5xx or a transport fault — and nothing here repeats or
   * replaces that message.
   */
  readonly failed: Signal<boolean> = this.failedState.asReadonly();

  /**
   * Fineract's own failure text, verbatim, or `null` when there is nothing to show.
   *
   * Populated for a 4xx only: `core/http/fineract.interceptor.ts` maps every failure into an
   * {@link ApiError} but raises its single notification for status `0` and `>= 500` alone, so
   * rendering those here as well would report the same problem twice (AAP 0.7.4, AAP 0.14.2). The
   * text is the server's own and is shown unmoved — no prefix, suffix or translation (Rule 1
   * clause 3) — and nothing about the failure is logged (Rule 1 clause 9).
   */
  readonly errorMessage: Signal<string | null> = this.errorMessageState.asReadonly();

  constructor() {
    // The input is a signal, so the load is driven from it: every value it takes is handed to the
    // pipeline below, which cancels the pass it supersedes.
    effect(() => {
      this.requestedClientIds.next(this.clientId());
    });

    this.requestedClientIds
      .pipe(
        switchMap((clientId) => {
          this.loadingState.set(true);
          this.failedState.set(false);
          this.errorMessageState.set(null);

          return this.loadRows(clientId).pipe(
            // The rejection is swallowed here, inside the switchMap's inner observable, rather than in
            // the subscriber's error callback: an error that escaped the inner stream would end the
            // outer subscription, and the tab would then never load again for a later client. Setting
            // the flag and answering with no rows keeps the page usable, which is what a 4xx or a
            // network failure on a read of a record's own sub-resource must do. A 4xx also publishes
            // Fineract's own text, the one failure the interceptor does not notify; a 5xx or a
            // transport fault leaves it `null` because that interceptor has already notified.
            catchError((error: unknown) => {
              this.failedState.set(true);
              this.errorMessageState.set(
                error instanceof ApiError && error.status >= 400 && error.status < 500
                  ? error.message
                  : null,
              );

              return of(NO_ROWS);
            }),
            finalize(() => this.loadingState.set(false)),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((rows) => this.rowsState.set(rows));
  }

  /**
   * One load: the client's identifiers, with document-type names resolved through the template only
   * when the payload left a name out.
   *
   * The rejection of `identifiers()` is deliberately not handled here — it travels to the one
   * `catchError` in the constructor, which owns the failure state.
   */
  private loadRows(clientId: number | string): Observable<readonly ClientIdentifierRow[]> {
    return this.clients
      .identifiers(clientId)
      .pipe(
        switchMap((identifiers) =>
          this.documentTypeNames(clientId, identifiers).pipe(
            map((documentTypeNames) =>
              identifiers.map((identifier) => toRow(identifier, documentTypeNames)),
            ),
          ),
        ),
      );
  }

  /**
   * The document-type names one load needs, read from `GET clients/{id}/identifiers/template` only
   * when at least one identifier arrived without a usable name (AAP 0.7.3 row "W3 search and view
   * client").
   *
   * At most one template read per load: the map is built once and used for every identifier of that
   * payload. A template read that rejects answers with an empty map, so the identifiers' other columns
   * still render and a name that could not be resolved stays an empty cell — the tab is not failed for
   * a name, and nothing is logged (Rule 1 clause 9).
   */
  private documentTypeNames(
    clientId: number | string,
    identifiers: readonly ClientIdentifier[],
  ): Observable<ReadonlyMap<number, string>> {
    if (!identifiers.some(needsDocumentTypeName)) {
      return of(NO_DOCUMENT_TYPE_NAMES);
    }

    return this.clients
      .identifiersTemplate(clientId)
      .pipe(
        map((template) => documentTypeNameMap(template)),
        catchError(() => of(NO_DOCUMENT_TYPE_NAMES)),
      );
  }
}
