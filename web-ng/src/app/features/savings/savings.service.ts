import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { defer, map, type Observable } from 'rxjs';

import type { AppDateFormat } from '../../core/config/app-config.model';
import { AppConfigService } from '../../core/config/app-config.service';
import { resourceId } from '../../core/http/path-segment.util';
import { toFineractDate } from '../../shared/date-format.util';
import type {
  SavingsAccount,
  SavingsActivateRequest,
  SavingsApplicationRequest,
  SavingsApproveRequest,
  SavingsCommand,
  SavingsTemplate,
  SavingsTransactionCommand,
  SavingsTransactionRequest,
  SavingsTransactionTemplate,
} from './savings.models';

/**
 * The saving-accounts family's single typed Fineract service — workflow W8: open an account, approve
 * it, activate it, deposit, withdraw, then read the record back with its summary and transactions
 * (AAP 0.9.1 scope group 4, AAP 0.10.1 W8 row, AAP 0.7.3 "W8 savings (Stretch)").
 *
 * **The only file in this folder that owns a Fineract URL.** Every path is composed here through
 * `AppConfigService.apiUrl()`, which joins the configured host and API root, so the literal written
 * below is the literal that leaves the browser and the literal `npm run check:endpoints` matches
 * against `tools/parity/endpoint-allowlist.json` (Rule 1 clause 2; AAP 0.4.2, AAP 0.8.2). The flat
 * ESLint config exempts exactly this path, with the six other URL owners, from the `HttpClient` ban;
 * every component and route in `features/savings/` reaches Fineract through this service (Rule 1
 * clause 5).
 *
 * **Dates are formatted here and never in a template.** A screen hands over the `Date | null` its
 * field holds — the `*Input` types below are the models' request shapes without their two format
 * members — and `dateFields()` writes that value as `dd MMMM yyyy` in the active locale beside
 * `dateFormat` and `locale` on every body that carries a date, which is the payload contract the
 * legacy screens send (Rule 1 clause 2; AAP 0.7.2 "Date handling", AAP 0.14.1).
 *
 * **Nothing is composed until the returned observable is subscribed.** Every call below wraps its
 * whole request — the URL, the `HttpParams`, the body and the locale its date is written in — in
 * `defer`, so `AppConfigService.apiUrl()`, which throws until the configuration has resolved, and the
 * active locale, which the user may change while a form is open, are both read at subscribe time
 * rather than when the method is called (Rule 1 clause 2; AAP 0.7.2 "Date handling").
 *
 * **Errors are values, not exceptions.** Nothing here maps, retries, caches or swallows a failure:
 * the application's single interceptor turns a Fineract body into an `ApiError` that the screen
 * renders verbatim, and it is the only place the auth and tenant headers exist (AAP 0.4.2, AAP 0.7.4;
 * Rule 1 clauses 2 and 9). A `catchError` in this file would hide the server message the workflow
 * depends on.
 *
 * **Every identifier is checked before its URL is composed.** `resourceId` from
 * `core/http/path-segment.util.ts` accepts one or more ASCII digits and refuses anything else, so a
 * crafted `:id` from the record route cannot move a request to another path on the same host; the
 * check runs inside `defer`, so the refusal reaches the caller as an observable error with no request
 * issued, while a valid id still composes the byte-identical URL legacy sent (Rule 1 clause 2).
 *
 * **Two command spellings stay apart on purpose.** The account endpoint takes
 * `command=approve|activate` and the transactions endpoint takes `command=deposit|withdrawal`, while
 * the route segment a user sees is `withdraw` (AAP 0.7.3, AAP 0.8.2); `withdrawal` is never
 * normalised into the other spelling. Nothing is logged, and no credential, tenant value or session
 * material is named here (Rule 1 clause 9).
 */

/**
 * What the new-application screen hands `create()`: the models' `SavingsApplicationRequest` without
 * its `dateFormat` and `locale` members, because this service fills both from the runtime
 * configuration at the boundary where the body is built (AAP 0.7.2 "Date handling", AAP 0.14.1
 * "Dates never travel as strings built in a template"). A screen therefore holds only the values a
 * user typed or chose, plus the `Date | null` its submitted-on field carries.
 */
export type SavingsApplicationInput = Omit<SavingsApplicationRequest, 'dateFormat' | 'locale'>;

