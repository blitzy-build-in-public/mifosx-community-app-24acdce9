import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { defer, type Observable } from 'rxjs';

import type { AppDateFormat } from '../../core/config/app-config.model';
import { AppConfigService } from '../../core/config/app-config.service';
import { resourceId } from '../../core/http/path-segment.util';
import { toFineractDate } from '../../shared/date-format.util';
import type {
  Client,
  ClientAccountSummary,
  ClientActionCommand,
  ClientActionRequest,
  ClientCreateRequest,
  ClientEditRequest,
  ClientIdentifier,
  ClientIdentifierTemplate,
  ClientListPage,
  ClientListParams,
  ClientMutationResponse,
  ClientNarrationTemplate,
  ClientTemplate,
} from './client.models';

/** The clients family's HTTP client: the one place in the feature where a Fineract client URL is composed and where the request bodies of `client.models.ts` are turned into the payloads the server reads (AAP 0.7.1 Features, AAP 0.7.3, AAP 0.8.2, AAP 0.14.1, Rule 1 clause 5). */

/** The two members every date-bearing client payload carries: the pattern the date strings are written in and the language whose month names they use (AAP 0.7.2, Rule 1 clause 2). */
interface ClientDateWire {
  /** Always `AppConfig.dateFormat`, the literal `'dd MMMM yyyy'`, never a caller's value. */
  readonly dateFormat: AppDateFormat;
  /** The locale of the selected language, from `AppConfigService.activeLocale`. */
  readonly locale: string;
}

/** `POST /clients` as it goes on the wire: `ClientCreateRequest` with every date formatted (Rule 1 clause 3). */
interface ClientCreateWire extends ClientDateWire {
  officeId: number;
  legalFormId: number;
  staffId?: number;
  firstname?: string;
  lastname?: string;
  fullname?: string;
  externalId?: string;
  mobileNo?: string;
  submittedOnDate: string | null;
  active: boolean;
  activationDate?: string | null;
}

/** `PUT /clients/{id}` as it goes on the wire: `ClientEditRequest` with its activation date formatted, and `staffId` kept as the caller sent it — a number assigns an officer and a `null` unassigns one (Rule 1 clause 3). */
interface ClientEditWire extends ClientDateWire {
  firstname?: string;
  lastname?: string;
  fullname?: string;
  externalId?: string;
  mobileNo?: string;
  staffId?: number | null;
  activationDate?: string | null;
}

/** `POST /clients/{id}?command=activate` — the activation date and the date-format pair. */
type ClientActivateWire = ClientDateWire & { readonly activationDate: string | null };

/** `POST /clients/{id}?command=close` — the closure date, the reason when one was chosen and the date-format pair (Rule 1 clause 3, AAP 0.7.4). */
type ClientCloseWire = ClientDateWire & {
  readonly closureDate: string | null;
  readonly closureReasonId?: number;
};

/** `POST /clients/{id}?command=reject` — the rejection date, the reason when one was chosen and the date-format pair, on the same terms as {@link ClientCloseWire}. */
type ClientRejectWire = ClientDateWire & {
  readonly rejectionDate: string | null;
  readonly rejectionReasonId?: number;
};

/** `POST /clients/{id}?command=withdraw` — the withdrawal date, the reason when one was chosen and the date-format pair, on the same terms as {@link ClientCloseWire}. */
type ClientWithdrawalWire = ClientDateWire & {
  readonly withdrawalDate: string | null;
  readonly withdrawalReasonId?: number;
};

/** `POST /clients/{id}?command=reactivate` — the reactivation date and the date-format pair. */
type ClientReactivateWire = ClientDateWire & { readonly reactivationDate: string | null };

/** Every wire body the five lifecycle commands can carry, discriminated by shape rather than by a `command` member: the command travels in the query string, so the body itself is the shape of that one command and nothing. */
type ClientActionWire =
  | ClientActivateWire
  | ClientCloseWire
  | ClientRejectWire
  | ClientWithdrawalWire
  | ClientReactivateWire;

