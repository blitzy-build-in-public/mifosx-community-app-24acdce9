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

/**
 * A second loan, so one component instance can be handed two URLs in a row — the router reuses the
 * screen across `#/loanaccount/{id}/{action}` — and the two reads they start can answer out of order.
 */
const OTHER_LOAN_ID = '10';

/** `GET /loans/{id}/template` — the approval form's seed. */
const APPROVAL_TEMPLATE_URL = `${API_ROOT}/loans/${LOAN_ID}/template`;

/** The same read for {@link OTHER_LOAN_ID}: the superseded one of the reuse cases. */
const OTHER_APPROVAL_TEMPLATE_URL = `${API_ROOT}/loans/${OTHER_LOAN_ID}/template`;

/** `GET /loans/{id}/transactions/template` — the disbursement and repayment forms' seed. */
const TRANSACTIONS_TEMPLATE_URL = `${API_ROOT}/loans/${LOAN_ID}/transactions/template`;

/** `POST /loans/{id}?command=<command>` — the one write this screen makes. */
const LOAN_URL = `${API_ROOT}/loans/${LOAN_ID}`;

/** Where the screen returns once a command lands. */
const RECORD_ROUTE = ['/viewloanaccount', LOAN_ID];

/**
 * The router table the cancel-link case installs, so a real `RouterLink` resolves its target instead of
 * a stubbed router answering nothing.
 *
 * One route, and deliberately no component: the case asserts where the cancel control points and that
 * following it posts nothing, not what the record screen renders — that screen is another subject.
 */
const RECORD_ROUTES: Routes = [{ path: 'viewloanaccount/:id', children: [] }];

/**
 * The two URLs that name no screen of this application: an empty `:action` segment and a route carrying
 * no `:id`. Both are the not-found outcome, and the parameterised case built from them asserts that a
 * URL the application does not serve issues no request and so cannot post against a loan (AAP 0.7.4).
 */
const UNSERVED_URLS: readonly (readonly [string, ParamMap])[] = [
  ['an empty action segment', convertToParamMap({ id: LOAN_ID, action: '' })],
  ['no loan id', convertToParamMap({ action: 'approve' })],
];

/**
 * The legacy captions this screen resolves, keyed exactly as the shipped flat translation bundles key
 * them. A key that did not resolve would render humanised through the missing-translation handler, so
 * serving the real wording is what proves the labels below resolve rather than fall back.
 */
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
  'label.areyousure': 'Are you sure?',
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
 * The approval template {@link OTHER_LOAN_ID} answers with: a different figure, so a template that
 * seeded the wrong loan's form is visible in the assertion rather than hidden by equal amounts.
 */
const OTHER_APPROVAL_TEMPLATE: LoanActionTemplate = {
  approvalDate: [2026, 11, 24],
  expectedDisbursementDate: [2026, 11, 24],
  approvalAmount: 2750,
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

/** One mode whose form collects an amount, with the control the figure is typed into. */
interface AmountMode {
  /** The `:action` segment that selects the mode. */
  readonly action: 'approve' | 'disburse';

  /** The seed read the mode answers with. */
  readonly template: LoanActionTemplate | LoanTransactionTemplate;

  /** The member of the posted body the control's value travels in. */
  readonly amountKey: 'approvedLoanAmount' | 'transactionAmount';

  /** The control of the mounted screen that holds the amount. */
  readonly control: (screen: LoanActionComponent) => FormControl<number | null>;
}

/**
 * The two amount-bearing modes. They differ only in the action mounted and the control carrying the
 * figure, so one parameterised case asserts the rule for both instead of repeating it twice.
 */
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

/** The message a refused approval answers with, quoted from a real Fineract validation failure. */
const REJECTED_MESSAGE = 'The loan cannot be approved because the approval date is before the submission date.';

/** The text a 5xx answers with; the interceptor turns it into that failure's one notification. */
const SERVER_FAILURE_MESSAGE = 'The request could not be processed because an internal error occurred.';

/**
 * Installs the production mapping of a Fineract failure onto the test transport, so a rejection
 * arrives as the `ApiError` the component catches in the application (AAP 0.4.2; workflow W7).
 */
const MAP_FINERACT_FAILURES: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((failure: HttpErrorResponse) => throwError(() => toApiError(failure))),
  );

