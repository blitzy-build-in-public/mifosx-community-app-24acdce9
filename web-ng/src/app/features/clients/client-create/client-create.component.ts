import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import type { AbstractControl } from '@angular/forms';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { ApiError } from '../../../core/http/api-error';
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
 * form; nothing here adds a pattern, a length, a range, a trim, a cross-field rule or a
 * confirmation step. The legacy form's own `ng-pattern` rules on the two name fields and the mobile
 * number are not carried over either: the server applies the same constraints and refuses the entry
 * with its own message, which is the wording this screen shows, so the rejection still happens while
 * there is one copy of the rule rather than two that can disagree. Every option the two pickers
 * render comes from the template response, in the
 * order it arrived, and a failure shows Fineract's own `defaultUserMessage` verbatim above the form
 * with every entered value left in place (AAP 0.7.4 "server validation messages appear verbatim").
 * The submitted body carries the control values as they are — numeric office and staff ids stay
 * numbers, no string is trimmed and no empty optional field is turned into a placeholder.
 *
 * **Defaults.** The submission date starts at the browser's local midnight today and is never
 * overwritten by a template read; the active flag and the activation date start from the template,
 * the activation date falling back to today when the template carries no default, as the legacy
 * form's own field does.
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
 * already raises the single one for a transport fault or a 5xx, and this screen shows the mapped
 * message inline instead of duplicating it (Rule 1 clause 9). It renders in the Bootstrap 3 classes
 * the global stylesheet compiles and declares no style of its own (Rule 1 clause 6).
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
 * `label.input.active`, `label.menu.selectloanofficer`, `label.requiredfield`, `label.button.save`
 * and `label.button.cancel`. A key missing from a bundle still cannot reach the user as a raw dotted
 * key: `core/i18n/missing-translation.handler.ts` humanises it.
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
   * The message shown above the form: Fineract's own text, verbatim, from an {@link ApiError}, or
   * `null` while there is nothing to report. A failed read or submit keeps the screen mounted and
   * every entered value in the form (AAP 0.7.4; AAP 0.14.1 "errors are values").
   */
  readonly error = signal<string | null>(null);

  /**
   * The form, built from explicit controls so `strictTemplates` matches the shared fields' input
   * types and so every control's value type is known: the office and staff ids are
   * `SelectValue | null` (what a `SelectFieldComponent` writes), the names and codes are
   * non-nullable strings, and the two dates are `Date | null` (Rule 1 clause 4; AAP 0.7.2
   * "Date handling").
   *
   * Only `officeId`, `firstname`, `lastname` and `submittedOnDate` carry `Validators.required`, the
   * legacy form's required set. No other rule is attached: no pattern, length, range, trim or
   * cross-field validator, because Fineract alone decides what a client needs and its message is
   * what the user reads (Rule 1 clause 3; AAP 0.4.4 decision 6).
   */
  readonly form = new FormGroup({
    officeId: new FormControl<SelectValue | null>(null, Validators.required),
    staffId: new FormControl<SelectValue | null>(null),
    firstname: new FormControl<string>('', { nonNullable: true, validators: Validators.required }),
    lastname: new FormControl<string>('', { nonNullable: true, validators: Validators.required }),
    externalId: new FormControl<string>('', { nonNullable: true }),
    mobileNo: new FormControl<string>('', { nonNullable: true }),
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
   * A rejection is rendered, never thrown away: the guard rethrows, so the mapped Fineract message
   * is caught here and shown verbatim while every entered value stays in the form (AAP 0.7.4). The
   * record the server created is opened on success, which is where W2's activation step runs.
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
   * Whether a control shows its required message: invalid, and either visited or already edited —
   * the predicate the two shared fields apply to their own `.has-error` state, so every field of the
   * form reports a missing value under the same rule.
   *
   * Read from the template rather than held in a signal, because `invalid`, `touched` and `dirty` are
   * plain properties of a control: a computed signal would keep the first verdict for ever.
   */
  protected showsRequiredError(control: AbstractControl): boolean {
    return control.invalid && (control.touched || control.dirty);
  }

  /**
   * Reads the template and applies it to the form (AAP 0.7.3 row "W2 create and activate client").
   *
   * Called with no office for the screen's first read, which sends no parameter at all and lets the
   * template's own default office be the form's starting office; called with an office and the staff
   * narrowing when the office control changes, which is the call the legacy form makes on the same
   * event. Nothing else is cleared or set, and the submission date is left alone so the browser-clock
   * default survives a template read.
   *
   * The office and staff controls are written with `emitEvent: false` so applying a template cannot
   * re-enter the office subscription and issue a second read. The staff choice is cleared because the
   * list that carried it has been replaced by the new office's list. The active flag is written
   * normally, because the template's own default has to reach the view that renders the activation
   * date field, and the activation date falls back to the browser's today when the template carries
   * no default — the date the legacy form's own activation field starts on, and the one the server
   * requires once the client is created active.
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
      this.form.controls.active.setValue(template.active ?? false);
      this.form.controls.activationDate.setValue(
        fromFineractDate(template.activationDate) ?? startOfToday(),
      );
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
   * Shows a failed read or submit as the message above the form.
   *
   * The text is the mapped Fineract message verbatim, which is what the interceptor produces for
   * every failed response (AAP 0.7.2 row `FineractError`; workflow W7). Anything else reaching here
   * is not an API failure at all — a bug in the navigation that follows the post, for instance — so
   * its own `message` is shown rather than invented copy; a value that is neither reports nothing,
   * which still leaves the form usable.
   *
   * @param error the rejection the awaited call produced.
   */
  private reportFailure(error: unknown): void {
    if (error instanceof ApiError) {
      this.error.set(error.message);
      return;
    }

    this.error.set(error instanceof Error ? error.message : '');
  }
}
