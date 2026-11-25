import type { AppDateFormat } from '../../core/config/app-config.model';
import type { FineractDate } from '../../shared/date-format.util';
import type { StatusKey } from '../../shared/status-swatch/status-swatch.component';

/**
 * The single type module of the clients feature family (AAP 0.7.1 row `clients`; AAP 0.7.2 rows
 * `Client`, `ClientTemplate`, `ClientAccountSummary`, `ClientIdentifier`, `ClientCreateRequest`,
 * `ClientEditRequest`, `ClientActionRequest`, `ClientListParams`; AAP 0.11.1 row for this path):
 * every request body and every response projection that `client.service.ts` and the clients
 * screens exchange with Fineract.
 *
 * Declaration only — no class, no enum, no fixture, no Angular or RxJS import, and no loosely
 * typed escape hatch anywhere inside it (Rule 1 clause 4). Two of the three imports are shared
 * declarations every family uses — the response-date value `FineractDate` from
 * `web-ng/src/app/shared/date-format.util.ts` and the payload format `AppDateFormat` from
 * `web-ng/src/app/core/config/app-config.model.ts` — and the third is the `StatusKey` vocabulary
 * the status indicator already owns, so the four-state colour vocabulary lives in exactly one
 * place and the screens' status mapping has one verdict rather than two.
 *
 * **Date serialisation.** No model here stores a formatted date. A request body carries
 * `Date | null` and `client.service.ts` converts it at the API boundary with
 * `toFineractDate(value, locale)` from `web-ng/src/app/shared/date-format.util.ts`, into a body
 * that also carries `dateFormat` from `AppConfig.dateFormat` (`'dd MMMM yyyy'`, typed as the one
 * `AppDateFormat`) and `locale` from `AppConfigService.activeLocale` (AAP 0.7.2 "Date handling"; Rule 1
 * clause 2). Both members are required, not optional, so a body that omitted either would not
 * compile: no component sets them, and the service fills them unconditionally at the boundary. A
 * response body carries a date as the `FineractDate` declared once in
 * `web-ng/src/app/shared/date-format.util.ts` — the `'yyyy-MM-dd'` string or the
 * `[year, month, day]` triple the endpoints send — which `fromFineractDate` turns back into a
 * `Date` at the point a field or a cell holds it.
 *
 * **Wire fidelity over plan shorthand.** Member names and value shapes below are the ones the
 * endpoints actually send, because Rule 1 clause 2 preserves the contract and a type that
 * misdescribes it turns a compile-time check into a runtime defect. Five points where the
 * research record and the running fork differ, each verified against the
 * `Blitzy-Sandbox/blitzy-fineract` source and a live response:
 *
 *   - a client's timeline object is keyed `timeline`, not `timestamps` (`ClientData.timeline`,
 *     and the legacy templates read `client.timeline.activatedOnDate`);
 *   - a `LocalDate` arrives as `[year, month, day]` (`getClients` returns
 *     `"activationDate": [2026, 11, 21]`), which is why every response date is a `FineractDate` —
 *     the shared value that also admits the `'yyyy-MM-dd'` string a template default uses;
 *   - an identifier's `status` is plain text, while a client's own `status` is the
 *     `{id, code, value}` object (`ClientIdentifierData.status` is a `String`);
 *   - `staffOptions` entries carry `displayName` and no `name`, which is the label the legacy
 *     staff dropdown binds (`staff.id as staff.displayName`), so they are `ClientStaffOption`
 *     rather than `ClientOption`;
 *   - an entity client is named by `fullname` alone — `ClientDataValidator` rejects a non-blank
 *     `firstname` or `lastname` sent with it, so a form fills one name set or the other — and
 *     `PUT /clients/{id}` does not accept `officeId`, so the edit body carries no office and the
 *     edit form's office control is display-only.
 *
 * The status is a colour swatch and nothing else: no member here offers display text for it, and
 * no helper turns a code into a word (AAP 0.10.5 deliberate difference 11; Rule 1 clause 3).
 */

