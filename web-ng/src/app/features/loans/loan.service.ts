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
  LoanEditSeed,
  LoanRepaymentRequest,
  LoanTemplate,
  LoanTransactionTemplate,
  RepaymentSchedule,
} from './loan.models';

/** A request model without the two members this service writes itself as it serialises: `dateFormat` and `locale` (AAP 0.7.2, Rule 1 clause 2). */
type WithoutDateGrammar<T> = T extends unknown ? Omit<T, 'dateFormat' | 'locale'> : never;

/** What a repayment form hands {@link LoanService.repay}: the models' `LoanRepaymentRequest` without its `dateFormat` and `locale` members, because this service fills both from the runtime configuration at the boundary (AAP 0.7.2, AAP 0.14.1, Rule 1 clause 2, Rule 1 clause 3). */
export type LoanRepaymentInput = Omit<LoanRepaymentRequest, 'dateFormat' | 'locale'>;

/** What an action screen hands {@link LoanService.action}: `LoanActionRequest` without the format pair, for the reason {@link LoanRepaymentInput} states. */
export type LoanActionInput = WithoutDateGrammar<LoanActionRequest>;

/** What the add-charge form hands {@link LoanService.addCharge}: `LoanChargeRequest` without the format pair. */
export type LoanChargeInput = WithoutDateGrammar<LoanChargeRequest>;

/** What the pay and waive screens hand {@link LoanService.chargeAction}: `LoanChargeActionRequest` without the format pair, so a caller supplies the command and, for `pay`, the date it is recorded on, and nothing the endpoint refuses (see `LoanChargeActionRequest`). */
export type LoanChargeActionInput = WithoutDateGrammar<LoanChargeActionRequest>;

/** What the application and edit forms hand {@link LoanService.create}, {@link LoanService.previewSchedule} and {@link LoanService.update}: the models' `LoanApplicationRequest` — which is also `LoanEditRequest`, the same body posted to `PUT /loans/{id}` — without its `dateFormat` and `locale` members, because this service fills both at the boundary (AAP 0.7.2, AAP 0.14.1, Rule 1 clause 2). */
export type LoanApplicationInput = Omit<LoanApplicationRequest, 'dateFormat' | 'locale'>;

/** The two members every dated loan body carries, set together so the pattern, the month names and the `locale` member cannot disagree (AAP 0.7.2 "Date handling"; Rule 1 clause 2). */
interface LoanDateWire {
  /** Always `AppConfig.dateFormat`, the literal `'dd MMMM yyyy'`, never a caller's value. */
  readonly dateFormat: AppDateFormat;
  /** The locale of the selected language, from `AppConfigService.activeLocale`. */
  readonly locale: string;
}

/** `POST /loans` and `POST /loans?command=calculateLoanSchedule` as the body goes on the wire (AAP 0.7.2 row `LoanApplicationRequest`) (Rule 1 clause 3). */
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

/** One row of an application body's `charges` array, as the wire carries it (AAP 0.7.2, AAP 0.3.4, Rule 1 clause 2). */
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

/** `POST /loans/{id}?command=undoapproval` as the body goes on the wire: the note and nothing else (AAP 0.7.2). */
interface LoanUndoApprovalBody {
  note?: string;
}

/** The empty object `POST /loans/{id}?command=undodisbursal` takes, and the one any undo command posts when the caller supplies no body: the server reads no member of it. */
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

/** `POST /loans/{id}/charges/{loanChargeId}?command=pay` as the body goes on the wire: the date the payment is recorded on and the format pair, and no amount — the endpoint pays the charge's whole outstanding portion and refuses an `amount` member outright. */
interface LoanChargePayBody extends LoanDateWire {
  transactionDate?: string | null;
}

/** `POST /loans/{id}/charges/{loanChargeId}?command=waive` as the body goes on the wire: the format pair alone, because a waiver books no money movement, no date and no payment type. */
type LoanChargeWaiveBody = LoanDateWire;

