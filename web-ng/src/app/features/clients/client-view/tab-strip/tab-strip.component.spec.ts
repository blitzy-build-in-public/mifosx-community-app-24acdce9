import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { TabStripComponent, type TabDescriptor } from './tab-strip.component';

/**
 * Behavioural spec for the client record's tab strip — the `TabStrip` row of the component
 * inventory, whose states are "one active of N" (AAP 0.2.3), and an element of the client view
 * screen the plan keeps in Must scope (AAP 0.7.4).
 *
 * It serves AAP 0.11.1 (unit specs beside every component), AAP 0.14.1 ("each screen lands with at
 * least one behavioural spec") and AAP 0.14.2's "no spec without an `expect`". The component is
 * controlled: the parent supplies the tabs and the active id, so every emission asserted below is
 * the whole of its outward behaviour.
 *
 * The Bootstrap 3 tab semantics the pattern carries are asserted here too: `role="tablist"` on the
 * strip, one `role="tab"` per control, `aria-selected` following `activeId`, a tab stop on a control
 * that deliberately has no link target (a bare `#` would navigate to the root route under hash
 * routing), Enter and Space both choosing a tab, and an empty tab list rendering nothing at all.
 */

/** Tabs in the order the parent supplies them; ids are deliberately not alphabetical by label. */
const TABS: readonly TabDescriptor[] = [
  { id: 'general', label: 'General' },
  { id: 'identities', label: 'Identities' },
  { id: 'documents', label: 'Documents' },
];

