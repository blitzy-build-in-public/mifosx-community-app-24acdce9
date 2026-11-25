import {
  provideHttpClient,
  withInterceptors,
  type HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { catchError, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APP_CONFIG } from '../../../../core/config/app-config.model';
import { AppConfigService } from '../../../../core/config/app-config.service';
import { toApiError } from '../../../../core/http/api-error';
import type {
  ClientAccountSummary,
  ClientLoanAccountSummary,
  ClientSavingsAccountSummary,
} from '../../client.models';
import { ClientAccountsComponent } from './client-accounts.component';

/**
 * Behaviour of the accounts section of the individual client record's `General` tab — the read-only
 * table of the client's loan and savings accounts (AAP 0.7.1 Features row `clients`,
 * `ClientViewComponent` with `ClientAccountsComponent`; AAP 0.7.3 row "W3 search and view client";
 * AAP 0.7.4 `#/viewclient/:id`, Figma node `1:4`; AAP 0.11.1 "unit specs beside every component and
 * service"; Rule 1 clause 8).
 *
 * What it pins, case by case, is everything the section decides for itself:
 *
 *  1. it makes exactly one `GET /clients/{id}/accounts` for the id its parent binds, and no other
 *     call at all — the section reads nothing else and writes nothing;
 *  2. the response's two families become rows with the loans first and the savings second, each in
 *     the endpoint's order, and each row carries that family's own balance figure (`loanBalance` for
 *     a loan, `accountBalance` for savings) rather than one derived total;
 *  3. a row whose family reported no figure renders an empty balance cell — no zero, no dash and no
 *     placeholder the payload never carried (Rule 1 clause 3: match legacy, do not improve it);
 *  4. every row's status is the shared `app-status-swatch` and nothing else: no status word appears
 *     in the row, which is the deliberate difference the plan registers for every status indicator
 *     (AAP 0.10.5 item 11);
 *  5. a client holding no account at all — the endpoint's `{}`, which omits both keys — renders the
 *     shared explicit empty state and no table (AAP 0.7.4 "an explicit empty state and no error");
 *  6. a failed read flags the failure and leaves no rows, so the section never claims "no accounts"
 *     about a client whose accounts could not be read;
 *  7. rebinding the `clientId` input re-reads for the new client and replaces the rows, which is what
 *     keeps a record navigated to another client from showing the previous one's accounts.
 *
 * **Providers.** The configuration is loaded from a stubbed `fetch` before the component exists,
 * because the service composes the URL from it; the ngx-translate stack carries the four column
 * headings and the empty-state sentence the template resolves. There is no router and no second
 * service: this section's only collaborator is the clients family's own service, and the error
 * mapping is the production one installed as an interceptor, so a failure arrives as the `ApiError`
 * the component catches in the application (AAP 0.4.2; Rule 1 clause 5).
 *
 * Figma provenance: file `DKm5TBFbXypfqyx4xUdhBw`, frame `2:2` ("Legacy"), flow "Sign in and open a
 * client record" — Login `1:5` → Clients list `1:3` → Individual client view `1:4`. The raster paints
 * the section's heading and no row, so the row set below is the one `client.models.ts` declares for
 * the endpoint and the shared table styling is the design's own inherited metrics.
 *
 * The fixtures are synthetic: invented account numbers, product names and figures. Nothing here
 * reproduces tenant data, and nothing logs a client id, an account number or a payload (Rule 1
 * clause 9).
 */

/** The configuration the stubbed transport serves: the application's own documented default shape. */
const SERVED_CONFIG = DEFAULT_APP_CONFIG;

/** The API root every client URL is composed from, built from the resolved configuration. */
const API_ROOT = `${SERVED_CONFIG.apiBaseUrl}${SERVED_CONFIG.apiPath}`;

/** The client whose accounts the section is bound to, as the record route delivers it. */
const CLIENT_ID = '2';

/** A second client, for the rebinding case: a record opened on another client must re-read. */
const OTHER_CLIENT_ID = 5;

/**
 * `GET /clients/{id}/accounts` for one client id. Composed here from the same root the service uses,
 * so a changed endpoint would fail this suite rather than pass silently (Rule 1 clause 2).
 *
 * @param id the client id the URL names.
 */
function accountsUrl(id: number | string): string {
  return `${API_ROOT}/clients/${id}/accounts`;
}

/** Status objects as Fineract sends them: only the code is read, and never rendered. */
const LOAN_STATUS = { id: 300, code: 'loanStatusType.active', value: 'Active' };
const SAVINGS_STATUS = { id: 300, code: 'savingsAccountStatusType.active', value: 'Active' };

/** A loan account carrying the outstanding figure its family reports. */
const LOAN_ACCOUNT: ClientLoanAccountSummary = {
  id: 21,
  accountNo: '000000021',
  productName: 'Parity Loan',
  status: LOAN_STATUS,
  loanBalance: 5000,
};

/** A savings account carrying the balance its family reports, with a fractional part. */
const SAVINGS_ACCOUNT: ClientSavingsAccountSummary = {
  id: 31,
  accountNo: '000000031',
  productName: 'Parity Savings',
  status: SAVINGS_STATUS,
  accountBalance: 1200.5,
};

/**
 * A savings account whose family reported no figure at all: `accountBalance` is absent, which is the
 * state the balance cell must render as empty.
 */
const SAVINGS_WITHOUT_FIGURE: ClientSavingsAccountSummary = {
  id: 32,
  accountNo: '000000032',
  productName: 'Parity Savings Two',
  status: SAVINGS_STATUS,
};

/** The endpoint's answer for a client holding one loan and two savings accounts. */
const ACCOUNTS: ClientAccountSummary = {
  loanAccounts: [LOAN_ACCOUNT],
  savingsAccounts: [SAVINGS_ACCOUNT, SAVINGS_WITHOUT_FIGURE],
};

/**
 * The endpoint's answer for a client holding nothing: both collections are omitted rather than sent
 * empty, which was observed live and is what the model documents.
 */
const NO_ACCOUNTS: ClientAccountSummary = {};

/**
 * Status words the section conveys through the swatch and never through text. Checked in lower case
 * over each row's whole text (AAP 0.10.5 item 11).
 */
const STATUS_TEXT: readonly string[] = ['active', 'pending', 'closed', 'rejected', 'withdrawn'];

/** A dash alone, the stand-in a reader would mistake for a figure; the empty cell carries none. */
const LONE_DASH = /^[-–—]+$/;

/**
 * Installs the production mapping of a Fineract failure onto the test transport, so a rejection
 * arrives as the `ApiError` the component catches (AAP 0.4.2).
 */
const MAP_FINERACT_FAILURES: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((failure: HttpErrorResponse) => throwError(() => toApiError(failure))),
  );

