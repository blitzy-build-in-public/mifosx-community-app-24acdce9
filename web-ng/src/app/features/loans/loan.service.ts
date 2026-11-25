import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import { AppConfigService } from '../../core/config/app-config.service';
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
  LoanEditRequest,
  LoanRepaymentRequest,
  LoanTemplate,
  LoanTransactionTemplate,
  RepaymentSchedule,
} from './loan.models';

/**
 * The one member of a request body that never reaches the wire.
 *
 * `command` discriminates `LoanActionRequest` and `LoanChargeActionRequest` inside this application,
 * while Fineract takes it from the query string — `POST /loans/{id}?command=approve` — exactly as the
 * legacy resource calls do. Posting it as well would add a body member the legacy body never carried
 * (Rule 1 clause 2).
 */
const COMMAND_MEMBER = 'command';

/**
 * The two members a `?command=waive` body must not carry.
 *
 * Waiving a charge books no money movement, so the server takes the amount alone and rejects a booked
 * date or payment type beside it (AAP 0.7.3, "Loan charges"). They are dropped here rather than trusted
 * to be absent, because a caller can hold an object wider than the waive arm of the union.
 */
const WAIVE_OMITTED_MEMBERS: readonly string[] = ['transactionDate', 'paymentTypeId'];

/**
 * What a repayment form hands {@link LoanService.repay}: the models' `LoanRepaymentRequest` without its
 * `dateFormat` and `locale` members, because this service fills both from the runtime configuration at
 * the boundary where the body is built (AAP 0.7.2 "Date handling", AAP 0.14.1 "Dates never travel as
 * strings built in a template"; Rule 1 clause 2). The screen therefore holds only the values the user
 * typed or chose, plus the `Date | null` its transaction-date field carries, and can never pair a date
 * with a format or a locale that disagrees with it.
 */
export type LoanRepaymentInput = Omit<LoanRepaymentRequest, 'dateFormat' | 'locale'>;

