import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { TabStripComponent, type TabDescriptor } from './tab-strip.component';

/** Behavioural spec for the client record's tab strip — the `TabStrip` row of the component inventory, whose one state is "one active of N" (AAP 0.2.3), on the record the flow's third screen shows (Figma node `1:4`) (Rule 1 clause 6, AAP 0.11.1, AAP 0.14.1, Rule 1 clause 8). */

/** The tabs the client record supplies, in its own order and wording (AAP 0.7.4); the component knows neither, which is what lets the last case prove it adds no tab of its own. */
const TABS: readonly TabDescriptor[] = [
  { id: 'general', label: 'General' },
  { id: 'identities', label: 'Identities' },
];

/** Tabs the design shows on the record that the plan keeps out of scope, so none is rendered (AAP 0.10.5 item 6). */
const OUT_OF_SCOPE_LABELS: readonly string[] = [
  'Family Members',
  'Documents',
  'Notes',
  'Credit Report',
];

describe('TabStripComponent', () => {
  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines this spec's only cast to one line and keeps the assertions type-checked (Rule 1 clause 4).
  const host = (fixture: ComponentFixture<TabStripComponent>): HTMLElement =>
    fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TabStripComponent] }).compileComponents();
  });

  /** Renders the strip with both `input.required` inputs bound before the first change detection; a fixture that skipped either would throw instead of rendering a half-configured strip. */
  function createStrip(activeId: string): ComponentFixture<TabStripComponent> {
    const fixture = TestBed.createComponent(TabStripComponent);

    fixture.componentRef.setInput('tabs', TABS);
    fixture.componentRef.setInput('activeId', activeId);
    fixture.detectChanges();

    return fixture;
  }

  /** The clickable label of every tab, in render order; the chevron decorations hold none. */
  function tabLinks(fixture: ComponentFixture<TabStripComponent>): HTMLAnchorElement[] {
    return Array.from(host(fixture).querySelectorAll<HTMLAnchorElement>('ul.nav-tabs > li > a'));
  }

  /** The label of every tab the strip currently marks active, so a second `.active` shows up. */
  function activeLabels(fixture: ComponentFixture<TabStripComponent>): (string | undefined)[] {
    return Array.from(host(fixture).querySelectorAll('li.active')).map((item) =>
      item.textContent?.trim(),
    );
  }

  /** The tab showing `label`, or a named failure when the strip rendered none with it. */
  function tabLink(fixture: ComponentFixture<TabStripComponent>, label: string): HTMLAnchorElement {
    const link = tabLinks(fixture).find((candidate) => candidate.textContent?.trim() === label);

    if (link === undefined) {
      throw new Error(`TabStripComponent rendered no tab labelled "${label}"`);
    }

    return link;
  }

  /** Records every id the strip reports, so an extra emission is as visible as a missing one. */
  function recordChanges(fixture: ComponentFixture<TabStripComponent>): string[] {
    const emitted: string[] = [];

    fixture.componentInstance.tabChange.subscribe((id: string) => emitted.push(id));

    return emitted;
  }

  /** The two decorative chevron items at either end of the strip, outside the tabs. */
  function chevronItems(fixture: ComponentFixture<TabStripComponent>): HTMLElement[] {
    return Array.from(host(fixture).querySelectorAll<HTMLElement>('li[aria-hidden="true"]'));
  }

  it('renders one tab per descriptor, in the parent’s order, with its label verbatim', () => {
    const fixture = createStrip('general');
    const links = tabLinks(fixture);

    expect(links).toHaveLength(TABS.length);
    expect(links.map((link) => link.textContent?.trim())).toEqual(['General', 'Identities']);
  });

  it('marks exactly the tab named by activeId, and follows a changed id', () => {
    const fixture = createStrip('general');

    expect(host(fixture).querySelectorAll('li.active')).toHaveLength(1);
    expect(activeLabels(fixture)).toEqual(['General']);

    fixture.componentRef.setInput('activeId', 'identities');
    fixture.detectChanges();

    expect(host(fixture).querySelectorAll('li.active')).toHaveLength(1);
    expect(activeLabels(fixture)).toEqual(['Identities']);
  });

  it('keeps legacy’s tab markup, with `.active` on the `li` as the strip’s only state', () => {
    const fixture = createStrip('general');
    const lists = host(fixture).querySelectorAll('ul.nav-tabs');

    // One plain list, as legacy's tabset renders: no tablist role, no tab-stop attribute, no selection state and no key handler on top of the markup AAP 0.5.2 maps (Rule 1 clause 3; AAP 0.10.5 registers no accessibility.
    expect(lists).toHaveLength(1);
    expect(Array.from(lists, (list) => list.hasAttribute('role'))).toEqual([false]);
    expect(Array.from(lists, (list) => list.hasAttribute('aria-label'))).toEqual([false]);

    for (const link of tabLinks(fixture)) {
      // The anchor is legacy's own link — uib-tab 1.3.2 renders `<a href ng-click="select($event)">` — so the valueless `href` stays, which is what puts the tab in the tab order and lets a real Enter activate it; and the ARIA.
      expect(link.getAttribute('href')).toBe('');
      expect(link.tabIndex).toBe(0);
      expect(link.hasAttribute('role')).toBe(false);
      expect(link.hasAttribute('tabindex')).toBe(false);
      expect(link.hasAttribute('aria-selected')).toBe(false);
    }

    expect(host(fixture).querySelectorAll('li.active')).toHaveLength(1);
    expect(activeLabels(fixture)).toEqual(['General']);
  });

  it('reports an inactive tab’s id once when it is clicked', () => {
    const fixture = createStrip('general');
    const emitted = recordChanges(fixture);

    tabLink(fixture, 'Identities').click();

    expect(emitted).toEqual(['identities']);
  });

  it('reports nothing when the tab already shown is clicked', () => {
    const fixture = createStrip('general');
    const emitted = recordChanges(fixture);

    tabLink(fixture, 'General').click();

    expect(emitted).toEqual([]);
  });

  /** A tab click selects, it never navigates: the anchor's valueless `href` — legacy's own — would otherwise reload the current URL and drop the hash route, so the default is cancelled on every click, the already-active tab (Rule 1 clause 3). */
  it.each([
    { outcome: 'an inactive tab', label: 'Identities', expected: ['identities'] },
    { outcome: 'the tab already shown', label: 'General', expected: [] as string[] },
  ])('cancels the click’s default on $outcome, emitting $expected', ({ label, expected }) => {
    const fixture = createStrip('general');
    const emitted = recordChanges(fixture);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });

    tabLink(fixture, label).dispatchEvent(click);

    expect(emitted).toEqual(expected);
    expect(click.defaultPrevented).toBe(true);
  });

  it('renders both chevrons as inert decoration that cannot change the active tab', () => {
    const fixture = createStrip('general');
    const emitted = recordChanges(fixture);
    const items = chevronItems(fixture);

    expect(host(fixture).querySelectorAll('i.fa-chevron-left')).toHaveLength(1);
    expect(host(fixture).querySelectorAll('i.fa-chevron-right')).toHaveLength(1);
    expect(items).toHaveLength(2);

    for (const item of items) {
      expect(item.getAttribute('aria-hidden')).toBe('true');
      expect(item.hasAttribute('tabindex')).toBe(false);
      expect(item.querySelector('i.fa-chevron-left, i.fa-chevron-right')).not.toBeNull();

      item.click();
    }

    expect(emitted).toEqual([]);
    expect(activeLabels(fixture)).toEqual(['General']);
  });

  it('paints nothing at all when the parent supplies no tabs', () => {
    const fixture = createStrip('');

    fixture.componentRef.setInput('tabs', []);
    fixture.detectChanges();

    expect(host(fixture).querySelectorAll('ul.nav-tabs')).toHaveLength(0);
    expect(host(fixture).querySelectorAll('a')).toHaveLength(0);
    expect(tabLinks(fixture)).toHaveLength(0);
    expect(chevronItems(fixture)).toHaveLength(0);
    expect(host(fixture).childElementCount).toBe(0);
  });

  it('renders none of the out-of-scope tabs and adds no tab of its own', () => {
    const fixture = createStrip('general');
    const rendered = host(fixture).textContent ?? '';

    for (const label of OUT_OF_SCOPE_LABELS) {
      expect(rendered).not.toContain(label);
    }

    expect(tabLinks(fixture)).toHaveLength(TABS.length);
  });
});
