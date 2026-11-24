/**
 * The loans family's single model module: one typed model for every request body and every
 * response shape the individual-loan screens use, in Fineract's own wire field names.
 *
 * Field names are the contract (Rule 1 clause 2). A renamed member is a parity break, because the
 * new application must send the same body the legacy screens send, so nothing here is prettified:
 * `loanTermFrequency`, `interestCalculationPeriodType` and `transactionProcessingStrategyId` are
 * reproduced exactly as `GET /loans/template` and `GET /loans/{id}` name them (AAP 0.7.2, 0.7.3).
 *
 * Declaration only. This module carries no Angular decorator, no injected collaborator, no HTTP
 * call, no fixture and no `any` (Rule 1 clause 4): a payload member the plan does not model is
 * either a documented partial projection listing just the members a screen reads, or `unknown`.
 * The three functions at the end are pure — same input, same output, no clock read, no dependency
 * — so the types cost the loans feature's other files nothing to import.
 *
 * Dates never travel as formatted strings. A response date is a `FineractDateValue` (the
 * `'yyyy-MM-dd'` string or the `[year, month, day]` triple Fineract returns) and a screen reads it
 * with `fromFineractDate`; a request date is a `Date` and `loan.service.ts` writes it with
 * `toFineractDate` at the boundary, beside `dateFormat` and `locale` (AAP 0.7.2, "Date handling";
 * `shared/date-format.util.ts`).
 *
 * Two absences are deliberate and must stay. `principal` carries no minimum and no maximum,
 * because legacy adds none and workflow W7 depends on Fineract itself rejecting a principal above
 * the product's limit — a client-side bound would make that spec pass for the wrong reason
 * (Rule 1 clause 3). And no status model carries a label, because the indicator the design paints
 * is a colour and never a word (AAP 0.10.5 item 11).
 */
import type { FINERACT_DATE_FORMAT } from '../../core/config/app-config.model';
import type { StatusKey } from '../../shared/status-swatch/status-swatch.component';

/**
 * One row of a Fineract option list — `productOptions`, `loanOfficerOptions`, `fundOptions`,
 * `chargeOptions`, `paymentTypeOptions` — which all arrive in this `{id, name}` shape (AAP 0.4.3).
 *
 * `id` is numeric because every list the loans family renders is keyed by a Fineract entity id,
 * and `name` is the server's own text, rendered unchanged and in the received order (Rule 1
 * clause 3: no sorting, no relabelling, no client-side filtering of the options).
 */
export interface OptionItem {
  /** Identifier the posted body carries, e.g. the `chargeId` of a picked charge. */
  readonly id: number;

  /** Label exactly as the template endpoint returned it. */
  readonly name: string;
}

/**
 * The two shapes a Fineract date member takes in a response: `'2026-11-21'` in a record or a
 * template default, and `[2026, 11, 21]` in the business date. `fromFineractDate` accepts both,
 * so a model describes what the server sends instead of asserting one of the two.
 */
export type FineractDateValue = string | readonly number[];

/**
 * The two shapes an option-valued template member takes: the `{id, name}` object the template
 * returns for the choice it seeds (`transactionProcessingStrategy`), and the bare numeric id a
 * payload that only carries the choice sends instead. Both occur for the same field, which is why
 * the field is typed as the union and read through `optionId()` rather than cast at each call.
 */
export type OptionRef = OptionItem | number;

/**
 * A loan's lifecycle status as Fineract sends it: the numeric `LoanStatusType` id, its
 * `loanStatusType.*` message code, and the server's display text.
 *
 * The text is kept because it is part of the response, and it is never rendered: the indicator is
 * a colour (AAP 0.10.5 item 11), so screens pass `id` — or `code` — to `toStatusKey()`.
 */
export interface LoanStatus {
  /** Numeric `LoanStatusType` id, the value `toStatusKey()` maps. */
  readonly id: number;

  /** Message code such as `loanStatusType.active`, matched on its trailing segment. */
  readonly code: string;

  /** Server display text, carried for completeness and deliberately not shown. */
  readonly value: string;
}

/**
 * The five lifecycle commands the loan record's action endpoints take as `?command=`
 * (AAP 0.7.3, "W5 approve and disburse"). One command per request, so this union names the
 * endpoint's own vocabulary and nothing else.
 */
export type LoanCommand = 'approve' | 'undoapproval' | 'reject' | 'disburse' | 'undodisbursal';