/**
 * The loans family's single typed service: every individual-loan endpoint the in-scope screens use,
 * and the only file in `features/loans/` that imports `HttpClient` or holds a Fineract path.
 *
 * **What it owns.** Fourteen methods, one per endpoint row of AAP 0.7.3 — loan application (W4), loan
 * edit, approve/disburse (W5), repayment (W6), charges, and the server-side validation W7 depends on
 * — plus two template readers the charge pickers need. Each method composes its whole URL through
 * `AppConfigService.apiUrl()`, so no host, no API-root prefix and no port appears in this file
 * (Rule 2) and the API root cannot drift between features (AAP 0.4.2).
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
 * **Dates travel as `Date` until here.** A request model holds `Date | null`; the serialisers below
 * convert every date member with `toFineractDate(date, locale)` and set `dateFormat` and `locale`
 * themselves, so no component formats a date and no body can omit the pair Fineract needs to parse
 * one (AAP 0.7.2, "Date handling"; Rule 1 clause 2). The `locale` is the language the user currently
 * has selected, which is also the language the month names are rendered in — pairing English month
 * names with a non-English `locale` is a payload Fineract cannot parse.
 *
 * **One request per click.** Every command here is a single POST, which is what lets a caller's
 * `runOnce` guard keep one click to one request against a non-idempotent action endpoint (AAP 0.1.1).
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

    return this.http.get<ChargeTemplate>(this.config.apiUrl(`/charges/${chargeId}`), { params });
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
  previewSchedule(body: LoanApplicationRequest): Observable<RepaymentSchedule> {
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
  create(body: LoanApplicationRequest): Observable<LoanActionResult> {
    return this.http.post<LoanActionResult>(this.config.apiUrl('/loans'), this.toApplicationBody(body));
  }

  /**
   * `GET /loans/{id}?template=true&associations=charges,collateral,meeting,multiDisburseDetails` — the
   * edit form's seed (AAP 0.7.3, "Loan edit").
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

    return this.http.get<LoanTemplate | LoanAccount>(this.config.apiUrl(`/loans/${id}`), { params });
  }

  /**
   * `GET /loans/{id}?associations=all` — the record page's single read, and W6's read-back (AAP 0.7.3,
   * "W6 repayment").
   *
   * `associations=all` carries the repayment schedule, the transactions and the charges in one answer,
   * so the record's three sections come from one request and no second call is added for any of them.
   *
   * @param id Loan to read.
   * @returns The loan record with its schedule, transactions and charges.
   */
  get(id: number | string): Observable<LoanAccount> {
    const params = new HttpParams().set('associations', 'all');

    return this.http.get<LoanAccount>(this.config.apiUrl(`/loans/${id}`), { params });
  }

  /**
   * `PUT /loans/{id}` — saves an edited application (AAP 0.7.3, "Loan edit").
   *
   * The body is the application body unchanged, serialised by the same helper `POST /loans` uses: the
   * server accepts the same field set, and the run confirms from `GET /loans/{id}?template=true`
   * whether the fork marks any member submit-only.
   *
   * @param id Loan being edited.
   * @param body The application as the form holds it.
   * @returns The loan's id and the changes the server applied.
   */
  update(id: number | string, body: LoanEditRequest): Observable<LoanActionResult> {
    return this.http.put<LoanActionResult>(this.config.apiUrl(`/loans/${id}`), this.toApplicationBody(body));
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

    return this.http.get<LoanActionTemplate>(this.config.apiUrl(`/loans/${id}/template`), { params });
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

    return this.http.get<LoanTransactionTemplate>(this.config.apiUrl(`/loans/${id}/transactions/template`), {
      params,
    });
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
   * Exactly one POST per call, which is what the caller's `runOnce` guard relies on to keep one click
   * to one request against an endpoint that is not idempotent.
   *
   * @param id Loan the command applies to.
   * @param command Command to run.
   * @param body The command's body, mandatory for the three dated commands.
   * @returns The affected loan's id and the changes the server applied.
   */
  action(id: number | string, command: LoanCommand, body?: LoanActionRequest): Observable<LoanActionResult> {
    const params = new HttpParams().set('command', command);

    return this.http.post<LoanActionResult>(this.config.apiUrl(`/loans/${id}`), this.toActionBody(body), { params });
  }

  /**
   * `POST /loans/{id}/transactions?command=repayment` — books a repayment (AAP 0.7.3, "W6 repayment").
   *
   * The amount and the date are the form's own values: the form seeds them from the schedule's first
   * period and the run date, and the service changes neither. `dateFormat` and `locale` are not the
   * form's to supply — this method writes both from the configuration, which is why it takes
   * {@link LoanRepaymentInput} rather than the full `LoanRepaymentRequest` model.
   *
   * @param id Loan being repaid.
   * @param body The repayment as the form holds it.
   * @returns The loan's id and the changes the server applied.
   */
  repay(id: number | string, body: LoanRepaymentInput): Observable<LoanActionResult> {
    const params = new HttpParams().set('command', 'repayment');

    return this.http.post<LoanActionResult>(this.config.apiUrl(`/loans/${id}/transactions`), this.toDatedBody(body), {
      params,
    });
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
    return this.http.get<ChargeTemplate>(this.config.apiUrl(`/loans/${id}/charges/template`));
  }

  /**
   * `POST /loans/{id}/charges` — attaches a charge to a loan (AAP 0.7.3, "Loan charges").
   *
   * `dueDate` is serialised only for a charge that carries a specified due date: the serialiser omits a
   * member the form left unset, so a disbursement-timed fee posts no date rather than an empty one.
   *
   * @param id Loan the charge is added to.
   * @param body The charge as the form holds it.
   * @returns The loan's id and the changes the server applied.
   */
  addCharge(id: number | string, body: LoanChargeRequest): Observable<LoanActionResult> {
    return this.http.post<LoanActionResult>(this.config.apiUrl(`/loans/${id}/charges`), this.toDatedBody(body));
  }

  /**
   * `POST /loans/{id}/charges/{chargeId}?command=pay|waive` — pays or waives a charge's outstanding
   * portion (AAP 0.7.3, "Loan charges").
   *
   * `pay` books a money movement and sends its amount, date and payment type; `waive` books none, so the
   * date and payment type are dropped from the body even when the caller left them set, because the
   * server rejects them beside `command=waive`.
   *
   * @param id Loan the charge belongs to.
   * @param chargeId Charge being acted on.
   * @param command Action to take.
   * @param body The action as the form holds it.
   * @returns The loan's id and the changes the server applied.
   */
  chargeAction(
    id: number | string,
    chargeId: number | string,
    command: LoanChargeActionCommand,
    body: LoanChargeActionRequest,
  ): Observable<LoanActionResult> {
    const params = new HttpParams().set('command', command);
    const payload = this.toDatedBody(body, command === 'waive' ? WAIVE_OMITTED_MEMBERS : []);

    return this.http.post<LoanActionResult>(this.config.apiUrl(`/loans/${id}/charges/${chargeId}`), payload, {
      params,
    });
  }

  /**
   * The body `POST /loans` submits and `POST /loans?command=calculateLoanSchedule` previews.
   *
   * Both methods call this one helper, so the preview and the submission are the same object by
   * construction rather than by two field lists that could drift (AAP 0.7.2; W4).
   *
   * @param body The application as the form holds it.
   * @returns The wire body: dates formatted, `dateFormat` and `locale` set.
   */
  private toApplicationBody(body: LoanApplicationRequest): Record<string, unknown> {
    return this.toDatedBody(body);
  }

  /**
   * The body of one lifecycle command, shaped by the command the union discriminates on.
   *
   * `undoapproval` sends its note and nothing else, and `undodisbursal` takes no body at all, so neither
   * goes through the dated serialiser: the server takes no date for them and a `dateFormat`/`locale`
   * pair it never reads would be two members legacy did not send (Rule 1 clause 2).
   *
   * @param body The command's body, absent for a caller that supplies none.
   * @returns The wire body for that command.
   */
  private toActionBody(body: LoanActionRequest | undefined): Record<string, unknown> {
    if (body === undefined) {
      return {};
    }

    if (body.command === 'undoapproval') {
      return body.note === undefined ? {} : { note: body.note };
    }

    if (body.command === 'undodisbursal') {
      return {};
    }

    return this.toDatedBody(body);
  }

  /**
   * Serialises a dated request body: every `Date` member formatted for Fineract, `dateFormat` and
   * `locale` set unconditionally, and nothing else touched.
   *
   * This is the only place a date is converted and the only place the two locale members are written,
   * so a date-bearing body that reached this service always carries both even though the component
   * never supplied them (AAP 0.7.2, "Date handling"; Rule 1 clause 2). The `locale` is read once and
   * used for both the month names and the payload member, so the two cannot disagree.
   *
   * A member the caller left unset — absent, `undefined`, or a `null` date — is omitted rather than
   * sent empty: that is the body the legacy application transmitted, whose unset form values
   * `JSON.stringify` dropped, and the server's own required-field rule is what reports the absence
   * (Rule 1 clause 3). The union's `command` member is omitted too, because it travels in the query
   * string. No amount is bound, rounded or defaulted.
   *
   * @param body The request body as the component assembled it.
   * @param omitted Members this endpoint must not receive, on top of `command`.
   * @returns The wire body.
   */
  private toDatedBody<T extends object>(body: T, omitted: readonly string[] = []): Record<string, unknown> {
    const locale = this.config.activeLocale();
    const dropped = new Set<string>([COMMAND_MEMBER, ...omitted]);
    const serialised: Record<string, unknown> = {};
    // `Object.entries` types a plain `object`'s values as `any`; widening the pairs here keeps every
    // read below a checked `unknown` the loop narrows, rather than a value the compiler cannot follow.
    const entries: readonly (readonly [string, unknown])[] = Object.entries(body);

    for (const [key, value] of entries) {
      if (dropped.has(key) || value === undefined || value === null) {
        continue;
      }

      serialised[key] = value instanceof Date ? toFineractDate(value, locale) : value;
    }

    serialised['dateFormat'] = this.config.config.dateFormat;
    serialised['locale'] = locale;

    return serialised;
  }
}

