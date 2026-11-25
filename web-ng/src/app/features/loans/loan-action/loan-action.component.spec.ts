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
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { catchError, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { DEFAULT_APP_CONFIG } from '../../../core/config/app-config.model';
import { AppConfigService } from '../../../core/config/app-config.service';
import { toApiError } from '../../../core/http/api-error';
import type { LoanActionTemplate, LoanTransactionTemplate } from '../loan.models';
import { LoanActionComponent } from './loan-action.component';

/**
 * Behaviour of the loan lifecycle action screen — workflow W5 of the Agent Action Plan, whose
 * expected outcome is one POST per action and a loan that reaches `Active` (AAP 0.10.1 "W5 approve and
 * disburse"; AAP 0.7.4 action screens; Rule 1 clause 8, "the behaviour you implement must be
 * observable from the spec").
 *
 * What the suite drives is the component's public surface and the traffic it produces: the two route
 * segments, the per-mode forms, the signals the template reads, and the requests the real `LoanService`
 * sends through `HttpTestingController`. Nothing is asserted about styles, and nothing is mocked that
 * the screen actually depends on — the service, the shared fields, the child repayment screen and the
 * translation pipe are the shipped ones.
 *
 * The two collaborations the screen cannot run without are supplied the way the application supplies
 * them: the resolved configuration is loaded from a stubbed `fetch` before the component exists (every
 * service URL is composed from it), the ngx-translate stack is registered and filled with the legacy
 * captions, and the router is a spy because what this screen owes the router is one navigation per
 * outcome. The route is a stub whose `paramMap` emits the segments each case is about.
 *
 * The error mapping is the one production piece the TestBed supplies itself: `core/http` owns the
 * mapping of a Fineract failure to `ApiError`, and installing `toApiError` as an interceptor makes the
 * rejection the component catches the type it catches in the application, so the message a user reads
 * can be asserted character for character (AAP 0.4.2; AAP 0.7.2 row `FineractError`).
 */

/** The configuration the stubbed transport serves: the application's own documented default shape. */
const SERVED_CONFIG = DEFAULT_APP_CONFIG;

/** The API root every loan URL is composed from, built from the resolved configuration. */
const API_ROOT = `${SERVED_CONFIG.apiBaseUrl}${SERVED_CONFIG.apiPath}`;

/** The loan every case acts on, as the `:id` segment delivers it. */
const LOAN_ID = '9';

/** `GET /loans/{id}/template` — the approval form's seed. */
const APPROVAL_TEMPLATE_URL = `${API_ROOT}/loans/${LOAN_ID}/template`;

/** `GET /loans/{id}/transactions/template` — the disbursement and repayment forms' seed. */
const TRANSACTIONS_TEMPLATE_URL = `${API_ROOT}/loans/${LOAN_ID}/transactions/template`;

/** `POST /loans/{id}?command=<command>` — the one write this screen makes. */
const LOAN_URL = `${API_ROOT}/loans/${LOAN_ID}`;

/** Where the screen returns once a command lands. */
const RECORD_ROUTE = ['/viewloanaccount', LOAN_ID];

/**
 * The legacy captions this screen resolves, keyed exactly as the shipped flat translation bundles key
 * them. A key that did not resolve would render humanised through the missing-translation handler, so
 * serving the real wording is what proves the labels below resolve rather than fall back.
 */
const TRANSLATIONS: Readonly<Record<string, string>> = {
  'label.heading.approve': 'Approve',
  'label.heading.reject': 'Reject',
  'label.heading.disburse': 'Disburse',
  'label.heading.undoapproval': 'Undo Approval',
  'label.heading.undodisbursal': 'Undo Disbursal',
  'label.button.approve': 'Approve',
  'label.button.reject': 'Reject',
  'label.button.disburse': 'Disburse',
  'label.button.undoapproval': 'Undo Approval',
  'label.button.undodisbursal': 'Undo Disbursal',
  'label.heading.date': 'Date',
  'label.heading.principal': 'Principal',
  'label.heading.amount': 'Amount',
  'label.heading.note': 'Note',
  'label.requiredfield': 'Required field',
  'label.button.cancel': 'Cancel',
  'label.heading.notavailable': 'Not Available',
  'error.msg.resource.not.found': 'The requested resource is not available.',
};

/**
 * The approval template the head office answers with: the fork's `LoanApprovalData`, whose dates
 * arrive as `[year, month, day]` triples and whose amount is the principal the product allows.
 */
const APPROVAL_TEMPLATE: LoanActionTemplate = {
  approvalDate: [2026, 11, 24],
  expectedDisbursementDate: [2026, 11, 24],
  approvalAmount: 5000,
};

/**
 * The transactions template `command=disburse` answers with: the payment types the endpoint offers —
 * which this screen deliberately renders nowhere, because the disburse body has no member for one —
 * and the amount the form is seeded from.
 */
const DISBURSE_TEMPLATE: LoanTransactionTemplate = {
  paymentTypeOptions: [{ id: 1, name: 'Cash' }],
  date: [2026, 11, 24],
  amount: 5000,
  loanId: 9,
};

/** The message a refused approval answers with, quoted from a real Fineract validation failure. */
const REJECTED_MESSAGE = 'The loan cannot be approved because the approval date is before the submission date.';

/**
 * Installs the production mapping of a Fineract failure onto the test transport, so a rejection
 * arrives as the `ApiError` the component catches in the application (AAP 0.4.2; workflow W7).
 */
const MAP_FINERACT_FAILURES: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((failure: HttpErrorResponse) => throwError(() => toApiError(failure))),
  );

