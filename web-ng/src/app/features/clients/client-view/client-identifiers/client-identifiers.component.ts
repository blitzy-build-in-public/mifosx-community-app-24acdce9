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

/** One rendered row of the `Identities` tab (AAP 0.7.2 row `ClientIdentifier`; AAP 0.7.3 "W3"): display strings only, an unset member becoming an empty cell rather than a dash (Rule 1 clause 3). */
export interface ClientIdentifierRow {
  /** Identifier id from `ClientIdentifier.id`; the row's tracking key, never rendered. */
  readonly id: number;
  /** Document-type name — the payload's own, else the template's for the type's id, else the empty string; never the numeric id and never an invented name (Rule 1 clauses 2 and 3). */
  readonly documentTypeName: string;
  /** The document's key value, e.g. a passport number, rendered verbatim. */
  readonly documentKey: string;
  /** Free-text description, empty when the record carries none. */
  readonly description: string;
  /** Identifier status as the endpoint sent it — plain text, not a status object. */
  readonly status: string;
}

/** The rows of a load that found nothing, frozen by type so neither a template nor a later pass can append to a rejected load's state. */
const NO_ROWS: readonly ClientIdentifierRow[] = [];

/** The name map used when nothing has to be resolved and when the template read itself rejected: a name that could not be resolved renders as the empty string. */
const NO_DOCUMENT_TYPE_NAMES: ReadonlyMap<number, string> = new Map<number, string>();

/** A payload string as display text: the value itself, or the empty string when absent, since a wire value the server omits would otherwise print `undefined` (Rule 1 clause 3). */
function displayText(value: string | undefined): string {
  return value ?? '';
}

/** The document-type name the payload carried for one identifier, or the empty string: read defensively because a payload can arrive with the type's id and no name. */
function receivedDocumentTypeName(identifier: ClientIdentifier): string {
  const name = identifier.documentType?.name;

  return typeof name === 'string' ? name : '';
}

/** Whether one identifier's document type needs its name resolved from the template: true when the payload carried no name, or only whitespace. */
function needsDocumentTypeName(identifier: ClientIdentifier): boolean {
  return receivedDocumentTypeName(identifier).trim() === '';
}

/** The document-type id-to-name map of `GET clients/{id}/identifiers/template`; the types are the tenant's so they are read, never constants, and an option without a usable name stays out (Rule 1 clause 2). */
function documentTypeNameMap(template: ClientIdentifierTemplate): ReadonlyMap<number, string> {
  const names = new Map<number, string>();

  for (const documentType of template.allowedDocumentTypes) {
    if (typeof documentType.name === 'string' && documentType.name.trim() !== '') {
      names.set(documentType.id, documentType.name);
    }
  }

  return names;
}

/** The name of one identifier's document type: what the payload sent, else the template's name for the type's id, else the empty string — the numeric id is deliberately never a fallback (Rule 1 clause 3). */
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

/** Projects one `ClientIdentifier` into the row the template renders: a projection only, with no reformatting, sort, filter or derived column (Rule 1 clause 3). */
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

/** The `Identities` tab of the record: the read-only list of the client's identity documents from `GET clients/{id}/identifiers`, plus one template read only when a name must be resolved (AAP 0.7.3 "W3"; Figma screen `1:4`). */
@Component({
  selector: 'app-client-identifiers',
  imports: [TranslatePipe, EmptyStateComponent],
  templateUrl: './client-identifiers.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientIdentifiersComponent {
  /** The client whose identity documents the tab shows — the `:id` of `#/viewclient/:id`, a `number | string` because it arrives as a route parameter; every change re-runs the load. */
  readonly clientId = input.required<number | string>();
  /** The clients family's typed HTTP service: the only collaborator this component injects (AAP 0.14.1). */
  private readonly clients = inject(ClientService);
  /** The rows the last load produced, in the server's order; empty before the first load settles. */
  private readonly rowsState = signal<readonly ClientIdentifierRow[]>(NO_ROWS);

  /** Whether a load is in flight. */
  private readonly loadingState = signal(false);

  /** Whether the last load rejected. */
  private readonly failedState = signal(false);

  /** Fineract's own failure text for the last rejected load, or `null` when none may be rendered. */
  private readonly errorMessageState = signal<string | null>(null);

  /** The input values to load, in order: a `Subject` because the pipeline needs `switchMap`, `catchError` and `takeUntilDestroyed`, which an `effect` cannot express. */
  private readonly requestedClientIds = new Subject<number | string>();

  /** The rows of the client's identity documents from `GET clients/{id}/identifiers`, in the endpoint's order, never reordered here because the legacy tab sorts none (Rule 1 clause 3). */
  readonly rows: Signal<readonly ClientIdentifierRow[]> = this.rowsState.asReadonly();

  /** Whether a load is in flight, set when a pass starts and cleared however it settles, so a superseded pass cannot leave the tab spinning. */
  readonly loading: Signal<boolean> = this.loadingState.asReadonly();

  /** Whether the last load rejected, which withholds the empty state while the absence of rows means "could not read" rather than "has none". */
  readonly failed: Signal<boolean> = this.failedState.asReadonly();

  /** Fineract's own failure text for a 4xx only — the interceptor notifies for status `0` and `>= 500` alone — shown unmoved and never logged (AAP 0.7.4; Rule 1 clauses 3 and 9). */
  readonly errorMessage: Signal<string | null> = this.errorMessageState.asReadonly();

  constructor() {
    // The input is a signal, so every value it takes is handed to the pipeline below, which cancels the pass it supersedes.
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
            // Swallowed inside the inner observable rather than in the subscriber: an error escaping it would end the outer subscription and the tab would never load again for a later client.
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

  /** One load: the client's identifiers, with document-type names resolved through the template only when the payload left a name out; a rejection travels to the constructor's one `catchError`. */
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

  /** The document-type names one load needs, read from `GET clients/{id}/identifiers/template` only when an identifier arrived without a usable name: one read per load, and a rejected read answers an empty map (AAP 0.7.3 "W3"). */
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
