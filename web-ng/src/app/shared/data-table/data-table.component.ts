import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, type TemplateRef, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** One column of a {@link DataTableComponent}: the identity the table tracks it by, the label its header prints and the text its cells render (AAP 0.2.3 row `ClientList / DataTable`, which fixes the `columns: ColumnDef[]` prop; Figma node `1:3`). The definition is deliberately inert — no width, alignment, formatter or renderer — because every visual value of the table belongs to the global Bootstrap 3 layer, including the clients list's column proportions, which `web-ng/src/styles.scss` sizes through the caller's own class (Rule 1 clause 6). */
export interface ColumnDef<TRow> {
  /** Stable identity of the column, used as the `track` key of the header and cell loops, so the columns must be unique by `key`. It is never printed: the header prints {@link header}. */
  readonly key: string;

  /** The column's header label, already translated by the caller, rendered as the `<th>`'s text in the caller's column order (AAP 0.2.3 row `ClientList / DataTable`; Figma node `1:3`). */
  readonly header: string;

  /** The cell text this column prints for a row, called once per rendered cell. A value the payload did not carry is the empty string, so a cell can be blank but never blank-and-invented (Rule 1 clause 3). */
  readonly value: (row: TRow) => string;
}

/** The context a caller's cell template receives through {@link DataTableComponent.cellTemplate} (AAP 0.2.3 row `ClientList / DataTable`): it is what lets one cell render a component instead of text — the clients list's Status column, whose whole content is a colour swatch and no word (AAP 0.2.3 row `StatusSwatch`; AAP 0.10.5 item 11; Figma node `1:3`) — while every other cell stays the column's own text. */
export interface DataTableCellContext<TRow> {
  /** The row the cell belongs to, which is how a `let-row` template variable receives it. */
  readonly $implicit: TRow;

  /** The column the cell belongs to, so one template can serve several columns. */
  readonly column: ColumnDef<TRow>;

  /** The text {@link ColumnDef.value} produces for this row, already resolved, for a cell that renders the value beside or instead of its own component. */
  readonly value: string;
}

/**
 * The bootstrap table the design's list screens paint, with its rows, its columns, the row link and an optional component cell supplied by the caller (AAP 0.2.3 row `ClientList / DataTable`; Figma node `1:3`, step 2 of "Sign in and open a client record").
 *
 * Generic, because `shared` may not name a feature's model: AAP 0.2.3 fixes the props as `rows: Client[]` and `columns: ColumnDef[]`, and AAP 0.14.1 forbids `shared` importing from `features`, so the component states them over its own type parameter — `rows: readonly TRow[]`, `columns: readonly ColumnDef<TRow>[]` — letting a feature hand in its own row without `shared` naming it.
 *
 * Every visual value comes from the global layer: the header band, its 2px rule, the 34–36px rows and the 1px separators are Bootstrap 3's `.table` metrics as `web-ng/src/styles.scss` declares them (AAP 0.2.3; AAP 0.2.2 `color-table-head`, `color-rule`; Rule 1 clause 6), the `.table-responsive` wrapper is Bootstrap's own, and the caller's {@link tableClasses} carries the screen's class. This component declares no stylesheet, colour or dimension.
 *
 * The caller decides the columns and their order, the row key, the destination a row opens, the id and classes of the `<table>`, its accessible name and whether a cell is a component; this component adds no sort affordance, row action, selection, paging or empty state, because inventing one would be behaviour the legacy screens do not have (Rule 1 clause 3). When {@link rowLink} is set every `<tr>` carries it — the affordance the legacy tables give each cell (`data-ng-click="routeTo(client.id)"`), painted with no link styling of its own (AAP 0.7.4; Figma node `1:3`) — and when it is `null` the rows carry no link at all: `RouterLink` bound `null` navigates nothing, writes no `href`, adds no tab stop and leaves both keys untouched, so a read-only table is not a table of dead links. The keyboard reaches that link, and that is this component's one deliberate departure from legacy: `RouterLink` gives a non-anchor host a tab stop but binds no activation of its own, so {@link activateRow} hands Enter and Space to the row's own click — one navigation, through the same `RouterLink`, so the same URL, request and error handling. Legacy's rows were pointer-only (`app/views/clients/clients.html:64-73`: no `tabindex`, no key handler), so this departs from Rule 1 clause 3, which allows a recorded difference: the row already offers pointer users the record, so a tab stop a keyboard cannot activate withholds a control it visibly offers. The departure is invisible — no pixel, no request, no route, no `role` and no `aria-*` attribute changes; the row keeps the `<tr>` role a `role="link"` would destroy.
 */
