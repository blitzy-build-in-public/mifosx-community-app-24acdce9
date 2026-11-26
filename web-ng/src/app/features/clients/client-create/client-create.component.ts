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
import { PanelCardComponent } from '../../../shared/panel-card/panel-card.component';
import {
  SelectFieldComponent,
  type SelectOption,
  type SelectValue,
} from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import type { ClientCreateRequest, ClientMutationResponse, ClientTemplate } from '../client.models';
import { ClientService } from '../client.service';

/** The legal form this screen posts: 1, an individual, fixed because the server requires the member on every create and this screen fills an individual's name parts (`validateForCreate`). */
const INDIVIDUAL_LEGAL_FORM_ID = 1;

/** Local midnight of the browser's current date, the default a form's own date starts from as the legacy form starts from `new Date()`; built from calendar fields so no timezone names yesterday (AAP 0.10.5 item 15). */
function startOfToday(): Date {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The legacy create form's own name rule, reproduced verbatim from `ng-pattern` (`app/views/clients/createclient.html`) and handed to `Validators.pattern` as a `RegExp`, never a string, which would wrap it in `^…$` and reject a multi-word name (Rule 1 clause 3). */
const LEGACY_NAME_PATTERN = /(^[A-z])[A-z.'-]*/;

/** The legacy create form's own mobile rule, verbatim from `ng-pattern="/^[0-9]+$/"`: digits only, anchored at both ends as the legacy expression is. */
const LEGACY_MOBILE_PATTERN = /^[0-9]+$/;

/** The create screen (`#/createclient`), first half of W2: `GET /clients/template` seeded once and re-read on an office change, then one `POST /clients` per click through `ClientService` (AAP 0.7.3 "W2"; AAP 0.8.2 route `createclient`). */
@Component({
  selector: 'app-client-create',
  imports: [ReactiveFormsModule, TranslatePipe, DateFieldComponent, SelectFieldComponent, PanelCardComponent],
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

  /** The last `GET /clients/template` response, or `null` before the first one resolves; a re-read for a new office replaces the staff picker's contents. */
  readonly clientTemplate = signal<ClientTemplate | null>(null);

  /** The offices the client may be filed under, in the template's own order and never filtered, sorted or renamed here, because a Fineract template is the only source of a dropdown's contents (Rule 1 clause 3). */
  readonly officeOptions = computed<readonly SelectOption[]>(
    () => this.clientTemplate()?.officeOptions ?? [],
  );

  /** The loan officers selectable for the client, each mapped from the template's `displayName` — the label the legacy dropdown binds (`staff.id as staff.displayName`) — because a `StaffData` entry carries no `name`. */
  readonly staffOptions = computed<readonly SelectOption[]>(() =>
    (this.clientTemplate()?.staffOptions ?? []).map((staff) => ({
      id: staff.id,
      name: staff.displayName,
    })),
  );

  /** The message above the form: Fineract's own text verbatim for a 4xx `ApiError`, `null` for a 5xx or transport failure the interceptor has already notified, and every entered value stays in the form (AAP 0.7.4). */
  readonly error = signal<string | null>(null);

  /** The form, built from explicit controls so `strictTemplates` matches the shared fields' input types and each value type is known: office and staff ids `SelectValue | null`, names strings, dates `Date | null` (Rule 1 clause 4). */
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
    // Deliberate difference from legacy, which gates its "Active" row on `ACTIVATE_CLIENT`: this route is gated once on `CREATE_CLIENT` and takes no permission directive, so the box always renders and creating a client (AAP 0.8.2, Rule 1 clause 3).
    active: new FormControl<boolean>(false, { nonNullable: true }),
  });

  /** Whether the client is to be created active, as a signal, because a plain read of the control's value would not re-render this zoneless `OnPush` view when the box is ticked. */
  readonly isActive = toSignal(this.form.controls.active.valueChanges, {
    initialValue: this.form.controls.active.value,
  });

  /** The office whose template is currently applied, or `null` before the first read: written with `emitEvent: false` so the seeded value cannot trigger a second read. */
  private loadedOfficeId: SelectValue | null = null;

  /** Reads the template once for the defaults, then again whenever the office control changes to a different office — the legacy form's own sequence (AAP 0.7.3 "W2"). */
  constructor() {
    this.form.controls.officeId.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((officeId) => {
        // A control holds `SelectValue | null`; neither a cleared office nor a re-seeded one is a change worth a request, and Fineract's office ids are numbers.
        if (typeof officeId !== 'number' || officeId === this.loadedOfficeId) {
          return;
        }

        void this.loadTemplate(officeId, true);
      });

    void this.loadTemplate();
  }

  /** Submits the form — the screen's only path to `POST /clients`: every control marked touched, an invalid form returning before any request, and the post inside the submit guard so a second click sends nothing (AAP 0.1.1). */
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

  /** Leaves the screen without creating anything, returning to the legacy form's own `cancel` target, `#/clients`. */
  cancel(): void {
    void this.router.navigate(['/clients']);
  }

  /** Whether a control shows its error state at all: invalid and either visited or already edited, the predicate the shared fields apply, read from the template because those are plain control properties. */
  protected showsError(control: AbstractControl): boolean {
    return control.invalid && (control.touched || control.dirty);
  }

  /** Whether a control shows the legacy required message (`label.requiredfield`), told apart from the pattern message so a field reports the rule that applies rather than both. */
  protected showsRequiredError(control: AbstractControl): boolean {
    return control.hasError('required') && (control.touched || control.dirty);
  }

  /** Whether a control shows the legacy pattern message it carries — the name rule's `validation.msg.client.name.cannot.start.specialchar.ornumber` or the mobile rule's `label.mustbenumeric` (Rule 1 clause 3). */
  protected showsPatternError(control: AbstractControl): boolean {
    return control.hasError('pattern') && (control.touched || control.dirty);
  }

  /** The id of the message a control is currently showing, or `null`, so `aria-describedby` names exactly the one element on screen (`requiredId` or `patternId`) rather than both of a field's messages. */
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

  /** Reads the template and applies it to the form: a parameter-less first read whose defaults seed the office, active flag and activation date, then an office change that re-reads for the staff list alone (AAP 0.7.3 "W2"). */
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

      // Seeded from the first template read alone: an office change re-reads the template for the staff list and the option lists, so it keeps the operator's own active choice and the activation date they have already chosen.
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

  /** The `POST /clients` body, built from the form's raw values with every value as the control holds it — ids stay numbers, no string is trimmed — and `activationDate` only for a client created active, since Fineract refuses that pair (Rule 1 clause 3). */
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

  /** Shows a failed read or submit: `screenFailure` publishes Fineract's own `defaultUserMessage` verbatim for a 4xx — the text W7 compares — and answers `null` for a 5xx or status-0 failure the interceptor has already notified (AAP 0.7.2 `FineractError`; AAP 0.7.4). */
  private reportFailure(error: unknown): void {
    if (error instanceof ApiError || error instanceof HttpErrorResponse) {
      this.error.set(screenFailure(error)?.message ?? null);
      return;
    }

    this.error.set(toDisplayableFailure(error).message);
  }
}
