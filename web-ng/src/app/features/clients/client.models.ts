import type { AppDateFormat } from '../../core/config/app-config.model';
import type { FineractDate } from '../../shared/date-format.util';
import { normaliseStatusCode, toStatusKey, type StatusKey } from '../../shared/status-key.util';

/** Every request body and response projection the clients family exchanges with Fineract (AAP 0.7.1 row `clients`; AAP 0.7.2 model rows), declaring the member names the endpoints actually send (Rule 1 clause 2). */

/** The five lifecycle commands in scope (AAP 0.7.3): the `command` of `POST /clients/{id}` and `ClientActionRequest`'s discriminant. */
export type ClientActionCommand = 'activate' | 'close' | 'reject' | 'withdraw' | 'reactivate';

/**
 * The legacy permission each lifecycle command requires, keyed by the command it gates. `satisfies Record<ClientActionCommand, string>` makes a command added to the
 * union without a permission a compile error, and this record is the one statement of the codes both the client record's action links
 * (`client-view/client-view.component.ts`) and the action screen's submit control (`client-actions/client-actions.component.ts`) carry, so the link that opens a
 * command and the button that submits it cannot disagree (AAP 0.9.1 item 1). It sits beside the command union it is keyed on rather than in either screen, so the
 * record screen and `clients.routes.ts` read the family's models and never another screen's component file (AAP 0.14.1 "One direction of dependency").
 */
export const CLIENT_ACTION_PERMISSIONS = {
  activate: 'ACTIVATE_CLIENT',
  close: 'CLOSE_CLIENT',
  reject: 'REJECT_CLIENT',
  withdraw: 'WITHDRAW_CLIENT',
  reactivate: 'REACTIVATE_CLIENT',
} satisfies Record<ClientActionCommand, string>;

/** A client's status object as the client endpoints return it (observed: `{ id: 300, code: 'clientStatusType.active', value: 'Active' }`). */
export interface ClientStatus {
  /** Fineract status id, e.g. `300` for active. Carried through, never compared. */
  id: number;
  /** Machine code the application maps with `toClientStatusKey`, e.g. `'clientStatusType.active'`. */
  code: string;
  /** Server-provided English label. Present on the wire, deliberately never displayed: the design paints a swatch with no word (AAP 0.10.5 item 11; Rule 1 clause 3). */
  value: string;
}

/** One entry of a template option list (`officeOptions`, `allowedDocumentTypes`, `narrations`), structurally assignable to `SelectOption`. */
export interface ClientOption {
  /** Option identifier, sent back unchanged as the chosen value. */
  id: number;
  /** Option label as the template returned it, rendered in the received order. */
  name: string;
}

/** One entry of `GET /clients/template`'s `staffOptions`, a `StaffData` that labels staff by `displayName` and carries no `name`. */
export interface ClientStaffOption {
  /** Staff identifier, sent back unchanged as the chosen `staffId`. */
  id: number;
  /** Label the template returned, in the form `'Officer, Parity'`; rendered unchanged. */
  displayName: string;
}

/** A partial projection of the `timeline` object a client response carries — the two dates the record screen reads. */
export interface ClientTimestamps {
  /** Date the application was submitted, as the endpoint sent it. */
  submittedOnDate?: FineractDate;
  /** Date the client was activated; absent while a client is still pending. */
  activatedOnDate?: FineractDate;
}

/** One `datatables` entry of a client template response: the registered table's name, which the datatable gate reads. */
export interface ClientDatatable {
  /** Registered table name, e.g. `'client_extra_details'`, as the template sent it. */
  registeredTableName: string;
}

