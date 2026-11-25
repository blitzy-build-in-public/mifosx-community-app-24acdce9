import type { AppDateFormat } from '../../core/config/app-config.model';
import type { FineractDate } from '../../shared/date-format.util';
import { toStatusKey, type StatusKey } from '../../shared/status-key.util';

/**
 * Every request and response shape of the saving-accounts resource family (AAP 0.7.1 Features row
 * `savings`, AAP 0.11.1 row for `savings.models.ts`), plus the family's only status mapping.
 *
 * The family is the Stretch workflow W8 (AAP 0.9.1 scope group 4, AAP 0.10.1 W8 row): open an
 * account, approve it, activate it, deposit 1,000, withdraw 200, and read the record back with its
 * summary and transactions. Nothing beyond that is modelled — no interest posting, no transfer, no
 * standing order, no share or deposit-product shape — because those belong to migration units the
 * plan leaves out of scope (AAP 0.9.2).
 *
 * **One date convention, shared with the other two families.** A request body holds the values the
 * form holds: each date a `Date | null`, `dateFormat` and `locale` required. `SavingsService`
 * converts every date with `toFineractDate` and fills the two format members from `AppConfig` where
 * it builds the payload, so no component formats a date and no model stores a formatted date
 * (AAP 0.7.2 "Date handling", AAP 0.14.1 "Dates never travel as strings built in a template").
 *
 * **Recorded contract divergence, and the source that settles it.** AAP 0.7.2 names the account's two
 * product members `productId` and `productName`; the fork answers the record read,
 * `GET /savingsaccounts/{id}?associations=all`, with `savingsProductId` and `savingsProductName` —
 * its `SavingsAccountsApiResourceSwagger` declares those two on `GetSavingsAccountsResponse` and no
 * unprefixed pair — and the template read, `GET /savingsaccounts/template?clientId=&productId=`,
 * echoes the chosen product the same way. The fork's OpenAPI document is the contract's source of
 * truth (AAP 0.7.3) and Rule 1 clause 2 requires the fields the server actually carries, so
 * `SavingsAccount` and `SavingsTemplate` keep the wire's spelling. The unprefixed `productId`
 * survives only where a request sends one — `SavingsApplicationRequest.productId` and the template
 * read's `productId` query parameter — the name the AAP row and the endpoint use for what is posted.
 *
 * Declaration only. The single function here is `toSavingsStatusKey`; everything else disappears at
 * compile time, so a spec imports this module with no provider setup. A doc comment names the read
 * or write a shape projects, but no path is ever composed here: URL literals belong to
 * `savings.service.ts` alone (AAP 0.8.2, AAP 0.14.1), and no credential, tenant datum or session
 * material is modelled here (Rule 1 clause 9).
 */

/**
 * The `{id, code, value}` object Fineract uses for an account `status` and for a transaction
 * `transactionType` (AAP 0.7.2 `SavingsAccount.status`).
 *
 * `code` is the stable discriminator — a resource-type-qualified key such as
 * `savingsAccountStatusType.active` — and it is what `toSavingsStatusKey` matches on. `value` is the
 * server's display text for the same code: a transaction row may render it as the type of the
 * transaction, while an account's status never renders it at all, because the status indicator is
 * a colour swatch and nothing else (AAP 0.10.5 deliberate difference 11).
 */
export interface FineractCodeValue {
  /** Numeric identifier of the code, as the server sent it. */
  readonly id: number;

  /** Stable, resource-qualified code key; the only member `toSavingsStatusKey` reads. */
  readonly code: string;

  /** Display text for the code, rendered unchanged where a screen shows text at all. */
  readonly value: string;
}

/**
 * The three balance figures the record page renders (AAP 0.7.2 `SavingsAccount.summary`).
 *
 * Response projection of the account read: the server computes all three, and this family never
 * derives one from another — the W8 outcome (a final balance of 800 after a 1,000 deposit and a
 * 200 withdrawal) is the server's `accountBalance`, not arithmetic performed in the browser.
 */
export interface SavingsSummary {
  /** Current balance of the account. */
  readonly accountBalance: number;

  /** Sum of the account's deposits so far. */
  readonly totalDeposits: number;

  /** Sum of the account's withdrawals so far. */
  readonly totalWithdrawals: number;
}