/**
 * What an action screen hands `action()`: one of the two lifecycle bodies without its format
 * members, for the same reason as `SavingsApplicationInput`. The union is discriminated by which date
 * member it carries — `approvedOnDate` for `approve`, `activatedOnDate` for `activate` — which is how
 * `action()` narrows it without a cast (see `actionBody()`).
 */
export type SavingsActionInput =
  | Omit<SavingsApproveRequest, 'dateFormat' | 'locale'>
  | Omit<SavingsActivateRequest, 'dateFormat' | 'locale'>;

/**
 * What a deposit or withdrawal form hands `transaction()`: the models' `SavingsTransactionRequest`
 * without its format members. The amount travels exactly as the user entered it — no range and no
 * balance check is added, because the server owns both rules and the legacy screen adds neither
 * (Rule 1 clause 3).
 */
export type SavingsTransactionInput = Omit<SavingsTransactionRequest, 'dateFormat' | 'locale'>;

/**
 * Fineract's create envelope: the whole body `POST /savingsaccounts` answers with, of which the
 * screen reads `resourceId` — the new account's id, and so the route parameter of the record it
 * navigates to next. Declared here rather than in `savings.models.ts` because it belongs to the write
 * this service performs, not to a screen's projection of the account.
 */
export interface SavingsCreateResult {
  /** Identifier of the account the server has just created. */
  readonly resourceId: number;
}

/**
 * The three members every date-bearing savings body carries, assembled in one place by
 * `dateFields()`: the formatted value, the format it was written in and the language it was written
 * in (AAP 0.7.3, "Rules that apply to every call").
 */
interface SavingsDateFields {
  /** The field's date as `dd MMMM yyyy` in `locale`, or `null` when the field held none. */
  readonly value: string | null;

  /** Format `value` was written in; the one the configuration fixes. */
  readonly dateFormat: AppDateFormat;

  /** Language `value` was written in — the locale the same body declares. */
  readonly locale: string;
}

/**
 * The wire body of `POST /savingsaccounts`: `SavingsApplicationRequest` with its date serialised, as
 * the server parses it (Rule 1 clause 2).
 */
interface SavingsApplicationBody {
  readonly clientId: number;
  readonly productId: number;
  readonly submittedOnDate: string | null;
  readonly dateFormat: AppDateFormat;
  readonly locale: string;
}

/** The wire body of `POST /savingsaccounts/{id}?command=approve`. */
interface SavingsApproveBody {
  readonly approvedOnDate: string | null;
  readonly dateFormat: AppDateFormat;
  readonly locale: string;
}

/** The wire body of `POST /savingsaccounts/{id}?command=activate`. */
interface SavingsActivateBody {
  readonly activatedOnDate: string | null;
  readonly dateFormat: AppDateFormat;
  readonly locale: string;
}

/** The wire body of `POST /savingsaccounts/{id}/transactions?command=deposit|withdrawal`. */
interface SavingsTransactionBody {
  readonly transactionDate: string | null;

  readonly transactionAmount: number;

  /**
   * Payment type the form named, or `null` when it named none — the member stays on the wire in
   * that case rather than being omitted, so the server's own required-field rule reports the
   * absence (Rule 1 clause 3, AAP 0.4.4 decision 6).
   */
  readonly paymentTypeId: number | null;

  readonly dateFormat: AppDateFormat;

  readonly locale: string;
}

/**
 * The saving-accounts family's typed Fineract client: the calls of workflow W8 and nothing else
 * (AAP 0.9.2 keeps interest posting, transfers, standing orders and share or deposit accounts out of
 * scope, so none of them is stubbed here).
 */
@Injectable({ providedIn: 'root' })
export class SavingsService {
  /** The one HTTP client of the family; only this file in `features/savings/` may hold it. */
  private readonly http = inject(HttpClient);

  /** Supplies the resolved host and API root, the fixed date format and the active locale. */
  private readonly config = inject(AppConfigService);

  /**
   * The new-application screen's options and defaults: the products the account may be opened on and
   * the field officers it may be assigned to (`GET /savingsaccounts/template`, AAP 0.7.3 W8 row).
   *
   * `productId` is sent only when the screen named one, so the client-only read and the
   * client-and-product read stay the two distinct calls the legacy form makes. `HttpParams.set`
   * writes each parameter once, and an absent `productId` leaves the parameter off the URL entirely
   * instead of sending an empty one. The payload is returned untouched: no option list is filtered,
   * sorted or renamed here, because a Fineract template is the only source of a dropdown's contents
   * (Rule 1 clause 3).
   */
  template(clientId: number | string, productId?: number | string): Observable<SavingsTemplate> {
    return defer(() => {
      let params = new HttpParams().set('clientId', clientId);

      if (productId !== undefined) {
        params = params.set('productId', productId);
      }

      return this.http.get<SavingsTemplate>(this.config.apiUrl('savingsaccounts/template'), {
        params,
      });
    });
  }