/** Every body a charge action can put on the wire. */
type LoanChargeActionBody = LoanChargePayBody | LoanChargeWaiveBody;

/** The loans family's single typed service: every individual-loan endpoint the in-scope screens use, and the only file in `features/loans/` that imports `HttpClient` or holds a Fineract path. **What it owns.** One method per endpoint row of AAP 0.7.3 — the loan application and its schedule preview, the loan edit, the approval and transaction templates, the five lifecycle commands, the repayment and the four charge calls — each composing its whole URL through `AppConfigService.apiUrl()` (AAP 0.7.3, Rule 2, AAP 0.4.2, Rule 1 clause 3). */
@Injectable({ providedIn: 'root' })
export class LoanService {
  private readonly http = inject(HttpClient);

  private readonly config = inject(AppConfigService);

  /** `GET /loans/template?templateType=individual&clientId=&productId=` — the new-loan form's dropdowns and defaults (AAP 0.7.3, "W4 loan application") (AAP 0.3.4). */
  template(clientId: number | string, productId?: number | string): Observable<LoanTemplate> {
    return defer(() => {
      const params = new HttpParams()
        .set('templateType', 'individual')
        .set('clientId', String(clientId));

      return this.http.get<LoanTemplate>(this.config.apiUrl('/loans/template'), {
        params: productId === undefined ? params : params.set('productId', String(productId)),
      });
    });
  }

  /** `GET /charges/{id}?template=true` — one charge's own terms, which the application's charge picker reads the amount and currency from (AAP 0.7.3, "W4 loan application"). @param chargeId Charge picked on the application. @returns The charge template. */
  chargeTemplate(chargeId: number | string): Observable<ChargeTemplate> {
    const params = new HttpParams().set('template', 'true');

    return defer(() =>
      this.http.get<ChargeTemplate>(
        this.config.apiUrl(`/charges/${resourceId(chargeId, 'LoanService.chargeTemplate')}`),
        { params },
      ),
    );
  }

  /** `POST /loans?command=calculateLoanSchedule` — the repayment-schedule preview (AAP 0.7.3, "W4 loan application"). */
  previewSchedule(body: LoanApplicationInput): Observable<RepaymentSchedule> {
    return defer(() =>
      this.http.post<RepaymentSchedule>(this.config.apiUrl('/loans'), this.toApplicationBody(body), {
        params: new HttpParams().set('command', 'calculateLoanSchedule'),
      }),
    );
  }

  /** `POST /loans` — submits the application (AAP 0.7.3, "W4 loan application"). */
  create(body: LoanApplicationInput): Observable<LoanActionResult> {
    return defer(() =>
      this.http.post<LoanActionResult>(this.config.apiUrl('/loans'), this.toApplicationBody(body)),
    );
  }

  /** `GET /loans/{id}?template=true&associations=charges,collateral,meeting,multiDisburseDetails` — the edit form's seed, the loan record and its template members in the one shape the endpoint answers (AAP 0.7.3, "Loan edit"). */
  getWithTemplate(id: number | string): Observable<LoanEditSeed> {
    const params = new HttpParams()
      .set('template', 'true')
      .set('associations', 'charges,collateral,meeting,multiDisburseDetails');

    return defer(() =>
      this.http.get<LoanEditSeed>(
        this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.getWithTemplate')}`),
        { params },
      ),
    );
  }

