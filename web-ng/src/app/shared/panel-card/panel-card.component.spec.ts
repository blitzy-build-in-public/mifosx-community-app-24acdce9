import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PanelCardComponent } from './panel-card.component';

/**
 * Behavioural spec for `PanelCardComponent`, the card every list, record and form surface is drawn
 * on (AAP 0.2.3 component inventory row `PanelCard`, Figma nodes `1:3` and `1:4`; AAP 0.5.2 row
 * "Card / panel"). It discharges AAP 0.11.1 (a unit spec beside every component), AAP 0.14.1
 * ("each screen lands with at least one behavioural spec") and Rule 1 clause 8 (no spec without an
 * `expect`, nothing boilerplate).
 *
 * Each assertion states a contract the component owns:
 * - the host is a `div` carrying exactly `panel` by default, with no heading band, so a card without
 *   a title renders the markup the delivered screens already have (Rule 1 clause 6);
 * - a title renders the Bootstrap 3 chain `div.panel-heading > h3.panel-title` with the caller's own
 *   text as its only content, and `titleTag="h4"` moves that heading to `h4`, which is the level the
 *   record's profile card uses (AAP 0.2.3, AAP 0.10.2);
 * - `variant` adds the one modifier class of the variant the caller asks for and no other, covering
 *   the bare `.panel`, the `.panel.panel-default` and the `.panel.panel-bordered` cards of the
 *   delivered markup (AAP 0.5.2, AAP 0.5.3);
 * - an empty title renders no band either, so a band that says nothing never paints the heading
 *   rule above it;
 * - projected content arrives as the host's own children, after the band and in the caller's order,
 *   which is what lets a card hold several `.panel-body` blocks and a `.panel-footer` and what keeps
 *   `.panel > .panel-heading` matching the global rule.
 *
 * The card declares no stylesheet, no colour and no dimension (Rule 1 clause 6, AAP 0.5.5), so
 * nothing here asserts a computed value: every visual value belongs to `web-ng/src/styles.scss` and
 * is checked there.
 */

/**
 * A caller of the card: the record's profile card shape — a bordered card whose heading is an `h4`,
 * holding two bodies and a footer. It is the projection case no direct assertion covers, and its
 * static attributes also pin that the three inputs accept the plain attribute syntax a caller
 * writes. Test input only; it reproduces no shipped screen's copy.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PanelCardComponent],
  template: `
    <div appPanelCard title="Profile" titleTag="h4" variant="bordered">
      <div class="panel-body">Summary</div>
      <div class="panel-body">Performance History</div>
      <div class="panel-footer">Footer</div>
    </div>
  `,
})
class CardCallerComponent {}

/**
 * The fixture's host element. `ComponentFixture.nativeElement` is typed `any` by Angular, so
 * narrowing it once per helper keeps every assertion below type-checked (Rule 1 clause 4).
 */
function hostOf(target: ComponentFixture<unknown>): HTMLElement {
  return target.nativeElement as HTMLElement;
}

/**
 * Renders the card with the inputs a test needs, each bound before the first change detection.
 * An argument left out is not bound at all, so the component's own default is what the test
 * observes.
 */
function createCard(
  title?: string | null,
  titleTag?: 'h3' | 'h4',
  variant?: 'plain' | 'default' | 'bordered',
): ComponentFixture<PanelCardComponent> {
  const created = TestBed.createComponent(PanelCardComponent);
  if (title !== undefined) {
    created.componentRef.setInput('title', title);
  }
  if (titleTag !== undefined) {
    created.componentRef.setInput('titleTag', titleTag);
  }
  if (variant !== undefined) {
    created.componentRef.setInput('variant', variant);
  }
  created.detectChanges();
  return created;
}

/** The heading band of a rendered card, or a named failure when the card rendered none. */
function bandOf(host: HTMLElement): HTMLElement {
  const band: unknown = host.querySelector('.panel-heading');
  if (!(band instanceof HTMLElement)) {
    throw new Error('PanelCardComponent rendered no heading band');
  }
  return band;
}

beforeEach(async () => {
  await TestBed.configureTestingModule({ imports: [PanelCardComponent] }).compileComponents();
});

describe('PanelCardComponent', () => {
  it('renders a plain card host and no heading band when no title is given', () => {
    const host = hostOf(createCard());

    expect(host.tagName).toBe('DIV');
    expect(host.className).toBe('panel');
    expect(host.querySelector('.panel-heading')).toBeNull();
    expect(host.childElementCount).toBe(0);
  });

  it('renders the title in a .panel-heading > h3.panel-title', () => {
    const host = hostOf(createCard('List of Clients'));
    const band = bandOf(host);

    expect(band.tagName).toBe('DIV');
    expect(band.childElementCount).toBe(1);
    expect(host.querySelectorAll('.panel-heading > .panel-title')).toHaveLength(1);

    const heading = band.firstElementChild as HTMLElement | null;
    expect(heading?.tagName).toBe('H3');
    expect(heading?.classList.contains('panel-title')).toBe(true);
    expect(heading?.textContent?.trim()).toBe('List of Clients');
    expect(heading?.childElementCount).toBe(0);
  });

  it('renders an h4.panel-title when titleTag is "h4"', () => {
    const host = hostOf(createCard('Ada Okafor', 'h4'));
    const heading = bandOf(host).firstElementChild as HTMLElement | null;

    expect(heading?.tagName).toBe('H4');
    expect(heading?.classList.contains('panel-title')).toBe(true);
    expect(heading?.textContent?.trim()).toBe('Ada Okafor');
    expect(host.querySelector('h3')).toBeNull();
  });

  it('renders no heading band for an empty title', () => {
    const host = hostOf(createCard(''));

    expect(host.className).toBe('panel');
    expect(host.querySelector('.panel-heading')).toBeNull();
    expect(host.textContent?.trim()).toBe('');
  });

  it('adds neither modifier class for the plain variant', () => {
    const host = hostOf(createCard());

    expect(host.classList.contains('panel-default')).toBe(false);
    expect(host.classList.contains('panel-bordered')).toBe(false);
  });

  it.each([
    ['default', 'panel-default'],
    ['bordered', 'panel-bordered'],
  ] as const)('the %s variant adds the %s class and keeps .panel', (variant, modifier) => {
    const host = hostOf(createCard(undefined, undefined, variant));

    expect(host.className).toBe(`panel ${modifier}`);
    expect(host.classList.contains('panel')).toBe(true);
    expect(host.classList.contains(modifier)).toBe(true);
  });

  it('renders the projected content as the host children, after the heading band and in the caller order', () => {
    const caller = TestBed.createComponent(CardCallerComponent);
    caller.detectChanges();

    const card: unknown = hostOf(caller).firstElementChild;
    if (!(card instanceof HTMLElement)) {
      throw new Error('the caller template rendered no card');
    }

    // The caller wrote the card as the legacy markup writes it, so the only trace the component
    // leaves in the DOM is the host attribute the selector matches (Rule 1 clause 6).
    expect(card.hasAttribute('apppanelcard')).toBe(true);
    expect(card.className).toBe('panel panel-bordered');
    expect(Array.from(card.children).map((child) => child.className)).toEqual([
      'panel-heading',
      'panel-body',
      'panel-body',
      'panel-footer',
    ]);
    expect(card.querySelector('.panel-heading > h4.panel-title')?.textContent?.trim()).toBe(
      'Profile',
    );

    const bodies = Array.from(card.children).filter((child) => child.classList.contains('panel-body'));
    expect(bodies.map((body) => body.textContent?.trim())).toEqual(['Summary', 'Performance History']);
  });
});