/**
 * The two commands `POST /loans/{id}/charges/{chargeId}?command=` accepts (AAP 0.7.3,
 * "Loan charges").
 */
export type LoanChargeActionCommand = 'pay' | 'waive';

/**
 * A partial projection of the envelope every loan action POST returns: the affected entity's id
 * and the field changes the server applied.
 *
 * The endpoint returns the full loan record plus this envelope, and the action screens read only
 * these two members — enough to know the write landed before navigating back to the record. The
 * `changes` object is deliberately `unknown`-valued rather than modelled: no screen renders it,
 * and inventing its members would claim a shape the plan never verified (Rule 1 clause 4).
 */
export interface LoanActionResult {
  /** Id of the resource the action changed, when the server reports one. */
  readonly resourceId?: number;

  /** Field changes the server applied; read for presence only, never rendered. */
  readonly changes?: Readonly<Record<string, unknown>>;
}

/**
 * The product a loan is written against, as the template names it in `product` and in
 * `productOptions`. It is the selected product when read from `product` and one dropdown row when
 * read from `productOptions`.
 *
 * The form re-fetches the whole template when the product changes and re-seeds every field from
 * the top-level members of `LoanTemplate`, so nothing here is copied out of this object: the
 * top-level defaults are the ones the server computed for the selected product.
 */
export interface LoanTemplateProduct extends OptionItem {
  /** Currency of the product, as the template reports it for the loan currency field. */
  readonly currency?: {
    readonly code: string;
  };
}

/**
 * One row of the loan application's charge picker: an option of `charges` / `chargeOptions` with
 * the amount, currency, timing and calculation basis the server attached to it.
 *
 * The amount is optional because a charge whose amount it computes is returned without one; the
 * form then shows an empty amount field and posts what the user types rather than inventing a
 * value.
 */
export interface LoanChargeOption extends OptionItem {
  /** Amount the charge defaults to, when the server sends one. */
  readonly amount?: number;

  /** Currency the charge is denominated in. */
  readonly currency?: {
    readonly code: string;
  };

  /** When the charge falls due, e.g. disbursement or a specified date. */
  readonly chargeTimeType?: {
    readonly id: number;
    readonly value?: string;
  };

  /** How the charge amount is calculated, e.g. flat or a percentage of the principal. */
  readonly chargeCalculationType?: {
    readonly id: number;
    readonly value?: string;
  };

  /** Due date of a charge that carries one (a specified-due-date fee). */
  readonly dueDate?: FineractDateValue;
}

/**
 * `GET /loans/template?templateType=individual&clientId=&productId=` — the dropdown options and
 * the defaults the new-loan form is seeded from, and the same shape the edit form is seeded from
 * (AAP 0.7.3, "W4 loan application"; Rule 1 clause 3: every option list comes from the template
 * endpoint, never from a constant in this application).
 *
 * The numeric members are required only where the endpoint always seeds one. The rest are
 * optional because a template requested before a product is chosen legitimately omits them; an
 * absent default stays an empty field and posts nothing, rather than being filled in here.
 */
export interface LoanTemplate {
  /** Client the loan is opened for, echoed back from the request. */
  readonly clientId?: number;

  /** Client's display name, shown beside the application. */
  readonly clientName?: string;

  /** Office the client belongs to, which scopes the officer and fund lists. */
  readonly clientOfficeId?: number;

  /** The selected product. */
  readonly product: LoanTemplateProduct;

  /** Products the client may be given, rendered as the product dropdown. */
  readonly productOptions: readonly LoanTemplateProduct[];

  /** Default principal, typically the product's default principal. */
  readonly principal: number;

  /** Default term length, in `loanTermFrequencyType` units. */
  readonly loanTermFrequency: number;

  /** Unit of `loanTermFrequency`, e.g. months. */
  readonly loanTermFrequencyType?: number;

  /** Default number of repayments. */
  readonly numberOfRepayments: number;

  /** Default interval between repayments. */
  readonly repaymentEvery: number;

  /** Unit of `repaymentEvery`, e.g. months. */
  readonly repaymentFrequencyType?: number;

  /** Default nominal interest rate per `interestRateFrequencyType` period. */
  readonly interestRatePerPeriod: number;

  /** Unit of `interestRatePerPeriod`, e.g. per year. */
  readonly interestRateFrequencyType?: number;

  /** Amortisation method the product prescribes. */
  readonly amortizationType?: number;

  /** Interest method the product prescribes. */
  readonly interestType?: number;

