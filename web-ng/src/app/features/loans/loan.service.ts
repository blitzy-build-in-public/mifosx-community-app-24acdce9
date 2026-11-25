import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { defer, type Observable } from 'rxjs';

import type { AppDateFormat } from '../../core/config/app-config.model';
import { AppConfigService } from '../../core/config/app-config.service';
import { resourceId } from '../../core/http/path-segment.util';
import { toFineractDate } from '../../shared/date-format.util';
import type {
  ChargeTemplate,
  LoanAccount,
  LoanActionResult,
  LoanActionRequest,
  LoanActionTemplate,
  LoanApplicationRequest,
  LoanChargeActionCommand,
  LoanChargeActionRequest,
  LoanChargeRequest,
  LoanCommand,
  LoanRepaymentRequest,
  LoanTemplate,
  LoanTransactionTemplate,
  RepaymentSchedule,
} from './loan.models';

/**
 * A request model without the two members this service writes itself as it serialises: `dateFormat`
 * and `locale`.
 *
 * The conditional is what makes the strip work over a discriminated union. A plain
 * `Omit<A | B, 'dateFormat' | 'locale'>` collapses a union to the members every arm declares — for
 * `LoanActionRequest` that would be `command` alone, and the arms' own fields would be lost — while
 * distributing over the union keeps each arm intact and removes only the pair (AAP 0.7.2 "Date
 * handling"; Rule 1 clause 2).
 */
type WithoutDateGrammar<T> = T extends unknown ? Omit<T, 'dateFormat' | 'locale'> : never;

/**
 * What a repayment form hands {@link LoanService.repay}: the models' `LoanRepaymentRequest` without its
 * `dateFormat` and `locale` members, because this service fills both from the runtime configuration at
 * the boundary where the body is built (AAP 0.7.2 "Date handling", AAP 0.14.1 "Dates never travel as
 * strings built in a template"; Rule 1 clause 2). The screen therefore holds only the values the user
 * typed or chose, plus the `Date | null` its transaction-date field carries, and can never pair a date
 * with a format or a locale that disagrees with it.
 *
 * `paymentTypeId` stays optional here for the reason the model gives: a repayment template that offers
 * no payment type leaves the screen with no choice to send, and Fineract accepts a repayment without
 * one, so the body carries the member only when the form holds a payment type (Rule 1 clause 3;
 * AAP 0.7.2).
 */
export type LoanRepaymentInput = Omit<LoanRepaymentRequest, 'dateFormat' | 'locale'>;

/**
 * What an action screen hands {@link LoanService.action}: `LoanActionRequest` without the format pair,
 * for the reason {@link LoanRepaymentInput} states. Every arm keeps the `command` member that
 * discriminates it — Fineract takes the command from the query string, so the member is dropped as the
 * body is serialised — and the arm's own date as a `Date | null`.
 */
export type LoanActionInput = WithoutDateGrammar<LoanActionRequest>;

/** What the add-charge form hands {@link LoanService.addCharge}: `LoanChargeRequest` without the format pair. */
export type LoanChargeInput = WithoutDateGrammar<LoanChargeRequest>;

/**
 * What the pay and waive screens hand {@link LoanService.chargeAction}: `LoanChargeActionRequest`
 * without the format pair, so a caller supplies the command and, for `pay`, the date it is recorded on,
 * and nothing the endpoint refuses (see `LoanChargeActionRequest`).
 */
export type LoanChargeActionInput = WithoutDateGrammar<LoanChargeActionRequest>;

/**
 * What the application and edit forms hand {@link LoanService.create}, {@link LoanService.previewSchedule}
 * and {@link LoanService.update}: the models' `LoanApplicationRequest` — which is also `LoanEditRequest`,
 * the same body posted to `PUT /loans/{id}` — without its `dateFormat` and `locale` members, because this
 * service fills both from the runtime configuration at the boundary where the body is built (AAP 0.7.2
 * "Date handling", AAP 0.14.1 "Dates never travel as strings built in a template"; Rule 1 clause 2). The
 * screen therefore holds only the values the user typed or chose, plus the `Date | null` each date field
 * carries, and can never pair a date with a format or a locale that disagrees with it.
 */
export type LoanApplicationInput = Omit<LoanApplicationRequest, 'dateFormat' | 'locale'>;

/**
 * The two members every dated loan body carries, set together so the pattern, the month names and the
 * `locale` member cannot disagree (AAP 0.7.2 "Date handling"; Rule 1 clause 2).
 */
interface LoanDateWire {
  /** Always `AppConfig.dateFormat`, the literal `'dd MMMM yyyy'`, never a caller's value. */
  readonly dateFormat: AppDateFormat;

  /** The locale of the selected language, from `AppConfigService.activeLocale`. */
  readonly locale: string;
}

