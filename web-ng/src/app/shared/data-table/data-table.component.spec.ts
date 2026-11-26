import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DataTableComponent, type ColumnDef } from './data-table.component';

/**
 * Behavioural spec for `DataTableComponent`, the generic table AAP 0.2.3's inventory requires the new app to provide (row `ClientList / DataTable`; Figma node `1:3`; Rule 1 clause 8, which allows no empty or
 * boilerplate specs). It pins what only the rendered table can say: one `<th scope="col">` per column in the caller's order from the column's already-translated label, one `<tr>` and one `<td>` per row and
 * column, the caller's id and class list on the `<table>` inside Bootstrap's `.table-responsive` wrapper (Rule 1 clauses 3 and 6), a row opening the caller's destination as one link over the whole row with no
 * control inside it (AAP 0.7.4), no link at all for a table given no destination, a caller's cell template rendering instead of the column text with the row, the column and its value — how Status becomes an
 * `app-status-swatch` (AAP 0.2.3 row `StatusSwatch`; AAP 0.10.5 deliberate difference 11) — rows and order following the input tracked by the caller's key, an empty row list rendering the header and no body
 * row (Rule 1 clause 3), and the caller's caption becoming the table's own invisible `<caption>`, with none rendered when the caller supplies none (QA report F41). The keyboard path is the last item it pins
 * and the table's one deliberate difference from legacy: Enter or Space on a focused row opens that row's own destination exactly once, through the same router call its click makes, cancels Space's default so
 * the page cannot scroll behind it, and opens nothing — not even a default — for a row the caller gave no destination or for a key that is neither of the two (Rule 1 clause 3, which matches legacy's
 * pointer-only rows and allows a difference only where it is recorded). The two hosts are the only place the generic contract is exercised from a template, which proves it composes with a feature's own row
 * type while `shared/` names none of it (AAP 0.14.1 "`shared` never imports from `features`"). The router is provided empty because no case completes a navigation: each asserts the destination the row asks the
 * router for.
 *
 */

/** The row a host hands the table: a feature's own shape, invented for this suite. */
interface ProbeRow {
  /** The caller's tracking key, which is what the body loop tracks by. */
  readonly key: string;
  /** The id the row's destination carries. */
  readonly id: number;
  /** The text of the first column. */
  readonly name: string;
  /** The text of the second column. */
  readonly office: string;
  /** The value the component cell renders as a component rather than as text. */
  readonly status: string;
}

/** The page a host renders, in the order the host supplies it. */
const PROBE_ROWS: readonly ProbeRow[] = [
  { key: 'row:2', id: 2, name: 'Ana Rivera', office: 'Head Office', status: 'active' },
  { key: 'row:4', id: 4, name: 'Luis Ortega', office: 'Kigali Branch', status: 'pending' },
];

/** The columns a host supplies: labels already translated, and the cell text each one prints. */
const PROBE_COLUMNS: readonly ColumnDef<ProbeRow>[] = [
  { key: 'name', header: 'Name', value: (row) => row.name },
  { key: 'office', header: 'Office', value: (row) => row.office },
  { key: 'status', header: 'Status', value: (row) => row.status },
];

/** The clients list's own class list, which is what sizes its columns in the global layer. */
const PROBE_TABLE_CLASSES = 'table table-striped client-list';

/** The legacy table's id, which is what the parity harness addresses the list by. */
const PROBE_TABLE_ID = 'client-list';

/**
 * A host that binds every input the way a list screen does — a destination on each row, the clients
 * list's own class list and id — with each value behind a signal so a case can change it and observe
 * the table repaint.
 */
@Component({
  imports: [DataTableComponent],
  template: `
    <app-data-table
      [rows]="rows()"
      [columns]="columns"
      [rowKey]="rowKey"
      [rowLink]="rowLink()"
      [tableClasses]="tableClasses()"
      [tableId]="tableId()"
      [rowClass]="rowClass()"
      [caption]="caption()"
    />
  `,
})
class DataTableHostComponent {
  /** The page the table renders; a case replaces it to observe the repaint. */
  readonly rows = signal<readonly ProbeRow[]>(PROBE_ROWS);