@Component({
  selector: 'app-data-table',
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './data-table.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataTableComponent<TRow> {
  /** The rows to render, in the caller's order — never sorted, filtered or copied here (AAP 0.2.3 row `ClientList / DataTable`, whose prop is the table's `rows`; Figma node `1:3`). Required: an empty list is how a caller renders no rows. */
  readonly rows = input.required<readonly TRow[]>();

  /** The columns to render, in the order the header and every row print them (AAP 0.2.3 row `ClientList / DataTable`, whose prop is `columns: ColumnDef[]`; Figma node `1:3`). The clients list's six are the legacy table's own — name, client number, external id, status, office, staff. */
  readonly columns = input.required<readonly ColumnDef<TRow>[]>();

  /** Stable identity of a row for the body loop's `track`, unique across the rows in hand so the loop never falls back to the index and a re-render reconciles rows instead of rebuilding them (AAP 0.2.3 row `ClientList / DataTable`). The clients list uses the client's own key, unique across a list page and a search answer alike. */
  readonly rowKey = input.required<(row: TRow) => string>();

  /** The route a row opens, as `RouterLink` commands — `['/viewclient', row.clientId]` on the clients list — or `null` for a table whose rows open nothing (AAP 0.7.4 "Clients list (`#/clients`)"; Figma node `1:3`). A `null` renders no link at all. */
  readonly rowLink = input<((row: TRow) => readonly (string | number)[]) | null>(null);

  /** The class list of the `<table>` itself, defaulting to the plain Bootstrap 3 table (`.table` with `.table-striped`'s banded rows, which is what the design's lists paint — AAP 0.2.3 row `ClientList / DataTable`; Figma node `1:3`). A caller adds its screen's class beside them, e.g. `table table-striped client-list`, which is where the clients list's column proportions are sized from (Rule 1 clause 6). */
  readonly tableClasses = input<string>('table table-striped');

  /** The id of the `<table>`, or `null` for none. The clients list passes `client-list`, the id the legacy table carried and the one the parity harness addresses the table by (Rule 1 clause 3; AAP 0.7.4). */
  readonly tableId = input<string | null>(null);

  /** The table's accessible name, or `null` for a table that carries none: a visually hidden `<caption>`, the `<table>`'s own first child, so a screen reader announces the table by it. The clients list passes the legacy bundle's own `label.heading.clients`, already translated, and Bootstrap's `.sr-only` keeps it off the screen (Rule 1 clause 6). */
  readonly caption = input<string | null>(null);

  /** The class the rendered `<tr>` carries, or `null` for none — the caller's own row treatment, as {@link tableClasses} is its table treatment. The clients list passes `pointer-main`, the class the legacy table puts on a row that opens a record and the one the global layer paints with the pointer cursor, the brand-blue fill and white text on hover (`app/views/clients/clients.html:64`; `app/styles-dev/main/components/_content.scss:413-417`; AAP 0.7.4; Figma node `1:3`). */
  readonly rowClass = input<string | null>(null);

  /** Optional template for every data cell, receiving a {@link DataTableCellContext}: the one cell of the clients list that is not text, its Status column, is rendered through it as an `app-status-swatch` (AAP 0.2.3 rows `ClientList / DataTable` and `StatusSwatch`; AAP 0.10.5 item 11; Figma node `1:3`). `null` renders every cell as its column's own {@link ColumnDef.value}. */
  readonly cellTemplate = input<TemplateRef<DataTableCellContext<TRow>> | null>(null);

  /** The `RouterLink` commands for a row, or `null` when the caller supplies no {@link rowLink}: the template binds this rather than the function, so `strictTemplates` checks the destination's shape and an unset link stays unset. @param row The row
   * being rendered. @returns The row's destination, or `null` for a row that opens nothing. */
  protected rowTarget(row: TRow): readonly (string | number)[] | null {
    const link = this.rowLink();

    return link === null ? null : link(row);
  }

  /** Opens a row from the keyboard: Enter or Space on the focused row activates the row's own click, so the keyboard reaches exactly the destination, the request and the error handling a pointer reaches — one navigation per key press, and no second
   * routing path to keep in agreement with `RouterLink` (Rule 1 clause 5, hash routing through the router). Space's default is cancelled once the row is known to open something, because that default scrolls the page behind the row; Enter has no
   * default action on a table row. A row with no destination ({@link rowLink} `null`) is left entirely alone: nothing navigates and not even the key's default is touched. @param row The row the key was pressed on. @param event The row's key event,
   * whose default is cancelled when it is Space and whose current target is the row element the activation is dispatched on. */
  protected activateRow(row: TRow, event: Event): void {
    if (!(event instanceof KeyboardEvent) || this.rowTarget(row) === null) {
      return;
    }

    if (event.key === ' ') {
      event.preventDefault();
    }

    const host: EventTarget | null = event.currentTarget;

    if (host instanceof HTMLElement) {
      host.click();
    }
  }

  /** The context a cell's template receives, resolved once per cell: the row as `$implicit`, the column it belongs to and that column's text for the row. @param row The row the cell belongs to. @param column The column the cell belongs to. @returns
   * The context object {@link DataTableCellContext} types. */
  protected cellContext(row: TRow, column: ColumnDef<TRow>): DataTableCellContext<TRow> {
    return { $implicit: row, column, value: column.value(row) };
  }
}
