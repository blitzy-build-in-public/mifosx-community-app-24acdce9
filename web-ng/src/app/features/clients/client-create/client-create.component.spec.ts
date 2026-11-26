import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ApiError, toApiError } from '../../../core/http/api-error';
import type { ClientCreateRequest, ClientMutationResponse, ClientTemplate, } from '../client.models';
import { ClientService } from '../client.service';
import { ClientCreateComponent } from './client-create.component';

/** Behaviour of the create-client screen (`#/createclient`) — the first half of workflow W2. */
/** The legacy captions this screen resolves, keyed exactly as the shipped flat bundles key them (`app/global-translations/`). */
const TRANSLATIONS: Readonly<Record<string, string>> = {
  'label.heading.createclient': 'Create Client',
  'label.input.office': 'Office',
  'label.input.staff': 'Staff',
  'label.input.firstname': 'First name',
  'label.input.lastname': 'Last name',
  'label.input.externalid': 'External ID',
  'label.input.mobilenumber': 'Mobile number',
  'label.input.submittedon': 'Submitted on',
  'label.input.activationdate': 'Activation date',
  'label.input.active': 'Active',
  'label.menu.selectloanofficer': 'Select Staff',
  'label.requiredfield': 'Required field',
  'validation.msg.client.name.cannot.start.specialchar.ornumber': 'Name cannot start with a number',
  'label.mustbenumeric': 'Must be numeric',
  'label.button.save': 'Save',
  'label.button.cancel': 'Cancel',
};
/** The office the form starts on: the template's own default. */
const HEAD_OFFICE_ID = 1;
/** The other office the template offers, and the office the office-change cases move to. */
const BRANCH_OFFICE_ID = 2;
/** The loan officer the head office offers, and the one the operator picks there. */
const PARITY_OFFICER_ID = 7;
/** The head office's office labels, in the order its template sends them. */
const OFFICE_NAMES: readonly string[] = ['Head Office', 'Branch Two'];
/** The officers the head office offers, labelled by the `displayName` a `staffOptions` entry carries. */
const STAFF_NAMES: readonly string[] = ['Officer, Parity'];
/** The second office's template narrows the office list, so a replaced list is observable. */
const BRANCH_OFFICE_NAMES: readonly string[] = ['Branch Two'];
/** The officers the second office offers: no officer of the first office survives the change. */
const BRANCH_STAFF_NAMES: readonly string[] = ['Officer, Branch'];
/** The template the head office answers with: two offices, one loan officer, and the activation default the fork sends as a `[year, month, day]` triple, with the client not yet active. */
const HEAD_OFFICE_TEMPLATE: ClientTemplate = {
  officeId: HEAD_OFFICE_ID,
  officeOptions: [{ id: HEAD_OFFICE_ID, name: 'Head Office' }, { id: BRANCH_OFFICE_ID, name: 'Branch Two' },],
  staffOptions: [{ id: PARITY_OFFICER_ID, displayName: 'Officer, Parity' }],
  activationDate: [2026, 11, 24],
  active: false,
};
/** What the same read answers once another office is chosen: that office's own option lists. */
const BRANCH_TEMPLATE: ClientTemplate = {
  officeId: BRANCH_OFFICE_ID,
  officeOptions: [{ id: BRANCH_OFFICE_ID, name: 'Branch Two' }],
  staffOptions: [{ id: 9, displayName: 'Officer, Branch' }],
  activationDate: [2026, 11, 24],
  active: true,
};
/** The command result a create answers with: the record and the client id the screen opens. */
const CREATED: ClientMutationResponse = { resourceId: 42, clientId: 42 };
/** The same result without a client id, which the screen must open by its resource id. */
const RESOURCE_ID_ONLY: ClientMutationResponse = { resourceId: 99 };
/** A rejection quoted from a real Fineract validation failure; compared character for character. */
const REJECTED_MESSAGE = 'The client name is already in use by another client.';
/** The text a 5xx answers with. */
const SERVER_FAILURE_MESSAGE = 'Internal server error, please contact your system administrator.';
/** The message a refused navigation produces once the create itself succeeded. */
const NAVIGATION_FAILURE_MESSAGE = 'Navigation to the created record was refused.';
/** The message a failed template read answers with: Fineract's own text, rendered verbatim. */
const TEMPLATE_FAILURE_MESSAGE = 'The office template is not available for this user.';
/** Local midnight of today, the browser-clock default a form's own date starts from. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
/** `ClientService` as this screen uses it: the template read and the create post, both stubbed. */
interface ClientServiceStub {
  readonly template: Mock<ClientService['template']>;
  readonly create: Mock<ClientService['create']>;
}
/** `Router` as this screen and its cancel link use it: the two navigation entry points, each replaced by a spy so no case performs a navigation and every command list and target the screen sends is observable. `navigate` is the component's own
 * call on a successful create; `navigateByUrl` is what `RouterLink` asks for when the cancel anchor is activated. */
