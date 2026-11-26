import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AbstractControl } from '@angular/forms';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, type ParamMap } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { finalize, firstValueFrom } from 'rxjs';

import { FINERACT_DATE_FORMAT } from '../../../core/config/app-config.model';
import { ApiError, screenFailure, toDisplayableFailure } from '../../../core/http/api-error';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import { fromFineractDate } from '../../../shared/date-format.util';
import { HasPermissionDirective } from '../../../shared/has-permission.directive';
import { PanelCardComponent } from '../../../shared/panel-card/panel-card.component';
import { RecordNotFoundComponent } from '../../../shared/record-not-found/record-not-found.component';
import {
  SelectFieldComponent,
  type SelectOption,
  type SelectValue,
} from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import type { ClientEditRequest, ClientTemplate } from '../client.models';
import { ClientService } from '../client.service';

/** The record members `GET /clients/{id}?template=true` folds in that `ClientTemplate` omits, read here as a documented partial projection of the payload — the members legacy's `EditClientController` seeds its form from — with every member a string so no cell renders `undefined` (Rule 1 clause 3). */
interface ClientRecordFields {
  /** First name as the record holds it; empty for an entity client. */
  readonly firstname: string;
  /** Last name as the record holds it; empty for an entity client. */
  readonly lastname: string;
  /** Entity name as the record holds it, e.g. `'Blitzy Bakery LLC'`; empty for a person. */
  readonly fullname: string;
  /** Bank-assigned external id, or the empty string when the client has none. */
  readonly externalId: string;
  /** Mobile number, or the empty string when the client has none. */
  readonly mobileNo: string;
}

/** The projection of a payload that carried none of those members. */
const NO_RECORD_FIELDS: ClientRecordFields = {
  firstname: '',
  lastname: '',
  fullname: '',
  externalId: '',
  mobileNo: '',
};

/** The payload's own members, read by name as the loosely typed values a response carries. */
type PayloadFields = ReadonlyMap<string, unknown>;

/** Whether a value is a JSON object: the boundary a response body is narrowed at before any member is read by name, which leaves each value `unknown` until it is checked (Rule 1 clause 4). */
function isPayloadRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Indexes a response body by member name, since `Object.entries` types a plain object's values as `any` and a map keeps every read below a checked `unknown`. */
function payloadFields(body: Readonly<Record<string, unknown>>): PayloadFields {
  const entries: readonly (readonly [string, unknown])[] = Object.entries(body);

  return new Map(entries);
}

/** A text member of the payload, or the empty string; a value of another type is treated as absent rather than stringified, since `'[object Object]'` would show text the server never sent (Rule 1 clause 3). */
function textMember(fields: PayloadFields, key: string): string {
  const value = fields.get(key);

  return typeof value === 'string' ? value : '';
}

/** Projects the members this screen seeds from out of the edit read's `GET /clients/{id}?template=true` payload, empty where it omits them. */
function recordFields(payload: ClientTemplate): ClientRecordFields {
  // A response body is untyped at the point it arrives, so it enters the projection as `unknown` and the guard is what narrows it before any member is read.
  const body: unknown = payload;

  if (!isPayloadRecord(body)) {
    return NO_RECORD_FIELDS;
  }

  const fields = payloadFields(body);

  return {
    firstname: textMember(fields, 'firstname'),
    lastname: textMember(fields, 'lastname'),
    fullname: textMember(fields, 'fullname'),
    externalId: textMember(fields, 'externalId'),
    mobileNo: textMember(fields, 'mobileNo'),
  };
}

/** The edit body as this screen builds it: the fields the form owns, with `dateFormat` and `locale` left out because `ClientService.update` replaces both at the API boundary (Rule 1 clause 2). */
type ClientEditFields = Omit<ClientEditRequest, 'dateFormat' | 'locale'>;

/**
 * The pair {@link toEditRequest} merges back to satisfy the model: the one format a date-bearing Fineract payload may carry, read from the configuration's own declaration instead of retyped here, and an empty
 * locale. Neither value reaches the wire — `editWire` writes both from the resolved configuration and the active language at the API boundary (AAP 0.7.2 `AppConfig`; Rule 1 clause 2).
 *
 */
const EDIT_DATE_WIRE = { dateFormat: FINERACT_DATE_FORMAT, locale: '' } as const;