/** A client as `GET /clients` rows and `GET /clients/{id}` return it (AAP 0.7.3), the shape the list table and the record header render. */
export interface Client {
  /** Fineract client id: the `:id` of `#/viewclient/:id` and of every client request. */
  id: number;
  /** Zero-padded client number, e.g. `'000000002'`; display text, never parsed as a number. */
  accountNo: string;
  /** Bank-assigned external id; absent when the client has none. */
  externalId?: string;
  /** Name the list and the record header print, e.g. `'Ada Okafor'` or a business name. */
  displayName: string;
  /** First name as entered; absent for an entity client, which the endpoint names through `fullname` alone. */
  firstname?: string;
  /** Last name as entered; absent for an entity client, as `firstname` is. */
  lastname?: string;
  /** Entity name, e.g. `'Blitzy Bakery LLC'`; absent for a person, and the value an entity rename posts back. */
  fullname?: string;
  /** Office id; an update does not accept it (`ClientEditRequest` carries none), so an edit form shows it display-only. */
  officeId: number;
  /** Office name, rendered in the list's Office column and the record's breadcrumb. */
  officeName: string;
  /** Loan officer id; absent when the client has no staff assignment. */
  staffId?: number;
  /** Loan officer name, rendered in the list's Staff column and the record's metadata. */
  staffName?: string;
  /** Status object; only its `code` is read, and only to pick the swatch colour. */
  status: ClientStatus;
  /** Activation date; absent while the client is pending, so the record shows no date. */
  activationDate?: FineractDate;
  /** The endpoint's `timeline` object, projected to the two dates the record reads. */
  timeline: ClientTimestamps;
}

/** The `GET /clients/template` response: the create form's dropdown sources and defaults (AAP 0.7.3 "W2"; AAP 0.4.4 decision 6). */
export interface ClientTemplate {
  /** Office the form starts on, from the template's own default. */
  officeId: number;
  /** Offices the client may be filed under, rendered in the received order. */
  officeOptions: readonly ClientOption[];
  /** Loan officers selectable for the client, labelled by `displayName`; the key is absent when the tenant has no staff. */
  staffOptions?: readonly ClientStaffOption[];
  /** Loan officer the record the template was read for already carries, folded into the same response; absent for a client no officer is assigned to, which is the state legacy's picker shows its prompt for (Rule 1 clause 3). */
  staffId?: number;
  /** Date the template offers as the activation default, observed as a `FineractDate` triple. */
  activationDate: FineractDate;
  /** Whether the record the template was read for is active; absent on the create template. */
  active?: boolean;
  /** Datatables registered for the client entity; absent when none is registered. */
  datatables?: readonly ClientDatatable[];
}

/** The `GET /clients/template?commandParam=close|reject|withdraw` response: the reason list those forms offer (AAP 0.7.3 "Client actions"). */
export interface ClientNarrationTemplate {
  /** Reasons configured for the requested command, in the server's order — the ids the matching `closureReasonId`/`rejectionReasonId`/`withdrawalReasonId` sends; empty when none is configured. */
  narrations: readonly ClientOption[];
}

/** One loan account row of the client record's accounts table, projecting `GET /clients/{id}/accounts` (AAP 0.7.3). */
export interface ClientLoanAccountSummary {
  /** Loan id: the `:id` of `#/viewloanaccount/:id`. */
  id: number;
  /** Loan account number, printed in the row and used as the row's key. */
  accountNo: string;
  /** Loan product name, printed in the Product column. */
  productName: string;
  /** Loan status object; only its `code` is read, and only to pick the swatch colour. */
  status: ClientStatus;
  /** Outstanding principal and interest the row shows as its balance figure. */
  loanBalance?: number;
}

/** One savings account row of the client record's accounts table, projecting `GET /clients/{id}/accounts` (AAP 0.7.3). */
export interface ClientSavingsAccountSummary {
  /** Savings account id, carried through from the payload: the row prints the account number, never the id. */
  id: number;
  /** Savings account number, printed in the row. */
  accountNo: string;
  /** Savings product name, printed in the Product column. */
  productName: string;
  /** Account status object; only its `code` is read, and only to pick the swatch colour. */
  status: ClientStatus;
  /** Account balance the row shows as its balance figure. */
  accountBalance?: number;
}

