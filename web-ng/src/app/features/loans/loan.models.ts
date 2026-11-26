/** The loans family's single model module: one typed model for every request body and every response shape the individual-loan screens use, in Fineract's own wire field names (Rule 1 clause 2). */
import type { AppDateFormat } from '../../core/config/app-config.model';
import type { FineractDate } from '../../shared/date-format.util';
import type { MoneyCurrency } from '../../shared/money/money.pipe';
import { normaliseStatusCode, type StatusKey } from '../../shared/status-key.util';

/** One row of a Fineract option list — `productOptions`, `loanOfficerOptions`, `fundOptions`, `chargeOptions`, `paymentTypeOptions` — which all arrive in this `{id, name}` shape (AAP 0.4.3). */
export interface OptionItem {
  /** Identifier the posted body carries, e.g. the `chargeId` of a picked charge. */
  readonly id: number;
  /** Label exactly as the template endpoint returned it. */
  readonly name: string;
}

/** The currency object a loan payload sends for the money it carries, as `GET /loans/{id}?associations=all` reports it at the payload's top level, on its `repaymentSchedule` and inside every `charges[]` entry, and `GET /clients/{id}/accounts` on each `loanAccounts[]` entry: `{code: "USD", name: "US Dollar", decimalPlaces: 2, displaySymbol: "$", displayLabel: "US Dollar ($)"}`. `code` is required here because the wire always carries it, while {@link MoneyCurrency} keeps it optional for a reader that only renders a symbol; requiring it keeps a charge's currency a valid `LoanChargeOption` currency (Rule 1 clause 4). */
export interface LoanCurrency extends MoneyCurrency {
  /** ISO code the money is denominated in, e.g. `USD` — sent with every currency the loan endpoints report. */
  readonly code: string;
}

/** One row of `transactionProcessingStrategyOptions`: the fork's strategy pair, the `code` an application posts and the `name` its picker renders. */
export interface TransactionProcessingStrategyOption {
  /** Strategy code the application carries, e.g. `'mifos-standard-strategy'`. */
  readonly code: string;
  /** Label exactly as the template endpoint returned it. */
  readonly name: string;
  /** Numeric id, for a build that sends one beside the code. */
  readonly id?: number;
}

/** One row of an enumeration option list — `termFrequencyTypeOptions`, `repaymentFrequencyTypeOptions`, `interestRateFrequencyTypeOptions`, `amortizationTypeOptions`, `interestTypeOptions` or `interestCalculationPeriodTypeOptions` — and the very shape Fineract sends for a persisted enumeration member of the same name, which is why one interface serves both (AAP 0.7.2). */
export interface LoanEnumOption {
  /** Numeric id the posted body carries, e.g. the `repaymentFrequencyType` an application sends. */
  readonly id: number;
  /** Message code of the option, e.g. `repaymentFrequency.periodFrequencyType.months`. */
  readonly code?: string;
  /** Label exactly as the template endpoint returned it, e.g. `Months`. */
  readonly value?: string;
}

/** One row of `loanOfficerOptions`: a staff member the loan may be assigned to, labelled by the server's `displayName` and, where it sent none, by `firstname`/`lastname` (AAP 0.7.2). */
export interface LoanOfficerOption {
  /** Staff id the body posts as `loanOfficerId`. */
  readonly id: number;
  /** Label the server composes, e.g. `Officer, Parity`. */
  readonly displayName?: string;
  /** Given name, for a row the server sent without a `displayName`. */
  readonly firstname?: string;
  /** Family name, for a row the server sent without a `displayName`. */
  readonly lastname?: string;
}

/** A loan's lifecycle status as Fineract sends it: the numeric `LoanStatus` id, its `loanStatusType.*` message code, and the server's display text (AAP 0.10.5). */
export interface LoanStatus {
  /** Numeric `LoanStatus` id, one of the values `toLoanStatusKey()` looks up. */
  readonly id: number;
  /** Message code such as `loanStatusType.active`, matched on its whole normalised code. */
  readonly code: string;
  /** Server display text, carried for completeness and deliberately not shown. */
  readonly value: string;
}

/** The five lifecycle commands the loan record's action endpoints take as `?command=` (AAP 0.7.3, "W5 approve and disburse"). */
export type LoanCommand = 'approve' | 'undoapproval' | 'reject' | 'disburse' | 'undodisbursal';