  /** Interest calculation period the product prescribes. */
  readonly interestCalculationPeriodType?: number;

  /** Selected transaction processing strategy, read through `optionId()` whichever shape it takes. */
  readonly transactionProcessingStrategy?: OptionRef;

  /**
   * Charges applicable to the application, under the key this endpoint uses. It is declared
   * alongside `chargeOptions` because the two keys are both in use across Fineract's template
   * payloads, and the form reads `charges ?? chargeOptions ?? []` rather than assuming one.
   */
  readonly charges?: readonly LoanChargeOption[];

  /** Charges applicable to the application, under the alternative key described above. */
  readonly chargeOptions?: readonly LoanChargeOption[];

  /** Loan officers the application may be assigned to. */
  readonly loanOfficerOptions?: readonly OptionItem[];

  /** Loan officer the template preselects, when the product or client implies one. */
  readonly loanOfficerId?: number;

  /** Funds the loan may draw on, for the tenants that use them. */
  readonly fundOptions?: readonly OptionItem[];

  /** Fund the template preselects. */
  readonly fundId?: number;

  /** Currency of the selected product, as the template reports it. */
  readonly currency?: {
    readonly code: string;
    readonly displaySymbol?: string;
    readonly name?: string;
  };

  /** Default expected disbursement date, read with `fromFineractDate`. */
  readonly expectedDisbursementDate?: FineractDateValue;

  /** Default submission date, read with `fromFineractDate`. */
  readonly submittedOnDate?: FineractDateValue;
}

/**
 * The dated milestones in a loan record's `timeline`, each read with `fromFineractDate`.
 *
 * Every member is absent until the transition it records has happened: a submitted loan has no
 * `actualDisbursementDate`, a rejected one no `approvedOnDate`. The record header renders the dates
 * it has and leaves the others as an empty value rather than a placeholder (AAP 0.7.4).
 */
export interface LoanTimeline {
  /** Date the application was submitted. */
  readonly submittedOnDate?: FineractDateValue;

  /** Date the loan was approved. */
  readonly approvedOnDate?: FineractDateValue;

  /** Date the loan is expected to be disbursed. */
  readonly expectedDisbursementDate?: FineractDateValue;

  /** Date the loan was actually disbursed. */
  readonly actualDisbursementDate?: FineractDateValue;

  /** Date the loan reached a closed state. */
  readonly closedOnDate?: FineractDateValue;

  /** Date the application was rejected. */
  readonly rejectedOnDate?: FineractDateValue;

  /** Date the application was withdrawn. */
  readonly withdrawnOnDate?: FineractDateValue;
}

/**
 * The loan's money totals as `GET /loans/{id}?associations=all` reports them (AAP 0.7.2).
 *
 * Every member is optional because the set present depends on the loan's state: a submitted loan
 * has no disbursement totals, and a closed one reports no outstanding balance. The view renders the
 * members it receives and shows an empty value for the rest, never a computed substitute.
 */
export interface LoanSummary {
  /** Total the borrower is expected to repay over the life of the loan. */
  readonly totalExpectedRepayment?: number;

  /** Total still outstanding. */
  readonly totalOutstanding?: number;

  /** Total repaid so far. */
  readonly totalRepayment?: number;

  /** Principal actually disbursed. */
  readonly totalPrincipalDisbursed?: number;

  /** Principal still outstanding. */
  readonly principalOutstanding?: number;

  /** Principal repaid so far. */
  readonly principalPaid?: number;

  /** Interest still outstanding. */
  readonly interestOutstanding?: number;

  /** Interest repaid so far. */
  readonly interestPaid?: number;

  /** Fees still outstanding. */
  readonly feesOutstanding?: number;

  /** Penalty charges still outstanding. */
  readonly penaltyChargesOutstanding?: number;
}

/**
 * A loan account as `GET /loans/{id}?associations=all` returns it — the record the view screen
 * renders — and the same body `GET /loans/{id}?template=true&associations=...` returns to seed the
 * edit form (AAP 0.7.3, "Loan edit").
 *
 * Only the members the API always sends are required. The rest are optional because the server
 * omits them depending on the state of the loan and on the associations requested: a summary or a
 * repayment schedule is absent unless it was asked for, `approvedPrincipal` is absent before
 * approval, and the transaction and charge lists are empty rather than missing for a loan that has
 * neither. A screen renders what it receives and shows its empty state for the rest (AAP 0.7.4).
 */
