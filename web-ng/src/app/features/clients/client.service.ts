import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type { AppDateFormat } from '../../core/config/app-config.model';
import { AppConfigService } from '../../core/config/app-config.service';
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

/**
 * The clients family's HTTP client: the one place in the feature where a Fineract client URL is
 * composed and where the request bodies of `client.models.ts` are turned into the payloads the
 * server reads (AAP 0.7.1 Features row `clients`; AAP 0.7.3 endpoint rows "W2 create and activate
 * client", "Client list and edit", "Client actions" and "W3 search and view client"; AAP 0.8.2
 * "Services"; AAP 0.14.1 "Every URL literal lives in a service").
 *
 * Every screen in this folder injects this service, and none of them imports `HttpClient`: the
 * Angular lint configuration exempts exactly seven files from that ban, this one included, so the
 * whole Fineract surface of the family is readable in one file (Rule 1 clause 5).
 *
 * **What this file owns.** The resource path of each call, the query parameters of each call, and
 * the conversion of a model's `Date | null` members into the `dd MMMM yyyy` strings the server
 * parses. `dateFormat` and `locale` are set here from the resolved configuration and the active
 * language, never by a caller, which is why those two members are required on every request model
 * and why no screen has to remember them (Rule 1 clause 2; AAP 0.1.1 date discipline).
 *
 * **What this file deliberately does not own.**
 *
 *   - Headers and failures. `core/http/fineract.interceptor.ts` sets the authorization and tenant
 *     headers, maps a Fineract error body to `ApiError` and handles 401, so nothing here sets a
 *     header, catches an error or re-shapes one (AAP 0.4.2).
 *   - The host and the API root. Both come from `AppConfigService.apiUrl()`, so this file holds no
 *     host, no API-root path and no absolute URL (Rule 2).
 *   - The datatable gate that must run before a client action, which is
 *     `core/api/datatable-gate.service.ts`'s two calls, and the global search the toolbar and navbar
 *     use, which is `core/api/search.service.ts`. Neither is re-implemented here (AAP 0.7.3 rows
 *     "Client actions: datatable gate" and "Shell: global search").
 *   - Duplicate-submission protection. `POST /clients` and the five lifecycle commands are not
 *     idempotent, and one-request-per-click belongs to the screens through
 *     `shared/submit-guard.util.ts`; no retry or replay is added here that could post twice
 *     (AAP 0.1.1).
 *   - The tenant business date. A form's default date follows legacy and comes from the browser
 *     clock, and the run date the harness needs is read by the harness, not by the application; a
 *     business-date request issued from here would appear as a request difference in every parity
 *     workflow (AAP 0.10.5 item 15).
 *
 * Reads are never cached: every `get` reaches Fineract, because a record's status, balances and
 * schedule change through the commands this same service posts (Rule 1 clause 3).
 */

/**
 * The two members every date-bearing client payload carries: the pattern the date strings are
 * written in and the language whose month names they use. The pair is set together from the resolved
 * configuration and the active language, so a payload cannot carry one without the other
 * (AAP 0.7.2 "Date handling"; Rule 1 clause 2).
 */
interface ClientDateWire {
  /** Always `AppConfig.dateFormat`, the literal `'dd MMMM yyyy'`, never a caller's value. */
  readonly dateFormat: AppDateFormat;

  /** The locale of the selected language, from `AppConfigService.activeLocale`. */
  readonly locale: string;
}

/**
 * `POST /clients` as it goes on the wire: `ClientCreateRequest` with every date formatted. The
 * optional string members are absent when the caller has no value for them, so the server's own
 * required-field rules decide what is missing rather than an empty string standing in for a name
 * (Rule 1 clause 3).
 */
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

/**
 * `PUT /clients/{id}` as it goes on the wire: `ClientEditRequest` with its activation date formatted.
 * There is no office member, because the update endpoint refuses one and the model says so.
 */
interface ClientEditWire extends ClientDateWire {
  firstname?: string;
  lastname?: string;
  fullname?: string;
  externalId?: string;
  mobileNo?: string;
  activationDate?: string | null;
}

/** `POST /clients/{id}?command=activate` — the activation date and the date-format pair. */
type ClientActivateWire = ClientDateWire & { readonly activationDate: string | null };

/** `POST /clients/{id}?command=close` — the closure date, its reason and the date-format pair. */
type ClientCloseWire = ClientDateWire & { readonly closureDate: string | null; readonly closureReasonId: number };

/** `POST /clients/{id}?command=reject` — the rejection date, its reason and the date-format pair. */
type ClientRejectWire = ClientDateWire & { readonly rejectionDate: string | null; readonly rejectionReasonId: number };

