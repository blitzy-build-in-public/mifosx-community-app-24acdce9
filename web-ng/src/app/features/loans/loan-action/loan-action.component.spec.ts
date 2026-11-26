import { Location } from '@angular/common';
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
import { provideLocationMocks } from '@angular/common/testing';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Validators, type FormControl } from '@angular/forms';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
  withDisabledInitialNavigation,
  type ParamMap,
  type Routes,
} from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { catchError, of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DEFAULT_APP_CONFIG } from '../../../core/config/app-config.model';
import { AppConfigService } from '../../../core/config/app-config.service';
import { toApiError } from '../../../core/http/api-error';
import type { LoanActionTemplate, LoanTransactionTemplate } from '../loan.models';
import { LoanActionComponent } from './loan-action.component';

/** Behaviour of the loan lifecycle action screen — workflow W5 (AAP 0.10.1; AAP 0.7.4 action screens; Rule 1 clause 8): one POST per action, the amount seeded from the template, the browser clock's day as the default date, and a loan that reaches `Active`. */

const SERVED_CONFIG = DEFAULT_APP_CONFIG;
const API_ROOT = `${SERVED_CONFIG.apiBaseUrl}${SERVED_CONFIG.apiPath}`;
const LOAN_ID = '9';
const OTHER_LOAN_ID = '10';
const APPROVAL_TEMPLATE_URL = `${API_ROOT}/loans/${LOAN_ID}/template`;
const OTHER_APPROVAL_TEMPLATE_URL = `${API_ROOT}/loans/${OTHER_LOAN_ID}/template`;
const TRANSACTIONS_TEMPLATE_URL = `${API_ROOT}/loans/${LOAN_ID}/transactions/template`;
const LOAN_URL = `${API_ROOT}/loans/${LOAN_ID}`;
const RECORD_ROUTE = ['/viewloanaccount', LOAN_ID];
const RECORD_ROUTES: Routes = [{ path: 'viewloanaccount/:id', children: [] }];
const UNSERVED_URLS: readonly (readonly [string, ParamMap])[] = [
  ['an empty action segment', convertToParamMap({ id: LOAN_ID, action: '' })],
  ['no loan id', convertToParamMap({ action: 'approve' })],
];
const TRANSLATIONS: Readonly<Record<string, string>> = {
  'label.heading.approveloanaccount': 'Approve Loan Account',
  'label.heading.rejectloanaccount': 'Reject Loan Account',
  'label.heading.disburseloanaccount': 'Disburse Loan Account',
  'label.heading.undoapproveloanaccount': 'Undo Approve Loan Account',
  'label.heading.undodisburseloanaccount': 'Undo Disburse Loan Account',
  'label.button.approve': 'Approve',
  'label.button.reject': 'Reject',
  'label.button.disburse': 'Disburse',
  'label.button.undoapproval': 'Undo Approval',
  'label.button.undodisbursal': 'Undo Disbursal',
  'label.heading.date': 'Date',
  'label.heading.principal': 'Principal',
  'label.heading.amount': 'Amount',
  'label.input.note': 'Note',
  'label.requiredfield': 'Required field',
  'label.button.cancel': 'Cancel',
  'label.heading.notavailable': 'Not Available',
  'error.msg.resource.not.found': 'The requested resource is not available.',
};
const APPROVAL_TEMPLATE: LoanActionTemplate = {
  approvalDate: [2026, 11, 24],
  expectedDisbursementDate: [2026, 11, 24],
  approvalAmount: 5000,
};
const OTHER_APPROVAL_TEMPLATE: LoanActionTemplate = {
  approvalDate: [2026, 11, 24],
  expectedDisbursementDate: [2026, 11, 24],
  approvalAmount: 2750,
};
const DISBURSE_TEMPLATE: LoanTransactionTemplate = {
  paymentTypeOptions: [{ id: 1, name: 'Cash' }],
  date: [2026, 11, 24],
  amount: 5000,
  loanId: 9,
};
interface AmountMode {
  readonly action: 'approve' | 'disburse';
  readonly template: LoanActionTemplate | LoanTransactionTemplate;
  readonly amountKey: 'approvedLoanAmount' | 'transactionAmount';
  readonly control: (screen: LoanActionComponent) => FormControl<number | null>;
}
const AMOUNT_MODES: readonly AmountMode[] = [
  {
    action: 'approve',
    template: APPROVAL_TEMPLATE,
    amountKey: 'approvedLoanAmount',
    control: (screen) => screen.approveForm.controls.approvedLoanAmount,
  },
  {
    action: 'disburse',
    template: DISBURSE_TEMPLATE,
    amountKey: 'transactionAmount',
    control: (screen) => screen.disburseForm.controls.transactionAmount,
  },
];
const REJECTED_MESSAGE = 'The loan cannot be approved because the approval date is before the submission date.';
const SERVER_FAILURE_MESSAGE = 'The request could not be processed because an internal error occurred.';
const MAP_FINERACT_FAILURES: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((failure: HttpErrorResponse) => throwError(() => toApiError(failure))),
  );

