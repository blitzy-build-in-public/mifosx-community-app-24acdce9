import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, defer, forkJoin, map, of, switchMap, throwError } from 'rxjs';

import { AppConfigService } from '../config/app-config.service';
import { datatableName, resourceId } from '../http/path-segment.util';

/** The `entity` a datatable check must name to apply to a client: legacy's `RequestEntities('m_client', …)` test (`app/scripts/controllers/client/ClientActionsController.js:81,108`, AAP 0.3.4 claim 13). */
export const CLIENT_ENTITY_NAME = 'm_client';

/** The five in-scope `client/:id/:action` lifecycle actions (AAP 0.8.2), legacy's own `case` labels (`ClientActionsController.js:68,95,156,172,188`). */
export type ClientActionName = 'activate' | 'close' | 'reject' | 'withdraw' | 'reactivate';

/** A Fineract `StatusEnum` status as the check's own `status` field carries it; only the four the client actions gate on are named. */
export type ClientCheckStatus = 'ACTIVATE' | 'CLOSE' | 'REJECTED' | 'WITHDRAWN';

/** The check status each client action gates on — the transition it performs, which is what legacy's filter compares (`ClientActionsController.js:28`) — as a `Map`, so an unmapped action is `undefined` and cannot silently pass the gate. */
export const CLIENT_ACTION_CHECK_STATUS: ReadonlyMap<ClientActionName, ClientCheckStatus> = new Map<
  ClientActionName,
  ClientCheckStatus
>([
  ['activate', 'ACTIVATE'],
  ['close', 'CLOSE'],
  ['reject', 'REJECTED'],
  ['withdraw', 'WITHDRAWN'],
  ['reactivate', 'ACTIVATE'],
]);

/** A Fineract enum value as every response serialises it: `{id, code, value}` (AAP 0.7.2, row `Client`). */
export interface FineractEnumOption {
  /** Numeric value of the enum member, e.g. `300`. */
  readonly id: number;
  /** Message key of the enum member, e.g. `'statusEnum.activate'`. */
  readonly code: string;
  /** Name of the enum member, e.g. `'ACTIVATE'`; the member this gate compares. */
  readonly value: string;
}

/** One row of `GET /entityDatatableChecks` — Fineract's `EntityDataTableChecksData` — of which only the three members the gate reads are modelled (Rule 1 clause 4). */
export interface EntityDatatableCheck {
  /** Entity the check applies to, e.g. the client entity; compared with {@link CLIENT_ENTITY_NAME}. */
  readonly entity: string;
  /** Status the check applies in, as a Fineract enum value: the legacy gate reads `datatable.status.value` (`ClientActionsController.js:28`). */
  readonly status: FineractEnumOption;
  /** Registered table the check reads, e.g. `'client_extra_details'`, sent as a path segment. */
  readonly datatableName: string;
  /** Whether Fineract ships the check itself; read-only here, because legacy does not filter on it. */
  readonly systemDefined?: boolean;
}

/** The answer to `GET /entityDatatableChecks?limit=-1`: Fineract's paged `Page<EntityDataTableChecksData>` envelope, whose `pageItems` legacy reads and nothing else (`ClientActionsController.js:27`). */
export interface EntityDatatableCheckPage {
  /** Total rows the query matched, before the page was cut; unread by the gate, present in the answer. */
  readonly totalFilteredRecords: number;
  /** The checks themselves, in the order the server listed them. */
  readonly pageItems: readonly EntityDatatableCheck[];
}

/** One enum-valued column of a datatable: the `{id, value}` pair Fineract sends in `columnValues`. */
export interface DataTableColumnValue {
  /** Numeric value of the option. */
  readonly id: number;
  /** Text of the option, as the datatable's form shows it. */
  readonly value: string;
}

/** One column of a generic result set — Fineract's `ResultsetColumnHeaderData` — whose name and type are defined per datatable at run time. */
export interface DataTableColumnHeader {
  /** Column name, e.g. `'id'`, `'client_id'` or a tenant's own field. */
  readonly columnName: string;
  /** SQL type of the column, e.g. `'BIGINT'`. */
  readonly columnType?: string;
  /** Display type Fineract derives from the SQL type, e.g. `'STRING'` or `'DATE'`. */
  readonly columnDisplayType?: string;
  /** Declared length of the column where the type has one. */
  readonly columnLength?: number;
  /** Whether the column accepts a null value. */
  readonly isColumnNullable?: boolean;
  /** Whether the column is the table's primary key. */
  readonly isColumnPrimaryKey?: boolean;
  /** Whether the column carries a unique constraint. */
  readonly isColumnUnique?: boolean;
  /** Whether the column is indexed. */
  readonly isColumnIndexed?: boolean;
  /** Display code of a column that is itself an enum, where Fineract sets one. */
  readonly columnCode?: string;
  /** The options of a column that is itself an enum, where the datatable defines them. */
  readonly columnValues?: readonly DataTableColumnValue[];
}

/** One row of a generic result set — Fineract's `ResultsetRowData`, `{row: [...]}` — positional against the response's `columnHeaders`. */
export interface DataTableRow {
  /** The row's values, positionally aligned with the result set's `columnHeaders`. */
  readonly row: readonly unknown[];
}