export interface LoanAccount {
  /** Loan id, the `{id}` of every loan endpoint. */
  readonly id: number;

  /** Account number Fineract assigned, displayed as the record's account reference. */
  readonly accountNo: string;

  /** Client the loan belongs to, which links the record back to the client view. */
  readonly clientId: number;

  /** Client's display name. */
  readonly clientName?: string;

  /** Product id the loan was written against. */
  readonly productId?: number;

  /** Product name, displayed on the record. */
  readonly productName?: string;

  /** Principal applied for, the amount every disbursement and schedule is based on. */
  readonly principal: number;

  /** Principal approved, which can differ from the applied amount once the loan is approved. */
  readonly approvedPrincipal?: number;

  /** Number of repayments in the loan's term. */
  readonly numberOfRepayments: number;

  /** Interval between repayments, in `repaymentFrequencyType` units. */
  readonly repaymentEvery: number;

  /** Nominal interest rate per `interestRateFrequencyType` period. */
  readonly interestRatePerPeriod: number;

  /** Lifecycle status; `toStatusKey()` turns it into the indicator's colour. */
  readonly status: LoanStatus;

  /** Dated milestones of the loan's lifecycle. */
  readonly timeline?: LoanTimeline;

  /** Money totals, present when the request asked for the `summary` association. */
  readonly summary?: LoanSummary;

  /** Repayment schedule, present when the request asked for the `repaymentSchedule` association. */
  readonly repaymentSchedule?: RepaymentSchedule;

  /** Transactions posted against the loan, oldest first as the server returns them. */
  readonly transactions?: readonly LoanTransaction[];

  /** Charges attached to the loan. */
  readonly charges?: readonly LoanCharge[];
}

/**
 * One row of a repayment schedule — the `periods[]` of `RepaymentSchedule`, and the rows the
 * preview table renders after `POST /loans?command=calculateLoanSchedule` (AAP 0.7.2).
 *
 * `complete` is what marks a period as paid, and the first period's `totalDue` is the amount the
 * repayment form defaults to for workflow W6: it is read from this array and never hard-coded,
 * because the figure depends on the product, the principal and the run date.
 */
export interface RepaymentPeriod {
  /** Period number, 1-based; the schedule table's first column. */
  readonly period: number;

  /** Date the period starts. */
  readonly fromDate: FineractDateValue;

  /** Date the period falls due. */
  readonly dueDate: FineractDateValue;

  /** Principal due in this period. */
  readonly principalDue: number;

  /** Principal originally scheduled for this period, before rescheduling. */
  readonly principalOriginalDue: number;

  /** Interest due in this period. */
  readonly interestDue: number;

  /** Fees due in this period. */
  readonly feesDue: number;

  /** Total due in this period. */
  readonly totalDue: number;

  /** Total originally scheduled for this period, before rescheduling. */
  readonly totalOriginalDueForPeriod: number;

  /** Principal still outstanding after this period. */
  readonly principalOutstanding: number;

  /** Interest still outstanding after this period. */
  readonly interestOutstanding: number;

  /** Total still outstanding after this period. */
  readonly totalOutstandingForPeriod: number;

  /** Whether the period has been fully paid. */
  readonly complete: boolean;
}

/**
 * A repayment schedule: the ordered periods, plus the totals a schedule calculation returns.
 *
 * The totals are present on the `POST /loans?command=calculateLoanSchedule` preview and absent from
 * a record's schedule, so they are optional. The schedule table renders `periods` only; the totals
 * exist for a screen that wants to state the loan's cost before submitting it.
 */
export interface RepaymentSchedule {
  /** Periods in schedule order; the array order is meaningful and is preserved. */
  readonly periods: readonly RepaymentPeriod[];

  /** Total principal disbursed across the loan. */
  readonly totalPrincipalDisbursed?: number;

  /** Total principal the schedule expects to collect. */
  readonly totalPrincipalExpected?: number;

  /** Total interest charged over the loan's life. */
  readonly totalInterestCharged?: number;

  /** Total fee charges charged over the loan's life. */
  readonly totalFeeChargesCharged?: number;

  /** Total the borrower repays, principal and interest and fees together. */
  readonly totalRepaymentExpected?: number;

  /** Length of the loan term in days, as the calculation reports it. */
  readonly loanTermInDays?: number;
}

/**
 * A transaction posted against a loan — an `associations=all` record's `transactions[]` and the
 * rows the transaction list renders (AAP 0.7.2).
 *
 * The amount is split into the portions the server applied, so the list can show how a repayment
 * was distributed without recomputing anything client-side. `manuallyReversed` marks a transaction
 * the server has reversed.
 */
