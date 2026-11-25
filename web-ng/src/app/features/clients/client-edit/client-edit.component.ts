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

/**
 * The client's own record members that `GET /clients/{id}?template=true` carries and
 * `ClientTemplate` in `../client.models.ts` does not declare.
 *
 * The family's model module models the template — the office and staff option lists, the activation
 * default and the `active` flag — and stops there, while the same response folds the client's own
 * values in: legacy's `EditClientController` seeds its form from exactly these members of this call
 * (`data.firstname`, `data.lastname`, `data.fullname`, `data.externalId`, `data.mobileNo`). They are
 * therefore read here as a documented partial projection of that payload rather than added to the
 * model module, which this folder does not own — the precedent is
 * `features/loans/loan-edit/loan-edit.component.ts`, which reads `GET /loans/{id}?template=true`
 * members its own model omits the same way.
 *
 * Every member is a plain string, empty when the payload does not carry it, so a form seeded from a
 * projection can never hold `undefined` and no cell can render one (Rule 1 clause 3).
 */
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

/**
 * Whether a value is a JSON object, the only shape any member this file reads arrives in.
 *
 * The guard is the boundary the projection needs: a response body is `unknown` at the point a
 * member is read by name, and this is what narrows it to a record whose values are still `unknown`
 * until each is checked (Rule 1 clause 4).
 *
 * @param value any value a response member holds.
 * @returns true when the value can be indexed by member name.
 */
function isPayloadRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Indexes a response body by member name, so the members {@link ClientRecordFields} projects can be
 * read as `unknown` one at a time instead of through a cast.
 *
 * `Object.entries` types a plain object's values as `any`; widening the pairs into a map keeps every
 * read below a checked `unknown`, which is the same boundary `loan-edit.component.ts` uses for the
 * loan template's own extra members.
 *
 * @param body the response body, already narrowed to a record by {@link isPayloadRecord}.
 * @returns its members by name.
 */
function payloadFields(body: Readonly<Record<string, unknown>>): PayloadFields {
  const entries: readonly (readonly [string, unknown])[] = Object.entries(body);

  return new Map(entries);
}

/**
 * A text member of the payload, or the empty string when it carries none.
 *
 * A value of another type is treated as absent rather than stringified: a number or an object in a
 * name field is a payload this screen cannot represent, and `''` seeds an empty control the operator
 * can fill, while `'undefined'` or `'[object Object]'` would show text the server never sent
 * (Rule 1 clause 3).
 *
 * @param fields the payload's members by name.
 * @param key the member to read.
 * @returns the member's text, or `''`.
 */
function textMember(fields: PayloadFields, key: string): string {
  const value = fields.get(key);

  return typeof value === 'string' ? value : '';
}

/**
 * Projects the members this screen seeds from out of the edit read's payload.
 *
 * @param payload the `GET /clients/{id}?template=true` response.
 * @returns the client's own name and contact values, empty where the payload omits them.
 */