/** Matches the approval-template read, whatever query the screen sent with it. */
function isApprovalTemplateRead(request: { readonly url: string }): boolean {
  return request.url === APPROVAL_TEMPLATE_URL;
}

/** Matches the seed read of one loan-transaction command. */
function isTransactionsTemplateRead(command: string): (request: TestRequest['request']) => boolean {
  return (request) =>
    request.url === TRANSACTIONS_TEMPLATE_URL && request.params.get('command') === command;
}

/** Matches the one POST this screen makes for a given command, query string included. */
function isActionPost(command: string): (request: TestRequest['request']) => boolean {
  return (request) =>
    request.method === 'POST' && request.url === LOAN_URL && request.params.get('command') === command;
}

/** Matches any POST to the loan, so a case can assert that none was sent. */
function isAnyPostToLoan(request: TestRequest['request']): boolean {
  return request.method === 'POST' && request.url === LOAN_URL;
}

/** Matches the record read the repayment child makes for its repayment schedule. */
function isRecordRead(request: TestRequest['request']): boolean {
  return request.method === 'GET' && request.url === LOAN_URL;
}

describe('LoanActionComponent', () => {
  let fixture: ComponentFixture<LoanActionComponent>;
  let component: LoanActionComponent;
  let httpMock: HttpTestingController;
  let navigate: Mock<(commands: readonly unknown[]) => Promise<boolean>>;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines the
  // cast to one line and keeps the DOM assertions type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The route stub's parameter map for the segments a case is about. */
  function paramsFor(action: string | null, id: string | null): ParamMap {
    const params: Record<string, string> = {};

    if (id !== null) {
      params['id'] = id;
    }

    if (action !== null) {
      params['action'] = action;
    }

    return convertToParamMap(params);
  }

  /**
   * Mounts the screen for one `#/loanaccount/:id/:action` URL.
   *
   * Every case starts here so the mode, the id and the route stub are the only thing it changes. The
   * component's own constructor resolves the segments and issues the mode's seed read, so the pending
   * request is what each case answers with the payload it wants the form seeded from.
   *
   * @param action the `:action` segment, or `null` for a route that carries none.
   * @param id the `:id` segment, or `null` for a route that carries none.
   */
  async function show(action: string | null, id: string | null = LOAN_ID): Promise<void> {
    // Each case mounts the screen for its own URL, so the module is reset first: the route stub is the
    // one provider a case supplies, and a module left instantiated by the previous case cannot take a
    // new one.
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      imports: [LoanActionComponent],
      providers: [
        provideHttpClient(withInterceptors([MAP_FINERACT_FAILURES])),
        provideHttpClientTesting(),
        provideTranslateService(),
        { provide: Router, useValue: { navigate } },
        { provide: ActivatedRoute, useValue: { paramMap: of(paramsFor(action, id)) } },
      ],
    });

    await TestBed.inject(AppConfigService).load();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', TRANSLATIONS, true);
    translate.use('en');

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LoanActionComponent);
    component = fixture.componentInstance;
  }

  /** Answers the mode's seed read and renders what the seeded form looks like. */
  async function settle(template: LoanActionTemplate | LoanTransactionTemplate): Promise<void> {
    const pending = httpMock.match(() => true);

    expect(pending).toHaveLength(1);
    pending[0].flush(template);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
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

    navigate = vi.fn<(commands: readonly unknown[]) => Promise<boolean>>(() => Promise.resolve(true));
  });

  afterEach(() => {
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  it('seeds the approval form from the approval template and reads nothing else', async () => {
    await show('approve');

    const read = httpMock.expectOne(isApprovalTemplateRead);
    expect(read.request.method).toBe('GET');
    // The template type is the query parameter the legacy resource call sends (AAP 0.7.3 "W5").
    expect(read.request.params.keys()).toEqual(['templateType']);
    expect(read.request.params.get('templateType')).toBe('approval');

    read.flush(APPROVAL_TEMPLATE);
    await fixture.whenStable();
    fixture.detectChanges();

    // The principal is the template's own figure, not a hard-coded one; the date stays empty and
    // required, because seeding it would mean reading Fineract's wire date shape in this screen.
    expect(component.approveForm.controls.approvedLoanAmount.value).toBe(5000);
    expect(component.approveForm.controls.approvedOnDate.value).toBeNull();
    expect(component.approveForm.controls.approvedOnDate.hasError('required')).toBe(true);
    // One read is the whole load: no disbursement seed, no record read.
    httpMock.expectNone(isTransactionsTemplateRead('disburse'));
    httpMock.expectNone(isRecordRead);
  });

  it('reads the same approval template for a rejection, whose date the template does not carry', async () => {
    await show('reject');
    await settle(APPROVAL_TEMPLATE);

    expect(component.mode()).toBe('reject');
    expect(component.command()).toBe('reject');
    // The rejection date is not in the approval payload, so it starts empty rather than invented.
    expect(component.rejectForm.controls.rejectedOnDate.value).toBeNull();
    expect(component.rejectForm.controls.rejectedOnDate.hasError('required')).toBe(true);
    // The heading follows the command, not the endpoint that was read.
    expect(host().querySelector('h4.panel-title')?.textContent?.trim()).toBe('Reject');
  });

  it('seeds the disbursement form from the transactions template of the disburse command', async () => {
    await show('disburse');

    const read = httpMock.expectOne(isTransactionsTemplateRead('disburse'));
    expect(read.request.method).toBe('GET');
    expect(read.request.params.get('command')).toBe('disburse');

    read.flush(DISBURSE_TEMPLATE);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.disburseForm.controls.transactionAmount.value).toBe(5000);
    expect(component.disburseForm.controls.actualDisbursementDate.value).toBeNull();
    // The template's payment types are deliberately not rendered: the disburse body has no member for
    // one, so a picker would collect a choice nothing posts (the departure recorded on the class).
    expect(host().querySelector('select')).toBeNull();
    httpMock.expectNone(isApprovalTemplateRead);
  });

  it('renders the mode’s legacy captions, never a raw key', async () => {
    await show('approve');
    await settle(APPROVAL_TEMPLATE);

    const rendered = host().textContent ?? '';

    expect(host().querySelector('h4.panel-title')?.textContent?.trim()).toBe('Approve');
    expect(host().querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Approve');
    expect(rendered).toContain('Principal');
    expect(rendered).toContain('Note');
    expect(rendered).not.toContain('label.');
    // Every control the workflow fills carries a stable id, so the parity harness addresses the same
    // field on both applications.
    expect(host().querySelector('#approvedOnDate')).not.toBeNull();
    expect(host().querySelector('#approvedLoanAmount')).not.toBeNull();
    expect(host().querySelector('#approveNote')).not.toBeNull();
  });

  it('posts exactly one approve, dated and localised by the service, then returns to the record', async () => {
    await show('approve');
    await settle(APPROVAL_TEMPLATE);

    component.approveForm.patchValue({
      approvedOnDate: new Date(2026, 10, 24),
      approvedLoanAmount: 4800,
      note: '   ',
    });

    const submission = component.submit();
    const post = httpMock.expectOne(isActionPost('approve'));

    expect(post.request.params.get('command')).toBe('approve');
    // The wire members the form never holds: the service writes the pattern and the active language
    // as it serialises, so an untouched note adds no member and the command travels in the query.
    expect(post.request.body).toMatchObject({
      approvedOnDate: '24 November 2026',
      approvedLoanAmount: 4800,
      dateFormat: 'dd MMMM yyyy',
      locale: 'en',
    });
    expect(post.request.body).not.toHaveProperty('note');
    expect(post.request.body).not.toHaveProperty('command');

    post.flush({ resourceId: 9 });
    await submission;
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(RECORD_ROUTE);
  });

  it('refuses a second submit while the first is still in flight', async () => {
    await show('disburse');
    await settle(DISBURSE_TEMPLATE);

    component.disburseForm.patchValue({
      actualDisbursementDate: new Date(2026, 10, 24),
      transactionAmount: 5000,
    });

    const first = component.submit();
    const second = component.submit();

    const post = httpMock.expectOne(isActionPost('disburse'));
    expect(post.request.params.get('command')).toBe('disburse');
    post.flush({ resourceId: 9 });

    await Promise.all([first, second]);

    // W5's expected outcome is one POST per action: the guard refuses re-entry rather than queueing it.
    expect(httpMock.match(isAnyPostToLoan)).toHaveLength(0);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('sends nothing while a required field is missing, and marks the field', async () => {
    await show('approve');
    await settle(APPROVAL_TEMPLATE);
    component.approveForm.controls.approvedOnDate.setValue(null);
    component.approveForm.controls.approvedLoanAmount.setValue(null);

    await component.submit();
    fixture.detectChanges();

    httpMock.expectNone(isAnyPostToLoan);
    expect(host().textContent).toContain('Required field');
    expect(host().querySelector('#approvedLoanAmount')?.getAttribute('aria-invalid')).toBe('true');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows Fineract’s message verbatim and keeps every entered value', async () => {
    await show('approve');
    await settle(APPROVAL_TEMPLATE);

    component.approveForm.patchValue({
      approvedOnDate: new Date(2026, 10, 24),
      approvedLoanAmount: 4800,
      note: 'Retry after the date is corrected',
    });

    const submission = component.submit();
    httpMock
      .expectOne(isActionPost('approve'))
      .flush({ defaultUserMessage: REJECTED_MESSAGE }, { status: 400, statusText: 'Bad Request' });

    await submission;
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host().querySelector('[role="alert"]')?.textContent?.trim()).toBe(REJECTED_MESSAGE);
    // The form stays mounted with what the user entered, so the refusal can be corrected in place.
    expect(component.approveForm.getRawValue()).toMatchObject({
      approvedLoanAmount: 4800,
      note: 'Retry after the date is corrected',
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reads nothing for an undo approval, states the action, and posts the note alone', async () => {
    await show('undoapproval');

    // The confirm view has no defaults to seed, so the screen issues no seed read at all.
    httpMock.expectNone(() => true);
    fixture.detectChanges();

    expect(host().textContent).toContain('Undo Approval');
    component.undoapprovalForm.controls.note.setValue('  approval entered twice  ');

    const submission = component.submit();
    const post = httpMock.expectOne(isActionPost('undoapproval'));

    expect(post.request.params.get('command')).toBe('undoapproval');
    // The server takes the note and nothing else for this command: no date, and therefore no date
    // pattern or language beside it.
    expect(post.request.body).toEqual({ note: 'approval entered twice' });

    post.flush({ resourceId: 9 });
    await submission;

    expect(navigate).toHaveBeenCalledWith(RECORD_ROUTE);
  });

  it('posts the empty body an undo disbursal takes', async () => {
    await show('undodisbursal');
    httpMock.expectNone(() => true);
    fixture.detectChanges();

    expect(host().textContent).toContain('Undo Disbursal');

    const submission = component.submit();
    const post = httpMock.expectOne(isActionPost('undodisbursal'));

    expect(post.request.params.get('command')).toBe('undodisbursal');
    expect(post.request.body).toEqual({});

    post.flush({ resourceId: 9 });
    await submission;

    expect(navigate).toHaveBeenCalledWith(RECORD_ROUTE);
  });

  it('renders the not-found message for a segment this application does not serve, with no request', async () => {
    await show('nonsense');

    httpMock.expectNone(() => true);
    fixture.detectChanges();

    expect(component.notFound()).toBe(true);
    expect(component.command()).toBeNull();
    expect(host().textContent).toContain('Not Available');
    expect(host().textContent).toContain('The requested resource is not available.');
    // No form is rendered for a screen that does not exist, so nothing can be posted against the loan.
    expect(host().querySelector('form')).toBeNull();
  });

  it('renders the not-found message in place of the form when the seed read answers 404', async () => {
    await show('disburse');

    httpMock
      .expectOne(isTransactionsTemplateRead('disburse'))
      .flush({ defaultUserMessage: 'Loan not found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.notFound()).toBe(true);
    expect(component.error()).toBeNull();
    expect(host().textContent).toContain('The requested resource is not available.');
    expect(host().querySelector('form')).toBeNull();
  });

  it('delegates the repayment mode to the child screen and issues no action read of its own', async () => {
    await show('repayment');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host().querySelector('app-loan-repayment')).not.toBeNull();
    expect(component.command()).toBeNull();
    // The child renders its own `#loanRepaymentForm` as soon as it mounts, so the page's only form is
    // the child's: this screen contributes no form of its own in repayment mode, and a form of its own
    // would sit outside the child element and fail the last assertion below.
    const child = host().querySelector('app-loan-repayment');
    const forms = Array.from(host().querySelectorAll('form'));

    expect(child?.querySelector('form')).not.toBeNull();
    expect(forms.length).toBeGreaterThan(0);
    expect(forms.filter((form) => child?.contains(form) !== true)).toHaveLength(0);
    // The child owns workflow W6: this screen reads neither action template and posts nothing.
    httpMock.expectNone(isApprovalTemplateRead);
    httpMock.expectNone(isTransactionsTemplateRead('disburse'));

    // The child's own two reads are answered here so the suite verifies a clean transport.
    const repaymentSeed = httpMock.expectOne(isTransactionsTemplateRead('repayment'));
    repaymentSeed.flush({ paymentTypeOptions: [], date: [2026, 11, 24] });
    await fixture.whenStable();

    httpMock
      .expectOne(isRecordRead)
      .flush({ id: 9, status: { id: 300, code: 'loanStatusType.active', value: 'Active' } });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(httpMock.match(isAnyPostToLoan)).toHaveLength(0);
  });
});

