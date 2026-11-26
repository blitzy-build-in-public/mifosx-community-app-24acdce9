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
import type { FormControl } from '@angular/forms';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { catchError, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { PermissionsService } from '../../../core/auth/permissions.service';
import { DEFAULT_APP_CONFIG } from '../../../core/config/app-config.model';
import { AppConfigService } from '../../../core/config/app-config.service';
import { toApiError } from '../../../core/http/api-error';
import { DISPLAY_DATE_FORMAT } from '../../../shared/date-format.util';
import type {
  SelectOption,
  SelectValue,
} from '../../../shared/select-field/select-field.component';
import { CLIENT_ACTION_PERMISSIONS, type ClientActionCommand } from '../client.models';
import { ClientActionsComponent } from './client-actions.component';

/** Behaviour of the client lifecycle action screen at `#/client/:id/:action` — the five commands `activate`, `close`, `reject`, `withdraw` and `reactivate`, each preceded by the datatable gate the legacy controller runs (AAP 0.7.1, AAP 0.7.3, AAP 0.7.4, AAP 0.11.1). */

/** The configuration the stubbed transport serves: the application's own documented default shape. */
const SERVED_CONFIG = DEFAULT_APP_CONFIG;

/** The API root every client URL is composed from, built from the resolved configuration. */
const API_ROOT = `${SERVED_CONFIG.apiBaseUrl}${SERVED_CONFIG.apiPath}`;

/** The client the commands apply to, as the `:id` segment delivers it. */
const CLIENT_ID = '2';

/** The five in-scope commands, in the order the legacy controller's own `case` labels name them. */
const COMMANDS = [
  'activate',
  'close',
  'reject',
  'withdraw',
  'reactivate',
] as const satisfies readonly ClientActionCommand[];

/** The three commands whose reason list comes from `GET /clients/template?commandParam=<command>`; `activate` and `reactivate` read no template at all (AAP 0.7.3 row "Client actions"). */
const REASON_COMMANDS = [
  'close',
  'reject',
  'withdraw',
] as const satisfies readonly ClientActionCommand[];

/** The body member each command carries its action date in, quoted from AAP 0.7.2 row `ClientActionRequest`. */
const DATE_BODY_KEY: Readonly<Record<ClientActionCommand, string>> = {
  activate: 'activationDate',
  close: 'closureDate',
  reject: 'rejectionDate',
  withdraw: 'withdrawalDate',
  reactivate: 'reactivationDate',
};

/** The body member each command carries its reason id in, quoted from AAP 0.7.2 row `ClientActionRequest`: the id is posted under the command's own member, never under another's. */
const REASON_BODY_KEY: Readonly<Record<(typeof REASON_COMMANDS)[number], string>> = {
  close: 'closureReasonId',
  reject: 'rejectionReasonId',
  withdraw: 'withdrawalReasonId',
};

/** `GET /entityDatatableChecks?limit=-1` — the first call of the legacy gate. */
const GATE_URL = `${API_ROOT}/entityDatatableChecks`;

/** `GET /clients/template?commandParam=<command>` — the reason list of the three reason-taking commands. */
const TEMPLATE_URL = `${API_ROOT}/clients/template`;

/** `POST /clients/{id}?command=<command>` — the one write this screen makes. */
const CLIENT_URL = `${API_ROOT}/clients/${CLIENT_ID}`;

/** Where the screen returns once a command lands. */
const RECORD_ROUTE = ['/viewclient', CLIENT_ID];

/** The `:id` tail every per-client request ends with, taken from the client URL rather than spelled again: the gate's check read addresses the same client the command does, so one composed URL is what proves the segment. */
const CLIENT_SUFFIX: string = relativeUrl(CLIENT_URL).slice(-(CLIENT_ID.length + 1));

/** The pattern every date-bearing body carries, spelled out as the contract fixes it. */
const PAYLOAD_DATE_FORMAT = 'dd MMMM yyyy';

/** The legacy captions the screen's copy resolves, keyed exactly as the shipped flat translation bundles key them. */
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
  'label.requiredfield': 'Required field',
  'label.select': 'Select an option',
  'label.heading.notavailable': 'Not Available',
  'error.msg.resource.not.found': 'The requested resource is not available.',
};

