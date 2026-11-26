import {
  provideHttpClient,
  withInterceptors,
  type HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest, } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { catchError, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_CONFIG } from '../../../../core/config/app-config.model';
import { AppConfigService } from '../../../../core/config/app-config.service';
import { toApiError, type FineractError } from '../../../../core/http/api-error';
import type {
  ClientAccountSummary,
  ClientLoanAccountSummary,
  ClientSavingsAccountSummary,
} from '../../client.models';
import { ClientAccountsComponent } from './client-accounts.component';

/** Behaviour of the accounts section of the individual client record's `General` tab. */
/** The configuration the stubbed transport serves: the application's own documented default shape. */
const SERVED_CONFIG = DEFAULT_APP_CONFIG;
/** The API root every client URL is composed from, built from the resolved configuration. */
const API_ROOT = `${SERVED_CONFIG.apiBaseUrl}${SERVED_CONFIG.apiPath}`;
/** The client whose accounts the section is bound to, as the record route delivers it. */
const CLIENT_ID = '2';
/** A second client, for the rebinding case: a record opened on another client must re-read. */
const OTHER_CLIENT_ID = 5;
/** `GET /clients/{id}/accounts` for one client id. Composed here from the same root the service uses, so a changed endpoint would fail this suite rather than pass silently (Rule 1 clause 2). */
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
/** A savings account whose family reported no figure at all: `accountBalance` is absent, which is the state the balance cell must render as empty. */
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
/** The endpoint's answer for a client holding nothing: both collections are omitted rather than sent empty, which was observed live and is what the model documents. */
const NO_ACCOUNTS: ClientAccountSummary = {};
/** A refusal as the fork sends one: `defaultUserMessage` is the text a screen renders verbatim, character for character. */
const FINERACT_REFUSAL: FineractError = {
  defaultUserMessage: 'Client has reached the maximum number of active loan accounts',
  userMessageGlobalisationCode: 'error.msg.client.max.accounts',
  errors: [
    {
      defaultUserMessage: 'Client has reached the maximum number of active loan accounts',
      parameterName: 'clientId',
    },
  ],
};
/** Status words the section conveys through the swatch and never through text. Checked in lower case over each row's whole text (AAP 0.10.5 item 11). */
const STATUS_TEXT: readonly string[] = ['active', 'pending', 'closed', 'rejected', 'withdrawn'];
/** A dash alone, the stand-in a reader would mistake for a figure; the empty cell carries none. */
const LONE_DASH = /^[-–—]+$/;
/** Installs the production mapping of a Fineract failure onto the test transport, so a rejection arrives as the `ApiError` the component catches (AAP 0.4.2). */
const MAP_FINERACT_FAILURES: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((failure: HttpErrorResponse) => throwError(() => toApiError(failure))),
  );