/** The `GET /clients/{id}/accounts` response the record's accounts table uses (AAP 0.7.3; AAP 0.7.4 General tab). */
export interface ClientAccountSummary {
  /** Loan accounts held by the client; the endpoint omits the key when the client holds none. */
  loanAccounts?: readonly ClientLoanAccountSummary[];
  /** Savings accounts held by the client; the endpoint omits the key when the client holds none. */
  savingsAccounts?: readonly ClientSavingsAccountSummary[];
}

/** One identifier of the record's Identities tab, projecting `GET /clients/{id}/identifiers` (read-only in scope). */
export interface ClientIdentifier {
  /** Identifier id, used as the row key. */
  id: number;
  /** Document type, resolved from `ClientIdentifierTemplate.allowedDocumentTypes` when needed. */
  documentType: ClientOption;
  /** The document's key value, e.g. a passport number. */
  documentKey: string;
  /** Free-text description; absent when the record has none. */
  description?: string;
  /** Identifier status as the endpoint sends it — plain text, not a status object, because `ClientIdentifierData` declares a `String`. */
  status?: string;
}

/** The `GET /clients/{id}/identifiers/template` response, used to resolve a document-type name from its id (observed: `{ allowedDocumentTypes: [{ id: 1, name: 'Passport', … }] }`). */
export interface ClientIdentifierTemplate {
  /** Document types an identifier may use, in the server's order. */
  allowedDocumentTypes: readonly ClientOption[];
}

/** The `POST /clients` body the create screen posts (AAP 0.7.2 `ClientCreateRequest`; AAP 0.7.3 "W2"). */
export interface ClientCreateRequest {
  /** Office the client is filed under, from the template's office list. */
  officeId: number;
  /** Legal form: 1 for a person, 2 for an entity. Required — `validateForCreate` reads it with `notNull().inMinMaxRange(1, 2)`. */
  legalFormId: number;
  /** Loan officer the client is assigned to, from the template's staff list; sent only when the form selected one. */
  staffId?: number;
  /** First name; required by the server for a person (`legalFormId` 1) and left out for an entity, which the server names by `fullname` alone. */
  firstname?: string;
  /** Last name; required by the server for a person (`legalFormId` 1) and left out for an entity. */
  lastname?: string;
  /** Entity name, e.g. `'Blitzy Bakery LLC'`; required for an entity (`legalFormId` 2) and never sent alongside the individual name parts. */
  fullname?: string;
  /** Bank-assigned external id; sent only when the form has one. */
  externalId?: string;
  /** Mobile number; sent only when the form has one. */
  mobileNo?: string;
  /** Submission date the form holds, serialised at the API boundary. */
  submittedOnDate: Date | null;
  /** Whether the client is created already active, which decides whether a date is sent. */
  active: boolean;
  /** Activation date, sent when the client is created active. */
  activationDate?: Date | null;
  /** Payload date format. Optional because `client.service.ts` overwrites it from `AppConfig.dateFormat` at the boundary (Rule 1 clause 2). */
  dateFormat?: AppDateFormat;
  /** Payload locale. Optional for the same reason as `dateFormat`: the service sets it from `AppConfigService.activeLocale`. */
  locale?: string;
}