/** `POST /clients/{id}?command=withdraw` — the withdrawal date, its reason and the date-format pair. */
type ClientWithdrawalWire = ClientDateWire & {
  readonly withdrawalDate: string | null;
  readonly withdrawalReasonId: number;
};

/**
 * `POST /clients/{id}?command=reactivate` — the reactivation date and the date-format pair.
 *
 * The date is not optional: `ClientDataValidator.validateReactivate` validates `reactivationDate`
 * with `notNull`, the command's accepted parameter set is exactly `locale`, `dateFormat` and that
 * date, and a blank body is refused as invalid JSON. The legacy action screen posts the same field
 * from its `reactivationDate` control, so the payload this type describes is the one both servers
 * agree on (Rule 1 clauses 2 and 3).
 */
type ClientReactivateWire = ClientDateWire & { readonly reactivationDate: string | null };

/**
 * Every wire body the five lifecycle commands can carry, discriminated by shape rather than by a
 * `command` member: the command travels in the query string, so the body itself is the shape of that
 * one command and nothing else.
 */
type ClientActionWire =
  | ClientActivateWire
  | ClientCloseWire
  | ClientRejectWire
  | ClientWithdrawalWire
  | ClientReactivateWire;

/**
 * `template=true`, the one query parameter the edit screen's seed read sends. Declared once because
 * `HttpParams` is immutable, so one instance is safe to share across every read that needs it.
 */
const TEMPLATE_ONLY_PARAMS = new HttpParams().set('template', true);

/**
 * The clients family's only Fineract caller. Screens inject it; it injects `HttpClient` and the
 * resolved configuration and nothing else (Rule 1 clause 5).
 */