/** `Omit` for a union. Applied to a union, a bare `Omit` collapses it to the members every variant shares — for `ClientActionRequest` that is `command` alone — which would let a `close` body be built without its own date. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What the edit screen hands {@link ClientService.update}: `ClientEditRequest` without its `dateFormat` and `locale` members, because this service fills both from the resolved configuration and the active language at the boundary where the body is built (AAP 0.7.2, Rule 1 clause 2). */
export type ClientEditInput = Omit<ClientEditRequest, 'dateFormat' | 'locale'>;

/** What an action screen hands {@link ClientService.action}: one of the five lifecycle bodies without its format members, for the same reason as {@link ClientEditInput}. The union stays discriminated by `command`, so a screen holding a `close` body cannot read a rejection reason from it. */
export type ClientActionInput = DistributiveOmit<ClientActionRequest, 'dateFormat' | 'locale'>;

/** The two query parameters the edit screen's seed read sends, legacy's own pair: `template=true` for the record and its option lists, and `staffInSelectedOfficeOnly=true`, which is the flag `EditClientController` reads its staff picker from (`GET /clients/{id}?template=true&staffInSelectedOfficeOnly=true`; Rule 1 clause 2). */
const RECORD_TEMPLATE_PARAMS = new HttpParams()
  .set('staffInSelectedOfficeOnly', true)
  .set('template', true);