export interface LoanTransaction {
  /** Transaction id. */
  readonly id: number;

  /** Date the transaction was posted, read with `fromFineractDate`. */
  readonly date: FineractDateValue;

  /** Transaction type, e.g. disbursement or repayment. */
  readonly type: {
    readonly id: number;
    readonly code?: string;
    readonly value?: string;
  };

  /** Amount of the transaction. */
  readonly amount: number;

  /** Portion of the amount applied to principal. */
  readonly principalPortion: number;

  /** Portion of the amount applied to interest. */
  readonly interestPortion: number;

  /** Portion of the amount applied to fees. */
  readonly feeChargesPortion: number;

  /** Portion of the amount applied to penalties. */
  readonly penaltyChargesPortion: number;

  /** Loan balance outstanding after this transaction. */
  readonly outstandingLoanBalance: number;

  /** Whether the transaction has been reversed. */
  readonly manuallyReversed: boolean;
}

/**
 * A charge attached to a loan, as the record's `charges[]` reports it (AAP 0.7.2).
 *
 * The paid, waived and outstanding amounts are separate members because the charge list shows them
 * separately and the pay and waive forms act on the outstanding portion.
 */
export interface LoanCharge {
  /** Charge id, the `{chargeId}` of the charge action endpoint. */
  readonly id: number;

  /** Charge name, rendered as the server sent it. */
  readonly name: string;

  /** Amount charged. */
  readonly amount: number;

  /** Amount already paid. */
  readonly amountPaid: number;

  /** Amount waived. */
  readonly amountWaived: number;

  /** Amount still outstanding, which the pay and waive forms act on. */
  readonly amountOutstanding: number;

  /** When the charge falls due, e.g. disbursement or a specified date. */
  readonly chargeTimeType: {
    readonly id: number;
    readonly value?: string;
  };

  /** How the charge amount is calculated, e.g. flat or a percentage. */
  readonly chargeCalculationType: {
    readonly id: number;
    readonly value?: string;
  };

  /** Due date of a charge that carries one. */
  readonly dueDate?: FineractDateValue;
}

/**
 * The charge template that feeds the add-charge form's charge picker: the response of both
 * `GET /charges/{id}?template=true` and `GET /loans/{id}/charges/template` (AAP 0.7.3,
 * "Loan charges").
 *
 * Both endpoints are modelled by this one interface because both are read for the same thing, the
 * list of charges applicable to the loan. The endpoint returns further members besides these three
 * and the plan models none of them; the parity run records whichever else it observes rather than
 * this module claiming a shape nobody verified (Rule 1 clause 4).
 */
export interface ChargeTemplate {
  /** Charges applicable to the loan, rendered as the charge picker in the received order. */
  readonly chargeOptions: readonly LoanChargeOption[];

  /** What the charge applies to, as the server reports it. */
  readonly chargeAppliesTo?: {
    readonly id: number;
    readonly value?: string;
  };

  /** Currency of the charges. */
  readonly currency?: {
    readonly code: string;
    readonly displaySymbol?: string;
    readonly name?: string;
  };
}

/*
 * Request bodies.
 *
 * `POST`/`PUT` bodies are assembled by the forms and formatted by `loan.service.ts` immediately
 * before they are sent, so, unlike the response models above, they are not `readonly`: a screen
 * builds one member at a time from its form values. Every date-bearing body ends in `dateFormat`
 * and `locale`, and both are optional because no component ever supplies them — the service sets
 * them unconditionally from `AppConfig` (`dateFormat` is `FINERACT_DATE_FORMAT`, `locale` is the
 * active language) while it converts each `Date` with `toFineractDate`. Their optionality therefore
 * never means "sometimes omitted": a posted body always carries both (Rule 1 clause 2, AAP 0.7.2).
 */

/**
 * The body `POST /loans` submits, and the same body `POST /loans?command=calculateLoanSchedule`
 * previews (AAP 0.7.3, "W4 loan application").
 *
 * The member set is the loan application contract: `loanType` is `'individual'` because only
 * individual loans are in scope, and the term, repayment, interest and strategy members carry the
 * ids the template returned for the selected product rather than the labels it displayed.
 *
 * `principal` deliberately carries no minimum and no maximum (Rule 1 clause 3). Legacy marks it
 * required only, and workflow W7 depends on Fineract itself rejecting a principal above the
 * product's limit and returning the message the new screen must display — a client-side bound would
 * block the submission the workflow exists to prove.
 */