function recordFields(payload: ClientTemplate): ClientRecordFields {
  // A response body is untyped at the point it arrives, so it enters the projection as `unknown` and
  // the guard is what narrows it before any member is read.
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

/**
 * The edit body as this screen builds it: the fields the form owns, with the two date-wire members
 * left out.
 *
 * `ClientEditRequest` declares `dateFormat` and `locale` on every body, and
 * `ClientService.update` replaces both at the API boundary from the resolved configuration and the
 * active language (`editWire` spreads its own pair before the record's members). A screen has no
 * business asserting either, so it composes the record's own fields here and the one merge in
 * {@link toEditRequest} puts the pair back, in one place, to satisfy the model.
 */
type ClientEditFields = Omit<ClientEditRequest, 'dateFormat' | 'locale'>;

/**
 * The `dateFormat` and `locale` pair every date-bearing body carries, as the merge below supplies
 * it.
 *
 * `dateFormat` is the contract's one pattern, `'dd MMMM yyyy'`, which `AppConfig.dateFormat` is
 * typed to and never varies, so the literal here cannot disagree with the configuration. `locale`
 * is left empty on purpose: the language a payload carries is the user's selected language, which
 * this component does not own and `ClientService.update` reads from `AppConfigService.activeLocale`
 * for every call, so nothing here claims a language it cannot know (AAP 0.1.1 date discipline;
 * Rule 1 clause 2). Neither value reaches the wire: `editWire` writes both from the configuration.
 */
const EDIT_DATE_WIRE = { dateFormat: 'dd MMMM yyyy', locale: '' } as const;

/**
 * Adds or removes the required rule on one control, which is how a validation set that depends on
 * the record is applied.
 *
 * The legacy edit form's required set is not fixed: its office, first name, last name, entity name
 * and activation date are marked `required` in the branches its legal form and status select
 * (`app/views/clients/editclient.html`), so the controls that carry the rule exist only in those
 * branches. This screen holds one form, so it attaches the same rules to the same controls once the
 * payload has said which branches apply — and no other rule is ever attached, because Fineract is
 * what decides whether an entry is acceptable (Rule 1 clause 3; AAP 0.4.4 decision 6).
 *
 * @param control the control whose rule is being set.
 * @param required whether the record's own state makes the control required.
 */
function setRequired(control: AbstractControl, required: boolean): void {
  if (required) {
    control.setValidators(Validators.required);
  } else {
    control.clearValidators();
  }

  // `emitEvent: false`, because no other control's validity depends on this one and the template
  // reads validity on the next render rather than through a value-change subscription.
  control.updateValueAndValidity({ emitEvent: false });
}

/**
 * The edit-client screen — `#/editclient/:id`, the client half of AAP 0.7.3's "Client list and edit"
 * row and one of the two route targets the clients feature previously lacked (AAP 0.7.1 Features row
 * `clients`; AAP 0.8.2 feature route `editclient/:id`).
 *
 * **One seed read, one save, both owned by the family's service.** The screen reads
 * `ClientService.getWithTemplate(id)` — `GET /clients/{id}?template=true` — to seed the form and
 * posts `ClientService.update(id, body)` — `PUT /clients/{id}` — on save. It holds no URL, host, API
 * path, query parameter, HTTP method or HTTP client: the family's typed service composes all of
 * them (Rule 1 clauses 2 and 5; AAP 0.14.1 "Every URL literal lives in a service").
 *
 * **One id, one load per navigation.** The `:id` is read from `route.paramMap`, never from the
 * snapshot: the router reuses this component when the URL moves from one `#/editclient/{id}` to
 * another, so every emission clears the previous client's seeded form, name-set branches, message and
 * readiness and re-reads the record the URL now names — the pattern `loan-edit.component.ts` records
 * as "one id, one load per navigation". Because two reads can then be in flight, an answer that
 * arrives after the URL moved on is discarded rather than applied, so one client's values can never
 * be edited under another client's URL (see {@link loadSequence}).
 *
 * **The field set is exactly what the model can post, plus the two members legacy shows.** The
 * controls are the two name sets (`firstname`/`lastname` for a person, `fullname` for an entity —
 * one of them rendered at a time, as legacy's `ng-switch` on the legal form does), `externalId`,
 * `mobileNo` and the activation date of an active client, and every rendered control posts: the
 * office and account-number fields the legacy template also draws are absent because the update
 * endpoint refuses `officeId` and the model carries neither (AAP 0.7.2 row `ClientEditRequest`;
 * `client.models.ts`), and the staff, gender, client-type, classification and non-person detail
 * controls are absent because `ClientEditRequest` declares none of them. Nothing rendered is
 * unposted and nothing posted is undeclared.
 *
 * **Dates stay `Date | null`.** The activation date control holds a `Date`, seeded through
 * `fromFineractDate` from the record's own `FineractDate`, and `ClientService.update` serialises it
 * with `dateFormat` and the active locale at the boundary — this file formats no date and reads no
 * clock (AAP 0.7.2 "Date handling"; AAP 0.14.1). The date is posted only for an active client,
 * which is the legacy controller's own condition (`choice === 1`): Fineract rejects the pair
 * "inactive with an activation date", and a form field the record does not have must not invent one.
 *
 * **Behavioural inheritance (Rule 1 clause 3).** The required set is legacy's own — the person's
 * first and last names, the entity's name and an active client's activation date — and no pattern,
 * length, range or trim is added: the server applies the constraints it applied to legacy, and its
 * `defaultUserMessage` is what the screen shows verbatim above the form with every entered value
 * still in place (AAP 0.7.4; AAP 0.14.1 "errors are values"). Success navigates to
 * `#/viewclient/:id` through the router, never through `location` (AAP 0.14.1), which is the
 * legacy controller's `location.path('/viewclient/' + id)`; cancel returns there without posting.
 *
 * **One request per click.** `PUT /clients/{id}` is not idempotent, so the save runs through
 * `createSubmitGuard()`, whose `busy` signal disables the button while the call is in flight
 * (AAP 0.1.1; AAP 0.14.1).
 *
 * **States.** While the seed is outstanding nothing is painted; a 404 or a route with no id paints
 * the not-found message in place of the form; any other failure paints the mapped message and, when
 * the seed is what failed, leaves no form to edit because there is nothing to seed it from. A failed
 * *save* leaves the form and its values on screen, which is the case AAP 0.7.4 requires the state to
 * survive. The save control is gated on `UPDATE_CLIENT`, legacy's own gate on this form's submit
 * button, so the button and the route that serves it ask for the same code.
 *
 * **Presentation.** Every visual value comes from the global Bootstrap 3 layer in
 * `web-ng/src/styles.scss`, so this component declares no stylesheet, no inline style and no colour,
 * and the field ids are the legacy form's own so the parity harness addresses the same controls on
 * both applications (Rule 1 clause 6; AAP 0.5.2). Nothing is logged: no client id, no body and no
 * credential reaches the console (Rule 1 clause 9).
 */
@Component({
  selector: 'app-client-edit',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, DateFieldComponent, HasPermissionDirective],
  templateUrl: './client-edit.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientEditComponent {
  /** The clients family's one typed Fineract service: the seed read and the save (Rule 1 clause 5). */
  private readonly clients = inject(ClientService);

  /**
   * The activated route, subscribed to for the `:id` of `#/editclient/:id` so the id follows every
   * emission instead of the value the URL held when the component was built.
   */
  private readonly route = inject(ActivatedRoute);

  /** Navigation only: to the record on success, through the router and never through `location`. */
  private readonly router = inject(Router);

  /**
   * Completes the route subscription, and cancels an outstanding seed read, should the screen be
   * destroyed before either settles.
   */
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Which load is the current one, incremented by every run of {@link load}.
   *
   * The router reuses this component when the URL moves from one `#/editclient/{id}` to another, so an
   * in-place move starts a second read while the first can still be in flight and the earlier one can
   * answer last. A superseded run compares its own number with this one when its answer arrives and
   * writes nothing, so a late response can neither seed the earlier client's values under the later
   * client's URL nor clear the loading state of the run that replaced it — the guard
   * `loan-edit.component.ts` keeps over its own load sequence.
   */
  private loadSequence = 0;

  /**
   * The client the URL currently names, as the route spelled it: the `:id` of `#/editclient/:id`.
   * Empty when the route carried none, which is the only case in which the seed read is not issued.
   *
   * A signal fed by `route.paramMap`, never a `snapshot` read: the router reuses this component when
   * the URL moves from one edit route to another, so the id has to follow every emission and every
   * reader of it — the seed read, the save and the Cancel link — has to see the record the URL names
   * now (`loan-edit.component.ts`, "one id, one load per navigation").
   */
  readonly clientId = signal<string>('');

  /**
   * Whether the seed read is still outstanding. Starts `true` so the form cannot flash empty before
   * the record's values arrive, and is cleared once the read settles, whichever way it settles.
   */
  readonly loading = signal(true);

  /**
   * Whether the record does not exist: the route named no id, or Fineract answered 404. Cleared by
   * {@link reset} on every route emission, so it always describes the URL the screen is showing.
   */
  readonly notFound = signal(false);

  /**
   * Whether the seed resolved, so the form may be shown. A failed seed leaves it false: there is
   * nothing to edit, and an empty form would post values the user never chose.
   */
  readonly ready = signal(false);

  /**
   * The message shown above the form: Fineract's own text, verbatim, from an {@link ApiError}, or
   * `null` while there is nothing to report. A failed save keeps the screen mounted and every
   * entered value in the form (AAP 0.7.4; AAP 0.14.1 "errors are values").
   */
  readonly error = signal<string | null>(null);

  /**
   * Whether the record is an entity, decided by the name set the payload carries: an entity is
   * named by `fullname` alone and a person by `firstname` and `lastname`
   * (`ClientDataValidator.validateIndividualNamePartsCannotBeUsedWithFullname` rejects a body mixing
   * the two). The legacy edit form makes the same decision from the client's legal form before it
   * chooses which name controls to render.
   */
  readonly isEntity = signal(false);

  /**
   * Whether the record is active, which is the condition under which the legacy edit form renders —
   * and the server accepts — an activation date.
   */
  readonly isActive = signal(false);

  /**
   * The form: the client's two possible name sets, its external id and mobile number, and the
   * activation date an active record carries (AAP 0.7.2 row `ClientEditRequest`).
   *
   * The name controls are non-nullable strings, because an empty name is posted as the empty string
   * legacy posts and the server's own rule reports it; the date is `Date | null`, the type the
   * shared `DateFieldComponent` carries (Rule 1 clause 4; AAP 0.7.2 "Date handling"). Every control
   * starts without a validator, because which of them are required depends on the record: the rules
   * are attached by {@link applyRequiredRules} once the payload has named the name set and the
   * status, and no other rule is ever added (Rule 1 clause 3).
   */
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

  /**
   * Permission the save control is gated on: legacy's own gate on this form's submit button
   * (`has-permission='UPDATE_CLIENT'`, `app/views/clients/editclient.html`), which is also the code
   * the edit route is gated on, so the button and the route cannot disagree (AAP 0.1.1).
   */
  readonly submitPermission = 'UPDATE_CLIENT';

  /** Legacy key of the screen's own title, the legend the legacy form carries. */
  readonly headingKey = 'label.heading.editclient';

  /** Legacy key of the not-found heading, the same one the unknown-path screen renders. */
  readonly notFoundHeadingKey = 'label.heading.notavailable';

  /** Legacy key of the not-found sentence, worded as the platform words a missing resource. */
  readonly notFoundMessageKey = 'error.msg.resource.not.found';

  /**
   * Subscribes to the route's parameters, which is the screen's whole entry point.
   *
   * One subscription, never a `snapshot` read beside it: Angular reuses this component when the URL
   * moves from one `#/editclient/{id}` to another, so a single read would leave the first client's
   * seeded form and Cancel href on screen for the second client's URL. Each emission therefore clears
   * what the previous client put there and reads the record the URL now names
   * (`loan-edit.component.ts`, "one id, one load per navigation").
   */
  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params: ParamMap) => {
        this.clientId.set(params.get('id') ?? '');
        this.reset();
        this.load();
      });
  }

  /**
   * Saves the edited record with one `PUT /clients/{id}` and opens the record.
   *
   * Every control is marked touched first, so a missing required value is reported in place, and an
   * invalid form returns before a body is built — Fineract alone decides what else an entry may be,
   * so a value this screen cannot judge still reaches the server. A rejection is rendered verbatim
   * with every entered value intact; a success navigates to `#/viewclient/:id` through the router.
   */
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

  /**
   * Whether a control shows its required message: invalid, and either visited or already edited —
   * the predicate the shared date field applies to its own `.has-error` state, so every control of
   * the form reports a missing value under the same rule.
   *
   * Read from the template rather than held in a signal, because `invalid`, `touched` and `dirty` are
   * plain properties of a control: a computed signal would keep the first verdict for ever.
   *
   * @param control the control whose state the template is rendering.
   * @returns true when the control's required message belongs on screen.
   */
  protected showsRequiredError(control: AbstractControl): boolean {
    return control.invalid && (control.touched || control.dirty);
  }

  /**
   * The `PUT /clients/{id}` body, built from the form's raw values and the name set the record named.
   *
   * The two name sets are mutually exclusive — the server rejects a body carrying `fullname` beside
   * `firstname` or `lastname`, and the legacy controller deletes the set it does not post — so the
   * branch posts exactly one of them. `externalId` and `mobileNo` go out as the controls hold them,
   * including the empty string, which the server reads as an absent value (the same settlement
   * `client-create.component.ts` records). The activation date is present only for an active record,
   * which is the legacy controller's own condition. Neither date-wire member is set here:
   * `ClientService.update` fills both at the boundary (Rule 1 clause 2).
   *
   * @returns the body the family's service accepts.
   */
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

  /**
   * Reads the record the URL names once, seeds the form from it and applies the required set.
   *
   * A route that names no client issues no request: the not-found branch owns that state, and
   * `loading` is cleared here because no subscription will finalise it. A `404` becomes the not-found
   * state, which is the only state in which the form is never shown; any other failure keeps its
   * mapped message for the error region and leaves `ready` false, since a form seeded from nothing
   * would post values the user never entered.
   *
   * Every run takes the next {@link loadSequence} number and a run the route has since superseded
   * writes nothing at all — not the seeded values, the name-set branches, the required rules or the
   * message, and not `loading`, which belongs to the run that replaced it. `takeUntilDestroyed`
   * unsubscribes the read, so leaving the screen mid-flight cancels it rather than letting its answer
   * land on a destroyed component.
   */
  private load(): void {
    const load = ++this.loadSequence;
    const clientId = this.clientId();

    if (clientId.length === 0) {
      // No request is issued for a route that names no client: the not-found branch already points
      // at the message, and `loading` is cleared so the screen can leave its loading state.
      this.notFound.set(true);
      this.loading.set(false);

      return;
    }

    this.clients
      .getWithTemplate(clientId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          // Only the current run owns the loading state: a superseded one must not clear the flag the
          // newer read set, or the screen would stop reporting that it is still filling.
          if (load === this.loadSequence) {
            this.loading.set(false);
          }
        }),
      )
      .subscribe({
        next: (payload) => {
          // A superseded client's answer is dropped here rather than seeded under the client the URL
          // now names.
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

  /**
   * Seeds the form from the payload: the name set the record carries, the two status branches the
   * template renders from, the record's own values, and then the required rules those branches select.
   *
   * @param payload the `GET /clients/{id}?template=true` response.
   */
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

  /**
   * Clears everything the previous client put on the screen, so a route emission for another client
   * never shows the earlier client's seeded values, name-set branch or message while the new read is
   * outstanding.
   *
   * The form is reset rather than rebuilt, because the template binds these control instances; a reset
   * also returns every control to untouched, which keeps the new record's error markers off the screen
   * until it is actually edited. `loading` goes back to `true` for the same reason.
   */
  private reset(): void {
    this.isEntity.set(false);
    this.isActive.set(false);
    this.ready.set(false);
    this.error.set(null);
    this.notFound.set(false);
    this.loading.set(true);
    this.form.reset();
  }

  /**
   * Attaches the legacy edit form's required rules to the controls its own branches mark required:
   * the person's first and last names, the entity's name, and an active client's activation date.
   *
   * Nothing else is added, and a control whose branch does not apply keeps no rule at all, so a
   * value Fineract alone must judge still reaches the server (Rule 1 clause 3).
   */
  private applyRequiredRules(): void {
    const entity = this.isEntity();

    setRequired(this.form.controls.firstname, !entity);
    setRequired(this.form.controls.lastname, !entity);
    setRequired(this.form.controls.fullname, entity);
    setRequired(this.form.controls.activationDate, this.isActive());
  }

  /**
   * Shows a failed seed or save as the message above the form.
   *
   * The text is the mapped Fineract message verbatim, which is what the interceptor produces for
   * every failed response (AAP 0.7.2 row `FineractError`; workflow W7). Anything else reaching here
   * is not an API failure at all — a bug in the navigation that follows the save, for instance — so
   * its own `message` is shown rather than invented copy; a value that is neither reports nothing,
   * which still leaves the form usable.
   *
   * @param failure the rejection the awaited call produced.
   */
  private reportFailure(failure: unknown): void {
    if (failure instanceof ApiError) {
      this.error.set(failure.message);

      return;
    }

    this.error.set(failure instanceof Error ? failure.message : '');
  }
}

/**
 * Puts the record's own fields back together with the two date-wire members `ClientEditRequest`
 * requires, which `ClientService.update` then overwrites from the resolved configuration at the
 * boundary.
 *
 * The single place this screen adds the pair, so {@link ClientEditComponent.editRequest} names only
 * the fields the form posts.
 *
 * @param fields the record's own fields, as the form holds them.
 * @returns the body `ClientService.update` accepts.
 */
function toEditRequest(fields: ClientEditFields): ClientEditRequest {
  return { ...fields, ...EDIT_DATE_WIRE };
}