/** The two commands `POST /loans/{id}/charges/{chargeId}?command=` accepts (AAP 0.7.3, "Loan charges"). */
export type LoanChargeActionCommand = 'pay' | 'waive';

/** A partial projection of the envelope every loan action POST returns: the affected entity's id and the field changes the server applied (Rule 1 clause 4). */
export interface LoanActionResult {
  /** Id of the resource the action changed, when the server reports one. */
  readonly resourceId?: number;
  /** Id of the loan the loan endpoints report beside `resourceId`, when they report one. */
  readonly loanId?: number;
  /** Field changes the server applied; read for presence only, never rendered. */
  readonly changes?: Readonly<Record<string, unknown>>;
}

/** The product a loan is written against, as the template names it in `product` and in `productOptions`. */
export interface LoanTemplateProduct extends OptionItem {
  /** Currency of the product, as the template reports it for the loan currency field. */
  readonly currency?: {
    readonly code: string;
  };
}

/** One row of the loan application's charge picker: an option of `charges` / `chargeOptions` with the amount, currency, timing and calculation basis the server attached to it. */
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

/** `GET /loans/template?templateType=individual&clientId=&productId=` — the dropdown options and the defaults the new-loan form is seeded from, and the same shape the edit form is seeded from (AAP 0.7.3, "W4 loan application"). */
export interface LoanTemplate {
  /** Client the loan is opened for, echoed back from the request. */
  readonly clientId?: number;
  /** Client's display name, shown beside the application. */
  readonly clientName?: string;
  /** Office the client belongs to, which scopes the officer and fund lists. */
  readonly clientOfficeId?: number;
  /** The selected product; seeded only when the request names a `productId`. */
  readonly product?: LoanTemplateProduct;
  /** Id of the selected product, which the template sends beside `product` and the application body echoes as its `productId`. */
  readonly productId?: number;
  /** Products the client may be given, rendered as the product dropdown. */
  readonly productOptions: readonly LoanTemplateProduct[];
  /** Default principal, typically the product's default principal; seeded only when the request names a `productId`. */
  readonly principal?: number;
  /** Default term length, in `termPeriodFrequencyType` units — `LoanAccountData.termFrequency` on the template, which `POST /loans` spells `loanTermFrequency` (AAP 0.7.2). */
  readonly termFrequency?: number;
  /** Unit of `termFrequency`, e.g. months — `LoanAccountData.termPeriodFrequencyType` on the template, which `POST /loans` spells `loanTermFrequencyType` and carries as the `id` this object reports, beside the message code. */
  readonly termPeriodFrequencyType?: LoanEnumOption;
  /** Term units the form's picker offers, rendered in the received order. */
  readonly termFrequencyTypeOptions?: readonly LoanEnumOption[];
  /** Default number of repayments; seeded only when the request names a `productId`. */
  readonly numberOfRepayments?: number;
  /** Default interval between repayments; seeded only when the request names a `productId`. */
  readonly repaymentEvery?: number;
  /** Unit of `repaymentEvery`, e.g. months. */
  readonly repaymentFrequencyType?: LoanEnumOption;
  /** Repayment-interval units the form's picker offers, rendered in the received order. */
  readonly repaymentFrequencyTypeOptions?: readonly LoanEnumOption[];
  /** Default nominal interest rate per `interestRateFrequencyType` period; seeded only when the request names a `productId`. */
  readonly interestRatePerPeriod?: number;
  /** Unit of `interestRatePerPeriod`, e.g. per year. */
  readonly interestRateFrequencyType?: LoanEnumOption;
  /** Rate units the form's picker offers, rendered in the received order. */
  readonly interestRateFrequencyTypeOptions?: readonly LoanEnumOption[];
  /** Amortisation method the product prescribes. */
  readonly amortizationType?: LoanEnumOption;
  /** Amortisation methods the form's picker offers, rendered in the received order. */
  readonly amortizationTypeOptions?: readonly LoanEnumOption[];
  /** Interest method the product prescribes. */
  readonly interestType?: LoanEnumOption;
  /** Interest methods the form's picker offers, rendered in the received order. */
  readonly interestTypeOptions?: readonly LoanEnumOption[];
  /** Interest calculation period the product prescribes. */
  readonly interestCalculationPeriodType?: LoanEnumOption;
  /** Interest calculation periods the form's picker offers, rendered in the received order. */
  readonly interestCalculationPeriodTypeOptions?: readonly LoanEnumOption[];
  /** Strategy the template seeds for the selected product, as the code the application posts (AAP 0.7.2). */
  readonly transactionProcessingStrategyCode?: string;
  /** Strategies the form's picker offers, in the received order. */
  readonly transactionProcessingStrategyOptions?: readonly TransactionProcessingStrategyOption[];
  /** The charge rows the payload carries, in the server's order: the loan's own charges on an edit seed, in the same `LoanCharge` shape `LoanAccount.charges` declares, which is why the edit form re-posts them unchanged (AAP 0.7.2). */
  readonly charges?: readonly LoanCharge[];
  /** Charges applicable to the application, offered as the application form's charge picker. */
  readonly chargeOptions?: readonly LoanChargeOption[];
  /** Loan officers the application may be assigned to, labelled by `displayName`. */
  readonly loanOfficerOptions?: readonly LoanOfficerOption[];
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

/** The dated milestones in a loan record's `timeline`, each read with `fromFineractDate` (AAP 0.7.4). */
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

/** A loan account as `GET /loans/{id}?associations=all` returns it — the record the view screen renders — and the same body `GET /loans/{id}?template=true&associations=...` returns to seed the edit form (AAP 0.7.4). */
export interface LoanAccount {
  /** Loan id, the `{id}` of every loan endpoint. */
  readonly id: number;
  /** Account number Fineract assigned, displayed as the record's account reference. */
  readonly accountNo: string;
  /** Client the loan belongs to, which links the record back to the client view. */
  readonly clientId: number;
  /** Client's display name. */
  readonly clientName?: string;
  /** Product id the loan was written against, the fork's `LoanAccountData.loanProductId` — the only product id `GET /loans/{id}` sends, where AAP 0.7.2 names the member `productId`. */
  readonly loanProductId?: number;
  /** Product name, the fork's `LoanAccountData.loanProductName`, where AAP 0.7.2 names the member `productName`; displayed on the record. */
  readonly loanProductName?: string;
  /** The currency the payload reports for the money this record prints — the record's principal and its five summary figures — so the record renders them with the symbol the loan is denominated in and every other surface stays bare, as the legacy record does (Rule 1 clause 3). */
  readonly currency?: LoanCurrency;
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
  /** Repayment schedule: the loan-wide money totals and one row per period, and the only source of the figures the record's summary block prints (see this interface's note on `summary`). */
  readonly repaymentSchedule?: RepaymentSchedule;
  /** Transactions posted against the loan, oldest first as the server returns them. */
  readonly transactions?: readonly LoanTransaction[];
  /** Charges attached to the loan, in the server's order — the rows the record's charge section lists and the set `PUT /loans/{id}` takes back, which is why the edit form re-posts them unchanged. */
  readonly charges?: readonly LoanCharge[];
}

/** `GET /loans/{id}?template=true&associations=charges,collateral,meeting,multiDisburseDetails` — the edit form's one read: the loan record the save re-posts (ids, terms, status, timeline and charges) together with the template members that seed the form (the persisted enumerations, their option lists, the officer and fund pickers). The endpoint answers one shape, so the edit screen reads every member from this type instead of guessing between two (AAP 0.7.3, "Loan edit"). */
export type LoanEditSeed = LoanAccount & LoanTemplate;

/** One row of a repayment schedule — the `periods[]` of `RepaymentSchedule`, and the rows the preview table renders after `POST /loans?command=calculateLoanSchedule` (AAP 0.7.2). */
export interface RepaymentPeriod {
  /** Period number, 1-based; the schedule table's first column. Optional because the fork omits the member on the disbursement pseudo-period: that row carries no period number, so a reader treats a missing one as "not a repayment period" and the cell prints nothing rather than a substituted 0 (Rule 1 clause 3). */
  readonly period?: number;
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
  /** Principal still outstanding after this period, the fork's per-period principal balance. */
  readonly principalOutstanding?: number;
  /** Principal balance the loan still carries after this period, the fork's `LoanSchedulePeriodData.principalLoanBalanceOutstanding`: the member legacy prints in its `label.heading.balanceofloan` ("Balance of Loan") column, which is why both schedules render it as its own column rather than as the row's outstanding total. */
  readonly principalLoanBalanceOutstanding?: number;
  /** Interest still outstanding after this period. */
  readonly interestOutstanding?: number;
  /** Fees still outstanding after this period, the fork's `feeChargesOutstanding`. */
  readonly feeChargesOutstanding?: number;
  /** Penalties still outstanding after this period, the fork's `penaltyChargesOutstanding`. */
  readonly penaltyChargesOutstanding?: number;
  /** Total still outstanding after this period. */
  readonly totalOutstandingForPeriod?: number;
  /** Whether the period has been fully paid. */
  readonly complete: boolean;
}

/** A repayment schedule: the ordered periods, plus the loan-wide money totals the fork returns alongside them (AAP 0.7.2). */
export interface RepaymentSchedule {
  /** Periods in schedule order; the array order is meaningful and is preserved. */
  readonly periods: readonly RepaymentPeriod[];
  /** Total principal disbursed across the loan. */
  readonly totalPrincipalDisbursed?: number;
  /** Total principal the schedule expects to collect. */
  readonly totalPrincipalExpected?: number;
  /** Total principal repaid so far. */
  readonly totalPrincipalPaid?: number;
  /** Total interest charged over the loan's life. */
  readonly totalInterestCharged?: number;
  /** Total fee charges charged over the loan's life. */
  readonly totalFeeChargesCharged?: number;
  /** Total penalty charges charged over the loan's life. */
  readonly totalPenaltyChargesCharged?: number;
  /** Total of every charge and interest amount waived on the loan. */
  readonly totalWaived?: number;
  /** Total written off the loan. */
  readonly totalWrittenOff?: number;
  /** Total the borrower repays, principal and interest and fees together. */
  readonly totalRepaymentExpected?: number;
  /** Total repaid so far, of every component. */
  readonly totalRepayment?: number;
  /** Total still outstanding, the record's outstanding balance. */
  readonly totalOutstanding?: number;
  /** Length of the loan term in days, as the calculation reports it. */
  readonly loanTermInDays?: number;
}

/** A transaction posted against a loan — an `associations=all` record's `transactions[]` and the rows the transaction list renders (AAP 0.7.2). */
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

/** A charge attached to a loan, as the loan's own reads report it: the `charges` array of `GET /loans/{id}?associations=all` and of the edit seed `GET /loans/{id}?template=true&associations=charges,…` (AAP 0.7.2 row `LoanCharge`). */
export interface LoanCharge {
  /** Charge id, the `{chargeId}` of the charge action endpoint. */
  readonly id: number;
  /** Definition id of the charge this loan carries, the fork's `LoanChargeData.chargeId` (AAP 0.7.2). */
  readonly chargeId: number;
  /** Charge name, rendered as the server sent it. */
  readonly name: string;
  /** The currency the payload reports for this charge's own money — `amount`, `amountPaid`, `amountWaived` and `amountOutstanding` — so the record's charge table prefixes their symbol exactly as the legacy table does (Rule 1 clause 3). */
  readonly currency?: LoanCurrency;
  /** Amount charged. */
  readonly amount: number;
  /** The amount the charge is defined with, the fork's `LoanChargeData.amountOrPercentage`: the flat amount of a flat charge, or the percentage of a percentage charge. */
  readonly amountOrPercentage: number;
  /** Amount already paid. */
  readonly amountPaid: number;
  /** Amount waived. */
  readonly amountWaived: number;
  /** Amount still outstanding, which the pay and waive forms act on. */
  readonly amountOutstanding: number;
  /** Whether the charge has been paid in full, the fork's `LoanChargeData.paid`. */
  readonly paid: boolean;
  /** Whether the charge has been waived, the fork's `LoanChargeData.waived`. */
  readonly waived: boolean;
  /** Whether the charge may be paid through an account transfer right now, the fork's `LoanChargeData.chargePayable` — its `isChargePayable()`, which answers true when the charge's payment mode is account transfer and the charge is neither paid nor waived. */
  readonly chargePayable: boolean;
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

/** The charge payload the two charge readers share: the answer of `GET /loans/{id}/charges/template`, which offers the loan's applicable charges as `chargeOptions`, and the answer of `GET /charges/{id}?template=true` (AAP 0.7.3). */
export interface ChargeTemplate {
  /** Charges applicable to the loan, rendered as the charge picker in the received order (AAP 0.7.2). */
  readonly chargeOptions?: readonly LoanChargeOption[];
  /** The charge's own amount, as `GET /charges/{id}?template=true` reports it at the top level — the figure a picked charge seeds into the application's amount field. */
  readonly amount?: number;
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

/* Request bodies. `POST`/`PUT` bodies are assembled by the forms, so, unlike the response models above, they are not `readonly`: a screen builds one member at a time from its form values. One convention holds for every one of them, and it is the one AAP 0.7.2 "Date handling" sets: a request body holds the values the form holds — each date a `Date | null`, `dateFormat` and `locale` required — and `loan.service.ts` converts each date with `toFineractDate(date, locale)` and fills `dateFormat` from `AppConfig` and `locale` from `AppConfigService.activeLocale` at the boundary. No model stores a formatted date, and a body that omitted `dateFormat` or `locale` would not compile. */

/** The body `POST /loans` submits, and the same body `POST /loans?command=calculateLoanSchedule` previews (AAP 0.7.3, "W4 loan application"). */
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
  /** Transaction processing strategy the application is processed under, as the code the template seeded and the server accepts. */
  transactionProcessingStrategyCode: string;
  /** Expected disbursement date the form holds; `null` when its field is empty. */
  expectedDisbursementDate: Date | null;
  /** Submission date the form holds; `null` when its field is empty. */
  submittedOnDate: Date | null;
  /** Loan officer to assign, when one was chosen from `loanOfficerOptions`. */
  loanOfficerId?: number;
  /** Fund to draw on, when one was chosen from `fundOptions`. */
  fundId?: number;
  /** Charges carried by the body, one row per charge, in the order the form lists them (AAP 0.7.2). */
  charges?: readonly {
    /** Loan charge the row keeps, on an edit that re-posts a charge the loan already carries. */
    readonly id?: number;
    /** Charge definition the row applies, the record charge's `chargeId`. */
    readonly chargeId: number;
    /** Amount charged, taken from the record charge's `amountOrPercentage`. */
    readonly amount: number;
    /** Due date of a charge that carries one, held as a `Date` the service formats at the boundary; absent for a charge that falls due on disbursement. */
    readonly dueDate?: Date | null;
  }[];
  /** Payload date format, set by the service from `AppConfig.dateFormat`. */
  dateFormat: AppDateFormat;
  /** Payload locale, set by the service from the active language. */
  locale: string;
}

/** The body `PUT /loans/{id}` submits for a loan edit (AAP 0.7.3, "Loan edit"). */
export type LoanEditRequest = LoanApplicationRequest;

/** The body of one loan lifecycle action, as a discriminated union on the command the endpoint takes in its query string (AAP 0.7.2 row `LoanActionRequest`). */
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
      /** Undoes the approval, returning the loan to pending. The server accepts `note` here and nothing else, which is why this arm carries neither a date nor the `dateFormat`/`locale` pair the dated arms send. */
      command: 'undoapproval';

