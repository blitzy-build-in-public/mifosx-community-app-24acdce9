import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PermissionsService } from '../../../../core/auth/permissions.service';
import { FilterToolbarComponent } from './filter-toolbar.component';

/** Behavioural spec for `FilterToolbarComponent`, the toolbar AAP 0.2.3's inventory requires (row `FilterToolbar`, whose props are the four outputs; Figma node `1:3`; Rule 1 clause 8, which allows no empty or boilerplate specs). It pins what the extraction must not change: the legacy element ids, names and control names (`#filterText`, `#find`, `#showAll`) the parity page objects and the list's own spec address it by (Rule 1 clause 3); the legacy Bootstrap 3 structure — `.form-horizontal` > `.form-group`, `.input-group` with `.input-group-btn`, the `fa fa-search` submit, `.checkbox` and `a.btn.btn-primary.pull-right` with `fa fa-plus` (Rule 1 clause 6); each of the four outputs publishing on the interaction the inventory names; the create control's own `routerLink="/createclient"` and `CREATE_CLIENT` gate, so the navigation stays declarative and the gate fails closed; and the search button disabling while a read is in flight (AAP 0.1.1 "duplicate-submission protection"). The gate is supplied at its real token with a stub typed against the real service, and the router is provided empty because no case completes a navigation. No translation bundle is served, so a bound key renders as that key — which makes "the legacy key is the one bound" an assertion, not a guess. */

/** The legacy code the create control is gated on in the template. */
const CREATE_CLIENT_CODE = 'CREATE_CLIENT';

/** The legacy ids the three controls carry, and the keys their captions come from. */
const FILTER_ID = 'filterText';
const FIND_ID = 'find';
const SHOW_CLOSED_ID = 'showAll';
const FILTER_KEY = 'label.input.filterbynameaccno';
const FIND_KEY = 'label.input.searchByNameAccNo';
const SEARCH_KEY = 'label.heading.search';

let grantedCodes: readonly string[] = [];

/** The half of `PermissionsService` the toolbar's permission gate reads, typed on the real class so the stub cannot drift from the directive's questions, and reading {@link grantedCodes} as its effect runs so a case can open the gate. */
class PermissionsStub implements Pick<PermissionsService, 'can' | 'has'> {
  /** Membership only; no case here asks a negated code through this member. */
  can(key: string): boolean {
    return grantedCodes.includes(key);
  }

  /** The directive-facing question, answered the same way. */
  has(key: string): boolean {
    return grantedCodes.includes(key);
  }
}