/** The answer to `GET /datatables/{table}/{clientId}?genericResultSet=true` — Fineract's `GenericResultsetData`, `{columnHeaders, data}` — whose columns are known only at run time, so a cell is `unknown` (Rule 1 clause 4). */
export interface DataTableRowSet {
  /** The columns of the table, in the order each row's values are aligned to. */
  readonly columnHeaders: readonly DataTableColumnHeader[];
  /** The rows the read returned; empty when the table holds no entry for this client. */
  readonly data: readonly DataTableRow[];
}

/** One checked table's outcome: the table that was read and the generic result set it returned (AAP 0.7.1 row `DataTableGateService`). */
export interface DataTableGateResult {
  /** Registered table name the result set was read from — the check's own `datatableName`. */
  readonly table: string;
  /** The `genericResultSet=true` answer for that table, exactly as Fineract sent it. */
  readonly resultSet: DataTableRowSet;
}

/** Whether a value is a non-null object whose members can be read by key: every `unknown` the checks answer with is guarded by this rather than cast (Rule 1 clause 4). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The datatable names an answer names for one client action — legacy's `entity`/`status.value` filter over `pageItems` (`ClientActionsController.js:27-30`) — or `null` when any part of the answer cannot be read, so an unreadable check is never mistaken for one that passed (Rule 1 clause 4). */
function applicableTableNames(
  answer: unknown,
  status: ClientCheckStatus,
): readonly string[] | null {
  if (!isRecord(answer)) {
    return null;
  }

  const pageItems: unknown = answer['pageItems'];

  if (!Array.isArray(pageItems)) {
    return null;
  }

  const rows: readonly unknown[] = pageItems;
  const tables: string[] = [];

  for (const row of rows) {
    if (!isRecord(row)) {
      return null;
    }

    const entity: unknown = row['entity'];

    if (typeof entity !== 'string') {
      return null;
    }

    if (entity !== CLIENT_ENTITY_NAME) {
      continue;
    }

    const checkStatus: unknown = row['status'];

    if (!isRecord(checkStatus) || typeof checkStatus['value'] !== 'string') {
      return null;
    }

    if (checkStatus['value'] !== status) {
      continue;
    }

    const datatableName: unknown = row['datatableName'];

    if (typeof datatableName !== 'string' || datatableName.length === 0) {
      return null;
    }

    tables.push(datatableName);
  }

  return tables;
}

/** The datatable gate every client lifecycle action passes through before it posts — `GET /entityDatatableChecks?limit=-1` filtered to the client entity and the action's status, then `GET (AAP 0.3.4, AAP 0.7.3, AAP 0.4.4). */
@Injectable({ providedIn: 'root' })
export class DataTableGateService {
  private readonly http = inject(HttpClient);

  private readonly appConfig = inject(AppConfigService);

  /** Runs the gate for one client action: the checks filtered to the action's status, then each surviving table read for this client, emitting one {@link DataTableGateResult} per table, `[]` when none applies, and an observable error — never a synchronous throw and never an empty gate — when an input or the answer cannot be used. */
  checkClientActionGate(
    clientId: number | string,
    action: ClientActionName,
  ): Observable<DataTableGateResult[]> {
    return defer(() => this.runGate(clientId, action));
  }

  /** The gate's own composition, run on subscribe by {@link checkClientActionGate}; the client id and each table name are checked before any request is composed. */
  private runGate(clientId: number | string, action: ClientActionName): Observable<DataTableGateResult[]> {
    const segment = resourceId(clientId, 'DataTableGateService.checkClientActionGate');
    const status = CLIENT_ACTION_CHECK_STATUS.get(action);

    if (status === undefined) {
      return throwError(
        () =>
          new Error(
            `No datatable-check status is mapped to the client action '${action}', so the gate cannot run. ` +
              'Add the action to CLIENT_ACTION_CHECK_STATUS rather than letting the gate report a pass it never checked.',
          ),
      );
    }

    // `limit=-1` is legacy's "every check in the tenant", serialised by HttpParams as `limit=-1`.
    const allChecks = new HttpParams().set('limit', -1);

    return this.http
      .get<EntityDatatableCheckPage>(this.appConfig.apiUrl('entityDatatableChecks'), {
        params: allChecks,
      })
      .pipe(
        switchMap((response: EntityDatatableCheckPage) => {
          const tables = applicableTableNames(response, status);

          if (tables === null) {
            return throwError(
              () =>
                new Error(
                  'This action cannot be prepared because its data checks could not be read; reload the page and try again.',
                ),
            );
          }

          // No applicable check emits `[]` explicitly, so the output is deterministic and no datatable request is issued.
          if (tables.length === 0) {
            return of<DataTableGateResult[]>([]);
          }

          // `genericResultSet=true` is what makes Fineract answer with the columnar envelope typed above.
          const genericResultSet = new HttpParams().set('genericResultSet', true);

          return forkJoin(
            tables.map((name: string) => {
              const table = datatableName(name, 'DataTableGateService.checkClientActionGate');

              return this.http
                .get<DataTableRowSet>(this.appConfig.apiUrl(`datatables/${table}/${segment}`), {
                  params: genericResultSet,
                })
                .pipe(
                  map(
                    (resultSet: DataTableRowSet): DataTableGateResult => ({
                      table,
                      resultSet,
                    }),
                  ),
                );
            }),
          );
        }),
      );
  }
}

