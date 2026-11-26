import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { EmptyStateComponent } from './empty-state.component';

describe('EmptyStateComponent', () => {
  // Angular types `nativeElement`/`firstElementChild` loosely; these two casts are the only boundary in this spec, so every assertion below stays type-checked.
  function render(message: string): HTMLElement {
    const fixture = TestBed.createComponent(EmptyStateComponent);
    // `message` is `input.required<string>()`, so it is set before the first change detection.
    fixture.componentRef.setInput('message', message);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function root(host: HTMLElement): HTMLElement {
    const element = host.firstElementChild as HTMLElement | null;
    if (element === null) {
      throw new Error('the empty state must render its root element');
    }
    return element;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EmptyStateComponent] }).compileComponents();
  });

  it('renders the supplied message verbatim', () => {
    const host = render('No clients found.');
    expect(host.textContent).toBe('No clients found.');
  });

  it('renders one root element carrying exactly the two design-system classes', () => {
    const host = render('No clients found.');
    const element = root(host);
    expect(host.childElementCount).toBe(1);
    expect(element.tagName).toBe('DIV');
    expect(element.classList.contains('text-center')).toBe(true);
    expect(element.classList.contains('text-muted')).toBe(true);
    expect(element.classList.length).toBe(2);
  });

  it('announces itself as a polite status region, with no visual change', () => {
    const element = root(render('No clients found.'));

    // The empty state is a state, not an error: `role="status"` is the polite live region that announces it when it replaces the rows, and it is an attribute rather than a class or an extra element, so nothing about the look changes (AAP 0.7.4 state rules).
    expect(element.getAttribute('role')).toBe('status');
    expect(element.classList.length).toBe(2);
  });

  it('renders nothing beyond the message: no icon, action or error markup', () => {
    const host = render('No loans found.');
    const element = root(host);
    expect(element.childElementCount).toBe(0);
    expect(element.querySelectorAll('button, a, img, svg, i, input, select, textarea, .alert, .text-danger'), ).toHaveLength(0);
    expect(element.textContent).toBe('No loans found.');
  });

  it('interpolates markup characters as text instead of injecting markup', () => {
    const message = 'No <clients> & no loans';
    const element = root(render(message));
    expect(element.textContent).toBe(message);
    expect(element.querySelector('clients, loans')).toBeNull();
  });

  it('re-renders the message when the input value changes', () => {
    const fixture = TestBed.createComponent(EmptyStateComponent);
    fixture.componentRef.setInput('message', 'First');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toBe('First');

    fixture.componentRef.setInput('message', 'Second');
    fixture.detectChanges();

    expect(host.textContent).toBe('Second');
  });

  it('renders an empty element for an empty message rather than fallback copy', () => {
    const host = render('');
    expect(host.childElementCount).toBe(1);
    expect(host.textContent).toBe('');
  });
});