  /** `GET /loans/{id}?associations=all` — the record page's single read, and W6's read-back (AAP 0.7.3, "W6 repayment"). */
  get(id: number | string): Observable<LoanAccount> {
    const params = new HttpParams().set('associations', 'all');

    return defer(() =>
      this.http.get<LoanAccount>(this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.get')}`), {
        params,
      }),
    );
  }

  /** `PUT /loans/{id}` — saves an edited application (AAP 0.7.3, "Loan edit") (AAP 0.3.4, Rule 1 clause 2). */
  update(id: number | string, body: LoanApplicationInput): Observable<LoanActionResult> {
    return defer(() =>
      this.http.put<LoanActionResult>(
        this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.update')}`),
        this.toApplicationBody(body),
      ),
    );
  }

  /** `GET /loans/{id}/template?templateType=approval` — the approve form's defaults (AAP 0.7.3, "W5 approve and disburse"). */
  approvalTemplate(id: number | string): Observable<LoanActionTemplate> {
    const params = new HttpParams().set('templateType', 'approval');

    return defer(() =>
      this.http.get<LoanActionTemplate>(
        this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.approvalTemplate')}/template`),
        { params },
      ),
    );
  }

  /** `GET /loans/{id}/transactions/template?command=disburse|repayment` — the disbursement and repayment forms' seed: their payment types, default amount and default date (AAP 0.7.3, "W5 approve and disburse", "W6 repayment"). */
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

  /** `POST /loans/{id}?command=approve|undoapproval|reject|disburse|undodisbursal` — the five loan lifecycle commands (AAP 0.7.3, "W5 approve and disburse"). */
  action(id: number | string, command: LoanCommand, body?: LoanActionInput): Observable<LoanActionResult> {
    return defer(() => {
      const payload = this.toActionBody(command, body);
      const params = new HttpParams().set('command', command);

      return this.http.post<LoanActionResult>(
        this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.action')}`),
        payload,
        { params },
      );
    });
  }

  /** `POST /loans/{id}/transactions?command=repayment` — books a repayment (AAP 0.7.3, "W6 repayment"). */
  repay(id: number | string, body: LoanRepaymentInput): Observable<LoanActionResult> {
    return defer(() => {
      const params = new HttpParams().set('command', 'repayment');
      const payload = this.toRepaymentBody(body);

      return this.http.post<LoanActionResult>(
        this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.repay')}/transactions`),
        payload,
        { params },
      );
    });
  }

  /** `GET /loans/{id}/charges/template` — the charges applicable to this loan, which fill the add-charge form's picker (AAP 0.7.3, "Loan charges"). */
  chargeTemplateFor(id: number | string): Observable<ChargeTemplate> {
    return defer(() =>
      this.http.get<ChargeTemplate>(
        this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.chargeTemplateFor')}/charges/template`),
      ),
    );
  }

  /** `POST /loans/{id}/charges` — attaches a charge to a loan (AAP 0.7.3, "Loan charges"). */
  addCharge(id: number | string, body: LoanChargeInput): Observable<LoanActionResult> {
    return defer(() =>
      this.http.post<LoanActionResult>(
        this.config.apiUrl(`/loans/${resourceId(id, 'LoanService.addCharge')}/charges`),
        this.toAddChargeBody(body),
      ),
    );
  }

  /** `POST /loans/{id}/charges/{loanChargeId}?command=pay|waive` — pays or waives a charge's whole outstanding portion (AAP 0.7.3, "Loan charges"). */
  chargeAction(
    id: number | string,
    loanChargeId: number | string,
    command: LoanChargeActionCommand,
    body: LoanChargeActionInput,
  ): Observable<LoanActionResult> {
    return defer(() => {
      const loan = resourceId(id, 'LoanService.chargeAction');
      const charge = resourceId(loanChargeId, 'LoanService.chargeAction');
      const params = new HttpParams().set('command', command);
      const payload = this.toChargeActionBody(command, body);

      return this.http.post<LoanActionResult>(
        this.config.apiUrl(`/loans/${loan}/charges/${charge}`),
        payload,
        { params },
      );
    });
  }

  /** The body `POST /loans` submits and `POST /loans?command=calculateLoanSchedule` previews (AAP 0.7.2). */
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
      ...this.dateMember('expectedDisbursementDate', body.expectedDisbursementDate, dates.locale),
      ...this.dateMember('submittedOnDate', body.submittedOnDate, dates.locale),
      ...(body.loanOfficerId === undefined ? {} : { loanOfficerId: body.loanOfficerId }),
      ...(body.fundId === undefined ? {} : { fundId: body.fundId }),
      ...(body.charges === undefined ? {} : { charges: this.toChargeRows(body.charges, dates.locale) }),
    };
  }

  /** The `charges` rows of an application body as the wire carries them: the loan charge's own `id` when the row keeps one, the definition it applies, the amount, and the due date formatted like every other date in the body (AAP 0.14.1, Rule 1 clause 2, Rule 1 clause 3). */
  private toChargeRows(
    rows: NonNullable<LoanApplicationRequest['charges']>,
    locale: string,
  ): readonly LoanChargeRowBody[] {
    return rows.map((row) => ({
      ...(row.id === undefined ? {} : { id: row.id }),
      chargeId: row.chargeId,
      amount: row.amount,
      ...this.dateMember('dueDate', row.dueDate, locale),
    }));
  }

  /**
   * One dated member of a body: the date formatted with the body's `dateFormat` and `locale`, or no member at all when the form holds no date or the value is one the parser cannot read. The formatted value is
   * computed first and the member spread only when it exists, so no dated member of any body reaches the wire as `null`: Fineract's own required-field rule then reports the missing date, where a `null` would
   * be a value the server has to interpret (AAP 0.7.2 "Date handling", Rule 1 clause 2).
   *
   */
  private dateMember<K extends string>(
    key: K,
    value: Date | null | undefined,
    locale: string,
  ): Partial<Record<K, string>> {
    const formatted = toFineractDate(value, locale);

    if (formatted === null) {
      return {};
    }

    const member: Partial<Record<K, string>> = {};
    member[key] = formatted;

    return member;
  }

  /** The two members every dated body carries, read once per body so the pattern, the month names and the `locale` member cannot disagree (AAP 0.7.2 "Date handling"; Rule 1 clause 2). */
  private dateWire(): LoanDateWire {
    return { dateFormat: this.config.config.dateFormat, locale: this.config.activeLocale() };
  }

  /** The body of one lifecycle command, shaped by the command the union discriminates on (Rule 1 clause 2, Rule 1 clause 3). */
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
          ...this.dateMember('approvedOnDate', body.approvedOnDate, dates.locale),
          ...(body.approvedLoanAmount === undefined
            ? {}
            : { approvedLoanAmount: body.approvedLoanAmount }),
          ...this.dateMember(
            'expectedDisbursementDate',
            body.expectedDisbursementDate,
            dates.locale,
          ),
          ...(body.note === undefined ? {} : { note: body.note }),
        };

      case 'reject':
        return {
          ...dates,
          ...this.dateMember('rejectedOnDate', body.rejectedOnDate, dates.locale),
          ...(body.note === undefined ? {} : { note: body.note }),
        };

      case 'disburse':
        return {
          ...dates,
          ...this.dateMember('actualDisbursementDate', body.actualDisbursementDate, dates.locale),
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

  /** The body `POST /loans/{id}/transactions?command=repayment` posts (Rule 1 clause 3, Rule 1 clause 2, AAP 0.7.2). */
  private toRepaymentBody(body: LoanRepaymentInput): LoanRepaymentBody {
    const dates = this.dateWire();

    return {
      ...dates,
      ...this.dateMember('transactionDate', body.transactionDate, dates.locale),
      transactionAmount: body.transactionAmount,
      ...(body.paymentTypeId === undefined ? {} : { paymentTypeId: body.paymentTypeId }),
      ...(body.note === undefined ? {} : { note: body.note }),
    };
  }

  /** The body `POST /loans/{id}/charges` posts when a charge is added. */
  private toAddChargeBody(body: LoanChargeInput): LoanAddChargeBody {
    const dates = this.dateWire();

    return {
      ...dates,
      chargeId: body.chargeId,
      amount: body.amount,
      ...this.dateMember('dueDate', body.dueDate, dates.locale),
    };
  }

  /** The body of one charge action, shaped by the command the union discriminates on. */
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
          ...this.dateMember('transactionDate', body.transactionDate, dates.locale),
        };

      case 'waive':
        return { ...dates };
    }
  }
}

