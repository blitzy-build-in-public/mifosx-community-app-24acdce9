import { provideZonelessChangeDetection, signal, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService } from '@ngx-translate/core';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { PermissionsService } from '../../../core/auth/permissions.service';
import { ApiError } from '../../../core/http/api-error';
import { DISPLAY_DATE_FORMAT } from '../../../shared/date-format.util';
import type { ClientEditRequest, ClientMutationResponse, ClientTemplate } from '../client.models';
import { ClientService } from '../client.service';
import { ClientEditComponent } from './client-edit.component';

/** Behaviour of the edit-client screen — `#/editclient/:id`, the client half of AAP 0.7.3's "Client list and edit" row and the second of that row's two route targets (AAP 0.7.4 screens; AAP 0.8.2; Rule 1 clause 8, Rule 1 clause 5, AAP 0.7.2, AAP 0.14.1). */

/** The route that serves the edit screen, exactly as `clients.routes.ts` declares it. */
const ROUTES: Routes = [
  { path: 'editclient/:id', component: ClientEditComponent },
  { path: 'editclient', component: ClientEditComponent, pathMatch: 'full' },
];

/** The client the screen was opened on: the id `#/editclient/2` names. */
const CLIENT_ID = '2';

/** The edit read's payload: the template members `ClientTemplate` declares plus the client's own values the same response folds in, which is what legacy's `EditClientController` seeds its form from. */
const PAYLOAD = {
  officeId: 1,
  officeOptions: [
    { id: 1, name: 'Head Office' },
    { id: 2, name: 'Branch One' },
  ],
  staffOptions: [
    { id: 7, displayName: 'Officer, Parity' },
    { id: 9, displayName: 'Officer, Field' },
  ],
  staffId: 7,
  activationDate: [2026, 11, 21],
  active: true,
  firstname: 'Ada',
  lastname: 'Okafor',
  externalId: 'EXT-2',
  mobileNo: '2025550102',
} satisfies ClientTemplate & Record<string, unknown>;

/** The same read for a client no officer is assigned to: the staff list still arrives, and the record carries no `staffId`. */
const UNASSIGNED_PAYLOAD = {
  ...PAYLOAD,
  staffId: undefined,
} satisfies ClientTemplate & Record<string, unknown>;

/** The same read for an entity client: named by `fullname` alone, and pending rather than active. */
const ENTITY_PAYLOAD = {
  officeId: 1,
  officeOptions: [{ id: 1, name: 'Head Office' }],
  activationDate: [2026, 11, 24],
  active: false,
  fullname: 'Blitzy Bakery LLC',
  externalId: '',
  mobileNo: '',
} satisfies ClientTemplate & Record<string, unknown>;

/** The message Fineract answers a missing record with, matched character for character. */
const NOT_FOUND_MESSAGE = 'Client with id `2` does not exist.';

/** The record a second route emission addresses: the id `#/editclient/25` names, and the client the baseline data holds under client number 000000025. */
const SECOND_CLIENT_ID = '25';

const SECOND_PAYLOAD = {
  officeId: 2,
  officeOptions: [{ id: 2, name: 'Branch One' }],
  staffOptions: [{ id: 9, displayName: 'Officer, Field' }],
  activationDate: [2026, 11, 24],
  active: true,
  firstname: 'Marcus',
  lastname: 'Rowe-Bennett',
  externalId: 'EXT-25',
  mobileNo: '2025550125',
} satisfies ClientTemplate & Record<string, unknown>;

/** The message a rejected save answers with, quoted from the server's own wording. */
const REJECTED_MESSAGE = 'The client name is already in use by another client.';

/** The message a failed save answers with when the server itself broke, which the interceptor notifies rather than the form. */
const SERVER_FAILURE_MESSAGE = 'An unexpected error occurred on the server.';

/** The text a refused navigation carries, the only kind of rejection that reaches the screen without an HTTP status. */
const REFUSED_NAVIGATION_MESSAGE = 'Navigation was cancelled before the record could open.';