  /**
   * Opens the account (`POST /savingsaccounts`, AAP 0.7.3 W8 row) and returns the create envelope
   * whose `resourceId` the screen navigates to. The body carries the submitted-on date formatted with
   * the format and the locale beside it; nothing else is added to what the form collected.
   */
  create(body: SavingsApplicationInput): Observable<SavingsCreateResult> {
    return defer(() => {
      const { value, dateFormat, locale } = this.dateFields(body.submittedOnDate);
      const request: SavingsApplicationBody = {
        clientId: body.clientId,
        productId: body.productId,
        submittedOnDate: value,
        dateFormat,
        locale,
      };

      return this.http.post<SavingsCreateResult>(this.config.apiUrl('savingsaccounts'), request);
    });
  }

  /**
   * The record page's single read: `GET /savingsaccounts/{id}?associations=all` (AAP 0.7.1 `savings`
   * row, AAP 0.7.3 W8 row). One request carries the status, the summary and the transaction list the
   * page renders, so the screen needs no second call for either of the latter two — which is also
   * what makes the balance a server figure rather than arithmetic performed in the browser.
   */
  get(id: number | string): Observable<SavingsAccount> {
    return defer(() => {
      const params = new HttpParams().set('associations', 'all');

      return this.http.get<SavingsAccount>(
        this.config.apiUrl(`savingsaccounts/${resourceId(id, 'SavingsService.get')}`),
        { params },
      );
    });
  }

  /**
   * Runs one lifecycle action on the account: `POST /savingsaccounts/{id}?command=approve` or
   * `?command=activate` (AAP 0.7.3 W8 row). One call is one POST, and the response body is
   * discarded — the caller returns to the record, whose own read shows the account's new status.
   *
   * The request body follows the command the caller named, and a pair that disagrees throws before
   * any request is issued (see `assertCommandMatchesBody()`): that is a mistake in the screen's code
   * rather than something the server can be asked about, and stopping here is what keeps one click to
   * one POST.
   *
   * @param id Account identifier, as the record route carries it.
   * @param command The lifecycle transition to perform.
   * @param body The matching date the form collected, without the format members this service fills.
   * @throws Error when `command` and the body's date member disagree.
   */
  action(id: number | string, command: SavingsCommand, body: SavingsActionInput): Observable<void> {
    // The pair check stays a synchronous throw, outside `defer`: a caller that passes mismatched
    // arguments has a bug this service cannot resolve, so the refusal reaches the call site rather
    // than a subscriber. `defer` wraps the request composition only.
    this.assertCommandMatchesBody(command, body);

    return defer(() => {
      const params = new HttpParams().set('command', command);

      return this.http
        .post<unknown>(
          this.config.apiUrl(`savingsaccounts/${resourceId(id, 'SavingsService.action')}`),
          this.actionBody(command, body),
          { params },
        )
        .pipe(map((): void => undefined));
    });
  }

  /**
   * The deposit and withdrawal form's payment types,
   * `GET /savingsaccounts/{id}/transactions/template` (AAP 0.7.3 W8 row). Both commands read it: the
   * screen renders one form and posts it with the command the route selected.
   */
  transactionTemplate(id: number | string): Observable<SavingsTransactionTemplate> {
    return defer(() =>
      this.http.get<SavingsTransactionTemplate>(
        this.config.apiUrl(
          `savingsaccounts/${resourceId(id, 'SavingsService.transactionTemplate')}/transactions/template`,
        ),
      ),
    );
  }