export interface LoanApplicationRequest {
  /** Client the loan is opened for. */
  clientId: number;

  /** Product the loan is written against. */
  productId: number;

  /** Only individual loans are in scope (AAP 0.9.2 excludes group accounts). */
  loanType: 'individual';

  /** Amount applied for, with no bound. */
  principal: number;

  /** Term length, in `loanTermFrequencyType` units. */
  loanTermFrequency: number;

  /** Unit of `loanTermFrequency`, e.g. months. */
  loanTermFrequencyType: number;

  /** Number of repayments. */
  numberOfRepayments: number;

  /** Interval between repayments. */
  repaymentEvery: number;

  /** Unit of `repaymentEvery`, e.g. months. */
  repaymentFrequencyType: number;

  /** Nominal interest rate per `interestRateFrequencyType` period. */
  interestRatePerPeriod: number;

  /** Unit of `interestRatePerPeriod`, e.g. per year. */
  interestRateFrequencyType: number;

  /** Amortisation method id from the template. */
  amortizationType: number;

  /** Interest method id from the template. */
  interestType: number;

  /** Interest calculation period id from the template. */
  interestCalculationPeriodType: number;

  /** Transaction processing strategy id, read from the template through `optionId()`. */
  transactionProcessingStrategyId: number;

  /** Expected disbursement date, formatted by the service. */
  expectedDisbursementDate: Date;

  /** Submission date, formatted by the service. */
  submittedOnDate: Date;

  /** Loan officer to assign, when one was chosen from `loanOfficerOptions`. */
  loanOfficerId?: number;

  /** Fund to draw on, when one was chosen from `fundOptions`. */
  fundId?: number;

  /** Charges applied with the application, as the picked charge ids and their amounts. */
  charges?: readonly { readonly chargeId: number; readonly amount: number }[];

  /** Payload date format, set by the service from `AppConfig.dateFormat`. */
  dateFormat?: typeof FINERACT_DATE_FORMAT;

  /** Payload locale, set by the service from the active language. */
  locale?: string;
}

/**
 * The body `PUT /loans/{id}` submits for a loan edit (AAP 0.7.3, "Loan edit").
 *
 * It is the application body unchanged, which is why it is the same type rather than a second
 * member list that could drift from the first: the plan posts the identical field set. The parity
 * run confirms from the `GET /loans/{id}?template=true` payload whether this fork marks a member
 * submit-only; such a member would then be hidden from the edit form rather than given a
 * locally invented rule (Rule 1 clause 3).
 */
export type LoanEditRequest = LoanApplicationRequest;

/**
 * The body posted to `POST /loans/{id}?command=<command>` for the five lifecycle actions
 * (AAP 0.7.3, "W5 approve and disburse").
 *
 * One interface rather than a union, because the command travels in the query string that
 * `loan.service.ts` composes, not in the body. Which members a command uses is fixed:
 *
 * - `approve` — `approvedOnDate` and `approvedPrincipal`, with an optional `note`;
 * - `reject` — `rejectedOnDate`, with an optional `note`;
 * - `disburse` — `actualDisbursementDate`, an optional `transactionAmount`, and an optional `note`;
 * - `undoapproval` — `note` only;
 * - `undodisbursal` — no members at all; the body is empty apart from `dateFormat` and `locale`.
 */
export interface LoanActionRequest {
  /** Approval date, formatted by the service; `approve` only. */
  approvedOnDate?: Date;

  /** Principal approved, which may differ from the applied amount; `approve` only. */
  approvedPrincipal?: number;

  /** Rejection date, formatted by the service; `reject` only. */
  rejectedOnDate?: Date;

  /** Disbursement date, formatted by the service; `disburse` only. */
  actualDisbursementDate?: Date;

  /** Amount disbursed, when the screen edits the approved principal; `disburse` only. */
  transactionAmount?: number;

  /** Free-text note recorded with the action; accepted by `approve`, `reject` and `disburse`. */
  note?: string;

  /** Payload date format, set by the service from `AppConfig.dateFormat`. */
  dateFormat?: typeof FINERACT_DATE_FORMAT;

  /** Payload locale, set by the service from the active language. */
  locale?: string;
}

