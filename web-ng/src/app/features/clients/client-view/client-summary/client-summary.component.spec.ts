import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Client } from '../../client.models';
import { ClientSummaryComponent } from './client-summary.component';

/**
 * Behavioural spec for the client record's summary block — the label/value rows of the individual
 * client view's `General` tab (AAP 0.7.1 row `clients`, `ClientViewComponent` with
 * `ClientSummaryComponent`; AAP 0.7.4 "Client view (`#/viewclient/:id`)"), whose data comes from
 * the one `GET /clients/{id}` response the parent already loaded (AAP 0.10.1 workflow **W3**).
 *
 * It pins the four things the block exists to do and a naive rewrite would get wrong:
 *
 *  1. every row of the fixed field set renders, in the record's order, carrying the client's own
 *     values;
 *  2. the activation date renders at `dd MMMM yyyy` — `21 November 2026`, never a `Date`-shaped or
 *     ISO string (AAP 0.7.2 "Date handling");
 *  3. a field the payload omits renders an empty value column beside its label, with no dash, no
 *     `N/A` and no translated stand-in (Rule 1 clause 3: the migration matches legacy rather than
 *     improving it);
 *  4. the block renders with no HTTP client, no service and no router injected at all, which is
 *     what keeps the record screen at exactly the calls `client.service.ts` owns (AAP 0.4.2,
 *     Rule 1 clause 5).
 *
 * **Where the label strings come from.** The field set, the label wording and the row order
 * asserted below are the ones `client-summary.component.ts` fixes from the AAP. Accounting for the
 * design raster of Figma node `1:4`, which paints the same five fields as `Office`, `Account No.`,
 * `External Id`, `Activation Date`, `Staff` and prints `Unassigned` for an unassigned officer: the
 * AAP sets the block's field set and its empty-value rule, so the assertions pin
 * `Client Number` / `External ID` / `Office` / `Staff` / `Activation Date` and an empty value for a
 * field the payload omits. Re-labelling, re-ordering or adding a placeholder to these rows moves
 * the component and this spec together.
 *
 * Figma provenance of the screen these rows sit on: file `DKm5TBFbXypfqyx4xUdhBw`, frame `2:2`
 * ("Legacy"), flow "Sign in and open a client record" — Login `1:5` → Clients list `1:3` →
 * Individual client view `1:4` (end of flow); `node_id` / `parent_screen_node_id` /
 * `figma_screen_id` are all `1:4`. The file decomposes no further than the screen rectangle, so the
 * raster is the reference for what the rows show, and the design's status dot and status pill
 * belong to the record header, not to this block (AAP 0.10.5 deliberate difference 11).
 */

/**
 * Labels of the block's five rows, in render order: the four text rows in the template's loop
 * followed by the date row the template writes out.
 */
const ROW_LABELS: readonly string[] = [
  'Client Number',
  'External ID',
  'Office',
  'Staff',
  'Activation Date',
];

/** Zero-padded client number the design prints verbatim, held as text and never parsed. */
const ACCOUNT_NO = '000000002';

/** Bank-assigned external id of the activated fixture, obviously synthetic. */
const EXTERNAL_ID = 'EXT-0002';

/** Office the client is filed under, as the template returned it. */
const OFFICE_NAME = 'Head Office';

/** Loan officer of the activated fixture, a synthetic name rather than a real person's. */
const STAFF_NAME = 'Spec Officer';

/** Activation date in the wire form `Client.activationDate` carries: a `'yyyy-MM-dd'` string. */
const ACTIVATION_DATE_WIRE = '2026-11-21';

/** The same day as the record renders it at `dd MMMM yyyy`. */
const ACTIVATION_DATE_TEXT = '21 November 2026';

/**
 * A client with every field the block renders: the state four of the design's five rows show, and
 * the only one whose activation date row carries a value.
 */