// The three dated actions default to the browser clock's own day at local midnight, as legacy's `new Date()` does — AAP 0.10.5 item 15 — compared by calendar fields because no two `Date` instances are equal.
function isLocalMidnightToday(value: Date | null): boolean {
  if (value === null) {
    return false;
  }
  const now = new Date();
  return (
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth() &&
    value.getDate() === now.getDate() &&
    value.getHours() === 0 &&
    value.getMinutes() === 0 &&
    value.getSeconds() === 0 &&
    value.getMilliseconds() === 0
  );
}
function todayInputValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
function isApprovalTemplateRead(request: { readonly url: string }): boolean {
  return request.url === APPROVAL_TEMPLATE_URL;
}
function isOtherApprovalTemplateRead(request: { readonly url: string }): boolean {
  return request.url === OTHER_APPROVAL_TEMPLATE_URL;
}
function isTransactionsTemplateRead(command: string): (request: TestRequest['request']) => boolean {
  return (request) =>
    request.url === TRANSACTIONS_TEMPLATE_URL && request.params.get('command') === command;
}
function isActionPost(command: string): (request: TestRequest['request']) => boolean {
  return (request) =>
    request.method === 'POST' && request.url === LOAN_URL && request.params.get('command') === command;
}
function isAnyPostToLoan(request: TestRequest['request']): boolean {
  return request.method === 'POST' && request.url === LOAN_URL;
}
function isRecordRead(request: TestRequest['request']): boolean {
  return request.method === 'GET' && request.url === LOAN_URL;
}

