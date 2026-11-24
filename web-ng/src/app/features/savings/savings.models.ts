import type { AppConfig } from '../../core/config/app-config.model';
import type { StatusKey } from '../../shared/status-swatch/status-swatch.component';

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
 * **Each date-bearing payload is a pair.** A `*Request` interface is the HTTP body exactly as
 * Fineract receives it: the date already formatted, plus `dateFormat` and `locale`. A `*Input`
 * interface is what a screen hands the service: real `Date` values. The conversion happens once, in
 * `SavingsService`, through `toFineractDate`, so no component formats a date and no payload can
 * carry a second format (AAP 0.7.2 "Date handling", AAP 0.14.1 "Dates never travel as strings built
 * in a template").
 *
 * Declaration only. The single function here is `toStatusKey`; everything else disappears at
 * compile time, so a spec imports this module with no provider setup. No URL, host or path appears
 * in this file — paths belong to `savings.service.ts` alone (AAP 0.8.2, AAP 0.14.1), and no
 * credential, tenant datum or session material is modelled here (Rule 1 clause 9).
 */

/**
 * The format a date-bearing body carries beside its `locale`: the literal type of
 * `AppConfig.dateFormat`, itself `FINERACT_DATE_FORMAT`.
 *
 * Derived rather than re-typed so the format string has exactly one owner
 * (`core/config/app-config.model.ts`, Rule 1 clause 2). Annotating a request's `dateFormat` with
 * this alias means a body cannot be built with an arbitrary pattern — any other string fails to
 * compile.
 */
export type AppDateFormat = AppConfig['dateFormat'];

/**
 * A date as Fineract returns it in a response body: either an ISO `yyyy-MM-dd` string or a
 * `[year, month, day]` number triple with a one-based month.
 *
 * This is a wire value, not something a screen renders or computes with. The only parser is
 * `fromFineractDate` in `shared/date-format.util.ts`, which narrows both shapes and returns a
 * local-midnight `Date` (or `null`); a table cell or a field goes through it rather than reading
 * these members itself.
 */
export type FineractDateValue = string | [number, number, number];

/**
 * The `{id, code, value}` object Fineract uses for an account `status` and for a transaction
 * `transactionType` (AAP 0.7.2 `SavingsAccount.status`).
 *
 * `code` is the stable discriminator — a resource-type-qualified key such as
 * `savingsAccountStatusType.active` — and it is what `toStatusKey` matches on. `value` is the
 * server's display text for the same code: a transaction row may render it as the type of the
 * transaction, while an account's status never renders it at all, because the status indicator is
 * a colour swatch and nothing else (AAP 0.10.5 deliberate difference 11).
 */
export interface FineractCodeValue {
  /** Numeric identifier of the code, as the server sent it. */
  readonly id: number;

  /** Stable, resource-qualified code key; the only member `toStatusKey` reads. */
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
  readonly date: FineractDateValue;

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
 * Response projection of the single account read that requests every association: one request
 * returns the status, the summary and the transactions together (AAP 0.7.1 `savings` row), which
 * is why `transactions` is not optional — an absent list would mean the request, not the account,
 * was incomplete.
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

  /** Savings product the account was opened on. */
  readonly productId: number;

  /** Savings product's name, rendered as the server sent it. */
  readonly productName: string;

  /** Account status; mapped to the indicator's vocabulary by `toStatusKey`. */
  readonly status: FineractCodeValue;

  /** The account's three balance figures. */
  readonly summary: SavingsSummary;

  /** The account's transactions, in the order the server returned them. */
  readonly transactions: readonly SavingsTransaction[];
}

/**
 * One selectable option of a savings template response: `savingsProductOptions`,
 * `fieldOfficerOptions` and `paymentTypeOptions` all arrive in this shape.
 *
 * Structurally identical to `shared/select-field`'s `SelectOption`, so an option list can be handed
 * to a `SelectFieldComponent` without a mapping layer. Declared here rather than imported from that
 * component, because this module's dependencies are limited to the configuration model and the
 * status vocabulary; the equal shape is what keeps the two compatible, so narrowing one of them
 * here or there is a compile error at the hand-off rather than a silent mismatch. Options render in
 * the order the template returned them — no sorting, filtering or renaming — because the legacy
 * screens do the same (AAP 0.4.4 decision 6, Rule 1 clause 3).
 */
export interface SavingsTemplateOption {
  /** Option identifier, sent back verbatim when the option is posted. */
  readonly id: number;

  /** Option label as the template returned it, rendered unchanged. */
  readonly name: string;
}

/**
 * The new-application screen's template response: the defaults the server would use and the option
 * lists the screen binds.
 *
 * Response projection of the savings template read (AAP 0.7.3 W8 row). Only what the screen renders
 * is modelled: a template response carries many more keys — currency, terms, charge and accounting
 * mappings — and those are left unmodelled rather than guessed at, so this interface stays a
 * statement about the screen rather than a partial copy of the server's payload.
 */
export interface SavingsTemplate {
  /** Client the template was requested for, when the server echoes it. */
  readonly clientId?: number;

  /** Product the server pre-selected, when the request named one. */
  readonly productId?: number;

  /** Submission date the server would default to, when it returns one. */
  readonly submittedOnDate?: FineractDateValue;

  /** Products the account may be opened on, in the server's order. */
  readonly savingsProductOptions: readonly SavingsTemplateOption[];

  /** Field officers the application may be assigned to, in the server's order. */
  readonly fieldOfficerOptions: readonly SavingsTemplateOption[];
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
 * and in its order; every date is already formatted and travels with `dateFormat` and `locale`
 * (Rule 1 clause 2). Product defaults come from the template response rather than from this type:
 * no member here carries a default value or a client-side constraint (Rule 1 clause 3).
 */
export interface SavingsApplicationRequest {
  /** Owning client's identifier. */
  readonly clientId: number;

  /** Savings product the account is opened on. */
  readonly productId: number;

  /** Submission date, formatted with `dateFormat` in `locale`. */
  readonly submittedOnDate: string;

  /** Format `submittedOnDate` was written in; the one the configuration fixes. */
  readonly dateFormat: AppDateFormat;

  /** Language `submittedOnDate` was written in. */
  readonly locale: string;
}

/**
 * What the new-application screen hands the service to open an account.
 *
 * Form input, the `Date`-bearing counterpart of `SavingsApplicationRequest`: the service formats
 * `submittedOnDate` and adds `dateFormat` and `locale` at the boundary.
 */
export interface SavingsApplicationInput {
  /** Owning client's identifier. */
  readonly clientId: number;

  /** Savings product the account is opened on. */
  readonly productId: number;

  /** Submission date the screen's field holds. */
  readonly submittedOnDate: Date;
}

/**
 * The approval body (AAP 0.7.2 `SavingsActionRequest`, `approve` shape).
 *
 * Request body of the approve action. One shape per command, because the server validates each
 * command's body separately and they do not share a field set beyond the date, the format and the
 * locale.
 */
export interface SavingsApproveRequest {
  /** Approval date, formatted with `dateFormat` in `locale`. */
  readonly approvedOnDate: string;

  /** Format `approvedOnDate` was written in; the one the configuration fixes. */
  readonly dateFormat: AppDateFormat;

  /** Language `approvedOnDate` was written in. */
  readonly locale: string;
}

/**
 * The activation body (AAP 0.7.2 `SavingsActionRequest`, `activate` shape).
 *
 * Request body of the activate action, which only a submitted-and-approved account accepts.
 */
export interface SavingsActivateRequest {
  /** Activation date, formatted with `dateFormat` in `locale`. */
  readonly activatedOnDate: string;

  /** Format `activatedOnDate` was written in; the one the configuration fixes. */
  readonly dateFormat: AppDateFormat;

  /** Language `activatedOnDate` was written in. */
  readonly locale: string;
}

/**
 * Either savings action body, keyed by `SavingsCommand` (AAP 0.7.2 "one shape per command").
 *
 * Request body union of the two lifecycle actions. The service narrows it with the command it was
 * given rather than inspecting the body it received.
 */
export type SavingsActionRequest = SavingsApproveRequest | SavingsActivateRequest;

/**
 * What the action screen hands the service for an approval or an activation.
 *
 * Form input, the `Date`-bearing counterpart of `SavingsActionRequest`. The member name — and so
 * the command — is the discriminant the service switches on, so a screen cannot post an approval
 * date to the activation command.
 */
export type SavingsActionInput =
  | { readonly approvedOnDate: Date }
  | { readonly activatedOnDate: Date };

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
  /** Transaction date, formatted with `dateFormat` in `locale`. */
  readonly transactionDate: string;

  /** Amount deposited or withdrawn as entered. */
  readonly transactionAmount: number;

  /** Payment type the transaction is recorded against, from the transaction template. */
  readonly paymentTypeId: number;

  /** Format `transactionDate` was written in; the one the configuration fixes. */
  readonly dateFormat: AppDateFormat;

  /** Language `transactionDate` was written in. */
  readonly locale: string;
}

/**
 * What the deposit or withdrawal form hands the service.
 *
 * Form input, the `Date`-bearing counterpart of `SavingsTransactionRequest`.
 */
export interface SavingsTransactionInput {
  /** Transaction date the screen's field holds. */
  readonly transactionDate: Date;

  /** Amount deposited or withdrawn as entered. */
  readonly transactionAmount: number;

  /** Payment type the transaction is recorded against. */
  readonly paymentTypeId: number;
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
 * Maps a Fineract savings status code onto the status indicator's vocabulary
 * (`StatusKey`, AAP 0.2.3 component inventory row `StatusSwatch`).
 *
 * The family's only status mapping, and the reason `StatusSwatchComponent` never receives a
 * Fineract code: the indicator carries a colour and no text at all (AAP 0.10.5 deliberate
 * difference 11), so the code — not the server's display text — decides the swatch. Matching is on
 * the code string, lower-cased and tested with a tolerant substring check, so a fork that qualifies
 * or spells a code slightly differently still maps instead of silently falling through. The
 * server's `value` display text is never consulted, because it is localised prose and would change
 * the swatch with the language.
 *
 * Mappings: `savingsAccountStatusType.active` → `active`; the submitted-and-pending-approval and
 * approved codes → `pending`; closed, rejected and withdrawn → `closed`; everything else, and a
 * missing code, → `other`.
 *
 * @param code The `code` member of the account's `status`, or `undefined` when the response carried
 *   none.
 * @returns The key the indicator renders.
 */
export function toStatusKey(code: string | undefined): StatusKey {
  if (code === undefined) {
    return 'other';
  }

  const normalisedCode = code.trim().toLowerCase();

  if (normalisedCode.includes('active')) {
    return 'active';
  }

  if (
    normalisedCode.includes('submitted') ||
    normalisedCode.includes('pending') ||
    normalisedCode.includes('approved')
  ) {
    return 'pending';
  }

  if (
    normalisedCode.includes('closed') ||
    normalisedCode.includes('rejected') ||
    normalisedCode.includes('withdrawn')
  ) {
    return 'closed';
  }

  return 'other';
}