/**
 * The five client lifecycle commands in scope (AAP 0.7.3 rows "W2 create and activate client" and
 * "Client actions"), and nothing else: a transfer, a staff assignment or a client charge belongs to
 * a different migration unit. Each is the `command` query parameter of `POST /clients/{id}`, and it
 * is also the discriminant of `ClientActionRequest`, so a screen cannot post one action's body to
 * another action's endpoint and a missing field is a compile error rather than a 400.
 */
export type ClientActionCommand = 'activate' | 'close' | 'reject' | 'withdraw' | 'reactivate';

/**
 * A client's status object as the client endpoints return it (observed:
 * `{ id: 300, code: 'clientStatusType.active', value: 'Active' }`), on `GET /clients` rows, on
 * `GET /clients/{id}` and on `GET /clients/{id}/accounts` entries.
 *
 * `code` is the only member the application acts on, through `toClientStatusKey`. `value` is the
 * server's English display text and is deliberately never rendered: the design paints a colour
 * swatch with no word beside it (AAP 0.2.1 step 2, AAP 0.10.5 deliberate difference 11), and
 * showing `value` would put English on a screen whose translations come from
 * `app/global-translations/`.
 */
export interface ClientStatus {
  /** Fineract status id, e.g. `300` for active. Carried through, never compared. */
  id: number;

  /** Machine code the application maps with `toClientStatusKey`, e.g. `'clientStatusType.active'`. */
  code: string;

  /** Server-provided English label. Present on the wire, deliberately never displayed. */
  value: string;
}

/**
 * One entry of an office, of a document-type list, or of a closure, rejection or withdrawal reason
 * list, as a Fineract `template` endpoint returns it (`officeOptions`, `allowedDocumentTypes` and
 * the `narrations` lists were observed in this shape).
 *
 * Structurally assignable to `SelectOption` in
 * `web-ng/src/app/shared/select-field/select-field.component.ts`, so a screen hands these options
 * straight to `SelectFieldComponent` with no conversion — which is why the two members are exactly
 * the two that component binds. The other members the endpoints also send (`nameDecorated`,
 * `position`, `description`, `active`, `mandatory`) are intentionally unmodelled: no in-scope
 * screen reads them.
 */
export interface ClientOption {
  /** Option identifier, sent back unchanged as the chosen value. */
  id: number;

  /** Option label as the template returned it, rendered in the received order. */
  name: string;
}

/**
 * One entry of `GET /clients/template`'s `staffOptions`, which is a `StaffData` and not an
 * office-style option list: it carries `firstname`, `lastname`, `displayName`, `officeId`,
 * `officeName`, `isLoanOfficer` and `isActive`, and no `name` at all.
 *
 * Only `id` and `displayName` are modelled, because `displayName` is the label the legacy staff
 * dropdown binds (`staff.id as staff.displayName for staff in staffOptions`, verified in the
 * legacy client-actions template) and it is what the create and edit forms render. Because there
 * is no `name`, a screen maps this to `SelectOption` when it builds the control's options; that
 * one mapping is the price of binding the label legacy binds rather than a blank option.
 */
export interface ClientStaffOption {
  /** Staff identifier, sent back unchanged as the chosen `staffId`. */
  id: number;

  /** Label the template returned, in the form `'Officer, Parity'`; rendered unchanged. */
  displayName: string;
}

/**
 * A partial projection of the far larger timeline object a client response carries under the key
 * `timeline` — the two dates the record screen reads.
 *
 * `GET /clients/{id}` and `GET /clients` both send `timeline` with `submittedOnDate` and
 * `activatedOnDate` among a dozen members (`submittedByUsername`, `closedOnDate`,
 * `closedByFirstname`, …). The remaining members are deliberately unmodelled rather than typed
 * loosely, so an unused member cannot be reached by accident (Rule 1 clause 4). `closedOnDate`
 * belongs to the closed state that an in-scope screen shows through the status swatch alone.
 */
