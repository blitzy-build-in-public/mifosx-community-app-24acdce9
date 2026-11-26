import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DataTableComponent, type ColumnDef } from './data-table.component';

/**
 * Behavioural spec for `DataTableComponent`, the generic table AAP 0.2.3's inventory requires the
 * new app to provide (row `ClientList / DataTable`; Figma node `1:3`; Rule 1 clause 8, which allows
 * no empty or boilerplate specs).
 *
 * What it pins is what only the rendered table can say, because those are the properties a rewrite
 * would silently change:
 *
 *  1. the header prints one `<th scope="col">` per column, in the caller's order, from the column's
 *     own already-translated label — the six columns of the clients list are the caller's business,
 *     the `<th>` shape is this component's;
 *  2. the body prints one `<tr>` per row and one `<td>` per column, holding the column's own text for
 *     that row, so the table renders the caller's data and nothing else;
 *  3. the `<table>` carries the caller's id and class list inside Bootstrap's `.table-responsive`
 *     wrapper, which is what keeps the clients list's column proportions and the harness's
 *     `#client-list` handle attached to the same element (Rule 1 clauses 3 and 6);
 *  4. a row opens the destination the caller supplies, as one link over the whole row and with no
 *     control inside it — the legacy table's own affordance and the design's (AAP 0.7.4);
 *  5. a table the caller gives no destination renders no link at all: no `href`, no tab stop and no
 *     navigation, so a read-only table is not a table of dead links;
 *  6. a caller's cell template renders instead of the column's text for every cell and receives the
 *     row, the column and the column's value — which is how the clients list's Status column becomes
 *     an `app-status-swatch` (AAP 0.2.3 row `StatusSwatch`; AAP 0.10.5 deliberate difference 11);
 *  7. the rows and their order follow the input when it changes, tracked by the caller's key, so a
 *     replaced page repaints instead of keeping the rows it first painted;
 *  8. an empty row list renders the header and no body row, which is the empty state a caller paints
 *     beside it rather than a row invented here (Rule 1 clause 3).
 *
 * The two hosts below are the only place the component's generic contract is exercised from a
 * template, which is what proves it composes with a feature's own row type while `shared/` names none
 * of it (AAP 0.14.1 "`shared` never imports from `features`"). The router is provided empty because
 * no case completes a navigation: each asserts the destination the row asks the router for.
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

    // `.table-responsive` is Bootstrap 3's own wrapper: inert above 768px, and below it what keeps the
    // columns from pushing the page into horizontal scroll. It contributes no class of its own to the
    // table, whose class list is exactly the caller's — read as a set, because the DOM does not
    // promise the order the binding wrote them in (Rule 1 clause 6).
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

    // A row that opens a record wears legacy's own class, which is what the global layer paints the
    // hover cursor, the brand-blue fill and white text from (`app/views/clients/clients.html:64`;
    // `_content.scss:413-417`). A table whose caller names no class carries none, so an unclassed
    // table cannot inherit a treatment it did not ask for (Rule 1 clause 3).
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

    // The row is a row, not a dead link: nothing is navigated.
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

    // No stale row survives the replacement: the loop tracks the caller's key rather than filling the
    // rows it already painted in place.
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

    // The componentised column renders its own element and no text of its own, which is how the
    // clients list's Status column carries a swatch and never a word (AAP 0.10.5 difference 11).
    const swatches = rows.map((row) => row.cells[2].querySelector('.probe-swatch'));
    expect(swatches.map((swatch) => swatch?.getAttribute('data-status'))).toEqual([
      'active',
      'pending',
    ]);
    expect(rows[0].cells[2].textContent?.trim()).toBe('');

    // Every other column renders from the context's own `value`, so a caller componentises one cell
    // without restating the text of the rest.
    expect(cellTexts(rows[0])).toEqual(['Ana Rivera', 'Head Office', '']);
    expect(cellTexts(rows[1])).toEqual(['Luis Ortega', 'Kigali Branch', '']);
  });
});