/** The clients family's only Fineract caller. Screens inject it; it injects `HttpClient` and the resolved configuration and nothing else (Rule 1 clause 5). */
@Injectable({ providedIn: 'root' })
export class ClientService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(AppConfigService);

  /** One page of clients: `GET /clients`. The endpoint answers with a paged envelope, not a bare array — `{ totalFilteredRecords, pageItems }` — which is why the page's rows are read from `pageItems` and its row count from `totalFilteredRecords` (AAP 0.7.3). */
  list(params: ClientListParams): Observable<ClientListPage> {
    return defer(() =>
      this.http.get<ClientListPage>(this.config.apiUrl('clients'), {
        params: this.listQuery(params),
      }),
    );
  }

  /** The create form's dropdowns and defaults: `GET /clients/template` (AAP 0.7.3). */
  template(officeId?: number, staffInSelectedOfficeOnly?: boolean): Observable<ClientTemplate> {
    return defer(() =>
      this.http.get<ClientTemplate>(this.config.apiUrl('clients/template'), {
        params: this.templateQuery(officeId, staffInSelectedOfficeOnly),
      }),
    );
  }

  /** One client record: `GET /clients/{id}`. @param id the client id — the `:id` of `#/viewclient/:id`. @returns the record the header, the summary and the actions render. */
  get(id: number | string): Observable<Client> {
    return defer(() =>
      this.http.get<Client>(this.config.apiUrl(`clients/${resourceId(id, 'ClientService.get')}`)),
    );
  }

  /** One client record with the template folded in: `GET /clients/{id}?template=true&staffInSelectedOfficeOnly=true`, the read legacy's edit form makes so its office and staff pickers come from the same response (AAP 0.7.3; Rule 1 clause 2). */
  getWithTemplate(id: number | string): Observable<ClientTemplate> {
    return defer(() =>
      this.http.get<ClientTemplate>(
        this.config.apiUrl(`clients/${resourceId(id, 'ClientService.getWithTemplate')}`),
        { params: RECORD_TEMPLATE_PARAMS },
      ),
    );
  }

  /** The client's loan and savings accounts: `GET /clients/{id}/accounts` (AAP 0.7.4). */
  accounts(id: number | string): Observable<ClientAccountSummary> {
    return defer(() =>
      this.http.get<ClientAccountSummary>(
        this.config.apiUrl(`clients/${resourceId(id, 'ClientService.accounts')}/accounts`),
      ),
    );
  }

  /** The client's identity documents: `GET /clients/{id}/identifiers`. */
  identifiers(id: number | string): Observable<ClientIdentifier[]> {
    return defer(() =>
      this.http.get<ClientIdentifier[]>(
        this.config.apiUrl(`clients/${resourceId(id, 'ClientService.identifiers')}/identifiers`),
      ),
    );
  }

  /** The document types an identifier may use: `GET /clients/{id}/identifiers/template`. */
  identifiersTemplate(id: number | string): Observable<ClientIdentifierTemplate> {
    return defer(() =>
      this.http.get<ClientIdentifierTemplate>(
        this.config.apiUrl(
          `clients/${resourceId(id, 'ClientService.identifiersTemplate')}/identifiers/template`,
        ),
      ),
    );
  }

  /** Creates a client: `POST /clients`. The caller supplies the record's own fields; this method fills `dateFormat` and `locale` from the resolved configuration and the active language and formats `submittedOnDate` and, when it is supplied, `activationDate` (Rule 1 clause 2). */
  create(body: ClientCreateRequest): Observable<ClientMutationResponse> {
    return defer(() =>
      this.http.post<ClientMutationResponse>(this.config.apiUrl('clients'), this.createWire(body)),
    );
  }

  /** Updates a client: `PUT /clients/{id}`. The body carries no office, because the update endpoint refuses one and the model says so, and it carries the loan officer as `staffId` — a number to assign, a `null` to unassign — with the same `dateFormat`, `locale` and date formatting applied here as on a create. */
  update(id: number | string, body: ClientEditInput): Observable<ClientMutationResponse> {
    return defer(() =>
      this.http.put<ClientMutationResponse>(
        this.config.apiUrl(`clients/${resourceId(id, 'ClientService.update')}`),
        this.editWire(body),
      ),
    );
  }

  /** The reasons a close, reject or withdraw action offers: `GET /clients/template?commandParam=<command>`. */
  commandParam(
    action: Extract<ClientActionCommand, 'close' | 'reject' | 'withdraw'>,
  ): Observable<ClientNarrationTemplate> {
    return defer(() =>
      this.http.get<ClientNarrationTemplate>(this.config.apiUrl('clients/template'), {
        params: new HttpParams().set('commandParam', action),
      }),
    );
  }

  /** Runs one lifecycle command: `POST /clients/{id}?command=<command>` (Rule 1 clause 3). */
  action(
    id: number | string,
    command: ClientActionCommand,
    body: ClientActionInput,
  ): Observable<ClientMutationResponse> {
    return defer(() => {
      if (body.command !== command) {
        throw new Error(
          `ClientService.action: the body describes the '${body.command}' command but the request issues ` +
            `'${command}'. Post the body that belongs to the command, so one action cannot carry another ` +
            "action's payload.",
        );
      }

      const params = new HttpParams().set('command', command);

      return this.http.post<ClientMutationResponse>(
        this.config.apiUrl(`clients/${resourceId(id, 'ClientService.action')}`),
        this.actionWire(body),
        { params },
      );
    });
  }

  /** The query object of `GET /clients`, built in one place so a correction to the in-scope parameter set is a single edit (AAP 0.3.4). */
  private listQuery(params: ClientListParams): HttpParams {
    let query = new HttpParams().set('offset', params.offset).set('limit', params.limit);

    if (params.orderBy !== undefined) {
      query = query.set('orderBy', params.orderBy);
    }

    if (params.sortOrder !== undefined) {
      query = query.set('sortOrder', params.sortOrder);
    }

    if (params.searchText !== undefined) {
      query = query.set('searchText', params.searchText);
    }

    return query;
  }

  /** The query object of `GET /clients/template`: the office and the staff narrowing, both sent only once an office is selected, as the legacy create form does when its office changes (AAP 0.7.3). */
  private templateQuery(
    officeId: number | undefined,
    staffInSelectedOfficeOnly: boolean | undefined,
  ): HttpParams {
    if (officeId === undefined) {
      return new HttpParams();
    }

    const query = new HttpParams().set('officeId', officeId);

    return staffInSelectedOfficeOnly === undefined
      ? query
      : query.set('staffInSelectedOfficeOnly', staffInSelectedOfficeOnly);
  }

  /** The `dateFormat` and `locale` pair every date-bearing body carries, read at call time so a language the user selects reaches the next payload rather than only the next screen (AAP 0.7.2 "Date handling") (Rule 1 clause 2). */
  private dateWire(): ClientDateWire {
    return { dateFormat: this.config.config.dateFormat, locale: this.config.activeLocale() };
  }

  /** `ClientCreateRequest` as the wire body: the caller's members passed through, each date formatted in the active locale, and a member the caller left `undefined` left out entirely so the server's required-field rules decide what is missing. */
  private createWire(body: ClientCreateRequest): ClientCreateWire {
    const dates = this.dateWire();

    return {
      ...dates,
      officeId: body.officeId,
      legalFormId: body.legalFormId,
      ...(body.staffId === undefined ? {} : { staffId: body.staffId }),
      ...(body.firstname === undefined ? {} : { firstname: body.firstname }),
      ...(body.lastname === undefined ? {} : { lastname: body.lastname }),
      ...(body.fullname === undefined ? {} : { fullname: body.fullname }),
      ...(body.externalId === undefined ? {} : { externalId: body.externalId }),
      ...(body.mobileNo === undefined ? {} : { mobileNo: body.mobileNo }),
      submittedOnDate: toFineractDate(body.submittedOnDate, dates.locale),
      active: body.active,
      ...(body.activationDate === undefined
        ? {}
        : { activationDate: toFineractDate(body.activationDate, dates.locale) }),
    };
  }

  /** The caller's {@link ClientEditInput} as the wire body: the same rule as {@link createWire}, so a member the caller left `undefined` stays out of the payload and a `null` date stays `null`; `staffId` follows the same pattern, and a `null` there survives to the wire because that is how the operator unassigns an officer (Rule 1 clause 3). */
  private editWire(body: ClientEditInput): ClientEditWire {
    const dates = this.dateWire();

    return {
      ...dates,
      ...(body.firstname === undefined ? {} : { firstname: body.firstname }),
      ...(body.lastname === undefined ? {} : { lastname: body.lastname }),
      ...(body.fullname === undefined ? {} : { fullname: body.fullname }),
      ...(body.externalId === undefined ? {} : { externalId: body.externalId }),
      ...(body.mobileNo === undefined ? {} : { mobileNo: body.mobileNo }),
      ...(body.staffId === undefined ? {} : { staffId: body.staffId }),
      ...(body.activationDate === undefined
        ? {}
        : { activationDate: toFineractDate(body.activationDate, dates.locale) }),
    };
  }

  /** One action's body as it goes on the wire: the members its own command accepts, with the date formatted and the date-format pair attached (Rule 1 clause 3, AAP 0.7.4). */
  private actionWire(request: ClientActionInput): ClientActionWire {
    const dates = this.dateWire();

    switch (request.command) {
      case 'activate':
        return { ...dates, activationDate: toFineractDate(request.activationDate, dates.locale) };

      case 'close':
        return {
          ...dates,
          closureDate: toFineractDate(request.closureDate, dates.locale),
          ...(request.closureReasonId === undefined
            ? {}
            : { closureReasonId: request.closureReasonId }),
        };

      case 'reject':
        return {
          ...dates,
          rejectionDate: toFineractDate(request.rejectionDate, dates.locale),
          ...(request.rejectionReasonId === undefined
            ? {}
            : { rejectionReasonId: request.rejectionReasonId }),
        };

      case 'withdraw':
        return {
          ...dates,
          withdrawalDate: toFineractDate(request.withdrawalDate, dates.locale),
          ...(request.withdrawalReasonId === undefined
            ? {}
            : { withdrawalReasonId: request.withdrawalReasonId }),
        };

      case 'reactivate':
        return { ...dates, reactivationDate: toFineractDate(request.reactivationDate, dates.locale) };
    }
  }
}

