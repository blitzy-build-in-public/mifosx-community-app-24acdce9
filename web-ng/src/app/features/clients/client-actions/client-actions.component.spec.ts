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
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { catchError, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { DEFAULT_APP_CONFIG } from '../../../core/config/app-config.model';
import { AppConfigService } from '../../../core/config/app-config.service';
import { toApiError } from '../../../core/http/api-error';
import { DISPLAY_DATE_FORMAT } from '../../../shared/date-format.util';
import type { SelectOption } from '../../../shared/select-field/select-field.component';
import { ClientActionsComponent } from './client-actions.component';

/**
 * Behaviour of the client lifecycle action screen at `#/client/:id/:action` — the five commands
 * `activate`, `close`, `reject`, `withdraw` and `reactivate`, each preceded by the datatable gate the
 * legacy controller runs first (AAP 0.7.1 Features row `clients`; AAP 0.7.3 row "Client actions";
 * AAP 0.7.4 action screens; AAP 0.11.1 "unit specs beside every component and service"; Rule 1
 * clause 8).
 *
 * What it pins is the request sequence and the body a command posts, because that order is the
 * contract the parity harness compares and every step of it is something a rewrite could reorder:
 *
 *  1. an `:action` segment that names no in-scope command renders the not-found state and issues no
 *     request at all — no gate, no template, no command (AAP 0.7.4 "unknown segment renders
 *     not-found with no request");
 *  2. the gate's `GET /entityDatatableChecks?limit=-1` is the first request, exactly once, and
 *     nothing else is in flight until it answers;
 *  3. a failed gate leaves the form unready, publishes Fineract's own message for a 4xx, publishes
 *     nothing for a 5xx or a transport failure — the interceptor raises that one notification, so
 *     painting it here as well would report one problem twice — and never reads the reason list, so
 *     no field is ever enabled against a check that did not answer;
 *  4. `close` reads `GET /clients/template?commandParam=close` once the gate has passed and offers
 *     the tenant's reasons in the server's order;
 *  5. `activate` takes no reason and therefore reads no template at all;
 *  6. submitting `close` posts exactly one `POST /clients/{id}?command=close` whose body is the one
 *     date format, the active locale, the chosen date formatted in that pattern and the chosen reason
 *     id, and then returns to the record;
 *  7. a second submit while that command is in flight sends no second request, because the action
 *     endpoints are not idempotent (AAP 0.1.1 "one request per click");
 *  8. a refused command records a 4xx message verbatim, keeps every entered value and navigates
 *     nowhere (workflow W7), while the same rejection at a 5xx leaves that region empty for the same
 *     reason as the gate's;
 *  9. a `close` whose date is still empty posts nothing at all;
 * 10. the reason select of `close`, `reject` and `withdraw` announces no required constraint, because
 *     its control carries no validator and the screen posts the reason as chosen, while the date
 *     field beside it — whose control does carry one — announces the constraint Fineract enforces
 *     (Rule 1 clause 3; AAP 0.4.4 decision 6).
 *
 * **The request sequence is asserted without a render.** What this screen does — the gate's order,
 * the reason list, one command per click and the body it carries — lives entirely in the component
 * and the services it calls, so those cases mount the screen and read its signals rather than a
 * fixture. Two cases do render, to pin the two things only the template can show: the form appears
 * only after the gate — and, for a reason-taking command, the reason list — has answered, with its
 * primary button disabled while a command is in flight (AAP 0.7.4; AAP 0.1.1); and the required
 * marker the reason select and the date field do or do not carry in `aria-required`.
 *
 * **Providers.** Each case mounts the screen for its own URL, so the module is reset first and the
 * route stub is the one provider a case supplies: `ActivatedRoute.paramMap` emits the two segments
 * the case is about. The configuration is loaded from a stubbed `fetch` before the component exists,
 * because every URL is composed from it, and the ngx-translate stack is registered with the legacy
 * captions the screen's copy resolves. The router is a spy over `navigate` — the screen owes the
 * router one navigation per landed command — and the error mapping is the production one, installed
 * as an interceptor so the rejection the component narrows is the type it narrows in the application
 * (AAP 0.4.2).
 *
 * The fixtures are synthetic: an invented client id, two invented reasons and messages quoted in the
 * shape the fork answers with. Nothing here logs a client id, a reason id or a body (Rule 1 clause 9).
 */

/** The configuration the stubbed transport serves: the application's own documented default shape. */
const SERVED_CONFIG = DEFAULT_APP_CONFIG;

/** The API root every client URL is composed from, built from the resolved configuration. */
const API_ROOT = `${SERVED_CONFIG.apiBaseUrl}${SERVED_CONFIG.apiPath}`;

/** The client the commands apply to, as the `:id` segment delivers it. */
const CLIENT_ID = '2';

/** `GET /entityDatatableChecks?limit=-1` — the first call of the legacy gate. */
const GATE_URL = `${API_ROOT}/entityDatatableChecks`;

/** `GET /clients/template?commandParam=<command>` — the reason list of the three reason-taking commands. */
const TEMPLATE_URL = `${API_ROOT}/clients/template`;

/** `POST /clients/{id}?command=<command>` — the one write this screen makes. */
const CLIENT_URL = `${API_ROOT}/clients/${CLIENT_ID}`;

/** Where the screen returns once a command lands. */
const RECORD_ROUTE = ['/viewclient', CLIENT_ID];

/** The pattern every date-bearing body carries, spelled out as the contract fixes it. */
const PAYLOAD_DATE_FORMAT = 'dd MMMM yyyy';

/**
 * The legacy captions the screen's copy resolves, keyed exactly as the shipped flat translation
 * bundles key them. A key that did not resolve would render as itself, so serving the wording is what
 * proves the heading, the button, the date and reason labels and the not-found message resolve.
 */
const TRANSLATIONS: Readonly<Record<string, string>> = {
  'label.anchor.activate': 'Activate',
  'label.anchor.close': 'Close',
  'label.anchor.reject': 'Reject',
  'label.anchor.withdraw': 'Withdraw',
  'label.input.activationdate': 'Activation date',
  'label.input.closuredate': 'Closure date',
  'label.input.closurereason': 'Closure reason',
  'label.input.rejectiondate': 'Rejection date',
  'label.input.rejectionreason': 'Rejection reason',
  'label.input.withdrawaldate': 'Withdrawal date',
  'label.input.withdrawalreason': 'Withdrawal reason',
  'label.button.save': 'Submit',
  'label.button.cancel': 'Cancel',
  'label.select': 'Select an option',
  'label.heading.notavailable': 'Not Available',
  'error.msg.resource.not.found': 'The requested resource is not available.',
};

/**
 * The tenant's configured closure reasons, in the order the template returns them: the ids are the
 * server's own, which is why the screen never invents one (AAP 0.7.3 row "Client actions").
 */
const REASONS: readonly SelectOption[] = [
  { id: 11, name: 'Client has moved away' },
  { id: 12, name: 'Other' },
];

/** The reason every submit case chooses: the first the tenant configured, as the select offers it. */
const CHOSEN_REASON: SelectOption = REASONS[0];

/** The gate's answer for a tenant with no applicable check: nothing to read, so the gate passes. */
const NO_CHECKS = { totalFilteredRecords: 0, pageItems: [] } as const;

/** The day the closure is submitted with, as the form's date control holds it. */
const CLOSURE_DATE = new Date(2026, 10, 24);

/** The same day as a payload carries it: the one display pattern, in the active language. */
const CLOSURE_DATE_AS_PAYLOAD = formatDate(CLOSURE_DATE, DISPLAY_DATE_FORMAT, 'en');

/** The message a failed gate answers with, quoted from a real server-side failure. */
const GATE_FAILURE_MESSAGE = 'The datatables could not be read.';

/** The message a refused command answers with, quoted from a real Fineract validation failure. */
const COMMAND_FAILURE_MESSAGE = 'The closure date cannot be in the future.';

/**
 * Installs the production mapping of a Fineract failure onto the test transport, so a rejection
 * arrives as the `ApiError` the component renders (AAP 0.4.2; workflow W7).
 */
const MAP_FINERACT_FAILURES: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((failure: HttpErrorResponse) => throwError(() => toApiError(failure))),
  );