describe('LoanActionComponent', () => {
  let fixture: ComponentFixture<LoanActionComponent>;
  let component: LoanActionComponent;
  let httpMock: HttpTestingController;
  let navigate: Mock<(commands: readonly unknown[]) => Promise<boolean>>;
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
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
  async function mount(
    paramMap: Observable<ParamMap>,
    router: readonly (Provider | EnvironmentProviders)[] = [
      { provide: Router, useValue: { navigate } },
    ],
  ): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LoanActionComponent],
      providers: [
        provideHttpClient(withInterceptors([MAP_FINERACT_FAILURES])),
        provideHttpClientTesting(),
        provideTranslateService(),
        ...router,
        { provide: ActivatedRoute, useValue: { paramMap } },
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
  async function show(
    action: string | null,
    id: string | null = LOAN_ID,
    router: readonly (Provider | EnvironmentProviders)[] = [
      { provide: Router, useValue: { navigate } },
    ],
  ): Promise<void> {
    await mount(of(paramsFor(action, id)), router);
  }
  async function showRouted(): Promise<Subject<ParamMap>> {
    const params = new Subject<ParamMap>();
    await mount(params);
    fixture.detectChanges();
    return params;
  }
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
    expect(read.request.params.keys()).toEqual(['templateType']);
    expect(read.request.params.get('templateType')).toBe('approval');
    read.flush(APPROVAL_TEMPLATE);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.approveForm.controls.approvedLoanAmount.value).toBe(5000);
    expect(isLocalMidnightToday(component.approveForm.controls.approvedOnDate.value)).toBe(true);
    expect(component.approveForm.controls.approvedOnDate.hasError('required')).toBe(false);
    expect(component.approveForm.controls.approvedOnDate.hasValidator(Validators.required)).toBe(true);
    const approvedOnInput = host().querySelector<HTMLInputElement>('#approvedOnDate');
    expect(approvedOnInput?.value).toBe(todayInputValue());
    httpMock.expectNone(isTransactionsTemplateRead('disburse'));
    httpMock.expectNone(isRecordRead);
  });
  it('rejects without reading any template, then posts the date and the note alone', async () => {
    await show('reject');
    httpMock.expectNone(() => true);
    fixture.detectChanges();
    expect(component.mode()).toBe('reject');
    expect(component.command()).toBe('reject');
    expect(component.loading()).toBe(false);
    expect(host().querySelector('h1.panel-title')?.textContent?.trim()).toBe('Reject Loan Account');
    expect(host().querySelector('#rejectedOnDate')).not.toBeNull();
    const rejectedOnDate = component.rejectForm.controls.rejectedOnDate;
    expect(isLocalMidnightToday(rejectedOnDate.value)).toBe(true);
    expect(rejectedOnDate.hasError('required')).toBe(false);
    expect(rejectedOnDate.hasValidator(Validators.required)).toBe(true);
    expect(host().querySelector<HTMLInputElement>('#rejectedOnDate')?.value).toBe(todayInputValue());
    component.rejectForm.patchValue({
      rejectedOnDate: new Date(2026, 10, 24),
      note: '  rejected at the branch  ',
    });
    const submission = component.submit();
    const post = httpMock.expectOne(isActionPost('reject'));
    expect(post.request.params.get('command')).toBe('reject');
    expect(post.request.body).toEqual({
      rejectedOnDate: '24 November 2026',
      note: 'rejected at the branch',
      dateFormat: 'dd MMMM yyyy',
      locale: 'en',
    });
    post.flush({ resourceId: 9 });
    await submission;
    expect(navigate).toHaveBeenCalledWith(RECORD_ROUTE);
    component.rejectForm.controls.note.setValue('   ');
    expect(component.buildRequest()).toEqual({
      command: 'reject',
      rejectedOnDate: new Date(2026, 10, 24),
    });
  });
  it('drops a superseded approval read so the current loan keeps its own amount', async () => {
    const params = await showRouted();
    params.next(paramsFor('approve', LOAN_ID));
    const superseded = httpMock.expectOne(isApprovalTemplateRead);
    params.next(paramsFor('approve', OTHER_LOAN_ID));
    const current = httpMock.expectOne(isOtherApprovalTemplateRead);
    expect(superseded.request.url).toBe(APPROVAL_TEMPLATE_URL);
    expect(current.request.url).toBe(OTHER_APPROVAL_TEMPLATE_URL);
    current.flush(OTHER_APPROVAL_TEMPLATE);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.id()).toBe(OTHER_LOAN_ID);
    expect(component.loading()).toBe(false);
    expect(component.approveForm.controls.approvedLoanAmount.value).toBe(2750);
    superseded.flush(APPROVAL_TEMPLATE);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.approveForm.controls.approvedLoanAmount.value).toBe(2750);
    expect(component.loading()).toBe(false);
    expect(component.notFound()).toBe(false);
    expect(component.error()).toBeNull();
  });
  it('keeps the current loan’s form when a superseded read answers 404', async () => {
    const params = await showRouted();
    params.next(paramsFor('approve', LOAN_ID));
    const superseded = httpMock.expectOne(isApprovalTemplateRead);
    params.next(paramsFor('approve', OTHER_LOAN_ID));
    const current = httpMock.expectOne(isOtherApprovalTemplateRead);
    current.flush(OTHER_APPROVAL_TEMPLATE);
    await fixture.whenStable();
    fixture.detectChanges();
    superseded.flush({ defaultUserMessage: 'Loan not found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.notFound()).toBe(false);
    expect(component.error()).toBeNull();
    expect(host().querySelector('form')).not.toBeNull();
    expect(component.approveForm.controls.approvedLoanAmount.value).toBe(2750);
  });
  it('seeds the disbursement form from the transactions template of the disburse command', async () => {
    await show('disburse');
    const read = httpMock.expectOne(isTransactionsTemplateRead('disburse'));
    expect(read.request.method).toBe('GET');
    expect(read.request.params.get('command')).toBe('disburse');
    read.flush(DISBURSE_TEMPLATE);
    await fixture.whenStable();
    fixture.detectChanges();
    const disbursedOn = component.disburseForm.controls.actualDisbursementDate;
    expect(component.disburseForm.controls.transactionAmount.value).toBe(5000);
    expect(isLocalMidnightToday(disbursedOn.value)).toBe(true);
    expect(disbursedOn.hasError('required')).toBe(false);
    expect(disbursedOn.hasValidator(Validators.required)).toBe(true);
    expect(host().querySelector('select')).toBeNull();
    const amountLabel = host().querySelector('label[for="transactionAmount"]');
    expect(amountLabel?.querySelector('span.required')?.textContent).toBe('*');
    httpMock.expectNone(isApprovalTemplateRead);
  });
  it('renders the mode’s legacy captions, never a raw key', async () => {
    await show('approve');
    await settle(APPROVAL_TEMPLATE);
    const rendered = host().textContent ?? '';
    expect(host().querySelector('h1.panel-title')?.textContent?.trim()).toBe('Approve Loan Account');
    expect(host().querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Approve');
    expect(rendered).toContain('Principal');
    expect(rendered).toContain('Note');
    expect(rendered).not.toContain('label.');
    expect(host().querySelector('#approvedOnDate')).not.toBeNull();
    expect(host().querySelector('#approvedLoanAmount')).not.toBeNull();
    expect(host().querySelector('#note')).not.toBeNull();
    const principalLabel = host().querySelector('label[for="approvedLoanAmount"]');
    expect(principalLabel?.querySelector('span.required')?.textContent).toBe('*');
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
    expect(httpMock.match(isAnyPostToLoan)).toHaveLength(0);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
  it('disables the submit trigger while the post is in flight and re-enables it after', async () => {
    await show('disburse');
    await settle(DISBURSE_TEMPLATE);
    component.disburseForm.patchValue({
      actualDisbursementDate: new Date(2026, 10, 24),
      transactionAmount: 5000,
    });
    fixture.detectChanges();
    const trigger = (): HTMLButtonElement | null => host().querySelector('button[type="submit"]');
    expect(trigger()?.disabled).toBe(false);
    const submission = component.submit();
    fixture.detectChanges();
    expect(component.guard.busy()).toBe(true);
    expect(trigger()?.disabled).toBe(true);
    httpMock.expectOne(isActionPost('disburse')).flush({ resourceId: 9 });
    await submission;
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.guard.busy()).toBe(false);
    expect(trigger()?.disabled).toBe(false);
  });
  it.each(AMOUNT_MODES)(
    'accepts an out-of-range amount on the $action form, leaving the date grammar to the service',
    async (mode: AmountMode) => {
      await show(mode.action);
      await settle(mode.template);
      const amount = mode.control(component);

// Fineract alone bounds an amount — a figure below any product minimum and one above any maximum both reach the server — so the out-of-range principal W7 depends on is the server's to refuse (Rule 1 clause 3).
      amount.setValue(0);
      amount.markAsTouched();
      expect(amount.valid).toBe(true);
      expect(amount.hasError('min')).toBe(false);
      amount.setValue(50000);
      amount.markAsTouched();
      fixture.detectChanges();
      expect(amount.valid).toBe(true);
      expect(amount.errors).toBeNull();
      expect(amount.hasError('max')).toBe(false);
      expect(host().querySelector('.has-error')).toBeNull();
      const body = component.buildRequest();
      expect(body).toMatchObject({ [mode.amountKey]: 50000 });
      expect(Object.keys(body ?? {})).not.toContain('dateFormat');
      expect(Object.keys(body ?? {})).not.toContain('locale');
    },
  );
  it('offers a cancel that returns to the loan record and posts nothing', async () => {
    await show('approve', LOAN_ID, [
      provideRouter(RECORD_ROUTES, withDisabledInitialNavigation()),
      provideLocationMocks(),
    ]);
    await settle(APPROVAL_TEMPLATE);
    const cancel = host().querySelector<HTMLAnchorElement>('.panel-footer a.btn');
    expect(cancel?.textContent?.trim()).toBe('Cancel');
    expect(cancel?.getAttribute('href')).toBe(`/viewloanaccount/${LOAN_ID}`);
    cancel?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(TestBed.inject(Location).path()).toBe(`/viewloanaccount/${LOAN_ID}`);
    httpMock.expectNone(isAnyPostToLoan);
    expect(component.guard.busy()).toBe(false);
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
    expect(component.approveForm.getRawValue()).toMatchObject({
      approvedLoanAmount: 4800,
      note: 'Retry after the date is corrected',
    });
    expect(navigate).not.toHaveBeenCalled();
  });
  it('reports a server error once, through the interceptor’s notification and not on screen', async () => {
    await show('approve');
    await settle(APPROVAL_TEMPLATE);
    component.approveForm.patchValue({
      approvedOnDate: new Date(2026, 10, 24),
      approvedLoanAmount: 4800,
      note: 'Awaiting the branch manager',
    });
    const submission = component.submit();
    httpMock.expectOne(isActionPost('approve')).flush(
      { defaultUserMessage: SERVER_FAILURE_MESSAGE },
      { status: 500, statusText: 'Internal Server Error' },
    );
    await submission;
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.error()).toBeNull();
    expect(host().querySelector('[role="alert"]')).toBeNull();
    expect(host().querySelector('.alert.alert-danger')).toBeNull();
    expect(host().querySelector('form')).not.toBeNull();
    expect(component.approveForm.getRawValue()).toMatchObject({
      approvedLoanAmount: 4800,
      note: 'Awaiting the branch manager',
    });
    expect(navigate).not.toHaveBeenCalled();
  });
  it('reads nothing for an undo approval, states the action, and posts the note alone', async () => {
    await show('undoapproval');
    httpMock.expectNone(() => true);
    fixture.detectChanges();
    expect(host().querySelector('h1.panel-title')?.textContent?.trim()).toBe('Undo Approve Loan Account');
    component.undoapprovalForm.controls.note.setValue('  approval entered twice  ');
    const submission = component.submit();
    const post = httpMock.expectOne(isActionPost('undoapproval'));
    expect(post.request.params.get('command')).toBe('undoapproval');
    expect(post.request.body).toEqual({ note: 'approval entered twice' });
    post.flush({ resourceId: 9 });
    await submission;
    expect(navigate).toHaveBeenCalledWith(RECORD_ROUTE);
  });
  it('posts the empty body an undo disbursal takes', async () => {
    await show('undodisbursal');
    httpMock.expectNone(() => true);
    fixture.detectChanges();
    expect(host().querySelector('h1.panel-title')?.textContent?.trim()).toBe('Undo Disburse Loan Account');
    expect(host().querySelector('app-empty-state')).toBeNull();
    expect(host().querySelector('.panel-body')).toBeNull();
    expect(host().textContent ?? '').not.toContain('Are you sure');
    expect(host().querySelector('form')).toBeNull();
    expect(host().querySelector('.panel-footer button.btn-primary')?.textContent?.trim()).toBe(
      'Undo Disbursal',
    );
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
    expect(host().querySelector('form')).toBeNull();
  });
  it.each(UNSERVED_URLS)(
    'renders the not-found message for a route with %s, with no request',
    async (_case: string, params: ParamMap) => {
      await mount(of(params));
      httpMock.expectNone(() => true);
      fixture.detectChanges();
      expect(component.mode()).toBe('notfound');
      expect(component.command()).toBeNull();
      expect(component.notFound()).toBe(true);
      expect(host().textContent).toContain('The requested resource is not available.');
      expect(host().querySelector('form')).toBeNull();
      expect(host().querySelector('.panel-footer button.btn-primary')).toBeNull();
    },
  );
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
  it('renders the not-found message in place of the approve form when its template read answers 404', async () => {
    await show('approve');
    httpMock
      .expectOne(isApprovalTemplateRead)
      .flush({ defaultUserMessage: 'Loan not found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.notFound()).toBe(true);
    expect(component.error()).toBeNull();
    expect(host().textContent).toContain('Not Available');
    expect(host().querySelector('form')).toBeNull();
    httpMock.expectNone(isAnyPostToLoan);
  });
  it('delegates the repayment mode to the child screen and issues no action read of its own', async () => {
    await show('repayment');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host().querySelector('app-loan-repayment')).not.toBeNull();
    expect(component.command()).toBeNull();
    const child = host().querySelector('app-loan-repayment');
    const forms = Array.from(host().querySelectorAll('form'));
    expect(child?.querySelector('form')).not.toBeNull();
    expect(forms.length).toBeGreaterThan(0);
    expect(forms.filter((form) => child?.contains(form) !== true)).toHaveLength(0);
    httpMock.expectNone(isApprovalTemplateRead);
    httpMock.expectNone(isTransactionsTemplateRead('disburse'));

// The child's repayment seed is answered here so the transport verifies clean: one transaction template, and never the `GET /loans/{id}?associations=all` legacy's repayment screen does not make (Rule 1 clauses 2 and 3; AAP 0.10.5 holds no entry for it).
    const repaymentSeed = httpMock.expectOne(isTransactionsTemplateRead('repayment'));
    repaymentSeed.flush({ paymentTypeOptions: [], date: [2026, 11, 24], amount: 467 });
    await fixture.whenStable();
    fixture.detectChanges();
    httpMock.expectNone(isRecordRead);
    expect(httpMock.match(isAnyPostToLoan)).toHaveLength(0);
  });
});