/**
 * One row of the record page's transactions table: date, type, amount and running balance.
 *
 * Response projection of the account read. The field names are confirmed against the live payload
 * of the account read that carries every association during the run; if the fork spells one of
 * them differently, the correction is made in this interface alone and no template changes.
 */
export interface SavingsTransaction {
  /** Transaction identifier. */
  readonly id: number;

  /** The transaction's date, as the server returned it; parsed by `fromFineractDate` for display. */
  readonly date: FineractDate;

  /** Transaction type — deposit, withdrawal and so on; its `value` is the row's type text. */
  readonly transactionType: FineractCodeValue;

  /** Signed amount the server reports for this transaction. */
  readonly amount: number;

  /** Balance after this transaction, when the server includes it. */
  readonly runningBalance?: number;
}

/**
 * A savings account as the record page reads it (AAP 0.7.2 `SavingsAccount`).
 *
 * Response projection of the single account read that requests every association,
 * `GET /savingsaccounts/{id}?associations=all`: one request returns the status, the summary and the
 * transactions together (AAP 0.7.1 `savings` row), which is why `transactions` is not optional — an
 * absent list would mean the request, not the account, was incomplete. Its product members carry the
 * wire's names (`savingsProductId`, `savingsProductName`), as the fork sends them, so a screen reads
 * a value the response actually carries (Rule 1 clause 2) — the divergence from AAP 0.7.2's spelling
 * is recorded at the head of this module.
 */
export interface SavingsAccount {
  /** Account identifier. */
  readonly id: number;

  /** Account number as the server renders it, kept as a string and never coerced. */
  readonly accountNo: string;

  /** Owning client's identifier. */
  readonly clientId: number;

  /** Owning client's display name, when the server includes it. */
  readonly clientName?: string;

  /**
   * Savings product the account was opened on, under the wire's `savingsProductId` — the product-id
   * key the account read carries (Rule 1 clause 2).
   */
  readonly savingsProductId: number;

  /** Savings product's name, under the wire's `savingsProductName`, rendered as the server sent it. */
  readonly savingsProductName: string;

  /** Account status; mapped to the indicator's vocabulary by `toSavingsStatusKey`. */
  readonly status: FineractCodeValue;

  /** The account's three balance figures. */
  readonly summary: SavingsSummary;

  /** The account's transactions, in the order the server returned them. */
  readonly transactions: readonly SavingsTransaction[];
}

/**
 * One selectable option of a savings template response: the `productOptions` and
 * `paymentTypeOptions` lists arrive in this shape.
 *
 * The staff list does not: `fieldOfficerOptions` rows are `SavingsTemplateStaffOption`, which
 * carries `displayName` where an option carries `name` (Rule 1 clause 2).
 *
 * Structurally identical to `shared/select-field`'s `SelectOption`, so an option list can be handed
 * to a `SelectFieldComponent` without a mapping layer. Declared here rather than imported from that
 * component, because this module's dependencies are limited to the configuration model, the shared
 * date value and the status vocabulary; the equal shape is what keeps the two compatible, so
 * narrowing one of them here or there is a compile error at the hand-off rather than a silent
 * mismatch. Options render in the order the template returned them — no sorting, filtering or
 * renaming — because the legacy screens do the same (AAP 0.4.4 decision 6, Rule 1 clause 3).
 */
export interface SavingsTemplateOption {
  /** Option identifier, sent back verbatim when the option is posted. */
  readonly id: number;

  /** Option label as the template returned it, rendered unchanged. */
  readonly name: string;
}

/**
 * One row of the savings template's `fieldOfficerOptions` list: a staff member the response offers
 * as the application's field officer.
 *
 * It differs from `SavingsTemplateOption` because the server's staff row carries `displayName` and
 * no `name` — the shape `GET /savingsaccounts/template?clientId=&productId=` returns, and the shape
 * the legacy form binds (`fieldOfficer.id as fieldOfficer.displayName for fieldOfficer in
 * fieldOfficers`, `app/views/savings/new_saving_account_application.html`), so a row is described
 * from a member the response actually carries (Rule 1 clauses 2 and 3).
 *
 * The new-application screen renders no officer picker: the body AAP 0.7.2 fixes is `clientId`,
 * `productId`, `submittedOnDate`, `dateFormat` and `locale` and carries no officer member, so a
 * selection could not be posted. This type therefore describes the response, not a control — the
 * list stays modelled because the read returns it, and the member a screen would need lives where
 * the wire puts it. `ClientStaffOption` in `features/clients/client.models.ts`, the client
 * template's staff-dropdown type, is the same `{id, displayName}` pair for the same reason.
 */