/** Adds or removes the required rule on one control: the legacy edit form's required set depends on the record's legal form and status, and no other rule is ever attached because Fineract decides what is acceptable (Rule 1 clause 3). */
function setRequired(control: AbstractControl, required: boolean): void {
  if (required) {
    control.setValidators(Validators.required);
  } else {
    control.clearValidators();
  }

  // `emitEvent: false`, because no other control's validity depends on this one and the template reads validity on the next render rather than through a value-change subscription.
  control.updateValueAndValidity({ emitEvent: false });
}

/** The edit screen (`#/editclient/:id`) of AAP 0.7.3 "Client list and edit": one `getWithTemplate` seed read and one `update` save through the family's service, one load per navigation, the office and staff row legacy's own form opens with — the office read-only, the officer posted as `staffId` — and legacy's required set with nothing added (AAP 0.8.2; Rule 1 clauses 2, 3 and 5). */
@Component({
  selector: 'app-client-edit',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, DateFieldComponent, SelectFieldComponent, HasPermissionDirective, PanelCardComponent, RecordNotFoundComponent],
  templateUrl: './client-edit.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientEditComponent {
  /** The clients family's one typed Fineract service: the seed read and the save (Rule 1 clause 5). */
  private readonly clients = inject(ClientService);
  /** The activated route, subscribed to for the `:id` of `#/editclient/:id` so the id follows every emission instead of the URL's value at construction. */
  private readonly route = inject(ActivatedRoute);
  /** Navigation only: to the record on success, through the router and never through `location`. */
  private readonly router = inject(Router);

  /** Completes the route subscription, and cancels an outstanding seed read, should the screen be destroyed first. */
  private readonly destroyRef = inject(DestroyRef);

  /** Which load is the current one, incremented by every run of {@link load}: a superseded run writes nothing, so a late answer can neither seed another client's values under this URL nor clear the loading state of the run that replaced it. */
  private loadSequence = 0;

  /** The client the URL currently names, as the route spelled it, fed by `route.paramMap` rather than a `snapshot` read because the router reuses this component on an in-place id change; empty when the route carried none. */
  readonly clientId = signal<string>('');

  /** Whether the seed read is still outstanding. Starts `true` so the form cannot flash empty before the record's values arrive. */
  readonly loading = signal(true);

  /** Whether the record does not exist: the route named no id, or Fineract answered 404. Cleared by {@link reset} on every route emission. */
  readonly notFound = signal(false);

  /** Whether the seed resolved, so the form may be shown; a failed seed leaves it false, since an empty form would post values the user never chose. */
  readonly ready = signal(false);

  /** The message shown above the form: Fineract's own text verbatim from a 4xx {@link ApiError}, or `null` — for a 5xx or transport failure the interceptor has already notified, and whenever nothing has failed; a failed save keeps every entered value in the form (AAP 0.7.4; AAP 0.14.2). */
  readonly error = signal<string | null>(null);

  /** Whether the record is an entity, decided by the name set the payload carries: an entity is named by `fullname` alone and a person by `firstname` and `lastname`, as `validateIndividualNamePartsCannotBeUsedWithFullname` requires. */
  readonly isEntity = signal(false);

  /** Whether the record is active, the condition under which the legacy edit form renders — and the server accepts — an activation date. */
  readonly isActive = signal(false);

  /** The last seed read's payload, or `null` before one resolves: the one source of both option lists, so the dropdowns are the template's own and cost no second read (Rule 1 clause 3). */
  private readonly seeded = signal<ClientTemplate | null>(null);

  /** The offices this screen may show the record filed under, in the template's own order and never filtered, sorted or renamed here, because a Fineract template is the only source of a dropdown's contents (Rule 1 clause 3). */
  readonly officeOptions = computed<readonly SelectOption[]>(
    () => this.seeded()?.officeOptions ?? [],
  );

  /** The loan officers the template offers, each mapped from its `displayName` — the label legacy's picker binds (`staff.id as staff.displayName`) — because a `StaffData` entry carries no `name` (Rule 1 clause 3). */
  readonly staffOptions = computed<readonly SelectOption[]>(() =>
    (this.seeded()?.staffOptions ?? []).map((staff) => ({ id: staff.id, name: staff.displayName })),
  );

  /** The loan officer the record carried when the form was seeded, or `null` when it carried none: {@link editRequest} posts `null` only for an assignment the operator cleared, so an officer this tenant's narrowed staff list omits is still posted back untouched (Rule 1 clause 3). */
  private seededStaffId: number | null = null;

  /**
   * The form: the record's office as a disabled select, its loan officer, the two name sets, the external id, the mobile number and an active record's activation date.
   * Every editable control starts without a validator, since the required set depends on the record (AAP 0.7.2 `ClientEditRequest`; Rule 1 clause 3).
   *
   */
  readonly form = new FormGroup({
    // Display only, exactly legacy's `disabled="disabled"` office select: the update endpoint refuses an officeId, which legacy never posts either, so the value is shown and never sent.
    officeId: new FormControl<SelectValue | null>({ value: null, disabled: true }),
    staffId: new FormControl<SelectValue | null>(null),
    firstname: new FormControl<string>('', { nonNullable: true }),
    lastname: new FormControl<string>('', { nonNullable: true }),
    fullname: new FormControl<string>('', { nonNullable: true }),
    externalId: new FormControl<string>('', { nonNullable: true }),
    mobileNo: new FormControl<string>('', { nonNullable: true }),
    activationDate: new FormControl<Date | null>(null),
  });

  /** One request per click: the save runs inside it and the button binds `guard.busy()`. */
  readonly guard = createSubmitGuard();

  /** Permission the save control is gated on: legacy's own gate on this form's submit button (`has-permission='UPDATE_CLIENT'`, `app/views/clients/editclient.html`), which is also the route's code (AAP 0.1.1). */
  readonly submitPermission = 'UPDATE_CLIENT';

  /** Legacy key of the screen's own title, the legend the legacy form carries. */
  readonly headingKey = 'label.heading.editclient';

  /** Subscribes to the route's parameters, the screen's whole entry point: one subscription, never a `snapshot` read, because Angular reuses the component on an in-place id change and each emission clears the previous client and reads the record the URL now names. */
  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params: ParamMap) => {
        this.clientId.set(params.get('id') ?? '');
        this.reset();
        this.load();
      });
  }

  /** Saves the edited record with one `PUT /clients/{id}` and opens the record: every control marked touched, an invalid form returning before a body is built, and a rejection rendered verbatim with every entered value intact. */
  async submit(): Promise<void> {
    this.form.markAllAsTouched();

    const clientId = this.clientId();

    if (this.form.invalid || clientId.length === 0) {
      return;
    }

    this.error.set(null);

    try {
      await this.guard.runOnce(async () => {
        await firstValueFrom(this.clients.update(clientId, this.editRequest()));
        await this.router.navigate(['/viewclient', clientId]);
      });
    } catch (failure: unknown) {
      this.reportFailure(failure);
    }
  }

  /** Whether a control shows its required message: invalid and either visited or already edited, read from the template because those are plain control properties a computed signal would freeze. */
  protected showsRequiredError(control: AbstractControl): boolean {
    return control.invalid && (control.touched || control.dirty);
  }

  /** The `PUT /clients/{id}` body: exactly one name set, since the server rejects `fullname` beside `firstname` or `lastname`, the contact fields as the controls hold them, the loan officer by {@link staffMember}'s rule, and the activation date only for an active record; never an office, which the endpoint refuses (Rule 1 clauses 2 and 3). */
  editRequest(): ClientEditRequest {
    const value = this.form.getRawValue();
    const shared: ClientEditFields = {
      externalId: value.externalId,
      mobileNo: value.mobileNo,
      ...(this.isActive() ? { activationDate: value.activationDate } : {}),
      ...this.staffMember(value.staffId),
    };

    if (this.isEntity()) {
      return toEditRequest({ ...shared, fullname: value.fullname });
    }

    return toEditRequest({
      ...shared,
      firstname: value.firstname,
      lastname: value.lastname,
    });
  }

  /**
   * The `staffId` member the edit body carries, in the three states the control can be in: a chosen option posts its id — including the record's own, which the seed
   * holds even when the narrowed staff list does not offer it, so an untouched save posts the officer back unchanged; the prompt with an officer seeded over it posts
   * `null`, which is how the fork unassigns one (`ignoreIfNull().longGreaterThanZero()`); and the prompt on a record that had none posts nothing at all, because
   * legacy's `formData` carries an `undefined` `staffId` that JSON drops (Rule 1 clause 3). `officeId` is never built here: the endpoint refuses it.
   *
   */
  private staffMember(chosen: SelectValue | null): Pick<ClientEditRequest, 'staffId'> {
    if (typeof chosen === 'number') {
      return { staffId: chosen };
    }

    return this.seededStaffId === null ? {} : { staffId: null };
  }

  /** Reads the record the URL names once, seeds the form from it and applies the required set: a route naming no client issues no request, a 404 becomes the not-found state, and any other failure leaves `ready` false (AAP 0.7.4). */
  private load(): void {
    const load = ++this.loadSequence;
    const clientId = this.clientId();

    if (clientId.length === 0) {
      // No request is issued for a route that names no client: the not-found branch already points at the message, and `loading` is cleared so the screen can leave its loading state.
      this.notFound.set(true);
      this.loading.set(false);

      return;
    }

    this.clients
      .getWithTemplate(clientId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (load === this.loadSequence) {
            this.loading.set(false);
          }
        }),
      )
      .subscribe({
        next: (payload) => {
          if (load === this.loadSequence) {
            this.seed(payload);
          }
        },
        error: (failure: unknown) => {
          if (load !== this.loadSequence) {
            return;
          }

          if (failure instanceof ApiError && failure.status === 404) {
            this.notFound.set(true);
          } else {
            this.reportFailure(failure);
          }
        },
      });
  }

  /** Seeds the form from the payload: the record's office and officer, the name set the record carries, the two status branches the template renders from, the record's own values, and then the required rules those branches select. */
  private seed(payload: ClientTemplate): void {
    const record = recordFields(payload);
    const officeId = typeof payload.officeId === 'number' ? payload.officeId : null;
    // The record's own assignment, seeded whether or not the narrowed staff list holds it: an untouched save must post the officer the record already had (legacy seeds `formData.staffId = data.staffId`).
    const staffId = typeof payload.staffId === 'number' ? payload.staffId : null;

    this.seeded.set(payload);
    this.seededStaffId = staffId;
    this.isEntity.set(record.fullname !== '');
    this.isActive.set(payload.active === true);
    this.form.setValue({
      officeId,
      staffId,
      firstname: record.firstname,
      lastname: record.lastname,
      fullname: record.fullname,
      externalId: record.externalId,
      mobileNo: record.mobileNo,
      activationDate: fromFineractDate(payload.activationDate),
    });
    this.applyRequiredRules();
    this.ready.set(true);
  }

  /** Clears everything the previous client put on the screen: the form is reset rather than rebuilt because the template binds these control instances, and a reset also returns each control to untouched. */
  private reset(): void {
    this.seeded.set(null);
    this.seededStaffId = null;
    this.isEntity.set(false);
    this.isActive.set(false);
    this.ready.set(false);
    this.error.set(null);
    this.notFound.set(false);
    this.loading.set(true);
    this.form.reset();
  }

  /** Attaches the legacy edit form's required rules to the controls its own branches mark required — the person's first and last names, the entity's name, an active client's activation date — and nothing else (Rule 1 clause 3). */
  private applyRequiredRules(): void {
    const entity = this.isEntity();

    setRequired(this.form.controls.firstname, !entity);
    setRequired(this.form.controls.lastname, !entity);
    setRequired(this.form.controls.fullname, entity);
    setRequired(this.form.controls.activationDate, this.isActive());
  }

  /**
   * Reports a failed seed read or save in the region above the form, once. `screenFailure` answers Fineract's own `defaultUserMessage` verbatim for a 4xx — the text W7
   * compares — and `null` for a 5xx or status-0 failure, which `fineract.interceptor` has already raised as the single notification, so no failure is reported twice
   * (AAP 0.7.4 "States every list and record screen must implement"; AAP 0.14.2). A rejection that is neither — a navigation the router refuses after a successful save
   * — is read through `toDisplayableFailure`, so no `catch` here swallows an error silently (AAP 0.14.1 "errors are values"; AAP 0.14.2).
   *
   */
  private reportFailure(failure: unknown): void {
    if (failure instanceof ApiError || failure instanceof HttpErrorResponse) {
      this.error.set(screenFailure(failure)?.message ?? null);

      return;
    }

    this.error.set(toDisplayableFailure(failure).message);
  }
}

/** Puts the record's own fields back together with the two date-wire members `ClientEditRequest` requires, in the one place this screen adds the pair, which `ClientService.update` then overwrites at the boundary (Rule 1 clause 2). */
function toEditRequest(fields: ClientEditFields): ClientEditRequest {
  return { ...fields, ...EDIT_DATE_WIRE };
}