export interface ClientTimestamps {
  /** Date the application was submitted, as the endpoint sent it. */
  submittedOnDate?: FineractDate;

  /** Date the client was activated; absent while a client is still pending. */
  activatedOnDate?: FineractDate;
}

/**
 * A partial projection of one `datatables` entry of a client template response: the registered
 * table's name and nothing else.
 *
 * The clients family never reads a datatable definition — the datatable gate that must run before
 * a client action belongs to `web-ng/src/app/core/api/datatable-gate.service.ts`, and the custom
 * field values a datatable form collects are not in scope. The name is the one thing the template
 * hands to that gate.
 */
export interface ClientDatatable {
  /** Registered table name, e.g. `'client_extra_details'`, as the template sent it. */
  registeredTableName: string;
}

/**
 * A client as `GET /clients` rows and `GET /clients/{id}` return it — the shape the list table and
 * the record header both render (AAP 0.7.3 rows "W3 search and view client", "Client list and
 * edit").
 *
 * `accountNo` and `externalId` are strings and are never coerced to numbers: `accountNo` is
 * zero-padded text (`'000000002'`) that the design prints verbatim as the client number, and an
 * external id is free text a bank assigns. `id` is a number and is never stringified, because it
 * is a route parameter and a request field. Members the endpoints also send but no in-scope screen
 * reads (`legalForm`, `isStaff`, `groups`, `savingsProductName`, `dateOfBirth`, …) are absent by
 * design.
 *
 * A client is named by one of two name sets, and the endpoint omits the other one entirely: a
 * person carries `firstname` and `lastname`, an entity carries `fullname`. Both sets are therefore
 * optional here, and `displayName` is the member a list or a header prints whichever set is used.
 */
export interface Client {
  /** Fineract client id: the `:id` of `#/viewclient/:id` and of every client request. */
  id: number;

  /** Zero-padded client number, e.g. `'000000002'`; display text, never parsed as a number. */
  accountNo: string;

  /** Bank-assigned external id; absent when the client has none. */
  externalId?: string;

  /** Name the list and the record header print, e.g. `'Ada Okafor'` or a business name. */
  displayName: string;

  /**
   * First name as entered; absent for an entity client, which the endpoint names through
   * `fullname` alone (observed live: `GET /clients/5` for `'Blitzy Bakery LLC'` sends no
   * `firstname` key). A form seeding its name fields reads the set that is there.
   */
  firstname?: string;

  /** Last name as entered; absent for an entity client, as `firstname` is. */
  lastname?: string;

  /**
   * Entity name, e.g. `'Blitzy Bakery LLC'`; absent for a person, whose name the endpoint sends as
   * `firstname` and `lastname` instead. It is the value an entity rename posts back.
   */
  fullname?: string;

  /**
   * Office id; the office a create body files the client under. An update does not accept it
   * (`ClientEditRequest` carries no office), so an edit form shows it as display-only.
   */
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

/**
 * The `GET /clients/template` response — what the create form's dropdowns and defaults come from
 * (AAP 0.7.3 row "W2 create and activate client"; AAP 0.4.4 decision 6: dropdowns and defaults come
 * from the same template endpoints the legacy screens call).
 *
 * Observed live: `activationDate` arrives as a `FineractDate` triple and the options are the only
 * populated lists on an empty tenant. `active` and `datatables` are optional because the fork omits
 * them when they do not apply: `active` appears on the edit form's template
 * (`GET /clients/{id}?template=true`) but not on the create template here, and `datatables` appears
 * only once a datatable is registered for the client entity. A screen therefore reads a default
 * from the template only when it is there, and never invents one.
 */
export interface ClientTemplate {
  /** Office the form starts on, from the template's own default. */
  officeId: number;