/**
 * The body `POST /loans/{id}/transactions?command=repayment` posts (AAP 0.7.3, "W6 repayment").
 *
 * The amount defaults to the first unpaid period's `totalDue` from the loan's repayment schedule and
 * the date to the run date, but both are editable before submission, so neither is fixed here.
 */
export interface LoanRepaymentRequest {
  /** Date the repayment is recorded on, formatted by the service. */
  transactionDate: Date;

  /** Amount repaid. */
  transactionAmount: number;

  /** Payment type id chosen from `paymentTypeOptions`. */
  paymentTypeId: number;

  /** Free-text note recorded with the repayment. */
  note?: string;

  /** Payload date format, set by the service from `AppConfig.dateFormat`. */
  dateFormat?: typeof FINERACT_DATE_FORMAT;

  /** Payload locale, set by the service from the active language. */
  locale?: string;
}

/**
 * The body `POST /loans/{id}/charges` posts when a charge is added to a loan (AAP 0.7.3,
 * "Loan charges").
 */
export interface LoanChargeRequest {
  /** Charge to attach, from `chargeOptions`. */
  chargeId: number;

  /** Amount charged. */
  amount: number;

  /** Due date, sent only for a charge whose timing carries a specified due date. */
  dueDate?: Date;

  /** Payload date format, set by the service from `AppConfig.dateFormat`. */
  dateFormat?: typeof FINERACT_DATE_FORMAT;

  /** Payload locale, set by the service from the active language. */
  locale?: string;
}

/**
 * The body `POST /loans/{id}/charges/{chargeId}?command=pay|waive` posts (AAP 0.7.3,
 * "Loan charges").
 *
 * The `pay` variant reads `transactionDate` and `paymentTypeId`; the `waive` variant sends neither,
 * because a waiver books no money movement. The amount defaults to the charge's outstanding portion
 * and stays editable.
 */
export interface LoanChargeActionRequest {
  /** Amount paid or waived. */
  amount: number;

  /** Date the payment is recorded on, formatted by the service; `pay` only. */
  transactionDate?: Date;

  /** Payment type id chosen from `paymentTypeOptions`; `pay` only. */
  paymentTypeId?: number;

  /** Payload date format, set by the service from `AppConfig.dateFormat`. */
  dateFormat?: typeof FINERACT_DATE_FORMAT;

  /** Payload locale, set by the service from the active language. */
  locale?: string;
}

/*
 * Partial projections.
 *
 * The two template payloads below are not modelled by the plan in full: each endpoint returns the
 * loan's wider record alongside option lists, and a screen reads only the members listed here.
 * Declaring just those is how Rule 1 clause 4 is met without `any` and without inventing members the
 * run never observed.
 */

/**
 * A partial projection of `GET /loans/{id}/template?templateType=approval` — the approval, and
 * subsequent disbursement, form's seed (AAP 0.7.3, "W5 approve and disburse").
 *
 * The endpoint returns the loan's wider record plus these lists; only the members below are read.
 */
export interface LoanActionTemplate {
  /** Loan id the template belongs to. */
  id?: number;

  /** Principal the approval form defaults to. */
  approvedPrincipal?: number;

  /** Approval date the template defaults to. */
  approvalDate?: FineractDateValue;

  /** Expected disbursement date the template defaults to. */
  expectedDisbursementDate?: FineractDateValue;

  /** Actual disbursement date the template defaults to. */
  actualDisbursementDate?: FineractDateValue;

  /** Amount the disbursement form defaults to. */
  transactionAmount?: number;

  /** Payment types the disbursement form offers. */
  paymentTypeOptions?: readonly OptionItem[];

  /** Approval amount the template reports, where the server sends it under this name. */
  approvalAmount?: number;
}

/**
 * A partial projection of `GET /loans/{id}/transactions/template?command=disburse|repayment` — the
 * seed for the disbursement and repayment forms (AAP 0.7.3, "W5 approve and disburse", "W6
 * repayment").
 *
 * The endpoint returns the loan's wider record plus these members; only the members below are read.
 */
export interface LoanTransactionTemplate {
  /** Payment types the form offers, rendered in the received order. */
  paymentTypeOptions?: readonly OptionItem[];

  /** Transaction date the form defaults to, read with `fromFineractDate`. */
  transactionDate?: FineractDateValue;

  /** Amount the form defaults to. */
  amount?: number;

  /** Loan the transaction belongs to. */
  loanId?: number;
}

/*
 * Pure helpers. Same input, same output: no clock read, no dependency, no side effect.
 */

