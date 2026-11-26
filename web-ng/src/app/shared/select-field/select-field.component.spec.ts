import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FormControl, Validators } from '@angular/forms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SelectFieldComponent, type SelectOption, type SelectValue } from './select-field.component';

/** Options in the shape a Fineract `template` endpoint returns them, with deliberately out-of-order ids: the spec proves the received order survives rendering and that the caller receives the option's id rather than its position in the list. */
const OFFICES: readonly SelectOption[] = [{ id: 3, name: 'Head Office' }, { id: 1, name: 'Branch One' }, { id: 2, name: 'Branch Two' }, ];

/** Two options a feature service can hand in with one id, because `shared/` cannot enforce uniqueness on a caller's `number | string` id: the rendered rows must stay one per entry, in order, and each option must still write its own id to the control. */
const DUPLICATE_ID_OPTIONS: readonly SelectOption[] = [{ id: 7, name: 'Branch Seven' }, { id: 7, name: 'Branch Seven (archived)' }, ];

/** The inputs a test overrides; every other input keeps the component's own default. */
interface FieldInputs {
  readonly options?: readonly SelectOption[];
  readonly placeholder?: string;
  readonly label?: string;
  readonly ariaLabel?: string;
  readonly required?: boolean;
  readonly describedBy?: string;
}

/** Reads the component's single `<select>`. The cast is the test-DOM boundary: `ComponentFixture` exposes `nativeElement` untyped, and everything reached below it is narrowed by its own check. */
function renderedSelect(fixture: ComponentFixture<SelectFieldComponent>): HTMLSelectElement {
  const select = (fixture.nativeElement as HTMLElement).querySelector('select');

  if (!(select instanceof HTMLSelectElement)) {
    throw new Error('SelectFieldComponent rendered no <select> element');
  }

  return select;
}

function renderedGroup(fixture: ComponentFixture<SelectFieldComponent>): HTMLElement {
  const group = (fixture.nativeElement as HTMLElement).querySelector('div.form-group');

  if (!(group instanceof HTMLElement)) {
    throw new Error('SelectFieldComponent rendered no div.form-group element');
  }

  return group;
}

/** Option labels in render order, trimmed so template indentation cannot mask a mismatch. */
function optionTexts(select: HTMLSelectElement): (string | undefined)[] {
  return Array.from(select.options, (option) => option.textContent?.trim());
}

/** The leading prompt option a supplied `placeholder` renders, read through its live DOM state. */
function promptOption(select: HTMLSelectElement): HTMLOptionElement {
  const prompt = select.options[0];

  if (!(prompt instanceof HTMLOptionElement)) {
    throw new Error('SelectFieldComponent rendered no placeholder option');
  }

  return prompt;
}

/** Chooses the option carrying `name` the way a user does: by position plus the `change` event `SelectControlValueAccessor` listens to. The option's DOM `value` string is deliberately never written or asserted on — `[ngValue]` gives each option an index-based value, so it says nothing about the id the caller's control receives. */
function chooseOption(select: HTMLSelectElement, name: string): void {
  const index = optionTexts(select).indexOf(name);

  if (index < 0) {
    throw new Error(`SelectFieldComponent rendered no option named "${name}"`);
  }

  select.selectedIndex = index;
  select.dispatchEvent(new Event('change'));
}

function selectedText(select: HTMLSelectElement): string | undefined {
  return select.options[select.selectedIndex]?.textContent?.trim();
}

