import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { TabStripComponent, tabDomId, type TabDescriptor } from './tab-strip.component';

/** Behavioural spec for the shared record tab strip — the `TabStrip` row of the component inventory, whose one state is "one active of N" (AAP 0.2.3), on the client record the flow's third screen shows (Figma node `1:4`) and on the loan record that renders it too (AAP 0.7.4) (Rule 1 clause 6, AAP 0.11.1, AAP 0.14.1, Rule 1 clause 8). */

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

  /** The label element of every tab, in render order: the tab is the anchor each `li` of the list holds. */
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

  /** Dispatches a cancelable keydown on the tab showing `label`, the way the browser delivers one to the focused tab, and hands the event back so a case can read whether the strip consumed it. */
  function pressKey(
    fixture: ComponentFixture<TabStripComponent>,
    label: string,
    key: string,
  ): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

    tabLink(fixture, label).dispatchEvent(event);

    return event;
  }

  /** Anything the strip paints outside its tabs — a scroll chevron, or an item hidden from the accessibility tree — which the in-scope record never needs (AAP 0.10.5 items 6 and 8). */
  function extras(fixture: ComponentFixture<TabStripComponent>): HTMLElement[] {
    return Array.from(
      host(fixture).querySelectorAll<HTMLElement>(
        'i.fa-chevron-left, i.fa-chevron-right, li[aria-hidden]',
      ),
    );
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

  it('renders one tab list whose tabs carry the tab role, a tab stop, a DOM id and their selection state', () => {
    const fixture = createStrip('general');
    const lists = host(fixture).querySelectorAll('ul.nav-tabs');

    // One tab list, as the ARIA tab pattern requires: the strip's `ul` is the `tablist` its tabs belong to (AAP 0.2.3 row `TabStrip`).
    expect(lists).toHaveLength(1);
    expect(lists[0].getAttribute('role')).toBe('tablist');

    const links = tabLinks(fixture);

    // Every tab is a `tab` of that list, is its own tab stop, and carries the id a record panel is labelled by — `tabDomId` of the descriptor's own id — so the strip and the panel cannot disagree about which element is which.
    expect(links.map((link) => link.getAttribute('role'))).toEqual(['tab', 'tab']);
    expect(links.map((link) => link.tabIndex)).toEqual([0, 0]);
    expect(links.map((link) => link.id)).toEqual([tabDomId('general'), tabDomId('identities')]);
    expect(links.map((link) => link.parentElement?.getAttribute('role'))).toEqual([
      'presentation',
      'presentation',
    ]);

    // No tab is a link: an empty `href` would make open-in-new-tab reload the current page instead of doing nothing, while the role, the tab stop and the key handler already keep a tab reachable and operable (Rule 1 clause 3).
    expect(links.map((link) => link.hasAttribute('href'))).toEqual([false, false]);

    expect(links.map((link) => link.getAttribute('aria-selected'))).toEqual(['true', 'false']);

    fixture.componentRef.setInput('activeId', 'identities');
    fixture.detectChanges();

    expect(tabLinks(fixture).map((link) => link.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
    ]);
    expect(host(fixture).querySelectorAll('li.active')).toHaveLength(1);
    expect(activeLabels(fixture)).toEqual(['Identities']);
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

  /** A tab click selects, it never navigates: the tab is no link, so nothing would reload the hash route, and the default is still cancelled on every click — the already-active tab included — so the click cannot reach the page (Rule 1 clause 3). */
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

  /** A tab is not a link, so the browser activates nothing on its own: the strip reads the two keys a button answers to, and consumes them so the space bar cannot scroll the record instead (AAP 0.2.3 row `TabStrip`). */
  it.each(['Enter', ' '])('activates an inactive tab with %j and consumes the keypress', (key) => {
    const fixture = createStrip('general');
    const emitted = recordChanges(fixture);

    const event = pressKey(fixture, 'Identities', key);

    expect(emitted).toEqual(['identities']);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each(['Enter', ' '])(
    'consumes %j on the tab already shown without reporting it again',
    (key) => {
      const fixture = createStrip('general');
      const emitted = recordChanges(fixture);

      const event = pressKey(fixture, 'General', key);

      expect(emitted).toEqual([]);
      expect(event.defaultPrevented).toBe(true);
      expect(activeLabels(fixture)).toEqual(['General']);
    },
  );

  it('leaves every other key alone, so the page keeps its own shortcuts and its scrolling', () => {
    const fixture = createStrip('general');
    const emitted = recordChanges(fixture);

    for (const key of ['Tab', 'ArrowRight', 'ArrowLeft', 'Escape', 'a']) {
      const event = pressKey(fixture, 'Identities', key);

      expect(event.defaultPrevented).toBe(false);
    }

    expect(emitted).toEqual([]);
    expect(activeLabels(fixture)).toEqual(['General']);
  });

  it('renders no scroll chevron and nothing hidden from the accessibility tree', () => {
    const fixture = createStrip('general');

    // The design's two chevrons are not painted at all: with at most three tabs in scope the strip never scrolls, so they would have nothing to scroll, and a painted control that does nothing is the broken affordance the plan refuses (AAP 0.10.5 items 6 and 8; Rule 1 clause 3).
    expect(extras(fixture)).toEqual([]);

    expect(host(fixture).querySelectorAll('ul.nav-tabs > li')).toHaveLength(TABS.length);
  });

  it('paints nothing at all when the parent supplies no tabs', () => {
    const fixture = createStrip('');

    fixture.componentRef.setInput('tabs', []);
    fixture.detectChanges();

    expect(host(fixture).querySelectorAll('ul.nav-tabs')).toHaveLength(0);
    expect(host(fixture).querySelectorAll('a')).toHaveLength(0);
    expect(tabLinks(fixture)).toHaveLength(0);
    expect(extras(fixture)).toHaveLength(0);
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