/** The tenant's configured closure reasons, in the order the template returns them: the ids are the server's own, which is why the screen never invents one (AAP 0.7.3 row "Client actions"). */
const REASONS: readonly SelectOption[] = [
  { id: 11, name: 'Client has moved away' },
  { id: 12, name: 'Other' },
];

/** The reason every submit case chooses: the first the tenant configured, as the select offers it. */
const CHOSEN_REASON: SelectOption = REASONS[0];

/** The second reason the tenant configured: the one a case selects through the rendered control, so the id a body carries is proven to be the option the operator picked rather than the first of the list. */
const OTHER_REASON: SelectOption = REASONS[1];

/** The gate's answer for a tenant with no applicable check: nothing to read, so the gate passes. */
const NO_CHECKS = { totalFilteredRecords: 0, pageItems: [] } as const;

/** The day the closure is submitted with, as the form's date control holds it. */
const CLOSURE_DATE = new Date(2026, 10, 24);

/** The same day as a payload carries it: the one display pattern, in the active language. */
const CLOSURE_DATE_AS_PAYLOAD = formatDate(CLOSURE_DATE, DISPLAY_DATE_FORMAT, 'en');

/** The day an activation or a reactivation is submitted with, as its date control holds it. */
const ACTION_DATE = new Date(2026, 10, 24);

/** The same day as a payload carries it: the one display pattern, in the active language. */
const ACTION_DATE_AS_PAYLOAD = formatDate(ACTION_DATE, DISPLAY_DATE_FORMAT, 'en');

/** The message a failed gate answers with, quoted from a real server-side failure. */
const GATE_FAILURE_MESSAGE = 'The datatables could not be read.';

/** The message a refused command answers with, quoted from a real Fineract validation failure. */
const COMMAND_FAILURE_MESSAGE = 'The closure date cannot be in the future.';

/** Installs the production mapping of a Fineract failure onto the test transport, so a rejection arrives as the `ApiError` the component renders (AAP 0.4.2; workflow W7). */
const MAP_FINERACT_FAILURES: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((failure: HttpErrorResponse) => throwError(() => toApiError(failure))),
  );

/** The method and configuration-relative path of every request the screen has issued, in the order it issued them. {@link show} empties it, so each case reads the sequence of its own screen alone. */
let recorded: string[] = [];

/** Records a request before the mapping interceptor answers it, which is what lets a case assert the **relative order** of the gate, the reason list and the command rather than only their presence. */
const RECORD_REQUESTS: HttpInterceptorFn = (request, next) => {
  recorded.push(`${request.method} ${relativeUrl(request.urlWithParams)}`);

  return next(request);
};

/** The configuration-relative path of one API URL, which is how a recorded request is spelled: the host and the API path are the same for every call, so only the resource identifies it. @param url the absolute URL a request or a constant carries. */
function relativeUrl(url: string): string {
  return url.slice(API_ROOT.length);
}

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

/** Whether a command reads its reason list from the tenant's template. */
function isReasonCommand(command: ClientActionCommand): boolean {
  return command === 'close' || command === 'reject' || command === 'withdraw';
}

/** The exact requests one command issues, in the order it must issue them: the datatable gate first, then — for the three commands that take a reason — the template read, then the one command POST. Written as the legacy (AAP 0.7.3, AAP 0.14.1). */
function expectedSequence(command: ClientActionCommand): readonly string[] {
  const gate = `GET ${relativeUrl(GATE_URL)}?limit=-1`;
  const post = `POST ${relativeUrl(CLIENT_URL)}?command=${command}`;

  return isReasonCommand(command)
    ? [gate, `GET ${relativeUrl(TEMPLATE_URL)}?commandParam=${command}`, post]
    : [gate, post];
}