/** The `PUT /clients/{id}` body: the create set minus the submission date the server keeps, and minus `officeId` — absent because it is not in `CLIENT_UPDATE_REQUEST_DATA_PARAMETERS` and a body carrying it is refused with `error.msg.parameter.unsupported`, which is also why legacy's edit form shows its office as a disabled select and posts no office at all (AAP 0.7.2 `ClientEditRequest`, AAP 0.7.3; Rule 1 clauses 2 and 3). */
export interface ClientEditRequest {
  /** First name as edited; required by the server for a person (`legalFormId` 1) and left out for an entity. */
  firstname?: string;
  /** Last name as edited; required by the server for a person (`legalFormId` 1) and left out for an entity. */
  lastname?: string;
  /** Entity name as edited, e.g. `'Blitzy Bakery LLC'`; required for an entity and never sent alongside the individual name parts. */
  fullname?: string;
  /** Bank-assigned external id, when the form holds one. */
  externalId?: string;
  /** Mobile number, when the form holds one. */
  mobileNo?: string;
  /** Loan officer the edit assigns the client to, from the template's own `staffOptions`: the fork declares `staffIdParamName` in `CLIENT_UPDATE_REQUEST_DATA_PARAMETERS` and validates it with `ignoreIfNull().longGreaterThanZero()`, so an id assigns an officer and an explicit `null` unassigns one, exactly as legacy's edit form posts its picker (AAP 0.7.3; Rule 1 clause 3). */
  staffId?: number | null;
  /** Activation date the record carries, when the edit is meant to set it; the fork accepts it, but most edits touch names only. */
  activationDate?: Date | null;
  /** Payload date format, filled by `client.service.ts` from `AppConfig.dateFormat`. */
  dateFormat: AppDateFormat;
  /** Payload locale, filled by `client.service.ts` from `AppConfigService.activeLocale`. */
  locale: string;
}

/** The body of one client lifecycle action, discriminated on `command` so a screen cannot post one action's body to another's endpoint and a missing field is a compile error (AAP 0.7.2 `ClientActionRequest`). */
export type ClientActionRequest =
  | {
      /** Activates a pending client. */
      command: 'activate';
      /** Activation date the action posts; required by the server. */
      activationDate: Date | null;
      /** Payload date format, filled by `client.service.ts` from `AppConfig.dateFormat`. */
      dateFormat: AppDateFormat;
      /** Payload locale, filled by `client.service.ts` from `AppConfigService.activeLocale`. */
      locale: string;
    }
  | {
      /** Closes an active client. */
      command: 'close';

      /** Closure date the action posts; required by the server. */
      closureDate: Date | null;

      /** Chosen closure reason, read from the `commandParam=close` narrations. Optional because legacy's select carries no validator and posts whatever is chosen; the fork's `notNull` is what refuses a missing one (Rule 1 clause 3). */
      closureReasonId?: number;

      /** Payload date format, filled by `client.service.ts` from `AppConfig.dateFormat`. */
      dateFormat: AppDateFormat;

      /** Payload locale, filled by `client.service.ts` from `AppConfigService.activeLocale`. */
      locale: string;
    }
  | {
      /** Rejects a client that was never activated. */
      command: 'reject';

      /** Rejection date the action posts; required by the server. */
      rejectionDate: Date | null;

      /** Chosen rejection reason, read from the `commandParam=reject` narrations. Optional because legacy's select carries no validator; the fork's `notNull` refuses a missing one (Rule 1 clause 3). */
      rejectionReasonId?: number;

      /** Payload date format, filled by `client.service.ts` from `AppConfig.dateFormat`. */
      dateFormat: AppDateFormat;

      /** Payload locale, filled by `client.service.ts` from `AppConfigService.activeLocale`. */
      locale: string;
    }
  | {
      /** Withdraws a client application that was never activated. */
      command: 'withdraw';

      /** Withdrawal date the action posts; required by the server. */
      withdrawalDate: Date | null;

      /** Chosen withdrawal reason, read from the `commandParam=withdraw` narrations. Optional because legacy's select carries no validator; the fork's `notNull` refuses a missing one (Rule 1 clause 3). */
      withdrawalReasonId?: number;

      /** Payload date format, filled by `client.service.ts` from `AppConfig.dateFormat`. */
      dateFormat: AppDateFormat;

      /** Payload locale, filled by `client.service.ts` from `AppConfigService.activeLocale`. */
      locale: string;
    }
  | {
      /** Reactivates a closed client. It does not restore Active: `Client.reActivate` clears the closure and sets `ClientStatus.PENDING`, so the record reads back Pending. */
      command: 'reactivate';

      /** Reactivation date the action posts; `validateReactivate` applies `notNull` to it, so a reactivate without it is refused. */
      reactivationDate: Date | null;

      /** Payload date format, filled by `client.service.ts` from `AppConfig.dateFormat`. */
      dateFormat: AppDateFormat;

      /** Payload locale, filled by `client.service.ts` from `AppConfigService.activeLocale`. */
      locale: string;
    };