/** The response a successful save answers with. */
const SAVED: ClientMutationResponse = { resourceId: 2, clientId: 2 };

/** The captions this screen resolves, keyed exactly as the shipped flat legacy bundles key them (`app/global-translations/`). */
const TRANSLATIONS: Readonly<Record<string, string>> = {
  'label.heading.editclient': 'Edit Client',
  'label.heading.notavailable': 'Not Available',
  'label.heading.office': 'Office',
  'label.heading.staff': 'Staff',
  'label.menu.selectloanofficer': 'Select Staff',
  'error.msg.resource.not.found': 'The requested resource is not available.',
  'label.input.firstname': 'First name',
  'label.input.lastname': 'Last name',
  'label.input.fullname': 'Name',
  'label.input.mobilenumber': 'Mobile number',
  'label.input.externalid': 'External ID',
  'label.input.activationdate': 'Activation date',
  'label.requiredfield': 'Required field',
  'label.button.save': 'Submit',
  'label.button.cancel': 'Cancel',
};

/** `ClientService` as this screen uses it: the seed read and the save, both stubbed. */
interface ClientServiceStub {
  readonly getWithTemplate: Mock<(id: number | string) => Observable<ClientTemplate>>;
  readonly update: Mock<
    (id: number | string, body: ClientEditRequest) => Observable<ClientMutationResponse>
  >;
}

/** `PermissionsService` as the save control's gate asks it. */
interface PermissionsStub {
  has(key: string): boolean;
}

/** The ngx-translate surface this screen touches: the `translate()` signal `TranslatePipe` 18 resolves its keys through. */
interface TranslateStub {
  readonly currentLang: Signal<string>;
  translate(key: string): Signal<string>;
  readonly onLangChange: Observable<unknown>;
  readonly onTranslationChange: Observable<unknown>;
}

/** Builds the translation stub the TestBed provides. */
function translateStub(): TranslateStub {
  return {
    currentLang: signal('en').asReadonly(),
    translate: (key: string): Signal<string> => signal(TRANSLATIONS[key] ?? key),
    onLangChange: of(undefined),
    onTranslationChange: of(undefined),
  };
}

/** An observable the spec settles by hand, for the in-flight case: subscribing stores the completion, so a case can hold the save open, submit again, then answer it once. */
function deferredSave(): { readonly response: Observable<ClientMutationResponse>; complete(): void } {
  let settle: (() => void) | null = null;

  const response = new Observable<ClientMutationResponse>((subscriber) => {
    settle = (): void => {
      subscriber.next(SAVED);
      subscriber.complete();
    };
  });

  return {
    response,
    complete(): void {
      if (settle === null) {
        throw new Error('the screen never subscribed to the deferred save');
      }

      settle();
    },
  };
}

