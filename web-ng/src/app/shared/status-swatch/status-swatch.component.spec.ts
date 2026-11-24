import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  StatusSwatchComponent,
  type StatusKey,
  type StatusSwatchVariant,
} from './status-swatch.component';

/**
 * Behavioural spec for `StatusSwatchComponent`, the design's status indicator (AAP 0.2.3
 * component inventory row `StatusSwatch`; AAP 0.5.4 gaps inventory row "Status indicator";
 * AAP 0.7.1 shared row `StatusSwatchComponent`).
 *
 * Each assertion states a contract the component owns:
 * - one decorative span per instance and never a word, because the indicator is colour only and
 *   the caller owns the status text (AAP 0.10.5 deliberate difference 11, Rule 1 clause 3);
 * - the span is `aria-hidden`, so it adds nothing to the accessible name of the row or record
 *   that renders it;
 * - exactly the base `status-swatch` class plus one colour class per `StatusKey` — the classes
 *   `web-ng/src/styles.scss` paints (AAP 0.2.2 colour tokens, Rule 1 clause 6);
 * - the list's square by default and the record header's dot on request, with `status-swatch`
 *   retained so the base geometry rule keeps applying (AAP 0.2.3 rows `StatusSwatch` and
 *   `RecordHeader`);
 * - `status-other` for a key outside the union, so a value arriving from untyped data can never
 *   reach the class list as text.
 */

/** The colour class each key paints, exactly as `web-ng/src/styles.scss` declares it. */
const COLOUR_CLASSES: readonly (readonly [StatusKey, string])[] = [
  ['active', 'status-active'],
  ['pending', 'status-pending'],
  ['closed', 'status-closed'],
  ['other', 'status-other'],
];

/**
 * Creates the component with its inputs bound before the first change detection: `status` is
 * `input.required<StatusKey>()`, and `variant` is left untouched when a test means to observe the
 * component's own default.
 */
function createSwatch(
  status: StatusKey,
  variant?: StatusSwatchVariant,
): ComponentFixture<StatusSwatchComponent> {
  const fixture = TestBed.createComponent(StatusSwatchComponent);
  fixture.componentRef.setInput('status', status);
  if (variant !== undefined) {
    fixture.componentRef.setInput('variant', variant);
  }
  fixture.detectChanges();
  return fixture;
}

/**
 * The fixture's host element. `ComponentFixture.nativeElement` is typed `any` by Angular;
 * narrowing it once here keeps every assertion below type-checked and confines this spec's only
 * cast to this line (Rule 1 clause 4).
 */
function hostOf(fixture: ComponentFixture<StatusSwatchComponent>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/** The template's single span, or a named failure when the component rendered none. */
function spanOf(host: HTMLElement): HTMLElement {
  const element: unknown = host.firstElementChild;
  if (!(element instanceof HTMLElement)) {
    throw new Error('StatusSwatchComponent rendered no span');
  }
  return element;
}

/** A freshly rendered component's span. */
function swatchOf(status: StatusKey, variant?: StatusSwatchVariant): HTMLElement {
  return spanOf(hostOf(createSwatch(status, variant)));
}

/** The span's class attribute as written, `''` when the template bound none. */
function classAttributeOf(element: HTMLElement): string {
  return element.getAttribute('class') ?? '';
}

/**
 * The span's class tokens, sorted. Splitting on single spaces turns a leading, trailing or doubled
 * space into an empty token, so an assertion on the result rejects stray whitespace; the order the
 * DOM stores the tokens in is not part of the contract, so it is normalised away.
 */
function classTokensOf(element: HTMLElement): string[] {
  return classAttributeOf(element).split(' ').sort();
}

describe('StatusSwatchComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StatusSwatchComponent] }).compileComponents();
  });

  it('renders exactly one span, with no child element and no text', () => {
    const host = hostOf(createSwatch('active'));
    const element = spanOf(host);

    expect(host.childElementCount).toBe(1);
    expect(element.tagName).toBe('SPAN');
    expect(element.childElementCount).toBe(0);
    expect(element.childNodes).toHaveLength(0);
    expect(element.textContent).toBe('');
    expect(host.textContent).toBe('');
  });

  it('marks the span aria-hidden, because the caller owns the accessible status text', () => {
    const element = swatchOf('pending');

    expect(element.getAttribute('aria-hidden')).toBe('true');
    expect(element.hasAttribute('aria-label')).toBe(false);
    expect(element.hasAttribute('role')).toBe(false);
  });

  it.each(COLOUR_CLASSES)(
    'paints %s as the base class plus the single colour class %s',
    (status: StatusKey, colourClass: string) => {
      const element = swatchOf(status);

      expect(element.classList.contains('status-swatch')).toBe(true);
      expect(element.classList.contains(colourClass)).toBe(true);
      expect(element.classList.length).toBe(2);
      expect(classTokensOf(element)).toEqual(['status-swatch', colourClass].sort());
    },
  );

  it('defaults to the list square, so the record dot class is absent unless asked for', () => {
    const element = swatchOf('active');

    expect(element.classList.contains('status-dot')).toBe(false);
    expect(element.classList.length).toBe(2);
    expect(classTokensOf(element)).toEqual(['status-active', 'status-swatch']);
  });

  it('adds status-dot for the dot variant while retaining the base class and the colour', () => {
    const element = swatchOf('active', 'dot');

    expect(element.classList.contains('status-swatch')).toBe(true);
    expect(element.classList.contains('status-dot')).toBe(true);
    expect(element.classList.contains('status-active')).toBe(true);
    expect(element.classList.length).toBe(3);
    expect(classTokensOf(element)).toEqual(['status-active', 'status-dot', 'status-swatch']);
  });

  it.each([
    ['a status outside the union', 'suspended'],
    ['a value that would inject a second class', 'active status-dot'],
  ])('falls back to status-other for %s', (_description: string, rawStatus: string) => {
    // `strictTemplates` type-checks every compile-time caller against the `StatusKey` union, so
    // this cast stands for the one input the component cannot type: a value that arrives from
    // untyped data at run time. It is the spec's deliberate boundary cast (Rule 1 clause 4).
    const status = rawStatus as unknown as StatusKey;

    const element = swatchOf(status);

    expect(element.classList.contains('status-other')).toBe(true);
    expect(element.classList.length).toBe(2);
    expect(classTokensOf(element)).toEqual(['status-other', 'status-swatch']);
    expect(classAttributeOf(element)).not.toContain(rawStatus);
  });

  it('carries colour only: no title, no data attribute and no other attribute at all', () => {
    const element = swatchOf('closed', 'dot');

    // The DOM reports the statically written attribute before the class the binding sets, so the
    // names are compared sorted: the contract is which attributes exist, not the order.
    expect(element.getAttributeNames().sort()).toEqual(['aria-hidden', 'class']);
    expect(element.getAttribute('title')).toBeNull();
  });

  it('recomputes the class list when an input changes', () => {
    const fixture = createSwatch('pending');
    const host = hostOf(fixture);

    expect(classTokensOf(spanOf(host))).toEqual(['status-pending', 'status-swatch']);

    fixture.componentRef.setInput('variant', 'dot');
    fixture.detectChanges();

    expect(classTokensOf(spanOf(host))).toEqual([
      'status-dot',
      'status-pending',
      'status-swatch',
    ]);

    fixture.componentRef.setInput('status', 'closed');
    fixture.detectChanges();

    expect(classTokensOf(spanOf(host))).toEqual(['status-closed', 'status-dot', 'status-swatch']);
  });
});
