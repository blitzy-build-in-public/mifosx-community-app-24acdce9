import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AbstractControl } from '@angular/forms';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, type ParamMap } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { finalize, firstValueFrom } from 'rxjs';

import { ApiError } from '../../../core/http/api-error';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import { fromFineractDate } from '../../../shared/date-format.util';
import { HasPermissionDirective } from '../../../shared/has-permission.directive';
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

/** The pair {@link toEditRequest} merges back to satisfy the model: the contract's one pattern, `'dd MMMM yyyy'`, and an empty locale neither value of which reaches the wire, since `editWire` writes both from the configuration (AAP 0.1.1; Rule 1 clause 2). */
const EDIT_DATE_WIRE = { dateFormat: 'dd MMMM yyyy', locale: '' } as const;

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

/** The edit screen (`#/editclient/:id`) of AAP 0.7.3 "Client list and edit": one `getWithTemplate` seed read and one `update` save through the family's service, one load per navigation, and legacy's required set with nothing added (AAP 0.8.2; Rule 1 clauses 2, 3 and 5). */
@Component({
  selector: 'app-client-edit',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, DateFieldComponent, HasPermissionDirective],
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

  /** The message shown above the form: Fineract's own text verbatim from an {@link ApiError}, or `null`; a failed save keeps every entered value in the form (AAP 0.7.4). */
  readonly error = signal<string | null>(null);

  /** Whether the record is an entity, decided by the name set the payload carries: an entity is named by `fullname` alone and a person by `firstname` and `lastname`, as `validateIndividualNamePartsCannotBeUsedWithFullname` requires. */
  readonly isEntity = signal(false);

  /** Whether the record is active, the condition under which the legacy edit form renders — and the server accepts — an activation date. */
  readonly isActive = signal(false);

  /** The form: the two name sets, the external id, the mobile number and an active record's activation date. Every control starts without a validator, since the required set depends on the record (AAP 0.7.2 `ClientEditRequest`; Rule 1 clause 3). */
  readonly form = new FormGroup({
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

  /** Legacy key of the not-found heading, the same one the unknown-path screen renders. */
  readonly notFoundHeadingKey = 'label.heading.notavailable';

  /** Legacy key of the not-found sentence, worded as the platform words a missing resource. */
  readonly notFoundMessageKey = 'error.msg.resource.not.found';

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

  /** The `PUT /clients/{id}` body: exactly one name set, since the server rejects `fullname` beside `firstname` or `lastname`, the contact fields as the controls hold them, and the activation date only for an active record (Rule 1 clause 2). */
  editRequest(): ClientEditRequest {
    const value = this.form.getRawValue();
    const shared: ClientEditFields = {
      externalId: value.externalId,
      mobileNo: value.mobileNo,
      ...(this.isActive() ? { activationDate: value.activationDate } : {}),
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
          // Only the current run owns the loading state: a superseded one must not clear the flag the newer read set, or the screen would stop reporting that it is still filling.
          if (load === this.loadSequence) {
            this.loading.set(false);
          }
        }),
      )
      .subscribe({
        next: (payload) => {
          // A superseded client's answer is dropped here rather than seeded under the client the URL now names.
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

  /** Seeds the form from the payload: the name set the record carries, the two status branches the template renders from, the record's own values, and then the required rules those branches select. */
  private seed(payload: ClientTemplate): void {
    const record = recordFields(payload);

    this.isEntity.set(record.fullname !== '');
    this.isActive.set(payload.active === true);
    this.form.setValue({
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

  /** Shows a failed seed or save as the message above the form: the mapped Fineract message verbatim (AAP 0.7.2 `FineractError`; W7), else the rejection's own message so nothing is swallowed, and nothing when it carries none. */
  private reportFailure(failure: unknown): void {
    if (failure instanceof ApiError) {
      this.error.set(failure.message);

      return;
    }

    this.error.set(failure instanceof Error ? failure.message : '');
  }
}

/** Puts the record's own fields back together with the two date-wire members `ClientEditRequest` requires, in the one place this screen adds the pair, which `ClientService.update` then overwrites at the boundary (Rule 1 clause 2). */
function toEditRequest(fields: ClientEditFields): ClientEditRequest {
  return { ...fields, ...EDIT_DATE_WIRE };
}
