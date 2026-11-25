/**
 * The loans family's single model module: one typed model for every request body and every
 * response shape the individual-loan screens use, in Fineract's own wire field names.
 *
 * Field names are the contract (Rule 1 clause 2). A renamed member is a parity break, because the
 * new application must send the same body the legacy screens send, so nothing here is prettified:
 * `loanTermFrequency` and `interestCalculationPeriodType` are reproduced exactly as `POST /loans`
 * names them, and a response member keeps the spelling of the endpoint that returns it — which is
 * why a template's term members are `termFrequency` and `termPeriodFrequencyType` although the
 * posted body names the same two values `loanTermFrequency` and `loanTermFrequencyType`
 * (AAP 0.7.2, 0.7.3).
 *
 * Declaration only. This module carries no Angular decorator, no injected collaborator, no HTTP
 * call, no fixture and no `any` (Rule 1 clause 4): a payload member the plan does not model is
 * either a documented partial projection listing just the members a screen reads, or `unknown`.
 * The two functions at the end are pure — same input, same output, no clock read, no dependency
 * — so the types cost the loans feature's other files nothing to import.
 *
 * Dates never travel as formatted strings. A response date is the `FineractDate` declared once in
 * `web-ng/src/app/shared/date-format.util.ts` — the `'yyyy-MM-dd'` string or the
 * `[year, month, day]` triple Fineract returns — and a screen reads it with `fromFineractDate`; a
 * request date is a `Date | null` and `loan.service.ts` writes it with `toFineractDate` at the
 * boundary, beside the required `dateFormat` (`AppDateFormat`) and `locale` (AAP 0.7.2, "Date
 * handling").
 *
 * Two absences are deliberate and must stay. `principal` carries no minimum and no maximum,
 * because legacy adds none and workflow W7 depends on Fineract itself rejecting a principal above
 * the product's limit — a client-side bound would make that spec pass for the wrong reason
 * (Rule 1 clause 3). And no status model carries a label, because the indicator the design paints
 * is a colour and never a word (AAP 0.10.5 item 11).
 */
import type { AppDateFormat } from '../../core/config/app-config.model';
import type { FineractDate } from '../../shared/date-format.util';
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
 * One row of `transactionProcessingStrategyOptions`: the fork's strategy pair, the `code` an
 * application posts and the `name` its picker renders.
 *
 * The list is keyed by code and not by id — `POST /loans` answers HTTP 400 "The parameter
 * transactionProcessingStrategyId is not supported" for the id form of the choice — which is why
 * this row is not the `{id, name}` shape the other option lists use.
 */
export interface TransactionProcessingStrategyOption {
  /** Strategy code the application carries, e.g. `'mifos-standard-strategy'`. */
  readonly code: string;

  /** Label exactly as the template endpoint returned it. */
  readonly name: string;

  /** Numeric id, for a build that sends one beside the code. */
  readonly id?: number;
}

/**
 * A loan's lifecycle status as Fineract sends it: the numeric `LoanStatus` id, its
 * `loanStatusType.*` message code, and the server's display text.
 *
 * The text is kept because it is part of the response, and it is never rendered: the indicator is
 * a colour (AAP 0.10.5 item 11), so screens pass `id` — or `code` — to `toLoanStatusKey()`.
 */
export interface LoanStatus {
  /** Numeric `LoanStatus` id, one of the values `toLoanStatusKey()` looks up. */
  readonly id: number;

  /** Message code such as `loanStatusType.active`, matched on its whole normalised code. */
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
  readonly dueDate?: FineractDate;
}

/**
 * `GET /loans/template?templateType=individual&clientId=&productId=` — the dropdown options and
 * the defaults the new-loan form is seeded from, and the same shape the edit form is seeded from
 * (AAP 0.7.3, "W4 loan application"; Rule 1 clause 3: every option list comes from the template
 * endpoint, never from a constant in this application).
 *
 * The endpoint seeds the product-dependent defaults — `product`, `principal`, the term, repayment
 * and interest members — only when the request names a `productId`. Without one it answers a bare
 * `new LoanAccountData()`: the option lists are present and every default is null, and that
 * product-less read is the one the legacy new-loan screen makes first, to fill its product picker.
 * The defaults are therefore optional, and an absent one stays an empty field and posts nothing
 * rather than being filled in here.
 */
