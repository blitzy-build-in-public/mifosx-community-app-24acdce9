/**
 * Page object for the new Angular application's individual-loan screens — the `next` project's side
 * of workflows W4 (submit an application after previewing its schedule), W5 (approve and disburse),
 * W6 (make a repayment) and W7 (a Fineract validation error rendered verbatim).
 *
 * **The four routes it drives**, the loan tree `web-ng/tools/parity/in-scope-routes.json` declares
 * and `features/loans/loans.routes.ts` mounts (AAP 0.8.2):
 *
 * - `/newclientloanaccount/:clientId`                      — `LoanNewComponent`, root `app-loan-new`
 * - `/editloanaccount/:id`                                 — `LoanEditComponent`, root `app-loan-edit`
 * - `/viewloanaccount/:id`                                 — `LoanViewComponent`, root `app-loan-view`
 * - `/loanaccount/:id/:action`                             — `LoanActionComponent`, root `app-loan-action`
 *
 * The repayment screen is the `repayment` segment of `/loanaccount/:id/:action`: `app-loan-action`
 * renders `<app-loan-repayment>` for that segment, so both roots are on the page and
 * {@link LoansPage.openRepayment} and `openAction(id, 'repayment')` reach the same screen. The class
 * doc of the savings sibling records the same split for its action screens.
 *
 * **Entry URL (Rule 2, AAP 0.4.4 decision 5).** Every navigation composes
 * `${NEXT_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}&tenantIdentifier=${TENANT_ID}#<route>`.
 * The application resolves its backend once, before the first navigation, from `assets/config.json`,
 * then the container's `API_BASE_URL`/`TENANT_ID`, then these two query parameters, which win. A bare
 * `page.goto('#/viewloanaccount/7')` would be resolved against the browser's `baseURL` and would drop
 * both parameters, leaving the application on whatever backend its build configured rather than the
 * one this run must address, so this file composes the whole URL for every navigation. That is also
 * why no host literal appears here: `NEXT_URL` and `FINERACT_URL` are the only origins, and both come
 * from `seed/fixtures.ts`.
 *
 * **No date is computed here.** The file holds no clock read of any kind: every date it types is the
 * caller's own `yyyy-mm-dd` string, derived from the tenant business date over the API by
 * `seed/fixtures.ts`. The screens themselves default their dates from the browser clock exactly as the
 * legacy forms do (AAP 0.10.5 item 15), so the harness always supplies the tenant business date rather
 * than inheriting the default (Rule 1 clause 2, AAP 0.10.1 "Run date").
 *
 * **What it does and does not do.** It drives the screens and reads what they render: locators and
 * typed readers only, no assertion of any kind, because every judgement belongs to the specs under
 * `web-ng/e2e/specs/` (Rule 1 clause 8). It issues no HTTP request of its own, names no endpoint and
 * sends no command — the screens' typed `LoanService` owns every path and the interceptor attaches the
 * auth and tenant headers (Rule 1 clauses 2 and 5; Rule 2). No value is rounded, clamped or bounded: a
 * principal of 50,000 is typed exactly as supplied so that W7 exercises Fineract's own rejection,
 * which is why the application carries no range on that field and this object adds none (Rule 1 clause
 * 3; AAP 0.7.2). Amounts, balances and dates are returned exactly as the screen renders them, plus one
 * documented numeric parse, so normalisation stays with the network capture and the parity report
 * (AAP 0.10.2).
 *
 * **Locators.** Taken from the loan templates and from the two shared field components
 * (`shared/date-field`, `shared/select-field`) they render. Every visible caption is translated at run
 * time from the legacy locale bundles, so each control is resolved by the id its template ships and
 * only then by a case-insensitive caption pattern; the record's tables are mapped by their header
 * cells rather than by fixed positions, so a caption that translates differently degrades to an empty
 * cell instead of to another column's figure. Both shared fields render native controls — the
 * `input[type="date"]` and `<select>` that replace the two third-party widgets the legacy screens
 * loaded (AAP 0.10.5 items 1 and 2) — which is what makes a plain `fill` and `selectOption` enough.
 */
import type { Locator, Page } from '@playwright/test';

import { FINERACT_URL, NEXT_URL, TENANT_ID } from '../../seed/fixtures.js';

/**
 * One label/value row of a record as the page renders it: the record's `#loan-summary` block prints a
 * bold key and its figure side by side, and the same pair is what the legacy sibling's summary reader
 * reports for the baseline it drives.
 */
export interface LabelValue {
  /** The row's label text, trimmed. */
  readonly label: string;
  /** The row's rendered value, trimmed; `''` when the row renders no value. */
  readonly value: string;
}

/**
 * One row of the application form's repayment-schedule preview, as the server's calculation returned
 * it and the component painted it.
 *
 * The preview is the evidence W4 records before it submits (AAP 0.10.1): the number of periods and the
 * first period's total due are the two facts the workflow states, and both are read here rather than
 * recomputed. Every money member is the column's rendered text parsed by {@link toAmount}, while
 * {@link RepaymentPreviewRow.cells} keeps the cell texts themselves so a spec can compare the
 * rendering when a locale groups or rounds a figure differently (AAP 0.10.2).
 */
export interface RepaymentPreviewRow {
  /** Period number from the table's first column, `null` when the cell carries no number. */
  readonly period: number | null;
  /** The period's start date, exactly as the screen formatted it. */
  readonly fromDate: string;
  /** The period's due date, exactly as the screen formatted it. */
  readonly dueDate: string;
  /** Principal due in this period, parsed from its cell. */
  readonly principalDue: number | null;
  /** Interest due in this period, parsed from its cell. */
  readonly interestDue: number | null;
  /** Fees due in this period, parsed from its cell. */
  readonly feesDue: number | null;
  /** The period's total due, parsed from its cell. */
  readonly totalDue: number | null;
  /** The balance left after this period, parsed from its cell. */
  readonly outstanding: number | null;
  /** Every cell of the row, trimmed, in column order. */
  readonly cells: readonly string[];
}

/**
 * The loan record's status indicator and its summary rows, as the page renders them.
 *
 * `statusClass` is the colour class of the status swatch and never a word: the record paints a colour
 * only, and adding a textual status would be an improvement the migration forbids (AAP 0.10.5 item 11,
 * Rule 1 clause 3). The five figures the record prints are the schedule's own — the loan's total, its
 * outstanding balance, and the principal, interest and fee balances — returned in the order the block
 * reads them, with an empty string for a figure the payload did not report.
 */
export interface LoanSummaryView {
  /** One of `status-active`, `status-pending`, `status-closed`, `status-other`, or `''` if none is painted. */
  readonly statusClass: string;
  /** Label/value rows in document order, exactly as rendered. */
  readonly fields: readonly LabelValue[];
}

/** One row of the loan record's repayment-schedule table, with each figure parsed from its cell. */
export interface LoanScheduleRow {
  /** Period number from the table's first column, `null` when the cell carries no number. */
  readonly period: number | null;
  /** The period's start date, exactly as the screen formatted it. */
  readonly fromDate: string;
  /** The period's due date, exactly as the screen formatted it. */
  readonly dueDate: string;
  /** The period's total due, parsed from its cell. */
  readonly totalDue: number | null;
  /** The balance left after this period, parsed from its cell. */
  readonly outstanding: number | null;
  /** Every cell of the row, trimmed, in column order. */
  readonly cells: readonly string[];
}

/**
 * One row of the loan record's transaction list. After W6's repayment the list must carry the new
 * transaction and the balance it left, which is the figure the workflow compares (AAP 0.10.1).
 */
export interface LoanTransactionRow {
  /** The transaction date, exactly as the screen formatted it. */
  readonly date: string;
  /** Fineract's own label for the transaction type, passed through untranslated. */
  readonly type: string;
  /** The transaction amount, parsed from its cell. */
  readonly amount: number | null;
  /** The loan balance after the transaction, parsed from its cell. */
  readonly outstandingBalance: number | null;
  /** Every cell of the row, trimmed, in column order. */
  readonly cells: readonly string[];
}

/**
 * What {@link LoansPage.fillApplication} types into the application form. Every member is optional so
 * a caller states only the values it means to set: an omitted control keeps the value the Fineract
 * template supplied, which is what the legacy screen posts when the user changes nothing (AAP 0.7.2
 * `LoanApplicationRequest`).
 */
