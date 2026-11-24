import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FormControl, Validators } from '@angular/forms';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SelectFieldComponent, type SelectOption, type SelectValue } from './select-field.component';

/**
 * Options in the shape a Fineract `template` endpoint returns them, with deliberately out-of-order
 * ids: the spec proves the received order survives rendering and that the caller receives the
 * option's id rather than its position in the list.
 */
const OFFICES: readonly SelectOption[] = [
  { id: 3, name: 'Head Office' },
  { id: 1, name: 'Branch One' },
  { id: 2, name: 'Branch Two' },
];

/** The inputs a test overrides; every other input keeps the component's own default. */
interface FieldInputs {
  readonly placeholder?: string;
  readonly label?: string;
  readonly required?: boolean;
}

/**
 * Reads the component's single `<select>`. The cast is the test-DOM boundary: `ComponentFixture`
 * exposes `nativeElement` untyped, and everything reached below it is narrowed by its own check.
 */
function renderedSelect(fixture: ComponentFixture<SelectFieldComponent>): HTMLSelectElement {
  const select = (fixture.nativeElement as HTMLElement).querySelector('select');

  if (!(select instanceof HTMLSelectElement)) {
    throw new Error('SelectFieldComponent rendered no <select> element');
  }

  return select;
}

/** Reads the enclosing `.form-group`, the element that carries the Bootstrap validation state. */
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

/**
 * Chooses the option carrying `name` the way a user does: by position plus the `change` event
 * `SelectControlValueAccessor` listens to. The option's DOM `value` string is deliberately never
 * written or asserted on — `[ngValue]` gives each option an index-based value, so it says nothing
 * about the id the caller's control receives.
 */
function chooseOption(select: HTMLSelectElement, name: string): void {
  const index = optionTexts(select).indexOf(name);

  if (index < 0) {
    throw new Error(`SelectFieldComponent rendered no option named "${name}"`);
  }

  select.selectedIndex = index;
  select.dispatchEvent(new Event('change'));
}

/** Label of the option the `<select>` currently shows, or `undefined` when none is selected. */
function selectedText(select: HTMLSelectElement): string | undefined {
  return select.options[select.selectedIndex]?.textContent?.trim();
}

describe('SelectFieldComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SelectFieldComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** Renders the field with the inputs every caller supplies, then applies the overrides. */
  function createField(
    control: FormControl<SelectValue | null>,
    inputs: FieldInputs = {},
  ): ComponentFixture<SelectFieldComponent> {
    const fixture = TestBed.createComponent(SelectFieldComponent);

    fixture.componentRef.setInput('options', OFFICES);
    fixture.componentRef.setInput('control', control);
    fixture.componentRef.setInput('inputId', 'office');

    if (inputs.placeholder !== undefined) {
      fixture.componentRef.setInput('placeholder', inputs.placeholder);
    }
    if (inputs.label !== undefined) {
      fixture.componentRef.setInput('label', inputs.label);
    }
    if (inputs.required !== undefined) {
      fixture.componentRef.setInput('required', inputs.required);
    }

    fixture.detectChanges();

    return fixture;
  }

  it('renders one option per entry, in the order the template endpoint returned them', () => {
    const fixture = createField(new FormControl<SelectValue | null>(null));
    const select = renderedSelect(fixture);

    expect(select.options).toHaveLength(OFFICES.length);
    expect(optionTexts(select)).toEqual(['Head Office', 'Branch One', 'Branch Two']);
  });

  it('renders no placeholder option unless a placeholder is supplied', () => {
    const plain = renderedSelect(createField(new FormControl<SelectValue | null>(null)));

    expect(plain.options).toHaveLength(OFFICES.length);
    expect(optionTexts(plain)).not.toContain('');

    const control = new FormControl<SelectValue | null>(null);
    const select = renderedSelect(createField(control, { placeholder: 'Select an office' }));

    expect(select.options).toHaveLength(OFFICES.length + 1);
    expect(optionTexts(select)[0]).toBe('Select an office');

    chooseOption(select, 'Branch Two');
    expect(control.value).toBe(2);

    select.selectedIndex = 0;
    select.dispatchEvent(new Event('change'));

    expect(control.value).toBeNull();
  });

  it('writes the original numeric id to the caller\'s control, never a stringified copy', () => {
    const control = new FormControl<SelectValue | null>(null);
    const select = renderedSelect(createField(control));

    chooseOption(select, 'Branch One');

    expect(control.value).toBe(1);
    expect(typeof control.value).toBe('number');
    expect(JSON.stringify({ officeId: control.value })).toBe('{"officeId":1}');

    // 'Head Office' sits at index 0 and carries id 3, so this separates the id from the position.
    chooseOption(select, 'Head Office');

    expect(control.value).toBe(3);
    expect(JSON.stringify({ officeId: control.value })).toBe('{"officeId":3}');
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

  it('renders the control label, wired to the select id, only when a label is supplied', () => {
    const unlabelled = createField(new FormControl<SelectValue | null>(null));

    expect(unlabelled.nativeElement.querySelector('label')).toBeNull();
    expect(renderedSelect(unlabelled).id).toBe('office');

    const labelled = createField(new FormControl<SelectValue | null>(null), { label: 'Office' });
    const label = labelled.nativeElement.querySelector('label');

    expect(label?.textContent?.trim()).toBe('Office');
    expect(label?.getAttribute('for')).toBe(renderedSelect(labelled).id);
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
