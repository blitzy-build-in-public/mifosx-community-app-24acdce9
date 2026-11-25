import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map, of, switchMap, throwError } from 'rxjs';

import { AppConfigService } from '../config/app-config.service';

/**
 * The entity a datatable check must name to apply to a client.
 *
 * Transcribed from the legacy client-actions controller, which passes it as the gate's entity:
 * `scope.RequestEntities('m_client', 'ACTIVATE')` and `scope.RequestEntities('m_client', 'CLOSE')` at
 * `app/scripts/controllers/client/ClientActionsController.js:81,108`, filtered against
 * `datatable.entity == entity` at :28 (AAP 0.3.4 claim 13).
 */
export const CLIENT_ENTITY_NAME = 'm_client';

/**
 * The client lifecycle actions this application gates: the `:action` values of the in-scope route
 * `client/:id/:action` (AAP 0.8.2), which are the legacy controller's own `case` labels for the five
 * in-scope actions — `activate` (:68), `close` (:95), `reject` (:156), `withdraw` (:172) and
 * `reactivate` (:188).
 */
export type ClientActionName = 'activate' | 'close' | 'reject' | 'withdraw' | 'reactivate';

/**
 * A status of Fineract's `StatusEnum` — the status a datatable check applies in — as the check's own
 * `status` field carries it. Only the four the in-scope client actions gate on are named; the enum
 * also holds `CREATE`, `APPROVE`, `WRITE_OFF`, `RESCHEDULE`, `OVERPAY` and `DISBURSE`.
 */
export type ClientCheckStatus = 'ACTIVATE' | 'CLOSE' | 'REJECTED' | 'WITHDRAWN';

/**
 * The datatable-check status each client action gates on.
 *
 * The status is the lifecycle transition the action performs, not the state the client is in, because
 * that is what the check's `status` field holds: Fineract's `StatusEnum` (`ACTIVATE` = 300,
 * `WITHDRAWN` = 400, `REJECTED` = 500, `CLOSE` = 600) and the legacy filter compares the check's
 * `datatable.status.value` with the action's status
 * (`app/scripts/controllers/client/ClientActionsController.js:28`).
 *
 * `activate` and `close` are the two entries legacy itself uses (:81 is `'ACTIVATE'`, :108 is
 * `'CLOSE'`). `reactivate` returns a closed client to the active state, so it gates on the same
 * `ACTIVATE` transition; legacy runs no gate for it. `reject` and `withdraw` gate on the statuses those
 * transitions produce, `REJECTED` and `WITHDRAWN`.
 *
 * The client entity's own check statuses, read from `GET /entityDatatableChecks/template`
 * (`statusClient`), are `CREATE` (100), `ACTIVATE` (300) and `CLOSE` (600): no client check can
 * currently carry `REJECTED` or `WITHDRAWN`, so those two entries make the gate read nothing for reject
 * and withdraw — an empty gate — instead of guessing which of the three statuses a tenant meant. Legacy
 * gates neither action at all, so nothing legacy does is lost. A fork that adds those statuses to the
 * client entity needs no change here.
 *
 * A read-only `Map` rather than an object literal: `Map.get` reports an absent action as `undefined`,
 * so an unmapped `:action` value read off the URL cannot silently match nothing and let the gate pass.
 */
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

/**
 * A Fineract enum value as every Fineract response serialises it: `id` is the enum's number, `code` its
 * message key and `value` the name the comparison uses (AAP 0.7.2, row `Client`: the same
 * `{id, code, value}` triple its `status` field carries).
 */
export interface FineractEnumOption {
  /** Numeric value of the enum member, e.g. `300`. */
  readonly id: number;

  /** Message key of the enum member, e.g. `'statusEnum.activate'`. */
  readonly code: string;

  /** Name of the enum member, e.g. `'ACTIVATE'`; the member this gate compares. */
  readonly value: string;
}

/**
 * One row of `GET /entityDatatableChecks` — a check binding a registered datatable to an entity in a
 * status. Its shape is Fineract's `EntityDataTableChecksData`: `id`, `entity`, `entityData`, `status`,
 * `datatableName`, `systemDefined`, `order`, `productId` and `productName`. Only the three members the
 * gate reads are modelled; the rest are left out rather than typed loosely, so a member no in-scope
 * screen shows cannot be reached by accident (Rule 1 clause 4).
 */
export interface EntityDatatableCheck {
  /** Entity the check applies to, e.g. the client entity; compared with {@link CLIENT_ENTITY_NAME}. */
  readonly entity: string;