  /** Offices the client may be filed under, rendered in the received order. */
  officeOptions: readonly ClientOption[];

  /**
   * Loan officers selectable for the client, labelled by `displayName`. Absent when the tenant has
   * no staff: the template drops the key rather than sending a null or an empty list, so a screen
   * that finds no member here renders an empty picker.
   */
  staffOptions?: readonly ClientStaffOption[];

  /** Date the template offers as the activation default. */
  activationDate: FineractDate;

  /** Whether the record the template was read for is active; absent on the create template. */
  active?: boolean;

  /** Datatables registered for the client entity; absent when none is registered. */
  datatables?: readonly ClientDatatable[];
}

/**
 * The `GET /clients/template?commandParam=close|reject|withdraw` response — the reason list the
 * close, reject and withdraw forms offer (AAP 0.7.3 row "Client actions").
 *
 * A separate document from `ClientTemplate`, not a variant of it: for these three `commandParam`
 * values the endpoint answers with narrations alone, observed live as
 * `{"isStaff":false,"narrations":[]}`, and carries no `officeId`, `officeOptions`, `activationDate`
 * or `staffOptions` at all, so a screen reads a reason list here and nothing else. `narrations` is
 * always present as an array, and is empty when the tenant has configured no reason for that
 * command. The server's `isStaff` member is not modelled because no in-scope screen reads it, as
 * with every unread member in this module.
 *
 * This is the typed source of the reason ids `ClientActionRequest` requires (AAP 0.7.2 row
 * `ClientActionRequest`): a `close` body reads its `closureReasonId`, a `reject` body its
 * `rejectionReasonId` and a `withdraw` body its `withdrawalReasonId` from `narrations`. A screen
 * therefore never invents an id as a constant, because the configured reasons differ per tenant.
 */
export interface ClientNarrationTemplate {
  /**
   * Reasons configured for the requested command, in the server's order: the closure reasons, the
   * rejection reasons or the withdrawal reasons, depending on `commandParam`, each carrying the id
   * that the matching `closureReasonId`, `rejectionReasonId` or `withdrawalReasonId` member sends.
   * Always an array, and empty when the tenant has configured none for that command.
   */
  narrations: readonly ClientOption[];
}

/**
 * One loan account row of the client record's accounts table, projecting
 * `GET /clients/{id}/accounts` (AAP 0.7.3 row "W3 search and view client").
 *
 * Declared here rather than imported from `features/loans` because the plan places no
 * cross-feature dependency in this family; it models the columns the accounts table shows — the
 * account number, the product name, the status swatch and the outstanding balance figure. The row's
 * other members (`externalId`, `productId`, `currency`, `loanType`, `loanCycle`) are read by no
 * in-scope screen and are therefore absent.
 */
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

/**
 * One savings account row of the client record's accounts table, projecting
 * `GET /clients/{id}/accounts`. Declared here for the same reason as
 * `ClientLoanAccountSummary`: no `features/savings` import from this family, and only the columns
 * the accounts table shows. The row's `shortProductName`, `currency` and `depositType` members are
 * read by no in-scope screen and are absent.
 */
export interface ClientSavingsAccountSummary {
  /** Savings account id: the `:id` of `#/viewsavingaccount/:id`. */
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

/**
 * The `GET /clients/{id}/accounts` response as the client record's accounts table uses it
 * (AAP 0.7.3 row "W3 search and view client"; AAP 0.7.4 client view, General tab).
 *
 * Both families are optional because the endpoint omits a key rather than sending an empty array:
 * a client with no accounts at all answers with neither `loanAccounts` nor `savingsAccounts`, which
 * was observed live, and the record then renders the explicit empty state rather than an error
 * (AAP 0.7.4 "States every list and record screen must implement"). The endpoint's other
 * collections (`groupLoanIndividualMonitoringAccounts`, `guarantorAccounts`,
 * `workingCapitalLoanAccounts`) belong to out-of-scope modules and are not modelled.
 */
export interface ClientAccountSummary {
  /** Loan accounts held by the client; absent when the client holds none. */
  loanAccounts?: readonly ClientLoanAccountSummary[];