export interface SavingsTemplateStaffOption {
  /** Staff identifier, as the server sends it; the new application posts no officer member. */
  readonly id: number;

  /** Label in the server's `'Officer, Parity'` form — its display name, rendered unchanged. */
  readonly displayName: string;
}

/**
 * The new-application screen's template response: the defaults the server would use and the product
 * list the screen binds.
 *
 * Response projection of the savings template read,
 * `GET /savingsaccounts/template?clientId=&productId=` (AAP 0.7.3 W8 row). Only what a screen uses is
 * modelled: a template response carries many more keys — currency, terms, charge and accounting
 * mappings — and those are left unmodelled rather than guessed at, so this interface stays a
 * statement about the response rather than a partial copy of the server's payload. The endpoint
 * omits a list it has no entries for — the client-only read carries no `fieldOfficerOptions` at all —
 * so every list here is optional and a reader renders an empty picker rather than reading an
 * undefined array.
 */
export interface SavingsTemplate {
  /** Client the template was requested for, when the server echoes it. */
  readonly clientId?: number;

  /**
   * Product the server pre-selected, when the request named one; the template read names it
   * `savingsProductId`, and the client-only read omits it.
   */
  readonly savingsProductId?: number;

  /** Submission date the server would default to, when it returns one. */
  readonly submittedOnDate?: FineractDate;

  /**
   * Products the account may be opened on, in the server's order, under the wire's `productOptions`
   * — the only key the read uses for that list — and absent when the client has no product to open
   * an account on.
   */
  readonly productOptions?: readonly SavingsTemplateOption[];

  /**
   * Field officers the response offers for the application, in the server's order, as
   * `SavingsTemplateStaffOption` rows: a staff row carries `displayName` and no `name`, unlike the
   * product and payment-type lists above. Absent from the client-only read, so the member is
   * optional and a reader must not assume an array. The new-application screen renders no officer
   * picker, because the creation body AAP 0.7.2 fixes has no member to post it to.
   */
  readonly fieldOfficerOptions?: readonly SavingsTemplateStaffOption[];
}

/**
 * The deposit and withdrawal form's template response: the payment types a transaction may carry.
 *
 * Response projection of the transaction template read (AAP 0.7.3 W8 row). The same read serves both
 * commands; the screen renders one form and posts it with the command the route selected.
 */
export interface SavingsTransactionTemplate {
  /** Payment types a transaction may name, in the server's order. */
  readonly paymentTypeOptions: readonly SavingsTemplateOption[];
}

/**
 * The new-account application body (AAP 0.7.2 `SavingsApplicationRequest`).
 *
 * Request body of the account creation the W8 workflow opens. The field list is the plan's, verbatim
 * and in its order; `submittedOnDate` is the `Date | null` the form holds, and the service writes the
 * formatted date beside the required `dateFormat` and `locale` (Rule 1 clause 2). Product defaults
 * come from the template response rather than from this type: no member here carries a default
 * value or a client-side constraint (Rule 1 clause 3).
 */
export interface SavingsApplicationRequest {
  /** Owning client's identifier. */
  readonly clientId: number;

  /** Savings product the account is opened on. */
  readonly productId: number;

  /** Submission date the form holds; `null` when its field is empty. */
  readonly submittedOnDate: Date | null;

  /** Format the service writes the date in; the one the configuration fixes. */
  readonly dateFormat: AppDateFormat;

  /** Language the service writes the date in. */
  readonly locale: string;
}

/**
 * The approval body (AAP 0.7.2 `SavingsActionRequest`, `approve` shape).
 *
 * Request body of the approve action. One shape per command, because the server validates each
 * command's body separately and they do not share a field set beyond the date, the format and the
 * locale.
 */
export interface SavingsApproveRequest {
  /** Approval date the form holds; `null` when its field is empty. */
  readonly approvedOnDate: Date | null;

  /** Format the service writes the date in; the one the configuration fixes. */
  readonly dateFormat: AppDateFormat;

  /** Language the service writes the date in. */
  readonly locale: string;
}

/**
 * The activation body (AAP 0.7.2 `SavingsActionRequest`, `activate` shape).
 *
 * Request body of the activate action, which only a submitted-and-approved account accepts.
 */