/**
 * Whether a date is the browser clock's own day at local midnight — the default the three dated loan
 * actions start at, as legacy's `new Date()` does and AAP 0.10.5 item 15 registers.
 *
 * The calendar fields are compared, never object identity: no two `Date` instances are equal, and the
 * component builds its own at construction, so an identity check could never hold.
 *
 * @param value the value a date control holds.
 * @returns true when it is today, at 00:00 local time.
 */
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

/**
 * The browser clock's own day as the native date control renders it — `yyyy-mm-dd` — so the rendered
 * field can be asserted against the same day the control holds.
 *
 * @returns today's date in the format `input[type=date]` displays.
 */
function todayInputValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${now.getFullYear()}-${month}-${day}`;
}

/** Matches the approval-template read, whatever query the screen sent with it. */
function isApprovalTemplateRead(request: { readonly url: string }): boolean {
  return request.url === APPROVAL_TEMPLATE_URL;
}

/** Matches the approval-template read of the second loan the reuse cases hand one component. */
function isOtherApprovalTemplateRead(request: { readonly url: string }): boolean {
  return request.url === OTHER_APPROVAL_TEMPLATE_URL;
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
   * Mounts the screen on a route stub, and is the one place the TestBed is configured.
   *
   * Each case mounts for its own URL, so the module is reset first: the route stub is the one provider a
   * case supplies, and a module left instantiated by the previous case cannot take a new one.
   *
   * @param paramMap the route's own `paramMap`, which decides how many URLs the instance is handed.
   * @param router the router providers, which default to the navigation spy. The cancel-link case
   *   installs a real router instead, because a stub that answers no URL tree leaves a `routerLink`
   *   nothing to resolve and its target unassertable.
   */
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

  /**
   * Mounts the screen for one `#/loanaccount/:id/:action` URL.
   *
   * Every case that acts on a single URL starts here, so the mode, the id and the route stub are the
   * only thing it changes. The component's own constructor resolves the segments and issues the mode's
   * seed read, so the pending request is what each case answers with the payload it wants the form
   * seeded from.
   *
   * @param action the `:action` segment, or `null` for a route that carries none.
   * @param id the `:id` segment, or `null` for a route that carries none.
   * @param router the router providers, defaulted as {@link mount} defaults them.
   */
  async function show(
    action: string | null,
    id: string | null = LOAN_ID,
    router: readonly (Provider | EnvironmentProviders)[] = [
      { provide: Router, useValue: { navigate } },
    ],
  ): Promise<void> {
    await mount(of(paramsFor(action, id)), router);
  }

  /**
   * Mounts the screen on a route stub the case drives itself, so one instance can be handed two URLs.
   *
   * This is how the reuse the router performs across `#/loanaccount/{id}/{action}` is reproduced: the
   * component subscribes once, two emissions follow, and the reads they start can be answered in either
   * order — which is what a superseded answer is.
   *
   * @returns the subject the case emits through, one parameter map per URL.
   */
  async function showRouted(): Promise<Subject<ParamMap>> {
    const params = new Subject<ParamMap>();

    await mount(params);
    fixture.detectChanges();

    return params;
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

    // The principal is the template's own figure, not a hard-coded one; the date is the browser
    // clock's own day, the default legacy's approval screen assigns, and stays required so the
    // server decides whether the date it receives is acceptable.
    expect(component.approveForm.controls.approvedLoanAmount.value).toBe(5000);
    expect(isLocalMidnightToday(component.approveForm.controls.approvedOnDate.value)).toBe(true);
    expect(component.approveForm.controls.approvedOnDate.hasError('required')).toBe(false);
    expect(component.approveForm.controls.approvedOnDate.hasValidator(Validators.required)).toBe(true);
    // The rendered native date input carries that day, so the form does not open with an empty date.
    const approvedOnInput = host().querySelector<HTMLInputElement>('#approvedOnDate');
    expect(approvedOnInput?.value).toBe(todayInputValue());
    // One read is the whole load: no disbursement seed, no record read.
    httpMock.expectNone(isTransactionsTemplateRead('disburse'));
    httpMock.expectNone(isRecordRead);
  });

  it('rejects without reading any template, then posts the date and the note alone', async () => {
    await show('reject');

    // The rejection screen issues no seed read at all: its form holds the rejection date and a note,
    // legacy's rejection branch reads no template, and AAP 0.7.3's W5 row declares the approval template
    // on the approve path alone. There is nothing to wait for, so the form is on screen at once.
    httpMock.expectNone(() => true);
    fixture.detectChanges();

    expect(component.mode()).toBe('reject');
    expect(component.command()).toBe('reject');
    expect(component.loading()).toBe(false);
    expect(host().querySelector('h3.panel-title')?.textContent?.trim()).toBe('Reject Loan Account');
    expect(host().querySelector('#rejectedOnDate')).not.toBeNull();
    // The date is the browser clock's own day at local midnight — the default legacy's rejection screen
    // assigns — and stays editable and required, so the server decides whether it is acceptable.
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
    // The body is the command's own fields plus the pattern and language the service writes as it
    // serialises; the note travels trimmed, and the command never appears in the body.
    expect(post.request.body).toEqual({
      rejectedOnDate: '24 November 2026',
      note: 'rejected at the branch',
      dateFormat: 'dd MMMM yyyy',
      locale: 'en',
    });

    post.flush({ resourceId: 9 });
    await submission;

    expect(navigate).toHaveBeenCalledWith(RECORD_ROUTE);
    // A note that carries no text adds no member at all, as legacy's untouched note field does.
    component.rejectForm.controls.note.setValue('   ');
    expect(component.buildRequest()).toEqual({
      command: 'reject',
      rejectedOnDate: new Date(2026, 10, 24),
    });
  });

  it('drops a superseded approval read so the current loan keeps its own amount', async () => {
    const params = await showRouted();

    // One instance, two URLs — the reuse the router performs — so both reads are in flight at once.
    params.next(paramsFor('approve', LOAN_ID));
    const superseded = httpMock.expectOne(isApprovalTemplateRead);

    params.next(paramsFor('approve', OTHER_LOAN_ID));
    const current = httpMock.expectOne(isOtherApprovalTemplateRead);

    expect(superseded.request.url).toBe(APPROVAL_TEMPLATE_URL);
    expect(current.request.url).toBe(OTHER_APPROVAL_TEMPLATE_URL);

    // The loan the address now names answers first ...
    current.flush(OTHER_APPROVAL_TEMPLATE);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.id()).toBe(OTHER_LOAN_ID);
    expect(component.loading()).toBe(false);
    expect(component.approveForm.controls.approvedLoanAmount.value).toBe(2750);

    // ... and the loan the URL has left answers last: its figure must seed nothing, or it would reach
    // the current loan's approve POST.
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

    // The loan the URL has left is gone, which must not turn the current loan's form into the
    // not-found message nor paint its failure above it.
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

    // The date is the browser clock's own day, the default legacy's disburse screen assigns, and
    // stays required rather than being read from the template's wire date.
    const disbursedOn = component.disburseForm.controls.actualDisbursementDate;

    expect(component.disburseForm.controls.transactionAmount.value).toBe(5000);
    expect(isLocalMidnightToday(disbursedOn.value)).toBe(true);
    expect(disbursedOn.hasError('required')).toBe(false);
    expect(disbursedOn.hasValidator(Validators.required)).toBe(true);
    // The template's payment types are deliberately not rendered: the disburse body has no member for
    // one, so a picker would collect a choice nothing posts (the departure recorded on the class).
    expect(host().querySelector('select')).toBeNull();
    // The disbursed amount is required, so its caption carries the same legacy marker.
    const amountLabel = host().querySelector('label[for="transactionAmount"]');
    expect(amountLabel?.querySelector('span.required')?.textContent).toBe('*');
    httpMock.expectNone(isApprovalTemplateRead);
  });

  it('renders the mode’s legacy captions, never a raw key', async () => {
    await show('approve');
    await settle(APPROVAL_TEMPLATE);

    const rendered = host().textContent ?? '';

    expect(host().querySelector('h3.panel-title')?.textContent?.trim()).toBe('Approve Loan Account');
    expect(host().querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Approve');
    expect(rendered).toContain('Principal');
    expect(rendered).toContain('Note');
    expect(rendered).not.toContain('label.');
    // Every control the workflow fills carries a stable id, so the parity harness addresses the same
    // field on both applications.
    expect(host().querySelector('#approvedOnDate')).not.toBeNull();
    expect(host().querySelector('#approvedLoanAmount')).not.toBeNull();
    // The note is `note` — the legacy textarea's own id — so both applications expose one note id.
    expect(host().querySelector('#note')).not.toBeNull();
    // A required amount shows the legacy marker beside its caption, as every other required field
    // in the loan and savings forms does.
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

    // The trigger is disabled for exactly as long as the request is in flight, which is what stops a
    // second click reaching an endpoint Fineract does not make idempotent (AAP 0.4.2, workflow W5).
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

      // Fineract alone bounds an amount: a figure below any product minimum and one above any maximum
      // are both accepted by the form, so the out-of-range principal workflow W7 depends on reaches the
      // server and the server's own message is what the user reads (Rule 1 clause 3; AAP 0.4.4 decision 6).
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

      // The body this screen assembles carries the command's own fields only: `dateFormat` and `locale`
      // are written by the service as it serialises, so the screen holds no second copy of the date
      // contract and the payload keeps exactly one writer (Rule 1 clause 2).
      const body = component.buildRequest();

      expect(body).toMatchObject({ [mode.amountKey]: 50000 });
      expect(Object.keys(body ?? {})).not.toContain('dateFormat');
      expect(Object.keys(body ?? {})).not.toContain('locale');
    },
  );

  it('offers a cancel that returns to the loan record and posts nothing', async () => {
    // A real router, so the shipped `routerLink` resolves its target rather than a stub answering no URL
    // tree: the assertion below is about where the control points, not about a mocked navigation.
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

    // Following the cancel link leaves for the record and sends nothing: no action is posted, so the
    // screen's cancel path cannot change the loan's state.
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
    // The form stays mounted with what the user entered, so the refusal can be corrected in place.
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

    // A 5xx has already produced the interceptor's single notification, so the screen paints no
    // second copy of it (AAP 0.7.4): the failure it keeps is `null`, and no alert is in the DOM.
    expect(component.error()).toBeNull();
    expect(host().querySelector('[role="alert"]')).toBeNull();
    expect(host().querySelector('.alert.alert-danger')).toBeNull();
    // The form stays mounted with what the user entered, so the action can be retried as it stands.
    expect(host().querySelector('form')).not.toBeNull();
    expect(component.approveForm.getRawValue()).toMatchObject({
      approvedLoanAmount: 4800,
      note: 'Awaiting the branch manager',
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reads nothing for an undo approval, states the action, and posts the note alone', async () => {
    await show('undoapproval');

    // The confirm view has no defaults to seed, so the screen issues no seed read at all.
    httpMock.expectNone(() => true);
    fixture.detectChanges();

    expect(host().querySelector('h3.panel-title')?.textContent?.trim()).toBe('Undo Approve Loan Account');
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

    expect(host().querySelector('h3.panel-title')?.textContent?.trim()).toBe('Undo Disburse Loan Account');
    // The confirm view states the action and offers its submit in the card's footer; it holds no control,
    // which is why its primary button is not a form submit.
    expect(host().querySelector('app-empty-state')?.textContent?.trim()).toBe('Are you sure?');
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
    // No form is rendered for a screen that does not exist, so nothing can be posted against the loan.
    expect(host().querySelector('form')).toBeNull();
  });

  it.each(UNSERVED_URLS)(
    'renders the not-found message for a route with %s, with no request',
    async (_case: string, params: ParamMap) => {
      await mount(of(params));

      // A URL that names no screen of this application issues no request at all — not a seed read and
      // not a post — so it cannot change a loan's state (AAP 0.7.4 state rules; AAP 0.9.2).
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

    // The approval read is the other seed a 404 can refuse: the id is not a loan, or not a loan in a
    // state this command applies to, so the message replaces the form and no control can post.
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

    // The child's own read is answered here so the suite verifies a clean transport: one transaction
    // template seeds its payment types, amount and date, and no record read follows it — the extra
    // `GET /loans/{id}?associations=all` legacy's repayment screen never makes is not issued at all
    // (Rule 1 clauses 2 and 3; AAP 0.10.5 holds no entry for it).
    const repaymentSeed = httpMock.expectOne(isTransactionsTemplateRead('repayment'));
    repaymentSeed.flush({ paymentTypeOptions: [], date: [2026, 11, 24], amount: 467 });
    await fixture.whenStable();
    fixture.detectChanges();

    httpMock.expectNone(isRecordRead);
    expect(httpMock.match(isAnyPostToLoan)).toHaveLength(0);
  });
});

