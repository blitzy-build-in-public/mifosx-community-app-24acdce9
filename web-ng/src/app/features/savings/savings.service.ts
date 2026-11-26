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

/** The saving-accounts family's single typed Fineract service — workflow W8: open an account, approve it, activate it, deposit, withdraw, then read the record back with its summary and transactions (AAP 0.9.1 scope group (AAP 0.10.1, AAP 0.7.3, Rule 1 clause 2, AAP 0.4.2). */

/** What the new-application screen hands `create()`: the models' `SavingsApplicationRequest` without its `dateFormat` and `locale` members, because this service fills both from the runtime configuration at the boundary (AAP 0.7.2, AAP 0.14.1). */
export type SavingsApplicationInput = Omit<SavingsApplicationRequest, 'dateFormat' | 'locale'>;

/** What an action screen hands `action()`: one of the two lifecycle bodies without its format members, for the same reason as `SavingsApplicationInput`. */
export type SavingsActionInput =
  | Omit<SavingsApproveRequest, 'dateFormat' | 'locale'>
  | Omit<SavingsActivateRequest, 'dateFormat' | 'locale'>;

/** What a deposit or withdrawal form hands `transaction()`: the models' `SavingsTransactionRequest` without its format members (Rule 1 clause 3). */
export type SavingsTransactionInput = Omit<SavingsTransactionRequest, 'dateFormat' | 'locale'>;

/** Fineract's create envelope: the whole body `POST /savingsaccounts` answers with, of which the screen reads `resourceId` — the new account's id, and so the route parameter of the record it navigates to next. */
export interface SavingsCreateResult {
  /** Identifier of the account the server has just created. */
  readonly resourceId: number;
}

/** The three members every date-bearing savings body carries, assembled in one place by `dateFields()`: the formatted value, the format it was written in and the language it was written in (AAP 0.7.3, "Rules that apply to. */
interface SavingsDateFields {
  /** The field's date as `dd MMMM yyyy` in `locale`, or `null` when the field held none. */
  readonly value: string | null;
  /** Format `value` was written in; the one the configuration fixes. */
  readonly dateFormat: AppDateFormat;
  /** Language `value` was written in — the locale the same body declares. */
  readonly locale: string;
}

/** The wire body of `POST /savingsaccounts`: `SavingsApplicationRequest` with its date serialised, as the server parses it (Rule 1 clause 2). */
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
  /** Payment type the form named, or `null` when it named none — the member stays on the wire in that case rather than being omitted, so the server's own required-field rule reports the absence (Rule 1 clause 3, AAP 0.4.4. */
  readonly paymentTypeId: number | null;
  readonly dateFormat: AppDateFormat;
  readonly locale: string;
}

/** The saving-accounts family's typed Fineract client: the calls of workflow W8 and nothing else (AAP 0.9.2 keeps interest posting, transfers, standing orders and share or deposit accounts out of scope, so none of them is. */
@Injectable({ providedIn: 'root' })
export class SavingsService {
  /** The one HTTP client of the family; only this file in `features/savings/` may hold it. */
  private readonly http = inject(HttpClient);

  /** Supplies the resolved host and API root, the fixed date format and the active locale. */
  private readonly config = inject(AppConfigService);

  /** The new-application screen's options and defaults: the products the account may be opened on and the field officers it may be assigned to (`GET /savingsaccounts/template`, AAP 0.7.3 W8 row) (Rule 1 clause 3). */
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

  /** Opens the account (`POST /savingsaccounts`, AAP 0.7.3 W8 row) and returns the create envelope whose `resourceId` the screen navigates to. */
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

  /** The record page's single read: `GET /savingsaccounts/{id}?associations=all` (AAP 0.7.1 `savings` row, AAP 0.7.3 W8 row). */
  get(id: number | string): Observable<SavingsAccount> {
    return defer(() => {
      const params = new HttpParams().set('associations', 'all');

      return this.http.get<SavingsAccount>(
        this.config.apiUrl(`savingsaccounts/${resourceId(id, 'SavingsService.get')}`),
        { params },
      );
    });
  }

  /** Runs one lifecycle action on the account: `POST /savingsaccounts/{id}?command=approve` or `?command=activate` (AAP 0.7.3 W8 row) (AAP 0.14.1). */
  action(id: number | string, command: SavingsCommand, body: SavingsActionInput): Observable<void> {
    return defer(() => {
      const params = new HttpParams().set('command', command);
      const request = this.actionBody(command, body);

      return this.http
        .post<unknown>(
          this.config.apiUrl(`savingsaccounts/${resourceId(id, 'SavingsService.action')}`),
          request,
          { params },
        )
        .pipe(map((): void => undefined));
    });
  }

  /** The deposit and withdrawal form's payment types, `GET /savingsaccounts/{id}/transactions/template` (AAP 0.7.3 W8 row). */
  transactionTemplate(id: number | string): Observable<SavingsTransactionTemplate> {
    return defer(() =>
      this.http.get<SavingsTransactionTemplate>(
        this.config.apiUrl(
          `savingsaccounts/${resourceId(id, 'SavingsService.transactionTemplate')}/transactions/template`,
        ),
      ),
    );
  }

  /** Records one cash transaction: `POST /savingsaccounts/{id}/transactions?command=deposit` or `?command=withdrawal` (AAP 0.7.3 W8 row) (Rule 1 clause 3). */
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

  /** The one place a date-bearing body's three format members are assembled, so a correction to the format or to the source of the locale is a change here alone (AAP 0.7.2 "Date handling") (AAP 0.1.1, Rule 1 clause 3, Rule 1 clause 2, AAP 0.12). */
  private dateFields(date: Date | null): SavingsDateFields {
    const locale = this.config.activeLocale();

    return {
      value: toFineractDate(date, locale),
      dateFormat: this.config.config.dateFormat,
      locale,
    };
  }

  /** The body `command` asks for, with the two format members this service fills. */
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

  /** Refuses a command and a body that name different lifecycle dates, so one action's payload can never be posted to the other action's command. */
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