export interface LoanTemplate {
  /** Client the loan is opened for, echoed back from the request. */
  readonly clientId?: number;

  /** Client's display name, shown beside the application. */
  readonly clientName?: string;

  /** Office the client belongs to, which scopes the officer and fund lists. */
  readonly clientOfficeId?: number;

  /** The selected product; seeded only when the request names a `productId`. */
  readonly product?: LoanTemplateProduct;

  /** Products the client may be given, rendered as the product dropdown. */
  readonly productOptions: readonly LoanTemplateProduct[];

  /**
   * Default principal, typically the product's default principal; seeded only when the request
   * names a `productId`.
   */
  readonly principal?: number;

  /**
   * Default term length, in `termPeriodFrequencyType` units — `LoanAccountData.termFrequency` on the
   * template, which `POST /loans` spells `loanTermFrequency`.
   */
  readonly termFrequency?: number;

  /**
   * Unit of `termFrequency`, e.g. months — `LoanAccountData.termPeriodFrequencyType` on the
   * template, which `POST /loans` spells `loanTermFrequencyType` and carries as the `id` this object
   * reports, beside the message code and display text the server sent.
   */
  readonly termPeriodFrequencyType?: {
    readonly id: number;
    readonly code?: string;
    readonly value?: string;
  };

  /** Default number of repayments; seeded only when the request names a `productId`. */
  readonly numberOfRepayments?: number;

  /** Default interval between repayments; seeded only when the request names a `productId`. */
  readonly repaymentEvery?: number;

  /** Unit of `repaymentEvery`, e.g. months. */
  readonly repaymentFrequencyType?: number;

  /**
   * Default nominal interest rate per `interestRateFrequencyType` period; seeded only when the
   * request names a `productId`.
   */
  readonly interestRatePerPeriod?: number;

  /** Unit of `interestRatePerPeriod`, e.g. per year. */
  readonly interestRateFrequencyType?: number;

  /** Amortisation method the product prescribes. */
  readonly amortizationType?: number;

  /** Interest method the product prescribes. */
  readonly interestType?: number;

  /** Interest calculation period the product prescribes. */
  readonly interestCalculationPeriodType?: number;

  /**
   * Strategy the template seeds for the selected product, as the code the application posts.
   * Absent from the product-less template, like every other product-dependent default.
   */
  readonly transactionProcessingStrategyCode?: string;

  /** Strategies the form's picker offers, in the received order. */
  readonly transactionProcessingStrategyOptions?: readonly TransactionProcessingStrategyOption[];

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
  readonly expectedDisbursementDate?: FineractDate;

  /** Default submission date, read with `fromFineractDate`. */
  readonly submittedOnDate?: FineractDate;
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
  readonly submittedOnDate?: FineractDate;

  /** Date the loan was approved. */
  readonly approvedOnDate?: FineractDate;

  /** Date the loan is expected to be disbursed. */
  readonly expectedDisbursementDate?: FineractDate;

  /** Date the loan was actually disbursed. */
  readonly actualDisbursementDate?: FineractDate;

  /** Date the loan reached a closed state. */
  readonly closedOnDate?: FineractDate;

  /** Date the application was rejected. */
  readonly rejectedOnDate?: FineractDate;

  /** Date the application was withdrawn. */
  readonly withdrawnOnDate?: FineractDate;
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

  /** Principal actually disbursed, the fork's `LoanSummaryData.principalDisbursed`. */
  readonly principalDisbursed?: number;

  /** Principal still outstanding. */
  readonly principalOutstanding?: number;

  /** Principal repaid so far. */
  readonly principalPaid?: number;

  /** Interest still outstanding. */
  readonly interestOutstanding?: number;

  /** Interest repaid so far. */
  readonly interestPaid?: number;

  /** Fees still outstanding, the fork's `LoanSummaryData.feeChargesOutstanding`. */
  readonly feeChargesOutstanding?: number;

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

  /**
   * Product id the loan was written against, the fork's `LoanAccountData.loanProductId` — the only
   * product id `GET /loans/{id}` sends.
   */
  readonly loanProductId?: number;

