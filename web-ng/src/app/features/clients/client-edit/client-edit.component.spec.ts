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

/**
 * Behaviour of the edit-client screen — `#/editclient/:id`, the client half of AAP 0.7.3's "Client
 * list and edit" row and one of the two route targets the clients feature previously lacked
 * (AAP 0.7.4 screens; AAP 0.8.2 feature route `editclient/:id`; Rule 1 clause 8, "tests prove
 * behaviour").
 *
 * What the suite drives is the screen's public surface and the traffic it produces: the one seed read
 * and the one save, the form the seed fills, the name set the record's shape selects, the body the
 * save posts, the controls the record marks required — which block the request and report the missing
 * value in place — the duplicate-submission guarantee, the failure banner that carries Fineract's own
 * text verbatim, and the two states in which no form exists. It also drives the record a second route
 * emission names, because the router reuses this component when the URL moves from one
 * `#/editclient/{id}` to another.
 * `ClientService` is stubbed at its own token, so the endpoint contract of
 * `GET /clients/{id}?template=true` and `PUT /clients/{id}` stays in `client.service.spec.ts` and no
 * HTTP client, interceptor or transport takes part here (Rule 1 clause 5). The router, the
 * translation stack and the permission gate are the real ones: the cancel control is a `RouterLink`,
 * so the router is composed with the route that serves this screen.
 *
 * Dates stay `Date` instances here: the screen never formats one, and the body cases pin that the
 * screen leaves `dateFormat` and `locale` to `ClientService.update`, which overwrites both at the
 * wire boundary (AAP 0.7.2 "Date handling"; AAP 0.14.1).
 */

/** The route that serves the edit screen, exactly as `clients.routes.ts` declares it. */
const ROUTES: Routes = [
  { path: 'editclient/:id', component: ClientEditComponent },
  { path: 'editclient', component: ClientEditComponent, pathMatch: 'full' },
];

/** The client the screen was opened on: the id `#/editclient/2` names. */
const CLIENT_ID = '2';

/**
 * The edit read's payload: the template members `ClientTemplate` declares plus the client's own
 * values the same response folds in, which is what legacy's `EditClientController` seeds its form
 * from. The extra members are the ones the component projects locally, so the fixture carries them
 * the way the wire does.
 */