  /** The columns, fixed for the host's lifetime. */
  readonly columns: readonly ColumnDef<ProbeRow>[] = PROBE_COLUMNS;

  /** The caller's tracking key: stable across a repaint, so rows reconcile. */
  readonly rowKey = (row: ProbeRow): string => row.key;

  /** The destination a row opens, or `null` for a table whose rows open nothing. */
  readonly rowLink = signal<((row: ProbeRow) => readonly (string | number)[]) | null>(
    (row) => ['/viewclient', row.id],
  );

  /** The screen's own class beside the Bootstrap table classes (Rule 1 clause 6). */
  readonly tableClasses = signal(PROBE_TABLE_CLASSES);

  /** The legacy table's id (Rule 1 clause 3). */
  readonly tableId = signal<string | null>(PROBE_TABLE_ID);

  /** The caller's own row class, or `null` for a row with none. */
  readonly rowClass = signal<string | null>(null);

  /** The table's accessible name, or `null` — the component's default — for a table that carries none (QA report F41). */
  readonly caption = signal<string | null>(null);
}

/**
 * A host that supplies a cell template rendering one column as a component and every other column
 * from the context's own `value` — the shape the clients list's Status column needs.
 */
@Component({
  imports: [DataTableComponent],
  template: `
    <app-data-table
      [rows]="rows"
      [columns]="columns"
      [rowKey]="rowKey"
      [cellTemplate]="statusCell"
    />
    <ng-template #statusCell let-row let-column="column" let-value="value">
      @if (column.key === 'status') {
        <span class="probe-swatch" [attr.data-status]="row.status"></span>
      } @else {
        {{ value }}
      }
    </ng-template>
  `,
})
class DataTableCellTemplateHostComponent {
  /** The page the table renders. */
  readonly rows: readonly ProbeRow[] = PROBE_ROWS;

  /** The columns, the third of which the template renders as a component. */
  readonly columns: readonly ColumnDef<ProbeRow>[] = PROBE_COLUMNS;

  /** The caller's tracking key. */
  readonly rowKey = (row: ProbeRow): string => row.key;
}

/** The table a host rendered, or a named failure when the template rendered none. */
function tableOf(host: unknown): HTMLTableElement {
  const element: unknown = (host as HTMLElement).querySelector('table');
  if (!(element instanceof HTMLTableElement)) {
    throw new Error('the data table rendered no <table>');
  }
  return element;
}

/** The body rows of a rendered table. */
function bodyRowsOf(table: HTMLTableElement): readonly HTMLTableRowElement[] {
  return Array.from(table.querySelectorAll('tbody tr'));
}

/** The text of each cell of a row, trimmed, in document order. */
function cellTexts(row: HTMLTableRowElement): readonly string[] {
  return Array.from(row.cells).map((cell) => cell.textContent?.trim() ?? '');
}

