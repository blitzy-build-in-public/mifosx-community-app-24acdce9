import type { AppDateFormat } from '../../core/config/app-config.model';
import type { FineractDate } from '../../shared/date-format.util';
import { toStatusKey, type StatusKey } from '../../shared/status-key.util';

/** Every request and response shape of the saving-accounts resource family (AAP 0.7.1 Features row `savings`, AAP 0.11.1 row for `savings.models.ts`), plus the family's only status mapping (AAP 0.9.1, AAP 0.10.1, AAP 0.9.2, AAP 0.7.2). */

/** The `{id, code, value}` object Fineract uses for an account `status` and for a transaction `transactionType` (AAP 0.7.2 `SavingsAccount.status`) (AAP 0.10.5). */
export interface FineractCodeValue {
  /** Numeric identifier of the code, as the server sent it. */
  readonly id: number;
  /** Stable, resource-qualified code key; the only member `toSavingsStatusKey` reads. */
  readonly code: string;
  /** Display text for the code, rendered unchanged where a screen shows text at all. */
  readonly value: string;
}

/** The three balance figures the record page renders (AAP 0.7.2 `SavingsAccount.summary`). */
export interface SavingsSummary {
  /** Current balance of the account. */
  readonly accountBalance: number;
  /** Sum of the account's deposits so far. Optional because the fork omits the member when the total is zero; the record reads the absent member as `0` (see `savings-view.component.html`). */
  readonly totalDeposits?: number;
  /** Sum of the account's withdrawals so far. Optional for the same reason: the fork omits a zero total, and the record reads the absent member as `0` (see `savings-view.component.html`). */
  readonly totalWithdrawals?: number;
}

/** One row of the record page's transactions table: date, type, amount and running balance. */
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

/** A savings account as the record page reads it (AAP 0.7.2 `SavingsAccount`) (AAP 0.7.1, Rule 1 clause 2). */
export interface SavingsAccount {
  /** Account identifier. */
  readonly id: number;
  /** Account number as the server renders it, kept as a string and never coerced. */
  readonly accountNo: string;
  /** Owning client's identifier. */
  readonly clientId: number;
  /** Owning client's display name, when the server includes it. */
  readonly clientName?: string;
  /** Savings product the account was opened on, under the wire's `savingsProductId` — the product-id key the account read carries (Rule 1 clause 2). */
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

/** One selectable option of a savings template response: the `productOptions` and `paymentTypeOptions` lists arrive in this shape (Rule 1 clause 2, AAP 0.4.4, Rule 1 clause 3). */
export interface SavingsTemplateOption {
  /** Option identifier, sent back verbatim when the option is posted. */
  readonly id: number;
  /** Option label as the template returned it, rendered unchanged. */
  readonly name: string;
}

/** One row of the savings template's `fieldOfficerOptions` list: a staff member the response offers as the application's field officer (AAP 0.7.2). */
export interface SavingsTemplateStaffOption {
  /** Staff identifier, as the server sends it; the new application posts no officer member. */
  readonly id: number;
  /** Label in the server's `'Officer, Parity'` form — its display name, rendered unchanged. */
  readonly displayName: string;
}

/** The new-application screen's template response: the defaults the server would use and the product list the screen binds (AAP 0.7.3). */
export interface SavingsTemplate {
  /** Client the template was requested for, when the server echoes it. */
  readonly clientId?: number;
  /** Product the server pre-selected, when the request named one; the template read names it `savingsProductId`, and the client-only read omits it. */
  readonly savingsProductId?: number;
  /** Submission date the server would default to, when it returns one. */
  readonly submittedOnDate?: FineractDate;
  /** Products the account may be opened on, in the server's order, under the wire's `productOptions` — the only key the read uses for that list — and absent when the client has no product to open an account on. */
  readonly productOptions?: readonly SavingsTemplateOption[];
  /** Field officers the response offers for the application, in the server's order, as `SavingsTemplateStaffOption` rows: a staff row carries `displayName` and no `name`, unlike the product and payment-type lists above (AAP 0.7.2). */
  readonly fieldOfficerOptions?: readonly SavingsTemplateStaffOption[];
}

/** The deposit and withdrawal form's template response: the payment types a transaction may carry (AAP 0.7.3). */
export interface SavingsTransactionTemplate {
  /** Payment types a transaction may name, in the server's order. */
  readonly paymentTypeOptions: readonly SavingsTemplateOption[];
}

/** The new-account application body (AAP 0.7.2 `SavingsApplicationRequest`) (Rule 1 clause 2, Rule 1 clause 3). */
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

/** The approval body (AAP 0.7.2 `SavingsActionRequest`, `approve` shape). */
export interface SavingsApproveRequest {
  /** Approval date the form holds; `null` when its field is empty. */
  readonly approvedOnDate: Date | null;
  /** Format the service writes the date in; the one the configuration fixes. */
  readonly dateFormat: AppDateFormat;
  /** Language the service writes the date in. */
  readonly locale: string;
}

/** The activation body (AAP 0.7.2 `SavingsActionRequest`, `activate` shape). */
export interface SavingsActivateRequest {
  /** Activation date the form holds; `null` when its field is empty. */
  readonly activatedOnDate: Date | null;
  /** Format the service writes the date in; the one the configuration fixes. */
  readonly dateFormat: AppDateFormat;
  /** Language the service writes the date in. */
  readonly locale: string;
}

/** Every savings action body, keyed by the command its endpoint takes: `approve` and `activate`, which post to `POST /savingsaccounts/{id}?command=approve|activate`, and `deposit` / `withdrawal`, which post to `POST (AAP 0.7.2, AAP 0.7.3). */
export type SavingsActionRequest =
  | SavingsApproveRequest
  | SavingsActivateRequest
  | SavingsTransactionRequest;

/** The two lifecycle commands the account endpoint takes (AAP 0.7.3 W8 row). */
export type SavingsCommand = 'approve' | 'activate';

/** The deposit and withdrawal body (AAP 0.7.2 `SavingsActionRequest`, `deposit` / `withdrawal` shapes) (Rule 1 clause 3). */
export interface SavingsTransactionRequest {
  /** Transaction date the form holds; `null` when its field is empty. */
  readonly transactionDate: Date | null;
  /** Amount deposited or withdrawn as entered. */
  readonly transactionAmount: number;
  /** Payment type the transaction is recorded against, from the transaction template, or `null` when the form named none (AAP 0.4.4, Rule 1 clause 3). */
  readonly paymentTypeId: number | null;
  /** Format the service writes the date in; the one the configuration fixes. */
  readonly dateFormat: AppDateFormat;
  /** Language the service writes the date in. */
  readonly locale: string;
}

/** The two cash-transaction commands the transactions endpoint takes (AAP 0.7.3 W8 row) (AAP 0.8.2). */
export type SavingsTransactionCommand = 'deposit' | 'withdrawal';

/** The status indicator's key for a Fineract savings account status code — the savings record's only status mapping (AAP 0.2.3 row `StatusSwatch`; AAP 0.7.2 row `SavingsAccount`; AAP 0.7.3 W8). */
export function toSavingsStatusKey(code: string | undefined): StatusKey {
  return toStatusKey(code);
}