export interface LoanApplicationValues {
  /** Product to apply on, by the id of one of the template's `productOptions`. */
  readonly productId?: number | string;
  /** Principal applied for, passed through exactly as supplied — W7 relies on that for 50,000. */
  readonly principal?: number | string;
  /** Loan term, in the unit the frequency select states. */
  readonly loanTermFrequency?: number | string;
  /** Number of repayments in the schedule. */
  readonly numberOfRepayments?: number | string;
  /** How often a repayment falls due. */
  readonly repaymentEvery?: number | string;
  /** Nominal interest rate per period. */
  readonly interestRatePerPeriod?: number | string;
  /** Loan officer to attach, by the id of one of the template's `loanOfficerOptions`. */
  readonly loanOfficerId?: number | string;
  /** Fund to attach, by the id of one of the template's `fundOptions`. */
  readonly fundId?: number | string;
  /** `yyyy-mm-dd`, always supplied by the caller from the run date — never computed here. */
  readonly expectedDisbursementDate?: string;
  /** `yyyy-mm-dd`, always supplied by the caller from the run date — never computed here. */
  readonly submittedOnDate?: string;
}

/**
 * What {@link LoansPage.fillActionForm} types into an action form. Every member is optional because
 * each command carries its own body: an approval takes a date and an amount, a rejection a date, a
 * disbursement a date and an amount, and undo-approval and undo-disbursal no member at all — so
 * `fillActionForm({})` is a no-op rather than an error (AAP 0.7.2 `LoanActionRequest`).
 */
export interface LoanActionValues {
  /** `yyyy-mm-dd` approval date, typed into the approve form's date field. */
  readonly approvedOnDate?: string;
  /** Approved amount, typed into the amount field the approve form renders. */
  readonly approvedPrincipal?: number | string;
  /** `yyyy-mm-dd` rejection date, typed into the reject form's date field. */
  readonly rejectedOnDate?: string;
  /** `yyyy-mm-dd` disbursement date, typed into the disburse form's date field. */
  readonly actualDisbursementDate?: string;
  /** Amount disbursed, typed into the disburse form's amount field. */
  readonly transactionAmount?: number | string;
  /** Optional note the command carries. */
  readonly note?: string;
}

/**
 * What {@link LoansPage.fillRepayment} types into the repayment form (AAP 0.7.2
 * `LoanRepaymentRequest`).
 *
 * `transactionAmount` is deliberately optional: the screen seeds it from the repayment transaction
 * template, and W6 states the repayment as the first schedule period's total due, so a caller that
 * omits the amount leaves the screen's own pre-filled figure to be posted. This object never fills a
 * default of its own, because that value is exactly what the workflow measures.
 */
export interface LoanRepaymentValues {
  /** `yyyy-mm-dd` transaction date, typed into the repayment form's date field. */
  readonly transactionDate?: string;
  /** Amount repaid, passed through exactly as supplied when the caller states one. */
  readonly transactionAmount?: number | string;
  /** Payment type, by the id of one of the options the transactions template returned. */
  readonly paymentTypeId?: number | string;
  /** Optional note the repayment carries. */
  readonly note?: string;
}

/**
 * The `:action` segments the `/loanaccount/:id/:action` route serves for these workflows (AAP 0.8.2):
 * the five lifecycle commands of W5 and AAP 0.9.1, plus the repayment of W6. Exactly these six — a
 * segment this object does not know the screen of is rejected rather than navigated to.
 */
export type LoanAction =
  | 'approve'
  | 'undoapproval'
  | 'reject'
  | 'disburse'
  | 'undodisbursal'
  | 'repayment';

/** Root element of the individual-loan application screen, `LoanNewComponent`. */
const APPLICATION_ROOT = 'app-loan-new';

/** Root element of the application's repayment-schedule preview, `RepaymentPreviewComponent`. */
const PREVIEW_ROOT = 'app-repayment-preview';

/** Root element of the loan edit screen, `LoanEditComponent`. */
const EDIT_ROOT = 'app-loan-edit';

/** Root element of the loan record, `LoanViewComponent`. */
const VIEW_ROOT = 'app-loan-view';

/** Root element of the record's repayment-schedule section, `LoanScheduleComponent`. */
const SCHEDULE_ROOT = 'app-loan-schedule';

/** Root element of the record's transactions section, `LoanTransactionsComponent`. */
const TRANSACTIONS_ROOT = 'app-loan-transactions';

/** Root element of the lifecycle action screen, `LoanActionComponent`. */
const ACTION_ROOT = 'app-loan-action';

/** Root element of the repayment form, `LoanRepaymentComponent`. */
const REPAYMENT_ROOT = 'app-loan-repayment';

/**
 * The screens this object drives, by root element, with the words an error message uses for each. One
 * home for both, so a reader that cannot find a section can say which screen it was looking at.
 */
const SCREENS: Readonly<Record<string, string>> = {
  [APPLICATION_ROOT]: 'the loan application screen',
  [PREVIEW_ROOT]: 'the repayment-schedule preview',
  [EDIT_ROOT]: 'the loan edit screen',
  [VIEW_ROOT]: 'the loan record',
  [SCHEDULE_ROOT]: 'the repayment-schedule section',
  [TRANSACTIONS_ROOT]: 'the transactions section',
  [ACTION_ROOT]: 'the loan action screen',
  [REPAYMENT_ROOT]: 'the loan repayment screen',
};

/**
 * The six action segments accepted at run time, in the order the legacy record offers them. The union
 * type is the compile-time guard; this list is the run-time one, for a caller that reaches the class
 * through plain JavaScript.
 */
const LOAN_ACTIONS: readonly string[] = [
  'approve',
  'undoapproval',
  'reject',
  'disburse',
  'undodisbursal',
  'repayment',
];

/** `yyyy-mm-dd`, the only form a native date control accepts and the form this object requires. */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Ceiling for a screen's root element to paint after a navigation has been requested. */
const SCREEN_TIMEOUT_MS = 30_000;

/**
 * Ceiling for a template-driven option list to arrive. The product, officer, fund and payment-type
 * options all come from Fineract template endpoints the screen requests on entry, so a select
 * is empty for a moment after the form paints.
 */
const TEMPLATE_TIMEOUT_MS = 30_000;

/**
 * How long one attempt to read a template-driven option list waits before the next, when a selection
 * has to be matched on the option's logical value rather than on its DOM value.
 */
const OPTION_POLL_INTERVAL_MS = 100;

/**
 * How long to give the application form's own busy marker to appear after a product is selected.
 *
 * Choosing a product starts a template read, and the form states that read by marking its body
 * `aria-busy`; a template that answers within the same change-detection turn never shows the marker,
 * in which case there is nothing to wait for and the defaults are already in place.
 */
const TEMPLATE_BUSY_GRACE_MS = 2_000;

/**
 * One `<option>` of a native select, as the page renders it. Internal to this module.
 *
 * `value` is the option's *logical* value, not its DOM `value` attribute: a select bound through
 * `[ngValue]` stores each option under `${position}: ${ngValue}`, so matching a caller's id against
 * the DOM attribute would find nothing. `index` is the option's own position, which is what the
 * selection is made by.
 */
interface RenderedOption {
  /** The option's position in the select, from zero. */
  readonly index: number;
  /** The value the application bound, with Angular's `${position}: ` prefix removed. */
  readonly value: string;
  /** The option's visible text, trimmed — what a caller matches by label. */
  readonly label: string;
}

/**
 * A table as the page serialised it: the header texts that caption each column, then the data rows.
 * Internal to this module.
 *
 * Header texts rather than fixed positions, because the record's three sections and the preview each
 * declare their own column sets and their captions are translated at run time. A reader therefore
 * locates a column by the words above it and reads the cell beneath that column.
 */
interface TableGrid {
  /** One entry per `<th>` of the header row, lower-cased with runs of non-alphanumerics collapsed. */
  readonly columns: readonly string[];
  /** Data rows, each an array of trimmed cell texts in column order. */
  readonly rows: readonly (readonly string[])[];
}

/**
 * How one control of a screen is filled. Internal to this module.
 *
 * `ids` is the chain of ids the template may ship, most specific first — one member for most fields,
 * two where the application names a control after the member it posts. `label` is the pattern its
 * `.control-label` carries, used only when no id resolves, because every caption is translated.
 */
interface FieldSpec {
  /** The ids the template ships for the control, most specific first. */
  readonly ids: readonly string[];
  /** Pattern the control's `.control-label` carries, matched case-insensitively. */
  readonly label: string;
  /** What the control holds, which decides how it is filled. */
  readonly kind: 'date' | 'select' | 'text';
  /** What the field is, used in error messages. */
  readonly description: string;
}

