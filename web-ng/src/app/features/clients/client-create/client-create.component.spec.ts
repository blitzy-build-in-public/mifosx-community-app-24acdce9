import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ApiError, toApiError } from '../../../core/http/api-error';
import type {
  ClientCreateRequest,
  ClientMutationResponse,
  ClientTemplate,
} from '../client.models';
import { ClientService } from '../client.service';
import { ClientCreateComponent } from './client-create.component';

/**
 * Behaviour of the create-client screen (`#/createclient`) — the first half of workflow W2, whose
 * second half is the activation an operator runs from the created record's action group (AAP 0.10.1
 * W2 row; AAP 0.7.1 `clients` row; AAP 0.7.4 screens; Rule 1 clause 8).
 *
 * What the suite proves is the screen's own behaviour: the one template read it takes and the one
 * re-read an office change costs, the options it renders in the server's order, the defaults it
 * seeds, the legacy validators it carries, the single `POST` one click sends, the record it opens
 * and the states it leaves behind when Fineract refuses. What it deliberately does not prove is the
 * endpoint contract — method, path, query parameters and the `dateFormat`/`locale` members of the
 * body — which belongs to `../client.service.spec.ts` and is asserted there with the transport the
 * application uses.
 *
 * `ClientService` is therefore stubbed at its own token: no transport, interceptor or HTTP client
 * takes part here, which is what Rule 1 clause 5 asks of a component. The stub is typed from the
 * shipped service — `vi.fn<ClientService['template']>()`, `vi.fn<ClientService['create']>()` — so a
 * change to the service's signature breaks this spec rather than passing silently (Rule 1 clause 4).
 *
 * The translation stack is the shipped one rather than a hand-written stub: the pinned
 * `TranslatePipe` resolves its keys through a signal-returning service method, and its plugin set
 * needs no transport (`provideTranslateService()` installs the no-op loader). No assertion below
 * depends on the wording a caption resolves to — a case proves that no raw dotted key reaches the
 * user, never how a caption is spelled, because the wording belongs to the legacy bundles under
 * `app/global-translations/` (Rule 1 clause 3).
 *
 * Dates stay `Date` instances throughout. The screen never formats one, and the posted-body cases
 * pin that it leaves `dateFormat` and `locale` to `ClientService.create`, which writes both at the
 * API boundary in the active language (AAP 0.7.2 "Date handling"; AAP 0.14.1).
 */

/**
 * The legacy captions this screen resolves, keyed exactly as the shipped flat bundles key them
 * (`app/global-translations/`). Registering them is what lets a case prove the labels resolve; their
 * wording is never asserted, so re-wording a bundle cannot redden this suite.
 */
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

/**
 * The template the head office answers with: two offices, one loan officer, and the activation
 * default the fork sends as a `[year, month, day]` triple, with the client not yet active.
 */