@Injectable({ providedIn: 'root' })
export class ClientService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(AppConfigService);

  /**
   * One page of clients: `GET /clients`.
   *
   * The endpoint answers with a paged envelope, not a bare array — `{ totalFilteredRecords, pageItems }`
   * — which is why the page's rows are read from `pageItems` and its row count from
   * `totalFilteredRecords` (AAP 0.7.3 row "Client list and edit").
   *
   * @param params the query object; `offset` and `limit` are always sent and the three optional
   * members only when a caller supplies them.
   * @returns the envelope the list screen renders and pages through.
   */
  list(params: ClientListParams): Observable<ClientListPage> {
    return this.http.get<ClientListPage>(this.config.apiUrl('clients'), {
      params: this.listQuery(params),
    });
  }

  /**
   * The create form's dropdowns and defaults: `GET /clients/template`.
   *
   * The screen calls this first with no office and again whenever the office changes, which is the
   * legacy form's own sequence, so the staff list follows the chosen office (AAP 0.7.3 row "W2 create
   * and activate client").
   *
   * @param officeId the office the form has selected; omitted on the first call.
   * @param staffInSelectedOfficeOnly whether the staff list is limited to that office; the form sends
   * it together with `officeId`, and neither is sent without an office.
   * @returns the template whose options the form renders and whose dates it starts from.
   */
  template(officeId?: number, staffInSelectedOfficeOnly?: boolean): Observable<ClientTemplate> {
    return this.http.get<ClientTemplate>(this.config.apiUrl('clients/template'), {
      params: this.templateQuery(officeId, staffInSelectedOfficeOnly),
    });
  }

  /**
   * One client record: `GET /clients/{id}`.
   *
   * @param id the client id — the `:id` of `#/viewclient/:id`.
   * @returns the record the header, the summary and the actions render.
   */
  get(id: number | string): Observable<Client> {
    return this.http.get<Client>(this.config.apiUrl(`clients/${id}`));
  }

  /**
   * One client record with the template folded in: `GET /clients/{id}?template=true`.
   *
   * This is the edit form's seed: the record's own values plus the office, staff and activation-date
   * defaults the template carries. Only `template=true` is sent, which is the parameter set
   * AAP 0.7.3 records for the edit read; the legacy edit controller also passed
   * `staffInSelectedOfficeOnly=true` on the same call, and that narrowing is deliberate rather than
   * an omission.
   *
   * @param id the client id being edited.
   * @returns the record merged with its template.
   */
  getWithTemplate(id: number | string): Observable<ClientTemplate> {
    return this.http.get<ClientTemplate>(this.config.apiUrl(`clients/${id}`), {
      params: TEMPLATE_ONLY_PARAMS,
    });
  }

  /**
   * The client's loan and savings accounts: `GET /clients/{id}/accounts`.
   *
   * Both collections are absent when the client holds none, so the record's accounts table renders
   * its explicit empty state rather than an error (AAP 0.7.4, "States every list and record screen
   * must implement").
   *
   * @param id the client id.
   * @returns the account summaries grouped by family.
   */
  accounts(id: number | string): Observable<ClientAccountSummary> {
    return this.http.get<ClientAccountSummary>(this.config.apiUrl('clients/' + id + '/accounts'));
  }

  /**
   * The client's identity documents: `GET /clients/{id}/identifiers`.
   *
   * The endpoint answers with a JSON array — empty when the client has none — rather than with an
   * envelope, so the Identities tab reads the list directly.
   *
   * @param id the client id.
   * @returns the identifiers in the server's order.
   */
  identifiers(id: number | string): Observable<ClientIdentifier[]> {
    return this.http.get<ClientIdentifier[]>(this.config.apiUrl('clients/' + id + '/identifiers'));
  }

  /**
   * The document types an identifier may use: `GET /clients/{id}/identifiers/template`.
   *
   * The tab reads it to resolve a document-type name when a payload carries only its id; the types
   * belong to the tenant, so none is ever a constant in the application.
   *
   * @param id the client id.
   * @returns the allowed document types in the server's order.
   */
  identifiersTemplate(id: number | string): Observable<ClientIdentifierTemplate> {
    return this.http.get<ClientIdentifierTemplate>(
      this.config.apiUrl('clients/' + id + '/identifiers/template'),
    );
  }

  /**
   * Creates a client: `POST /clients`.
   *
   * The caller supplies the record's own fields; this method fills `dateFormat` and `locale` from the
   * resolved configuration and the active language and formats `submittedOnDate` and, when it is
   * there, `activationDate` with the active locale, so the payload can never carry a date the server
   * cannot parse (Rule 1 clause 2). `legalFormId` decides which name set the body carries, and the
   * server — not the form — is what rejects a body that mixes the two.
   *
   * The response is the command result, whose `clientId` is the record to open next.
   *
   * @param body the record to create, with its dates as `Date | null`.
   * @returns the command result carrying the new client's ids.
   */
  create(body: ClientCreateRequest): Observable<ClientMutationResponse> {
    return this.http.post<ClientMutationResponse>(this.config.apiUrl('clients'), this.createWire(body));
  }

  /**
   * Updates a client: `PUT /clients/{id}`.
   *
   * The body carries no office, because the update endpoint refuses one and the model says so; the
   * same `dateFormat`, `locale` and date formatting are applied here as on a create.
   *
   * @param id the client id being edited.
   * @param body the edited fields, with `activationDate` only when the edit means to set it.
   * @returns the command result carrying the client's ids.
   */
  update(id: number | string, body: ClientEditRequest): Observable<ClientMutationResponse> {
    return this.http.put<ClientMutationResponse>(this.config.apiUrl(`clients/${id}`), this.editWire(body));
  }

  /**
   * The reasons a close, reject or withdraw action offers: `GET /clients/template?commandParam=<command>`.
   *
   * For these three values the endpoint answers with narrations alone — observed live as
   * `{"isStaff":false,"narrations":[]}` — and carries none of a client template's options, which is
   * why the response is a `ClientNarrationTemplate` rather than a `ClientTemplate`. The ids in that
   * list are the tenant's configured ones, so an action screen takes the reason it posts from here and
   * never from a constant.
   *
   * `activate` and `reactivate` have no reason list, so they are not accepted here: they need no
   * template read at all.
   *
   * @param action the command whose reasons are wanted.
   * @returns the configured reasons, in the server's order; empty when the tenant has none.
   */
  commandParam(
    action: Extract<ClientActionCommand, 'close' | 'reject' | 'withdraw'>,
  ): Observable<ClientNarrationTemplate> {
    return this.http.get<ClientNarrationTemplate>(this.config.apiUrl('clients/template'), {
      params: new HttpParams().set('commandParam', action),
    });
  }

  /**
   * Runs one lifecycle command: `POST /clients/{id}?command=<command>`.
   *
   * The five in-scope commands are `activate`, `close`, `reject`, `withdraw` and `reactivate`; each
   * posts its own body shape, which `ClientActionRequest` discriminates on the command, and this
   * method formats the action's date and fills `dateFormat` and `locale` the same way every other
   * body is built. The reason ids and dates come from the action screen — from the reason list of
   * {@link commandParam} and from the form's date field — and the server is what refuses a body that
   * lacks what its command requires, with the message the screen shows verbatim (Rule 1 clause 3).
   *
   * The command in the query string and the command the body describes are checked to be the same
   * one, because the two travel separately and a mismatch would post one action's payload to another
   * action's endpoint — a wrong request against a financial record, refused only after it reached the
   * server. The guard runs before the request is issued and throws, because a caller that passes
   * mismatched arguments has a bug this service cannot resolve.
   *
   * @param id the client the command applies to.
   * @param command the command to run, as the `command` query parameter.
   * @param body the body of that command.
   * @returns the command result carrying the client's ids.
   * @throws Error when `body` describes a different command than `command`.
   */
  action(
    id: number | string,
    command: ClientActionCommand,
    body: ClientActionRequest,
  ): Observable<ClientMutationResponse> {
    if (body.command !== command) {
      throw new Error(
        `ClientService.action: the body describes the '${body.command}' command but the request issues ` +
          `'${command}'. Post the body that belongs to the command, so one action cannot carry another ` +
          "action's payload.",
      );
    }

    return this.http.post<ClientMutationResponse>(this.config.apiUrl(`clients/${id}`), this.actionWire(body), {
      params: new HttpParams().set('command', command),
    });
  }

  /**
   * The query object of `GET /clients`, built in one place so a correction to the in-scope parameter
   * set is a single edit.
   *
   * The legacy client list was read to settle it (AAP 0.3.4, open item): its controller calls
   * `getAllClients({ offset: (page - 1) * 15, limit: 15 })` and nothing else, keeps a pager of 15 rows
   * per page, and searches server-side through the global search resource
   * `clients,clientIdentifiers` rather than through this endpoint. `orderBy`, `sortOrder` and
   * `searchText` are therefore supported but left unset by the in-scope screen: no default sort and
   * no second search call is added here, so the query the new list sends is the query legacy sent
   * (Rule 1 clauses 2 and 3).
   */
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

  /**
   * The query object of `GET /clients/template`: the office and the staff narrowing, both sent only
   * once an office is selected, as the legacy create form does when its office changes. The first
   * call sends no parameter at all, so the template's own default office is what the form starts on
   * (AAP 0.7.3 row "W2 create and activate client").
   */
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

  /**
   * The `dateFormat` and `locale` pair every date-bearing body carries, read at call time so a
   * language the user selects reaches the next payload rather than only the next screen
   * (AAP 0.7.2 "Date handling"). `dateFormat` is the configured literal `'dd MMMM yyyy'` and is never
   * chosen per call, because a second format would change what the server parses (Rule 1 clause 2).
   */
  private dateWire(): ClientDateWire {
    return { dateFormat: this.config.config.dateFormat, locale: this.config.activeLocale() };
  }

  /**
   * `ClientCreateRequest` as the wire body: the caller's members passed through, each date formatted
   * in the active locale, and a member the caller left `undefined` left out entirely so the server's
   * required-field rules decide what is missing. A `null` date stays `null`, exactly as
   * `toFineractDate` reports it: no fallback date is invented and this file reads no clock.
   */
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

  /** `ClientEditRequest` as the wire body, built by the same rule as {@link createWire}. */
  private editWire(body: ClientEditRequest): ClientEditWire {
    const dates = this.dateWire();

    return {
      ...dates,
      ...(body.firstname === undefined ? {} : { firstname: body.firstname }),
      ...(body.lastname === undefined ? {} : { lastname: body.lastname }),
      ...(body.fullname === undefined ? {} : { fullname: body.fullname }),
      ...(body.externalId === undefined ? {} : { externalId: body.externalId }),
      ...(body.mobileNo === undefined ? {} : { mobileNo: body.mobileNo }),
      ...(body.activationDate === undefined
        ? {}
        : { activationDate: toFineractDate(body.activationDate, dates.locale) }),
    };
  }

  /**
   * One action's body as it goes on the wire: the members its own command accepts, with the date
   * formatted and the date-format pair attached. The switch is exhaustive over
   * `ClientActionRequest`, so a command this service does not post is a compile error rather than a
   * payload the server has to refuse.
   */
  private actionWire(request: ClientActionRequest): ClientActionWire {
    const dates = this.dateWire();

    switch (request.command) {
      case 'activate':
        return { ...dates, activationDate: toFineractDate(request.activationDate, dates.locale) };

      case 'close':
        return {
          ...dates,
          closureDate: toFineractDate(request.closureDate, dates.locale),
          closureReasonId: request.closureReasonId,
        };

      case 'reject':
        return {
          ...dates,
          rejectionDate: toFineractDate(request.rejectionDate, dates.locale),
          rejectionReasonId: request.rejectionReasonId,
        };

      case 'withdraw':
        return {
          ...dates,
          withdrawalDate: toFineractDate(request.withdrawalDate, dates.locale),
          withdrawalReasonId: request.withdrawalReasonId,
        };

      case 'reactivate':
        return { ...dates, reactivationDate: toFineractDate(request.reactivationDate, dates.locale) };
    }
  }
}