/**
 * `POST /loans` and `POST /loans?command=calculateLoanSchedule` as the body goes on the wire
 * (AAP 0.7.2 row `LoanApplicationRequest`).
 *
 * A date member and an optional member the form left unset are absent rather than empty: that is the
 * body the legacy application transmitted, whose unset form values `JSON.stringify` dropped, and the
 * server's own required-field rule is what reports the gap (Rule 1 clause 3). `principal` carries no
 * bound, because W7 exists to prove Fineract rejects one itself.
 */
interface LoanApplicationBody extends LoanDateWire {
  clientId: number;
  productId: number;
  loanType: 'individual';
  principal: number;
  loanTermFrequency: number;
  loanTermFrequencyType: number;
  numberOfRepayments: number;
  repaymentEvery: number;
  repaymentFrequencyType: number;
  interestRatePerPeriod: number;
  interestRateFrequencyType: number;
  amortizationType: number;
  interestType: number;
  interestCalculationPeriodType: number;
  transactionProcessingStrategyCode: string;
  expectedDisbursementDate?: string | null;
  submittedOnDate?: string | null;
  loanOfficerId?: number;
  fundId?: number;
  charges?: readonly LoanChargeRowBody[];
}

/**
 * One row of an application body's `charges` array, as the wire carries it.
 *
 * A new application names the charge definition and the amount (`{chargeId, amount}`, which
 * `POST /loans` takes). An edit re-posts the charges the loan payload reports in its `charges`
 * member, and such a row also says which loan charge it keeps and when it falls due: `PUT
 * /loans/{id}` treats the array as the loan's **complete** charge set, so an absent array deletes
 * every charge and a row without `id` is deleted and re-created rather than kept (AAP 0.7.2 row
 * `LoanApplicationRequest`; AAP 0.3.4: the running fork's accepted member set wins over the plan's
 * shorthand; Rule 1 clause 2).
 */
interface LoanChargeRowBody {
  /** Loan charge the row keeps, on an edit that re-posts one the loan already carries. */
  id?: number;

  /** Charge definition the row applies, the record charge's own `chargeId`. */
  chargeId: number;

  /** Amount charged, taken from the record charge's `amountOrPercentage`. */
  amount: number;

  /** Due date of a charge that carries one, formatted `dd MMMM yyyy`; absent otherwise. */
  dueDate?: string;
}

/** `POST /loans/{id}?command=approve` as the body goes on the wire. */
interface LoanApproveBody extends LoanDateWire {
  approvedOnDate?: string | null;
  approvedLoanAmount?: number;
  expectedDisbursementDate?: string | null;
  note?: string;
}

/** `POST /loans/{id}?command=reject` as the body goes on the wire. */
interface LoanRejectBody extends LoanDateWire {
  rejectedOnDate?: string | null;
  note?: string;
}

/** `POST /loans/{id}?command=disburse` as the body goes on the wire. */
interface LoanDisburseBody extends LoanDateWire {
  actualDisbursementDate?: string | null;
  transactionAmount?: number;
  fixedEmiAmount?: number;
  note?: string;
}

/**
 * `POST /loans/{id}?command=undoapproval` as the body goes on the wire: the note and nothing else.
 *
 * The command takes no date, so it carries neither a date nor the format pair a dated body sends
 * (AAP 0.7.2 row `LoanActionRequest`).
 */
interface LoanUndoApprovalBody {
  note?: string;
}

/**
 * The empty object `POST /loans/{id}?command=undodisbursal` takes, and the one any undo command posts
 * when the caller supplies no body: the server reads no member of it.
 */
type LoanEmptyBody = Readonly<Record<string, never>>;

/** Every body a lifecycle command can put on the wire, one member shape per command. */
type LoanActionBody =
  | LoanApproveBody
  | LoanRejectBody
  | LoanDisburseBody
  | LoanUndoApprovalBody
  | LoanEmptyBody;

/** `POST /loans/{id}/transactions?command=repayment` as the body goes on the wire. */
interface LoanRepaymentBody extends LoanDateWire {
  transactionDate?: string | null;
  transactionAmount: number;
  /** Present only when the template the form was seeded from offers a payment type (AAP 0.7.2). */
  paymentTypeId?: number;
  note?: string;
}

/** `POST /loans/{id}/charges` as the body goes on the wire. */
interface LoanAddChargeBody extends LoanDateWire {
  chargeId: number;
  amount: number;
  dueDate?: string | null;
}

/**
 * `POST /loans/{id}/charges/{loanChargeId}?command=pay` as the body goes on the wire: the date the
 * payment is recorded on and the format pair, and no amount — the endpoint pays the charge's whole
 * outstanding portion and refuses an `amount` member outright.
 */
interface LoanChargePayBody extends LoanDateWire {
  transactionDate?: string | null;
}