  /**
   * Status the check applies in, as a Fineract enum value — not a bare string. The legacy gate reads
   * `datatable.status.value` (`app/scripts/controllers/client/ClientActionsController.js:28`), so a
   * comparison against the object itself could never match.
   */
  readonly status: FineractEnumOption;

  /** Registered table the check reads, e.g. `'client_extra_details'`, sent as a path segment. */
  readonly datatableName: string;

  /** Whether Fineract ships the check itself; read-only here, because legacy does not filter on it. */
  readonly systemDefined?: boolean;
}

/**
 * The answer to `GET /entityDatatableChecks?limit=-1`: Fineract's `Page<EntityDataTableChecksData>`,
 * serialised as `{totalFilteredRecords, pageItems}` — a paged envelope, not a bare row list.
 *
 * The legacy gate reads `response.pageItems` and nothing else
 * (`app/scripts/controllers/client/ClientActionsController.js:27`), which is why the type carries the
 * envelope and not an array: `limit=-1` widens the page to every check in the tenant, it does not drop
 * the envelope.
 */
export interface EntityDatatableCheckPage {
  /** Total rows the query matched, before the page was cut; unread by the gate, present in the answer. */
  readonly totalFilteredRecords: number;

  /** The checks themselves, in the order the server listed them. */
  readonly pageItems: readonly EntityDatatableCheck[];
}

/**
 * One value of a column that is itself an enum (a dropdown column of a datatable): the `{id, value}`
 * pair Fineract sends in `columnValues`.
 */
export interface DataTableColumnValue {
  /** Numeric value of the option. */
  readonly id: number;

  /** Text of the option, as the datatable's form shows it. */
  readonly value: string;
}

/**
 * One column of a generic result set — Fineract's `ResultsetColumnHeaderData`. The column names and
 * types are defined per datatable, by whatever fields a tenant registered on that table, so they are
 * known only at run time.
 */
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

/**
 * One row of a generic result set — Fineract's `ResultsetRowData`, which serialises as `{row: [...]}`.
 *
 * The values are positional: the value at index *n* belongs to the column at index *n* of the response's
 * `columnHeaders`. That is why
 * {@link DataTableRowSet} is described as columnar rather than a list of objects keyed by column name:
 * the names live in the headers, and the row carries values only.
 */
export interface DataTableRow {
  /** The row's values, positionally aligned with the result set's `columnHeaders`. */
  readonly row: readonly unknown[];
}

/**
 * The answer to `GET /datatables/{table}/{clientId}?genericResultSet=true` — Fineract's
 * `GenericResultsetData`, serialised as `{columnHeaders, data}`.
 *
 * `genericResultSet=true` is what selects this envelope: without it Fineract renders the rows as a
 * display-oriented document instead. The envelope is unmodelled by necessity — its column names and
 * types are defined per datatable at run time — so a cell's value is `unknown` and a reader must
 * narrow before use. This is the single boundary in this file that is not typed to the value it holds
 * (Rule 1 clause 4).
 *
 * The legacy gate reads `data.columnHeaders` and `data.data.length` from exactly this answer
 * (`app/scripts/controllers/client/ClientActionsController.js:35-48`).
 */
export interface DataTableRowSet {
  /** The columns of the table, in the order each row's values are aligned to. */
  readonly columnHeaders: readonly DataTableColumnHeader[];

  /** The rows the read returned; empty when the table holds no entry for this client. */
  readonly data: readonly DataTableRow[];
}

/**
 * One checked table's outcome: the table that was read and the generic result set the read returned,
 * in the order the server listed the checks (AAP 0.7.1 supporting-services row
 * `DataTableGateService`).
 */
export interface DataTableGateResult {
  /** Registered table name the result set was read from — the check's own `datatableName`. */
  readonly table: string;

  /** The `genericResultSet=true` answer for that table, exactly as Fineract sent it. */
  readonly resultSet: DataTableRowSet;
}