describe('DataTableComponent', () => {
  let fixture: ComponentFixture<DataTableHostComponent>;
  let router: Router;

  /** Mounts the host and waits for its first render. */
  async function mount(): Promise<HTMLElement> {
    fixture = TestBed.createComponent(DataTableHostComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DataTableHostComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    });
    router = TestBed.inject(Router);
  });

  it('renders one scoped header cell per column, in the caller’s order', async () => {
    const host = await mount();
    const headers = Array.from(tableOf(host).querySelectorAll('thead th'));

    expect(headers.map((header) => header.textContent?.trim())).toEqual([
      'Name',
      'Office',
      'Status',
    ]);
    expect(headers.map((header) => header.getAttribute('scope'))).toEqual(['col', 'col', 'col']);
  });

  it('renders one row per row and one cell per column, holding the column’s own text', async () => {
    const host = await mount();
    const rows = bodyRowsOf(tableOf(host));

    expect(rows).toHaveLength(2);
    expect(cellTexts(rows[0])).toEqual(['Ana Rivera', 'Head Office', 'active']);
    expect(cellTexts(rows[1])).toEqual(['Luis Ortega', 'Kigali Branch', 'pending']);
  });

  it('carries the caller’s id and class list on the table inside the responsive wrapper', async () => {
    const host = await mount();
    const element = tableOf(host);

    // `.table-responsive` is Bootstrap 3's own wrapper: inert above 768px, and below it what keeps the columns from pushing the page into horizontal scroll. It contributes no class of its own to the table,
    // whose class list is exactly the caller's — read as a set, because the DOM does not promise the order the binding wrote them in (Rule 1 clause 6).
    expect(element.parentElement?.classList.contains('table-responsive')).toBe(true);
    expect(Array.from(element.classList).sort()).toEqual(
      PROBE_TABLE_CLASSES.split(' ').sort(),
    );
    expect(element.id).toBe(PROBE_TABLE_ID);
  });

  it('opens the destination the caller supplies from the whole row, with no control inside it', async () => {
    const host = await mount();
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const rows = bodyRowsOf(tableOf(host));

    rows[1].click();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0][0])).toBe('/viewclient/4');
    for (const row of rows) {
      expect(row.querySelectorAll('a, button, input, select, textarea')).toHaveLength(0);
    }
  });

  it('carries the caller\u2019s row class on every row, and none when the caller supplies none', async () => {
    const host = await mount();
    const rows = bodyRowsOf(tableOf(host));

    // A row that opens a record wears legacy's own class, which is what the global layer paints the hover cursor, the brand-blue fill and white text from (`app/views/clients/clients.html:64`;
    // `_content.scss:413-417`). A table whose caller names no class carries none, so an unclassed table cannot inherit a treatment it did not ask for (Rule 1 clause 3).
    for (const row of rows) {
      expect(row.classList.contains('pointer-main')).toBe(false);
    }

    fixture.componentInstance.rowClass.set('pointer-main');
    await fixture.whenStable();

    const classed = bodyRowsOf(tableOf(host));
    expect(classed).toHaveLength(rows.length);
    for (const row of classed) {
      expect(Array.from(row.classList)).toEqual(['pointer-main']);
    }
  });

  it('names the table with the caller’s caption, invisibly, and renders none when none is supplied', async () => {
    const host = await mount();

    // No caption of the component's own: a table whose caller supplies no name stays the unnamed
    // table it has always been, rather than one with an empty `<caption>` (QA report F41).
    expect(tableOf(host).querySelector('caption')).toBeNull();

    fixture.componentInstance.caption.set('Clients');
    await fixture.whenStable();

    const table = tableOf(host);
    const caption = table.querySelector('caption');

    // The `<caption>` is the table's own first child, which is where a screen reader reads the table's
    // name from, and `sr-only` keeps it off the screen, so no row, column or pixel moves.
    expect(table.firstElementChild).toBe(caption);
    expect(caption?.textContent?.trim()).toBe('Clients');
    expect(caption?.classList.contains('sr-only')).toBe(true);
  });

  it('renders no link at all when the caller supplies no destination', async () => {
    const host = await mount();
    fixture.componentInstance.rowLink.set(null);
    await fixture.whenStable();

    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const rows = bodyRowsOf(tableOf(host));

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.hasAttribute('href')).toBe(false);
      expect(row.hasAttribute('tabindex')).toBe(false);
    }

    rows[0].click();

    expect(navigate).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Ana Rivera');
  });

  it('repaints the rows, in the caller’s order, when the input changes', async () => {
    const host = await mount();
    expect(bodyRowsOf(tableOf(host))).toHaveLength(2);

    fixture.componentInstance.rows.set([PROBE_ROWS[1], PROBE_ROWS[0]]);
    await fixture.whenStable();

    const reordered = bodyRowsOf(tableOf(host));

    expect(reordered).toHaveLength(2);
    expect(cellTexts(reordered[0])).toEqual(['Luis Ortega', 'Kigali Branch', 'pending']);
    expect(cellTexts(reordered[1])).toEqual(['Ana Rivera', 'Head Office', 'active']);

    fixture.componentInstance.rows.set([PROBE_ROWS[0]]);
    await fixture.whenStable();

    expect(bodyRowsOf(tableOf(host))).toHaveLength(1);
    expect(tableOf(host).textContent).not.toContain('Luis Ortega');
  });

  it('renders the header and no body row for an empty row list', async () => {
    const host = await mount();

    fixture.componentInstance.rows.set([]);
    await fixture.whenStable();

    expect(tableOf(host).querySelectorAll('thead th')).toHaveLength(3);
    expect(bodyRowsOf(tableOf(host))).toHaveLength(0);
  });

  /**
   * The keyboard path. `RouterLink` gives a non-anchor host its tab stop and no activation of its own, so a case presses the key where a focused row receives it — on
   * the row itself — and asserts the router call that row's own click makes. That identity is the behaviour: the keyboard and the pointer reach one destination through
   * one path, so a key press can neither navigate twice nor reach somewhere a click would not.
   *
   */
  describe('row activation from the keyboard', () => {
    /** Presses one key on a row and returns the event, so a case can read what its default became. */
    function press(row: HTMLTableRowElement, key: string): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      row.dispatchEvent(event);
      return event;
    }

    it.each([
      { key: 'Enter', label: 'Enter', prevented: false },
      { key: ' ', label: 'Space', prevented: true },
    ])(
      'opens the focused row’s own destination once on $label',
      async ({ key, prevented }) => {
        const host = await mount();
        const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
        const rows = bodyRowsOf(tableOf(host));

        // The row is reachable from the keyboard in the first place: `RouterLink` is what gives the non-anchor host its tab stop, and the activation below is what that tab stop leads to.
        expect(rows[1].getAttribute('tabindex')).toBe('0');

        const event = press(rows[1], key);

        expect(navigate).toHaveBeenCalledTimes(1);
        expect(String(navigate.mock.calls[0][0])).toBe('/viewclient/4');

        expect(event.defaultPrevented).toBe(prevented);
      },
    );

    it('opens nothing, and touches no default, for a row the caller gave no destination', async () => {
      const host = await mount();
      fixture.componentInstance.rowLink.set(null);
      await fixture.whenStable();

      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      const row = bodyRowsOf(tableOf(host))[0];
      const events = [press(row, 'Enter'), press(row, ' ')];

      expect(navigate).not.toHaveBeenCalled();
      for (const event of events) {
        expect(event.defaultPrevented).toBe(false);
      }
    });

    it('opens nothing for a key that is neither Enter nor Space', async () => {
      const host = await mount();
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

      press(bodyRowsOf(tableOf(host))[0], 'a');

      expect(navigate).not.toHaveBeenCalled();
    });
  });
});