      /** Free-text note recorded with the action. */
      note?: string;
    }
  | {
      /** Undoes the disbursal; the server takes no body for it. */
      command: 'undodisbursal';
    };

/** The body `POST /loans/{id}/transactions?command=repayment` posts (AAP 0.7.3, "W6 repayment"). */
export interface LoanRepaymentRequest {
  /** Date the repayment is recorded on, as the form holds it; `null` when it is empty. */
  transactionDate: Date | null;
  /** Amount repaid. */
  transactionAmount: number;
  /** Payment type id, taken from the template's `paymentTypeOptions`; the form preselects the first entry and the user may choose another, as the legacy repayment form does (Rule 1 clause 3). */
  paymentTypeId?: number;
  /** Free-text note recorded with the repayment. */
  note?: string;
  /** Payload date format, set by the service from `AppConfig.dateFormat`. */
  dateFormat: AppDateFormat;
  /** Payload locale, set by the service from the active language. */
  locale: string;
}

/** The body `POST /loans/{id}/charges` posts when a charge is added to a loan (AAP 0.7.3, "Loan charges"). */
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

/** The body of one loan-charge action, as a discriminated union on the command `POST /loans/{id}/charges/{loanChargeId}?command=` takes (AAP 0.7.2 row `LoanChargeActionRequest`). **The member sets are the ones the running server accepts**: `pay` takes the booked date beside the format pair and `waive` the format pair alone. */
export type LoanChargeActionRequest =
  | {
      /** Pays the charge's whole outstanding portion. */
      command: 'pay';

      /** Date the payment is recorded on, as the form holds it and `null` while it is empty. */
      transactionDate: Date | null;

      /** Payload date format, set by the service from `AppConfig.dateFormat`. */
      dateFormat: AppDateFormat;

      /** Payload locale, set by the service from the active language. */
      locale: string;
    }
  | {
      /** Waives the charge's whole outstanding portion; it books no money movement and no date. */
      command: 'waive';

      /** Payload date format, set by the service from `AppConfig.dateFormat`. */
      dateFormat: AppDateFormat;

      /** Payload locale, set by the service from the active language. */
      locale: string;
    };

/* Partial projections. The two payloads below are not modelled in full: each endpoint returns more than is read, and only the members listed here are read. Declaring just those meets Rule 1 clause 4 without `any` and without inventing members the run never observed. */

/** A partial projection of `GET /loans/{id}/template?templateType=approval` — the approval form's seed (AAP 0.7.3, "W5 approve and disburse"). */
export interface LoanActionTemplate {
  /** Approval date the template defaults to. */
  approvalDate?: FineractDate;
  /** Expected disbursement date the template defaults to. */
  expectedDisbursementDate?: FineractDate;
  /** Approval amount the template reports. */
  approvalAmount?: number;
}

/** A partial projection of `GET /loans/{id}/transactions/template?command=disburse|repayment` — the seed for the disbursement and repayment forms (AAP 0.7.3, "W5 approve and disburse", "W6 repayment"). */
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

/* Pure helpers. Same input, same output: no clock read, no dependency, no side effect. */

/** The id of a persisted enumeration member, which the fork sends either as a plain number or as the `{id, code, value}` object every `…Options` list is built from (AAP 0.7.2). */
export function readSelectedId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  // `object` exposes no members to a type, so this is the documented boundary where a payload's own shape is read: one assertion to a record of `unknown` values keeps the read below checked.
  const id: unknown = (value as Readonly<Record<string, unknown>>)['id'];