describe('TabStripComponent', () => {
  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps the
  // assertions below type-checked and confines the cast to this single boundary (Rule 1 clause 4).
  const host = (fixture: ComponentFixture<TabStripComponent>): HTMLElement =>
    fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TabStripComponent] }).compileComponents();
  });

  /**
   * Renders the strip with both required inputs set before the first change detection, then applies
   * a different tab list when one is supplied.
   */
  function createStrip(
    activeId: string,
    tabs: readonly TabDescriptor[] = TABS,
  ): ComponentFixture<TabStripComponent> {
    const fixture = TestBed.createComponent(TabStripComponent);

    fixture.componentRef.setInput('tabs', tabs);
    fixture.componentRef.setInput('activeId', activeId);
    fixture.detectChanges();

    return fixture;
  }

  /** The tab items of the strip, in render order, without the two decorative chevron items. */
  function tabItems(fixture: ComponentFixture<TabStripComponent>): HTMLElement[] {
    return Array.from(host(fixture).querySelectorAll('li')).filter(
      (item) => !item.hasAttribute('aria-hidden'),
    );
  }

  /** The clickable label of each tab, in render order; the chevron decorations hold no anchor. */
  function tabAnchors(fixture: ComponentFixture<TabStripComponent>): HTMLAnchorElement[] {
    return Array.from(host(fixture).querySelectorAll<HTMLAnchorElement>('li a'));
  }

  /** The tab control showing `label`, or a named failure when the strip rendered none with it. */
  function tabAnchor(
    fixture: ComponentFixture<TabStripComponent>,
    label: string,
  ): HTMLAnchorElement {
    const anchor = tabAnchors(fixture).find(
      (candidate) => candidate.textContent?.trim() === label,
    );

    if (anchor === undefined) {
      throw new Error(`TabStripComponent rendered no tab labelled "${label}"`);
    }

    return anchor;
  }

  /** Records every id the strip reports, so an extra emission is as visible as a missing one. */
  function recordChanges(fixture: ComponentFixture<TabStripComponent>): string[] {
    const emitted: string[] = [];

    fixture.componentInstance.tabChange.subscribe((id: string) => emitted.push(id));

    return emitted;
  }

  it('renders one tab item per descriptor, in the supplied order, inside the legacy nav-tabs list', () => {
    const fixture = createStrip('general');
    const list = host(fixture).querySelector('ul.nav.nav-tabs');

    expect(list).not.toBeNull();
    // The two chevron decorations are the only items that are not tabs.
    expect(host(fixture).querySelectorAll('li[aria-hidden="true"]')).toHaveLength(2);
    expect(tabItems(fixture)).toHaveLength(TABS.length);
    expect(tabItems(fixture).map((item) => item.textContent?.trim())).toEqual([
      'General',
      'Identities',
      'Documents',
    ]);
  });

  it('marks exactly the tab whose id is active, and no other element', () => {
    const fixture = createStrip('identities');
    const active = tabItems(fixture).filter((item) => item.classList.contains('active'));

    expect(active).toHaveLength(1);
    expect(active[0].textContent?.trim()).toBe('Identities');
    expect(host(fixture).querySelectorAll('.active')).toHaveLength(1);
  });

  it('reports an inactive tab once when it is clicked', () => {
    const fixture = createStrip('general');
    const emitted = recordChanges(fixture);

    tabAnchors(fixture)[2].click();

    expect(emitted).toEqual(['documents']);
  });

  it('reports nothing when the already active tab is clicked', () => {
    const fixture = createStrip('general');
    const emitted = recordChanges(fixture);

    tabAnchors(fixture)[0].click();

    expect(emitted).toHaveLength(0);
  });

  it('follows a changed active id without reporting anything itself', () => {
    const fixture = createStrip('general');
    const emitted = recordChanges(fixture);

    fixture.componentRef.setInput('activeId', 'documents');
    fixture.detectChanges();

    expect(
      tabItems(fixture)
        .filter((item) => item.classList.contains('active'))
        .map((item) => item.textContent?.trim()),
    ).toEqual(['Documents']);
    expect(emitted).toHaveLength(0);
  });

  it('gives its tab labels no link target, because a legacy tab never navigates', () => {
    const fixture = createStrip('general');
    const anchors = tabAnchors(fixture);

    expect(anchors).toHaveLength(TABS.length);

    for (const anchor of anchors) {
      expect(anchor.hasAttribute('href')).toBe(false);
      expect(anchor.getAttribute('href')).toBeNull();
    }
  });

  it('exposes the strip as a tablist of focusable tabs, with aria-selected following activeId', () => {
    const fixture = createStrip('general');

    expect(host(fixture).querySelector('ul')?.getAttribute('role')).toBe('tablist');

    for (const item of tabItems(fixture)) {
      expect(item.getAttribute('role')).toBe('presentation');
    }

    for (const anchor of tabAnchors(fixture)) {
      expect(anchor.getAttribute('role')).toBe('tab');
      expect(anchor.getAttribute('tabindex')).toBe('0');
    }

    expect(tabAnchor(fixture, 'General').getAttribute('aria-selected')).toBe('true');
    expect(tabAnchor(fixture, 'Identities').getAttribute('aria-selected')).toBe('false');

    fixture.componentRef.setInput('activeId', 'identities');
    fixture.detectChanges();

    expect(tabAnchor(fixture, 'General').getAttribute('aria-selected')).toBe('false');
    expect(tabAnchor(fixture, 'Identities').getAttribute('aria-selected')).toBe('true');
  });

  it('chooses a tab with Enter and with Space, cancelling the default action', () => {
    const fixture = createStrip('general');
    const emitted = recordChanges(fixture);
    const identities = tabAnchor(fixture, 'Identities');

    const enterHandled = identities.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    expect(emitted).toEqual(['identities']);
    expect(enterHandled).toBe(false);

    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    const spaceHandled = identities.dispatchEvent(space);

    expect(emitted).toEqual(['identities', 'identities']);
    // Space would scroll the page if the default ran, so the handler cancels it.
    expect(space.defaultPrevented).toBe(true);
    expect(spaceHandled).toBe(false);
  });

  it('renders nothing at all when the tab list is empty', () => {
    const fixture = createStrip('general', []);

    expect(host(fixture).querySelector('.nav-tabs')).toBeNull();
    expect(host(fixture).querySelectorAll('li')).toHaveLength(0);
    expect(
      host(fixture).querySelectorAll('.fa-chevron-left, .fa-chevron-right'),
    ).toHaveLength(0);
    expect(host(fixture).textContent?.trim()).toBe('');
  });
});