/**
 * The datatable gate every client lifecycle action passes through before it posts: the two-call
 * sequence legacy runs in `ClientActionsController` (AAP 0.3.4 claim 13; AAP 0.7.3 row "Client
 * actions: datatable gate"; AAP 0.4.4 decision 6 — "the datatable gate runs before each client action
 * in the same order legacy uses").
 *
 * **The sequence, in legacy's order.** `GET /entityDatatableChecks?limit=-1` lists every check in the
 * tenant (`app/scripts/controllers/client/ClientActionsController.js:26`); the answer's `pageItems` are
 * filtered to the checks that apply to the client entity in the status the action represents (:27-28);
 * then each surviving check's table is read with
 * `GET /datatables/{table}/{clientId}?genericResultSet=true` (:35). The second call cannot start before
 * the first has answered, because the list of tables to read comes out of that answer, and the results
 * are emitted in the order the server listed the checks.
 *
 * **A gate, not a validator.** This service reports what the checks and their tables returned; it does
 * not decide whether an action may proceed. `features/clients/client-actions/**` is the caller that
 * blocks a lifecycle action when the gate fails or reports a table it must not pass, exactly as the
 * legacy controller only continues once its checks are in hand.
 *
 * **Nothing is added to the legacy calls.** No pagination, offset, search text, caching, retry,
 * debounce, memoisation or default row set: `limit=-1` and `genericResultSet=true` are the two
 * parameters legacy sends and the only two sent here, so the parity capture sees the same requests
 * (Rule 1 clauses 2 and 3; AAP 0.10.5). The table name and the client id travel as path segments and
 * are interpolated raw, never encoded, because a datatable name is `[a-z0-9_]` and legacy sends it
 * as-is — an encoded segment would show up as a URL difference in the parity comparison.
 *
 * **Headers and errors are the interceptor's.** This service attaches no header: the single
 * `fineractInterceptor` adds `Authorization` and `Fineract-Platform-TenantId` and maps a Fineract
 * failure into an `ApiError` (AAP 0.4.2). A failure on either call propagates untouched — nothing here
 * catches, converts a failure into an empty result or treats a failed gate as a pass, because a gate
 * that passes when it could not read is the one outcome a lifecycle action must never see.
 *
 * **Host.** Every URL is composed by `AppConfigService.apiUrl()` from the configured base, so this
 * file holds no host and no demo-server fallback (Rule 2; AAP 0.4.4 decision 5).
 *
 * **No dates.** Neither call carries a date, so neither sends `dateFormat` or `locale`; both become
 * mandatory on any date-bearing body added here (Rule 1 clause 2; AAP 0.1.1 date discipline).
 *
 * **Nothing is logged.** A datatable row can hold client data, so no request, response, table name or
 * client id is written to the console or a log (Rule 1 clause 9; AAP 0.10.4 credential gate).
 */
@Injectable({ providedIn: 'root' })
export class DataTableGateService {
  private readonly http = inject(HttpClient);

  private readonly appConfig = inject(AppConfigService);

  /**
   * Runs the gate for one client action: lists the tenant's datatable checks, keeps those that apply
   * to the client entity in the status the action represents, then reads each surviving check's table
   * for this client.
   *
   * @param clientId the client the action is about, sent as the last path segment of every datatable
   * read — the `entityId` legacy forwards as
   * `DataTablesResource.getTableDetails({datatablename, entityId, genericResultSet: 'true'})`
   * (`app/scripts/controllers/client/ClientActionsController.js:35`). A number stays a number in the
   * path and a string is used as given, so a route parameter reaches Fineract spelled as the route
   * held it.
   * @param action the lifecycle action being run, as the route's `:action` segment states it. It
   * selects the check status through {@link CLIENT_ACTION_CHECK_STATUS}.
   * @returns one {@link DataTableGateResult} per checked table, in the order the server listed the
   * checks; an empty array when no check applies, and then no datatable request is issued at all.
   * @throws through the returned observable — never synchronously — when the action has no mapped check
   * status, with no request issued. An unmapped action must fail rather than read nothing and report a
   * gate that passed.
   */
  checkClientActionGate(
    clientId: number | string,
    action: ClientActionName,
  ): Observable<DataTableGateResult[]> {
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
          const applicable = response.pageItems.filter(
            (check: EntityDatatableCheck) =>
              check.entity === CLIENT_ENTITY_NAME && check.status.value === status,
          );

          // No applicable check means nothing to read. Emitting the empty array explicitly, rather
          // than leaving forkJoin over an empty array to complete without a value, keeps the output
          // deterministic and issues no datatable request.
          if (applicable.length === 0) {
            return of<DataTableGateResult[]>([]);
          }

          // `genericResultSet=true` is what makes Fineract answer with the columnar envelope typed
          // above; HttpParams serialises the boolean as `genericResultSet=true`.
          const genericResultSet = new HttpParams().set('genericResultSet', true);

          return forkJoin(
            applicable.map((check: EntityDatatableCheck) =>
              this.http
                .get<DataTableRowSet>(
                  this.appConfig.apiUrl('datatables/' + check.datatableName + '/' + clientId),
                  { params: genericResultSet },
                )
                .pipe(
                  map(
                    (resultSet: DataTableRowSet): DataTableGateResult => ({
                      table: check.datatableName,
                      resultSet,
                    }),
                  ),
                ),
            ),
          );
        }),
      );
  }
}