describe('DataTableComponent with a cell template', () => {
  let fixture: ComponentFixture<DataTableCellTemplateHostComponent>;

  /** Mounts the cell-template host and returns the table it rendered. */
  async function mount(): Promise<HTMLTableElement> {
    fixture = TestBed.createComponent(DataTableCellTemplateHostComponent);
    await fixture.whenStable();
    return tableOf(fixture.nativeElement);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DataTableCellTemplateHostComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    });
  });

  it('renders the template for every cell, with the row, the column and the value', async () => {
    const rows = bodyRowsOf(await mount());

    expect(rows).toHaveLength(2);

    // The componentised column renders its own element and no text of its own, which is how the clients list's Status column carries a swatch and never a word (AAP 0.10.5 difference 11).
    const swatches = rows.map((row) => row.cells[2].querySelector('.probe-swatch'));
    expect(swatches.map((swatch) => swatch?.getAttribute('data-status'))).toEqual([
      'active',
      'pending',
    ]);
    expect(rows[0].cells[2].textContent?.trim()).toBe('');

    // Every other column renders from the context's own `value`, so a caller componentises one cell without restating the text of the rest.
    expect(cellTexts(rows[0])).toEqual(['Ana Rivera', 'Head Office', '']);
    expect(cellTexts(rows[1])).toEqual(['Luis Ortega', 'Kigali Branch', '']);
  });
});