/** Matches any request, so a case can prove that nothing at all was issued. */
function isAnyRequest(): boolean {
  return true;
}

/** Matches the gate's one call. */
function isGateRead(request: TestRequest['request']): boolean {
  return request.method === 'GET' && request.url === GATE_URL;
}

/** Matches the reason-list read of one command. */
function isTemplateRead(command: string): (request: TestRequest['request']) => boolean {
  return (request) =>
    request.method === 'GET' &&
    request.url === TEMPLATE_URL &&
    request.params.get('commandParam') === command;
}

/** Matches any command POST to the client, so a case can assert that none was sent. */
function isCommandPost(request: TestRequest['request']): boolean {
  return request.method === 'POST' && request.url === CLIENT_URL;
}

describe('ClientActionsComponent', () => {
  let fixture: ComponentFixture<ClientActionsComponent>;
  let component: ClientActionsComponent;
  let httpMock: HttpTestingController;
  let navigate: Mock<(commands: readonly unknown[]) => Promise<boolean>>;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines the
  // cast to one line and keeps the DOM assertions type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The card's title, which is the current command's own legacy step title. */
  function panelTitle(): string | null {
    return host().querySelector('.panel-title')?.textContent?.trim() ?? null;
  }

  /** The one primary button, or `null` while the form is not rendered yet. */
  function saveButton(): HTMLButtonElement | null {
    return host().querySelector<HTMLButtonElement>('#save');
  }

  /** The option labels of the reason select, in render order, or none when no select renders. */
  function reasonOptionLabels(): string[] {
    const select = host().querySelector<HTMLSelectElement>('app-select-field select');

    return select === null
      ? []
      : Array.from(select.options).map((option) => option.textContent?.trim() ?? '');
  }

  /** The route stub's parameter map for the segments a case is about. */
  function paramsFor(action: string, id: string): ParamMap {
    return convertToParamMap({ id, action });
  }

  /**
   * Mounts the screen for one `#/client/:id/:action` URL.
   *
   * The component's constructor resolves the segments and starts the gate, so the request a case
   * expects is already in flight when this returns.
   *
   * @param action the `:action` segment the route delivers.
   * @param id the `:id` segment the route delivers.
   */
  async function show(action: string, id: string = CLIENT_ID): Promise<void> {
    // Every case mounts the screen for its own URL, so the module is reset first: a module left
    // instantiated by the previous case cannot take a new route stub.
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      imports: [ClientActionsComponent],
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
    // The component is mounted without a first render: every request it makes is issued from the
    // constructor or from `submit`, so a case that only reads the sequence needs no fixture. The one
    // case that renders does so itself, once it has answered the step it is about.
    fixture = TestBed.createComponent(ClientActionsComponent);
    component = fixture.componentInstance;
  }

  /**
   * Lets the load sequence finish after a response was flushed.
   *
   * The sequence is a chain of promises rather than a zone task, so draining one macrotask is what
   * guarantees every continuation it queued has run before the assertions read the signals.
   */
  async function settle(): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  /** Answers the gate with a tenant that has no applicable check, which is a pass. */
  async function passGate(): Promise<void> {
    httpMock.expectOne(isGateRead).flush(NO_CHECKS);
    await settle();
  }

  /** Answers the reason-list read of `command` with the tenant's reasons. */
  async function answerTemplate(command: string): Promise<void> {
    httpMock.expectOne(isTemplateRead(command)).flush({ narrations: REASONS });
    await settle();
  }

  /** Mounts `close` and drives it to the ready form, which is where every submit case starts. */
  async function showReadyClose(): Promise<void> {
    await show('close');
    await passGate();
    await answerTemplate('close');

    expect(component.ready()).toBe(true);
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

  it('refuses an :action segment that names no command, without issuing a request', async () => {
    await show('nonsense');

    expect(component.notFound()).toBe(true);
    expect(component.ready()).toBe(false);
    expect(component.command()).toBeNull();
    expect(component.reasonOptions()).toEqual([]);
    // Neither the gate nor a command reached the API: an unknown segment names nothing to check.
    expect(httpMock.match(isAnyRequest)).toHaveLength(0);
  });

  it('runs the datatable gate first, once, with the legacy limit=-1', async () => {
    await show('close');

    const gate = httpMock.expectOne(isGateRead);

    expect(gate.request.method).toBe('GET');
    expect(gate.request.params.keys()).toEqual(['limit']);
    expect(gate.request.params.get('limit')).toBe('-1');
    expect(gate.request.body).toBeNull();

    // Nothing else is in flight while the gate is outstanding: the reason list and the command both
    // wait for it (AAP 0.7.3 row "Client actions: datatable gate").
    expect(httpMock.match(isAnyRequest)).toHaveLength(0);

    gate.flush(NO_CHECKS);
    await settle();

    // The gate ran once and is never re-run on submit, because a second call would be a request the
    // legacy screen never makes; the only call left is the next step of this command, the reason list.
    expect(httpMock.match(isGateRead)).toHaveLength(0);

    await answerTemplate('close');
  });

  it('leaves the form unready and reads no reason list when the gate fails', async () => {
    await show('close');

    httpMock
      .expectOne(isGateRead)
      .flush(
        { defaultUserMessage: GATE_FAILURE_MESSAGE },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();

    expect(component.ready()).toBe(false);
    // A 4xx is Fineract answering, so its own text reaches the screen verbatim (AAP 0.7.4; workflow
    // W7).
    expect(component.error()).toBe(GATE_FAILURE_MESSAGE);
    expect(component.reasonOptions()).toEqual([]);
    // A failed gate is never treated as a pass: the reason list is not read at all.
    expect(httpMock.match(isTemplateRead('close'))).toHaveLength(0);
    expect(httpMock.match(isCommandPost)).toHaveLength(0);
  });

  it('paints nothing for a gate that fails with a 5xx, which the interceptor has already reported', async () => {
    await show('close');

    httpMock
      .expectOne(isGateRead)
      .flush(
        { defaultUserMessage: GATE_FAILURE_MESSAGE },
        { status: 503, statusText: 'Service Unavailable' },
      );
    await settle();

    // One failure, one report: `fineract.interceptor.ts` raised the notification for a 5xx, so this
    // region stays empty and the form stays unrendered (AAP 0.7.4).
    expect(component.ready()).toBe(false);
    expect(component.error()).toBeNull();
    expect(httpMock.match(isTemplateRead('close'))).toHaveLength(0);
    expect(httpMock.match(isCommandPost)).toHaveLength(0);
  });

  it('paints nothing for a gate that fails in transport, whose message would carry the request URL', async () => {
    await show('close');

    httpMock.expectOne(isGateRead).flush(null, { status: 0, statusText: 'Unknown Error' });
    await settle();

    // Status `0` is the class's marker for "no HTTP answer": the interceptor notified it, and the
    // failure's own message is Angular's, which names the configured API host (AAP 0.7.4; Rule 1
    // clause 9).
    expect(component.ready()).toBe(false);
    expect(component.error()).toBeNull();
    expect(httpMock.match(isTemplateRead('close'))).toHaveLength(0);
  });

  it('reads the reason list once for close and offers the tenant’s reasons in the server’s order', async () => {
    await show('close');
    await passGate();

    const template = httpMock.expectOne(isTemplateRead('close'));

    expect(template.request.method).toBe('GET');
    expect(template.request.params.keys()).toEqual(['commandParam']);
    // The form stays unready until the reasons are in hand, so no select is ever rendered empty.
    expect(component.ready()).toBe(false);
    expect(component.reasonOptions()).toEqual([]);

    template.flush({ narrations: REASONS });
    await settle();

    expect(component.ready()).toBe(true);
    expect(component.error()).toBeNull();
    expect(component.reasonOptions()).toEqual(REASONS);
    expect(httpMock.match(isAnyRequest)).toHaveLength(0);
  });

  it('reads no template at all for activate, which takes no reason', async () => {
    await show('activate');

    await passGate();

    expect(component.ready()).toBe(true);
    expect(component.reasonOptions()).toEqual([]);
    expect(httpMock.match((request) => request.url === TEMPLATE_URL)).toHaveLength(0);
    expect(httpMock.match(isAnyRequest)).toHaveLength(0);
  });

  it('posts one close command with the date in the one payload pattern and returns to the record', async () => {
    await showReadyClose();

    component.closeForm.controls.closureDate.setValue(CLOSURE_DATE);
    component.closeForm.controls.closureReasonId.setValue(CHOSEN_REASON.id);

    component.submit();

    const post = httpMock.expectOne(isCommandPost);

    expect(post.request.params.keys()).toEqual(['command']);
    expect(post.request.params.get('command')).toBe('close');
    // The body is exactly what the service builds for a close: the pattern, the active language, the
    // chosen day formatted in that pattern and the tenant's reason id — nothing else travels with it
    // (AAP 0.7.2 row `ClientActionRequest`; Rule 1 clause 2).
    expect(post.request.body).toEqual({
      dateFormat: PAYLOAD_DATE_FORMAT,
      locale: 'en',
      closureDate: CLOSURE_DATE_AS_PAYLOAD,
      closureReasonId: CHOSEN_REASON.id,
    });

    post.flush({ resourceId: 2, clientId: 2 });
    await settle();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(RECORD_ROUTE);
    expect(httpMock.match(isAnyRequest)).toHaveLength(0);
  });

  it('refuses a second submit while the command is in flight', async () => {
    await showReadyClose();

    component.closeForm.controls.closureDate.setValue(CLOSURE_DATE);
    component.closeForm.controls.closureReasonId.setValue(CHOSEN_REASON.id);

    component.submit();
    const post = httpMock.expectOne(isCommandPost);

    // The guard's busy flag was set before the request was issued, so the re-entrant call is refused
    // rather than queued: one click posts once (AAP 0.1.1; workflow W5).
    component.submit();

    expect(httpMock.match(isCommandPost)).toHaveLength(0);

    post.flush({ resourceId: 2, clientId: 2 });
    await settle();

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('records a refused command verbatim, keeps the entered values and navigates nowhere', async () => {
    await showReadyClose();

    component.closeForm.controls.closureDate.setValue(CLOSURE_DATE);
    component.closeForm.controls.closureReasonId.setValue(CHOSEN_REASON.id);

    component.submit();

    httpMock
      .expectOne(isCommandPost)
      .flush(
        { defaultUserMessage: COMMAND_FAILURE_MESSAGE },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();

    // The server's own text, verbatim: no prefix, no translation, no fallback (workflow W7).
    expect(component.error()).toBe(COMMAND_FAILURE_MESSAGE);
    // The form keeps what the operator entered, so the field the server named can be corrected.
    expect(component.closeForm.controls.closureDate.value).toEqual(CLOSURE_DATE);
    expect(component.closeForm.controls.closureReasonId.value).toBe(CHOSEN_REASON.id);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('paints nothing for a command that fails with a 5xx, which the interceptor has already reported', async () => {
    await showReadyClose();

    component.closeForm.controls.closureDate.setValue(CLOSURE_DATE);
    component.closeForm.controls.closureReasonId.setValue(CHOSEN_REASON.id);

    component.submit();

    httpMock
      .expectOne(isCommandPost)
      .flush(
        { defaultUserMessage: COMMAND_FAILURE_MESSAGE },
        { status: 500, statusText: 'Server Error' },
      );
    await settle();

    // The interceptor's notification is the one report of this failure, so the region stays empty
    // while the entered values survive for the retry (AAP 0.7.4).
    expect(component.error()).toBeNull();
    expect(component.closeForm.controls.closureDate.value).toEqual(CLOSURE_DATE);
    expect(component.closeForm.controls.closureReasonId.value).toBe(CHOSEN_REASON.id);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('posts nothing while the closure date is still empty', async () => {
    await showReadyClose();

    component.closeForm.controls.closureReasonId.setValue(CHOSEN_REASON.id);

    component.submit();

    expect(httpMock.match(isCommandPost)).toHaveLength(0);
    // The control is marked as touched, so the shared date field shows its required message rather
    // than the screen appearing to ignore the click.
    expect(component.closeForm.controls.closureDate.touched).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders the form only after the gate and the reason list have answered', async () => {
    await show('close');

    // The command's own title is on screen from the moment the route names it, but no field is: the
    // gate has not answered, and a form enabled against a check that never ran is the sequence the
    // legacy controller forbids (AAP 0.7.4; AAP 0.7.3 row "Client actions: datatable gate").
    fixture.detectChanges();

    expect(panelTitle()).toBe(TRANSLATIONS['label.anchor.close']);
    expect(host().querySelectorAll('form')).toHaveLength(0);
    expect(saveButton()).toBeNull();

    await passGate();
    // Still nothing to fill in: `close` posts a reason, so an empty picker would be a field the tenant
    // has no option for (AAP 0.7.3 row "Client actions").
    fixture.detectChanges();

    expect(host().querySelectorAll('form')).toHaveLength(0);

    await answerTemplate('close');
    fixture.detectChanges();

    // One form: the shared date field, the reason select behind its prompt carrying the tenant's
    // reasons in the server's order, and the legacy submit button.
    expect(host().querySelectorAll('form')).toHaveLength(1);
    expect(host().querySelectorAll('app-date-field input[type="date"]')).toHaveLength(1);
    expect(reasonOptionLabels()).toEqual([
      TRANSLATIONS['label.select'],
      ...REASONS.map((reason) => reason.name),
    ]);
    expect(saveButton()?.textContent?.trim()).toBe(TRANSLATIONS['label.button.save']);
    expect(saveButton()?.disabled).toBe(false);

    // One click posts one command: while the request is in flight the primary button is disabled, so a
    // second click cannot send a second action against a financial record (AAP 0.1.1).
    component.closeForm.controls.closureDate.setValue(CLOSURE_DATE);
    component.closeForm.controls.closureReasonId.setValue(CHOSEN_REASON.id);
    component.submit();
    fixture.detectChanges();

    expect(saveButton()?.disabled).toBe(true);

    httpMock.expectOne(isCommandPost).flush({ resourceId: 2, clientId: 2 });
    await settle();
  });

  it.each(['close', 'reject', 'withdraw'] as const)(
    'marks the %s date field required and leaves the optional reason select unmarked',
    async (action) => {
      await show(action);
      await passGate();
      await answerTemplate(action);
      fixture.detectChanges();

      const reasonSelect = host().querySelector<HTMLSelectElement>('app-select-field select');
      const dateInput = host().querySelector<HTMLInputElement>('app-date-field input[type="date"]');

      // The reason is posted as chosen — including nothing at all — and its control carries no
      // validator, so the field must not announce a constraint this screen does not enforce
      // (Rule 1 clause 3; AAP 0.4.4 decision 6).
      expect(reasonSelect).not.toBeNull();
      expect(reasonSelect?.hasAttribute('aria-required')).toBe(false);

      // The date control does carry `Validators.required`, so the one rule Fineract states is the one
      // assistive technology is told about.
      expect(dateInput).not.toBeNull();
      expect(dateInput?.getAttribute('aria-required')).toBe('true');
    },
  );
});