  /** Savings accounts held by the client; absent when the client holds none. */
  savingsAccounts?: readonly ClientSavingsAccountSummary[];
}

/**
 * One identifier of the record's Identities tab, projecting `GET /clients/{id}/identifiers`
 * (AAP 0.7.3 row "W3 search and view client"; read-only in scope).
 *
 * `status` is plain text here and not a `ClientStatus`: Fineract's `ClientIdentifierData` declares
 * it as a `String`, so a screen renders what it receives and never an object it would not get.
 * `issuanceDate` and `expiryDate` are carried by the endpoint but read by no in-scope screen and
 * are therefore absent.
 */
export interface ClientIdentifier {
  /** Identifier id, used as the row key. */
  id: number;

  /** Document type, resolved from `ClientIdentifierTemplate.allowedDocumentTypes` when needed. */
  documentType: ClientOption;

  /** The document's key value, e.g. a passport number. */
  documentKey: string;

  /** Free-text description; absent when the record has none. */
  description?: string;

  /** Identifier status as the endpoint sends it — text, not a status object. */
  status?: string;
}

/**
 * The `GET /clients/{id}/identifiers/template` response, modelled as the one thing the family uses
 * it for: resolving a document-type name when a payload carries only its id
 * (AAP 0.7.3 row "W3 search and view client").
 *
 * Observed live as `{ allowedDocumentTypes: [{ id: 1, name: 'Passport', position: 1, … }] }`; the
 * ordering members are not read, so the list is projected to `ClientOption` and rendered in the
 * server's order.
 */
export interface ClientIdentifierTemplate {
  /** Document types an identifier may use, in the server's order. */
  allowedDocumentTypes: readonly ClientOption[];
}

/**
 * The `POST /clients` body the create screen posts (AAP 0.7.3 row "W2 create and activate client";
 * AAP 0.7.2 row `ClientCreateRequest`).
 *
 * Dates are `Date | null` and are serialised by `client.service.ts`; the date-format pair is not a
 * member a screen chooses. `client.service.ts` writes `dateFormat` from `AppConfig.dateFormat` and
 * `locale` from `AppConfigService.activeLocale` when it builds the wire body, replacing whatever a
 * caller put there, so both members are optional and the create screen leaves them out entirely: a
 * screen that supplied them could not change what the server parses, and requiring them only made
 * every caller carry two values it must not own (AAP 0.7.2 row `ClientCreateRequest`, "Date
 * handling"; Rule 1 clause 2).
 *
 * `legalFormId` is required. The fork's `ClientDataValidator.validateForCreate` extracts it with
 * `notNull().inMinMaxRange(1, 2)`, so a create without it is rejected — 1 for a person, 2 for an
 * entity — and the legacy create screen posts it for the same reason. It and `fullname` are the
 * two fields this model adds to AAP 0.7.2's list, because the workflow cannot complete without
 * them: an entity client is named by `fullname` and carries no individual name parts.
 *
 * No member carries a client-side validation rule: the required set is the server's, the messages
 * are the server's, and nothing here adds a min, a max or a pattern the legacy form does not have
 * (Rule 1 clause 3; AAP 0.7.2 "no added rules").
 */
export interface ClientCreateRequest {
  /** Office the client is filed under, from the template's office list. */
  officeId: number;

  /** Legal form: 1 for a person, 2 for an entity. Required by the server on create. */
  legalFormId: number;

  /**
   * Loan officer the client is assigned to, from the template's staff list; sent only when the form
   * selected one. The legacy create form posts it from its `staffId` control, and the attribute is
   * part of the create request the server accepts, so leaving it out would drop a choice the
   * operator made.
   */
  staffId?: number;