describe('ClientActionsComponent', () => {
  let fixture: ComponentFixture<ClientActionsComponent>;
  let component: ClientActionsComponent;
  let httpMock: HttpTestingController;
  let navigate: Mock<(commands: readonly unknown[]) => Promise<boolean>>;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines the cast to one line and keeps the DOM assertions type-checked (Rule 1 clause 4).
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

  /** The date control of the command a case is about: each command owns its own form, and each form its own date member, so a case edits exactly the control the current screen renders. @param command the command whose form. */
  function dateControl(command: ClientActionCommand): FormControl<Date | null> {
    switch (command) {
      case 'activate':
        return component.activateForm.controls.activationDate;
      case 'close':
        return component.closeForm.controls.closureDate;
      case 'reject':
        return component.rejectForm.controls.rejectionDate;
      case 'withdraw':
        return component.withdrawForm.controls.withdrawalDate;
      case 'reactivate':
        return component.reactivateForm.controls.reactivationDate;
    }
  }

  /** The reason control of the three commands that take one, or `null` for `activate` and `reactivate`, which render no select at all. @param command the command whose form is on screen. @returns that form's reason control. */
  function reasonControl(command: ClientActionCommand): FormControl<SelectValue | null> | null {
    switch (command) {
      case 'close':
        return component.closeForm.controls.closureReasonId;
      case 'reject':
        return component.rejectForm.controls.rejectionReasonId;
      case 'withdraw':
        return component.withdrawForm.controls.withdrawalReasonId;
      case 'activate':
      case 'reactivate':
        return null;
    }
  }

  /** The method and path of every request the screen issued, in the order it issued them. */
  function requestSequence(): readonly string[] {
    return recorded;
  }

  /** The route stub's parameter map for the segments a case is about. */
  function paramsFor(action: string, id: string): ParamMap {
    return convertToParamMap({ id, action });
  }

  /** The codes a user must hold to see the mounted command's submit control: the command's own code, or none when the `:action` segment names no command. */
  function commandCodes(action: string): readonly string[] {
    const command = COMMANDS.find((entry): boolean => entry === action);

    return command === undefined ? [] : [CLIENT_ACTION_PERMISSIONS[command]];
  }

  /** Mounts the screen for one `#/client/:id/:action` URL as a signed-in user holding the mounted command's code. */
  async function show(
    action: string,
    id: string = CLIENT_ID,
    granted?: readonly string[],
  ): Promise<void> {
    TestBed.resetTestingModule();

    recorded = [];

    TestBed.configureTestingModule({
      imports: [ClientActionsComponent],
      providers: [
        provideHttpClient(withInterceptors([RECORD_REQUESTS, MAP_FINERACT_FAILURES])),
        provideHttpClientTesting(),
        provideTranslateService(),
        { provide: Router, useValue: { navigate } },
        { provide: ActivatedRoute, useValue: { paramMap: of(paramsFor(action, id)) } },
      ],
    });

    TestBed.inject(PermissionsService).setPermissions(granted ?? commandCodes(action));

    await TestBed.inject(AppConfigService).load();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', TRANSLATIONS, true);
    translate.use('en');

    httpMock = TestBed.inject(HttpTestingController);
    // The component is mounted without a first render: every request it makes is issued from the constructor or from `submit`, so a case that only reads the sequence needs no fixture.
    fixture = TestBed.createComponent(ClientActionsComponent);
    component = fixture.componentInstance;
  }

  /** Lets the load sequence finish after a response was flushed. The sequence is a chain of promises rather than a zone task, so draining one macrotask is what guarantees every continuation it queued has run before the assertions read the signals. */
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

  /** Mounts `command` and drives it to its ready form: the gate is answered first, then the reason list for the three commands that read one, which is the order the screen itself runs them in. @param command the command a case submits. */
  async function showReady(command: ClientActionCommand): Promise<void> {
    await show(command);
    await passGate();

    if (isReasonCommand(command)) {
      await answerTemplate(command);
    }

    expect(component.ready()).toBe(true);
  }

  /** Mounts `close` and drives it to the ready form, which is where every submit case starts. */
  async function showReadyClose(): Promise<void> {
    await showReady('close');
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => {
        // `Response` stand-in: the three members `AppConfigService.fetchRawConfig` reads.
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

    // The screen says so in the one failure region, translated from the legacy bundle's own key, and renders no field: there is no command to post (AAP 0.7.4).
    fixture.detectChanges();

    expect(host().querySelector('.alert.alert-danger')?.textContent).toContain(
      TRANSLATIONS['error.msg.resource.not.found'],
    );
    expect(host().querySelectorAll('form')).toHaveLength(0);
  });

  it('runs the datatable gate first, once, with the legacy limit=-1', async () => {
    await show('close');

    const gate = httpMock.expectOne(isGateRead);

    expect(gate.request.method).toBe('GET');
    expect(gate.request.params.keys()).toEqual(['limit']);
    expect(gate.request.params.get('limit')).toBe('-1');
    expect(gate.request.body).toBeNull();

    // Nothing else is in flight while the gate is outstanding: the reason list and the command both wait for it (AAP 0.7.3 row "Client actions: datatable gate").
    expect(httpMock.match(isAnyRequest)).toHaveLength(0);

    gate.flush(NO_CHECKS);
    await settle();

    // The gate ran once and is never re-run on submit, because a second call would be a request the legacy screen never makes; the only call left is the next step of this command, the reason list.
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
    // A 4xx is Fineract answering, so its own text reaches the screen verbatim (AAP 0.7.4; workflow W7).
    expect(component.error()).toBe(GATE_FAILURE_MESSAGE);
    expect(component.reasonOptions()).toEqual([]);
    expect(httpMock.match(isTemplateRead('close'))).toHaveLength(0);
    expect(httpMock.match(isCommandPost)).toHaveLength(0);

    // The region renders Fineract's own sentence exactly, and no form sits under it: a field enabled against a check that never answered is the sequence the legacy controller forbids (AAP 0.7.4).
    fixture.detectChanges();

    expect(host().querySelector('.alert.alert-danger')?.textContent?.trim()).toBe(
      GATE_FAILURE_MESSAGE,
    );
    expect(host().querySelectorAll('form')).toHaveLength(0);
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

    // One failure, one report: `fineract.interceptor.ts` raised the notification for a 5xx, so this region stays empty and the form stays unrendered (AAP 0.7.4).
    expect(component.ready()).toBe(false);
    expect(component.error()).toBeNull();
    expect(httpMock.match(isTemplateRead('close'))).toHaveLength(0);
    expect(httpMock.match(isCommandPost)).toHaveLength(0);
  });

  it('paints nothing for a gate that fails in transport, whose message would carry the request URL', async () => {
    await show('close');

    httpMock.expectOne(isGateRead).flush(null, { status: 0, statusText: 'Unknown Error' });
    await settle();

    // Status `0` is the class's marker for "no HTTP answer": the interceptor notified it, and the failure's own message is Angular's, which names the configured API host (AAP 0.7.4; Rule 1 clause 9).
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
    // The body is exactly what the service builds for a close: the pattern, the active language, the chosen day formatted in that pattern and the tenant's reason id — nothing else travels with it (AAP 0.7.2 row `ClientActionRequest`; Rule 1 clause 2).
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

    // The guard's busy flag was set before the request was issued, so the re-entrant call is refused rather than queued: one click posts once (AAP 0.1.1; workflow W5).
    expect(component.guard.busy()).toBe(true);

    component.submit();

    expect(httpMock.match(isCommandPost)).toHaveLength(0);

    post.flush({ resourceId: 2, clientId: 2 });
    await settle();

    expect(component.guard.busy()).toBe(false);
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

    // The interceptor's notification is the one report of this failure, so the region stays empty while the entered values survive for the retry (AAP 0.7.4).
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
    expect(component.closeForm.controls.closureDate.touched).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('posts nothing while the closure reason is still unchosen', async () => {
    await showReadyClose();

    // The date is filled and the picker still shows its prompt row, which is the state the legacy form leaves a user in when they submit without choosing a reason.
    component.closeForm.controls.closureDate.setValue(CLOSURE_DATE);
    component.submit();

    // The legacy template marks the reason required and `validateClose` declares the id `notNull().longGreaterThanZero`, so the prompt row is not a choice: no body
    // that lacks a reason is posted, and the control is marked as touched so its field reports the missing one.
    expect(httpMock.match(isCommandPost)).toHaveLength(0);
    expect(component.closeForm.controls.closureReasonId.touched).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders the form only after the gate and the reason list have answered', async () => {
    await show('close');

    // The command's own title is on screen from the moment the route names it, but no field is: the gate has not answered, and a form enabled against a check that never ran is the sequence the legacy controller forbids (AAP 0.7.4, AAP 0.7.3).
    fixture.detectChanges();

    expect(panelTitle()).toBe(TRANSLATIONS['label.anchor.close']);
    expect(host().querySelectorAll('form')).toHaveLength(0);
    expect(saveButton()).toBeNull();

    await passGate();
    // Still nothing to fill in: `close` posts a reason, so an empty picker would be a field the tenant has no option for (AAP 0.7.3 row "Client actions").
    fixture.detectChanges();

    expect(host().querySelectorAll('form')).toHaveLength(0);

    await answerTemplate('close');
    fixture.detectChanges();

    // One form: the shared date field, the reason select behind its prompt carrying the tenant's reasons in the server's order, and the legacy submit button.
    expect(host().querySelectorAll('form')).toHaveLength(1);
    expect(host().querySelectorAll('app-date-field input[type="date"]')).toHaveLength(1);
    expect(reasonOptionLabels()).toEqual([
      TRANSLATIONS['label.select'],
      ...REASONS.map((reason) => reason.name),
    ]);
    expect(saveButton()?.textContent?.trim()).toBe(TRANSLATIONS['label.button.save']);
    expect(saveButton()?.disabled).toBe(false);
    // The way back to the record sits on the same row under the legacy cancel caption, and leaving the screen posts nothing, so it is a plain navigation rather than a second command.
    expect(host().querySelector('#cancel')?.textContent?.trim()).toBe(
      TRANSLATIONS['label.button.cancel'],
    );

    // One click posts one command: while the request is in flight the primary button is disabled, so a second click cannot send a second action against a financial record (AAP 0.1.1).
    component.closeForm.controls.closureDate.setValue(CLOSURE_DATE);
    component.closeForm.controls.closureReasonId.setValue(CHOSEN_REASON.id);
    component.submit();
    fixture.detectChanges();

    expect(saveButton()?.disabled).toBe(true);

    httpMock.expectOne(isCommandPost).flush({ resourceId: 2, clientId: 2 });
    await settle();
  });

  /* The permission gate on the submit control.
   * The screen is the third end of one decision: the record gates its lifecycle entry on the command's own code, the `client/:id/:action` route declares that same code, and the button that posts the command asks for it here (AAP 0.1.1). Legacy
   * gated exactly this button and rendered the rest of the form regardless, so the cases below assert the button alone (Rule 1 clause 3). */

  it('hides the submit control from a user who does not hold the command’s code', async () => {
    await show('close', CLIENT_ID, []);
    await passGate();
    await answerTemplate('close');
    fixture.detectChanges();

    expect(host().querySelectorAll('form')).toHaveLength(1);
    expect(host().querySelector('#cancel')).not.toBeNull();
    expect(saveButton()?.style.display).toBe('none');
  });

  it('shows the submit control to a user who holds the command’s code', async () => {
    await show('close');
    await passGate();
    await answerTemplate('close');
    fixture.detectChanges();

    // Visible and enabled: the gate withholds the control rather than disabling it, which is what legacy's `has-permission` does to the same button.
    expect(saveButton()?.style.display).toBe('');
    expect(saveButton()?.disabled).toBe(false);
  });

  it('does not reveal the submit control with another command’s code', async () => {
    // The code of a command this screen is not showing: the record would offer that entry on its own action, and holding it says nothing about a closure (AAP 0.1.1).
    await show('close', CLIENT_ID, [CLIENT_ACTION_PERMISSIONS.activate]);
    await passGate();
    await answerTemplate('close');
    fixture.detectChanges();

    expect(saveButton()?.style.display).toBe('none');
  });

  it.each(REASON_COMMANDS)(
    'requires the %s date and reason, and names each missing one in the message its field projects',
    async (action) => {
      await show(action);
      await passGate();
      await answerTemplate(action);
      fixture.detectChanges();

      const dateInput = host().querySelector<HTMLInputElement>('app-date-field input[type="date"]');
      const reasonSelect = host().querySelector<HTMLSelectElement>('app-select-field select');

      // Both controls carry a rule and both announce it: the date, which Fineract's validator declares `notNull`, and the reason, which the legacy template marks required — so the picker's prompt row is not a choice and the control says as much.
      expect(dateInput).not.toBeNull();
      expect(dateInput?.getAttribute('aria-required')).toBe('true');
      expect(reasonSelect).not.toBeNull();
      expect(reasonSelect?.getAttribute('aria-required')).toBe('true');

      expect(host().querySelectorAll('.help-block[role="alert"]')).toHaveLength(0);

      // The date starts empty and the reason still shows the prompt row, so this is the invalid submit the legacy form refuses.
      component.submit();
      fixture.detectChanges();

      // One message per invalid control, each in the slot its shared field renders after the control and each announcing itself, so a red label and border are no longer the only report (Rule 1 clause 3).
      expect(host().querySelector('#client-action-date-error')?.textContent?.trim()).toBe(
        TRANSLATIONS['label.requiredfield'],
      );
      expect(host().querySelector('#client-action-reason-error')?.textContent?.trim()).toBe(
        TRANSLATIONS['label.requiredfield'],
      );
      expect(host().querySelectorAll('.help-block[role="alert"]')).toHaveLength(2);

      // The invalid form posts nothing: the body Fineract would refuse for its missing reason is never sent, and the screen stays where it is.
      expect(httpMock.match(isCommandPost)).toHaveLength(0);
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  /* The request sequence every command issues, and the body it carries.
   * The cases above pin the states one command reaches; these pin what all five send, because the parity harness compares the ordered traffic rather than the screen, and because the three commands that take a reason, the one that activates and
   * the one that reactivates post different bodies through the same form. */

  it.each(COMMANDS)(
    'issues the gate, then the %s command, once each and in that order',
    async (command) => {
      await show(command);
      await passGate();

      if (isReasonCommand(command)) {
        await answerTemplate(command);
      }

      dateControl(command).setValue(ACTION_DATE);
      // The reason is a required control of the three commands that take one, so a case fills it before submitting — the body the command posts is the one the sequence below counts, and the form is valid.
      reasonControl(command)?.setValue(CHOSEN_REASON.id);
      component.submit();

      httpMock.expectOne(isCommandPost).flush({ resourceId: 2, clientId: 2 });
      await settle();

      // The legacy sequence exactly — the datatable gate first, the reason list next where the command takes one, the command last — and nothing else: no second gate on submit, no second command from one click, no request the legacy screen never makes (AAP 0.7.3, AAP 0.14.1).
      expect(requestSequence()).toEqual(expectedSequence(command));
    },
  );

  it('runs the gate for the client the route named, as the raw segment it delivered', async () => {
    await show('close');

    httpMock.expectOne(isGateRead).flush({
      totalFilteredRecords: 1,
      pageItems: [
        {
          entity: 'm_client',
          status: { id: 600, code: 'statusEnum.status.close', value: 'CLOSE' },
          datatableName: 'client_extra_details',
        },
      ],
    });
    await settle();

    // The gate's second call carries the `:id` segment as the route delivered it — `'2'`, not a parsed copy of it — and asks for the generic result set the legacy controller reads.
    const table = httpMock.expectOne(
      (request) => request.method === 'GET' && request.url.endsWith(CLIENT_SUFFIX),
    );

    expect(table.request.params.get('genericResultSet')).toBe('true');
    expect(requestSequence()).toHaveLength(2);
    expect(requestSequence()[1]).toContain(CLIENT_SUFFIX);

    table.flush({ columnHeaders: [], data: [] });
    await settle();

    await answerTemplate('close');

    expect(component.ready()).toBe(true);
  });

  it('posts the activation date the form holds, and nothing beside it', async () => {
    await showReady('activate');

    dateControl('activate').setValue(ACTION_DATE);
    component.submit();

    const post = httpMock.expectOne(isCommandPost);

    expect(post.request.params.get('command')).toBe('activate');
    // The body the service builds for an activation: the one date format, the active language and the chosen day in that pattern (AAP 0.7.2, Rule 1 clause 2).
    expect(post.request.body).toEqual({
      dateFormat: PAYLOAD_DATE_FORMAT,
      locale: 'en',
      [DATE_BODY_KEY.activate]: ACTION_DATE_AS_PAYLOAD,
    });

    post.flush({ resourceId: 2, clientId: 2 });
    await settle();

    expect(navigate).toHaveBeenCalledWith(RECORD_ROUTE);
  });

  it('posts the reactivation date with no reason and reads no reason list', async () => {
    await showReady('reactivate');

    const [gate] = expectedSequence('reactivate');

    expect(requestSequence()).toEqual([gate]);

    dateControl('reactivate').setValue(ACTION_DATE);
    component.submit();

    const post = httpMock.expectOne(isCommandPost);

    expect(post.request.params.get('command')).toBe('reactivate');
    // The reactivation date and the format pair, and no reason member at all: the day the command takes effect is the whole body (AAP 0.7.2 row `ClientActionRequest`).
    expect(post.request.body).toEqual({
      dateFormat: PAYLOAD_DATE_FORMAT,
      locale: 'en',
      [DATE_BODY_KEY.reactivate]: ACTION_DATE_AS_PAYLOAD,
    });

    post.flush({ resourceId: 2, clientId: 2 });
    await settle();

    expect(navigate).toHaveBeenCalledWith(RECORD_ROUTE);
  });

  it.each(REASON_COMMANDS)(
    "offers the %s reasons in the server's order and posts the option the operator picked",
    async (command) => {
      await showReady(command);

      // One template read, for this command alone: each command's reasons come from its own `commandParam`, so a rejection screen reads the rejection list and no other (AAP 0.7.3 row "Client actions").
      expect(requestSequence().filter((entry) => entry.includes('commandParam'))).toEqual([
        `GET ${relativeUrl(TEMPLATE_URL)}?commandParam=${command}`,
      ]);

      fixture.detectChanges();

      const select = host().querySelector<HTMLSelectElement>('app-select-field select');

      expect(select).not.toBeNull();
      expect(reasonOptionLabels()).toEqual([
        TRANSLATIONS['label.select'],
        ...REASONS.map((reason) => reason.name),
      ]);

      if (select !== null) {
        select.value = select.options[select.options.length - 1].value;
        select.dispatchEvent(new Event('change'));
      }
      fixture.detectChanges();

      expect(reasonControl(command)?.value).toBe(OTHER_REASON.id);

      dateControl(command).setValue(ACTION_DATE);
      component.submit();

      const post = httpMock.expectOne(isCommandPost);

      expect(post.request.params.get('command')).toBe(command);
      expect(post.request.body[REASON_BODY_KEY[command]]).toBe(OTHER_REASON.id);
      expect(post.request.body[DATE_BODY_KEY[command]]).toBe(ACTION_DATE_AS_PAYLOAD);

      post.flush({ resourceId: 2, clientId: 2 });
      await settle();

      expect(navigate).toHaveBeenCalledWith(RECORD_ROUTE);
    },
  );
});