describe('FilterToolbarComponent', () => {
  let fixture: ComponentFixture<FilterToolbarComponent>;
  let component: FilterToolbarComponent;

  async function mount(): Promise<HTMLElement> {
    fixture = TestBed.createComponent(FilterToolbarComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  /** One typed lookup at the DOM boundary, failing by name when the control is absent. */
  function control<T extends Element>(host: HTMLElement, selector: string): T {
    const element = host.querySelector<T>(selector);
    if (element === null) {
      throw new Error(`the toolbar rendered no ${selector}`);
    }
    return element;
  }

  /** Types into a text field the way a user does, so the control's own listeners run. */
  function type(input: HTMLInputElement, text: string): void {
    input.value = text;
    input.dispatchEvent(new Event('input'));
  }

  beforeEach(() => {
    grantedCodes = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [FilterToolbarComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslateService(),
        { provide: PermissionsService, useValue: new PermissionsStub() },
      ],
    });
  });

  it('renders the legacy filter and find fields, the show-closed box and the search button', async () => {
    const host = await mount();

    const filter = control<HTMLInputElement>(host, `#${FILTER_ID}`);
    const find = control<HTMLInputElement>(host, `#${FIND_ID}`);
    const showClosed = control<HTMLInputElement>(host, `#${SHOW_CLOSED_ID}`);
    const form = control<HTMLFormElement>(host, 'form');

    // The legacy ids, names and control names, so the harness addresses the same controls on both applications and the label's `for` points at the input it names (Rule 1 clause 3).
    expect(filter.name).toBe(FILTER_ID);
    expect(find.name).toBe(FIND_ID);
    expect(showClosed.name).toBe(SHOW_CLOSED_ID);
    expect(showClosed.type).toBe('checkbox');

    // The legacy layout: `.form-horizontal` over `.form-group`, the find field in an `.input-group` with its own button, and the native checkbox inside that group (Rule 1 clause 6).
    expect(form.classList.contains('form-horizontal')).toBe(true);
    expect(form.querySelectorAll('.form-group')).toHaveLength(1);
    expect(control<HTMLElement>(host, '.input-group').querySelector(`#${FIND_ID}`)).toBe(find);
    // The choice is Bootstrap's plain `.checkbox` cell and not a `.form-control` box: the bordered input-shaped frame that class painted around it is not reproduced (AAP 0.5.2; AAP 0.2.3 row `FilterToolbar`).
    const choice = control<HTMLElement>(host, '.checkbox');
    expect(choice.classList.contains('form-control')).toBe(false);
    expect(control<HTMLElement>(host, '.input-group').contains(choice)).toBe(true);
    expect(host.querySelector('label')?.getAttribute('for')).toBe(SHOW_CLOSED_ID);

    // Both text fields carry the legacy bundle's key as their accessible name, because a placeholder is not a label; with no bundle served the pipe renders the key itself.
    expect(filter.getAttribute('aria-label')).toBe(FILTER_KEY);
    expect(find.getAttribute('aria-label')).toBe(FIND_KEY);
    expect(filter.getAttribute('placeholder')).toBe(FILTER_KEY);
    expect(find.getAttribute('placeholder')).toBe(FIND_KEY);
  });

  it('renders the search control as the blue submit button inside the find field’s button group', async () => {
    const host = await mount();

    const button = control<HTMLButtonElement>(host, '.input-group-btn button[type="submit"]');

    expect(button.classList.contains('btn')).toBe(true);
    expect(button.classList.contains('btn-primary')).toBe(true);
    // Its content is the decorative glyph, so the accessible name is the legacy word for the action.
    expect(button.querySelector('i.fa.fa-search')).not.toBeNull();
    expect(button.getAttribute('aria-label')).toBe(SEARCH_KEY);
  });

  it('publishes the filter text as the filter field changes', async () => {
    const host = await mount();
    const emitted: string[] = [];
    component.filterChange.subscribe((text) => emitted.push(text));

    type(control<HTMLInputElement>(host, `#${FILTER_ID}`), 'ada');

    expect(emitted).toEqual(['ada']);
    // The field's own text and nothing else: trimming is the screen's decision, not the toolbar's.
    type(control<HTMLInputElement>(host, `#${FILTER_ID}`), '  Kigali  ');
    expect(emitted).toEqual(['ada', '  Kigali  ']);
  });

  it('publishes the find field’s raw text when the form is submitted', async () => {
    const host = await mount();
    const emitted: string[] = [];
    component.search.subscribe((text) => emitted.push(text));

    type(control<HTMLInputElement>(host, `#${FIND_ID}`), `  "'Ada'"  `);
    control<HTMLFormElement>(host, 'form').dispatchEvent(new Event('submit'));

    // One submit publishes once, and the text arrives as the field holds it: the quote strip, the trim and the empty-field reload are the owning screen's (Rule 1 clause 3).
    expect(emitted).toEqual([`  "'Ada'"  `]);
  });

  it('publishes the show-closed flag as the box is ticked and cleared', async () => {
    const host = await mount();
    const emitted: boolean[] = [];
    component.showClosedChange.subscribe((showClosed) => emitted.push(showClosed));

    const box = control<HTMLInputElement>(host, `#${SHOW_CLOSED_ID}`);
    box.click();
    expect(emitted).toEqual([true]);

    box.click();
    expect(emitted).toEqual([true, false]);
  });

  it('disables the search button while a read is in flight', async () => {
    const host = await mount();
    const button = () => control<HTMLButtonElement>(host, '.input-group-btn button');

    expect(button().disabled).toBe(false);

    fixture.componentRef.setInput('busy', true);
    await fixture.whenStable();

    expect(button().disabled).toBe(true);

    fixture.componentRef.setInput('busy', false);
    await fixture.whenStable();

    expect(button().disabled).toBe(false);
  });

  it('keeps the create control’s own route and permission gate, and reports its activation', async () => {
    grantedCodes = [CREATE_CLIENT_CODE];
    const host = await mount();
    const activations: number[] = [];
    component.create.subscribe(() => activations.push(1));
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    const anchor = control<HTMLAnchorElement>(host, 'a.pull-right');

    // The primary action in the toolbar's right-hand column, with the legacy glyph beside its label (Rule 1 clause 6), and its destination declared on the link itself (AAP 0.7.4).
    expect(anchor.classList.contains('btn')).toBe(true);
    expect(anchor.classList.contains('btn-primary')).toBe(true);
    expect(anchor.querySelector('i.fa.fa-plus')).not.toBeNull();
    expect(anchor.getAttribute('href')).toBe('/createclient');

    anchor.click();

    expect(activations).toHaveLength(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0][0])).toBe('/createclient');
  });

  it('hides the create control, without removing it, while the user lacks CREATE_CLIENT', async () => {
    const host = await mount();

    const anchor = control<HTMLAnchorElement>(host, 'a.pull-right');

    // The gate fails closed: the control keeps its place in the toolbar and is not offered to a user the route would refuse (AAP 0.1.1; AAP 0.9.1 item 1).
    expect(anchor.style.display).toBe('none');
  });
});