  /**
   * First name; required by the server for a person (`legalFormId` 1) and left out for an entity.
   * The server rejects it together with `fullname`, so a form fills exactly one name set.
   */
  firstname?: string;

  /**
   * Last name; required by the server for a person (`legalFormId` 1) and left out for an entity.
   * The server rejects it together with `fullname`, so a form fills exactly one name set.
   */
  lastname?: string;

  /**
   * Entity name, e.g. `'Blitzy Bakery LLC'`; required by the server for an entity (`legalFormId` 2)
   * and left out for a person. The server rejects the individual name parts and this member sent in
   * one body (`validateIndividualNamePartsCannotBeUsedWithFullname`), so a form fills exactly one
   * name set.
   */
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

  /**
   * Payload date format. Optional, because `client.service.ts` sets it at the API boundary from
   * `AppConfig.dateFormat` and replaces a caller's value: the create screen omits it, and the body
   * still goes out with the one format the configuration fixes (Rule 1 clause 2).
   */
  dateFormat?: AppDateFormat;

  /**
   * Payload locale. Optional for the same reason as `dateFormat`: `client.service.ts` sets it at the
   * API boundary from `AppConfigService.activeLocale`, so the language the user selected is what
   * the body carries rather than a value a screen remembered.
   */
  locale?: string;
}

/**
 * The `PUT /clients/{id}` body — the create set minus the submission date, which the server
 * keeps, and minus the office, which the update does not accept (AAP 0.7.2 row
 * `ClientEditRequest`; AAP 0.7.3 row "Client list and edit").
 *
 * There is no `officeId` here on purpose. The fork's `CLIENT_UPDATE_REQUEST_DATA_PARAMETERS` does
 * not list it, so a body carrying it is rejected with HTTP 400 and
 * `error.msg.parameter.unsupported` ("The parameter officeId is not supported."), and the legacy
 * edit controller never posts it: the office on the edit form is display-only, read from the
 * record. A member the server always refuses would be a trap, so it is absent rather than optional.
 *
 * `activationDate` is optional and present because the fork accepts it: `activationDateParamName` is
 * in `CLIENT_UPDATE_REQUEST_DATA_PARAMETERS`, so an edit of a client created inactive may carry the
 * activation date the record already holds. It is optional precisely because most edits touch names
 * only; a screen sends what it has and never invents a date.
 */
export interface ClientEditRequest {
  /**
   * First name as edited; required by the server for a person (`legalFormId` 1) and left out for an
   * entity. The server rejects it together with `fullname`, so a form fills exactly one name set.
   */
  firstname?: string;

  /**
   * Last name as edited; required by the server for a person (`legalFormId` 1) and left out for an
   * entity. The server rejects it together with `fullname`, so a form fills exactly one name set.
   */
  lastname?: string;

  /**
   * Entity name as edited, e.g. `'Blitzy Bakery LLC'`; required by the server for an entity
   * (`legalFormId` 2) and left out for a person. The server rejects the individual name parts and
   * this member sent in one body (`validateIndividualNamePartsCannotBeUsedWithFullname`), so a form
   * fills exactly one name set.
   */
  fullname?: string;

  /** Bank-assigned external id, when the form holds one. */
  externalId?: string;

  /** Mobile number, when the form holds one. */
  mobileNo?: string;

  /** Activation date the record carries, when the edit is meant to set it. */
  activationDate?: Date | null;

  /** Payload date format, filled by `client.service.ts` from `AppConfig.dateFormat`. */
  dateFormat: AppDateFormat;