describe('SelectFieldComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SelectFieldComponent], providers: [provideZonelessChangeDetection()], }).compileComponents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function createField(control: FormControl<SelectValue | null>, inputs: FieldInputs = {}, ): ComponentFixture<SelectFieldComponent> {
    const fixture = TestBed.createComponent(SelectFieldComponent);

    fixture.componentRef.setInput('options', inputs.options ?? OFFICES);
    fixture.componentRef.setInput('control', control);
    fixture.componentRef.setInput('inputId', 'office');

    if (inputs.placeholder !== undefined) {
      fixture.componentRef.setInput('placeholder', inputs.placeholder);
    }
    if (inputs.label !== undefined) {
      fixture.componentRef.setInput('label', inputs.label);
    }
    if (inputs.ariaLabel !== undefined) {
      fixture.componentRef.setInput('ariaLabel', inputs.ariaLabel);
    }
    if (inputs.required !== undefined) {
      fixture.componentRef.setInput('required', inputs.required);
    }
    if (inputs.describedBy !== undefined) {
      fixture.componentRef.setInput('describedBy', inputs.describedBy);
    }

    fixture.detectChanges();

    return fixture;
  }

  /** Collects every `valueChange` emission, so a case can assert both the selection the field reports and that a path which publishes nothing really stayed silent. */
  function recordValueChanges(fixture: ComponentFixture<SelectFieldComponent>, ): (SelectValue | null)[] {
    const emitted: (SelectValue | null)[] = [];

    fixture.componentInstance.valueChange.subscribe((value) => emitted.push(value));

    return emitted;
  }

  it('renders one option per entry, in the order the template endpoint returned them', () => {
    const fixture = createField(new FormControl<SelectValue | null>(null));
    const select = renderedSelect(fixture);
    const group = renderedGroup(fixture);

    expect(select.options).toHaveLength(OFFICES.length);
    expect(optionTexts(select)).toEqual(['Head Office', 'Branch One', 'Branch Two']);

    // The Bootstrap 3 markup is the control's whole look, so it is part of what renders here: `.form-control` is what gives the native select its 34px height and #E0E0E0 border (AAP 0.5.2, AAP 0.5.3 control height, Rule 1 clause 6), and `.form-group` is the element the `.has-error` state lands on.
    expect(select.classList.contains('form-control')).toBe(true);
    expect(group.classList.contains('form-group')).toBe(true);
    expect(select.parentElement).toBe(group);
  });

  it('renders both options that share one id, in order, and writes each id to the control', () => {
    // Angular reports a duplicated track key through `console.warn` in dev mode and renders on, so the console is the observable a positional track has to keep quiet: `track option.id` emits NG0955 here, once per duplicated key.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const control = new FormControl<SelectValue | null>(null);
    const fixture = createField(control, { options: DUPLICATE_ID_OPTIONS });
    const select = renderedSelect(fixture);

    expect(select.options).toHaveLength(DUPLICATE_ID_OPTIONS.length);
    expect(optionTexts(select)).toEqual(['Branch Seven', 'Branch Seven (archived)']);

    chooseOption(select, 'Branch Seven (archived)');

    expect(control.value).toBe(7);
    expect(selectedText(select)).toBe('Branch Seven (archived)');

    chooseOption(select, 'Branch Seven');

    expect(control.value).toBe(7);
    expect(selectedText(select)).toBe('Branch Seven');

    expect(warn.mock.calls.filter((call) => String(call[0]).includes('NG0955'))).toHaveLength(0);
  });

  it('renders a selectable prompt row only when a placeholder is supplied, as legacy chosen does', () => {
    const plain = renderedSelect(createField(new FormControl<SelectValue | null>(null)));

    expect(plain.options).toHaveLength(OFFICES.length);
    expect(optionTexts(plain)).not.toContain('');

    const control = new FormControl<SelectValue | null>(null);
    const fixture = createField(control, { placeholder: 'Select an office' });
    const select = renderedSelect(fixture);

    expect(select.options).toHaveLength(OFFICES.length + 1);
    expect(optionTexts(select)[0]).toBe('Select an office');

    // The prompt carries visible text, which is exactly what makes chosen render a legacy prompt as an ordinary results row: it stays selectable after a value exists, so a user can clear the field.
    expect(promptOption(select).disabled).toBe(false);

    chooseOption(select, 'Branch Two');
    fixture.detectChanges();

    expect(control.value).toBe(2);
    expect(selectedText(select)).toBe('Branch Two');
    expect(promptOption(select).disabled).toBe(false);

    // Choosing the prompt row writes the empty value back, the way a legacy user clears the selection.
    select.selectedIndex = 0;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(control.value).toBeNull();
    expect(selectedText(select)).toBe('Select an office');
  });

  it('writes the original numeric id to the caller\'s control, never a stringified copy', () => {
    const control = new FormControl<SelectValue | null>(null);
    const select = renderedSelect(createField(control));

    chooseOption(select, 'Branch One');

    expect(control.value).toBe(1);
    expect(typeof control.value).toBe('number');
    expect(JSON.stringify({ officeId: control.value })).toBe('{"officeId":1}');

    chooseOption(select, 'Head Office');

    expect(control.value).toBe(3);
    expect(JSON.stringify({ officeId: control.value })).toBe('{"officeId":3}');
  });

  /** The contract the loan screens bind: the field publishes the selection itself, so no consumer depends on the host element's DOM `change` event (AAP 0.2.3). */
  it('publishes the newly chosen id, never the previous selection, when the select changes', () => {
    const control = new FormControl<SelectValue | null>(null);
    const fixture = createField(control);
    const select = renderedSelect(fixture);
    const emitted = recordValueChanges(fixture);

    chooseOption(select, 'Branch Two');

    expect(emitted).toEqual([2]);
    expect(emitted[0]).toBe(control.value);

    chooseOption(select, 'Head Office');

    expect(emitted).toEqual([2, 3]);
    expect(emitted[1]).toBe(control.value);
  });

  it('publishes the id with the option\'s own runtime type, never a stringified copy', () => {
    const control = new FormControl<SelectValue | null>(null);
    const fixture = createField(control);
    const emitted = recordValueChanges(fixture);

    chooseOption(renderedSelect(fixture), 'Branch One');

    expect(emitted).toEqual([1]);
    expect(typeof emitted[0]).toBe('number');
    expect(JSON.stringify({ officeId: emitted[0] })).toBe('{"officeId":1}');
  });

  it('publishes null when the user chooses the prompt row', () => {
    const control = new FormControl<SelectValue | null>(null);
    const fixture = createField(control, { placeholder: 'Select an office' });
    const select = renderedSelect(fixture);
    const emitted = recordValueChanges(fixture);

    chooseOption(select, 'Branch Two');

    expect(emitted).toEqual([2]);

    select.selectedIndex = 0;
    select.dispatchEvent(new Event('change'));

    expect(emitted).toEqual([2, null]);
    expect(control.value).toBeNull();
  });

  it('publishes nothing when the parent writes the control programmatically', () => {
    const control = new FormControl<SelectValue | null>(null);
    const fixture = createField(control);
    const emitted = recordValueChanges(fixture);

    control.setValue(2);
    fixture.detectChanges();

    expect(selectedText(renderedSelect(fixture))).toBe('Branch Two');
    expect(emitted).toEqual([]);
  });

  it('reflects a value written to the control in the rendered selection', () => {
    const control = new FormControl<SelectValue | null>(null);
    const fixture = createField(control);
    const select = renderedSelect(fixture);

    expect(selectedText(select)).toBeUndefined();

    control.setValue(2);
    fixture.detectChanges();

    expect(selectedText(select)).toBe('Branch Two');
  });

  it('shows the has-error state only when the control is invalid and touched or dirty', () => {
    const touchedControl = new FormControl<SelectValue | null>(null, Validators.required);
    const touchedFixture = createField(touchedControl);
    const touchedGroup = renderedGroup(touchedFixture);

    expect(touchedGroup.classList.contains('has-error')).toBe(false);

    touchedControl.markAsTouched();
    touchedFixture.detectChanges();

    expect(touchedGroup.classList.contains('has-error')).toBe(true);

    touchedControl.setValue(1);
    touchedFixture.detectChanges();

    expect(touchedGroup.classList.contains('has-error')).toBe(false);

    const dirtyControl = new FormControl<SelectValue | null>(null, Validators.required);
    const dirtyFixture = createField(dirtyControl);
    const dirtyGroup = renderedGroup(dirtyFixture);

    expect(dirtyGroup.classList.contains('has-error')).toBe(false);

    dirtyControl.markAsDirty();
    dirtyFixture.detectChanges();

    expect(dirtyGroup.classList.contains('has-error')).toBe(true);
  });

  it('publishes aria-invalid with the has-error state, only once an invalid control is touched', () => {
    const control = new FormControl<SelectValue | null>(null, Validators.required);
    const fixture = createField(control);
    const select = renderedSelect(fixture);

    expect(control.invalid).toBe(true);
    expect(control.touched).toBe(false);
    expect(renderedGroup(fixture).classList.contains('has-error')).toBe(false);
    expect(select.hasAttribute('aria-invalid')).toBe(false);

    control.markAsTouched();
    fixture.detectChanges();

    expect(renderedGroup(fixture).classList.contains('has-error')).toBe(true);
    expect(select.getAttribute('aria-invalid')).toBe('true');

    control.setValue(2);
    fixture.detectChanges();

    expect(control.invalid).toBe(false);
    expect(renderedGroup(fixture).classList.contains('has-error')).toBe(false);
    expect(select.hasAttribute('aria-invalid')).toBe(false);
  });

  it('renders the control label, wired to the select id, only when a label is supplied', () => {
    const unlabelled = createField(new FormControl<SelectValue | null>(null));

    expect(unlabelled.nativeElement.querySelector('label')).toBeNull();
    expect(renderedSelect(unlabelled).id).toBe('office');

    const labelled = createField(new FormControl<SelectValue | null>(null), { label: 'Office' });
    const label = labelled.nativeElement.querySelector('label');

    expect(label?.textContent?.trim()).toBe('Office');
    expect(label?.getAttribute('for')).toBe(renderedSelect(labelled).id);
  });

  /** The accessible-name rule, stated exactly as the sibling `shared/date-field` spec states it since both fields sit on the same forms: `ariaLabel` alone names the control, a visible `label` names it and suppresses the attribute (WCAG label in name, so a caller supplying both never overrides its own visible text), and neither supplied leaves the shipped legacy markup — an unnamed control with no attribute at all — exactly as it was. */
  const accessibleNameCases: readonly {
    readonly scenario: string;
    readonly label?: string;
    readonly ariaLabel?: string;
    readonly visibleLabel: boolean;
    readonly accessibleName: string | null;
  }[] = [{
      scenario: 'names the select from ariaLabel while rendering no visible label', ariaLabel: 'Office', visibleLabel: false,
      accessibleName: 'Office', }, {
      scenario: 'lets a visible label supply the name and renders no aria-label beside it', label: 'Office', ariaLabel: 'Reporting office',
      visibleLabel: true, accessibleName: null, }, {
      scenario: 'renders neither a label nor an aria-label when neither input is supplied', visibleLabel: false, accessibleName: null, }, ];

  it.each(accessibleNameCases)('$scenario', ({ label, ariaLabel, visibleLabel, accessibleName }) => {
    const fixture = createField(new FormControl<SelectValue | null>(null), { label, ariaLabel });
    const select = renderedSelect(fixture);

    const renderedLabels = fixture.nativeElement.querySelectorAll('label');
    expect(renderedLabels).toHaveLength(visibleLabel ? 1 : 0);
    expect(select.getAttribute('aria-label')).toBe(accessibleName);

    if (visibleLabel) {
      expect(renderedLabels[0]?.getAttribute('for')).toBe(select.id);
    }
  });

  /** The description rule, stated exactly as the sibling `shared/date-field` spec states it since both fields sit on the same forms: the caller owns the message and the field only carries its id, and an empty id leaves the attribute off altogether — the state a valid field is in. */
  it('names the element carrying its message only while a caller supplies one', () => {
    const undescribed = renderedSelect(createField(new FormControl<SelectValue | null>(null)));

    expect(undescribed.hasAttribute('aria-describedby')).toBe(false);

    const described = renderedSelect(
      createField(new FormControl<SelectValue | null>(null), {
        describedBy: 'client-action-reason-error',
      }),
    );

    expect(described.getAttribute('aria-describedby')).toBe('client-action-reason-error');
  });

  it('marks the field required for assistive technology only', () => {
    const fixture = createField(new FormControl<SelectValue | null>(null));
    const select = renderedSelect(fixture);

    expect(select.getAttribute('aria-required')).toBeNull();

    fixture.componentRef.setInput('required', true);
    fixture.detectChanges();

    expect(select.getAttribute('aria-required')).toBe('true');
    expect(select.hasAttribute('required')).toBe(false);
  });
});