export interface SavingsActivateRequest {
  /** Activation date the form holds; `null` when its field is empty. */
  readonly activatedOnDate: Date | null;

  /** Format the service writes the date in; the one the configuration fixes. */
  readonly dateFormat: AppDateFormat;

  /** Language the service writes the date in. */
  readonly locale: string;
}

/**
 * Every savings action body, keyed by the command its endpoint takes: `approve` and `activate`,
 * which post to `POST /savingsaccounts/{id}?command=approve|activate`, and `deposit` / `withdrawal`,
 * which post to `POST /savingsaccounts/{id}/transactions?command=deposit|withdrawal` (AAP 0.7.2
 * "one shape per command", AAP 0.7.3 W8 row).
 *
 * The two-arm split is deliberate: the account endpoint and the transactions endpoint validate
 * different field sets, so the two lifecycle bodies and `SavingsTransactionRequest` stay distinct
 * shapes rather than one permissive body. The union still spans all four commands the AAP row names,
 * so a consumer typed against this name can express an approval, an activation, a deposit or a
 * withdrawal. The service narrows it with the command it was given rather than inspecting the body
 * it received, and the date member's name is the discriminant a screen switches on, so an approval
 * date cannot reach the activation command.
 */
export type SavingsActionRequest =
  | SavingsApproveRequest
  | SavingsActivateRequest
  | SavingsTransactionRequest;

/**
 * The two lifecycle commands the account endpoint takes (AAP 0.7.3 W8 row).
 *
 * Wire spelling: `approve` and `activate`, exactly as the endpoint expects. Not to be confused with
 * `SavingsTransactionCommand`, whose values differ.
 */
export type SavingsCommand = 'approve' | 'activate';

/**
 * The deposit and withdrawal body (AAP 0.7.2 `SavingsActionRequest`, `deposit` / `withdrawal`
 * shapes).
 *
 * Request body of a cash transaction on an activated account. The amount is required; no range and
 * no balance check is added here, because the server owns both and the legacy screen adds neither
 * (Rule 1 clause 3).
 */
export interface SavingsTransactionRequest {
  /** Transaction date the form holds; `null` when its field is empty. */
  readonly transactionDate: Date | null;

  /** Amount deposited or withdrawn as entered. */
  readonly transactionAmount: number;

  /**
   * Payment type the transaction is recorded against, from the transaction template, or `null` when
   * the form named none. The member travels as `null` in that case rather than being left out, so
   * the server's own rule for the field is the one that answers and its message is the one the
   * screen shows (AAP 0.4.4 decision 6, Rule 1 clause 3).
   */
  readonly paymentTypeId: number | null;

  /** Format the service writes the date in; the one the configuration fixes. */
  readonly dateFormat: AppDateFormat;

  /** Language the service writes the date in. */
  readonly locale: string;
}

/**
 * The two cash-transaction commands the transactions endpoint takes (AAP 0.7.3 W8 row).
 *
 * Wire spelling: `deposit` and `withdrawal`. The withdrawal command is spelled `withdrawal` on the
 * wire while the route segment the user sees is `withdraw` (AAP 0.8.2 savings routes); the
 * difference is deliberate and neither spelling is normalised into the other.
 */
export type SavingsTransactionCommand = 'deposit' | 'withdrawal';

/**
 * The status indicator's key for a Fineract savings account status code — the savings record's only
 * status mapping (AAP 0.2.3 row `StatusSwatch`; AAP 0.7.2 row `SavingsAccount`; AAP 0.7.3 W8).
 *
 * It delegates to the single mapping in `web-ng/src/app/shared/status-key.util.ts`, which holds the
 * four-key vocabulary and the one table over the fork's `SavingsAccountStatusType.java` codes, so a
 * pre-mature closure, a matured account and a plain closure all reach the same finished colour and
 * no screen can colour one code two ways. The code is the only input: the payload's `value` display
 * text is never consulted, because it is localised prose and would change the swatch with the
 * language. An unrecognised code — `invalid`, a transfer in progress or on hold, anything the enum
 * adds later — and a missing one are both the neutral `other`, never `active`. Pure and total — no
 * I/O, no logging, no throw — so it can run for every row.
 *
 * @param code The `code` member of the account's `status`, or `undefined` when the response carried
 *   none.
 * @returns The key the indicator renders.
 */
export function toSavingsStatusKey(code: string | undefined): StatusKey {
  return toStatusKey(code);
}