  /** Product name, the fork's `LoanAccountData.loanProductName`, displayed on the record. */
  readonly loanProductName?: string;

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

  /** Lifecycle status; `toLoanStatusKey()` turns it into the indicator's colour. */
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
 * The fee, penalty and total members carry the fork's own `LoanSchedulePeriodData` names —
 * `feeChargesDue`, `penaltyChargesDue`, `totalDueForPeriod` — because those are the keys the
 * schedule sends and the columns the preview and schedule tables render (Rule 1 clause 2).
 *
 * `complete` is what marks a period as paid, and the first period's `totalDueForPeriod` is the
 * amount the repayment form defaults to for workflow W6: it is read from this array and never
 * hard-coded, because the figure depends on the product, the principal and the run date.
 */
export interface RepaymentPeriod {
  /** Period number, 1-based; the schedule table's first column. */
  readonly period: number;

  /** Date the period starts. */
  readonly fromDate: FineractDate;

  /** Date the period falls due. */
  readonly dueDate: FineractDate;

  /** Principal due in this period. */
  readonly principalDue: number;

  /** Principal originally scheduled for this period, before rescheduling. */
  readonly principalOriginalDue: number;

  /** Interest due in this period. */
  readonly interestDue: number;

  /** Fees due in this period, the fork's `LoanSchedulePeriodData.feeChargesDue`. */
  readonly feeChargesDue: number;

  /** Penalties due in this period, the fork's `LoanSchedulePeriodData.penaltyChargesDue`. */
  readonly penaltyChargesDue: number;