/**
 * The numeric id behind an option-valued template member, or `undefined` when the template seeded
 * none.
 *
 * `transactionProcessingStrategy` is the field this exists for: a template returns the seeded choice
 * as an `{id, name}` object, while a payload that carries only the choice sends the bare id. The
 * reader accepts both shapes, so a form seeds `transactionProcessingStrategyId` without a cast and
 * without branching on the shape at the call site.
 *
 * @param value The member as the payload sent it, or `undefined` when it is absent.
 * @returns Its id, or `undefined` when there is no choice to read.
 */
export function optionId(value: OptionRef | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return typeof value === 'number' ? value : value.id;
}

/**
 * Whether a body `GET /loans/{id}` returned is a loan record rather than a loan template.
 *
 * The service's template read is declared to return `LoanTemplate | LoanAccount` because the same
 * path answers both requests depending on `template=true`. The guard narrows on a numeric `id` and
 * an object `status`, and it is sound because a `LoanTemplate` has neither member: the template
 * describes the options for a loan that does not exist yet, so it carries no id of its own and no
 * lifecycle status.
 *
 * @param value A body from either loan read.
 * @returns `true` when `value` is the loan record.
 */
export function isLoanAccount(value: LoanTemplate | LoanAccount): value is LoanAccount {
  // `in` narrows the union rather than asserting it: a template carries no `status` member, so a
  // body that has one is the loan record, and the members are read from a view typed as `unknown`.
  if (!('status' in value)) {
    return false;
  }

  const { id, status }: { readonly id: unknown; readonly status: unknown } = value;

  return typeof id === 'number' && typeof status === 'object' && status !== null;
}

/**
 * Fineract's `LoanStatusType` ids, mapped onto the indicator's four colours.
 *
 * The numbers are the server's enum values rather than this application's, so the mapping is stated
 * once, beside the model that carries them, instead of in each screen that renders a status.
 */
const STATUS_BY_ID: Readonly<Partial<Record<string, StatusKey>>> = {
  /** Submitted and pending approval, and approved: the loan is not disbursed yet. */
  '100': 'pending',
  '200': 'pending',

  /** Active, i.e. disbursed. */
  '300': 'active',

  /** Rejected, closed, closed written off, closed by reschedule and overpaid. */
  '500': 'closed',
  '600': 'closed',
  '601': 'closed',
  '700': 'closed',
  '900': 'closed',
};

/**
 * The same colours keyed by the trailing segment of a `loanStatusType.*` message code, for the
 * payloads that send the code rather than the number. Lower-cased and stripped of separators, so
 * `submittedAndPendingApproval` and `submitted-and-pending-approval` are one key.
 */
const STATUS_BY_NAME: Readonly<Partial<Record<string, StatusKey>>> = {
  active: 'active',
  pending: 'pending',
  submittedandpendingapproval: 'pending',
  approved: 'pending',
  closed: 'closed',
  closedobligationsmet: 'closed',
  closedwrittenoff: 'closed',
  closedrescheduleoutstandingamount: 'closed',
  overpaid: 'closed',
};

/**
 * The indicator colour for a loan status, from either the numeric `LoanStatusType` id or a
 * `loanStatusType.*` message code.
 *
 * `StatusSwatchComponent` takes a `StatusKey` and never a Fineract code, so the translation belongs
 * to this family and is done here once. The result is a colour and only a colour: no label is
 * returned and no screen may render the status as text, because the design paints a swatch with no
 * word beside it (AAP 0.10.5 item 11, Rule 1 clause 3).
 *
 * A status the mapping does not cover — none, or a type this application has no colour for — is
 * `other`, which renders the indicator in its neutral colour rather than failing.
 *
 * @param code The status id or message code, as the payload sent it.
 * @returns The `StatusKey` the indicator renders.
 */
export function toStatusKey(code: string | number | null | undefined): StatusKey {
  if (code === null || code === undefined) {
    return 'other';
  }

  if (typeof code === 'number') {
    return STATUS_BY_ID[String(code)] ?? 'other';
  }

  // A message code is `loanStatusType.<name>`, but a payload may also send the bare number as text
  // or the bare name, so the trailing segment is tried against both tables before giving up.
  const trailing = code.slice(code.lastIndexOf('.') + 1);
  const byId = STATUS_BY_ID[trailing];

  if (byId !== undefined) {
    return byId;
  }

  return STATUS_BY_NAME[trailing.toLowerCase().replace(/[^a-z]/g, '')] ?? 'other';
}
