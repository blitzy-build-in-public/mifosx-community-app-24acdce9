import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { ApiError } from '../../../core/http/api-error';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import {
  SelectFieldComponent,
  type SelectOption,
  type SelectValue,
} from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import type { SavingsTemplate } from '../savings.models';
import { SavingsService } from '../savings.service';

/**
 * The text a screen shows for a failure: Fineract's own message, unchanged.
 *
 * The single interceptor maps every failed response to an `ApiError`, whose `message` is the
 * server's `defaultUserMessage` verbatim (AAP 0.4.2, AAP 0.7.2), so the first branch is the one a
 * failed request always takes and no prefix, suffix or translation is added to it (Rule 1 clause 3).
 * The other two branches exist only because a rejected promise is typed `unknown`: an `Error` keeps
 * its own message and anything else is rendered as it stringifies rather than being swallowed, so no
 * failure path ends without text on screen (AAP 0.14.2 "no `catch` swallows an error silently").
 *
 * @param failure The rejection reason of an awaited request.
 * @returns the displayable text of that failure.
 */
function describeFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    return failure.message;
  }

  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * First step of workflow W8 (AAP 0.10.1 W8 row): open a savings account for a client, at the route
 * `#/new_client_saving_application/:clientId` (AAP 0.8.2 `savings.routes.ts`), for the Stretch scope
 * group that ships per AAP 0.9.1 and AAP 0.9.3.
 *
 * **Two requests, both through the family's own service.** `SavingsService.template(clientId)` is
 * `GET /savingsaccounts/template?clientId=` and `SavingsService.create()` is `POST /savingsaccounts`
 * (AAP 0.7.3 W8 row); this file names no host, path, query parameter or header, and never injects
 * Angular's HTTP client (Rule 1 clauses 2 and 5, Rule 2). The template is requested exactly once, on
 * construction: W8 counts requests, and the application body carries no product-scoped field, so a
 * product selection re-reads nothing.
 *
 * **The body is the plan's fixed five fields.** `SavingsService.create()` takes
 * `SavingsApplicationInput` — `clientId`, `productId`, `submittedOnDate` — and adds `dateFormat` and
 * `locale` itself, so the posted body is exactly AAP 0.7.2's `SavingsApplicationRequest` and no date
 * is ever formatted here (AAP 0.14.1, "Dates never travel as strings built in a template").
 *
 * **It reproduces the legacy form rather than improving it.** Product and field-officer options are
 * the template payload's own lists, in the order the server returned them, with no sort, filter,
 * rename or fallback list (AAP 0.4.4 decision 6, Rule 1 clause 3); the only validators are
 * `required`, which is what the legacy `Details` step marks, and no min, max or pattern the legacy
 * screen lacks. Fineract's message is rendered above the form verbatim, the entered values survive
 * it, and the submit control is disabled while its one request is in flight, so a second click sends
 * no second `POST` (AAP 0.7.4; `createSubmitGuard`).
 *
 * **It carries no styling and no copy of its own.** Every class in the template is a global
 * Bootstrap 3 class from `web-ng/src/styles.scss` (Rule 1 clause 6); the visible labels are the
 * legacy bundle's keys resolved through `TranslatePipe`, except the two field components' own
 * `label` inputs, which take already-translated text and so receive the signals below.
 */