/**
 * `POST /loans/{id}/charges/{loanChargeId}?command=waive` as the body goes on the wire: the format
 * pair alone, because a waiver books no money movement, no date and no payment type.
 */
type LoanChargeWaiveBody = LoanDateWire;

/** Every body a charge action can put on the wire. */
type LoanChargeActionBody = LoanChargePayBody | LoanChargeWaiveBody;

/**
 * The loans family's single typed service: every individual-loan endpoint the in-scope screens use,
 * and the only file in `features/loans/` that imports `HttpClient` or holds a Fineract path.
 *
 * **What it owns.** Fifteen methods, one per endpoint row of AAP 0.7.3 — loan application (W4), loan
 * edit, approve/disburse (W5), repayment (W6), charges, and the server-side validation W7 depends on
 * — plus the loan-charge list the record and the edit read, a template reader per charge picker, and
 * the loan template. Each method composes its whole URL through `AppConfigService.apiUrl()`, so no
 * host, no API-root prefix and no port appears in this file (Rule 2) and the API root cannot drift
 * between features (AAP 0.4.2).
 *
 * **What it deliberately does not do.** It sets no header — the single interceptor attaches
 * `Authorization` and `Fineract-Platform-TenantId`; it catches nothing and notifies nothing — the
 * interceptor maps a Fineract error to `ApiError` and the screen renders it, so a failed action leaves
 * the form's values intact; it retries nothing, caches nothing, cancels nothing and adds no default,
 * so every call the legacy screens make is one call here too (Rule 1 clause 3). It adds no bound to
 * `principal`: W7 exists to prove that Fineract itself rejects a principal above the product maximum
 * and that its `errors[].defaultUserMessage` reaches the user, which a client-side limit would mask
 * (Rule 1 clause 3; AAP 0.7.2). It writes nothing to the console, because a URL carrying a client or
 * loan id, a body or a credential must never reach a log (Rule 1 clause 9).
 *
 * **Dates travel as `Date` until here, and every body is typed where it is built.** A request model
 * holds `Date | null`; each private builder below returns a named wire interface for its own endpoint,
 * converts every date member with `toFineractDate(date, locale)` and sets `dateFormat` and `locale`
 * itself. So no component formats a date, no body can omit the pair Fineract needs to parse one
 * (AAP 0.7.2 "Date handling" and its typed-model rule; Rule 1 clauses 2 and 4), and a member dropped
 * or renamed as a body is built is a compile error rather than a payload only the server notices. The
 * `locale` is the language the user currently has selected, which is also the language the month names
 * are rendered in — pairing English month names with a non-English `locale` is a payload Fineract
 * cannot parse.
 *
 * **The command and the body agree, or nothing is posted.** {@link action} compares the command in its
 * query string with the discriminator inside the body it was handed and throws before any request is
 * issued, because these lifecycle endpoints are not idempotent and one command's payload must never
 * reach another command's endpoint; {@link chargeAction} holds the same invariant for `pay` and
 * `waive`.
 *
 * **One request per click.** Every command here is a single POST, which is what lets a caller's
 * `runOnce` guard keep one click to one request against a non-idempotent action endpoint (AAP 0.1.1).
 *
 * **Every identifier is checked before its URL is composed.** `resourceId` from
 * `core/http/path-segment.util.ts` accepts one or more ASCII digits and refuses anything else, so a
 * crafted `:id` or `:chargeId` cannot move a request to another path on the same host; the check runs
 * inside `defer`, so the refusal reaches the caller as an observable error with no request issued,
 * while a valid id still composes the byte-identical URL legacy sent (Rule 1 clause 2).
 */
@Injectable({ providedIn: 'root' })
export class LoanService {
  private readonly http = inject(HttpClient);

  private readonly config = inject(AppConfigService);

  /**
   * `GET /loans/template?templateType=individual&clientId=&productId=` — the new-loan form's dropdowns
   * and defaults (AAP 0.7.3, "W4 loan application").
   *
   * `productId` is sent only when one is supplied: the first load names the client alone and receives
   * the bare template whose `productOptions` fill the picker, while a product change re-reads the same
   * endpoint with the chosen id to re-seed the product-dependent defaults (AAP 0.3.4 claim 14). An
   * absent parameter rather than an empty one is what the legacy screen sent.
   *
   * @param clientId Client the loan is being opened for.
   * @param productId Product chosen on the form, when one already is.
   * @returns The template's option lists and defaults.
   */
  template(clientId: number | string, productId?: number | string): Observable<LoanTemplate> {
    const params = new HttpParams()
      .set('templateType', 'individual')
      .set('clientId', String(clientId));

    return this.http.get<LoanTemplate>(this.config.apiUrl('/loans/template'), {
      params: productId === undefined ? params : params.set('productId', String(productId)),
    });
  }