/**
 * The application form's controls, by the model member that carries each value (`LoanNewComponent`).
 *
 * The ids are the ones the template ships, equal to their `formControlName`s, so both applications
 * offer the harness the same field names. The three selects are bound through the shared select field
 * and the two dates through the shared date field, which is why each is resolved by id first and by
 * its caption second.
 */
const APPLICATION_FIELDS = {
  productId: { ids: ['productId'], label: 'product', kind: 'select', description: 'loan product select' },
  principal: { ids: ['principal'], label: 'principal', kind: 'text', description: 'principal field' },
  loanTermFrequency: { ids: ['loanTermFrequency'], label: 'loan\\s*term', kind: 'text', description: 'loan term field' },
  numberOfRepayments: { ids: ['numberOfRepayments'], label: 'number\\s*of\\s*repayments', kind: 'text', description: 'number-of-repayments field' },
  repaymentEvery: { ids: ['repaymentEvery'], label: 'repaid\\s*every', kind: 'text', description: 'repayment frequency field' },
  interestRatePerPeriod: { ids: ['interestRatePerPeriod'], label: 'nominal\\s*interest', kind: 'text', description: 'interest rate field' },
  loanOfficerId: { ids: ['loanOfficerId'], label: 'loan\\s*officer', kind: 'select', description: 'loan officer select' },
  fundId: { ids: ['fundId'], label: 'fund', kind: 'select', description: 'fund select' },
  expectedDisbursementDate: { ids: ['expectedDisbursementDate'], label: 'disbursement', kind: 'date', description: 'expected-disbursement date field' },
  submittedOnDate: { ids: ['submittedOnDate'], label: 'submitted', kind: 'date', description: 'submitted-on date field' },
} as const satisfies Readonly<Record<keyof LoanApplicationValues, FieldSpec>>;

/**
 * The order the application's fields are filled in: the product first, then the terms.
 *
 * The order matters. Choosing a product re-reads the Fineract template so the terms below become that
 * product's, so a caller that supplies both must have the product selected before its own values are
 * typed, or the template's defaults would overwrite them.
 */
const APPLICATION_FIELD_ORDER: readonly (keyof LoanApplicationValues)[] = [
  'productId',
  'principal',
  'loanTermFrequency',
  'numberOfRepayments',
  'repaymentEvery',
  'interestRatePerPeriod',
  'loanOfficerId',
  'fundId',
  'expectedDisbursementDate',
  'submittedOnDate',
];

/**
 * The action form's controls (`LoanActionComponent`), by the member of {@link LoanActionValues} that
 * carries each value.
 *
 * The approved amount resolves to `approvedLoanAmount` first: that is the id the template ships,
 * because the application names the control after the member the fork accepts on the command — the
 * parameter `approvedPrincipal` is refused by the backend while `approvedLoanAmount` is what the
 * legacy body posts, a departure `loan.models.ts` records for the whole feature. `approvedPrincipal`
 * stays in the chain so a control named after the plan's own member still resolves.
 */
const ACTION_FIELDS = {
  approvedOnDate: { ids: ['approvedOnDate'], label: 'date', kind: 'date', description: 'approval date field' },
  approvedPrincipal: { ids: ['approvedPrincipal', 'approvedLoanAmount'], label: 'principal', kind: 'text', description: 'approved amount field' },
  rejectedOnDate: { ids: ['rejectedOnDate'], label: 'date', kind: 'date', description: 'rejection date field' },
  actualDisbursementDate: { ids: ['actualDisbursementDate'], label: 'date', kind: 'date', description: 'disbursement date field' },
  transactionAmount: { ids: ['transactionAmount'], label: 'amount', kind: 'text', description: 'disbursement amount field' },
  note: { ids: ['note'], label: 'note', kind: 'text', description: 'note field' },
} as const satisfies Readonly<Record<keyof LoanActionValues, FieldSpec>>;

/** The order the action form's controls are filled in: every field is independent, so any order holds. */
const ACTION_FIELD_ORDER: readonly (keyof LoanActionValues)[] = [
  'approvedOnDate',
  'approvedPrincipal',
  'rejectedOnDate',
  'actualDisbursementDate',
  'transactionAmount',
  'note',
];

/** The repayment form's controls (`LoanRepaymentComponent`), by the member that carries each value. */
const REPAYMENT_FIELDS = {
  transactionDate: { ids: ['transactionDate'], label: 'transaction', kind: 'date', description: 'transaction date field' },
  transactionAmount: { ids: ['transactionAmount'], label: 'amount', kind: 'text', description: 'repayment amount field' },
  paymentTypeId: { ids: ['paymentTypeId'], label: 'payment\\s*type', kind: 'select', description: 'payment type select' },
  note: { ids: ['note'], label: 'note', kind: 'text', description: 'note field' },
} as const satisfies Readonly<Record<keyof LoanRepaymentValues, FieldSpec>>;

/** The order the repayment form's controls are filled in: every field is independent. */
const REPAYMENT_FIELD_ORDER: readonly (keyof LoanRepaymentValues)[] = [
  'transactionDate',
  'transactionAmount',
  'paymentTypeId',
  'note',
];

/**
 * Column aliases of the application preview and of the record's repayment schedule, most specific
 * first.
 *
 * Two spellings per caption on purpose. With the legacy locale bundles served, a header reads
 * "From Date:"; when a bundle is not reachable the application's missing-translation handler
 * humanises the key instead and the same header reads "Fromdate". Both normalise to a caption listed
 * here, so the reader maps the column either way rather than reporting an empty figure for a table
 * that rendered one.
 */
const SCHEDULE_COLUMNS = {
  period: ['no', 'period'],
  fromDate: ['from date', 'fromdate', 'period from'],
  dueDate: ['date', 'due date', 'duedate'],
  principalDue: ['principal', 'principal due', 'principaldue'],
  interestDue: ['interest', 'interest due', 'interestdue'],
  feesDue: ['fees', 'fees due', 'feesdue'],
  totalDue: ['total', 'total due', 'totaldue'],
  outstanding: ['outstanding', 'total outstanding', 'totaloutstanding'],
} as const;

/** Column aliases of the record's transaction list, most specific first — both caption spellings. */
const TRANSACTION_COLUMNS = {
  date: ['date', 'transaction date', 'transactiondate'],
  type: ['type', 'transaction type', 'transactiontype'],
  amount: ['amount'],
  outstandingBalance: ['outstanding', 'loan balance', 'loanbalance', 'outstanding balance'],
} as const;

/**
 * Renders an argument a caller passed, for an error message. A string is quoted so a value that is
 * blank, or that carries a separator, is visible in the message. Internal to this module.
 *
 * @param value The argument as it arrived.
 */
function describeArgument(value: number | string): string {
  return typeof value === 'number' ? String(value) : JSON.stringify(value);
}

/**
 * Renders the options a select offers — each one's label with the id it carries — so an error message
 * about a label or an id that is missing names what the screen does offer. Internal to this module.
 *
 * @param options The options the select rendered.
 */
function describeOptions(options: readonly RenderedOption[]): string {
  if (options.length === 0) {
    return 'no options at all';
  }
  return options
    .map((option) => `"${option.label}" (id ${option.value.length > 0 ? option.value : 'none'})`)
    .join(', ');
}

/**
 * Renders a route argument as the single segment a hash route may carry, and rejects what could not be
 * one. Internal to this module.
 *
 * A guard, never an assertion: it protects the caller from driving a route it did not name — an empty
 * id, a non-finite number, or a value carrying `/`, `?` or `#`, each of which would address a
 * different route than the one asked for. Nothing about the application or its behaviour is checked.
 *
 * @param value Client or loan id the caller supplied.
 * @param role What the value names, used in the error message.
 * @returns The segment text.
 * @throws When the value is empty, is not a finite number, or carries a route separator.
 */
