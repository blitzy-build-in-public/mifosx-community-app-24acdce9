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

import { screenFailure, toDisplayableFailure } from '../../../core/http/api-error';
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

/**
 * The value of a route's `:clientId` segment as a client identifier, or `null` when it names none.
 *
 * A segment that is absent, blank, non-numeric, fractional or zero names no client, and the screen
 * must send none of them: `Number(segment)` answers `0` for the absent segment and `NaN` for the
 * non-numeric one, so a template read or an application body built from that value would name no
 * client at all — `?clientId=NaN` in the query string and `null` in the body, neither of which is a
 * call the legacy screen ever makes (Rule 1 clause 2). A segment that does name a client answers the
 * positive whole number it carries, so the routed behaviour is unchanged (AAP 0.7.4 states).
 *
 * @param segment The raw `:clientId` route parameter, or `null` when the URL carries none.
 * @returns the client identifier `segment` names, or `null` when it names none.
 */
function parseClientId(segment: string | null): number | null {
  if (segment === null) {
    return null;
  }

  const parsed = Number(segment);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * First step of workflow W8 (AAP 0.10.1 W8 row): open a savings account for a client, at the route
 * `#/new_client_saving_application/:clientId` (AAP 0.8.2 `savings.routes.ts`), for the Stretch scope
 * group that ships per AAP 0.9.1 and AAP 0.9.3.
 *
 * **Two requests, both through the family's own service.** `SavingsService.template(clientId)` is
 * `GET /savingsaccounts/template?clientId=` and `SavingsService.create()` is `POST /savingsaccounts`
 * (AAP 0.7.3 W8 row); this file names no host, path, query parameter or header, and never injects
 * Angular's HTTP client (Rule 1 clauses 2 and 5, Rule 2). The template is requested exactly once per
 * route emission, and only once the emission's `:clientId` has been read as a client identifier: W8
 * counts requests, and the application body carries no product-scoped field, so a product selection
 * re-reads nothing. A route whose segment names no client issues no request at all and renders the
 * not-found message in place of the card (AAP 0.7.4 states).
 *
 * **One route emission, one application.** `:clientId` is read from `route.paramMap`, never from the
 * snapshot: the router reuses this component when the URL moves from one client's application to
 * another — the record links each of its clients' accounts to a form of its own — so a single read
 * would leave the first client's form, product list and message on screen under the second client's URL
 * and would issue no request at all. Every emission therefore clears the form, the product list and the
 * message, and re-reads the template for the client the URL now names, exactly as `loan-edit` handles
 * the same reuse; an answer that arrives after the URL moved on is discarded rather than painted, and
 * leaving the screen cancels the read it left outstanding.
 *
 * **The body is the plan's fixed five fields.** `SavingsService.create()` takes
 * `SavingsApplicationInput` — `clientId`, `productId`, `submittedOnDate` — and adds `dateFormat` and
 * `locale` itself, so the posted body is exactly AAP 0.7.2's `SavingsApplicationRequest` and no date
 * is ever formatted here (AAP 0.14.1, "Dates never travel as strings built in a template").
 *
 * **It reproduces the legacy form rather than improving it.** Product options are the template
 * payload's own list, in the order the server returned it, with no sort, filter, rename or fallback
 * list (AAP 0.4.4 decision 6, Rule 1 clause 3); the only validators are `required`, which is what the
 * legacy `Details` step marks, and no min, max or pattern the legacy screen lacks. The officer picker
 * that step also shows is deliberately not rendered, because the creation body AAP 0.7.2 fixes
 * carries no officer member — the form's own comment states the reason. Fineract's message is
 * rendered above the form verbatim, the entered values survive it, and the submit control is disabled
 * while its one request is in flight, so a second click sends no second `POST` (AAP 0.7.4;
 * `createSubmitGuard`).
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

  /**
   * The active route, subscribed to for the `:clientId` this application is opened for: the router
   * reuses this component across clients, so the segment is followed rather than sampled once.
   */
  private readonly route = inject(ActivatedRoute);

  /** Navigates to the record of the account the POST created, and back to the client on cancel. */
  private readonly router = inject(Router);

  /** Completes the route subscription and the template read should the screen be destroyed first. */
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The client the account is opened for — the `:clientId` segment of the emission being served — or
   * `null` when the segment names no client.
   *
   * `null` rather than a coercion, because a template read and an application body are addressed by
   * this value: `0` and `NaN` would issue `GET /savingsaccounts/template?clientId=NaN` and post
   * `clientId: null`, which no legacy screen sends (Rule 1 clause 2). The screen shows its not-found
   * message instead (AAP 0.7.4). A signal, not a snapshot value: the router reuses this component when
   * the URL moves from one client's application to another, so the client has to follow every emission
   * of `route.paramMap` and every reader of it — the template read, the posted body and Cancel.
   */
  readonly clientId = signal<number | null>(null);

  /**
   * Which template read is the current one, incremented by every run of {@link loadTemplate}.
   *
   * The router reuses this component across clients, so moving in place starts a second read while the
   * first is still in flight and the earlier one can answer last. A superseded run compares its own
   * number with this one after the await and writes nothing — not the product list, not the failure —
   * the guard `loan-edit` and `client-actions` keep over their own load sequence.
   */
  private loadSequence = 0;

  /**
   * Whether the route names no client, so there is nothing to open an account for.
   *
   * A signal rather than a plain field, because the template branches on it and {@link submit}
   * refuses on it: the not-found outcome must be unable to issue a request (AAP 0.7.4 states). It is
   * set on every emission, so the verdict of the route the URL has left cannot survive the move.
   */
  readonly notFound = signal<boolean>(false);

  /**
   * The template payload the product list comes from, or `null` until the one read answers. Kept as
   * the response the server sent rather than reduced to an option array, so `productOptions` stays a
   * projection of the payload and this screen invents no default list of its own.
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
   * The failure to show above the form, already verbatim from Fineract, or `null` while there is
   * none. A template-read failure leaves the form usable; a submit failure also leaves every entered
   * value in place, because the form is never reset or unmounted (AAP 0.7.4).
   */
  readonly error = signal<string | null>(null);

  /** One request per click: the guard refuses re-entry while the POST is in flight (AAP 0.14.1). */
  readonly guard = createSubmitGuard();

  /**
   * Resolves the labels the two shared field components take as plain display text: one signal per
   * legacy key, re-resolved on a language switch and on a bundle arriving, not frozen at the first
   * paint. It is the one copy of that mechanism this screen shares with `savings-action`
   * (`shared/translated-label.util.ts`), and it is declared before the label fields below so each of
   * them is one `translated('…')` call.
   *
   * A field initializer is an injection context, which the factory requires: it injects
   * `TranslateService` and ends its own subscriptions with this component.
   */
  private readonly translated = createTranslatedLabels();

  /**
   * The application form: the two fields whose values the creation body carries, and nothing else.
   *
   * The legacy `Details` step also shows a field-officer picker, and this form has no such control.
   * AAP 0.7.2 fixes the body at `clientId`, `productId`, `submittedOnDate`, `dateFormat` and
   * `locale`; `SavingsApplicationInput` declares no officer member, and AAP 0.10.5 item 5 keeps staff
   * assignment out of scope. A picker here would collect a choice no request can send and discard it
   * without telling the operator, which is the broken affordance AAP 0.10.5 item 8's reasoning
   * rejects (Rule 1 clause 3). No amount, interest rate, deposit, note, tenant or API-server field is
   * rendered either, for the same reason: the body does not carry them (AAP 0.7.2, AAP 0.8.2).
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
  });

  /** Already-translated label of the product select, for its plain-text `label` input. */
  readonly productLabel = this.translated('label.input.product');

  /** Already-translated text of the product select's empty option. */
  readonly productPlaceholder = this.translated('label.selectsavingproduct');

  /** Already-translated label of the submitted-on field. */
  readonly submittedOnDateLabel = this.translated('label.input.submittedon');

  /**
   * Subscribes to the route's parameters, which is the screen's whole entry point.
   *
   * One subscription, never a `snapshot` read beside it: the router reuses this component when the URL
   * moves from one client's application to another, and a single read would leave the first client's
   * form, product list and message on screen for the client the URL now names. Each emission therefore
   * resets the screen and re-runs the template read, the way `loan-edit` handles the same reuse.
   */
  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params: ParamMap) => {
        this.applyRoute(params.get('clientId'));
      });
  }

  /**
   * Applies one route emission: stores the client it names, clears everything the previous emission put
   * on the screen, and reads the template for the new client.
   *
   * Nothing is read for a route that names no client: the screen renders its not-found message, and
   * there is no client to ask a template for (AAP 0.7.4 states). That path takes the next
   * {@link loadSequence} number itself, which is what discards a read the previous emission left
   * outstanding.
   *
   * @param segment the emission's `:clientId` segment, or `null` when it carries none.
   */
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

  /**
   * Clears everything the previous emission put on the screen — the form's picked product and date, the
   * template the product list comes from, and the failure — so a route that names another client never
   * shows the earlier client's application.
   */
  private reset(): void {
    this.form.reset({ productId: null, submittedOnDate: new Date() });
    this.savingsTemplate.set(null);
    this.error.set(null);
    this.notFound.set(false);
  }

  /**
   * Opens the account, then lands on its record.
   *
   * A route that names no client sends nothing: the screen is showing its not-found message, so there
   * is no form to touch and no application to post. Otherwise every control is touched first, so a
   * missing required field is reported in place, and the method returns without issuing any request
   * while the form is invalid. The POST runs inside `guard.runOnce`, so one click sends exactly one
   * `POST /savingsaccounts` even if the button is clicked again while the first request is
   * outstanding. A 4xx becomes the form's error text, verbatim, with every entered value intact; a
   * 5xx or a transport failure raises no inline text, because the interceptor's notification is
   * already that failure's one message (AAP 0.7.4).
   */
  async submit(): Promise<void> {
    const clientId = this.clientId();

    if (this.notFound() || clientId === null) {
      return;
    }

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
            clientId,
            productId: typeof productId === 'number' ? productId : Number(productId),
            submittedOnDate,
          }),
        );

        await this.router.navigate(['/viewsavingaccount', created.resourceId]);
      });
    } catch (failure: unknown) {
      this.error.set(screenFailure(failure)?.message ?? null);
    }
  }

  /**
   * Leaves the application without opening anything: back to the client record the workflow started
   * from, or to the client list when the route named no client to return to, and no request at all.
   * The paths are route segment strings, so nothing is imported from the clients feature to name
   * them.
   */
  cancel(): void {
    const clientId = this.clientId();

    // The navigation's promise is settled rather than dropped, so a navigation the router refuses
    // cannot surface as an unhandled rejection (AAP 0.14.2). It reports through this screen's own
    // failure text rather than `screenFailure`: a refused navigation is no HTTP answer, so the
    // interceptor has raised no notification for it and nothing else would tell the user that the
    // return to the client record did not happen.
    void this.router
      .navigate(clientId === null ? ['/clients'] : ['/viewclient', clientId])
      .catch((cause: unknown) => {
        this.error.set(toDisplayableFailure(cause).message);
      });
  }

  /**
   * Reads the new-application template once, for one client and no product, and publishes it.
   *
   * A 4xx becomes the form's error text through the shared `screenFailure` and leaves the form
   * usable; a 5xx or a transport failure answers `null` there, because the interceptor has already
   * raised that failure's one notification (AAP 0.7.4).
   *
   * Every run takes the next {@link loadSequence} number, and the read is tied to this component's
   * lifetime, so a run the route has since superseded — or that the screen outlived — writes nothing at
   * all: not the product list, not the failure.
   *
   * @param clientId The `:clientId` segment's own value, which the caller has already established
   *   names a client, so this read can never be addressed by a `0` or a `NaN`.
   */
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

  /**
   * Whether a read still speaks for the screen: it is the newest read, and the screen it belongs to has
   * not been destroyed, so a read the route or the teardown cancelled can neither publish a product list
   * nor report a failure under another client's URL.
   *
   * @param load the read's {@link loadSequence} number.
   */
  private isCurrent(load: number): boolean {
    return !this.destroyRef.destroyed && load === this.loadSequence;
  }
}