describe('ClientEditComponent', () => {
  let clients: ClientServiceStub;
  let navigate: Mock<(commands: readonly unknown[]) => Promise<boolean>>;

  /** Configures the TestBed for one case with the stubbed reads, then opens the screen at `url` through the real router. */
  async function render(url: string): Promise<RouterTestingHarness> {
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter(ROUTES),
        { provide: ClientService, useValue: clients },
        { provide: TranslateService, useValue: translateStub() },
        { provide: PermissionsService, useValue: { has: (): boolean => true } satisfies PermissionsStub },
      ],
    });

    navigate = vi.fn<(commands: readonly unknown[]) => Promise<boolean>>(() => Promise.resolve(true));
    vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(navigate);

    const harness = await RouterTestingHarness.create(url);

    await settle(harness);

    return harness;
  }

  /** Lets the queued reads and the form's own value changes settle, then paints, which is what one route emission produces once its answer has arrived. @param harness the harness serving the edit route. */
  async function settle(harness: RouterTestingHarness): Promise<void> {
    for (let turn = 0; turn < 5; turn += 1) {
      await Promise.resolve();
    }

    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  /** The rendered host of the routed component, narrowed once so every query below is typed. */
  function hostOf(harness: RouterTestingHarness): HTMLElement {
    const element: unknown = harness.routeDebugElement?.nativeElement;

    if (!(element instanceof HTMLElement)) {
      throw new Error('the edit route activated no component');
    }

    return element;
  }

  /** The routed component instance, narrowed once so the cases can drive its public surface. */
  function componentOf(harness: RouterTestingHarness): ClientEditComponent {
    const instance: unknown = harness.routeDebugElement?.componentInstance;

    if (!(instance instanceof ClientEditComponent)) {
      throw new Error('the edit route activated no ClientEditComponent');
    }

    return instance;
  }

  /** The host's text with runs of whitespace collapsed to one space and the ends trimmed. */
  function renderedText(host: HTMLElement): string {
    return (host.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /** The value of one rendered input, by the legacy form's own id. */
  function inputValue(host: HTMLElement, id: string): string | null {
    return host.querySelector<HTMLInputElement>(`#${id}`)?.value ?? null;
  }

  /** The labels one rendered `<select>` offers, in document order, by the legacy form's own id. */
  function selectOptions(host: HTMLElement, id: string): string[] {
    const select = host.querySelector<HTMLSelectElement>(`#${id}`);

    return [...(select?.options ?? [])].map((option) => option.textContent?.trim() ?? '');
  }

  /** The label the rendered `<select>` currently shows, or `null` when the control is absent. */
  function selectedOptionText(host: HTMLElement, id: string): string | null {
    const select = host.querySelector<HTMLSelectElement>(`#${id}`);

    return select === null ? null : (select.selectedOptions[0]?.textContent?.trim() ?? null);
  }

  beforeEach(() => {
    clients = {
      getWithTemplate: vi.fn<(id: number | string) => Observable<ClientTemplate>>(() => of(PAYLOAD)),
      update: vi.fn<
        (id: number | string, body: ClientEditRequest) => Observable<ClientMutationResponse>
      >(() => of(SAVED)),
    };
  });

  it('seeds the form from the record it read, once', async () => {
    const harness = await render(`/editclient/${CLIENT_ID}`);
    const host = hostOf(harness);
    const component = componentOf(harness);

    expect(clients.getWithTemplate).toHaveBeenCalledTimes(1);
    expect(clients.getWithTemplate).toHaveBeenCalledWith(CLIENT_ID);

    expect(inputValue(host, 'firstname')).toBe('Ada');
    expect(inputValue(host, 'lastname')).toBe('Okafor');
    expect(inputValue(host, 'externalId')).toBe('EXT-2');
    expect(inputValue(host, 'mobileNo')).toBe('2025550102');

    // The activation date is a `Date` at local midnight, parsed from the record's `FineractDate`.
    const activationDate = component.form.controls.activationDate.value;
    expect(activationDate).toBeInstanceOf(Date);
    expect(activationDate?.getFullYear()).toBe(2026);
    expect(activationDate?.getMonth()).toBe(10);
    expect(activationDate?.getDate()).toBe(21);

    expect(host.querySelector('.alert.alert-danger')).toBeNull();
    expect(component.error()).toBeNull();
  });

  it('issues exactly one update with the form’s values, then opens the record', async () => {
    const harness = await render(`/editclient/${CLIENT_ID}`);
    const host = hostOf(harness);
    const component = componentOf(harness);

    expect(inputValue(host, 'mobileNo')).toBe('2025550102');
    component.form.controls.lastname.setValue('Okafor-Rowe');
    component.form.controls.mobileNo.setValue('2025550199');

    await component.submit();

    expect(clients.update).toHaveBeenCalledTimes(1);

    const [id, body] = clients.update.mock.calls[0] ?? [];

    // The route's own spelling of `#/editclient/2`, which is what `route.paramMap` hands the screen.
    expect(id).toBe(CLIENT_ID);
    expect(body).toMatchObject({
      firstname: 'Ada',
      lastname: 'Okafor-Rowe',
      externalId: 'EXT-2',
      mobileNo: '2025550199',
    });
    expect(body?.activationDate).toBeInstanceOf(Date);

    // Exactly the members `ClientEditRequest` declares, and nothing the form does not post: the record's own office is on screen but never in the body, and no client id or account number appears (AAP 0.7.2, Rule 1 clause 2).
    expect(Object.keys(body ?? {}).sort()).toEqual([
      'activationDate',
      'dateFormat',
      'externalId',
      'firstname',
      'lastname',
      'locale',
      'mobileNo',
      'staffId',
    ]);
    expect(body?.staffId).toBe(7);
    // `client.service.spec.ts` pins the wire body this endpoint receives — 'dd MMMM yyyy' plus the active locale, in English and moved to French — so the pair asserted here is the one the screen hands `ClientService.update`.
    expect(body?.dateFormat).toBe(DISPLAY_DATE_FORMAT);
    expect(
      body?.locale,
      'Placeholder before serialisation, not the wire value: ClientService.update fills `locale` from ' +
        'the active language before the body reaches the wire',
    ).toBe('');

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/viewclient', CLIENT_ID]);
  });

  it('shows the record’s office from the template’s list, read-only, and never posts it', async () => {
    const harness = await render(`/editclient/${CLIENT_ID}`);
    const host = hostOf(harness);
    const component = componentOf(harness);

    const office = host.querySelector<HTMLSelectElement>('#officeId');

    // Legacy's own first control, disabled exactly as `app/views/clients/editclient.html` disables it.
    expect(office).not.toBeNull();
    expect(office?.disabled).toBe(true);
    expect(selectOptions(host, 'officeId')).toEqual(['Head Office', 'Branch One']);
    expect(selectedOptionText(host, 'officeId')).toBe('Head Office');
    expect(component.form.controls.officeId.value).toBe(1);

    await component.submit();

    // The update endpoint refuses an `officeId` and legacy never posts one, so the shown value stays off the wire.
    const body = clients.update.mock.calls[0]?.[1];

    expect(body).toBeDefined();
    expect(Object.keys(body ?? {})).not.toContain('officeId');
  });

  it('offers the template’s staff list in order, preselects the record’s officer, and posts the chosen one', async () => {
    const harness = await render(`/editclient/${CLIENT_ID}`);
    const host = hostOf(harness);
    const component = componentOf(harness);

    // The template's own order, each row labelled by its `displayName`, behind legacy's prompt row.
    expect(selectOptions(host, 'staffId')).toEqual([
      'Select Staff',
      'Officer, Parity',
      'Officer, Field',
    ]);
    expect(selectedOptionText(host, 'staffId')).toBe('Officer, Parity');
    expect(component.form.controls.staffId.value).toBe(7);

    component.form.controls.staffId.setValue(9);

    await component.submit();

    expect(clients.update.mock.calls[0]?.[1]?.staffId).toBe(9);
  });

  it('omits staffId while the prompt of a record with no officer is left untouched', async () => {
    clients.getWithTemplate.mockReturnValue(of(UNASSIGNED_PAYLOAD));

    const harness = await render(`/editclient/${CLIENT_ID}`);
    const host = hostOf(harness);
    const component = componentOf(harness);

    expect(selectedOptionText(host, 'staffId')).toBe('Select Staff');
    expect(component.form.controls.staffId.value).toBeNull();

    await component.submit();

    // Legacy's `formData` holds an `undefined` staffId here, which JSON drops: the body carries no member at all.
    const body = clients.update.mock.calls[0]?.[1];

    expect(body).toBeDefined();
    expect(Object.keys(body ?? {})).not.toContain('staffId');
  });

  it('posts a null staffId when the record’s officer is cleared back to the prompt', async () => {
    const harness = await render(`/editclient/${CLIENT_ID}`);
    const component = componentOf(harness);

    component.form.controls.staffId.setValue(null);

    await component.submit();

    // `null` is how the fork unassigns an officer, and it must survive rather than be dropped as absent.
    const body = clients.update.mock.calls[0]?.[1];

    expect(body).toBeDefined();
    expect(Object.keys(body ?? {})).toContain('staffId');
    expect(body?.staffId).toBeNull();
  });

  it('seeds an officer the narrowed staff list does not offer, and posts it back untouched', async () => {
    clients.getWithTemplate.mockReturnValue(of({ ...PAYLOAD, staffId: 11 }));

    const component = componentOf(await render(`/editclient/${CLIENT_ID}`));

    expect(component.form.controls.staffId.value).toBe(11);

    await component.submit();

    expect(clients.update.mock.calls[0]?.[1]?.staffId).toBe(11);
  });

  it('renders the entity name set for an entity client and posts only that one', async () => {
    clients.getWithTemplate.mockReturnValue(of(ENTITY_PAYLOAD));

    const harness = await render(`/editclient/${CLIENT_ID}`);
    const host = hostOf(harness);

    expect(inputValue(host, 'fullname')).toBe('Blitzy Bakery LLC');
    expect(host.querySelector('#firstname')).toBeNull();
    expect(host.querySelector('#lastname')).toBeNull();
    expect(host.querySelector('#activationDate')).toBeNull();

    await componentOf(harness).submit();

    const body = clients.update.mock.calls[0]?.[1];

    expect(body).toMatchObject({ fullname: 'Blitzy Bakery LLC' });
    expect(body).not.toHaveProperty('firstname');
    expect(body).not.toHaveProperty('lastname');
    expect(body).not.toHaveProperty('activationDate');
  });

  it('sends nothing for a person whose first name was cleared, and reports the missing value in place', async () => {
    const harness = await render(`/editclient/${CLIENT_ID}`);
    const host = hostOf(harness);
    const component = componentOf(harness);

    component.form.controls.firstname.setValue('');

    await component.submit();
    harness.detectChanges();

    // The legacy template marks this control required and nothing more, so the screen is what stops the request — and it stops it before a body is built (Rule 1 clause 3).
    expect(clients.update).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(component.form.controls.firstname.touched).toBe(true);

    expect(host.querySelector('.form-group.has-error #firstname')).not.toBeNull();
    expect(host.querySelector('#firstname-error')?.textContent?.trim()).toBe('Required field');
    expect(host.querySelector('.alert.alert-danger')).toBeNull();
  });

  it('sends nothing for an entity whose name was cleared', async () => {
    clients.getWithTemplate.mockReturnValue(of(ENTITY_PAYLOAD));

    const harness = await render(`/editclient/${CLIENT_ID}`);
    const host = hostOf(harness);
    const component = componentOf(harness);

    expect(inputValue(host, 'fullname')).toBe('Blitzy Bakery LLC');
    component.form.controls.fullname.setValue('');

    await component.submit();
    harness.detectChanges();

    expect(clients.update).not.toHaveBeenCalled();
    expect(component.form.controls.fullname.touched).toBe(true);
    expect(host.querySelector('#fullname-error')?.textContent?.trim()).toBe('Required field');
  });

  it('sends nothing for an active record whose activation date was cleared', async () => {
    const harness = await render(`/editclient/${CLIENT_ID}`);
    const host = hostOf(harness);
    const component = componentOf(harness);

    component.form.controls.activationDate.setValue(null);

    await component.submit();
    harness.detectChanges();

    expect(clients.update).not.toHaveBeenCalled();
    expect(component.form.controls.activationDate.touched).toBe(true);
    expect(host.querySelector('app-date-field .form-group.has-error')).not.toBeNull();
    expect(host.querySelector('app-date-field .help-block')?.textContent?.trim()).toBe('Required field');
  });

  it('sends one update when the save control is used twice while the first is in flight', async () => {
    const save = deferredSave();
    clients.update.mockReturnValue(save.response);

    const component = componentOf(await render(`/editclient/${CLIENT_ID}`));

    const first = component.submit();
    const second = component.submit();

    expect(component.guard.busy()).toBe(true);

    save.complete();
    await first;
    await second;

    expect(clients.update).toHaveBeenCalledTimes(1);
    expect(component.guard.busy()).toBe(false);
  });

  it('renders a rejected save’s message verbatim and keeps every entered value', async () => {
    clients.update.mockReturnValue(throwError(() => new ApiError(REJECTED_MESSAGE, 400)));

    const harness = await render(`/editclient/${CLIENT_ID}`);
    const host = hostOf(harness);
    const component = componentOf(harness);

    component.form.controls.lastname.setValue('Okafor-Rowe');
    component.form.controls.externalId.setValue('EXT-2-RETRY');

    await component.submit();
    harness.detectChanges();

    // One banner, carrying the server's text and nothing else: no prefix, no suffix, no retranslation (AAP 0.7.2 "Rendered verbatim"; Rule 1 clause 3, the message workflow W7 compares).
    const banners = host.querySelectorAll('.alert.alert-danger');

    expect(banners.length).toBe(1);
    expect(banners[0]?.textContent?.trim()).toBe(REJECTED_MESSAGE);
    expect(host.querySelector('app-notification')).toBeNull();

    // The form and the values just entered survive the failure, which is the state AAP 0.7.4 requires.
    expect(inputValue(host, 'firstname')).toBe('Ada');
    expect(inputValue(host, 'lastname')).toBe('Okafor-Rowe');
    expect(inputValue(host, 'externalId')).toBe('EXT-2-RETRY');
    expect(component.ready()).toBe(true);
    expect(clients.update).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves the failure region empty for a 500, which the interceptor has already notified', async () => {
    clients.update.mockReturnValue(throwError(() => new ApiError(SERVER_FAILURE_MESSAGE, 500)));

    const harness = await render(`/editclient/${CLIENT_ID}`);
    const host = hostOf(harness);
    const component = componentOf(harness);

    component.form.controls.mobileNo.setValue('2025550199');

    await component.submit();
    harness.detectChanges();

    // Exactly one report: `fineract.interceptor` raises the single notification for a 5xx, so the screen paints no second copy of the text (AAP 0.7.4; AAP 0.14.2).
    expect(component.error()).toBeNull();
    expect(host.querySelector('.alert.alert-danger')).toBeNull();
    expect(component.ready()).toBe(true);
    expect(inputValue(host, 'mobileNo')).toBe('2025550199');
    expect(clients.update).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reports a refused navigation rather than swallowing it', async () => {
    const harness = await render(`/editclient/${CLIENT_ID}`);
    const host = hostOf(harness);
    const component = componentOf(harness);

    navigate.mockImplementation(() =>
      Promise.reject(new Error(REFUSED_NAVIGATION_MESSAGE)),
    );

    await component.submit();
    harness.detectChanges();

    // No `catch` may swallow an error silently, so the refusal reaches the region above the form with its own text (AAP 0.14.1; AAP 0.14.2).
    expect(component.error()).toBe(REFUSED_NAVIGATION_MESSAGE);

    const banners = host.querySelectorAll('.alert.alert-danger');

    expect(banners.length).toBe(1);
    expect(banners[0]?.textContent?.trim()).toBe(REFUSED_NAVIGATION_MESSAGE);
    expect(clients.update).toHaveBeenCalledTimes(1);
    expect(inputValue(host, 'firstname')).toBe('Ada');
  });

  it('renders the not-found message and no form when Fineract answers 404', async () => {
    clients.getWithTemplate.mockReturnValue(throwError(() => new ApiError(NOT_FOUND_MESSAGE, 404)));

    const host = hostOf(await render(`/editclient/${CLIENT_ID}`));

    expect(renderedText(host)).toContain('Not Available');
    expect(renderedText(host)).toContain('The requested resource is not available.');
    expect(host.querySelector('form')).toBeNull();
  });

  it('sends no request and claims the not-found state for a route with no client id', async () => {
    const host = hostOf(await render('/editclient'));

    expect(clients.getWithTemplate).not.toHaveBeenCalled();
    expect(host.querySelector('form')).toBeNull();
    expect(renderedText(host)).toContain('Not Available');
  });

  it('re-reads the record for each route emission and edits the client the URL now names', async () => {
    clients.getWithTemplate.mockImplementation((id: number | string) =>
      of(id === SECOND_CLIENT_ID ? SECOND_PAYLOAD : PAYLOAD),
    );

    const harness = await render(`/editclient/${CLIENT_ID}`);
    const instance = componentOf(harness);

    expect(inputValue(hostOf(harness), 'firstname')).toBe('Ada');

    await harness.navigateByUrl(`/editclient/${SECOND_CLIENT_ID}`);
    await settle(harness);

    const host = hostOf(harness);

    expect(componentOf(harness)).toBe(instance);

    expect(clients.getWithTemplate).toHaveBeenCalledTimes(2);
    expect(clients.getWithTemplate).toHaveBeenNthCalledWith(1, CLIENT_ID);
    expect(clients.getWithTemplate).toHaveBeenNthCalledWith(2, SECOND_CLIENT_ID);

    expect(inputValue(host, 'firstname')).toBe('Marcus');
    expect(inputValue(host, 'lastname')).toBe('Rowe-Bennett');
    expect(inputValue(host, 'externalId')).toBe('EXT-25');
    expect(inputValue(host, 'mobileNo')).toBe('2025550125');
    expect(host.querySelector('#cancel')?.getAttribute('href')).toBe(
      `/viewclient/${SECOND_CLIENT_ID}`,
    );

    await componentOf(harness).submit();

    expect(clients.update).toHaveBeenCalledTimes(1);
    expect(clients.update.mock.calls[0]?.[0]).toBe(SECOND_CLIENT_ID);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/viewclient', SECOND_CLIENT_ID]);
  });

  it('ignores a superseded record that arrives after the URL moved on', async () => {
    const first = new Subject<ClientTemplate>();
    const second = new Subject<ClientTemplate>();

    clients.getWithTemplate.mockImplementation((id: number | string) =>
      id === SECOND_CLIENT_ID ? second.asObservable() : first.asObservable(),
    );

    const harness = await render(`/editclient/${CLIENT_ID}`);

    expect(hostOf(harness).querySelector('form')).toBeNull();

    await harness.navigateByUrl(`/editclient/${SECOND_CLIENT_ID}`);

    second.next(SECOND_PAYLOAD);
    second.complete();
    await settle(harness);

    expect(inputValue(hostOf(harness), 'firstname')).toBe('Marcus');

    first.next(PAYLOAD);
    first.complete();
    await settle(harness);

    const host = hostOf(harness);

    expect(componentOf(harness).clientId()).toBe(SECOND_CLIENT_ID);
    expect(inputValue(host, 'firstname')).toBe('Marcus');
    expect(inputValue(host, 'lastname')).toBe('Rowe-Bennett');
    expect(inputValue(host, 'externalId')).toBe('EXT-25');
    expect(host.querySelector('#cancel')?.getAttribute('href')).toBe(
      `/viewclient/${SECOND_CLIENT_ID}`,
    );
    expect(componentOf(harness).notFound()).toBe(false);
    expect(componentOf(harness).error()).toBeNull();
  });

  it('clears the previous client’s not-found state when the URL moves to a record that exists', async () => {
    clients.getWithTemplate.mockImplementation((id: number | string) =>
      id === SECOND_CLIENT_ID
        ? of(SECOND_PAYLOAD)
        : throwError(() => new ApiError(NOT_FOUND_MESSAGE, 404)),
    );

    const harness = await render(`/editclient/${CLIENT_ID}`);

    expect(renderedText(hostOf(harness))).toContain('Not Available');
    expect(hostOf(harness).querySelector('form')).toBeNull();

    await harness.navigateByUrl(`/editclient/${SECOND_CLIENT_ID}`);
    await settle(harness);

    const moved = hostOf(harness);

    expect(renderedText(moved)).not.toContain('Not Available');
    expect(inputValue(moved, 'firstname')).toBe('Marcus');
  });

  it('cancels the outstanding seed read when the screen is destroyed', async () => {
    const pending = new Subject<ClientTemplate>();

    clients.getWithTemplate.mockReturnValue(pending.asObservable());

    const harness = await render(`/editclient/${CLIENT_ID}`);

    expect(pending.observed).toBe(true);

    harness.fixture.destroy();

    expect(pending.observed).toBe(false);
  });
});