function requireRouteId(value: number | string, role: string): string {
  const text = (typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value).trim();
  if (text.length === 0) {
    throw new Error(`${role} must be a non-empty id; received ${describeArgument(value)}`);
  }
  if (/[/?#]/.test(text)) {
    throw new Error(`${role} must be a single route segment; received ${describeArgument(value)}`);
  }
  return text;
}

/**
 * Narrows an action to the six segments this object serves. Internal to this module.
 *
 * The union already guarantees this at compile time; the check is the run-time half of the same guard,
 * so a caller reaching the class from plain JavaScript cannot navigate to a segment whose screen this
 * object does not know. A typo fails here, loudly, instead of landing on a route the application
 * renders as not found.
 *
 * @param action The action a caller supplied.
 * @returns The same action, narrowed.
 * @throws When the action is not one of the six segments.
 */
function requireLoanAction(action: LoanAction): LoanAction {
  if (!LOAN_ACTIONS.includes(action)) {
    throw new Error(
      `the loan action must be one of ${LOAN_ACTIONS.join(', ')}; received ${describeArgument(action)}`,
    );
  }
  return action;
}

/**
 * Renders a date argument as the `yyyy-mm-dd` a native date control accepts, and rejects anything
 * else. Internal to this module.
 *
 * This checks the caller's own input, never the application: the object may not compute, shift or
 * reformat a date, because every date the harness types must be the run date derived from the tenant
 * business date (Rule 1 clause 2, AAP 0.10.1). A value in another form would be silently dropped by
 * the control and would post the date the screen pre-filled, so it fails here instead.
 *
 * @param value Date text the caller supplied.
 * @param field What the value is for, used in the error message.
 * @returns The date text, trimmed.
 * @throws When the value is not `yyyy-mm-dd`.
 */
function requireDateValue(value: string, field: string): string {
  const text = String(value).trim();
  if (!DATE_ONLY_PATTERN.test(text)) {
    throw new Error(
      `${field} takes a date as yyyy-mm-dd, from the run date read over the API; received ${describeArgument(value)}`,
    );
  }
  return text;
}

/**
 * Parses a rendered amount or balance into a number, keeping every digit the screen printed.
 * Internal to this module.
 *
 * The parse rule: everything that is not a digit, a `.` or a `-` is dropped — thousands separators,
 * ordinary and non-breaking spaces, and any currency or sign glyph — and what remains is read as a
 * number. A cell with no digit at all answers `null` rather than `0`, because `Number('')` is `0` and
 * a figure the screen never printed would otherwise compare equal to a real zero balance. The raw
 * cell text stays available in each row's `cells`, so a spec can compare text when a locale groups or
 * rounds a figure differently; normalisation belongs to the capture and the report (AAP 0.10.2), not
 * to this reader.
 *
 * @param text A cell as the screen rendered it.
 * @returns The value, or `null` when the cell carries no figure.
 */
function toAmount(text: string): number | null {
  const stripped = text.replace(/[^0-9.-]/g, '');
  if (!/[0-9]/.test(stripped)) {
    return null;
  }
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parses a rendered period number, which is a whole count rather than a figure. Internal to this
 * module.
 *
 * @param text A cell as the screen rendered it.
 * @returns The whole number, or `null` when the cell carries none.
 */
function toWholeNumber(text: string): number | null {
  const parsed = toAmount(text);
  return parsed === null ? null : Math.trunc(parsed);
}

/**
 * Locates a column by the captions above it. Internal to this module.
 *
 * @param columns The grid's header texts, as {@link readGridInPage} normalised them.
 * @param aliases Candidate captions for the column, most specific first.
 * @returns The column's position, or `-1` when the grid carries no such column.
 */
function columnIndex(columns: readonly string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const index = columns.indexOf(alias);
    if (index >= 0) {
      return index;
    }
  }
  return -1;
}

/**
 * Reads one cell by column position, answering an empty string for a column the grid does not carry.
 * Internal to this module.
 *
 * @param cells One data row as the page serialised it.
 * @param index The column's position, as {@link columnIndex} resolved it.
 */
function cellAt(cells: readonly string[], index: number): string {
  return index >= 0 ? (cells[index] ?? '') : '';
}

/**
 * Runs inside the page: every `<option>` of a select as `{ value, label }`, both trimmed, in document
 * order. A locator that resolved to something other than a `<select>` yields an empty list rather
 * than a dump of some other control.
 *
 * Self-contained on purpose: Playwright serialises this function's source and evaluates it in the
 * page, where no module-scope binding of this file exists.
 *
 * @param element The element the locator resolved to.
 */
function readSelectOptions(element: HTMLElement): RenderedOption[] {
  if (!(element instanceof HTMLSelectElement)) {
    return [];
  }
  const options: RenderedOption[] = [];
  for (const option of Array.from(element.options)) {
    options.push({
      index: option.index,
      value: option.value.trim().replace(/^\d+:\s*/, ''),
      label: (option.textContent ?? '').trim(),
    });
  }
  return options;
}

/**
 * Runs inside the page: the loan record's status colour class and its summary label/value rows.
 *
 * The status is read from the class list of the swatch element and never from text, because the record
 * paints a colour with no word beside it (AAP 0.10.5 item 11). The rows are the `#loan-summary` block's
 * key-and-value pairs, in document order: each row is two columns, the first holding the bold key and
 * the second its figure, and a figure the payload did not report renders an empty cell and therefore
 * an empty string. When the block is absent the whole record is scanned for the same shape, so a
 * record whose markup differs still reports its fields rather than nothing.
 *
 * Self-contained on purpose: see {@link readSelectOptions}.
 *
 * @param root The `app-loan-view` element.
 */
function readSummaryInPage(root: HTMLElement): LoanSummaryView {
  let statusClass = '';
  const swatch = root.querySelector('.status-swatch');
  if (swatch !== null) {
    for (const token of (swatch.getAttribute('class') ?? '').split(/\s+/)) {
      if (/^status-(?:active|pending|closed|other)$/.test(token)) {
        statusClass = token;
        break;
      }
    }
  }

  const block = root.querySelector('#loan-summary') ?? root;
  const fields: LabelValue[] = [];
  for (const row of Array.from(block.querySelectorAll('.row'))) {
    const key = row.querySelector('.value-key');
    if (key === null) {
      continue;
    }
    const value = key.parentElement === null ? null : key.parentElement.nextElementSibling;
    fields.push({
      label: (key.textContent ?? '').trim(),
      value: (value?.textContent ?? '').trim(),
    });
  }

  return { statusClass, fields };
}

/**
 * Runs inside the page: the first table of a section as its header texts and its data rows.
 *
 * Header cells are lower-cased with every run of non-alphanumeric characters collapsed to one space,
 * so `From Date:` and `from date` are the same caption to the readers that map a column by its name. A
 * section with no table answers `null`, which is what an empty state looks like from here.
 *
 * Self-contained on purpose: see {@link readSelectOptions}.
 *
 * @param root The section's root element.
 */
function readGridInPage(root: HTMLElement): TableGrid | null {
  const table = root.querySelector('table');
  if (table === null) {
    return null;
  }

  // The normalisation is written out at each use rather than held in a local function: the whole
  // function is serialised into the page, where a bundler-inserted name helper would be undefined.
  const columns: string[] = [];
  for (const header of Array.from(table.querySelectorAll('thead th'))) {
    columns.push(
      (header.textContent ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim(),
    );
  }

  const rows: string[][] = [];
  for (const row of Array.from(table.querySelectorAll('tbody tr'))) {
    const cells: string[] = [];
    for (const cell of Array.from(row.querySelectorAll('td'))) {
      cells.push((cell.textContent ?? '').trim());
    }
    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return { columns, rows };
}

/**
 * Drives the new Angular application's individual-loan screens and reads what they render: the
 * `next` side of workflows W4, W5, W6 and W7 (AAP 0.10.1). One instance per Playwright page,
 * constructed with the page the spec has already authenticated on — this class never logs in,
 * never reads a credential and never touches the session storage (Rule 1 clause 9).
 *
 * A caller walks a workflow in the order the screens allow, and every step is one public method:
 *
 * 1. {@link selectProduct} on the application screen the client record's "New Loan" action opens,
 *    {@link fillApplication} for the terms, {@link previewSchedule} and {@link readPreviewRows} for
 *    W4's evidence, then {@link submitApplication}.
 * 2. {@link openAction} with `approve`, {@link fillActionForm} and {@link submitAction}; the same
 *    triple with `disburse`. Each successful submit returns the router to `#/viewloanaccount/{id}`,
 *    whose id the caller reads from the URL — generated ids are compared by their role in the sequence
 *    (AAP 0.10.2), never by a value invented here.
 * 3. {@link openView}, {@link readSummary}, {@link readScheduleRows} and {@link readTransactions}
 *    for the verdict, {@link readEmptyStates} for a section that has no rows yet.
 * 4. {@link openRepayment}, {@link fillRepayment} and {@link submitRepayment} for W6.
 *
 * Which lifecycle step is legal at any moment is Fineract's decision, not this object's: no step is
 * reordered, gated or skipped here, and a step the server refuses leaves Fineract's own message in the
 * screen for the spec to compare (Rule 1 clause 3).
 */
export class LoansPage {
  /**
   * @param page The Playwright page the spec has already authenticated on.
   */
  constructor(private readonly page: Page) {}

  /**
   * Chooses the loan product by its visible label, case-insensitively.
   *
   * The product decides which Fineract template the terms below come from, so the option is matched and
   * a miss is reported rather than tolerated: a caller that proceeded on the wrong product would post a
   * different body than W4 states. The control is the native `<select>` the shared select field renders
   * — the application's own replacement for the widget the legacy screen loaded (AAP 0.10.5 item 2) —
   * resolved by id first and by its caption second, and picked by the option's own index so no value
   * stringification stands between the label a caller names and the option the browser selects.
   *
   * @param name Visible label of the product, e.g. `Parity Loan` (AAP 0.10.1).
   * @throws When the label is blank, or when no option of the select carries it within
   * {@link TEMPLATE_TIMEOUT_MS} — the message lists the labels the select does offer.
   */
  async selectProduct(name: string): Promise<void> {
    const wanted = name.trim();
    if (wanted.length === 0) {
      throw new Error('selectProduct() needs the visible label of a loan product; received a blank name');
    }

    const root = await this.awaitRoot(APPLICATION_ROOT);
    const select = await this.resolveField(
      root,
      [
        `#${APPLICATION_FIELDS.productId.ids[0]}`,
        '.form-group:has(label:text-matches("product", "i")) select.form-control',
        'select.form-control',
      ],
      APPLICATION_FIELDS.productId.description,
    );

    const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const option = select.locator(`option:text-matches("^\\s*${escaped}\\s*$", "i")`).first();
    try {
      await option.waitFor({ state: 'attached', timeout: TEMPLATE_TIMEOUT_MS });
    } catch {
      const offered = await select.evaluate(readSelectOptions);
      throw new Error(
        `the loan product select offers no option labelled ${JSON.stringify(wanted)}; ` +
          `it offers ${describeOptions(offered)}`,
      );
    }

    const index = await option.evaluate((element: Element): number => (element as HTMLOptionElement).index);
    await select.selectOption({ index });
    await this.awaitTemplateApplied(root);
  }

  /**
   * Fills the application values the caller states, and only those.
   *
   * Serves the terms step of W4 and is the surface W7 is driven through (AAP 0.7.2
   * `LoanApplicationRequest`). A member the caller omits keeps the value the Fineract template
   * supplied, so the screen's own defaults are what gets posted. The product is selected before the
   * terms, because choosing a product re-reads the template and would otherwise overwrite them.
   *
   * Nothing is rounded, clamped or bounded: the principal is typed exactly as the caller supplies it,
   * because a different value here would be a different body than the workflow states, and W7 depends
   * on an out-of-range figure reaching Fineract so that the server's own rejection is what the screen
   * shows (Rule 1 clause 3). Dates are the caller's `yyyy-mm-dd` strings and are never computed,
   * shifted or reformatted (Rule 1 clause 2).
   *
   * @param values The values to enter; anything omitted keeps what the screen rendered.
   * @throws When a supplied date is not `yyyy-mm-dd`, or when a control the values name is not on the
   * screen — the message lists the selectors tried.
   */
  async fillApplication(values: LoanApplicationValues): Promise<void> {
    const root = await this.awaitRoot(APPLICATION_ROOT);

    if (values.productId !== undefined) {
      await this.fillField(root, APPLICATION_FIELDS.productId, values.productId);
      await this.awaitTemplateApplied(root);
    }

    const terms = APPLICATION_FIELD_ORDER.filter((key) => key !== 'productId');
    await this.fillFields(root, APPLICATION_FIELDS, terms, values);
  }

  /**
   * Asks the application screen to calculate the repayment schedule, and waits for it to paint.
   *
   * Serves W4's preview step. Nothing navigates: the calculation is a request whose answer the screen
   * renders in place, so no URL change is awaited. The trigger is clicked once and never retried — the
   * calculation is a request, and a second click would send a second one.
   *
   * @throws When the screen renders no preview control, or when the preview paints no period row
   * within {@link TEMPLATE_TIMEOUT_MS} — a refusal is reported by the screen's own error region, which
   * the spec reads through the application screen's alert.
   */
  async previewSchedule(): Promise<void> {
    const root = await this.awaitRoot(APPLICATION_ROOT);
    const labelled = root.locator('.btn.btn-primary').filter({ hasText: /preview/i }).first();
    const candidate = (await labelled.count()) > 0
      ? labelled
      : root.locator('.btn.btn-primary').filter({ hasNotText: /submit/i }).first();
    if ((await candidate.count()) === 0) {
      throw new Error(
        'the loan application screen renders no preview control, so the schedule was not calculated',
      );
    }
    await candidate.click();

    const rows = this.page.locator(`${PREVIEW_ROOT} tbody tr`);
    try {
      await rows.first().waitFor({ state: 'attached', timeout: TEMPLATE_TIMEOUT_MS });
    } catch {
      throw new Error(
        `the repayment preview painted no schedule row within ${TEMPLATE_TIMEOUT_MS} ms; ` +
          'the screen keeps its calculation error in its own alert region',
      );
    }
  }

  /**
   * Reads the repayment-schedule preview the screen calculated, one row per period.
   *
   * Serves the evidence W4 records before it submits (AAP 0.10.1): the number of periods and the first
   * period's total due. Figures are the server's own, parsed by {@link toAmount}; nothing is summed,
   * rounded or recomputed here, and each row also carries its raw cell texts (AAP 0.10.2).
   *
   * A preview that has not been calculated renders the explicit empty state and no table (AAP 0.7.4),
   * which answers an empty list rather than raising.
   */
  async readPreviewRows(): Promise<readonly RepaymentPreviewRow[]> {
    const grid = await this.readGridOf(PREVIEW_ROOT, null);
    if (grid === null) {
      return [];
    }

    const period = columnIndex(grid.columns, SCHEDULE_COLUMNS.period);
    const fromDate = columnIndex(grid.columns, SCHEDULE_COLUMNS.fromDate);
    const dueDate = columnIndex(grid.columns, SCHEDULE_COLUMNS.dueDate);
    const principalDue = columnIndex(grid.columns, SCHEDULE_COLUMNS.principalDue);
    const interestDue = columnIndex(grid.columns, SCHEDULE_COLUMNS.interestDue);
    const feesDue = columnIndex(grid.columns, SCHEDULE_COLUMNS.feesDue);
    const totalDue = columnIndex(grid.columns, SCHEDULE_COLUMNS.totalDue);
    const outstanding = columnIndex(grid.columns, SCHEDULE_COLUMNS.outstanding);

    return grid.rows.map((cells) => ({
      period: toWholeNumber(cellAt(cells, period)),
      fromDate: cellAt(cells, fromDate),
      dueDate: cellAt(cells, dueDate),
      principalDue: toAmount(cellAt(cells, principalDue)),
      interestDue: toAmount(cellAt(cells, interestDue)),
      feesDue: toAmount(cellAt(cells, feesDue)),
      totalDue: toAmount(cellAt(cells, totalDue)),
      outstanding: toAmount(cellAt(cells, outstanding)),
      cells,
    }));
  }

  /**
   * Submits the application exactly once.
   *
   * The loan-creating step of W4. Fineract loan submission is not idempotent, so the primary submit is
   * clicked once and the method never retries it: the screen disables that control while its request is
   * in flight, and a second click here would defeat the protection the workflow measures.
   *
   * The method returns `void` and reads nothing back. On success the router navigates to
   * `#/viewloanaccount/{id}`, whose id the caller takes from the URL or from the state snapshot, since
   * generated ids are compared by their role in the sequence and never asserted literally (AAP 0.10.2).
   * On a refusal the screen stays where it is and renders Fineract's message — W7's case — so no
   * navigation is awaited here.
   *
   * @throws When the screen renders no submit control.
   */
  async submitApplication(): Promise<void> {
    const root = await this.awaitRoot(APPLICATION_ROOT);
    const typed = root.locator('button[type="submit"]').first();
    if ((await typed.count()) > 0) {
      await typed.click();
      return;
    }
    const labelled = root.locator('.btn.btn-primary').filter({ hasText: /submit/i }).first();
    if ((await labelled.count()) > 0) {
      await labelled.click();
      return;
    }
    throw new Error(
      'the loan application screen renders no submit control, so the application was not sent',
    );
  }

  /**
   * Opens the loan record.
   *
   * Serves the read-back step of W5 and W6 over `#/viewloanaccount/:id` (AAP 0.8.2), where the one read
   * carries the status, the summary figures, the repayment schedule, the transactions and the charges
   * together (AAP 0.7.3 rows "W5 approve and disburse" and "W6 repayment"). The record's root is
   * awaited, and that root only takes height once the response has painted, so a reader called next
   * sees the record rather than an empty page. A loan that does not exist renders the not-found message
   * in place of the record (AAP 0.7.4): the root is still there, and the readers then report what that
   * card renders instead of raising.
   *
   * @param loanId Fineract loan id, e.g. the id the record's URL carried after the application was
   * submitted.
   * @throws When the id is empty or would address more than one route segment.
   */
  async openView(loanId: number | string): Promise<void> {
    const id = requireRouteId(loanId, 'the loan id');
    await this.navigate(`/viewloanaccount/${id}`);
    await this.awaitRecordSettled();
  }

  /**
   * Reads the record's status colour class and its summary label/value rows.
   *
   * Serves the comparison of W5's end state (AAP 0.10.1): the loan's total, its outstanding balance and
   * its principal, interest and fee balances are the figures the report measures once the loan is
   * approved, disbursed and repaid. Values are exactly as the screen renders them, grouping and
   * decimals included — nothing is recomputed from the schedule and no currency is added — and a figure
   * the payload did not report reports an empty string. The status is a colour class and never a word
   * (AAP 0.10.5 item 11).
   *
   * A record that does not exist answers the not-found card's own content rather than raising, because
   * that card is a legitimate rendering of the route (AAP 0.7.4). Only the record element itself being
   * absent is an error, and it names `app-loan-view` so the caller knows to navigate first.
   *
   * @throws When the loan record is not on the page.
   */
  async readSummary(): Promise<LoanSummaryView> {
    const root = this.page.locator(VIEW_ROOT).first();
    if ((await root.count()) === 0) {
      throw new Error(
        `the loan record is not on the page: no ${VIEW_ROOT} element. Open it with openView() first.`,
      );
    }
    await this.awaitRecordSettled();
    return root.evaluate(readSummaryInPage);
  }

  /**
   * Reads the record's repayment-schedule section, one row per period.
   *
   * The schedule is the source W6 derives its repayment amount from — the first period's total due —
   * so the rows keep the server's order and their own figures. The server's schedule opens with the
   * disbursement period, which carries no period number and no principal, so a caller that wants the
   * first repayment period selects the first row whose `period` is not `null` rather than the first
   * row. The section is revealed through its own tab when another tab of the record is showing, and a
   * section with no rows answers an empty list rather than raising: the record opens on this tab, so a
   * caller normally finds it already painted.
   */
  async readScheduleRows(): Promise<readonly LoanScheduleRow[]> {
    const grid = await this.readGridOf(SCHEDULE_ROOT, /repayment/i);
    if (grid === null) {
      return [];
    }

    const period = columnIndex(grid.columns, SCHEDULE_COLUMNS.period);
    const fromDate = columnIndex(grid.columns, SCHEDULE_COLUMNS.fromDate);
    const dueDate = columnIndex(grid.columns, SCHEDULE_COLUMNS.dueDate);
    const totalDue = columnIndex(grid.columns, SCHEDULE_COLUMNS.totalDue);
    const outstanding = columnIndex(grid.columns, SCHEDULE_COLUMNS.outstanding);

    return grid.rows.map((cells) => ({
      period: toWholeNumber(cellAt(cells, period)),
      fromDate: cellAt(cells, fromDate),
      dueDate: cellAt(cells, dueDate),
      totalDue: toAmount(cellAt(cells, totalDue)),
      outstanding: toAmount(cellAt(cells, outstanding)),
      cells,
    }));
  }

  /**
   * Reads the record's transaction list, one row per transaction.
   *
   * Serves the transaction half of W6's verdict (AAP 0.10.1): after the repayment the list must carry
   * the new transaction and the balance it left. Rows keep the server's order and their own type text,
   * which is Fineract's label and is therefore never translated. The section is revealed through its
   * own tab when another tab is showing.
   *
   * A loan with no transactions renders the explicit empty state and no table (AAP 0.7.4), and a record
   * that does not exist renders the not-found message; both answer an empty list rather than raising.
   */
  async readTransactions(): Promise<readonly LoanTransactionRow[]> {
    const grid = await this.readGridOf(TRANSACTIONS_ROOT, /transactions/i);
    if (grid === null) {
      return [];
    }

    const date = columnIndex(grid.columns, TRANSACTION_COLUMNS.date);
    const type = columnIndex(grid.columns, TRANSACTION_COLUMNS.type);
    const amount = columnIndex(grid.columns, TRANSACTION_COLUMNS.amount);
    const outstandingBalance = columnIndex(grid.columns, TRANSACTION_COLUMNS.outstandingBalance);

    return grid.rows.map((cells) => ({
      date: cellAt(cells, date),
      type: cellAt(cells, type),
      amount: toAmount(cellAt(cells, amount)),
      outstandingBalance: toAmount(cellAt(cells, outstandingBalance)),
      cells,
    }));
  }

  /**
   * Reads the message of every explicit empty state currently visible, in document order.
   *
   * This is how a spec proves AAP 0.7.4's "an explicit empty state and no error" for a list that has no
   * rows — the loan record's transactions and charges are two of the four surfaces the plan names. An
   * empty array means the screen is showing no empty state at all, which is what a section with rows
   * looks like from here.
   */
  async readEmptyStates(): Promise<readonly string[]> {
    const hosts = await this.page.locator('app-empty-state').all();
    const messages: string[] = [];
    for (const host of hosts) {
      if (!(await host.isVisible())) {
        continue;
      }
      messages.push(((await host.textContent()) ?? '').trim());
    }
    return messages;
  }

  /**
   * Opens one of the six lifecycle action screens.
   *
   * Serves the approve, undo-approval, reject, disburse and undo-disbursal steps of W5 and the
   * repayment step of W6 over `#/loanaccount/:id/:action` (AAP 0.8.2). The segment is navigated exactly
   * as the URL spells it: the screen owns the mapping from a segment to a Fineract command, and this
   * object neither sends a command nor rewrites one. The `repayment` segment renders the repayment form
   * inside the action screen, so {@link openRepayment} reaches the same screen by the same route.
   *
   * Each mode renders only the controls its command carries: approve and reject a date, disburse a date
   * and an amount, undo-approval a note, undo-disbursal no control at all.
   *
   * @param loanId Fineract loan id the action applies to.
   * @param action One of the six segments {@link LoanAction} allows.
   * @throws When the id is empty or would address more than one route segment, or when the action is
   * not one of the six segments.
   */
  async openAction(loanId: number | string, action: LoanAction): Promise<void> {
    const id = requireRouteId(loanId, 'the loan id');
    const segment = requireLoanAction(action);
    await this.navigate(`/loanaccount/${id}/${segment}`);
    await this.awaitRoot(ACTION_ROOT);
  }

  /**
   * Fills the values the open action form is to send, and only those.
   *
   * Serves the dated approve, reject and disburse steps of W5 (AAP 0.7.2 `LoanActionRequest`). A member
   * the caller omits keeps the value the screen rendered — the approved amount and the disbursed amount
   * are seeded from the loan's own templates, so those defaults are what gets posted — and
   * `fillActionForm({})` therefore does nothing at all, which is what the two control-free commands
   * need.
   *
   * Nothing is rounded, clamped or bounded, and no date is computed (Rule 1 clauses 2 and 3). The
   * approved amount resolves through the id the template ships, `approvedLoanAmount`, before the
   * plan's own member name, because the application names that control after the member the fork
   * accepts on the command.
   *
   * @param values The values to enter; anything omitted keeps what the screen rendered.
   * @throws When a supplied date is not `yyyy-mm-dd`, or when a control the values name is not rendered
   * by the open mode — the repayment form is filled by its own method.
   */
  async fillActionForm(values: LoanActionValues): Promise<void> {
    const root = await this.awaitRoot(ACTION_ROOT);
    await this.fillFields(root, ACTION_FIELDS, ACTION_FIELD_ORDER, values);
  }

  /**
   * Submits the open action form exactly once.
   *
   * Finishes the approve, undo-approval, reject, disburse or undo-disbursal step of W5. None of those
   * commands is idempotent, so the primary control is clicked once and the method never retries: the
   * screen disables it while its request is in flight, and a second click would defeat exactly the
   * protection W5 measures — one POST per action. On success the router returns to
   * `#/viewloanaccount/{id}`, so this method returns `void` and the caller re-reads the record.
   *
   * @throws When the screen renders no primary control.
   */
  async submitAction(): Promise<void> {
    await this.clickPrimary(ACTION_ROOT);
  }

  /**
   * Opens the repayment form.
   *
   * Serves W6 over `#/loanaccount/:id/repayment` (AAP 0.8.2): the `repayment` segment of the action
   * route, whose screen renders the repayment form inside the action screen's own card. The repayment
   * root is awaited, which is the readiness signal for that form.
   *
   * @param loanId Fineract loan id the repayment is booked against.
   * @throws When the id is empty or would address more than one route segment.
   */
  async openRepayment(loanId: number | string): Promise<void> {
    const id = requireRouteId(loanId, 'the loan id');
    await this.navigate(`/loanaccount/${id}/repayment`);
    await this.awaitRoot(REPAYMENT_ROOT);
  }

  /**
   * Fills the values the repayment form is to send, and only those.
   *
   * Serves W6 (AAP 0.7.2 `LoanRepaymentRequest`). The amount is deliberately left alone when the caller
   * omits it: the screen seeds it from the repayment transaction template, and the workflow defines the
   * repayment as the first schedule period's total due, so the screen's own pre-filled figure is what
   * must be posted. This object never fills a default of its own, because that value is the comparison.
   *
   * Nothing is rounded, clamped or bounded, and the date is the caller's own `yyyy-mm-dd` string
   * (Rule 1 clauses 2 and 3).
   *
   * @param values The values to enter; anything omitted keeps what the screen rendered.
   * @throws When a supplied date is not `yyyy-mm-dd`, or when a control the values name is not on the
   * screen — the message lists the selectors tried.
   */
  async fillRepayment(values: LoanRepaymentValues): Promise<void> {
    const root = await this.awaitRoot(REPAYMENT_ROOT);
    await this.fillFields(root, REPAYMENT_FIELDS, REPAYMENT_FIELD_ORDER, values);
  }

  /**
   * Submits the repayment exactly once.
   *
   * Finishes W6. A repayment is not idempotent, so the primary control is clicked once and never
   * retried; on success the router returns to `#/viewloanaccount/{id}`, so the caller re-reads the
   * record with {@link openView}, {@link readTransactions} and {@link readSummary}.
   *
   * @throws When the form renders no primary control.
   */
  async submitRepayment(): Promise<void> {
    await this.clickPrimary(REPAYMENT_ROOT);
  }

  /**
   * The absolute URL of one screen, carrying both query parameters Rule 2 requires.
   *
   * A bare `page.goto('#/viewloanaccount/7')` would be resolved against the browser's `baseURL` and
   * would therefore drop `baseApiUrl` and `tenantIdentifier`, leaving the application on the backend
   * its build configured rather than the one this run must address — and without them the entry could
   * not select the tenant either. Composing the whole URL for every navigation is what keeps the two
   * environments identical apart from their variables (AAP 0.4.4 decision 5, Rule 2).
   *
   * @param route Hash route to land on, starting with `/`.
   */
  private screenUrl(route: string): string {
    return `${NEXT_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}&tenantIdentifier=${TENANT_ID}#${route}`;
  }

  /**
   * Navigates to a hash route on the full entry URL.
   *
   * The navigation is confirmed against `window.location.hash` rather than trusted: when the router has
   * not applied the fragment — a document that was already open, or a redirect that ran first — the
   * hash is set in the page as the second way to ask it. Nothing beyond that is awaited here; the
   * caller awaits its own screen's root, which is the readiness signal that belongs to the screen.
   *
   * @param route Hash route the screen sits on, starting with `/`.
   */
  private async navigate(route: string): Promise<void> {
    await this.page.goto(this.screenUrl(route));
    const applied = await this.page.evaluate(
      (hint: string): boolean => window.location.hash === `#${hint}`,
      route,
    );
    if (!applied) {
      await this.page.evaluate((hint: string): void => {
        window.location.hash = hint;
      }, route);
    }
  }

  /**
   * Waits until the loan record has painted its content, or has reported why it cannot.
   *
   * The record's root is on the page from the moment the route activates and the card inside it is
   * empty until the record's one read answers, so waiting for the root alone would let a reader report
   * an empty record as a real one. Readiness is therefore the summary block the record paints once it
   * holds a loan, or the message that replaces it: Fineract's own text for a 4xx, the not-found sentence
   * for a loan the server does not have, and a raised notification for a 5xx or a transport failure,
   * which the interceptor reports and the record itself does not repaint (AAP 0.7.4).
   *
   * Each of the three record states carries an id of its own — `loan-summary`, `loan-view-error` and
   * `loan-view-not-found` — so the wait names them first and keeps the Bootstrap and muted-text classes
   * beside them as fallbacks, in case a record renders a state without the hook.
   *
   * @returns The record's root locator.
   * @throws When the record has neither painted nor reported a failure within {@link SCREEN_TIMEOUT_MS}.
   */
  private async awaitRecordSettled(): Promise<Locator> {
    const view = await this.awaitRoot(VIEW_ROOT);
    const settled = this.page
      .locator(
        `${VIEW_ROOT} #loan-summary, ${VIEW_ROOT} #loan-view-error, ${VIEW_ROOT} #loan-view-not-found, ` +
          `${VIEW_ROOT} .alert.alert-danger, ${VIEW_ROOT} .text-center.text-muted, ` +
          `.notification-container .notification`,
      )
      .first();
    try {
      await settled.waitFor({ state: 'attached', timeout: SCREEN_TIMEOUT_MS });
    } catch {
      throw new Error(
        `the loan record (${VIEW_ROOT}) neither painted its summary nor reported a failure within ` +
          `${SCREEN_TIMEOUT_MS} ms`,
      );
    }
    return view;
  }

  /**
   * Waits for a screen's root element to paint, and reports the hash it settled on when it does not.
   *
   * @param rootSelector Root element of the screen.
   * @returns The root's locator, ready for a caller to read from.
   * @throws When the root has not painted within {@link SCREEN_TIMEOUT_MS}.
   */
  private async awaitRoot(rootSelector: string): Promise<Locator> {
    const root = this.page.locator(rootSelector).first();
    const description = SCREENS[rootSelector] ?? rootSelector;
    try {
      await root.waitFor({ state: 'visible', timeout: SCREEN_TIMEOUT_MS });
    } catch {
      const hash = await this.page
        .evaluate((): string => window.location.hash)
        .catch((): string => '');
      throw new Error(
        `${description} (${rootSelector}) did not paint within ${SCREEN_TIMEOUT_MS} ms; ` +
          `the page is at ${hash.length > 0 ? hash : 'no hash at all'}`,
      );
    }
    return root;
  }

  /**
   * Resolves a control through an ordered chain of selectors and waits for it to be usable.
   *
   * The chain is the point: the first selector is the id the template ships and the last is a
   * caption-based fallback, so a caption that translates differently degrades to a structural match
   * instead of failing on text alone.
   *
   * @param root The screen's root locator, so a chain cannot resolve a control on another screen.
   * @param selectors Candidate selectors, relative to the root and most specific first.
   * @param description What the control is, used in the error message.
   * @returns The first candidate that resolves, as a locator awaiting its own visibility.
   * @throws When no candidate resolves, naming every selector tried.
   */
  private async resolveField(
    root: Locator,
    selectors: readonly string[],
    description: string,
  ): Promise<Locator> {
    for (const selector of selectors) {
      const candidate = root.locator(selector).first();
      if ((await candidate.count()) > 0) {
        await candidate.waitFor({ state: 'visible', timeout: SCREEN_TIMEOUT_MS });
        return candidate;
      }
    }
    throw new Error(`the ${description} is not on the screen; tried ${selectors.join(' | ')}`);
  }

  /**
   * Clicks a screen's primary submit exactly once.
   *
   * Three candidates, in order: the Bootstrap primary button that submits a form, then any primary
   * control — the control-free confirmation submits through a plain button — then the form's own
   * `type="submit"`. No retry of any kind: a retried click would send a second request to an endpoint
   * that is not idempotent, which is the behaviour W5 measures.
   *
   * @param rootSelector Root element of the screen that owns the control.
   * @throws When the screen renders no primary control.
   */
  private async clickPrimary(rootSelector: string): Promise<void> {
    const root = await this.awaitRoot(rootSelector);
    const chain = [
      'button.btn.btn-primary[type="submit"]',
      '.btn.btn-primary',
      'button[type="submit"]',
    ];
    for (const selector of chain) {
      const candidate = root.locator(selector).first();
      if ((await candidate.count()) > 0) {
        await candidate.click();
        return;
      }
    }
    throw new Error(
      `${SCREENS[rootSelector] ?? rootSelector} renders no primary control, so the request was not sent`,
    );
  }

  /**
   * Fills the values a caller supplied, in the order the form needs them filled.
   *
   * @param root The screen's root locator.
   * @param specs The control each member of the values shape resolves to.
   * @param order The order to fill them in, which for the application is product first.
   * @param values The values to enter; an omitted member is left untouched.
   */
  private async fillFields<K extends string>(
    root: Locator,
    specs: Readonly<Record<K, FieldSpec>>,
    order: readonly K[],
    values: Readonly<Partial<Record<K, number | string>>>,
  ): Promise<void> {
    for (const key of order) {
      const value = values[key];
      if (value === undefined) {
        continue;
      }
      await this.fillField(root, specs[key], value);
    }
  }

  /**
   * Fills one control with the value a caller supplied, exactly as supplied.
   *
   * A date is checked against the `yyyy-mm-dd` form a native control accepts before it is typed; a
   * select is answered by the option whose bound value matches the caller's id; anything else is typed
   * as text, with no rounding, clamping or reformatting of any kind (Rule 1 clauses 2 and 3).
   *
   * @param root The screen's root locator.
   * @param spec The control to fill.
   * @param value The value the caller supplied.
   * @throws When the control is not on the screen, a date is not `yyyy-mm-dd`, or a select offers no
   * option with the caller's id.
   */
  private async fillField(root: Locator, spec: FieldSpec, value: number | string): Promise<void> {
    const field = await this.resolveField(root, this.fieldSelectors(spec), spec.description);
    if (spec.kind === 'select') {
      await this.selectLogicalValue(field, spec, value);
      return;
    }
    if (spec.kind === 'date') {
      await field.fill(requireDateValue(String(value), spec.description));
      return;
    }
    await field.fill(String(value));
  }

  /**
   * Waits for the application form to finish applying the Fineract template a product choice started.
   *
   * The screen states that read by marking its body `aria-busy`, and its answer patches the form's
   * defaults in. A value typed while the read is still in flight would therefore be replaced by the
   * template's — which is why the product is selected, and this wait taken, before any term is typed.
   * A template that answers within the same change-detection turn never paints the marker, so a marker
   * that does not appear within {@link TEMPLATE_BUSY_GRACE_MS} leaves nothing to wait for.
   *
   * @param root The application screen's root locator.
   * @throws When the form is still reading its template after {@link TEMPLATE_TIMEOUT_MS}.
   */
  private async awaitTemplateApplied(root: Locator): Promise<void> {
    const busy = root.locator('.panel-body[aria-busy="true"]');
    const appeared = await busy
      .first()
      .waitFor({ state: 'attached', timeout: TEMPLATE_BUSY_GRACE_MS })
      .then(
        () => true,
        () => false,
      );
    if (!appeared) {
      return;
    }
    try {
      await busy.first().waitFor({ state: 'detached', timeout: TEMPLATE_TIMEOUT_MS });
    } catch {
      throw new Error(
        `the loan application form was still reading its Fineract template after ` +
          `${TEMPLATE_TIMEOUT_MS} ms, so its terms are not settled`,
      );
    }
  }

  /**
   * The selector chain for one control: each id the template may ship, then a caption-based fallback
   * that picks the control by the element type the member needs.
   *
   * @param spec The control to resolve.
   */
  private fieldSelectors(spec: FieldSpec): readonly string[] {
    const chain: string[] = spec.ids.map((id) => `#${id}`);
    const captioned = `.form-group:has(label:text-matches("${spec.label}", "i"))`;
    if (spec.kind === 'date') {
      chain.push(`${captioned} input[type="date"]`);
    } else if (spec.kind === 'select') {
      chain.push(`${captioned} select.form-control`);
    } else {
      chain.push(`${captioned} input.form-control`, `${captioned} textarea.form-control`);
    }
    return chain;
  }

  /**
   * Selects the option whose bound value is the id a caller supplied.
   *
   * The select is native (AAP 0.10.5 item 2) and its options are bound through `[ngValue]`, so the
   * option's DOM value is `${position}: ${id}` rather than the id itself: the option is matched on the
   * value the application bound, and the selection is then made by the option's position. The list is
   * empty for a moment after the form paints, because it comes from a Fineract template the screen
   * requests on entry, so the read is repeated for a bounded period rather than once.
   *
   * @param field The select to answer.
   * @param spec The control being filled, used in the error message.
   * @param value The id the caller supplied.
   * @throws When the select offers no option carrying that id within {@link TEMPLATE_TIMEOUT_MS} — the
   * message lists the options it does offer.
   */
  private async selectLogicalValue(
    field: Locator,
    spec: FieldSpec,
    value: number | string,
  ): Promise<void> {
    const wanted = String(value).trim();
    const attempts = Math.ceil(TEMPLATE_TIMEOUT_MS / OPTION_POLL_INTERVAL_MS);
    let offered = await field.evaluate(readSelectOptions);
    let match = offered.find((option) => option.value === wanted);
    for (let attempt = 1; match === undefined && attempt < attempts; attempt += 1) {
      await this.page.waitForTimeout(OPTION_POLL_INTERVAL_MS);
      offered = await field.evaluate(readSelectOptions);
      match = offered.find((option) => option.value === wanted);
    }

    if (match === undefined) {
      throw new Error(
        `the ${spec.description} offers no option with id ${describeArgument(value)}; ` +
          `it offers ${describeOptions(offered)}`,
      );
    }
    await field.selectOption({ index: match.index });
  }

  /**
   * Reads one section's first table as a grid, revealing the section first when another tab of the
   * record is showing.
   *
   * @param rootSelector Root element of the section.
   * @param tab Pattern of the tab that reveals the section, or `null` when the section is not tabbed.
   * @returns The grid the section rendered, or `null` when the section is absent or shows an empty
   * state.
   */
  private async readGridOf(rootSelector: string, tab: RegExp | null): Promise<TableGrid | null> {
    if (tab !== null) {
      await this.revealSection(rootSelector, tab);
    }
    const root = this.page.locator(rootSelector).first();
    if ((await root.count()) === 0) {
      return null;
    }
    return root.evaluate(readGridInPage);
  }

  /**
   * Brings a tabbed section of the loan record on screen by choosing its tab.
   *
   * The record paints exactly one of its three sections at a time, so a reader called for a section
   * another tab is showing must ask for that tab first. Nothing is requested by doing so — every
   * section renders a slice of the one payload the record already loaded — and a record that renders no
   * tab for the section is left alone, which is what a not-found or a section-free record looks like
   * from here.
   *
   * @param rootSelector Root element of the section that must appear.
   * @param tab Pattern of the caption of the tab that reveals it.
   * @throws When the section has neither painted nor shown an empty state after its tab was selected.
   */
  private async revealSection(rootSelector: string, tab: RegExp): Promise<void> {
    if ((await this.page.locator(rootSelector).count()) > 0) {
      return;
    }
    const view = this.page.locator(VIEW_ROOT).first();
    if ((await view.count()) === 0) {
      return;
    }
    await this.awaitRecordSettled();
    if ((await this.page.locator(rootSelector).count()) > 0) {
      return;
    }
    const trigger = view.locator('.nav-tabs a[role="tab"]').filter({ hasText: tab }).first();
    if ((await trigger.count()) === 0) {
      return;
    }
    await trigger.click();

    const ready = this.page.locator(`${rootSelector}, ${VIEW_ROOT} app-empty-state`).first();
    try {
      await ready.waitFor({ state: 'attached', timeout: SCREEN_TIMEOUT_MS });
    } catch {
      throw new Error(
        `${SCREENS[rootSelector] ?? rootSelector} (${rootSelector}) did not paint after its tab was ` +
          `selected within ${SCREEN_TIMEOUT_MS} ms`,
      );
    }
  }
}