  /**
   * `GET /charges/{id}?template=true` — one charge's own terms, which the application's charge picker
   * reads the amount and currency from (AAP 0.7.3, "W4 loan application").
   *
   * @param chargeId Charge picked on the application.
   * @returns The charge template.
   */
  chargeTemplate(chargeId: number | string): Observable<ChargeTemplate> {
    const params = new HttpParams().set('template', 'true');

    return defer(() =>
      this.http.get<ChargeTemplate>(
        this.config.apiUrl(`/charges/${resourceId(chargeId, 'LoanService.chargeTemplate')}`),
        { params },
      ),
    );
  }

  /**
   * `POST /loans?command=calculateLoanSchedule` — the repayment-schedule preview (AAP 0.7.3, "W4 loan
   * application").
   *
   * The body is `toApplicationBody()`, the same serialised object {@link create} posts, so the schedule
   * the user previews is computed from exactly the application the user then submits. That identity is
   * the point of the preview and is what W4 asserts.
   *
   * @param body The application as the form holds it.
   * @returns The calculated schedule.
   */
  previewSchedule(body: LoanApplicationInput): Observable<RepaymentSchedule> {
    const params = new HttpParams().set('command', 'calculateLoanSchedule');

    return this.http.post<RepaymentSchedule>(this.config.apiUrl('/loans'), this.toApplicationBody(body), {
      params,
    });
  }

  /**
   * `POST /loans` — submits the application (AAP 0.7.3, "W4 loan application").
   *
   * No query parameter: submission is the endpoint's default command, and legacy sent none.
   *
   * @param body The application as the form holds it.
   * @returns The created loan's id and the changes the server applied.
   */
  create(body: LoanApplicationInput): Observable<LoanActionResult> {
    return this.http.post<LoanActionResult>(this.config.apiUrl('/loans'), this.toApplicationBody(body));
  }

  /**
   * `GET /loans/{id}?template=true&associations=charges,collateral,meeting,multiDisburseDetails` — the
   * edit form's seed (AAP 0.7.3, "Loan edit").
   *
   * The association list is the one the legacy edit screen sends, kept verbatim; on this fork the
   * answer carries the loan's own terms, the form's option lists (`chargeOptions`, `productOptions`,
   * the frequency, interest, strategy and officer lists) and the loan's `charges`, which the form
   * re-posts unchanged — the same member the legacy edit read out of this seed, and the reason no
   * charge-list request is needed (Rule 1 clauses 2 and 3; AAP 0.7.3 "Loan edit").
   *
   * The return type is the union the agent plan specifies because the same path answers either shape
   * depending on `template=true`; `isLoanAccount()` from `./loan.models` narrows it at the call site
   * rather than this service guessing which one arrived.
   *
   * @param id Loan to read.
   * @returns The edit template, or the loan record when the server answers with one.
   */
  getWithTemplate(id: number | string): Observable<LoanTemplate | LoanAccount> {
    const params = new HttpParams()
      .set('template', 'true')
      .set('associations', 'charges,collateral,meeting,multiDisburseDetails');

    return defer(() =>
      this.http.get<LoanTemplate | LoanAccount>(
        this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.getWithTemplate')}`),
        { params },
      ),
    );
  }