describe('ClientAccountsComponent', () => {
  let fixture: ComponentFixture<ClientAccountsComponent>;
  let component: ClientAccountsComponent;
  let httpMock: HttpTestingController;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines the
  // cast to one line and keeps the DOM assertions type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /**
   * Mounts the section for one client.
   *
   * The input is bound before the first change detection because the component loads from it as soon
   * as it is set: the effect that hands the id to the load pipeline runs in that first pass, so the
   * read a case answers is already in flight when this returns.
   */
  function mount(clientId: number | string): void {
    fixture = TestBed.createComponent(ClientAccountsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('clientId', clientId);
    fixture.detectChanges();
  }

  /** Matches the section's one read for `clientId`. */
  function isAccountsRead(clientId: number | string): (request: TestRequest['request']) => boolean {
    return (request) => request.method === 'GET' && request.url === accountsUrl(clientId);
  }

  /** The rendered account rows, in document order. */
  function renderedRows(): HTMLTableRowElement[] {
    return Array.from(host().querySelectorAll<HTMLTableRowElement>('#client-accounts tbody tr'));
  }

  beforeEach(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => {
        // `Response` stand-in: the three members `AppConfigService.fetchRawConfig` reads. The cast is
        // the single boundary where the partial object becomes the response the service expects.
        const body = {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve(SERVED_CONFIG),
        };

        return Promise.resolve(body as unknown as Response);
      }),
    );

    TestBed.configureTestingModule({
      imports: [ClientAccountsComponent],
      providers: [
        provideHttpClient(withInterceptors([MAP_FINERACT_FAILURES])),
        provideHttpClientTesting(),
        provideTranslateService(),
      ],
    });

    await TestBed.inject(AppConfigService).load();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        'label.heading.accnum': 'Account No',
        'label.heading.product': 'Product',
        'label.heading.status': 'Status',
        'label.heading.balance': 'Balance',
        'label.heading.accounts': 'Accounts',
        'label.nodata': 'No Data',
      },
      true,
    );
    translate.use('en');

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  it('reads the bound client’s accounts once, and nothing else', async () => {
    mount(CLIENT_ID);

    const read = httpMock.expectOne(isAccountsRead(CLIENT_ID));

    expect(read.request.method).toBe('GET');
    // No query parameter travels with the read: the endpoint takes the id in its path alone.
    expect(read.request.params.keys()).toEqual([]);
    expect(read.request.body).toBeNull();
    // The section reads only this: no record read, no template read, no client list.
    expect(httpMock.match(() => true)).toHaveLength(0);

    read.flush(ACCOUNTS);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(httpMock.match(() => true)).toHaveLength(0);
  });

  it('renders the loans and then the savings, each with its own family’s balance figure', async () => {
    mount(CLIENT_ID);
    httpMock.expectOne(isAccountsRead(CLIENT_ID)).flush(ACCOUNTS);
    await fixture.whenStable();
    fixture.detectChanges();

    // The endpoint's order is kept: one loan row, then the savings rows as the server listed them.
    expect(component.rows().map((row) => row.id)).toEqual([21, 31, 32]);
    expect(component.rows().map((row) => row.accountNo)).toEqual([
      LOAN_ACCOUNT.accountNo,
      SAVINGS_ACCOUNT.accountNo,
      SAVINGS_WITHOUT_FIGURE.accountNo,
    ]);
    // Each figure is the one its own family reports, not a derived total.
    expect(component.rows().map((row) => row.balance)).toEqual([5000, 1200.5, null]);
    expect(component.loading()).toBe(false);
    expect(component.failed()).toBe(false);
    expect(renderedRows()).toHaveLength(3);
  });

  it('leaves the balance cell empty for a row whose family reported no figure', async () => {
    mount(CLIENT_ID);
    httpMock.expectOne(isAccountsRead(CLIENT_ID)).flush(ACCOUNTS);
    await fixture.whenStable();
    fixture.detectChanges();

    const cells = renderedRows().map((row) => Array.from(row.cells));

    // The figure cells are the fourth of each row, beneath the right-aligned balance heading, and
    // they carry the figures legacy's `number` filter prints — `{{loanaccount.loanBalance|number}}`
    // and `{{savingaccount.accountBalance|number}}` in `app/views/clients/viewclient.html:349,446` —
    // including the thousands separator, so the record groups a balance as the legacy record did
    // (AAP 0.10.2 "displayed data … and their formatting"; Rule 1 clause 3).
    expect(cells[0]?.[3]?.textContent?.trim()).toBe('5,000');
    expect(cells[1]?.[3]?.textContent?.trim()).toBe('1,200.5');
    // A missing figure is an empty cell: no zero the server never reported, no dash, no placeholder.
    expect(cells[2]?.[3]?.textContent?.trim()).toBe('');
    expect(cells[2]?.[3]?.textContent ?? '').not.toMatch(LONE_DASH);
  });

  it('renders one status swatch per row and no status word anywhere in the row', async () => {
    mount(CLIENT_ID);
    httpMock.expectOne(isAccountsRead(CLIENT_ID)).flush(ACCOUNTS);
    await fixture.whenStable();
    fixture.detectChanges();

    for (const row of renderedRows()) {
      expect(row.querySelectorAll('app-status-swatch')).toHaveLength(1);

      const text = (row.textContent ?? '').toLowerCase();

      for (const statusWord of STATUS_TEXT) {
        expect(text).not.toContain(statusWord);
      }

      // The server's own label for the state is on the payload and is deliberately not shown.
      expect(text).not.toContain(LOAN_STATUS.value.toLowerCase());
    }
  });

  it('renders the explicit empty state and no table for a client holding no account', async () => {
    mount(CLIENT_ID);
    httpMock.expectOne(isAccountsRead(CLIENT_ID)).flush(NO_ACCOUNTS);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.rows()).toEqual([]);
    expect(component.failed()).toBe(false);
    // The shared explicit empty state carries the message, and no table claims rows there are none of.
    expect(host().querySelector('app-empty-state')).not.toBeNull();
    expect(host().querySelector('#client-accounts')).toBeNull();
  });

  it('flags a failed read and leaves no rows behind', async () => {
    mount(CLIENT_ID);
    httpMock
      .expectOne(isAccountsRead(CLIENT_ID))
      .flush({}, { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();

    // The failure is state, not an exception: the section flags it, holds no rows, and renders no
    // table, so nothing on screen claims a page of accounts about a client whose accounts were never
    // read (AAP 0.7.4).
    expect(component.failed()).toBe(true);
    expect(component.rows()).toEqual([]);
    expect(component.loading()).toBe(false);
    expect(host().querySelector('#client-accounts')).toBeNull();
  });

  it('re-reads for a newly bound client and replaces the rows', async () => {
    mount(CLIENT_ID);
    httpMock.expectOne(isAccountsRead(CLIENT_ID)).flush(ACCOUNTS);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.rows()).toHaveLength(3);

    // The record was navigated to another client, which binds the same input with that client's id.
    fixture.componentRef.setInput('clientId', OTHER_CLIENT_ID);
    fixture.detectChanges();

    const reRead = httpMock.expectOne(isAccountsRead(OTHER_CLIENT_ID));

    expect(reRead.request.method).toBe('GET');
    // The previous client's rows are not left on screen while the new read is outstanding.
    expect(component.loading()).toBe(true);

    reRead.flush({ loanAccounts: [LOAN_ACCOUNT] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.rows().map((row) => row.id)).toEqual([21]);
    expect(component.loading()).toBe(false);
    expect(httpMock.match(() => true)).toHaveLength(0);
  });
});