  /** Payload locale, filled by `client.service.ts` from `AppConfigService.activeLocale`. */
  locale: string;
}

/**
 * The body of one client lifecycle action, as a discriminated union on `command`
 * (AAP 0.7.2 row `ClientActionRequest`; AAP 0.7.3 row "Client actions").
 *
 * The discriminant is the thing that keeps a screen honest: a component holding an
 * `activate` request cannot read `closureReasonId` from it, a `close` request without a reason id
 * does not compile, and a closure date can never be posted to `activate`. Each reason id comes from
 * the reason list the action screen reads (`ClientNarrationTemplate.narrations`, from
 * `GET /clients/template?commandParam=…`), never from a constant, because the ids differ per
 * tenant. Dates are `Date | null`, serialised by `client.service.ts`; the server rejects an action
 * that needs a date and receives none, with the message the screen shows verbatim.
 *
 * The commands the server accepts are exactly these five (`POST /clients/{id}?command=…`):
 * `activate` takes an activation date, `close`, `reject` and `withdraw` each take their own date and
 * a mandatory reason id (the fork validates each reason id with `notNull`), and `reactivate` takes a
 * reactivation date, which the fork requires just as strictly: `ClientDataValidator.validateReactivate`
 * applies `notNull` to `reactivationDate` and rejects a blank body outright with `InvalidJsonException`,
 * so the date is a member of the payload rather than an optional extra.
 */
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

      /** Chosen closure reason, from the reason list the action screen reads. */
      closureReasonId: number;

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

      /** Chosen rejection reason, from the reason list the action screen reads. */
      rejectionReasonId: number;

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

      /** Chosen withdrawal reason, from the reason list the action screen reads. */
      withdrawalReasonId: number;

      /** Payload date format, filled by `client.service.ts` from `AppConfig.dateFormat`. */
      dateFormat: AppDateFormat;

      /** Payload locale, filled by `client.service.ts` from `AppConfigService.activeLocale`. */
      locale: string;
    }
  | {
      /** Reactivates a closed client. */
      command: 'reactivate';

      /**
       * Reactivation date the action posts; required by the server. `ClientDataValidator.validateReactivate`
       * validates this member with `notNull` and the request parameter set for the command is exactly
       * `locale`, `dateFormat` and this date, so a reactivate without it is refused.
       */
      reactivationDate: Date | null;

      /** Payload date format, filled by `client.service.ts` from `AppConfig.dateFormat`. */
      dateFormat: AppDateFormat;

      /** Payload locale, filled by `client.service.ts` from `AppConfigService.activeLocale`. */
      locale: string;
    };

/**
 * The query object of `GET /clients` (AAP 0.7.2 row `ClientListParams`; AAP 0.7.3 row
 * "Client list and edit").
 *
 * The in-scope list screen sends `offset` and `limit` and nothing else: the legacy
 * `ClientController` pages with `offset: (page - 1) * clientsPerPage` and `limit: clientsPerPage`
 * where `clientsPerPage` is 15, so the list keeps a pager of 15 rows per page. `orderBy`,
 * `sortOrder` and `searchText` are declared because other legacy client queries use them and
 * AAP 0.7.2 records them; the in-scope screen leaves them unset, and typing them as optional
 * distinct members keeps a mistyped parameter from being sent by accident.
 */
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

/**
 * The `GET /clients` response: the paged envelope the endpoint answers with rather than a bare array
 * (AAP 0.7.3 row "Client list and edit"; the fork's `ClientsApiResourceSwagger.GetClientsResponse`,
 * observed live as `{"totalFilteredRecords":5,"pageItems":[…]}`).
 *
 * Both members are modelled because the list screen needs both, and neither is optional: the legacy
 * `clientResource.getAllClients({offset, limit})` callback reads `data.pageItems` for the table and
 * `data.totalFilteredRecords` for the pager, and the endpoint sends `pageItems` as `[]` — never as a
 * missing key — when nothing matches, which was also observed live. Flattening the envelope to its
 * rows would therefore lose the record count the pager needs, and a row list alone cannot say how
 * many rows the filter matched.
 */
export interface ClientListPage {
  /** Rows the query matched across every page, ignoring `offset` and `limit`. */
  totalFilteredRecords: number;