const ACTIVE_CLIENT: Client = {
  id: 2,
  accountNo: ACCOUNT_NO,
  externalId: EXTERNAL_ID,
  displayName: 'Spec Client',
  firstname: 'Spec',
  lastname: 'Client',
  officeId: 1,
  officeName: OFFICE_NAME,
  staffId: 7,
  staffName: STAFF_NAME,
  status: { id: 300, code: 'clientStatusType.active', value: 'Active' },
  activationDate: ACTIVATION_DATE_WIRE,
  timeline: { submittedOnDate: ACTIVATION_DATE_WIRE, activatedOnDate: ACTIVATION_DATE_WIRE },
};

/**
 * A client the payload carries no external id, no staff assignment and no activation date for —
 * the state the block must render as labels beside empty value columns (AAP 0.7.4 "a field with no
 * value renders its label with an empty value rather than a placeholder").
 */
const PENDING_CLIENT: Client = {
  id: 4,
  accountNo: '000000004',
  displayName: 'Spec Pending Client',
  firstname: 'Spec',
  lastname: 'Pending',
  officeId: 1,
  officeName: OFFICE_NAME,
  status: { id: 100, code: 'clientStatusType.pending', value: 'Pending' },
  timeline: {},
};

/**
 * Text a missing value must never be replaced with, compared case-insensitively against every
 * rendered cell: the record shows a label with nothing beside it, and a stand-in anywhere would be
 * the improvement this migration must not make (Rule 1 clause 3). `Unassigned` is the one the
 * legacy raster of node `1:4` does print for an officer-less client, which the AAP's empty-value
 * rule replaces with an empty column rather than reproducing.
 */
const STAND_IN_TEXT: readonly string[] = ['N/A', 'Not provided', 'Unassigned'];

/** A dash alone, the stand-in a reader would mistake for a value; the empty cells carry none. */
const LONE_DASH = /^[-–—]+$/;

/**
 * Status words the record conveys through the header's dot and pill, and never through this block
 * (AAP 0.10.5 deliberate difference 11). Checked in lower case over the block's whole text.
 */
const STATUS_TEXT: readonly string[] = ['active', 'pending', 'closed', 'rejected', 'withdrawn'];