const HEAD_OFFICE_TEMPLATE: ClientTemplate = {
  officeId: HEAD_OFFICE_ID,
  officeOptions: [
    { id: HEAD_OFFICE_ID, name: 'Head Office' },
    { id: BRANCH_OFFICE_ID, name: 'Branch Two' },
  ],
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

/**
 * The text a 5xx answers with. The screen paints none of it: `core/http/fineract.interceptor.ts`
 * raises the single notification that carries it, so a second report here would show one failure
 * twice (AAP 0.7.4).
 */
const SERVER_FAILURE_MESSAGE = 'Internal server error, please contact your system administrator.';

/**
 * The message a refused navigation produces once the create itself succeeded. No notification
 * carries it — it is no HTTP answer — so the screen's own error region is the only place it can be
 * reported (AAP 0.14.2 "no catch swallows an error silently").
 */
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

/** `Router` as this screen uses it: one navigation command list per outcome. */
interface RouterStub {
  readonly navigate: Mock<(commands: readonly unknown[]) => Promise<boolean>>;
}

describe('ClientCreateComponent', () => {
  let fixture: ComponentFixture<ClientCreateComponent>;
  let component: ClientCreateComponent;
  let clients: ClientServiceStub;
  let router: RouterStub;

  /**
   * The rendered host, narrowed once. `ComponentFixture.nativeElement` is loosely typed by Angular,
   * so the narrowing is confined to this one line and every query below stays type-checked (Rule 1
   * clause 4).
   */
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

  /**
   * Lets the reads the screen queued resolve and the first paint show them: the constructor's
   * `firstValueFrom` resumes in a microtask, which the awaited turns below cross before the render.
   */
  async function settle(): Promise<void> {
    for (let turn = 0; turn < 3; turn += 1) {
      await Promise.resolve();
    }

    await fixture.whenStable();
    fixture.detectChanges();
  }

  /**
   * Configures the TestBed from scratch and opens the screen on it, answering nothing: the stubbed
   * template read is whatever the case set on the mock before calling this, so a case can open the
   * screen on a template that fails.
   *
   * The module is reset first because every open supplies the same providers, and a module left
   * instantiated by a previous fixture cannot take them again.
   */
  async function open(): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ClientCreateComponent],
      providers: [
        // The application runs zoneless (Angular 22's default), so the fixture is told the same and
        // every async case settles with `whenStable()` rather than with a zone (Rule 1 clause 5).
        provideZonelessChangeDetection(),
        { provide: ClientService, useValue: clients },
        { provide: Router, useValue: router },
        provideTranslateService(),
      ],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', TRANSLATIONS, true);
    translate.use('en');

    fixture = TestBed.createComponent(ClientCreateComponent);
    component = fixture.componentInstance;

    await settle();
  }

  /**
   * Fills every control a create the server would accept needs, with the fixed parity values the
   * workflows use. A case that wants one control different sets it afterwards, so each case shows
   * the single thing it changes.
   */
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
    clients = {
      template: vi.fn<ClientService['template']>(),
      create: vi.fn<ClientService['create']>(),
    };
    router = {
      navigate: vi.fn<(commands: readonly unknown[]) => Promise<boolean>>(() => Promise.resolve(true)),
    };
    clients.template.mockReturnValue(of(HEAD_OFFICE_TEMPLATE));

    await open();
  });

  it('reads the create template once, with no parameter, and seeds the pickers and the defaults', () => {
    expect(clients.template).toHaveBeenCalledTimes(1);
    // The first read asks for the template as a whole, so the server's own default office is what
    // the form starts on (AAP 0.7.3 row "W2 create and activate client").
    expect(clients.template.mock.calls[0]).toEqual([]);

    expect(selects()).toHaveLength(2);
    expect(optionLabels(selectById('officeId'))).toEqual(OFFICE_NAMES);

    const staffLabels = optionLabels(selectById('staffId'));
    // The leading row is the picker's own prompt; the officer follows it, labelled by the
    // `displayName` a `staffOptions` entry carries, which a field binding `name` would render blank.
    expect(staffLabels).toHaveLength(STAFF_NAMES.length + 1);
    expect(staffLabels.filter((label) => STAFF_NAMES.includes(label))).toEqual(STAFF_NAMES);

    expect(component.form.controls.officeId.value).toBe(HEAD_OFFICE_ID);
    expect(component.form.controls.staffId.value).toBeNull();
    // The submission date keeps the browser clock's default and is held as a `Date`, never as a
    // formatted string (AAP 0.10.5 item 15; AAP 0.7.2 "Date handling").
    expect(component.form.controls.submittedOnDate.value).toBeInstanceOf(Date);
    // The activation default is the template's own, read from its `[year, month, day]` triple.
    expect(component.form.controls.activationDate.value).toEqual(new Date(2026, 10, 24));
    expect(component.form.controls.active.value).toBe(false);

    // The two labels this template owns render as `.control-label` elements naming their control,
    // which is what gives each field the accessible name the design shows.
    expect(host().querySelector('label.control-label[for="officeId"]')).not.toBeNull();
    expect(host().querySelector('label.control-label[for="submittedon"]')).not.toBeNull();
  });

  it('re-reads the template once per office change, replacing the lists and clearing the officer', async () => {
    component.form.controls.staffId.setValue(PARITY_OFFICER_ID);

    // Re-selecting the office the form already holds is not a change, so it costs no request.
    component.form.controls.officeId.setValue(HEAD_OFFICE_ID);
    expect(clients.template).toHaveBeenCalledTimes(1);

    clients.template.mockReturnValueOnce(of(BRANCH_TEMPLATE));
    component.form.controls.officeId.setValue(BRANCH_OFFICE_ID);
    await settle();

    expect(clients.template).toHaveBeenCalledTimes(2);
    // The office travels with the staff narrowing, which is the call the legacy form makes on the
    // same event (AAP 0.7.3 row "W2 create and activate client").
    expect(clients.template).toHaveBeenNthCalledWith(2, BRANCH_OFFICE_ID, true);

    // The pickers carry the second office's lists, in the order its template sent them.
    expect(optionLabels(selectById('officeId'))).toEqual(BRANCH_OFFICE_NAMES);
    expect(
      optionLabels(selectById('staffId')).filter((label) => BRANCH_STAFF_NAMES.includes(label)),
    ).toEqual(BRANCH_STAFF_NAMES);
    // The officer chosen under the previous office is gone with the list that carried it.
    expect(component.form.controls.staffId.value).toBeNull();
    expect(component.form.controls.officeId.value).toBe(BRANCH_OFFICE_ID);

    // Re-selecting the new office is not a change either.
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

    // An office change re-reads the template for the option lists alone, the way the legacy
    // controller's `changeOffice` does, so the date and the active flag the operator chose survive
    // it while the office and the officer follow the new template.
    expect(component.form.controls.activationDate.value).toEqual(chosen);
    expect(component.form.controls.active.value).toBe(true);
    expect(component.form.controls.officeId.value).toBe(BRANCH_OFFICE_ID);
    expect(component.form.controls.staffId.value).toBeNull();
    // The field the active flag reveals is still on screen with the chosen date in it.
    expect(host().querySelector('#activationDate')).not.toBeNull();
  });

  it('renders the legacy captions through the translation stack, never a raw key', () => {
    const rendered = host().textContent ?? '';

    // The heading resolves through the bundle this screen registers…
    expect(host().querySelector('h3.panel-title')).not.toBeNull();
    // …and no caption reached the user as the dotted key a bundle holds it under.
    expect(rendered).not.toContain('label.');
    expect(rendered).not.toContain('validation.');

    // Every control the workflow fills carries the id the legacy form gives it, so the parity
    // harness addresses the same field on both applications.
    for (const id of [
      'officeId',
      'staffId',
      'firstname',
      'lastname',
      'mobileNo',
      'externalId',
      'submittedon',
      'activeCheckbox',
    ]) {
      expect(host().querySelector(`#${id}`), id).not.toBeNull();
    }
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
    expect(
      host().querySelector('#firstname')?.closest('.form-group')?.classList.contains('has-error'),
    ).toBe(true);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  // The legacy create form marks a name that does not start with a letter pattern-invalid and shows
  // the bundle's `validation.msg.client.name.cannot.start.specialchar.ornumber` (Rule 1 clause 3
  // carries the legacy rule rather than a new one). Each value below starts with a character the
  // legacy character class excludes.
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
      // A value that is present but malformed reports the rule it breaks, not the missing one.
      expect(host().querySelector('#firstname-error')).toBeNull();
    },
  );

  // The legacy mobile rule is `/^[0-9]+$/` with the bundle's `label.mustbenumeric`: a plus sign, a
  // separator or a space fails it on screen, where the legacy form refused it.
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
    // Legacy's expression is unanchored at the end, so only the first character is constrained: a
    // space, an apostrophe and a hyphen all stay inside a value it accepts.
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

    // Every value is handed over as the control holds it: the numeric ids stay numbers…
    expect(body.officeId).toBe(HEAD_OFFICE_ID);
    expect(typeof body.officeId).toBe('number');
    expect(body.staffId).toBe(PARITY_OFFICER_ID);
    expect(typeof body.staffId).toBe('number');
    // …the screen creates an individual client, the legal form whose name set this form fills…
    expect(body.legalFormId).toBe(1);
    expect(body.firstname).toBe('Parity');
    expect(body.lastname).toBe('Client');
    // …and no string is trimmed or defaulted.
    expect(body.externalId).toBe('EXT-1');
    expect(body.mobileNo).toBe('2025550101');

    // The dates leave the screen as the `Date` its control holds; the service serialises them.
    expect(body.submittedOnDate).toBeInstanceOf(Date);
    // The service owns the two wire members that carry a payload date's grammar and language, so
    // the screen sets neither (Rule 1 clause 2).
    expect(Object.keys(body)).not.toContain('dateFormat');
    expect(Object.keys(body)).not.toContain('locale');

    expect(router.navigate).toHaveBeenCalledWith(['/viewclient', 42]);
  });

  it('sends nothing for an office value that is no office id, and the form stays usable', async () => {
    fillValidForm();
    clients.create.mockReturnValue(of(CREATED));

    // A control holding text satisfies `required` but names no office, so the screen reports rather
    // than posting a coerced id: a body carrying `officeId: null` is one no legacy screen sends
    // (Rule 1 clause 2).
    component.form.controls.officeId.setValue('1');
    expect(component.form.controls.officeId.valid).toBe(true);

    await component.submit();

    expect(clients.create).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(component.form.controls.officeId.touched).toBe(true);

    // The refusal closed nothing off: the same form, on a real office, still creates the client.
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

    // The same form with the box cleared sends no activation date at all: Fineract rejects the pair
    // "inactive with an activation date", and the service drops an undefined member from the body.
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
    // Nothing is trimmed, dropped or defaulted: the screen hands the server what the operator left,
    // and the server treats a blank optional string as absent.
    expect(body.externalId).toBe('');
    expect(body.mobileNo).toBe('');
    expect(router.navigate).toHaveBeenCalledWith(['/viewclient', 42]);
  });

  it('leaves the officer out of a client whose officer the operator did not choose', async () => {
    fillValidForm();
    clients.create.mockReturnValue(of(CREATED));
    // The legacy form's staff field is optional and Fineract assigns no officer to a client whose
    // officer was left unset, so the body carries no staff member at all.
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
    // One click, one record: the refused click never navigated anywhere.
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
            error: {
              defaultUserMessage: REJECTED_MESSAGE,
              errors: [{ defaultUserMessage: REJECTED_MESSAGE }],
            },
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
    // The message reaches the user unmodified — no prefix, suffix, trim or translation — because
    // workflow W7 compares it character for character with the server's own text.
    expect(alerts[0].textContent?.trim()).toBe(REJECTED_MESSAGE);

    // The screen stays mounted with what the operator typed, so the failure can be corrected in place.
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

  it('leaves a 5xx to the interceptor’s notification and keeps the entered values', async () => {
    clients.create.mockReturnValue(throwError(() => new ApiError(SERVER_FAILURE_MESSAGE, 500)));
    fillValidForm();

    await component.submit();
    fixture.detectChanges();

    // Above 499 the interceptor's notification is that failure's only report, so the screen paints
    // nothing of its own (AAP 0.7.4) and still holds every value the operator entered.
    expect(component.error()).toBeNull();
    expect(host().querySelector('.alert.alert-danger')).toBeNull();
    expect(component.form.controls.firstname.value).toBe('Parity');
    expect(component.form.controls.officeId.value).toBe(HEAD_OFFICE_ID);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('paints no message when the create cannot be sent at all', async () => {
    // A transport failure arrives with status 0 and with Angular's own wording, which embeds the
    // failed request's address: the screen must render neither, and the interceptor's notification
    // is the one report it gets (AAP 0.7.4).
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

    // The record was created, so the create was not repeated; the refusal is no HTTP answer, so the
    // screen publishes its own message rather than swallowing it (AAP 0.14.2).
    expect(clients.create).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(['/viewclient', 42]);
    expect(component.error()).toBe(NAVIGATION_FAILURE_MESSAGE);
    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(
      NAVIGATION_FAILURE_MESSAGE,
    );
  });

  it('returns to the list on cancel without creating anything', () => {
    const cancel = host().querySelector<HTMLButtonElement>('#cancel2');
    expect(cancel).not.toBeNull();
    cancel?.click();

    expect(router.navigate).toHaveBeenCalledWith(['/clients']);
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
    // One message, painted once, above the form that is still there to be corrected.
    expect(host().querySelectorAll('.alert.alert-danger')).toHaveLength(1);
    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(
      TEMPLATE_FAILURE_MESSAGE,
    );
    expect(selects()).toHaveLength(2);
    expect(host().querySelector('#firstname')).not.toBeNull();
    expect(submitButton().disabled).toBe(false);

    // A failed read raises no notice of its own and creates nothing.
    expect(host().querySelector('app-notification')).toBeNull();
    expect(clients.create).not.toHaveBeenCalled();
  });
});
