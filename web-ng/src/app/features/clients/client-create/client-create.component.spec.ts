import { formatDate } from '@angular/common';
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
import { Router } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { catchError, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { DEFAULT_APP_CONFIG } from '../../../core/config/app-config.model';
import { AppConfigService } from '../../../core/config/app-config.service';
import { toApiError } from '../../../core/http/api-error';
import { DISPLAY_DATE_FORMAT } from '../../../shared/date-format.util';
import type { ClientTemplate } from '../client.models';
import { ClientCreateComponent } from './client-create.component';

/**
 * Behaviour of the create-client screen — the first half of workflow W2, whose second half is the
 * activation an operator runs from the created record's action group (AAP 0.7.1 Features row
 * `clients`; AAP 0.7.3 row "W2 create and activate client"; AAP 0.7.4 screens; Rule 1 clause 8, "the
 * behaviour you implement must be observable from the spec").
 *
 * What the suite drives is the component's public surface and the traffic it produces: the form's
 * own controls, the two signals the template reads, and the requests the real `ClientService` sends
 * through `HttpTestingController`. Nothing is asserted about styles, and nothing is mocked that the
 * screen actually depends on — the service, the shared field components and the translation pipe are
 * the shipped ones (Rule 1 clause 6 keeps the last two style-free and markup-free respectively).
 *
 * The three collaborations the screen cannot run without are supplied the way the application
 * supplies them: the resolved configuration is loaded from a stubbed `fetch` before the component
 * exists (every service URL is composed from it), the ngx-translate stack is registered and filled
 * with the legacy captions, and the router is a spy because what this screen owes the router is one
 * navigation per outcome.
 *
 * The error mapping is the one production piece the TestBed supplies itself: `core/http` owns the
 * mapping of a Fineract failure to `ApiError`, and the case that proves the message reaches the user
 * verbatim installs `toApiError` as an interceptor so the rejection the component catches is the type
 * it catches in the application (AAP 0.4.2; AAP 0.7.2 row `FineractError`; workflow W7).
 */

/**
 * The configuration the stubbed transport serves: the application's own documented default shape
 * (`DEFAULT_APP_CONFIG`), so the spec resolves the same eight keys the served file carries instead of
 * restating them and drifting from the one declaration that owns them (AAP 0.4.4 decision 5).
 */
const SERVED_CONFIG = DEFAULT_APP_CONFIG;

/** The API root every client URL is composed from, built from the resolved configuration. */
const API_ROOT = `${SERVED_CONFIG.apiBaseUrl}${SERVED_CONFIG.apiPath}`;

/** `GET /clients/template` — the read that seeds the form. */
const TEMPLATE_PATH = '/clients/template';

/** `POST /clients` — the one write this screen makes. */
const CLIENTS_PATH = '/clients';

/**
 * The legacy captions the bundle carries for this screen, keyed exactly as the shipped flat
 * translation bundles key them (`app/global-translations/`). A key that did not resolve would render
 * humanised through the missing-translation handler, so serving the real bundle is what proves the
 * labels and the required message resolve.
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
  'label.button.save': 'Submit',
  'label.button.cancel': 'Cancel',
};

/**
 * The template the head office answers with: two offices, one loan officer, and an activation default
 * as the fork sends it — a `[year, month, day]` triple — with the client not yet active.
 */
const HEAD_OFFICE_TEMPLATE: ClientTemplate = {
  officeId: 1,
  officeOptions: [
    { id: 1, name: 'Head Office' },
    { id: 2, name: 'Branch Two' },
  ],
  staffOptions: [{ id: 7, displayName: 'Officer, Parity' }],
  activationDate: [2026, 11, 24],
  active: false,
};

/** What the same endpoint answers for the second office: only that office's staff. */
const BRANCH_TEMPLATE: ClientTemplate = {
  officeId: 2,
  officeOptions: [
    { id: 1, name: 'Head Office' },
    { id: 2, name: 'Branch Two' },
  ],
  staffOptions: [{ id: 9, displayName: 'Officer, Branch' }],
  activationDate: [2026, 11, 24],
  active: false,
};

/** The message a rejected create answers with, quoted from a real Fineract validation failure. */
const REJECTED_MESSAGE = 'The client name is already in use by another client.';

/** Local midnight of today, the default the submission date starts from. */
function startOfToday(): Date {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Today's date as a payload carries it: the one display pattern, in the active language. */
const TODAY_AS_PAYLOAD = formatDate(startOfToday(), DISPLAY_DATE_FORMAT, 'en');

/**
 * The one production collaboration the TestBed supplies itself: `core/http` owns the mapping of a
 * Fineract failure to `ApiError`, and installing `toApiError` here means the rejection the component
 * catches is the type it catches in the application, so the message the user reads can be asserted
 * character for character (AAP 0.4.2; AAP 0.7.2 row `FineractError`; workflow W7).
 */
const MAP_FINERACT_FAILURES: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((failure: HttpErrorResponse) => throwError(() => toApiError(failure))),
  );

/** Matches `GET /clients/template`, whatever query the screen sent with it. */
function isTemplateRead(request: { readonly url: string }): boolean {
  return request.url === `${API_ROOT}${TEMPLATE_PATH}`;
}

describe('ClientCreateComponent', () => {
  let fixture: ComponentFixture<ClientCreateComponent>;
  let component: ClientCreateComponent;
  let httpMock: HttpTestingController;
  let navigate: Mock<(commands: readonly unknown[]) => Promise<boolean>>;
  let initialTemplateRead: TestRequest;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines the
  // cast to one line and keeps the DOM assertions type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The `<select>` a visible label names, so a field is addressed the way an operator reads it. */
  function selectFor(label: string): HTMLSelectElement {
    const element = host().querySelector<HTMLSelectElement>(`label[for="${label}"] ~ app-select-field select`);

    if (element === null) {
      throw new Error(`the screen rendered no select for the "${label}" field`);
    }

    return element;
  }

  /** The option labels of one select, in render order. */
  function optionLabels(select: HTMLSelectElement): string[] {
    return Array.from(select.options).map((option) => option.textContent?.trim() ?? '');
  }

  /**
   * Fills every control a create the server would accept needs, with the fixed parity values the
   * workflows use. A case that wants one control different sets it afterwards, so each case shows the
   * single thing it changes.
   */
  function fillValidForm(): void {
    component.form.patchValue({
      officeId: 1,
      staffId: 7,
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

    TestBed.configureTestingModule({
      imports: [ClientCreateComponent],
      providers: [
        provideHttpClient(withInterceptors([MAP_FINERACT_FAILURES])),
        provideHttpClientTesting(),
        provideTranslateService(),
        { provide: Router, useValue: { navigate } },
      ],
    });

    await TestBed.inject(AppConfigService).load();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', TRANSLATIONS, true);
    translate.use('en');

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ClientCreateComponent);
    component = fixture.componentInstance;

    // The constructor reads the template once, before the first render: that single read is what the
    // whole screen is seeded from, so it is answered here rather than in each case.
    const pending = httpMock.match(isTemplateRead);
    expect(pending).toHaveLength(1);
    initialTemplateRead = pending[0];
    initialTemplateRead.flush(HEAD_OFFICE_TEMPLATE);

    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  it('reads the template once, with no parameter, and seeds the pickers and the defaults from it', () => {
    expect(initialTemplateRead.request.method).toBe('GET');
    // The first read asks for the template as a whole, so the server's own default office is what the
    // form starts on (AAP 0.7.3 row "W2 create and activate client").
    expect(initialTemplateRead.request.params.keys()).toEqual([]);

    // A second read would mean the seeded office re-entered the office subscription.
    httpMock.expectNone(isTemplateRead);

    expect(component.form.controls.officeId.value).toBe(1);
    expect(optionLabels(selectFor('officeId'))).toEqual(['Head Office', 'Branch Two']);
    // `staffOptions` entries carry `displayName`, so a field that bound `name` would render blank.
    expect(optionLabels(selectFor('staffId'))).toEqual(['--Select Staff--', 'Officer, Parity']);
    // The submission date keeps the browser clock's default: the template carries no submission date.
    expect(component.form.controls.submittedOnDate.value).toEqual(startOfToday());
    expect(component.form.controls.active.value).toBe(false);
  });

  it('renders the legacy captions through the translation stack, never a raw key', () => {
    const rendered = host().textContent ?? '';

    expect(host().querySelector('h3.panel-title')?.textContent?.trim()).toBe('Create Client');
    expect(rendered).not.toContain('label.');
    expect(rendered).not.toContain('.');
    // Every control the workflow fills carries the id the legacy form gives it, so the parity harness
    // addresses the same field on both applications.
    for (const id of ['officeId', 'staffId', 'firstname', 'lastname', 'mobileNo', 'externalId', 'submittedon', 'activeCheckbox']) {
      expect(host().querySelector(`#${id}`), id).not.toBeNull();
    }
  });

  it('reads the template again for a newly chosen office, once, and clears the staff choice', async () => {
    component.form.controls.staffId.setValue(7);
    component.form.controls.officeId.setValue(2);

    const pending = httpMock.match(isTemplateRead);
    expect(pending).toHaveLength(1);
    // The office travels with the staff narrowing, which is the call the legacy form makes on the
    // same event.
    expect(pending[0].request.params.get('officeId')).toBe('2');
    expect(pending[0].request.params.get('staffInSelectedOfficeOnly')).toBe('true');

    pending[0].flush(BRANCH_TEMPLATE);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.form.controls.officeId.value).toBe(2);
    expect(component.form.controls.staffId.value).toBeNull();
    expect(optionLabels(selectFor('staffId'))).toEqual(['--Select Staff--', 'Officer, Branch']);
    // Applying the answer must not re-enter the office subscription.
    httpMock.expectNone(isTemplateRead);
  });

  it('posts exactly one client and opens the record the server created', async () => {
    fillActiveForm();

    const submission = component.submit();
    const post = httpMock.expectOne({ method: 'POST', url: `${API_ROOT}${CLIENTS_PATH}` });

    expect(post.request.body).toMatchObject({
      officeId: 1,
      staffId: 7,
      legalFormId: 1,
      firstname: 'Parity',
      lastname: 'Client',
      externalId: 'EXT-1',
      mobileNo: '2025550101',
      active: true,
    });
    // The dates leave the screen in the one pattern the application formats in, in the active
    // language: the service converts them at the API boundary, never the form.
    expect(post.request.body).toMatchObject({
      submittedOnDate: TODAY_AS_PAYLOAD,
      activationDate: TODAY_AS_PAYLOAD,
    });
    // The language the payload's dates are written in travels with the body; asserting the
    // serialised form keeps this free of a cast over a value the screen never types.
    expect(JSON.stringify(post.request.body)).toContain('"en"');

    post.flush({ resourceId: 42, clientId: 43 });
    await submission;
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/viewclient', 43]);
  });

  it('leaves the activation date out of a client created inactive', async () => {
    fillValidForm();

    const submission = component.submit();
    const post = httpMock.expectOne({ method: 'POST', url: `${API_ROOT}${CLIENTS_PATH}` });

    expect(post.request.body).toMatchObject({ active: false });
    expect(post.request.body).not.toHaveProperty('activationDate');

    post.flush({ resourceId: 42 });
    await submission;

    // A response that names no client id still opens the record the command reported.
    expect(navigate).toHaveBeenCalledWith(['/viewclient', 42]);
  });

  it('posts an optional field the operator left empty exactly as the control holds it', async () => {
    fillValidForm();
    component.form.controls.externalId.setValue('');
    component.form.controls.mobileNo.setValue('');

    const submission = component.submit();
    const post = httpMock.expectOne({ method: 'POST', url: `${API_ROOT}${CLIENTS_PATH}` });

    // Nothing is trimmed, dropped or defaulted: the screen hands the server what the operator left,
    // and the server treats a blank optional string as absent (verified against the fork).
    expect(post.request.body).toMatchObject({ externalId: '', mobileNo: '' });

    post.flush({ resourceId: 42 });
    await submission;

    expect(navigate).toHaveBeenCalledWith(['/viewclient', 42]);
  });

  it('sends nothing while a required field is missing, and marks the field', async () => {
    fillValidForm();
    component.form.controls.lastname.setValue('');

    await component.submit();

    httpMock.expectNone({ method: 'POST', url: `${API_ROOT}${CLIENTS_PATH}` });
    fixture.detectChanges();

    const lastname = host().querySelector('#lastname');
    expect(lastname?.getAttribute('aria-invalid')).toBe('true');
    expect(host().textContent).toContain('Required field');
  });

  it('refuses a second submit while the first is still in flight', async () => {
    fillValidForm();

    const first = component.submit();
    const second = component.submit();

    const post = httpMock.expectOne({ method: 'POST', url: `${API_ROOT}${CLIENTS_PATH}` });
    post.flush({ resourceId: 42, clientId: 43 });

    await Promise.all([first, second]);

    expect(httpMock.match({ method: 'POST', url: `${API_ROOT}${CLIENTS_PATH}` })).toHaveLength(0);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('shows the server’s message verbatim and keeps every entered value', async () => {
    fillValidForm();

    const submission = component.submit();
    httpMock
      .expectOne({ method: 'POST', url: `${API_ROOT}${CLIENTS_PATH}` })
      .flush({ defaultUserMessage: REJECTED_MESSAGE }, { status: 400, statusText: 'Bad Request' });

    await submission;
    await fixture.whenStable();
    fixture.detectChanges();

    const alert = host().querySelector('[role="alert"]');
    expect(alert?.textContent?.trim()).toBe(REJECTED_MESSAGE);
    // The screen stays mounted with what the operator typed, so the failure can be corrected in place.
    expect(component.form.getRawValue()).toMatchObject({
      officeId: 1,
      staffId: 7,
      firstname: 'Parity',
      lastname: 'Client',
      externalId: 'EXT-1',
      mobileNo: '2025550101',
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('returns to the list when the form is cancelled', () => {
    component.cancel();

    expect(navigate).toHaveBeenCalledWith(['/clients']);
  });
});