interface RouterStub {
  readonly navigate: Mock<Router['navigate']>;
  readonly navigateByUrl: Mock<Router['navigateByUrl']>;
}

describe('ClientCreateComponent', () => {
  let fixture: ComponentFixture<ClientCreateComponent>;
  let component: ClientCreateComponent;
  let clients: ClientServiceStub;
  let router: RouterStub;
  /** The rendered host, narrowed once. */
  const host = (): HTMLElement => {
    const element: unknown = fixture.nativeElement;
    if (!(element instanceof HTMLElement)) {
      throw new Error('the fixture rendered no host element');
    }
    return element;
  };
  /** Every `<select>` on the screen. This screen renders exactly two: the office and the officer. */
  function selects(): HTMLSelectElement[] {
    return Array.from(host().querySelectorAll('select')).filter(
      (element): element is HTMLSelectElement => element instanceof HTMLSelectElement,
    );
  }
  /** The select whose element id is the legacy form's own, so a field is addressed as it is named. */
  function selectById(id: 'officeId' | 'staffId'): HTMLSelectElement {
    const element = host().querySelector<HTMLSelectElement>(`select#${id}`);
    if (element === null) {
      throw new Error(`the screen rendered no select for the "${id}" field`);
    }
    return element;
  }
  /** The visible option labels of one select, in render order. */
  function optionLabels(select: HTMLSelectElement): string[] {
    return Array.from(select.options).map((option) => option.textContent?.trim() ?? '');
  }
  /** The submit control, which must be disabled for as long as its request is in flight. */
  function submitButton(): HTMLButtonElement {
    const element = host().querySelector<HTMLButtonElement>('#save2');
    if (element === null) {
      throw new Error('the screen rendered no submit button');
    }
    return element;
  }
  /** Lets the reads the screen queued resolve and the first paint show them: the constructor's `firstValueFrom` resumes in a microtask, which the awaited turns below cross before the render. */
  async function settle(): Promise<void> {
    for (let turn = 0; turn < 3; turn += 1) {
      await Promise.resolve();
    }
    await fixture.whenStable();
    fixture.detectChanges();
  }
  /** Configures the TestBed from scratch and opens the screen on it, answering nothing: the stubbed template read is whatever the case set on the mock before calling this. */
  async function open(): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ClientCreateComponent],
      providers: [
        // The application runs zoneless (Angular 22's default), so the fixture is told the same and every async case settles with `whenStable()` rather than with a zone (Rule 1 clause 5).
        provideZonelessChangeDetection(),
        { provide: ClientService, useValue: clients },
        // The cancel control is a `RouterLink`, which resolves its target through the real router's `createUrlTree`, so the router has to exist for the template to
        // render at all; its two navigation entry points are replaced by the spies below, so no case navigates anywhere.
        provideRouter([]),
        provideTranslateService(),
      ],
    });
    const applicationRouter = TestBed.inject(Router);
    router = {
      navigate: vi.spyOn(applicationRouter, 'navigate').mockResolvedValue(true),
      navigateByUrl: vi.spyOn(applicationRouter, 'navigateByUrl').mockResolvedValue(true),
    };
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', TRANSLATIONS, true);
    translate.use('en');
    fixture = TestBed.createComponent(ClientCreateComponent);
    component = fixture.componentInstance;
    await settle();
  }
  /** Fills every control a create the server would accept needs, with the fixed parity values the workflows use. */
  function fillValidForm(): void {
    component.form.patchValue({
      officeId: HEAD_OFFICE_ID,
      staffId: PARITY_OFFICER_ID,
      firstname: 'Parity',
      lastname: 'Client',
      externalId: 'EXT-1',
      mobileNo: '2025550101',
      submittedOnDate: startOfToday(),
      activationDate: null,
      active: false,
    });
    fixture.detectChanges();
  }
  /** Fills the form, then asks for a client created active on the browser's today. */
  function fillActiveForm(): void {
    fillValidForm();
    component.form.controls.active.setValue(true);
    component.form.controls.activationDate.setValue(startOfToday());
    fixture.detectChanges();
  }
  beforeEach(async () => {
    clients = { template: vi.fn<ClientService['template']>(), create: vi.fn<ClientService['create']>(), };
    clients.template.mockReturnValue(of(HEAD_OFFICE_TEMPLATE));
    await open();
  });
  it('reads the create template once, with no parameter, and seeds the pickers and the defaults', () => {
    expect(clients.template).toHaveBeenCalledTimes(1);
    // The first read asks for the template as a whole, so the server's own default office is what the form starts on (AAP 0.7.3 row "W2 create and activate client").
    expect(clients.template.mock.calls[0]).toEqual([]);
    expect(selects()).toHaveLength(2);
    expect(optionLabels(selectById('officeId'))).toEqual(OFFICE_NAMES);
    const staffLabels = optionLabels(selectById('staffId'));
    // The leading row is the picker's own prompt; the officer follows it, labelled by the `displayName` a `staffOptions` entry carries, which a field binding `name` would render blank.
    expect(staffLabels).toHaveLength(STAFF_NAMES.length + 1);
    expect(staffLabels.filter((label) => STAFF_NAMES.includes(label))).toEqual(STAFF_NAMES);
    expect(component.form.controls.officeId.value).toBe(HEAD_OFFICE_ID);
    expect(component.form.controls.staffId.value).toBeNull();
    // The submission date keeps the browser clock's default and is held as a `Date`, never as a formatted string (AAP 0.10.5 item 15; AAP 0.7.2 "Date handling").
    expect(component.form.controls.submittedOnDate.value).toBeInstanceOf(Date);
    // The activation default is the template's own, read from its `[year, month, day]` triple.
    expect(component.form.controls.activationDate.value).toEqual(new Date(2026, 10, 24));
    expect(component.form.controls.active.value).toBe(false);
    // The two labels this template owns render as `.control-label` elements naming their control, which is what gives each field the accessible name the design shows.
    expect(host().querySelector('label.control-label[for="officeId"]')).not.toBeNull();
    expect(host().querySelector('label.control-label[for="submittedon"]')).not.toBeNull();
  });
  it('re-reads the template once per office change, replacing the lists and clearing the officer', async () => {
    component.form.controls.staffId.setValue(PARITY_OFFICER_ID);
    component.form.controls.officeId.setValue(HEAD_OFFICE_ID);
    expect(clients.template).toHaveBeenCalledTimes(1);
    clients.template.mockReturnValueOnce(of(BRANCH_TEMPLATE));
    component.form.controls.officeId.setValue(BRANCH_OFFICE_ID);
    await settle();
    expect(clients.template).toHaveBeenCalledTimes(2);
    // The office travels with the staff narrowing, which is the call the legacy form makes on the same event (AAP 0.7.3 row "W2 create and activate client").
    expect(clients.template).toHaveBeenNthCalledWith(2, BRANCH_OFFICE_ID, true);
    expect(optionLabels(selectById('officeId'))).toEqual(BRANCH_OFFICE_NAMES);
    expect(
      optionLabels(selectById('staffId')).filter((label) => BRANCH_STAFF_NAMES.includes(label)),
    ).toEqual(BRANCH_STAFF_NAMES);
    expect(component.form.controls.staffId.value).toBeNull();
    expect(component.form.controls.officeId.value).toBe(BRANCH_OFFICE_ID);
    component.form.controls.officeId.setValue(BRANCH_OFFICE_ID);
    await settle();
    expect(clients.template).toHaveBeenCalledTimes(2);
  });
  it('keeps the operator’s active choice and activation date across an office change', async () => {
    const chosen = new Date(2026, 11, 1);
    fillActiveForm();
    component.form.controls.activationDate.setValue(chosen);
    component.form.controls.staffId.setValue(PARITY_OFFICER_ID);
    clients.template.mockReturnValueOnce(of(BRANCH_TEMPLATE));
    component.form.controls.officeId.setValue(BRANCH_OFFICE_ID);
    await settle();
    // An office change re-reads the template for the option lists alone, the way the legacy controller's `changeOffice` does.
    expect(component.form.controls.activationDate.value).toEqual(chosen);
    expect(component.form.controls.active.value).toBe(true);
    expect(component.form.controls.officeId.value).toBe(BRANCH_OFFICE_ID);
    expect(component.form.controls.staffId.value).toBeNull();
    expect(host().querySelector('#activationDate')).not.toBeNull();
  });
  it('renders the legacy captions through the translation stack, never a raw key', () => {
    const rendered = host().textContent ?? '';
    // The page's own heading is an `h1`, set through `PanelCard.titleTag`.
    expect(host().querySelector('h1.panel-title')).not.toBeNull();
    // No caption reached the user as the dotted key a bundle holds it under.
    expect(rendered).not.toContain('label.');
    expect(rendered).not.toContain('validation.');
    // Every control the workflow fills carries the id the legacy form gives it, so the parity harness addresses the same field on both applications.
    for (const id of [
      'officeId',
      'staffId',
      'firstname',
      'lastname',
      'mobileNo',
      'externalId',
      'submittedon',
      'activeCheckbox',
    ]) { expect(host().querySelector(`#${id}`), id).not.toBeNull(); }
  });
  it('sends nothing and marks the field when a required value is missing', async () => {
    fillValidForm();
    component.form.controls.firstname.setValue('');
    await component.submit();
    fixture.detectChanges();
    expect(clients.create).not.toHaveBeenCalled();
    expect(component.form.controls.firstname.touched).toBe(true);
    expect(component.form.controls.firstname.hasError('required')).toBe(true);
    // The field reports the state and the message the legacy form reports for it.
    expect(host().querySelector('#firstname')?.getAttribute('aria-invalid')).toBe('true');
    expect(host().querySelector('#firstname-error')).not.toBeNull();
    expect(host().querySelector('#firstname')?.closest('.form-group')?.classList.contains('has-error'),).toBe(true);
    expect(router.navigate).not.toHaveBeenCalled();
  });
  // The legacy create form marks a name that does not start with a letter pattern-invalid.
  it.each(['2Parity', '-Parity', '.Parity'])(
    'applies the legacy name rule to "%s" and sends nothing',
    async (name: string) => {
      fillValidForm();
      component.form.controls.firstname.setValue(name);
      await component.submit();
      fixture.detectChanges();
      expect(clients.create).not.toHaveBeenCalled();
      expect(component.form.controls.firstname.hasError('pattern')).toBe(true);
      expect(host().querySelector('#firstname')?.getAttribute('aria-invalid')).toBe('true');
      expect(host().querySelector('#firstname-pattern-error')).not.toBeNull();
      expect(host().querySelector('#firstname-error')).toBeNull();
    },
  );
  // The legacy mobile rule is `/^[0-9]+$/` with the bundle's `label.mustbenumeric`: a plus sign, a separator or a space fails it on screen, where the legacy form refused it.
  it.each(['+12025550101', '202-555-0101', '202 555 0101'])(
    'applies the legacy numeric rule to "%s" and sends nothing',
    async (mobileNo: string) => {
      fillValidForm();
      component.form.controls.mobileNo.setValue(mobileNo);
      await component.submit();
      fixture.detectChanges();
      expect(clients.create).not.toHaveBeenCalled();
      expect(component.form.controls.mobileNo.hasError('pattern')).toBe(true);
      expect(host().querySelector('#mobileNo')?.getAttribute('aria-invalid')).toBe('true');
      expect(host().querySelector('#mobileNo-pattern-error')).not.toBeNull();
    },
  );
  it('accepts the multi-word names and the numeric mobile number the legacy rules allow', async () => {
    fillValidForm();
    clients.create.mockReturnValue(of(CREATED));
    component.form.controls.firstname.setValue('Ada Okafor');
    component.form.controls.lastname.setValue("O'Kafo-Bennett");
    await component.submit();
    expect(component.form.controls.firstname.hasError('pattern')).toBe(false);
    expect(component.form.controls.lastname.hasError('pattern')).toBe(false);
    expect(component.form.controls.mobileNo.hasError('pattern')).toBe(false);
    expect(clients.create).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(['/viewclient', 42]);
  });
  it('posts the form values once and opens the record the server created', async () => {
    fillValidForm();
    clients.create.mockReturnValue(of(CREATED));
    await component.submit();
    expect(clients.create).toHaveBeenCalledTimes(1);
    const body: ClientCreateRequest = clients.create.mock.calls[0][0];
    expect(body.officeId).toBe(HEAD_OFFICE_ID);
    expect(typeof body.officeId).toBe('number');
    expect(body.staffId).toBe(PARITY_OFFICER_ID);
    expect(typeof body.staffId).toBe('number');
    expect(body.legalFormId).toBe(1);
    expect(body.firstname).toBe('Parity');
    expect(body.lastname).toBe('Client');
    expect(body.externalId).toBe('EXT-1');
    expect(body.mobileNo).toBe('2025550101');
    // The dates leave the screen as the `Date` its control holds; the service serialises them.
    expect(body.submittedOnDate).toBeInstanceOf(Date);
    // The service owns the two wire members that carry a payload date's grammar and language, so the screen sets neither (Rule 1 clause 2).
    expect(Object.keys(body)).not.toContain('dateFormat');
    expect(Object.keys(body)).not.toContain('locale');
    expect(router.navigate).toHaveBeenCalledWith(['/viewclient', 42]);
  });
  it('sends nothing for an office value that is no office id, and the form stays usable', async () => {
    fillValidForm();
    clients.create.mockReturnValue(of(CREATED));
    // A control holding text satisfies `required` but names no office.
    component.form.controls.officeId.setValue('1');
    expect(component.form.controls.officeId.valid).toBe(true);
    await component.submit();
    expect(clients.create).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(component.form.controls.officeId.touched).toBe(true);
    component.form.controls.officeId.setValue(HEAD_OFFICE_ID);
    await component.submit();
    expect(clients.create).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(['/viewclient', 42]);
  });
  it('opens the record a response reports by resource id alone', async () => {
    fillValidForm();
    clients.create.mockReturnValue(of(RESOURCE_ID_ONLY));
    await component.submit();
    expect(clients.create).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(['/viewclient', 99]);
  });
  it('sends the activation date for a client created active, and none for one created inactive', async () => {
    fillActiveForm();
    clients.create.mockReturnValue(of(CREATED));
    await component.submit();
    const active: ClientCreateRequest = clients.create.mock.calls[0][0];
    expect(active.active).toBe(true);
    expect(active.activationDate).toBeInstanceOf(Date);
    // The same form with the box cleared sends no activation date at all: Fineract rejects the pair "inactive with an activation date", and the service drops an undefined member from the body.
    clients.create.mockClear();
    component.form.controls.active.setValue(false);
    await component.submit();
    const inactive: ClientCreateRequest = clients.create.mock.calls[0][0];
    expect(inactive.active).toBe(false);
    expect(inactive.activationDate).toBeUndefined();
  });
  it('posts an optional field the operator left empty exactly as the control holds it', async () => {
    fillValidForm();
    clients.create.mockReturnValue(of(CREATED));
    component.form.controls.externalId.setValue('');
    component.form.controls.mobileNo.setValue('');
    await component.submit();
    const body: ClientCreateRequest = clients.create.mock.calls[0][0];
    expect(body.externalId).toBe('');
    expect(body.mobileNo).toBe('');
    expect(router.navigate).toHaveBeenCalledWith(['/viewclient', 42]);
  });
  it('leaves the officer out of a client whose officer the operator did not choose', async () => {
    fillValidForm();
    clients.create.mockReturnValue(of(CREATED));
    // The legacy form's staff field is optional and Fineract assigns no officer to a client whose officer was left unset, so the body carries no staff member at all.
    component.form.controls.staffId.setValue(null);
    await component.submit();
    const body: ClientCreateRequest = clients.create.mock.calls[0][0];
    expect(body.staffId).toBeUndefined();
    expect(body.officeId).toBe(HEAD_OFFICE_ID);
    expect(router.navigate).toHaveBeenCalledWith(['/viewclient', 42]);
  });
  it('sends one request per click and disables the submit control while it is in flight', async () => {
    const inFlight = new Subject<ClientMutationResponse>();
    clients.create.mockReturnValue(inFlight.asObservable());
    fillValidForm();
    const firstClick = component.submit();
    expect(component.guard.busy()).toBe(true);
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(true);
    // The second click is refused rather than queued, because `POST /clients` is not idempotent.
    const secondClick = component.submit();
    expect(clients.create).toHaveBeenCalledTimes(1);
    expect(router.navigate).not.toHaveBeenCalled();
    inFlight.next(CREATED);
    inFlight.complete();
    await Promise.all([firstClick, secondClick]);
    fixture.detectChanges();
    expect(component.guard.busy()).toBe(false);
    expect(submitButton().disabled).toBe(false);
    expect(clients.create).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(['/viewclient', 42]);
  });
  it("renders Fineract's rejection verbatim and keeps every entered value", async () => {
    clients.create.mockReturnValue(
      throwError(() =>
        toApiError(
          new HttpErrorResponse({
            status: 400,
            statusText: 'Bad Request',
            error: { defaultUserMessage: REJECTED_MESSAGE, errors: [{ defaultUserMessage: REJECTED_MESSAGE }], },
          }),
        ),
      ),
    );
    fillValidForm();
    await component.submit();
    fixture.detectChanges();
    expect(component.error()).toBe(REJECTED_MESSAGE);
    const alerts = host().querySelectorAll('.alert.alert-danger');
    expect(alerts).toHaveLength(1);
    // The message reaches the user unmodified — no prefix, suffix, trim or translation — because workflow W7 compares it character for character with the server's own text.
    expect(alerts[0].textContent?.trim()).toBe(REJECTED_MESSAGE);
    expect(component.form.getRawValue()).toMatchObject({
      officeId: HEAD_OFFICE_ID,
      staffId: PARITY_OFFICER_ID,
      firstname: 'Parity',
      lastname: 'Client',
      externalId: 'EXT-1',
      mobileNo: '2025550101',
    });
    expect(router.navigate).not.toHaveBeenCalled();
  });
  it('retires the rejected message on the operator’s next edit and keeps the rest of the form', async () => {
    clients.create.mockReturnValue(
      throwError(() =>
        toApiError(
          new HttpErrorResponse({
            status: 400,
            statusText: 'Bad Request',
            error: { defaultUserMessage: REJECTED_MESSAGE, errors: [{ defaultUserMessage: REJECTED_MESSAGE }], },
          }),
        ),
      ),
    );
    fillValidForm();
    await component.submit();
    fixture.detectChanges();
    expect(host().querySelectorAll('.alert.alert-danger')).toHaveLength(1);
    component.form.controls.lastname.setValue('Corrected');
    fixture.detectChanges();
    expect(component.error()).toBeNull();
    expect(host().querySelector('.alert.alert-danger')).toBeNull();
    expect(component.form.getRawValue()).toMatchObject({
      officeId: HEAD_OFFICE_ID,
      staffId: PARITY_OFFICER_ID,
      firstname: 'Parity',
      lastname: 'Corrected',
      externalId: 'EXT-1',
      mobileNo: '2025550101',
    });
    expect(clients.create).toHaveBeenCalledTimes(1);
    expect(router.navigate).not.toHaveBeenCalled();
  });
  it('leaves a 5xx to the interceptor’s notification and keeps the entered values', async () => {
    clients.create.mockReturnValue(throwError(() => new ApiError(SERVER_FAILURE_MESSAGE, 500)));
    fillValidForm();
    await component.submit();
    fixture.detectChanges();
    // Above 499 the interceptor's notification is that failure's only report, so the screen paints nothing of its own (AAP 0.7.4) and still holds every value the operator entered.
    expect(component.error()).toBeNull();
    expect(host().querySelector('.alert.alert-danger')).toBeNull();
    expect(component.form.controls.firstname.value).toBe('Parity');
    expect(component.form.controls.officeId.value).toBe(HEAD_OFFICE_ID);
    expect(router.navigate).not.toHaveBeenCalled();
  });
  it('paints no message when the create cannot be sent at all', async () => {
    clients.create.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') })),
    );
    fillValidForm();
    await component.submit();
    fixture.detectChanges();
    expect(component.error()).toBeNull();
    expect(host().querySelector('.alert.alert-danger')).toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
  });
  it('reports the rejection a refused navigation produced after a successful create', async () => {
    clients.create.mockReturnValue(of(CREATED));
    router.navigate.mockImplementationOnce(() =>
      Promise.reject(new Error(NAVIGATION_FAILURE_MESSAGE)),
    );
    fillValidForm();
    await component.submit();
    fixture.detectChanges();
    // The record was created, so the create was not repeated; the refusal is no HTTP answer, so the screen publishes its own message rather than swallowing it (AAP 0.14.2).
    expect(clients.create).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(['/viewclient', 42]);
    expect(component.error()).toBe(NAVIGATION_FAILURE_MESSAGE);
    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(NAVIGATION_FAILURE_MESSAGE,);
  });
  it('returns to the list on cancel without creating anything', () => {
    // Cancel navigates rather than acts, so it is the anchor every cancel control in the application is, which is also the element type this form's own legacy original renders (Rule 1 clause 3).
    const cancel = host().querySelector<HTMLElement>('#cancel2');

    expect(cancel).not.toBeNull();
    expect(cancel?.tagName).toBe('A');
    expect(cancel?.classList.contains('btn')).toBe(true);
    expect(cancel?.classList.contains('btn-default')).toBe(true);
    // Its navigation target is the clients list, resolved by `RouterLink` and rendered as the anchor's own `href`, so the control says where it goes before it is used.
    expect(cancel?.getAttribute('href')).toBe('/clients');

    cancel?.click();

    expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    expect(router.navigateByUrl.mock.calls[0]?.[0]?.toString()).toBe('/clients');
    expect(router.navigate).not.toHaveBeenCalled();
    expect(clients.create).not.toHaveBeenCalled();
  });
  it('reports a failed template read and leaves the form usable', async () => {
    clients.template.mockReset();
    clients.template.mockReturnValue(
      throwError(() =>
        toApiError(
          new HttpErrorResponse({
            status: 400,
            statusText: 'Bad Request',
            error: { defaultUserMessage: TEMPLATE_FAILURE_MESSAGE },
          }),
        ),
      ),
    );
    await open();
    expect(clients.template).toHaveBeenCalledTimes(1);
    expect(component.error()).toBe(TEMPLATE_FAILURE_MESSAGE);
    expect(host().querySelectorAll('.alert.alert-danger')).toHaveLength(1);
    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(TEMPLATE_FAILURE_MESSAGE,);
    expect(selects()).toHaveLength(2);
    expect(host().querySelector('#firstname')).not.toBeNull();
    expect(submitButton().disabled).toBe(false);
    expect(host().querySelector('app-notification')).toBeNull();
    expect(clients.create).not.toHaveBeenCalled();
  });
});
