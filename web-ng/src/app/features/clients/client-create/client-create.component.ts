import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import type { AbstractControl } from '@angular/forms';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { ApiError, screenFailure, toDisplayableFailure } from '../../../core/http/api-error';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import { fromFineractDate } from '../../../shared/date-format.util';
import {
  SelectFieldComponent,
  type SelectOption,
  type SelectValue,
} from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import type { ClientCreateRequest, ClientMutationResponse, ClientTemplate } from '../client.models';
import { ClientService } from '../client.service';

/**
 * The legal form a client created by this screen carries: 1 is an individual. The server requires
 * the member on every create (`ClientDataValidator.validateForCreate` extracts it with `notNull`),
 * and the field set of this screen fills an individual's name parts, so the value is fixed here
 * rather than offered as a picker whose option list the in-scope template response does not carry.
 */
const INDIVIDUAL_LEGAL_FORM_ID = 1;

/**
 * Local midnight of the browser's current date — the default a form's own date starts from, the way
 * the legacy create form starts from `new Date()`.
 *
 * Built from the local calendar fields rather than from `toISOString()`: the UTC form would name
 * yesterday for every browser east of Greenwich when the page is opened before the UTC day rolls
 * over, and the form would then post a submission date the user never chose. The tenant business
 * date is deliberately not read here; it is the harness's run date, not a form default
 * (AAP 0.10.5 item 15).
 */