describe('ClientAccountsComponent', () => {
  let fixture: ComponentFixture<ClientAccountsComponent>;
  let component: ClientAccountsComponent;
  let httpMock: HttpTestingController;
  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines the cast to one line and keeps the DOM assertions type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  /** Mounts the section for one client. */
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
        // `Response` stand-in: the three members `AppConfigService.fetchRawConfig` reads. The cast is the single boundary where the partial object becomes the response the service expects.
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
  afterEach(() => { httpMock.verify(); vi.unstubAllGlobals(); });
  it('reads the bound client’s accounts once, and nothing else', async () => {
    mount(CLIENT_ID);
    const read = httpMock.expectOne(isAccountsRead(CLIENT_ID));
    expect(read.request.method).toBe('GET');
    // No query parameter travels with the read: the endpoint takes the id in its path alone.
    expect(read.request.params.keys()).toEqual([]);
    expect(read.request.body).toBeNull();
    expect(httpMock.match(() => true)).toHaveLength(0);
    // While the read is outstanding the section paints neither a table nor a "no accounts" claim: `loading` starts true so the empty state cannot flash before the first answer has been read.
    expect(component.loading()).toBe(true);
    expect(host().querySelector('#client-accounts')).toBeNull();
    expect(host().querySelector('app-empty-state')).toBeNull();
    // The wrapper is the region the read marks busy; the card body belongs to the record template, not to this section.
    expect(host().querySelector('[aria-busy="true"]')).not.toBeNull();
    read.flush(ACCOUNTS);
    await fixture.whenStable();
    fixture.detectChanges();
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
    expect(component.rows().map((row) => row.balance)).toEqual([5000, 1200.5, null]);
    expect(component.loading()).toBe(false);
    expect(component.failed()).toBe(false);
    expect(renderedRows()).toHaveLength(3);
    expect(Array.from(host().querySelectorAll('#client-accounts thead th'))).toHaveLength(4);
    // Inside Bootstrap 3's `.table-responsive` the table scrolls below 768px instead of pushing the card sideways, and
    // no `.panel-body` here: the record template provides the card's body, so a second one would inset the table 15px from the
    // anchor the record's heading, labels and tabs share.
    expect(host().querySelector('#client-accounts')?.parentElement?.classList.contains('table-responsive')).toBe(true);
    expect(host().querySelector('.panel-body')).toBeNull();
  });
  it('leaves the balance cell empty for a row whose family reported no figure', async () => {
    mount(CLIENT_ID);
    httpMock.expectOne(isAccountsRead(CLIENT_ID)).flush(ACCOUNTS);
    await fixture.whenStable();
    fixture.detectChanges();
    const cells = renderedRows().map((row) => Array.from(row.cells));
    expect(cells[0]?.[3]?.textContent?.trim()).toBe('5,000');
    expect(cells[1]?.[3]?.textContent?.trim()).toBe('1,200.5');
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
      const cell = row.cells[2];
      const swatch = cell?.querySelector('span.status-swatch');
      // The status cell is the shared indicator with the colour class the active key paints, and nothing beside it: the cell itself carries no text at all (AAP 0.2.3 row `StatusSwatch`).
      expect(swatch).not.toBeNull();
      expect(swatch?.classList.contains('status-active')).toBe(true);
      expect(cell?.textContent?.trim()).toBe('');
      expect(cell?.querySelector('[title], [aria-label]')).toBeNull();
      expect(swatch?.getAttribute('aria-hidden')).toBe('true');
      const text = (row.textContent ?? '').toLowerCase();
      for (const statusWord of STATUS_TEXT) { expect(text).not.toContain(statusWord); }
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
    expect(host().querySelector('app-empty-state')).not.toBeNull();
    expect(host().querySelector('#client-accounts')).toBeNull();
    expect(host().querySelector('.alert')).toBeNull();
    expect((host().textContent ?? '').toLowerCase()).not.toContain('error');
  });
  it('flags a failed read and leaves no rows behind', async () => {
    mount(CLIENT_ID);
    httpMock.expectOne(isAccountsRead(CLIENT_ID)).flush({}, { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.failed()).toBe(true);
    expect(component.rows()).toEqual([]);
    expect(component.loading()).toBe(false);
    expect(host().querySelector('#client-accounts')).toBeNull();
    // The section keeps its one wrapper — the region the read marks busy — with the busy state cleared once the read has answered.
    expect(host().children).toHaveLength(1);
    expect(host().querySelector('[aria-busy]')).toBeNull();
    expect(host().querySelector('.alert')).toBeNull();
    expect(host().querySelector('app-empty-state')).toBeNull();
  });
  it('renders Fineract’s own refusal text verbatim, and still claims no accounts', async () => {
    mount(CLIENT_ID);
    httpMock.expectOne(isAccountsRead(CLIENT_ID)).flush(FINERACT_REFUSAL, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    fixture.detectChanges();
    const alerts = Array.from(host().querySelectorAll('.alert'));
    // A 4xx is the failure the interceptor does not notify, so the section renders the server's own `defaultUserMessage` itself: exactly one region, carrying the text unaltered — no prefix, no suffix.
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent?.trim()).toBe(FINERACT_REFUSAL.defaultUserMessage);
    expect(component.failed()).toBe(true);
    expect(component.rows()).toEqual([]);
    expect(host().querySelector('#client-accounts')).toBeNull();
    expect(host().querySelector('app-empty-state')).toBeNull();
  });
  it('abandons the read a rebinding supersedes, so a late answer cannot replace the newer rows', async () => {
    mount(CLIENT_ID);
    const superseded = httpMock.expectOne(isAccountsRead(CLIENT_ID));
    fixture.componentRef.setInput('clientId', OTHER_CLIENT_ID);
    fixture.detectChanges();
    const current = httpMock.expectOne(isAccountsRead(OTHER_CLIENT_ID));
    // `switchMap` abandons the first read instead of racing it: the transport reports that read cancelled and refuses to deliver any body for it.
    expect(superseded.cancelled).toBe(true);
    expect(() => superseded.flush(ACCOUNTS)).toThrow(/cancelled/i);
    current.flush({ loanAccounts: [LOAN_ACCOUNT] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.rows().map((row) => row.id)).toEqual([LOAN_ACCOUNT.id]);
    expect(renderedRows()).toHaveLength(1);
  });
  it('re-reads for a newly bound client and replaces the rows', async () => {
    mount(CLIENT_ID);
    httpMock.expectOne(isAccountsRead(CLIENT_ID)).flush(ACCOUNTS);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.rows()).toHaveLength(3);
    fixture.componentRef.setInput('clientId', OTHER_CLIENT_ID);
    fixture.detectChanges();
    const reRead = httpMock.expectOne(isAccountsRead(OTHER_CLIENT_ID));
    expect(reRead.request.method).toBe('GET');
    expect(component.loading()).toBe(true);
    reRead.flush({ loanAccounts: [LOAN_ACCOUNT] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.rows().map((row) => row.id)).toEqual([21]);
    expect(component.loading()).toBe(false);
    expect(httpMock.match(() => true)).toHaveLength(0);
  });
});