  /** The rows of this page, in the server's order; empty when nothing matched. */
  pageItems: readonly Client[];
}

/**
 * The platform's command-processing response for `POST /clients`, `PUT /clients/{id}` and the five
 * lifecycle commands, projected to the two ids a screen needs.
 *
 * The response is `CommandProcessingResult`, which also carries `officeId`, `groupId`, `changes`
 * and a `rollbackTransaction` flag that no in-scope screen reads. `clientId` accompanies a client
 * command, and `resourceId` is the id of the record the command produced, so the create screen
 * navigates with `clientId ?? resourceId` and a command screen returns to the record it was opened
 * from.
 */
export interface ClientMutationResponse {
  /** Id of the record the command produced or changed. */
  resourceId: number;

  /** Client id the command reported, when it reported one. */
  clientId?: number;
}

/**
 * The client status codes this application recognises, mapped to the indicator vocabulary
 * `StatusSwatchComponent` owns. Every key is one of `ClientStatus`'s own codes in the fork's
 * `ClientStatus.java`, normalised as all three families normalise a status code, and nothing else:
 * `invalid`, `transfer.in.progress` and `transfer.on.hold` are absent by design.
 *
 * All three terminal states are `closed` — closed, rejected and withdrawn — because the design's
 * vocabulary has no colour of its own for any of them.
 */
const STATUS_KEY_BY_CODE: Readonly<Partial<Record<string, StatusKey>>> = {
  active: 'active',
  pending: 'pending',
  closed: 'closed',
  rejected: 'closed',
  withdraw: 'closed',
};

/**
 * The normalisation the three feature families share before a status code is looked up:
 * lower-cased, the family's own message-code prefix removed if the payload carried it, and every
 * non-alphanumeric character stripped, so the whole remaining name is the key.
 *
 * `clientStatusType.transfer.in.progress`, `TRANSFER_IN_PROGRESS` and `transferInProgress`
 * therefore all normalise to `transferinprogress`.
 */
function normaliseClientStatusCode(code: string): string {
  return code.toLowerCase().replace(/^clientstatustype\./, '').replace(/[^a-z0-9]/g, '');
}

/**
 * The single mapping from a Fineract client status code to the status indicator's key, shared by
 * the clients list and the client record header so both paint the same verdict for the same client
 * (AAP 0.2.3 row `StatusSwatch`; AAP 0.7.2 row `Client`).
 *
 * The lookup is exact. The code is lower-cased, its `clientStatusType.` prefix and every separator
 * removed, and the whole remaining name — never just its last dot-segment — is matched against an
 * exact table over the fork's `ClientStatus` enum.
 *
 * Recognised codes, by the state they indicate:
 *
 *   - `clientStatusType.active` → `active`;
 *   - `clientStatusType.pending` → `pending`;
 *   - `clientStatusType.closed`, `clientStatusType.rejected` and `clientStatusType.withdraw` →
 *     `closed`, because all three are terminal in the design's vocabulary;
 *   - everything else → `other`: `clientStatusType.transfer.in.progress`,
 *     `clientStatusType.transfer.on.hold`, `clientStatusType.invalid`, an empty string and
 *     `undefined` all fall here.
 *
 * Failure is neutral, never `active`: an unrecognised or missing code must not paint a pending or
 * transferred client as active, and `other` carries a colour of its own without claiming a state.
 * Pure and total — no I/O, no logging, no throw — so it can run in a template for every row.
 *
 * @param code The `code` of a client status object, or `undefined` when a response carried none.
 * @returns One of the four keys `StatusSwatchComponent` renders.
 */
export function toClientStatusKey(code: string | undefined): StatusKey {
  if (code === undefined) {
    return 'other';
  }

  return STATUS_KEY_BY_CODE[normaliseClientStatusCode(code)] ?? 'other';
}