  return typeof id === 'number' && Number.isFinite(id) ? id : null;
}

/** Fineract's `LoanStatus` ids, mapped onto the indicator's four colours. */
const STATUS_BY_ID: Readonly<Partial<Record<string, StatusKey>>> = {
  /** Submitted and pending approval, and approved: the loan is not disbursed yet. */
  '100': 'pending',
  '200': 'pending',

  /** Active, i.e. disbursed. */
  '300': 'active',

  /** Withdrawn by the client and rejected: terminal states that are not closed ones, so they paint `other`, as the shared mapping in `web-ng/src/app/shared/status-key.util.ts` paints the same two codes for the client's accounts tab (AAP 0.2.3). */
  '400': 'other',
  '500': 'other',

  /** Every closed form, including overpaid. */
  '600': 'closed',
  '601': 'closed',
  '602': 'closed',
  '700': 'closed',
};

/** The same colours keyed by a `loanStatusType.*` message code, normalised by `normaliseStatusCode` from `web-ng/src/app/shared/status-key.util.ts` — the one normalisation all three families share: lower-cased, a leading `[a-z]+statustype.` prefix removed, and every non-alphanumeric character stripped, so `loanStatusType.closed.reschedule.outstanding.amount` keys `closedrescheduleoutstandingamount`. The withdrawn and rejected codes answer `other` here too, so a loan paints one colour on its record and on the client's accounts tab. */
const STATUS_BY_NAME: Readonly<Partial<Record<string, StatusKey>>> = {
  submittedandpendingapproval: 'pending',
  approved: 'pending',
  active: 'active',
  withdrawnbyclient: 'other',
  rejected: 'other',
  closedobligationsmet: 'closed',
  closedwrittenoff: 'closed',
  closedrescheduleoutstandingamount: 'closed',
  overpaid: 'closed',
};

/** The indicator colour for a loan status, from either the numeric `LoanStatus` id or a `loanStatusType.*` message code (AAP 0.10.5). */
export function toLoanStatusKey(code: string | number | null | undefined): StatusKey {
  if (code === null || code === undefined) {
    return 'other';
  }

  if (typeof code === 'number') {
    return STATUS_BY_ID[String(code)] ?? 'other';
  }

  const normalised = normaliseStatusCode(code);

  return STATUS_BY_ID[normalised] ?? STATUS_BY_NAME[normalised] ?? 'other';
}