  /**
   * `GET /loans/{id}?associations=all` — the record page's single read, and W6's read-back (AAP 0.7.3,
   * "W6 repayment").
   *
   * `associations=all` carries the repayment schedule, the transactions and the loan's charges — the
   * schedule carries every loan-wide money total the record's summary block prints, and `charges`
   * holds the rows the record's charge section lists (AAP 0.7.3's W6 row names all three).
   *
   * @param id Loan to read.
   * @returns The loan record with its schedule, transactions and charges.
   */
  get(id: number | string): Observable<LoanAccount> {
    const params = new HttpParams().set('associations', 'all');

    return defer(() =>
      this.http.get<LoanAccount>(this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.get')}`), {
        params,
      }),
    );
  }

  /**
   * `PUT /loans/{id}` — saves an edited application (AAP 0.7.3, "Loan edit").
   *
   * The body is the application body unchanged, serialised by the same helper `POST /loans` uses: the
   * server accepts the same field set, and the run confirms from `GET /loans/{id}?template=true`
   * whether the fork marks any member submit-only.
   *
   * Its `charges` member is the loan's **complete** charge set on this endpoint, so the caller re-posts
   * every charge the loan keeps — `{id, chargeId, amount, dueDate}` rows built from the `charges` the
   * loan payload reports, the member the edit seed carries — and an empty array for a loan that
   * carries none. An absent `charges` member answers `{"changes":{"charges":[]}}` and deletes them
   * all, which is why the builder formats a row's date instead of letting it reach the wire as an ISO
   * string (AAP 0.3.4: the running fork's contract wins over the plan's shorthand; Rule 1 clause 2).
   *
   * @param id Loan being edited.
   * @param body The application as the form holds it, its charges included.
   * @returns The loan's id and the changes the server applied.
   */
  update(id: number | string, body: LoanApplicationInput): Observable<LoanActionResult> {
    const payload = this.toApplicationBody(body);

    return defer(() =>
      this.http.put<LoanActionResult>(
        this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.update')}`),
        payload,
      ),
    );
  }

  /**
   * `GET /loans/{id}/template?templateType=approval` — the approve form's defaults (AAP 0.7.3, "W5
   * approve and disburse").
   *
   * It seeds the approval form only. The disbursement form's payment types and default amount come
   * from {@link actionTemplate} with `command=disburse`, never from this response.
   *
   * @param id Loan to approve.
   * @returns The approval template.
   */
  approvalTemplate(id: number | string): Observable<LoanActionTemplate> {
    const params = new HttpParams().set('templateType', 'approval');

    return defer(() =>
      this.http.get<LoanActionTemplate>(
        this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.approvalTemplate')}/template`),
        { params },
      ),
    );
  }

  /**
   * `GET /loans/{id}/transactions/template?command=disburse|repayment` — the disbursement and repayment
   * forms' seed: their payment types, default amount and default date (AAP 0.7.3, "W5 approve and
   * disburse", "W6 repayment").
   *
   * One method serves both commands because it is one endpoint that takes the command as a parameter;
   * a per-command alias would hide that and drift from the legacy resource call.
   *
   * @param id Loan the transaction will be posted against.
   * @param command Which form is being seeded.
   * @returns The transaction template.
   */
  actionTemplate(
    id: number | string,
    command: 'disburse' | 'repayment',
  ): Observable<LoanTransactionTemplate> {
    const params = new HttpParams().set('command', command);

    return defer(() =>
      this.http.get<LoanTransactionTemplate>(
        this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.actionTemplate')}/transactions/template`),
        { params },
      ),
    );
  }

  /**
   * `POST /loans/{id}?command=approve|undoapproval|reject|disburse|undodisbursal` — the five loan
   * lifecycle commands (AAP 0.7.3, "W5 approve and disburse").
   *
   * `command` decides the body: `approve`, `reject` and `disburse` send their own dated body together with
   * the note the form carries, `undoapproval` its note alone, and `undodisbursal` the empty object the
   * server takes — no date, and therefore no `dateFormat`/`locale` pair either.
   * The command is never posted in the body; it travels in the query string.
   *
   * The command in the query string and the command the body describes are checked to be the same one,
   * because the two travel separately and a mismatch would post one action's payload to another
   * action's endpoint — a wrong request against a financial record, refused only after it reached the
   * server. The guard runs before the request is issued and throws, because a caller that passes
   * mismatched arguments has a bug this service cannot resolve. A dated command with no body at all is
   * refused the same way rather than posted as an empty object the server could only answer generically.
   *
   * Exactly one POST per call, which is what the caller's `runOnce` guard relies on to keep one click
   * to one request against an endpoint that is not idempotent.
   *
   * @param id Loan the command applies to.
   * @param command Command to run.
   * @param body The command's body, mandatory for the three dated commands.
   * @returns The affected loan's id and the changes the server applied.
   * @throws Error when the body describes a different command, or when a dated command has no body.
   */
  action(id: number | string, command: LoanCommand, body?: LoanActionInput): Observable<LoanActionResult> {
    const payload = this.toActionBody(command, body);
    const params = new HttpParams().set('command', command);

    return defer(() =>
      this.http.post<LoanActionResult>(
        this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.action')}`),
        payload,
        { params },
      ),
    );
  }

  /**
   * `POST /loans/{id}/transactions?command=repayment` — books a repayment (AAP 0.7.3, "W6 repayment").
   *
   * The amount and the date are the form's own values: the form seeds both from the repayment
   * transaction template — the same `GET /loans/{id}/transactions/template?command=repayment` read that
   * supplies its payment types, whose `amount` and `date` are legacy's own defaults — and the service
   * changes neither. `dateFormat` and `locale` are not the form's to supply: this method writes both
   * from the configuration, which is why it takes {@link LoanRepaymentInput} rather than the full
   * `LoanRepaymentRequest` model.
   *
   * @param id Loan being repaid.
   * @param body The repayment as the form holds it.
   * @returns The loan's id and the changes the server applied.
   */
  repay(id: number | string, body: LoanRepaymentInput): Observable<LoanActionResult> {
    const params = new HttpParams().set('command', 'repayment');
    const payload = this.toRepaymentBody(body);

    return defer(() =>
      this.http.post<LoanActionResult>(
        this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.repay')}/transactions`),
        payload,
        { params },
      ),
    );
  }

  /**
   * `GET /loans/{id}/charges/template` — the charges applicable to this loan, which fill the add-charge
   * form's picker (AAP 0.7.3, "Loan charges").
   *
   * No query parameter: the loan is the path, and legacy asked this endpoint for nothing else.
   *
   * @param id Loan the charge will be added to.
   * @returns The loan's charge template.
   */
  chargeTemplateFor(id: number | string): Observable<ChargeTemplate> {
    return defer(() =>
      this.http.get<ChargeTemplate>(
        this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.chargeTemplateFor')}/charges/template`),
      ),
    );
  }

  /**
   * `POST /loans/{id}/charges` — attaches a charge to a loan (AAP 0.7.3, "Loan charges").
   *
   * `dueDate` is serialised only for a charge that carries a specified due date: the body builder omits a
   * member the form left unset, so a disbursement-timed fee posts no date rather than an empty one.
   *
   * @param id Loan the charge is added to.
   * @param body The charge as the form holds it.
   * @returns The loan's id and the changes the server applied.
   */
  addCharge(id: number | string, body: LoanChargeInput): Observable<LoanActionResult> {
    const payload = this.toAddChargeBody(body);

    return defer(() =>
      this.http.post<LoanActionResult>(
        this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.addCharge')}/charges`),
        payload,
      ),
    );
  }

  /**
   * `POST /loans/{id}/charges/{loanChargeId}?command=pay|waive` — pays or waives a charge's whole
   * outstanding portion (AAP 0.7.3, "Loan charges").
   *
   * `loanChargeId` is the **loan-charge id**: the `id` of the charge row the loan itself carries, which
   * is the `resourceId` `POST /loans/{id}/charges` answers when that charge is added. It is not the
   * charge definition id the picker offered: with the accepted body, `POST /loans/8/charges/1?command=pay`
   * answers 404 "Loan charge with identifier 1 does not exist for loan 8" for a definition that is
   * attached as loan-charge 5, while the same command against `/charges/5` resolves the charge. A
   * caller holding the definition id therefore cannot act on the loan's charge, which is why the
   * parameter is named for the id it takes.
   *
   * The body is the command's own: `pay` books a money movement and carries the date it is recorded on
   * beside the format pair, and `waive` books none and carries the pair alone. Neither sends an amount
   * or a payment type, because the endpoint pays or waives the whole outstanding portion and refuses
   * those members (see `LoanChargeActionRequest`).
   *
   * @param id Loan the charge belongs to.
   * @param loanChargeId The loan's own charge row, as the record reports it and `POST /loans/{id}/charges`
   *   answers it.
   * @param command Action to take.
   * @param body The action as the form holds it.
   * @returns The loan's id and the changes the server applied.
   * @throws Error when the body describes a different command than `command`.
   */
  chargeAction(
    id: number | string,
    loanChargeId: number | string,
    command: LoanChargeActionCommand,
    body: LoanChargeActionInput,
  ): Observable<LoanActionResult> {
    const payload = this.toChargeActionBody(command, body);
    const params = new HttpParams().set('command', command);

    return defer(() => {
      const loan = resourceId(id, 'LoanService.chargeAction');
      const charge = resourceId(loanChargeId, 'LoanService.chargeAction');

      return this.http.post<LoanActionResult>(this.config.apiUrl(`/loans/${loan}/charges/${charge}`), payload, {
        params,
      });
    });
  }

  /**
   * The body `POST /loans` submits and `POST /loans?command=calculateLoanSchedule` previews.
   *
   * Both methods call this one builder, so the preview and the submission are the same object by
   * construction rather than by two field lists that could drift (AAP 0.7.2 row
   * `LoanApplicationRequest`; W4). The caller's own `dateFormat` and `locale` never reach the wire —
   * the pair beside the dates is the one the configuration and the active language fix — so a form
   * cannot describe its dates in a format the server does not read.
   *
   * @param body The application as the form holds it.
   * @returns The wire body: dates formatted, `dateFormat` and `locale` set.
   */
  private toApplicationBody(body: LoanApplicationInput): LoanApplicationBody {
    const dates = this.dateWire();

    return {
      ...dates,
      clientId: body.clientId,
      productId: body.productId,
      loanType: body.loanType,
      principal: body.principal,
      loanTermFrequency: body.loanTermFrequency,
      loanTermFrequencyType: body.loanTermFrequencyType,
      numberOfRepayments: body.numberOfRepayments,
      repaymentEvery: body.repaymentEvery,
      repaymentFrequencyType: body.repaymentFrequencyType,
      interestRatePerPeriod: body.interestRatePerPeriod,
      interestRateFrequencyType: body.interestRateFrequencyType,
      amortizationType: body.amortizationType,
      interestType: body.interestType,
      interestCalculationPeriodType: body.interestCalculationPeriodType,
      transactionProcessingStrategyCode: body.transactionProcessingStrategyCode,
      ...(body.expectedDisbursementDate === null
        ? {}
        : { expectedDisbursementDate: toFineractDate(body.expectedDisbursementDate, dates.locale) }),
      ...(body.submittedOnDate === null
        ? {}
        : { submittedOnDate: toFineractDate(body.submittedOnDate, dates.locale) }),
      ...(body.loanOfficerId === undefined ? {} : { loanOfficerId: body.loanOfficerId }),
      ...(body.fundId === undefined ? {} : { fundId: body.fundId }),
      ...(body.charges === undefined ? {} : { charges: this.toChargeRows(body.charges, dates.locale) }),
    };
  }

  /**
   * The `charges` rows of an application body as the wire carries them: the loan charge's own `id`
   * when the row keeps one, the definition it applies, the amount, and the due date formatted like
   * every other date in the body — a nested `Date` must never reach the wire as the ISO string
   * `JSON.stringify` would make of it while the body declares `dd MMMM yyyy` (AAP 0.14.1 "dates never
   * travel as strings built in a template"; Rule 1 clause 2).
   *
   * A row's unset member is omitted rather than sent as `null`, and an empty array stays an empty
   * array: `PUT /loans/{id}` reads the member as the loan's complete charge set, so the edit form has
   * to be able to say "this loan keeps none" without dropping the member (Rule 1 clause 3).
   *
   * @param rows The rows the form carries, as `LoanApplicationRequest` declares them.
   * @param locale The locale the body carries, so the formatted dates and its month names agree.
   * @returns The rows the payload carries.
   */
  private toChargeRows(
    rows: NonNullable<LoanApplicationRequest['charges']>,
    locale: string,
  ): readonly LoanChargeRowBody[] {
    return rows.map((row) => {
      const dueDate =
        row.dueDate === undefined || row.dueDate === null
          ? null
          : toFineractDate(row.dueDate, locale);

      return {
        ...(row.id === undefined ? {} : { id: row.id }),
        chargeId: row.chargeId,
        amount: row.amount,
        // A date the parser cannot read is left out rather than posted as `null`, the same rule every
        // other member of a body follows; Fineract's own required-field rule then reports it.
        ...(dueDate === null ? {} : { dueDate }),
      };
    });
  }

  /**
   * The two members every dated body carries, read once per body so the pattern, the month names and
   * the `locale` member cannot disagree (AAP 0.7.2 "Date handling"; Rule 1 clause 2).
   *
   * This and the builders below are the only places a date is converted and the only places
   * `dateFormat` and `locale` are written, so a dated body that leaves this service always carries
   * both even though no component supplied them.
   *
   * @returns The format pattern and the active language.
   */
  private dateWire(): LoanDateWire {
    return { dateFormat: this.config.config.dateFormat, locale: this.config.activeLocale() };
  }

  /**
   * The body of one lifecycle command, shaped by the command the union discriminates on.
   *
   * The switch is exhaustive over `LoanActionRequest`, so a command the model gains and this builder
   * does not is a compile error rather than a payload the server has to refuse. `undoapproval` sends
   * its note and nothing else and `undodisbursal` takes no body at all, so neither carries the
   * `dateFormat`/`locale` pair: the server reads no date for them, and the pair would be two members
   * legacy did not send (Rule 1 clause 2).
   *
   * A member the form left unset — an absent optional, or a `null` date — is omitted rather than sent
   * empty, which is the body the legacy application transmitted, whose unset form values
   * `JSON.stringify` dropped; the server's own required-field rule is what reports the gap (Rule 1
   * clause 3).
   *
   * @param command The command the request will name in its query string.
   * @param body The command's body, absent for a caller that supplies none.
   * @returns The wire body for that command.
   * @throws Error when the body describes another command, or when a dated command has no body.
   */
  private toActionBody(command: LoanCommand, body: LoanActionInput | undefined): LoanActionBody {
    if (body === undefined) {
      if (command === 'undoapproval' || command === 'undodisbursal') {
        return {};
      }

      throw new Error(
        `LoanService.action: the '${command}' command sends a dated body and none was supplied. ` +
          'Approve, reject and disburse each post their own date, so no empty payload is sent to an ' +
          'endpoint that cannot act on one.',
      );
    }

    if (body.command !== command) {
      throw new Error(
        `LoanService.action: the body describes the '${body.command}' command but the request issues ` +
          `'${command}'. Post the body that belongs to the command, so one action cannot carry ` +
          "another action's payload.",
      );
    }

    const dates = this.dateWire();

    switch (body.command) {
      case 'approve':
        return {
          ...dates,
          ...(body.approvedOnDate === null
            ? {}
            : { approvedOnDate: toFineractDate(body.approvedOnDate, dates.locale) }),
          ...(body.approvedLoanAmount === undefined
            ? {}
            : { approvedLoanAmount: body.approvedLoanAmount }),
          ...(body.expectedDisbursementDate === null || body.expectedDisbursementDate === undefined
            ? {}
            : { expectedDisbursementDate: toFineractDate(body.expectedDisbursementDate, dates.locale) }),
          ...(body.note === undefined ? {} : { note: body.note }),
        };

      case 'reject':
        return {
          ...dates,
          ...(body.rejectedOnDate === null
            ? {}
            : { rejectedOnDate: toFineractDate(body.rejectedOnDate, dates.locale) }),
          ...(body.note === undefined ? {} : { note: body.note }),
        };

      case 'disburse':
        return {
          ...dates,
          ...(body.actualDisbursementDate === null
            ? {}
            : { actualDisbursementDate: toFineractDate(body.actualDisbursementDate, dates.locale) }),
          ...(body.transactionAmount === undefined ? {} : { transactionAmount: body.transactionAmount }),
          ...(body.fixedEmiAmount === undefined ? {} : { fixedEmiAmount: body.fixedEmiAmount }),
          ...(body.note === undefined ? {} : { note: body.note }),
        };

      case 'undoapproval':
        return body.note === undefined ? {} : { note: body.note };

      case 'undodisbursal':
        return {};
    }
  }

  /**
   * The body `POST /loans/{id}/transactions?command=repayment` posts.
   *
   * The amount, the payment type and the date are the form's own values, sent exactly as it holds
   * them: nothing is rounded, bounded or recomputed here (Rule 1 clause 3). A `null` date is omitted,
   * which leaves the server's own required-field rule to report it, and an absent payment type is
   * omitted for the same reason — the model makes it optional because Fineract accepts a repayment
   * without one, so the legacy body with no payment type stays byte-identical instead of gaining a
   * `null` member the server never receives from legacy (Rule 1 clause 2; AAP 0.7.2).
   *
   * @param body The repayment as the form holds it.
   * @returns The wire body: the date formatted, `dateFormat` and `locale` set.
   */
  private toRepaymentBody(body: LoanRepaymentInput): LoanRepaymentBody {
    const dates = this.dateWire();

    return {
      ...dates,
      ...(body.transactionDate === null
        ? {}
        : { transactionDate: toFineractDate(body.transactionDate, dates.locale) }),
      transactionAmount: body.transactionAmount,
      ...(body.paymentTypeId === undefined ? {} : { paymentTypeId: body.paymentTypeId }),
      ...(body.note === undefined ? {} : { note: body.note }),
    };
  }

  /**
   * The body `POST /loans/{id}/charges` posts when a charge is added.
   *
   * `dueDate` is present only for a charge that falls due on a date the user picked, so a
   * disbursement-timed fee posts no date member rather than an empty one.
   *
   * @param body The charge as the form holds it.
   * @returns The wire body: the due date formatted when it is set, `dateFormat` and `locale` set.
   */
  private toAddChargeBody(body: LoanChargeInput): LoanAddChargeBody {
    const dates = this.dateWire();

    return {
      ...dates,
      chargeId: body.chargeId,
      amount: body.amount,
      ...(body.dueDate === undefined || body.dueDate === null
        ? {}
        : { dueDate: toFineractDate(body.dueDate, dates.locale) }),
    };
  }

  /**
   * The body of one charge action, shaped by the command the union discriminates on.
   *
   * `pay` carries the date the payment is recorded on beside the format pair; `waive` carries the pair
   * alone. Neither carries an amount or a payment type, because the endpoint pays or waives the
   * charge's whole outstanding portion and refuses those members on the parameter binding — so there
   * is nothing here to drop and no member left for a caller to set (see `LoanChargeActionRequest`).
   *
   * @param command The command the request will name in its query string.
   * @param body The action as the form holds it.
   * @returns The wire body for that command.
   * @throws Error when the body describes the other command.
   */
  private toChargeActionBody(
    command: LoanChargeActionCommand,
    body: LoanChargeActionInput,
  ): LoanChargeActionBody {
    if (body.command !== command) {
      throw new Error(
        `LoanService.chargeAction: the body describes the '${body.command}' command but the request ` +
          `issues '${command}'. Post the body that belongs to the command, so one charge action cannot ` +
          "carry another's payload.",
      );
    }

    const dates = this.dateWire();

    switch (body.command) {
      case 'pay':
        return {
          ...dates,
          ...(body.transactionDate === null
            ? {}
            : { transactionDate: toFineractDate(body.transactionDate, dates.locale) }),
        };

      case 'waive':
        return { ...dates };
    }
  }
}