  /**
   * Records one cash transaction: `POST /savingsaccounts/{id}/transactions?command=deposit` or
   * `?command=withdrawal` (AAP 0.7.3 W8 row). The response body is discarded, because the record the
   * caller returns to reads the new balance and the added transaction row from the server.
   *
   * The amount travels exactly as the form received it: neither a range nor the available balance is
   * checked here, since the server owns both rules and the legacy screen adds neither (Rule 1
   * clause 3).
   *
   * @param id Account identifier, as the record route carries it.
   * @param command `deposit` or `withdrawal`, in the endpoint's own spelling.
   * @param body The amount, payment type and date the form collected.
   */
  transaction(
    id: number | string,
    command: SavingsTransactionCommand,
    body: SavingsTransactionInput,
  ): Observable<void> {
    return defer(() => {
      const { value, dateFormat, locale } = this.dateFields(body.transactionDate);
      const request: SavingsTransactionBody = {
        transactionDate: value,
        transactionAmount: body.transactionAmount,
        paymentTypeId: body.paymentTypeId,
        dateFormat,
        locale,
      };
      const params = new HttpParams().set('command', command);

      return this.http
        .post<unknown>(
          this.config.apiUrl(`savingsaccounts/${resourceId(id, 'SavingsService.transaction')}/transactions`),
          request,
          { params },
        )
        .pipe(map((): void => undefined));
    });
  }

  /**
   * The one place a date-bearing body's three format members are assembled, so a correction to the
   * format or to the source of the locale is a change here alone (AAP 0.7.2 "Date handling").
   *
   * The locale is the language the user currently has selected — `AppConfigService.activeLocale`, the
   * value AAP 0.1.1's date discipline requires every payload to carry — rather than the configured
   * starting language, so a language chosen after startup reaches the next body. Every caller runs
   * this inside `defer`, so that language is the one in force when the request is subscribed and not
   * the one that stood when the method was called. A field that held no date yields `null` and never
   * an empty string, which leaves the absence for the server's own required-field rule to reject
   * (Rule 1 clause 3).
   *
   * The date formatted here is whatever the caller's form held, default included: a form's own default
   * comes from the browser clock exactly as the legacy screens' does, so the tenant's business date is
   * deliberately not read in this file. Rule 1 clause 2's business-date requirement is discharged by the
   * parity harness, which derives the run date from the business-date endpoint and with it every
   * workflow input and comparison; reading it here would add a request legacy never sends and break the
   * request parity that clause 2 also requires (AAP 0.12).
   */
  private dateFields(date: Date | null): SavingsDateFields {
    const locale = this.config.activeLocale();

    return {
      value: toFineractDate(date, locale),
      dateFormat: this.config.config.dateFormat,
      locale,
    };
  }

  /**
   * The body `command` asks for, with the two format members this service fills. The `in` test is the
   * narrowing: `approvedOnDate` is the member only an approval body carries, and testing for it keeps
   * a cast out of the path a mismatched pair would otherwise travel through to the server. The pairing
   * itself is checked by `assertCommandMatchesBody()`, which `action()` also runs before it defers, so
   * both entry points share one wording.
   *
   * Called inside `defer`, so the body and the locale it carries are composed when the request is
   * subscribed.
   *
   * @throws Error when the body carries the other command's date member.
   */
  private actionBody(
    command: SavingsCommand,
    body: SavingsActionInput,
  ): SavingsApproveBody | SavingsActivateBody {
    this.assertCommandMatchesBody(command, body);

    if ('approvedOnDate' in body) {
      const { value, dateFormat, locale } = this.dateFields(body.approvedOnDate);

      return { approvedOnDate: value, dateFormat, locale };
    }

    const { value, dateFormat, locale } = this.dateFields(body.activatedOnDate);

    return { activatedOnDate: value, dateFormat, locale };
  }

  /**
   * Refuses a command and a body that name different lifecycle dates, so one action's payload can
   * never be posted to the other action's command.
   *
   * Called from both entry points on purpose: `action()` runs it synchronously, before it defers, so a
   * caller's mistake throws at the call site; `actionBody()` runs it again inside `defer`, so the body
   * builder refuses a mismatched pair on its own. Each message is written here once.
   *
   * @param command The lifecycle transition the caller asked for.
   * @param body The body the caller handed over.
   * @throws Error when the body carries the other command's date member.
   */
  private assertCommandMatchesBody(command: SavingsCommand, body: SavingsActionInput): void {
    if ('approvedOnDate' in body) {
      if (command !== 'approve') {
        throw new Error(
          `SavingsService.action: the body carries approvedOnDate, so the command must be approve; it was ${command}.`,
        );
      }

      return;
    }

    if (command !== 'activate') {
      throw new Error(
        `SavingsService.action: the body carries activatedOnDate, so the command must be activate; it was ${command}.`,
      );
    }
  }
}