describe('ClientSummaryComponent', () => {
  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps the
  // assertions below type-checked and confines the cast to this single boundary (Rule 1 clause 4).
  const host = (fixture: ComponentFixture<ClientSummaryComponent>): HTMLElement =>
    fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    // The block is presentational, so the spec provides nothing at all: no HTTP client, no
    // testing-controller double, no service double and no router. A render that needed any of them
    // would throw here instead of passing, which is the behavioural proof that the record screen
    // makes only the calls `client.service.ts` owns (AAP 0.4.2; Rule 1 clause 5).
    await TestBed.configureTestingModule({ imports: [ClientSummaryComponent] }).compileComponents();
  });

  /** Renders the block for `client`, with its only input set before the first change detection. */
  function createSummary(client: Client): ComponentFixture<ClientSummaryComponent> {
    const fixture = TestBed.createComponent(ClientSummaryComponent);

    fixture.componentRef.setInput('client', client);
    fixture.detectChanges();

    return fixture;
  }

  /** Trimmed text of every element `selector` matches, in document order. */
  function texts(fixture: ComponentFixture<ClientSummaryComponent>, selector: string): string[] {
    return Array.from(host(fixture).querySelectorAll<HTMLElement>(selector)).map(
      (element) => element.textContent?.trim() ?? '',
    );
  }

  /** The block's label/value rows, in render order. */
  function rows(fixture: ComponentFixture<ClientSummaryComponent>): HTMLElement[] {
    return Array.from(host(fixture).querySelectorAll<HTMLElement>('.row'));
  }

  /** Labels of the key column, in render order. */
  function labels(fixture: ComponentFixture<ClientSummaryComponent>): string[] {
    return texts(fixture, '.control-label');
  }

  /** Values of the common value column, in render order. */
  function values(fixture: ComponentFixture<ClientSummaryComponent>): string[] {
    return texts(fixture, '.col-md-8');
  }

  it('renders the five summary rows in order, with the client’s own values', () => {
    const fixture = createSummary(ACTIVE_CLIENT);

    expect(rows(fixture)).toHaveLength(ROW_LABELS.length);
    expect(labels(fixture)).toEqual(ROW_LABELS);
    // The date is the fifth row's value and is asserted on its own below, so the four text rows
    // are compared here and no extra row can appear between them unnoticed.
    expect(values(fixture)).toHaveLength(ROW_LABELS.length);
    expect(values(fixture).slice(0, 4)).toEqual([
      ACTIVE_CLIENT.accountNo,
      ACTIVE_CLIENT.externalId,
      ACTIVE_CLIENT.officeName,
      ACTIVE_CLIENT.staffName,
    ]);
  });

  it('renders the activation date as dd MMMM yyyy', () => {
    const fixture = createSummary(ACTIVE_CLIENT);
    const activationCell = values(fixture)[4];

    expect(labels(fixture)[4]).toBe('Activation Date');
    expect(activationCell).toBe(ACTIVATION_DATE_TEXT);
    // The rendered value is the display pattern, not the `'yyyy-MM-dd'` wire form the model holds.
    expect(activationCell).not.toContain(ACTIVATION_DATE_WIRE);
    expect(activationCell).not.toContain('GMT');
    expect(activationCell).not.toContain('T00:00');
  });

  it('renders a field the payload omits as an empty value, never a placeholder', () => {
    const fixture = createSummary(PENDING_CLIENT);
    const renderedValues = values(fixture);

    // The labels are unaffected by a missing value: each row still renders its key.
    expect(labels(fixture)).toEqual(ROW_LABELS);
    expect(renderedValues[0]).toBe(PENDING_CLIENT.accountNo);
    expect(renderedValues[1]).toBe('');
    expect(renderedValues[2]).toBe(OFFICE_NAME);
    expect(renderedValues[3]).toBe('');
    // A pending client carries no activation date, so the date row keeps its label and stays empty.
    expect(renderedValues[4]).toBe('');

    const renderedCells = [...labels(fixture), ...renderedValues];

    for (const cell of renderedCells) {
      expect(cell).not.toMatch(LONE_DASH);

      for (const standIn of STAND_IN_TEXT) {
        expect(cell.toLowerCase()).not.toContain(standIn.toLowerCase());
      }
    }
  });

  it('gives every row one label and one value cell, so all values share one column', () => {
    const fixture = createSummary(ACTIVE_CLIENT);

    for (const row of rows(fixture)) {
      expect(row.querySelectorAll('.control-label')).toHaveLength(1);
      expect(row.querySelectorAll('.col-md-8')).toHaveLength(1);
    }

    expect(host(fixture).querySelectorAll('.col-md-4')).toHaveLength(ROW_LABELS.length);
  });

  it('renders no status word, leaving the record header’s dot and pill to carry the state', () => {
    const activeText = (host(createSummary(ACTIVE_CLIENT)).textContent ?? '').toLowerCase();
    const pendingText = (host(createSummary(PENDING_CLIENT)).textContent ?? '').toLowerCase();

    for (const statusWord of STATUS_TEXT) {
      expect(activeText).not.toContain(statusWord);
      expect(pendingText).not.toContain(statusWord);
    }

    // The server's own label for the pending state is on the payload and is deliberately not shown.
    expect(pendingText).not.toContain(PENDING_CLIENT.status.value.toLowerCase());
  });

  it('renders with no service, router or HTTP provider configured', () => {
    const active = createSummary(ACTIVE_CLIENT);
    const pending = createSummary(PENDING_CLIENT);

    expect(rows(active)).toHaveLength(ROW_LABELS.length);
    expect(rows(pending)).toHaveLength(ROW_LABELS.length);
    expect(values(pending)[1]).toBe('');
  });
});
