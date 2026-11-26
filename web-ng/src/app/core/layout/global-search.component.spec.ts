import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  GlobalSearchComponent, type GlobalSearchSubmission,
} from './global-search.component';

/** Behaviour of the navbar's global search control — the `GlobalSearch` row of the component inventory (AAP 0.2.3) and part of the clients list screen of the "Sign in and open a client record" flow (Figma node `1:3`, file. */

/** Legacy key of the field's placeholder, and the text this spec serves for it. */
const PLACEHOLDER_KEY = 'label.searchorpress';
const PLACEHOLDER_TEXT = 'Click or press alt+x to Search';

/** Legacy key of the field's accessible name, and the text this spec serves for it. */
const FIELD_LABEL_KEY = 'label.heading.search';
const FIELD_LABEL_TEXT = 'Search';

/** Key of the selector's accessible name. The selector narrows the search to one resource family. */
const SCOPE_FILTER_KEY = 'label.button.filter';
const SCOPE_FILTER_TEXT = 'Filter';

/** The three scopes, in the order the selector renders them: its value, its legacy label key, and the label this spec serves for that key. */
const SCOPES: readonly { readonly scope: string; readonly key: string; readonly label: string }[] = [
  { scope: 'all', key: 'label.search.scope.all', label: 'All scopes' }, {
    scope: 'clients', key: 'label.search.scope.clients.and.clientIdentifiers', label: 'Clients from the spec bundle',
  }, { scope: 'loans', key: 'label.input.adhoc.search.loans', label: 'Loans from the spec bundle' }, ];

/** Stand-in for the shipped bundles: one distinct value per key. */
const SPEC_BUNDLE: Record<string, string> = {
  [PLACEHOLDER_KEY]: PLACEHOLDER_TEXT, [FIELD_LABEL_KEY]: FIELD_LABEL_TEXT, [SCOPE_FILTER_KEY]: SCOPE_FILTER_TEXT,
  ...Object.fromEntries(SCOPES.map(({ key, label }) => [key, label])), };

/** The inputs whose surrounding quotes legacy strips before searching, with what it then searched for. */
const QUOTED_INPUTS: readonly {
  readonly label: string;
  readonly typed: string;
  readonly query: string;
}[] = [{ label: 'a pair of quotes', typed: '"Parity Client"', query: 'Parity Client' },
  { label: 'a leading quote alone', typed: '"Parity Client', query: 'Parity Client' },
  { label: 'a trailing quote alone', typed: 'Parity Client"', query: 'Parity Client' }, ];