function startOfToday(): Date {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * The legacy create form's own name rule, reproduced character for character from the `ng-pattern`
 * the first and last name fields carry (`app/views/clients/createclient.html`): the expression
 * `(^[A-z])[A-z.'-]*` between the slashes of a literal, so a name starts with a letter and continues
 * with letters, full stops, apostrophes and hyphens. The character class is kept exactly as legacy
 * wrote it rather than narrowed to `A-Za-z`, because this rule is copied and not improved (Rule 1
 * clause 3).
 *
 * It is handed to `Validators.pattern` as a `RegExp` and never as a string. AngularJS's `ng-pattern`
 * tested this expression unanchored, so only the start of the value is constrained and a multi-word
 * name such as "Ada Okafor" is valid; `Validators.pattern` given a string wraps it in `^…$`, which
 * would reject every name holding a space, and the same expression passed as a string would
 * additionally demand a literal leading slash.
 */
const LEGACY_NAME_PATTERN = /(^[A-z])[A-z.'-]*/;

/**
 * The legacy create form's own mobile-number rule, reproduced verbatim from the
 * `ng-pattern="/^[0-9]+$/"` the mobile field carries (`app/views/clients/createclient.html`): digits
 * only, so no space, no `+`, no punctuation and no letters. Unlike {@link LEGACY_NAME_PATTERN} this
 * expression anchors both ends because the legacy one does.
 */
const LEGACY_MOBILE_PATTERN = /^[0-9]+$/;

/**
 * The create-client screen (`#/createclient`) — the first half of workflow W2, whose second half is
 * the activation an operator runs from the new record's action group (AAP 0.7.1 Features row
 * `clients`; AAP 0.7.3 row "W2 create and activate client"; AAP 0.7.4 screens; AAP 0.8.2 route
 * `createclient`; AAP 0.11.1 row for this folder).
 *
 * **What it does, in the legacy controller's own order.** It reads `GET /clients/template` once to
 * seed the office and staff pickers and the activation defaults, re-reads it whenever the office
 * changes so the staff list follows that office, and posts `POST /clients` once per click. On
 * success it opens the record it created, which is where activation happens. Both calls go through
 * `ClientService`: this file composes no URL, sets no parameter and injects no HTTP client, because
 * the family's typed service is the single place a Fineract client URL exists (Rule 1 clause 5;
 * AAP 0.14.1 "Every URL literal lives in a service"). It also sets neither of the two wire members
 * a date-bearing body carries for its dates' grammar and language: `ClientService.create` formats the
 * dates and fills both at the boundary from the resolved configuration and the active language, so no
 * screen can post a second date grammar (Rule 1 clause 2; AAP 0.7.2 "Date handling").
 *
 * **Behavioural inheritance (Rule 1 clause 3; AAP 0.4.4 decision 6).** The office, first name, last
 * name and submission date are the only required controls, matching the required set of the legacy
 * form, and the two `ng-pattern` rules that form also carries are carried with them: the name rule on
 * the two name fields ({@link LEGACY_NAME_PATTERN}, reporting
 * `validation.msg.client.name.cannot.start.specialchar.ornumber`) and the numeric rule on the mobile
 * number ({@link LEGACY_MOBILE_PATTERN}, reporting `label.mustbenumeric`), each with its legacy
 * message and each shown under the visited-or-edited condition the legacy `$dirty` guard uses. No
 * rule legacy lacks is added: no second pattern, no length, no range, no trim, no cross-field rule and
 * no confirmation step. The server's own message stays the fallback for anything these rules accept,
 * shown verbatim above the form with every entered value left in place (`defaultUserMessage`; AAP
 * 0.7.4 "server validation messages appear verbatim"). Every option the two pickers render comes from
 * the template response, in the order it arrived. The submitted body carries the control values as
 * they are — numeric office and staff ids stay numbers, no string is trimmed and no empty optional
 * field is turned into a placeholder.
 *
 * **Defaults.** The submission date starts at the browser's local midnight today and is never
 * overwritten by a template read. The active flag and the activation date are seeded from the
 * template on the screen's first parameter-less read alone, the date falling back to today when that
 * template carries no default, as the legacy form's own field does: an office change re-reads the
 * template for the staff list and the option lists alone, the way legacy's `changeOffice` does, so it
 * keeps both the operator's active choice and the date they chose.
 * A form's own date coming from the browser clock is legacy's behaviour and is the registered
 * settlement of the business-date requirement: the tenant business date is authoritative for the
 * harness's seed, inputs and comparisons, not for a form field (AAP 0.10.5 item 15).
 *
 * **Duplicate submissions.** `POST /clients` is not idempotent, so the submit control runs through
 * `createSubmitGuard()`, which refuses a second call while the first is in flight and is bound to
 * the button's disabled state — one click sends exactly one request (AAP 0.1.1; AAP 0.14.1).
 *
 * **What it deliberately does not do.** It reads no route parameter and no query parameter, because
 * route `createclient` declares none and AAP 0.7.3 defines no query contract for this screen, so
 * injecting the route would be dead code (deviation from the folder record, which lists it).
 * The cancel control is a button calling `Router`, not a link directive, which keeps the import set to
 * the four entries the component needs. It raises no notice of its own: `core/http/fineract.interceptor.ts`
 * already raises the single one for a transport fault or a 5xx, so this screen paints a 4xx inline and
 * leaves those to that notification instead of duplicating it (AAP 0.7.4). It renders
 * in the Bootstrap 3 classes the global stylesheet compiles and declares no style of its own
 * (Rule 1 clause 6).
 *
 * One deliberate difference from the legacy markup is recorded rather than silently introduced: the
 * legacy form gates its "Active" row on `ACTIVATE_CLIENT`. This screen is gated once, on
 * `CREATE_CLIENT` for the whole route (AAP 0.8.2), and takes no permission directive of its own, so
 * the box is always rendered; creating a client already active remains a server-authorised act.
 *
 * **Two members this screen supplies that the field set does not show.** `legalFormId` is required
 * by the server on create (`ClientDataValidator.validateForCreate` extracts it with `notNull`), and
 * the scoped screen creates an individual client: the body carries
 * {@link INDIVIDUAL_LEGAL_FORM_ID}, the value legacy keeps in `CreateClientController.clientPersonId`
 * and pairs with the individual name set this form fills. The template's business-name members
 * (`fullname`) and the legal-form picker belong to the entity half of the legacy form, which the
 * in-scope field set does not include.
 *
 * **Translation keys are run-time values.** Every label resolves through `TranslatePipe` from the
 * legacy bundles under `app/global-translations/`, and each key used here was confirmed against the
 * shipped English bundle of that folder: `label.heading.createclient`, `label.input.office`, `label.input.staff`,
 * `label.input.firstname`, `label.input.lastname`, `label.input.externalid`,
 * `label.input.mobilenumber`, `label.input.submittedon`, `label.input.activationdate`,
 * `label.input.active`, `label.menu.selectloanofficer`, `label.requiredfield`,
 * `validation.msg.client.name.cannot.start.specialchar.ornumber`, `label.mustbenumeric`,
 * `label.button.save` and `label.button.cancel`. A key missing from a bundle still cannot reach the
 * user as a raw dotted key: `core/i18n/missing-translation.handler.ts` humanises it.
 */
@Component({
  selector: 'app-client-create',
  imports: [ReactiveFormsModule, TranslatePipe, DateFieldComponent, SelectFieldComponent],
  templateUrl: './client-create.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientCreateComponent {
  /** The clients family's typed Fineract caller: the template read and the create post (Rule 1 clause 5). */
  private readonly clientService = inject(ClientService);

  /** Navigation only — to the created record on success, back to the list on cancel. */
  private readonly router = inject(Router);

  /** One-request-per-click protection for the submit control (AAP 0.1.1; AAP 0.14.1). */
  readonly guard = createSubmitGuard();

  /**
   * The last `GET /clients/template` response, or `null` before the first one resolves. The two
   * option lists are derived from it, so a template re-read for a new office replaces the staff
   * picker's contents with that office's staff.
   */
  readonly clientTemplate = signal<ClientTemplate | null>(null);

  /**
   * The offices the client may be filed under, in the template's own order. Empty until the first
   * template read resolves, and never filtered, sorted or renamed here, because a Fineract template
   * is the only source of a dropdown's contents (Rule 1 clause 3).
   */
  readonly officeOptions = computed<readonly SelectOption[]>(
    () => this.clientTemplate()?.officeOptions ?? [],
  );

  /**
   * The loan officers selectable for the client, in the template's own order. A `staffOptions` entry
   * carries `displayName` and no `name`, and `displayName` is the label the legacy staff dropdown
   * binds (`staff.id as staff.displayName`), so each entry is mapped to the option shape the shared
   * field renders rather than shown blank (`ClientStaffOption`).
   */
  readonly staffOptions = computed<readonly SelectOption[]>(() =>
    (this.clientTemplate()?.staffOptions ?? []).map((staff) => ({
      id: staff.id,
      name: staff.displayName,
    })),
  );

  /**
   * The message shown above the form: Fineract's own text, verbatim, for a 4xx {@link ApiError}, or
   * `null` while there is nothing to report — `null` as well for a 5xx or a transport failure, whose
   * one report is the notification `core/http/fineract.interceptor.ts` raises (AAP 0.7.4). A failed
   * read or submit keeps the screen mounted and every entered value in the form (AAP 0.14.1 "errors
   * are values").
   */
  readonly error = signal<string | null>(null);

  /**
   * The form, built from explicit controls so `strictTemplates` matches the shared fields' input
   * types and so every control's value type is known: the office and staff ids are
   * `SelectValue | null` (what a `SelectFieldComponent` writes), the names and codes are
   * non-nullable strings, and the two dates are `Date | null` (Rule 1 clause 4; AAP 0.7.2
   * "Date handling").
   *
   * The rules are the legacy form's own and nothing else: `officeId`, `firstname`, `lastname` and
   * `submittedOnDate` carry `Validators.required`, the two name fields add
   * {@link LEGACY_NAME_PATTERN} and the mobile number adds {@link LEGACY_MOBILE_PATTERN} (Rule 1
   * clause 3; AAP 0.4.4 decision 6). No length, range, trim or cross-field validator is attached, and
   * the server's own message stays the answer for anything these rules accept.
   */
  readonly form = new FormGroup({
    officeId: new FormControl<SelectValue | null>(null, Validators.required),
    staffId: new FormControl<SelectValue | null>(null),
    firstname: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(LEGACY_NAME_PATTERN)],
    }),
    lastname: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(LEGACY_NAME_PATTERN)],
    }),
    externalId: new FormControl<string>('', { nonNullable: true }),
    mobileNo: new FormControl<string>('', {
      nonNullable: true,
      validators: Validators.pattern(LEGACY_MOBILE_PATTERN),
    }),
    submittedOnDate: new FormControl<Date | null>(startOfToday(), Validators.required),
    activationDate: new FormControl<Date | null>(null),
    active: new FormControl<boolean>(false, { nonNullable: true }),
  });

  /**
   * Whether the client is to be created active, as a signal: the template renders the activation
   * date field from it, and this view is zoneless `OnPush`, so a plain read of the control's value
   * would not re-render when the box is ticked. Declared after {@link form}, whose control the
   * initial value comes from.
   */
  readonly isActive = toSignal(this.form.controls.active.valueChanges, {
    initialValue: this.form.controls.active.value,
  });

  /**
   * The office whose template is currently applied, or `null` before the first read resolves. It is
   * what makes the office subscription fire once per real change: the seeded value is written with
   * `emitEvent: false` and this field records it, so the initial read cannot trigger a second one.
   */
  private loadedOfficeId: SelectValue | null = null;

  /**
   * Reads the template once for the defaults, then again whenever the office control changes to a
   * different office — the legacy form's own sequence, whose office change re-reads the template
   * with the new office and the staff narrowing (AAP 0.7.3 row "W2 create and activate client").
   *
   * The subscription is tied to the component's lifetime with `takeUntilDestroyed`, taken in the
   * constructor because that is an injection context.
   */
  constructor() {
    this.form.controls.officeId.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((officeId) => {
        // A control holds `SelectValue | null`; neither a cleared office nor a re-seeded one is a
        // change worth a request, and Fineract's office ids are numbers.
        if (typeof officeId !== 'number' || officeId === this.loadedOfficeId) {
          return;
        }

        void this.loadTemplate(officeId, true);
      });

    void this.loadTemplate();
  }

  /**
   * Submits the form — the screen's only path to `POST /clients`.
   *
   * The order is the contract: every control is marked touched so the required markers render, an
   * invalid form returns before any request is built (Fineract alone decides what is acceptable, so
   * an entry this screen cannot judge still reaches the server), the previous message is cleared,
   * and the post runs inside the submit guard so a second click while the first is in flight sends
   * nothing (AAP 0.1.1; AAP 0.14.1).
   *
   * A rejection is reported, never thrown away: the guard rethrows, so a 4xx is caught here and shown
   * verbatim while every entered value stays in the form, and a 5xx or a transport failure is left to
   * the interceptor's one notification (AAP 0.7.4; AAP 0.14.2). The record the server created is
   * opened on success, which is where W2's activation step runs.
   */
  async submit(): Promise<void> {
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      return;
    }

    this.error.set(null);

    try {
      await this.guard.runOnce(async () => {
        const request = this.createRequest();

        if (request === null) {
          return;
        }

        const response: ClientMutationResponse = await firstValueFrom(
          this.clientService.create(request),
        );

        await this.router.navigate(['/viewclient', response.clientId ?? response.resourceId]);
      });
    } catch (error: unknown) {
      this.reportFailure(error);
    }
  }

  /**
   * Leaves the screen without creating anything, returning to the list the create form was opened
   * from — the legacy form's `cancel` target (`#/clients`).
   */
  cancel(): void {
    void this.router.navigate(['/clients']);
  }

  /**
   * Whether a control shows its error state at all: invalid, and either visited or already edited —
   * the predicate the two shared fields apply to their own `.has-error` state, so every field of the
   * form reports under the same rule and nothing is shown before the control is visited or edited.
   *
   * Read from the template rather than held in a signal, because `invalid`, `touched` and `dirty` are
   * plain properties of a control: a computed signal would keep the first verdict for ever.
   */
  protected showsError(control: AbstractControl): boolean {
    return control.invalid && (control.touched || control.dirty);
  }

  /**
   * Whether a control shows the legacy required message (`label.requiredfield`): it holds no value and
   * has been visited or edited. Told apart from the pattern message below so a field carrying both
   * rules reports the one that applies rather than both at once.
   */
  protected showsRequiredError(control: AbstractControl): boolean {
    return control.hasError('required') && (control.touched || control.dirty);
  }

  /**
   * Whether a control shows the legacy pattern message it carries — the name rule's
   * `validation.msg.client.name.cannot.start.specialchar.ornumber` or the mobile rule's
   * `label.mustbenumeric` — under the same visited-or-edited condition the legacy `$dirty` guard uses
   * (Rule 1 clause 3).
   */
  protected showsPatternError(control: AbstractControl): boolean {
    return control.hasError('pattern') && (control.touched || control.dirty);
  }

  /**
   * The id of the message a control is currently showing, or `null` when it shows none, so
   * `aria-describedby` names exactly the one element on screen instead of both of a field's messages.
   *
   * @param control the control whose messages are read.
   * @param requiredId the id of its required message element.
   * @param patternId the id of its legacy pattern message element.
   */
  protected errorMessageId(
    control: AbstractControl,
    requiredId: string,
    patternId: string,
  ): string | null {
    if (this.showsRequiredError(control)) {
      return requiredId;
    }

    return this.showsPatternError(control) ? patternId : null;
  }

  /**
   * Reads the template and applies it to the form (AAP 0.7.3 row "W2 create and activate client").
   *
   * Called with no office for the screen's first read, which sends no parameter at all and lets the
   * template's own default office be the form's starting office; called with an office and the staff
   * narrowing when the office control changes, which is the call the legacy form makes on the same
   * event. Beyond the option lists, an office change clears the staff choice alone; the submission
   * date is left alone on every read, so the browser-clock default survives a template read.
   *
   * The office and staff controls are written with `emitEvent: false` so applying a template cannot
   * re-enter the office subscription and issue a second read. The staff choice is cleared because the
   * list that carried it has been replaced by the new office's list. The active flag and the
   * activation date are seeded from the first parameter-less read alone — the flag from the template's
   * own default, the date likewise, falling back to the browser's today when the template carries
   * none, which is the date the legacy form's own activation field starts on and the one the server
   * requires once the client is created active. The flag is written with its events so the view that
   * renders the activation date field follows it. An office change re-reads the template for the staff
   * list and the option lists alone, the way the legacy controller's `changeOffice` does, so it
   * neither re-applies that office's active default nor overwrites a date the operator has chosen.
   *
   * @param officeId the office the form selected; omitted on the first read.
   * @param staffInSelectedOfficeOnly whether the staff list is limited to that office, which the
   *   form sends with every office it reads a template for.
   */
  private async loadTemplate(officeId?: number, staffInSelectedOfficeOnly?: boolean): Promise<void> {
    try {
      const template: ClientTemplate =
        officeId === undefined
          ? await firstValueFrom(this.clientService.template())
          : await firstValueFrom(this.clientService.template(officeId, staffInSelectedOfficeOnly ?? true));

      this.loadedOfficeId = template.officeId ?? officeId ?? null;
      this.clientTemplate.set(template);
      this.form.controls.officeId.setValue(this.loadedOfficeId, { emitEvent: false });
      this.form.controls.staffId.setValue(null, { emitEvent: false });

      // Seeded from the first template read alone: an office change re-reads the template for the
      // staff list and the option lists, so it keeps the operator's own active choice and the
      // activation date they have already chosen — the way legacy's `changeOffice`, which refreshes
      // only the staff list and the saving-product options, touches neither.
      if (officeId === undefined) {
        this.form.controls.active.setValue(template.active ?? false);
        this.form.controls.activationDate.setValue(
          fromFineractDate(template.activationDate) ?? startOfToday(),
        );
      }
    } catch (error: unknown) {
      this.reportFailure(error);
    }
  }

  /**
   * The `POST /clients` body, built from the form's raw values.
   *
   * Every value is passed as the control holds it: the numeric ids stay numbers, and no string is
   * trimmed, defaulted or rewritten. An optional field the operator left empty therefore goes out as
   * the empty string the control holds; the server treats a blank `externalId` or `mobileNo` as an
   * absent value, which was confirmed against the fork before this body was fixed (two creates with a
   * blank `externalId` both succeeded, and a blank `mobileNo` did not fail the number pattern).
   * Neither of the two members that carry a payload's date grammar and language is set here —
   * `ClientService.create` fills both at the boundary (Rule 1 clause 2).
   *
   * The activation date is present only for a client created active: Fineract rejects the pair
   * "inactive with an activation date", and an omitted member leaves the server to decide, which is
   * how the tenant's own seeded inactive clients are created.
   *
   * @returns the body to post, or `null` when the office control holds no numeric id — a state the
   *   required validator and the template's numeric office ids between them rule out, reported
   *   rather than posted as a made-up id.
   */
  private createRequest(): ClientCreateRequest | null {
    const value = this.form.getRawValue();
    const officeId = typeof value.officeId === 'number' ? value.officeId : null;

    if (officeId === null) {
      return null;
    }

    return {
      officeId,
      staffId: typeof value.staffId === 'number' ? value.staffId : undefined,
      legalFormId: INDIVIDUAL_LEGAL_FORM_ID,
      firstname: value.firstname,
      lastname: value.lastname,
      externalId: value.externalId,
      mobileNo: value.mobileNo,
      submittedOnDate: value.submittedOnDate,
      active: value.active,
      activationDate: value.active ? value.activationDate : undefined,
    };
  }

  /**
   * Shows a failed read or submit as the message above the form, for the failures the screen owns.
   *
   * An HTTP answer is classified by its status rather than by its type. The shared `screenFailure`
   * publishes Fineract's own `defaultUserMessage` verbatim for a 4xx, which is the text workflow W7
   * compares character for character (AAP 0.7.2 row `FineractError`), and answers `null` for a 5xx or
   * a status-0 transport failure: `core/http/fineract.interceptor.ts` has already raised the single
   * notification for those, so painting them here too would report one failure twice, and Angular's
   * own `HttpErrorResponse.message` — which embeds the request URL — never reaches the screen
   * (AAP 0.7.4). A rejection that is no HTTP answer at all, such as a navigation the router refuses
   * after a successful create, keeps its own message through the shared fallback instead of being
   * swallowed (AAP 0.14.2 "no catch swallows an error silently").
   *
   * @param error the rejection the awaited call produced.
   */
  private reportFailure(error: unknown): void {
    if (error instanceof ApiError || error instanceof HttpErrorResponse) {
      this.error.set(screenFailure(error)?.message ?? null);
      return;
    }

    this.error.set(toDisplayableFailure(error).message);
  }
}
