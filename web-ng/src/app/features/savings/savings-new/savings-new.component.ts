import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, type ParamMap } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { navigationFailure, screenFailure } from '../../../core/http/api-error';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import {
  SelectFieldComponent,
  type SelectOption,
  type SelectValue,
} from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import { createTranslatedLabels } from '../../../shared/translated-label.util';
import type { SavingsTemplate } from '../savings.models';
import { SavingsService } from '../savings.service';

/** The value of a route's `:clientId` segment as a client identifier, or `null` when it names none (Rule 1 clause 2, AAP 0.7.4). */
function parseClientId(segment: string | null): number | null {
  if (segment === null) {
    return null;
  }

  const parsed = Number(segment);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Whether the product control's value is a product identifier the application may post, narrowing it to the `number` the request needs (AAP 0.7.2, Rule 1 clause 2). */
function isProductId(value: SelectValue): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** First step of workflow W8 (AAP 0.10.1 W8 row): open a savings account for a client, at the route `#/new_client_saving_application/:clientId` (AAP 0.8.2 `savings.routes.ts`), for the Stretch scope group that ships per (AAP 0.9.1, AAP 0.9.3, AAP 0.7.3, Rule 2). */
@Component({
  selector: 'app-savings-new',
  imports: [ReactiveFormsModule, TranslatePipe, DateFieldComponent, SelectFieldComponent],
  templateUrl: './savings-new.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavingsNewComponent {
  /** The saving-accounts family's one typed service, the component's only Fineract collaborator. */
  private readonly savings = inject(SavingsService);

  /** The active route, subscribed to for the `:clientId` this application is opened for: the router reuses this component across clients, so the segment is followed rather than sampled once. */
  private readonly route = inject(ActivatedRoute);

  /** Navigates to the record of the account the POST created, and back to the client on cancel. */
  private readonly router = inject(Router);

  /** Completes the route subscription and the template read should the screen be destroyed first. */
  private readonly destroyRef = inject(DestroyRef);

  /** The client the account is opened for — the `:clientId` segment of the emission being served — or `null` when the segment names no client (Rule 1 clause 2, AAP 0.7.4). */
  readonly clientId = signal<number | null>(null);

  /** Which template read is the current one, incremented by every run of {@link loadTemplate}. The router reuses this component across clients, so moving in place starts a second read while the first is still in flight and. */
  private loadSequence = 0;

  /** Whether the route names no client, so there is nothing to open an account for (AAP 0.7.4). */
  readonly notFound = signal<boolean>(false);

  /** The template payload the product list comes from, or `null` until the one read answers. */
  readonly savingsTemplate = signal<SavingsTemplate | null>(null);

  /** The products the account may be opened on: the payload's `productOptions`, in its order, mapped one-for-one onto the select field's `{id, name}` shape (AAP 0.4.4, Rule 1 clause 3). */
  readonly productOptions = computed<SelectOption[]>(() =>
    (this.savingsTemplate()?.productOptions ?? []).map((product) => ({
      id: product.id,
      name: product.name,
    })),
  );

  /** The failure to show above the form, already verbatim from Fineract, or `null` while there is none (AAP 0.7.4). */
  readonly error = signal<string | null>(null);

  /** One request per click: the guard refuses re-entry while the POST is in flight (AAP 0.14.1). */
  readonly guard = createSubmitGuard();

  /** Resolves the labels the two shared field components take as plain display text: one signal per legacy key, re-resolved on a language switch and on a bundle arriving, not frozen at the first paint. */
  private readonly translated = createTranslatedLabels();

  /** The application form: the two fields whose values the creation body carries, and nothing else (AAP 0.7.2, AAP 0.10.5, Rule 1 clause 3, AAP 0.8.2). */
  readonly form = new FormGroup({
    /** The chosen product. Widened to `SelectValue | null` only so `app-select-field`, which declares its `control` input as `FormControl<SelectValue | null>`, accepts the binding under `strictTemplates`; {@link isProductId}. */
    productId: new FormControl<SelectValue | null>(null, { validators: [Validators.required] }),

    /** The submission date, defaulting to the browser clock exactly as the legacy form's datepicker does (AAP 0.10.5). */
    submittedOnDate: new FormControl<Date | null>(new Date(), {
      validators: [Validators.required],
    }),
  });

  /** Already-translated label of the product select, for its plain-text `label` input. */
  readonly productLabel = this.translated('label.input.product');

  /** Already-translated text of the product select's empty option. */
  readonly productPlaceholder = this.translated('label.selectsavingproduct');

  /** Already-translated label of the submitted-on field. */
  readonly submittedOnDateLabel = this.translated('label.input.submittedon');

  /** Subscribes to the route's parameters, which is the screen's whole entry point. */
  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params: ParamMap) => {
        this.applyRoute(params.get('clientId'));
      });
  }

  /** Applies one route emission: stores the client it names, clears everything the previous emission put on the screen, and reads the template for the new client (AAP 0.7.4). */
  private applyRoute(segment: string | null): void {
    const clientId = parseClientId(segment);

    this.clientId.set(clientId);
    this.reset();

    if (clientId === null) {
      this.loadSequence += 1;
      this.notFound.set(true);

      return;
    }

    void this.loadTemplate(clientId);
  }

  /** Clears everything the previous emission put on the screen — the form's picked product and date, the template the product list comes from, and the failure — so a route that names another client never shows the earlier. */
  private reset(): void {
    this.form.reset({ productId: null, submittedOnDate: new Date() });
    this.savingsTemplate.set(null);
    this.error.set(null);
    this.notFound.set(false);
  }

  /** Opens the account, then lands on its record. A route that names no client sends nothing: the screen is showing its not-found message, so there is no form to touch and no application to post (AAP 0.4.4, Rule 1 clause 3, AAP 0.7.4). */
  async submit(): Promise<void> {
    const clientId = this.clientId();

    if (this.notFound() || clientId === null) {
      return;
    }

    this.form.markAllAsTouched();

    const productId = this.form.controls.productId.value;
    const submittedOnDate = this.form.controls.submittedOnDate.value;

    if (
      this.form.invalid ||
      productId === null ||
      !isProductId(productId) ||
      submittedOnDate === null
    ) {
      return;
    }

    this.error.set(null);

    try {
      await this.guard.runOnce(async () => {
        const created = await firstValueFrom(
          this.savings.create({
            clientId,
            productId,
            submittedOnDate,
          }),
        );

        await this.router.navigate(['/viewsavingaccount', created.resourceId]);
      });
    } catch (failure: unknown) {
      this.error.set(screenFailure(failure)?.message ?? null);
    }
  }

  /** Leaves the application without opening anything: back to the client record the workflow started from, or to the client list when the route named no client to return to, and no request at all. */
  cancel(): void {
    const clientId = this.clientId();
    const destination = clientId === null ? 'client list' : 'client record';

    // The navigation's promise is settled rather than dropped, so a navigation the router refuses cannot surface as an unhandled rejection (AAP 0.14.2).
    void this.router
      .navigate(clientId === null ? ['/clients'] : ['/viewclient', clientId])
      .catch((cause: unknown) => {
        this.error.set(navigationFailure(cause, destination).message);
      });
  }

  /** Reads the new-application template once, for one client and no product, and publishes it (AAP 0.7.4). */
  private async loadTemplate(clientId: number): Promise<void> {
    const load = ++this.loadSequence;

    try {
      const template = await firstValueFrom(
        this.savings.template(clientId).pipe(takeUntilDestroyed(this.destroyRef)),
      );

      if (this.isCurrent(load)) {
        this.savingsTemplate.set(template);
      }
    } catch (failure: unknown) {
      if (this.isCurrent(load)) {
        this.error.set(screenFailure(failure)?.message ?? null);
      }
    }
  }

  /** Whether a read still speaks for the screen: it is the newest read, and the screen it belongs to has not been destroyed, so a read the route or the teardown cancelled can neither publish a product list nor report a. */
  private isCurrent(load: number): boolean {
    return !this.destroyRef.destroyed && load === this.loadSequence;
  }
}