  /** Total due in this period, the fork's `LoanSchedulePeriodData.totalDueForPeriod`. */
  readonly totalDueForPeriod: number;

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
  readonly date: FineractDate;

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
  readonly dueDate?: FineractDate;
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
 * `POST`/`PUT` bodies are assembled by the forms, so, unlike the response models above, they are
 * not `readonly`: a screen builds one member at a time from its form values.
 *
 * One convention holds for every one of them, and it is the one AAP 0.7.2 "Date handling" sets: a
 * request body holds the values the form holds — each date a `Date | null`, `dateFormat` and
 * `locale` required — and `loan.service.ts` converts each date with `toFineractDate(date, locale)`
 * and fills `dateFormat` from `AppConfig` and `locale` from
 * `AppConfigService.activeLocale` at the boundary. No model stores a formatted
 * date (AAP 0.7.2 "Date handling"; AAP 0.14.1 "Dates never travel as strings built in a
 * template"), and a body that omitted `dateFormat` or `locale` would not compile (Rule 1 clause 2).
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

  /**
   * Transaction processing strategy the application is processed under, as the code the template
   * seeded and the server accepts.
   *
   * A code, not an id: the fork answers `POST /loans` with HTTP 400 "The parameter
   * transactionProcessingStrategyId is not supported" for the id form and accepts
   * `transactionProcessingStrategyCode` (observed against the running fork, whose OpenAPI is the
   * contract's source of truth; the seed script creates its product with the same member). The
   * member name is the server's own, as a payload that has to match the Fineract contract requires.
   */
  transactionProcessingStrategyCode: string;

  /** Expected disbursement date the form holds; `null` when its field is empty. */
  expectedDisbursementDate: Date | null;

  /** Submission date the form holds; `null` when its field is empty. */
  submittedOnDate: Date | null;

  /** Loan officer to assign, when one was chosen from `loanOfficerOptions`. */
  loanOfficerId?: number;

  /** Fund to draw on, when one was chosen from `fundOptions`. */
  fundId?: number;

  /** Charges applied with the application, as the picked charge ids and their amounts. */
  charges?: readonly { readonly chargeId: number; readonly amount: number }[];

  /** Payload date format, set by the service from `AppConfig.dateFormat`. */
  dateFormat: AppDateFormat;

  /** Payload locale, set by the service from the active language. */
  locale: string;
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
 * The body of one loan lifecycle action, as a discriminated union on the command the endpoint takes
 * in its query string (AAP 0.7.2 row `LoanActionRequest`; AAP 0.7.3, "W5 approve and disburse").
 *
 * Each arm is one `POST /loans/{id}?command=<command>` body: `loan.service.ts` takes the command
 * from the body's own `command` member and puts it in the query string, so a body and the command
 * it is posted under cannot be mismatched. The required members are the fork's mandatory fields —
 * `approve` needs `approvedOnDate`, `reject` needs `rejectedOnDate`, `disburse` needs
 * `actualDisbursementDate` — and the two undo commands take no body of their own.
 *
 * One name deliberately departs from the plan: AAP 0.7.2's row spells the approved amount
 * `approvedPrincipal`, but the fork rejects that parameter (HTTP 400, "The parameter
 * approvedPrincipal is not supported"), documents `approvedLoanAmount`, and the legacy action
 * controller posts `approvedLoanAmount`. The wire name is therefore the one posted
 * (Rule 1 clause 2; AAP 0.3.4: where the code disagrees with the request, the code wins).
 */
export type LoanActionRequest =
  | {
      /** Approves the submitted loan. */
      command: 'approve';

      /** Approval date, as the form holds it and `null` while it is empty; mandatory on the server. */
      approvedOnDate: Date | null;

      /** Principal approved, which may differ from the applied amount; the fork's `approvedLoanAmount`. */
      approvedLoanAmount?: number;

      /** Expected disbursement date recorded with the approval, as the form holds it. */
      expectedDisbursementDate?: Date | null;

      /** Free-text note recorded with the action. */
      note?: string;

      /** Payload date format, set by the service from `AppConfig.dateFormat`. */
      dateFormat: AppDateFormat;

      /** Payload locale, set by the service from the active language. */
      locale: string;
    }
  | {
      /** Rejects the submitted loan. */
      command: 'reject';

      /** Rejection date, as the form holds it and `null` while it is empty; mandatory on the server. */
      rejectedOnDate: Date | null;

      /** Free-text note recorded with the action. */
      note?: string;

      /** Payload date format, set by the service from `AppConfig.dateFormat`. */
      dateFormat: AppDateFormat;

      /** Payload locale, set by the service from the active language. */
      locale: string;
    }
  | {
      /** Disburses the approved loan. */
      command: 'disburse';

      /** Disbursement date, as the form holds it and `null` while it is empty; mandatory on the server. */
      actualDisbursementDate: Date | null;

      /** Amount disbursed, when the screen edits the approved principal. */
      transactionAmount?: number;

      /** Fixed EMI amount, for the products that take one. */
      fixedEmiAmount?: number;

      /** Free-text note recorded with the action. */
      note?: string;

      /** Payload date format, set by the service from `AppConfig.dateFormat`. */
      dateFormat: AppDateFormat;

      /** Payload locale, set by the service from the active language. */
      locale: string;
    }
  | {
      /**
       * Undoes the approval, returning the loan to pending. The server accepts `note` here and
       * nothing else, which is why this arm carries neither a date nor the `dateFormat`/`locale`
       * pair the dated arms send.
       */
      command: 'undoapproval';

      /** Free-text note recorded with the action. */
      note?: string;
    }
  | {
      /** Undoes the disbursal; the server takes no body for it. */
      command: 'undodisbursal';
    };

/**
 * The body `POST /loans/{id}/transactions?command=repayment` posts (AAP 0.7.3, "W6 repayment").
 *
 * The amount defaults to the first unpaid period's `totalDueForPeriod` from the loan's repayment
 * schedule and the date to the run date, but both are editable before submission, so neither is
 * fixed here.
 */
export interface LoanRepaymentRequest {
  /** Date the repayment is recorded on, as the form holds it; `null` when it is empty. */
  transactionDate: Date | null;

  /** Amount repaid. */
  transactionAmount: number;

  /** Payment type id chosen from `paymentTypeOptions`. */
  paymentTypeId: number;

  /** Free-text note recorded with the repayment. */
  note?: string;

  /** Payload date format, set by the service from `AppConfig.dateFormat`. */
  dateFormat: AppDateFormat;

  /** Payload locale, set by the service from the active language. */
  locale: string;
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

  /** Due date the form holds when the charge's timing carries one, and `null` otherwise. */
  dueDate?: Date | null;

  /** Payload date format, set by the service from `AppConfig.dateFormat`. */
  dateFormat: AppDateFormat;

  /** Payload locale, set by the service from the active language. */
  locale: string;
}

/**
 * The body of one loan-charge action, as a discriminated union on the command
 * `POST /loans/{id}/charges/{chargeId}?command=` takes (AAP 0.7.2 row `LoanChargeActionRequest`;
 * AAP 0.7.3, "Loan charges").
 *
 * `pay` books a money movement, so it carries the amount, its date and a payment type; `waive`
 * books none, so it sends the amount alone. The amount defaults to the charge's outstanding portion
 * and stays editable in both.
 */
export type LoanChargeActionRequest =
  | {
      /** Pays the outstanding portion of the charge. */
      command: 'pay';

      /** Amount paid. */
      amount: number;

      /** Date the payment is recorded on, as the form holds it and `null` while it is empty. */
      transactionDate: Date | null;

      /** Payment type id chosen from `paymentTypeOptions`. */
      paymentTypeId: number;

      /** Payload date format, set by the service from `AppConfig.dateFormat`. */
      dateFormat: AppDateFormat;

      /** Payload locale, set by the service from the active language. */
      locale: string;
    }
  | {
      /** Waives the outstanding portion of the charge. */
      command: 'waive';

      /** Amount waived. */
      amount: number;

      /** Payload date format, set by the service from `AppConfig.dateFormat`. */
      dateFormat: AppDateFormat;

      /** Payload locale, set by the service from the active language. */
      locale: string;
    };

/*
 * Partial projections.
 *
 * The two template payloads below are not modelled by the plan in full: each endpoint returns more
 * than a screen reads, and a screen reads only the members listed here. Declaring just those is how
 * Rule 1 clause 4 is met without `any` and without inventing members the run never observed.
 */

/**
 * A partial projection of `GET /loans/{id}/template?templateType=approval` — the approval form's
 * seed (AAP 0.7.3, "W5 approve and disburse").
 *
 * The endpoint serialises `LoanApprovalData`, not the loan's wider record, so only the approval
 * defaults it carries are declared here. The disbursement form's payment types and default amount
 * come from `LoanTransactionTemplate` — `GET /loans/{id}/transactions/template?command=disburse` —
 * never from this response.
 */
export interface LoanActionTemplate {
  /** Approval date the template defaults to. */
  approvalDate?: FineractDate;

  /** Expected disbursement date the template defaults to. */
  expectedDisbursementDate?: FineractDate;

  /** Approval amount the template reports. */
  approvalAmount?: number;
}

/**
 * A partial projection of `GET /loans/{id}/transactions/template?command=disburse|repayment` — the
 * seed for the disbursement and repayment forms (AAP 0.7.3, "W5 approve and disburse", "W6
 * repayment").
 *
 * The endpoint serialises `LoanTransactionData`: the forms read its default date from `date`, since
 * `transactionDate` exists only on the import payload and is never sent here. Only the members
 * below are read.
 */
export interface LoanTransactionTemplate {
  /** Payment types the form offers, rendered in the received order. */
  paymentTypeOptions?: readonly OptionItem[];

  /** Default date the form seeds — the fork's `LoanTransactionData.date`, read with `fromFineractDate`. */
  date?: FineractDate;

  /** Amount the form defaults to. */
  amount?: number;

  /** Loan the transaction belongs to. */
  loanId?: number;
}

/*
 * Pure helpers. Same input, same output: no clock read, no dependency, no side effect.
 */

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
 * Fineract's `LoanStatus` ids, mapped onto the indicator's four colours.
 *
 * The keys are the fork's own enum values in `LoanStatus.java` — `100`
 * `SUBMITTED_AND_PENDING_APPROVAL`, `200` `APPROVED`, `300` `ACTIVE`, `400` `WITHDRAWN_BY_CLIENT`,
 * `500` `REJECTED`, `600` `CLOSED_OBLIGATIONS_MET`, `601` `CLOSED_WRITTEN_OFF`, `602`
 * `CLOSED_RESCHEDULE_OUTSTANDING_AMOUNT` and `700` `OVERPAID` — so the mapping is stated once,
 * beside the model that carries them, instead of in each screen that renders a status.
 *
 * Three ids are absent by design, exactly as in the clients family: `0` (`INVALID`) is not a state,
 * and `303` (`TRANSFER_IN_PROGRESS`) and `304` (`TRANSFER_ON_HOLD`) are transitions this
 * application paints no colour of their own for. Each of them, and any id the fork adds later, is
 * `other` — the indicator's neutral colour.
 */
const STATUS_BY_ID: Readonly<Partial<Record<string, StatusKey>>> = {
  /** Submitted and pending approval, and approved: the loan is not disbursed yet. */
  '100': 'pending',
  '200': 'pending',

  /** Active, i.e. disbursed. */
  '300': 'active',

  /** Withdrawn by the client, rejected, and every closed form, including overpaid. */
  '400': 'closed',
  '500': 'closed',
  '600': 'closed',
  '601': 'closed',
  '602': 'closed',
  '700': 'closed',
};

/**
 * The same colours keyed by a `loanStatusType.*` message code, normalised the way all three
 * families normalise a status code: lower-cased, the family prefix `loanstatustype.` removed if
 * present, and every non-alphanumeric character stripped. The whole prefix-stripped code is the
 * key — never just its last dot-segment — so
 * `loanStatusType.closed.reschedule.outstanding.amount` is `closedrescheduleoutstandingamount`.
 *
 * The keys are the fork's own codes in `LoanStatus.java` and nothing else: the non-enum shorthands
 * (`pending`, `closed`) are gone because the enum sends neither, and `invalid`,
 * `transfer.in.progress` and `transfer.on.hold` are absent by design, so those and anything
 * unrecognised fall to `other`.
 */
const STATUS_BY_NAME: Readonly<Partial<Record<string, StatusKey>>> = {
  submittedandpendingapproval: 'pending',
  approved: 'pending',
  active: 'active',
  withdrawnbyclient: 'closed',
  rejected: 'closed',
  closedobligationsmet: 'closed',
  closedwrittenoff: 'closed',
  closedrescheduleoutstandingamount: 'closed',
  overpaid: 'closed',
};

/**
 * The normalisation the three feature families share before a status code is looked up:
 * lower-cased, the family's own message-code prefix removed if the payload carried it, and every
 * non-alphanumeric character stripped, so the whole remaining name is the key.
 *
 * `loanStatusType.submitted.and.pending.approval`, `submittedAndPendingApproval` and
 * `SUBMITTED_AND_PENDING_APPROVAL` therefore all normalise to `submittedandpendingapproval`.
 */
function normaliseLoanStatusCode(code: string): string {
  return code.toLowerCase().replace(/^loanstatustype\./, '').replace(/[^a-z0-9]/g, '');
}

/**
 * The indicator colour for a loan status, from either the numeric `LoanStatus` id or a
 * `loanStatusType.*` message code.
 *
 * Both tables are the fork's `LoanStatus` enum: the ids are its values and the keys of the code
 * table are its codes normalised as described above. The whole prefix-stripped code is matched,
 * never a single dot-segment, so every multi-word state the enum declares — submitted and pending
 * approval, closed obligations met, closed written off, closed with a rescheduled outstanding
 * amount, withdrawn by client, rejected — reaches its colour instead of falling through to `other`.
 *
 * `StatusSwatchComponent` takes a `StatusKey` and never a Fineract code, so the translation belongs
 * to this family and is done here once. The result is a colour and only a colour: no label is
 * returned and no screen may render the status as text, because the design paints a swatch with no
 * word beside it (AAP 0.10.5 item 11, Rule 1 clause 3).
 *
 * A status the mapping does not cover — none, `INVALID`, a transfer in progress or on hold, or a
 * code this application has no colour for — is `other`, which renders the indicator in its neutral
 * colour rather than failing.
 *
 * @param code The status id or message code, as the payload sent it.
 * @returns The `StatusKey` the indicator renders.
 */
export function toLoanStatusKey(code: string | number | null | undefined): StatusKey {
  if (code === null || code === undefined) {
    return 'other';
  }

  if (typeof code === 'number') {
    return STATUS_BY_ID[String(code)] ?? 'other';
  }

  // A string may be the message code, or the bare id as text, so the normalised value is tried
  // against the id table as well; normalising leaves a bare number unchanged.
  const normalised = normaliseLoanStatusCode(code);

  return STATUS_BY_ID[normalised] ?? STATUS_BY_NAME[normalised] ?? 'other';
}