@Component({
  selector: 'app-savings-new',
  imports: [ReactiveFormsModule, TranslatePipe, DateFieldComponent, SelectFieldComponent],
  templateUrl: './savings-new.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavingsNewComponent {
  /** The saving-accounts family's one typed service, the component's only Fineract collaborator. */
  private readonly savings = inject(SavingsService);

  /** The active route, read once for the `:clientId` this application is opened for. */
  private readonly route = inject(ActivatedRoute);

  /** Navigates to the record of the account the POST created, and back to the client on cancel. */
  private readonly router = inject(Router);

  /** Supplies the labels the two shared field components take as plain display text. */
  private readonly translate = inject(TranslateService);

  /**
   * The client the account is opened for: the `:clientId` segment, read from the route snapshot
   * once and never re-read, because this screen is a single-purpose form for that one client.
   */
  readonly clientId: number = Number(this.route.snapshot.paramMap.get('clientId'));

  /**
   * The template payload the option lists come from, or `null` until the one read answers. Kept
   * rather than reduced to two option arrays, because the field-officer control's presence is a
   * property of the payload itself (see `hasFieldOfficerOptions`).
   */
  readonly savingsTemplate = signal<SavingsTemplate | null>(null);

  /**
   * The products the account may be opened on: the payload's `productOptions`, in its order, mapped
   * one-for-one onto the select field's `{id, name}` shape. An absent list renders an empty picker
   * rather than a fallback product (AAP 0.4.4 decision 6, Rule 1 clause 3).
   */
  readonly productOptions = computed<SelectOption[]>(() =>
    (this.savingsTemplate()?.productOptions ?? []).map((product) => ({
      id: product.id,
      name: product.name,
    })),
  );

  /**
   * The field officers the application may be assigned to. A staff row carries `displayName` and no
   * `name`, so it is labelled from the member the server actually sends (Rule 1 clause 2), and the
   * list is empty whenever the payload omits `fieldOfficerOptions`, which the client-only read does.
   */
  readonly fieldOfficerOptions = computed<SelectOption[]>(() =>
    (this.savingsTemplate()?.fieldOfficerOptions ?? []).map((officer) => ({
      id: officer.id,
      name: officer.displayName,
    })),
  );

  /** Whether the payload supplied field officers at all; the control renders only when it did. */
  readonly hasFieldOfficerOptions = computed<boolean>(() => this.fieldOfficerOptions().length > 0);

  /**
   * The failure to show above the form, already verbatim from Fineract, or `null` while there is
   * none. A template-read failure leaves the form usable; a submit failure also leaves every entered
   * value in place, because the form is never reset or unmounted (AAP 0.7.4).
   */
  readonly error = signal<string | null>(null);

  /** One request per click: the guard refuses re-entry while the POST is in flight (AAP 0.14.1). */
  readonly guard = createSubmitGuard();

  /**
   * Counts the moments at which a label must be resolved again: a language switch and a bundle
   * arriving. Both are read inside every label signal below, so a label resolved before its bundle
   * had loaded is replaced by the real wording instead of staying at the fallback for the life of the
   * screen.
   */
  private readonly labelsRevision = signal(0);

  /**
   * The application form: the three fields the legacy `Details` step collects, and nothing else — no
   * amount, interest rate, deposit, note, tenant or API-server field, none of which the creation body
   * carries (AAP 0.7.2, AAP 0.8.2).
   */
  readonly form = new FormGroup({
    /**
     * The chosen product. Widened to `SelectValue | null` only so `app-select-field`, which declares
     * its `control` input as `FormControl<SelectValue | null>`, accepts the binding under
     * `strictTemplates`; the value is converted to the `number` the request needs at the submit
     * boundary.
     */
    productId: new FormControl<SelectValue | null>(null, { validators: [Validators.required] }),

    /**
     * The submission date, defaulting to the browser clock exactly as the legacy form's datepicker
     * does. It is nullable because `DateFieldComponent` carries `FormControl<Date | null>`. The
     * tenant business date is deliberately not read here (AAP 0.10.5 item 15): it belongs to the
     * harness — seed values, workflow inputs and comparisons — because a read inside the application
     * would add a request the legacy screens never send and would register as a request difference in
     * every parity workflow.
     */
    submittedOnDate: new FormControl<Date | null>(new Date(), {
      validators: [Validators.required],
    }),

    /**
     * The optional field officer. It is collected because the template supplies the list and the
     * legacy `Details` step shows the control, but it is **not** posted: W8's fixed body is exactly
     * `clientId`, `productId` and `submittedOnDate` (AAP 0.7.2), and `SavingsApplicationInput`
     * declares no field-officer member, so the selection mirrors a template-supplied legacy field and
     * stays in the form. No validator, because legacy marks the field optional.
     */
    fieldOfficerId: new FormControl<SelectValue | null>(null),
  });

  /** Already-translated label of the product select, for its plain-text `label` input. */
  readonly productLabel = this.translated('label.input.product');

  /** Already-translated text of the product select's empty option. */
  readonly productPlaceholder = this.translated('label.selectsavingproduct');

  /** Already-translated label of the submitted-on field. */
  readonly submittedOnDateLabel = this.translated('label.input.submittedon');

  /** Already-translated label of the field-officer select. */
  readonly fieldOfficerLabel = this.translated('label.input.fieldofficer');

  /** Already-translated text of the field-officer select's empty option. */
  readonly fieldOfficerPlaceholder = this.translated('label.selectfieldofficer');

  constructor() {
    const refreshLabels = (): void => this.labelsRevision.update((revision) => revision + 1);
    this.translate.onLangChange.pipe(takeUntilDestroyed()).subscribe(refreshLabels);
    this.translate.onTranslationChange.pipe(takeUntilDestroyed()).subscribe(refreshLabels);

    void this.loadTemplate();
  }

  /**
   * Opens the account, then lands on its record.
   *
   * Touches every control first, so a missing required field is reported in place, and returns
   * without issuing any request while the form is invalid. The POST runs inside `guard.runOnce`, so
   * one click sends exactly one `POST /savingsaccounts` even if the button is clicked again while
   * the first request is outstanding. A rejection becomes the form's error text, verbatim, with
   * every entered value intact and no second notification raised — the interceptor already raised
   * one for the failure it mapped.
   */
  async submit(): Promise<void> {
    this.form.markAllAsTouched();

    const productId = this.form.controls.productId.value;
    const submittedOnDate = this.form.controls.submittedOnDate.value;

    if (this.form.invalid || productId === null || submittedOnDate === null) {
      return;
    }

    this.error.set(null);

    try {
      await this.guard.runOnce(async () => {
        const created = await firstValueFrom(
          this.savings.create({
            clientId: this.clientId,
            productId: typeof productId === 'number' ? productId : Number(productId),
            submittedOnDate,
          }),
        );

        await this.router.navigate(['/viewsavingaccount', created.resourceId]);
      });
    } catch (failure: unknown) {
      this.error.set(describeFailure(failure));
    }
  }

  /**
   * Leaves the application without opening anything: back to the client record the workflow started
   * from, and no request at all. The path is a route segment string, so nothing is imported from the
   * clients feature to name it.
   */
  cancel(): void {
    void this.router.navigate(['/viewclient', this.clientId]);
  }

  /**
   * Reads the new-application template once, for this client and no product, and publishes it.
   *
   * A failure becomes the form's error text when it is an `ApiError` and leaves the form usable; the
   * notification is not repeated here, because the interceptor has already raised one for it.
   */
  private async loadTemplate(): Promise<void> {
    try {
      const template = await firstValueFrom(this.savings.template(this.clientId));
      this.savingsTemplate.set(template);
    } catch (failure: unknown) {
      this.error.set(describeFailure(failure));
    }
  }

  /**
   * Builds one label signal from a legacy translation key.
   *
   * The key is resolved with `instant()`, because the two shared field components take a `label` as
   * plain display text rather than a key the `TranslatePipe` could re-resolve. `instant()` answers
   * from whatever bundle is loaded at that moment, so the computed also reads `labelsRevision`,
   * which the constructor bumps on a language switch and on a bundle arriving: the first paint shows
   * the missing-translation handler's humanised wording, and the real legacy text replaces it as soon
   * as the bundle lands.
   *
   * @param key Legacy key from `app/global-translations/`, served in place (Rule 1 clause 6).
   * @returns the signal the template binds to the field's `label` input.
   */
  private translated(key: string): Signal<string> {
    return computed(() => {
      this.labelsRevision();
      this.translate.currentLang();
      return this.translate.instant(key);
    });
  }
}
