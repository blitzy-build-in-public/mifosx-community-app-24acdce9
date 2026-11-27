import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import type { FormControl, FormGroup } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { HasPermissionDirective } from '../../../../shared/has-permission.directive';

/** The values of the filter toolbar's form, stated as its own type so the builder constructs exactly these three non-nullable controls: without it the builder widens each starting value to its own literal type and the checkbox becomes a control of `false`, which no later tick could satisfy (Rule 1 clause 4). */
export interface FilterToolbarValues {
  /** The client-side display filter's text; narrows the rows in hand and never becomes a query. */
  filter: string;

  /** The find field's raw text; submitting the form hands it to the owner of the read. */
  find: string;

  /** Whether closed records are shown; a display filter like {@link filter}. */
  showClosed: boolean;
}

/** The list toolbar every list screen wears: the client-side filter field, the find field with its blue search button, the "Show Closed" checkbox and the permission-gated "Create Client" control (AAP 0.2.3 row `FilterToolbar`, whose props are the four outputs below; Figma node `1:3`, step 2 of "Sign in and open a client record"). **It owns the toolbar's state, not its screen's data.** The three controls live here as one typed, non-nullable reactive form, so a screen holding the rows never holds a form beside them: it binds {@link filterChange} and {@link showClosedChange} to its own display-filter state, and {@link search} to its read. **Every visual value comes from the global layer.** `.form-horizontal`, `.form-group`, `.form-control`, `.input-group`, `.input-group-btn`, `.checkbox`, `.btn.btn-primary.pull-right` and the `fa fa-search`/`fa fa-plus` glyphs are the legacy Bootstrap 3 markup and look the stylesheet carries (Rule 1 clause 6; AAP 0.2.3). **The markup is the legacy screen's own** (`app/views/clients/clients.html:20-40`), down to the element ids `filterText`, `find` and `showAll`, which are what the parity page objects and the screen's spec address the controls by (Rule 1 clause 3). **It issues no request and holds no data**: nothing here reads Fineract, injects a service or touches `HttpClient` (Rule 1 clause 5; AAP 0.14.1). */
@Component({
  selector: 'app-filter-toolbar',
  imports: [RouterLink, ReactiveFormsModule, TranslatePipe, HasPermissionDirective],
  templateUrl: './filter-toolbar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilterToolbarComponent {
  /** Whether a read is in flight, which disables the find field's search button so one click sends exactly one request (AAP 0.1.1; Figma node `1:3`). A screen passes its own read's state; `false` leaves the control live. */
  readonly busy = input<boolean>(false);

  /** The filter field's text, emitted whenever it changes — including a programmatic write, because the emission follows the control's own value stream rather than a DOM event. The owning screen narrows the rows it already holds with it; the text never becomes a request parameter (Rule 1 clauses 2 and 3; AAP 0.7.4; Figma node `1:3`). */
  readonly filterChange = output<string>();

  /** The find field's text, emitted when the toolbar's form is submitted, trimmed by nobody: the owning screen trims it, searches the server when it carries something and re-reads its first page when it is empty, exactly as the legacy controller does with the same field (`ClientController.search()`; Rule 1 clause 3; Figma node `1:3`). The name is fixed by the inventory row's own prop list, and `search` is also the name of a native DOM event, which is what `no-output-native` warns about; the warning does not apply because the binding lives on this component's own element, whose events are its own outputs, and the toolbar's fields are `type="text"`, which emit no `search` event. */
  readonly search = output<string>(); // eslint-disable-line @angular-eslint/no-output-native -- name fixed by the AAP 0.2.3 inventory

  /** Whether closed records are shown, emitted whenever the "Show Closed" checkbox changes. The owning screen narrows the rows it holds with it and issues no request (Rule 1 clause 3; Figma node `1:3`). */
  readonly showClosedChange = output<boolean>();

  /** Reports that the "Create Client" control was activated. The control keeps its own `routerLink="/createclient"` and its `hasPermission="CREATE_CLIENT"` gate, so the navigation stays declarative and this output reports the activation (AAP 0.7.4 "Clients list (`#/clients`)"; AAP 0.9.1 item 1, the permission-gated action; Figma node `1:3`). */
  readonly create = output<void>();

  /** The toolbar's own typed, non-nullable form: the filter text, the find text and the "Show Closed" flag (AAP 0.2.3 row `FilterToolbar`). Each control's value type is known to `strictTemplates` and no control can be `null` — the two text controls start empty and the checkbox starts unticked, which is the state the design shows (Rule 1 clause 4). Public because a caller's spec reads a control's own state here — the clients list's suite asserts that the filter control stays enabled while the screen holds rows — which the rendered DOM alone cannot express. */
  readonly form: FormGroup<{
    filter: FormControl<string>;
    find: FormControl<string>;
    showClosed: FormControl<boolean>;
  }> = inject(FormBuilder).nonNullable.group<FilterToolbarValues>({
    filter: '',
    find: '',
    showClosed: false,
  });

  constructor() {
    // The two display filters publish as they change, so the owner's state follows the controls and never reads them: this view is zoneless and `OnPush`, where a plain property read would leave a derived value holding its first verdict for ever.
    this.form.controls.filter.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((text) => this.filterChange.emit(text));

    this.form.controls.showClosed.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((showClosed) => this.showClosedChange.emit(showClosed));
  }

  /** Submits the toolbar: publishes the find field's text as it stands, for the owning screen to trim and act on. One submit publishes once, so a double press cannot publish twice. */
  protected onSubmit(): void {
    this.search.emit(this.form.controls.find.value);
  }

  /** Reports the "Create Client" control's activation, which the control's own `routerLink` turns into the navigation to the create form. */
  protected onCreate(): void {
    this.create.emit();
  }
}