const PAYLOAD = {
  officeId: 1,
  officeOptions: [{ id: 1, name: 'Head Office' }],
  staffOptions: [{ id: 7, displayName: 'Officer, Parity' }],
  activationDate: [2026, 11, 21],
  active: true,
  firstname: 'Ada',
  lastname: 'Okafor',
  externalId: 'EXT-2',
  mobileNo: '2025550102',
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

/**
 * The record a second route emission addresses: the id `#/editclient/25` names, and the client the
 * baseline data holds under client number 000000025.
 *
 * Every seeded value differs from {@link PAYLOAD}'s — both names, the external id and the mobile
 * number — so a second emission that kept the first client's values in the form could not pass as the
 * second client's record.
 */
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

/** The response a successful save answers with. */
const SAVED: ClientMutationResponse = { resourceId: 2, clientId: 2 };

/**
 * The captions this screen resolves, keyed exactly as the shipped flat legacy bundles key them
 * (`app/global-translations/`). A key that did not resolve would render humanised through the
 * missing-translation handler, so serving the real wording is what proves the labels resolve.
 */
const TRANSLATIONS: Readonly<Record<string, string>> = {
  'label.heading.editclient': 'Edit Client',
  'label.heading.notavailable': 'Not Available',
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

/**
 * The ngx-translate surface this screen touches: the `translate()` signal `TranslatePipe` 18
 * resolves its keys through. The screen holds no label signal of its own, so nothing else is
 * stubbed and nothing here reaches the network.
 */
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

/**
 * An observable the spec settles by hand, for the in-flight case: subscribing stores the completion,
 * so a case can hold the save open, submit again, then answer it once.
 */
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

  /**
   * Configures the TestBed for one case with the stubbed reads, then opens the screen at `url`
   * through the real router.
   *
   * Every case starts here, so the route and the answer the service gives are the only things it
   * changes. The module is reset first because a case supplies its own providers, and a module left
   * instantiated by the previous case cannot take new ones.
   */
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

    // The save's destinations are the router's own; the spy records them instead of navigating.
    navigate = vi.fn<(commands: readonly unknown[]) => Promise<boolean>>(() => Promise.resolve(true));
    vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(navigate);

    const harness = await RouterTestingHarness.create(url);

    // The seed read resolves in a microtask, so the first paint is taken once the queue has drained
    // and the fixture is stable.
    await settle(harness);

    return harness;
  }

  /**
   * Lets the queued reads and the form's own value changes settle, then paints, which is what one
   * route emission produces once its answer has arrived.
   *
   * @param harness the harness serving the edit route.
   */
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

    // The rendered controls hold the record's own values, so an operator edits what is stored.
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

    // Nothing has failed, so the failure region is absent — the state is proven rather than assumed,
    // and the rejection case below is the only place a banner may appear.
    expect(host.querySelector('.alert.alert-danger')).toBeNull();
    expect(component.error()).toBeNull();
  });

  it('issues exactly one update with the form’s values, then opens the record', async () => {
    const harness = await render(`/editclient/${CLIENT_ID}`);
    const host = hostOf(harness);
    const component = componentOf(harness);

    // Two fields are edited — one name and one contact value — so the posted body is the form's and
    // not the payload the read answered with.
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
    // An active record posts its activation date.
    expect(body?.activationDate).toBeInstanceOf(Date);

    // Exactly the members `ClientEditRequest` declares, and nothing the form does not own: no office,
    // no client id, no account number. The date-wire pair is the model's own constant here, and
    // `ClientService.update` — whose `ClientEditInput` omits both members — rewrites it from the
    // resolved configuration and the active language before the body reaches the wire, so the screen
    // cannot widen what the endpoint receives (AAP 0.7.2 "Date handling"; Rule 1 clause 2).
    expect(Object.keys(body ?? {}).sort()).toEqual([
      'activationDate',
      'dateFormat',
      'externalId',
      'firstname',
      'lastname',
      'locale',
      'mobileNo',
    ]);
    expect(body?.dateFormat).toBe(DISPLAY_DATE_FORMAT);
    expect(body?.locale).toBe('');

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/viewclient', CLIENT_ID]);
  });

  it('renders the entity name set for an entity client and posts only that one', async () => {
    clients.getWithTemplate.mockReturnValue(of(ENTITY_PAYLOAD));

    const harness = await render(`/editclient/${CLIENT_ID}`);
    const host = hostOf(harness);

    expect(inputValue(host, 'fullname')).toBe('Blitzy Bakery LLC');
    expect(host.querySelector('#firstname')).toBeNull();
    expect(host.querySelector('#lastname')).toBeNull();
    // A pending record carries no activation date field, so none is posted.
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

    // The legacy template marks this control required and nothing more, so the screen is what stops
    // the request — and it stops it before a body is built (Rule 1 clause 3).
    expect(clients.update).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(component.form.controls.firstname.touched).toBe(true);

    // The control's own form-group carries the Bootstrap error state and its message renders beside it.
    expect(host.querySelector('.form-group.has-error #firstname')).not.toBeNull();
    expect(host.querySelector('#firstname-error')?.textContent?.trim()).toBe('Required field');
    // Nothing was refused by the server, so no failure banner appears.
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

    // The entity branch's own required rule is what blocks the request, not the person's two names.
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

    // The date field owns its own error state and projects the message into the slot it renders.
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

    // The latch the save control binds is closed while the call is out, so a click that slipped past
    // the disabled button still reaches no second request.
    expect(component.guard.busy()).toBe(true);

    save.complete();
    await first;
    await second;

    expect(clients.update).toHaveBeenCalledTimes(1);
    // The latch is released once the call settles, so the screen is usable afterwards.
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

    // One banner, carrying the server's text and nothing else: no prefix, no suffix, no retranslation
    // (AAP 0.7.2 "Rendered verbatim"; Rule 1 clause 3, the message workflow W7 compares).
    const banners = host.querySelectorAll('.alert.alert-danger');

    expect(banners.length).toBe(1);
    expect(banners[0]?.textContent?.trim()).toBe(REJECTED_MESSAGE);
    // The interceptor owns the notification for a failure, so the screen must not raise a second one.
    expect(host.querySelector('app-notification')).toBeNull();

    // The form and the values just entered survive the failure, which is the state AAP 0.7.4 requires.
    expect(inputValue(host, 'firstname')).toBe('Ada');
    expect(inputValue(host, 'lastname')).toBe('Okafor-Rowe');
    expect(inputValue(host, 'externalId')).toBe('EXT-2-RETRY');
    expect(component.ready()).toBe(true);
    expect(clients.update).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
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

    // The router reuses this component when the URL moves from one edit route to another, so a second
    // emission is what an in-app move between two edit URLs produces.
    await harness.navigateByUrl(`/editclient/${SECOND_CLIENT_ID}`);
    await settle(harness);

    const host = hostOf(harness);

    // The same instance served both URLs: nothing below could pass by the screen being rebuilt.
    expect(componentOf(harness)).toBe(instance);

    // One load per emission, and each run addresses the record its own URL named.
    expect(clients.getWithTemplate).toHaveBeenCalledTimes(2);
    expect(clients.getWithTemplate).toHaveBeenNthCalledWith(1, CLIENT_ID);
    expect(clients.getWithTemplate).toHaveBeenNthCalledWith(2, SECOND_CLIENT_ID);

    // The second client's own values are in the form, and Cancel returns to its record.
    expect(inputValue(host, 'firstname')).toBe('Marcus');
    expect(inputValue(host, 'lastname')).toBe('Rowe-Bennett');
    expect(inputValue(host, 'externalId')).toBe('EXT-25');
    expect(inputValue(host, 'mobileNo')).toBe('2025550125');
    expect(host.querySelector('#cancel')?.getAttribute('href')).toBe(
      `/viewclient/${SECOND_CLIENT_ID}`,
    );

    // The save posts to the client the URL names now, not to the record the screen was opened on.
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

    // The first read is held open, so no form is painted for the first client.
    expect(hostOf(harness).querySelector('form')).toBeNull();

    await harness.navigateByUrl(`/editclient/${SECOND_CLIENT_ID}`);

    // The second read is the one the screen is waiting on; answering it seeds the second client.
    second.next(SECOND_PAYLOAD);
    second.complete();
    await settle(harness);

    expect(inputValue(hostOf(harness), 'firstname')).toBe('Marcus');

    // The earlier client's answer lands last. It is dropped rather than applied, or the first
    // client's values would be edited under the second client's URL.
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

    // No trace of the missing record is left: the form for the record the URL now names renders.
    expect(renderedText(moved)).not.toContain('Not Available');
    expect(inputValue(moved, 'firstname')).toBe('Marcus');
  });

  it('cancels the outstanding seed read when the screen is destroyed', async () => {
    const pending = new Subject<ClientTemplate>();

    clients.getWithTemplate.mockReturnValue(pending.asObservable());

    const harness = await render(`/editclient/${CLIENT_ID}`);

    // The read is in flight: the subject the read answers through has a subscriber.
    expect(pending.observed).toBe(true);

    harness.fixture.destroy();

    // Nothing is left holding the request open once the screen is gone.
    expect(pending.observed).toBe(false);
  });
});