/** The query object of `GET /clients` (AAP 0.7.2 `ClientListParams`; AAP 0.7.3 "Client list and edit"). */
export interface ClientListParams {
  /** Rows to skip, `(page - 1) * limit`. */
  offset: number;
  /** Rows to return: 15, the legacy page size. */
  limit: number;
  /** Sort column, when a caller sorts; the in-scope list does not. */
  orderBy?: string;
  /** Sort direction, paired with `orderBy`. */
  sortOrder?: 'ASC' | 'DESC';
  /** Free-text filter, when a caller filters server-side; the in-scope list does not. */
  searchText?: string;
}

/** The `GET /clients` envelope (`{"totalFilteredRecords":5,"pageItems":[…]}`), both members needed: `totalFilteredRecords` drives the pager. */
export interface ClientListPage {
  /** Rows the query matched across every page, ignoring `offset` and `limit`. */
  totalFilteredRecords: number;
  /** The rows of this page, in the server's order; empty when nothing matched. */
  pageItems: readonly Client[];
}

/** The platform's `CommandProcessingResult` for `POST /clients`, `PUT /clients/{id}` and the five lifecycle commands, projected to the two ids a screen needs. */
export interface ClientMutationResponse {
  /** Id of the record the command produced or changed. */
  resourceId: number;
  /** Client id the command reported, when it reported one. */
  clientId?: number;
}

/** The status swatch key for a Fineract client status code, delegating to the one mapping in `shared/status-key.util.ts`; pure and total, so a template may call it per row. */
export function toClientStatusKey(code: string | undefined): StatusKey {
  return toStatusKey(code);
}

/** Whether a client status code is the `closed` one the list's "Show Closed" checkbox hides — legacy hides that code alone, so a rejected or withdrawn client still shows (Rule 1 clause 3). This is the checkbox's question and not the swatch's: {@link toClientStatusKey} paints those two states `other`, deliberately apart from the `closed` grey. */
export function isClosedClientStatus(code: string | undefined): boolean {
  return code !== undefined && normaliseStatusCode(code) === 'closed';
}

/** The client status codes that end a client's lifecycle: the closed state and the two the server records when an application is refused or withdrawn. Terminal is a different question from colour — {@link toClientStatusKey} paints the first `closed` and the other two `other`, so that the state "Show Closed" hides is distinguishable from the states it leaves on screen — and a different one again from that filter, which tests the closed code alone. */
const TERMINAL_CLIENT_STATUSES: ReadonlySet<string> = new Set<string>(['closed', 'rejected', 'withdraw']);

/** Whether a client status code names a terminal state — closed, rejected or withdrawn — each of which legacy answers with a command of its own (`undoReject`, `undoWithdrawn`) that this build's action set does not keep, which is why the client view offers those records no entry rather than one the server would refuse (AAP 0.7.4; Rule 1 clause 3). Read from the code and never from the swatch's key: the key separates the closed state from the two it does not hide, so it cannot answer a lifecycle question (AAP 0.10.5 item 11). */
export function isTerminalClientStatus(code: string | undefined): boolean {
  return code !== undefined && TERMINAL_CLIENT_STATUSES.has(normaliseStatusCode(code));
}

/** The status swatch key for a loan or savings account status code, delegating to the same shared mapping; colour only, no status word (AAP 0.10.5 item 11). */
export function toAccountStatusKey(code: string | undefined): StatusKey {
  return toStatusKey(code);
}