describe('GlobalSearchComponent', () => {
  let fixture: ComponentFixture<GlobalSearchComponent>;
  let component: GlobalSearchComponent;

  /** Every payload the control has emitted, in emission order. */
  let emitted: GlobalSearchSubmission[];

  // `ComponentFixture.nativeElement` is typed `any` by Angular.
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The text field, which is the only `<input>` the control renders. */
  const field = (): HTMLInputElement => {
    const input = host().querySelector('input');
    if (input === null) {
      throw new Error('the search field is not rendered');
    }
    return input;
  };

  /** The scope selector, a native `<select>` rather than the legacy `chosen` plugin. */
  const selector = (): HTMLSelectElement => {
    const select = host().querySelector('select');
    if (select === null) {
      throw new Error('the scope selector is not rendered');
    }
    return select;
  };

  /** Types into the field the way a user does: the element's value is set and the event the value accessor listens to is dispatched. */
  function type(text: string): void {
    const input = field();
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /** Chooses a scope the way a user does, through the element's own change event. */
  function choose(scope: string): void {
    const select = selector();
    select.value = scope;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  /** Submits the form the way pressing Enter in the field does: the form's own submit event. */
  function submitForm(): void {
    const form = host().querySelector('form');
    if (form === null) {
      throw new Error('the search form is not rendered');
    }
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GlobalSearchComponent], providers: [provideTranslateService()],
    }).compileComponents();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', SPEC_BUNDLE, true);
    translate.use('en');
    fixture = TestBed.createComponent(GlobalSearchComponent);
    component = fixture.componentInstance;
    emitted = [];
    component.search.subscribe((submission: GlobalSearchSubmission) => emitted.push(submission));
    fixture.detectChanges();
  });

  it('renders one search field and one native scope selector in a search form', () => {
    const form = host().querySelector('form');
    expect(form).not.toBeNull();
    expect(form?.getAttribute('role')).toBe('search');
    expect(host().querySelectorAll('input')).toHaveLength(1);
    expect(host().querySelectorAll('select')).toHaveLength(1);
    expect(field().getAttribute('id')).toBe('search');
    expect(field().getAttribute('type')).toBe('text');
    // Both controls carry an id: the field's is legacy's own (`#search`).
    expect(selector().getAttribute('id')).toBe('search-scope');
    // The height, border and radius are the global navbar/form-control rules'.
    expect(field().classList.contains('form-control')).toBe(true);
    expect(selector().classList.contains('form-control')).toBe(true);
  });

  it('renders the three in-scope scopes, in order, with translated labels', () => {
    const options = Array.from(host().querySelectorAll('option'));
    expect(options.map((option) => option.value)).toEqual(SCOPES.map(({ scope }) => scope));
    expect(options.map((option) => option.textContent?.trim())).toEqual(SCOPES.map(({ label }) => label), );
    // A raw dotted key reaching the user is the failure the legacy bundles exist to prevent.
    expect(host().textContent).not.toContain('label.');
  });

  it('resolves its placeholder and its accessible names through the translation stack', () => {
    expect(field().getAttribute('placeholder')).toBe(PLACEHOLDER_TEXT);
    expect(field().getAttribute('aria-label')).toBe(FIELD_LABEL_TEXT);
    // The selector is named from the legacy bundle's own "Filter" label: a key that exists in every shipped bundle.
    expect(selector().getAttribute('aria-label')).toBe(SCOPE_FILTER_TEXT);
    // Every piece of text this control shows or announces is translated: no dotted key survives in the rendered copy or in either accessible name (AAP 0.10.2 "every label resolves").
    expect(host().textContent).not.toContain('.');
    expect(field().getAttribute('placeholder')).not.toContain('.');
    expect(field().getAttribute('aria-label')).not.toContain('.');
    expect(selector().getAttribute('aria-label')).not.toContain('.');
  });

  it('defaults the scope to "all" and emits nothing until the form is submitted', () => {
    expect(component.scope.value).toBe('all');
    expect(selector().value).toBe('all');
    type('Parity Client');
    expect(emitted).toEqual([]);
  });

  it('focuses the field on legacy alt+x without disturbing what is typed', () => {
    type('Marcus');
    const input = field();
    input.blur();
    expect(document.activeElement).not.toBe(input);

    // The chord legacy bound to `document.getElementById('search').focus()` (app/scripts/controllers/main/MainController.js:330) and the one the placeholder advertises.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', altKey: true, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    expect(document.activeElement).toBe(input);
    // The shortcut moves the caret and nothing else: no submission, and the text stays as typed.
    expect(input.value).toBe('Marcus');
    expect(emitted).toEqual([]);
  });

  it('emits the trimmed query with the default scope and no exact match when the form is submitted', () => {
    type('  Parity Client  ');
    submitForm();
    expect(emitted).toEqual([{ query: 'Parity Client', scope: 'all', exactMatch: false }]);
  });

  it('leaves the field holding exactly what the user typed', () => {
    type('  Parity Client  ');
    submitForm();

    // Trimming is the emitted payload's business.
    expect(field().value).toBe('  Parity Client  ');
    expect(component.query.value).toBe('  Parity Client  ');
  });
  for (const { label, typed, query } of QUOTED_INPUTS) {
    it(`strips ${label} before searching and reports exactMatch`, () => {
      type(typed);
      submitForm();

      expect(emitted).toEqual([{ query, scope: 'all', exactMatch: true }]);
      // Only the emitted text is unquoted: the field keeps exactly what the user typed, quotes and all, so nothing changes under them while the component is still in front of them.
      expect(field().value).toBe(typed);
    });
  }

  it('emits nothing for a query that is nothing but its own quotes', () => {
    // Stripped to nothing, it is the blank search the control already refuses rather than a navigation to an empty `/search/` segment.
    type('""');
    submitForm();

    expect(emitted).toEqual([]);
  });

  it('emits nothing for an empty or whitespace-only query', () => {
    submitForm();

    type('   ');
    submitForm();

    expect(emitted).toEqual([]);
  });

  it('emits the scope the user selected before submitting', () => {
    type('Parity Client');
    choose('loans');
    submitForm();

    expect(emitted).toEqual([{ query: 'Parity Client', scope: 'loans', exactMatch: false }]);

    choose('clients');
    submitForm();

    expect(emitted.at(-1)).toEqual({ query: 'Parity Client', scope: 'clients', exactMatch: false });
  });

  it('reports each submission separately, as legacy did', () => {
    type('Ada Okafor');
    submitForm();
    submitForm();

    expect(emitted).toHaveLength(2);
    expect(emitted).toEqual([
      { query: 'Ada Okafor', scope: 'all', exactMatch: false },
      { query: 'Ada Okafor', scope: 'all', exactMatch: false },
    ]);
  });
});
