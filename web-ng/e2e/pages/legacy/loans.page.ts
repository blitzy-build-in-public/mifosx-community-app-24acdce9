/**
 * Baseline page object for the individual-loan screens of the legacy AngularJS application — the
 * unchanged Mifos X community-app served on port 9090, which the parity run measures before the new
 * Angular application is judged (AAP 0.10.1, "Baseline first"; AAP 0.9.3, "Baseline").
 *
 * Six hash routes of the legacy route table are driven here (AAP 0.8.2, mirrored by
 * `web-ng/tools/parity/in-scope-routes.json`):
 *
 * - `#/newclientloanaccount/:clientId` — the application wizard (newloanaccount.html)
 * - `#/editloanaccount/:id` — the application form in edit mode
 * - `#/viewloanaccount/:id` — the loan record (viewloanaccountdetails.html)
 * - `#/loanaccount/:id/:action` — the action forms (loanaccountactions.html)
 * - `#/addloancharge/:id` — the add-charge form (addloancharge.html)
 * - `#/loanaccountcharge/:id/:action/:chargeId` — the charge pay/waive forms
 *
 * Workflows served (AAP 0.10.1): **W4** the application submitted after a repayment-schedule
 * preview, **W5** approve and disburse with exactly one request per action, **W6** the repayment of
 * the first period's total due, and **W7** the server's validation error for a principal above the
 * product maximum.
 *
 * Two rules shape the whole file:
 *
 * - **Rule 2 (the backend).** Every `open*()` method loads the legacy application through this page
 *   object's own `entryUrl` composition, which always carries `baseApiUrl` and `tenantIdentifier` in
 *   the query. Without those two parameters the legacy app targets its public demo host instead of
 *   the locally built Fineract, so they are part of the contract, never an optional extra.
 * - **Rule 1 clause 3 (match legacy, do not improve it).** W7 depends on the server rejecting a
 *   principal of 50,000 above the product's 10,000 maximum. Nothing in this file reads, bounds,
 *   rounds, blocks or warns about the principal, and no field is given a `min`, `max` or length
 *   limit: the value the spec supplies is the value the form receives, and the server's answer is
 *   the one the workflow asserts.
 *
 * This is a page object, not a test: it locates and reads, and it raises a message naming what it
 * looked for when the page does not offer it. It asserts nothing (no `expect`), writes nothing,
 * prints nothing, and imports no credential (Rule 1 clause 9).
 *
 * The legacy source tree is not part of this checkout. Every selector below is grounded in the
 * read-only reference clone of `openMF/community-app` at commit `45ec7b8` — the template or
 * controller named beside it — and must be confirmed against the running legacy application.
 */
import type { ElementHandle, Locator, Page } from '@playwright/test';
import { FINERACT_URL, LEGACY_URL, TENANT_ID, formatFineractDate } from '../../seed/fixtures';
import { chooseOption } from './chosen';

/** The values an application form is filled with. Only the fields a caller supplies are touched. */
export interface LoanApplicationValues {
  productName?: string;
  submittedOnDate?: Date;
  expectedDisbursementDate?: Date;
  principal?: string;
  numberOfRepayments?: string;
  repaymentEvery?: string;
  repaymentFrequency?: string;
  interestRatePerPeriod?: string;
  amortizationType?: string;
  interestType?: string;
  interestCalculationPeriodType?: string;
  transactionProcessingStrategy?: string;
  loanOfficerName?: string;
  fundName?: string;
  chargeAmounts?: string[];
}

/** One period of the repayment schedule the application form previews. */
export interface RepaymentPreviewRow {
  period: string;
  fromDate: string;
  dueDate: string;
  principalDue: string;
  interestDue: string;
  feesDue: string;
  totalDue: string;
  totalOutstandingForPeriod: string;
}

/** One label/value pair of the loan record's summary. */
export interface LoanSummaryField {
  label: string;
  value: string;
}

/** The loan record's status, as the class its indicator carries, beside the summary's pairs. */
export interface LoanSummary {
  statusClass: string;
  fields: LoanSummaryField[];
}

/** One period of the loan record's repayment schedule. */
export interface ScheduleRow {
  period: string;
  fromDate: string;
  dueDate: string;
  principalDue: string;
  interestDue: string;
  feesDue: string;
  totalDue: string;
  totalPaid: string;
  totalOutstandingForPeriod: string;
}

/** One row of the loan record's transaction list. */
export interface TransactionRow {
  id: string;
  date: string;
  type: string;
  amount: string;
  principal: string;
  interest: string;
  fees: string;
  outstandingBalance: string;
  reversed: string;
}

/** One row of the loan record's charge list. */
export interface ChargeRow {
  name: string;
  amount: string;
  amountPaid: string;
  amountWaived: string;
  amountOutstanding: string;
}

/** The values an action, repayment or charge form is filled with. */
export interface LoanActionValues {
  date?: Date;
  amount?: string;
  note?: string;
  paymentType?: string;
  reasonName?: string;
}

/**
 * The loan actions `#/loanaccount/:id/:action` accepts (AAP 0.8.2, AAP 0.10.1 W5). The union is the
 * whole allowed set, so any other string fails to compile.
 */
export type LoanAccountAction =
  | 'approve'
  | 'undoapproval'
  | 'reject'
  | 'disburse'
  | 'undodisbursal'
  | 'repayment';

/** The loan-charge actions `#/loanaccountcharge/:id/:action/:chargeId` accepts (AAP 0.7.3). */
export type LoanChargeAction = 'pay' | 'waive';

/**
 * The route segment each charge action occupies. The union names the Fineract command
 * (`?command=pay`, `?command=waive`, AAP 0.7.3); the legacy route spells the same action
 * `paycharge`/`waivecharge`, as the links in viewloanaccountdetails.html and the `case` labels of
 * LoanAccountActionsController.js do. Confirm against the running legacy app.
 */
const CHARGE_ROUTE_SEGMENT: Readonly<Record<LoanChargeAction, string>> = {
  pay: 'paycharge',
  waive: 'waivecharge',
};

/** Positions a period column of the application form's preview table (newloanaccount.html). */
const PREVIEW_TABLE_HEADERS = ['principal due', 'interest due', 'due'] as const;

/**
 * Positions the record's Repayment Schedule table. It is the only one of the three schedule tables
 * that carries both a `Due` and a `Paid` column (viewloanaccountdetails.html), which is what
 * separates it from the Original and Future schedules.
 */
const SCHEDULE_TABLE_HEADERS = ['principal due', 'interest', 'fees', 'due', 'paid'] as const;

/** Positions the record's transaction list, whose second header row carries `Principal`. */
const TRANSACTION_TABLE_HEADERS = ['transaction type', 'amount', 'principal'] as const;

/** Positions the record's charge list, the only table headed `Name` that also has `Outstanding`. */
const CHARGE_TABLE_HEADERS = ['name', 'outstanding'] as const;

/** Positions the record's summary matrix (rows Principal/Interest/Fees/Penalties/Total). */
const SUMMARY_TABLE_HEADERS = ['original', 'paid', 'outstanding', 'overdue'] as const;

/** The tab headings each read section lives under (viewloanaccountdetails.html `uib-tabset`). */
const SECTION_TABS = {
  schedule: ['repayment schedule'],
  transactions: ['transactions'],
  charges: ['charges'],
} as const;

/** Column aliases per summary field, most specific first. An absent column reads as `''`. */
const PREVIEW_COLUMNS = {
  period: ['#', 'period', 'no.'],
  fromDate: ['from date', 'period from'],
  dueDate: ['date', 'due date'],
  principalDue: ['principal due'],
  interestDue: ['interest due', 'interest'],
  feesDue: ['fees', 'fees due'],
  totalDue: ['due', 'total due'],
  totalOutstandingForPeriod: ['total outstanding', 'outstanding'],
} as const;

/** Column aliases per schedule field, most specific first. */
const SCHEDULE_COLUMNS = {
  period: ['#', 'period', 'no.'],
  fromDate: ['from date', 'period from'],
  dueDate: ['date', 'due date'],
  principalDue: ['principal due'],
  interestDue: ['interest', 'interest due'],
  feesDue: ['fees', 'fees due'],
  totalDue: ['due', 'total due'],
  totalPaid: ['paid', 'total paid'],
  totalOutstandingForPeriod: ['outstanding', 'total outstanding'],
} as const;

/** Column aliases per transaction field, most specific first. */
const TRANSACTION_COLUMNS = {
  id: ['id'],
  date: ['transaction date', 'date'],
  type: ['transaction type', 'type'],
  amount: ['amount'],
  principal: ['principal'],
  interest: ['interest'],
  fees: ['fees'],
  outstandingBalance: ['loan balance', 'outstanding balance', 'balance'],
} as const;

/** Column aliases per charge field, most specific first. */
const CHARGE_COLUMNS = {
  name: ['name'],
  amount: ['due', 'amount'],
  amountPaid: ['paid', 'amount paid'],
  amountWaived: ['waived', 'amount waived'],
  amountOutstanding: ['outstanding', 'amount outstanding'],
} as const;

/** The legacy form control each fillable field resolves to, by label text and by element id. */
interface FieldSpec {
  /** Field key as the models spell it, used for the `formControlName` fallback. */
  readonly key: string;
  /** Element id the legacy form gives the control. */
  readonly id: string;
  /** Label texts, in the legacy's own English wording (app/global-translations/locale-en.json). */
  readonly labels: readonly string[];
}

/**
 * The four fields `fillApplication` types into, by the model's own key, plus the two the action and
 * charge forms carry. `fillFieldByLabel` resolves one of these by its label text first, then by the
 * element id the legacy template fixes, then by `formControlName`, then by placeholder.
 */
const FILLABLE_FIELDS: ReadonlyMap<string, FieldSpec> = new Map<string, FieldSpec>([
  ['principal', { key: 'principal', id: 'principal', labels: ['Principal'] }],
  [
    'numberOfRepayments',
    { key: 'numberOfRepayments', id: 'numberOfRepayments', labels: ['Number of repayments'] },
  ],
  ['repaymentEvery', { key: 'repaymentEvery', id: 'repaymentEvery', labels: ['Repaid every'] }],
  [
    'interestRatePerPeriod',
    { key: 'interestRatePerPeriod', id: 'interestRatePerPeriod', labels: ['Nominal interest rate'] },
  ],
  [
    'transactionAmount',
    { key: 'transactionAmount', id: 'transactionAmount', labels: ['Transaction amount', 'Amount'] },
  ],
  ['chargeAmount', { key: 'amount', id: 'amount', labels: ['Amount'] }],
  ['note', { key: 'note', id: 'note', labels: ['Note'] }],
]);

/**
 * The dropdown of the application form each `LoanApplicationValues` field selects from
 * (newloanaccount.html). Whether a given control is a `chosen` widget or a plain `<select>` depends
 * on the legacy template, and `chooseOption` handles both.
 */
const APPLICATION_SELECTS = {
  productName: 'select#productId',
  loanOfficerName: 'select#loanOfficerId',
  fundName: 'select#fundId',
  repaymentFrequency: 'select#repaymentFrequencyType',
  amortizationType: 'select#amortizationType',
  interestType: 'select#interestType',
  interestCalculationPeriodType: 'select#interestCalculationPeriodType',
  transactionProcessingStrategy: 'select#transactionProcessingStrategyId',
} as const;

/** The table a reader asked for, as the page serialised it: header texts per column, then rows. */
interface TableGrid {
  /** One entry per column: every non-empty header text that sits above that column. */
  readonly columns: readonly (readonly string[])[];
  /** Data rows, each an array of cell texts positioned by column. */
  readonly rows: readonly (readonly string[])[];
  /** The class attribute of each data row, for the reversal indicator transactions carry. */
  readonly rowClasses: readonly string[];
}

/** The wizard step whose form a transition starts from, and the one it lands on. */
type WizardStep = 'Details' | 'Terms' | 'Charges' | 'review';

/** How long a route is given to render its own root locator before the hash fallback is used. */
const ROUTE_READY_TIMEOUT_MS = 15_000;

/**
 * Runs inside the legacy page, so it references nothing from module scope — Playwright serialises
 * the function and evaluates it in the document.
 *
 * Resolves the form control a field names: by its label text first (the legacy templates put the
 * label in a table cell or a Bootstrap `.form-group` beside the control), then by the element id the
 * template fixes, then by `formControlName`, and finally by placeholder text. It answers the control
 * itself — including a disabled or read-only one — so the caller can report that state precisely
 * instead of pretending the field was filled.
 */
function resolveFieldElement(spec: FieldSpec): Element | null {
  const squish = (text: string | null | undefined): string =>
    (text ?? '').replace(/\s+/g, ' ').trim();
  const normalize = (text: string | null | undefined): string => squish(text).toLowerCase();
  const isControl = (element: Element | null): element is HTMLElement =>
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement;
  const isWritable = (element: Element | null): boolean => {
    if (!isControl(element)) return false;
    if (element.hasAttribute('disabled')) return false;
    return !element.hasAttribute('readonly');
  };
  const pick = (scope: Element | null): Element | null => {
    if (scope === null) return null;
    const inside = Array.from(scope.querySelectorAll('.form-control'));
    if (inside.length === 0) return null;
    const writable = inside.filter(isWritable);
    return writable.length > 0 ? writable[0] : inside[0];
  };

  const wanted = spec.labels.map(normalize);
  let bestLabel: Element | null = null;
  let bestLength = 0;
  for (const label of Array.from(document.querySelectorAll('label'))) {
    const text = normalize(label.textContent);
    const matches = wanted.some(
      (target) =>
        text === target ||
        text.indexOf(target + ' ') === 0 ||
        text.indexOf(target + ':') === 0 ||
        text.indexOf(target + '*') === 0,
    );
    if (!matches) continue;
    // The shortest matching label wins, so "Principal *" is not confused with a longer label that
    // merely begins with the same word.
    if (bestLabel === null || text.length < bestLength) {
      bestLabel = label;
      bestLength = text.length;
    }
  }
  if (bestLabel !== null) {
    const explicitId = bestLabel.getAttribute('for');
    if (explicitId !== null) {
      const explicit = document.getElementById(explicitId);
      if (isWritable(explicit)) return explicit;
    }
    const wrapped = pick(bestLabel);
    if (wrapped !== null) return wrapped;
    const grouped = pick(bestLabel.closest('tr') ?? bestLabel.closest('.form-group'));
    if (grouped !== null) return grouped;
    for (const candidate of Array.from(document.querySelectorAll('.form-control'))) {
      const relation = bestLabel.compareDocumentPosition(candidate);
      if ((relation & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && isWritable(candidate)) {
        return candidate;
      }
    }
  }

  const byId = document.getElementById(spec.id);
  if (isWritable(byId)) return byId;

  // Angular reactive forms do not keep the attribute in the DOM, so this fallback answers only where
  // a form renders it; it is documented rather than relied on.
  const byFormControl = document.querySelector(`[formcontrolname="${spec.key.toLowerCase()}"]`);
  if (isWritable(byFormControl)) return byFormControl;

  for (const candidate of Array.from(
    document.querySelectorAll('input[placeholder], textarea[placeholder]'),
  )) {
    const placeholder = normalize(candidate.getAttribute('placeholder'));
    if (wanted.some((target) => placeholder === target || placeholder.indexOf(target) === 0)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Runs inside the legacy page: writes a value into a control and tells AngularJS and the jQuery
 * plugins about it. This is the path a read-only datepicker input needs, because the browser refuses
 * to type into it.
 */
function applyNativeValue(element: Element, value: string): void {
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) return;
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Runs inside the legacy page: the header texts of the first table carrying every required column
 * label, with the table's data rows positioned by column.
 *
 * Column positions are accumulated across the cells that precede each one, so a grouped header row
 * that spans several columns still lines up with the specific labels the row beneath it carries —
 * `cellIndex` alone would count each spanning cell once and shift every label after it. Header rows
 * are the rows of `<thead>`, plus — for the legacy preview table, which renders its labels as the
 * first row of its body — the first body row when it repeats at least two required labels. Rows of
 * `<tfoot>` (the schedule's totals) are not data. `rowspan` is not honoured: no in-scope legacy table
 * uses it.
 */
function readTableGrid(required: readonly string[]): TableGrid | null {
  const squish = (text: string | null | undefined): string =>
    (text ?? '').replace(/\s+/g, ' ').trim();
  const normalize = (text: string | null | undefined): string => squish(text).toLowerCase();
  const wanted = required.map(normalize);

  const headerRowsOf = (table: HTMLTableElement): HTMLTableRowElement[] => {
    const rows: HTMLTableRowElement[] = [];
    if (table.tHead !== null) {
      rows.push(...Array.from(table.tHead.rows));
    }
    const body = table.tBodies[0];
    if (body !== undefined && body.rows.length > 0) {
      const first = body.rows[0];
      const labels = Array.from(first.cells).map((cell) => normalize(cell.textContent));
      const repeated = wanted.filter((alias) => labels.indexOf(alias) >= 0).length;
      // Two matching labels are enough to tell a label row from a data row. The legacy preview table
      // renders its column labels at the top of the body, under a grouped header row in `<thead>`, so
      // the body is inspected even when header rows exist.
      if (repeated >= 2) rows.push(first);
    }
    return rows;
  };

  const gridOf = (table: HTMLTableElement, headerRows: HTMLTableRowElement[]): TableGrid | null => {
    // Column positions are accumulated across the cells before them: `cellIndex` counts cells, so a
    // cell spanning four columns would otherwise shift every label after it by three.
    let width = 0;
    const labelled: { readonly column: number; readonly text: string }[] = [];
    for (const row of headerRows) {
      let column = 0;
      for (const cell of Array.from(row.cells)) {
        const span = cell.colSpan > 0 ? cell.colSpan : 1;
        const text = squish(cell.textContent);
        if (text.length > 0) {
          for (let offset = 0; offset < span; offset += 1) {
            labelled.push({ column: column + offset, text });
          }
        }
        column += span;
      }
      if (column > width) width = column;
    }
    if (width === 0) return null;
    const columns: string[][] = [];
    for (let index = 0; index < width; index += 1) columns.push([]);
    for (const entry of labelled) {
      if (entry.column < width) columns[entry.column].push(entry.text);
    }
    const headerSet = new Set<Element>(headerRows);
    const rows: string[][] = [];
    const rowClasses: string[] = [];
    for (const row of Array.from(table.rows)) {
      if (headerSet.has(row)) continue;
      const section = row.parentElement;
      if (section !== null && section.tagName === 'TFOOT') continue;
      const cells: string[] = [];
      for (let index = 0; index < width; index += 1) cells.push('');
      let column = 0;
      let placed = 0;
      for (const cell of Array.from(row.cells)) {
        if (column < width) {
          cells[column] = squish(cell.textContent);
          placed += 1;
        }
        column += cell.colSpan > 0 ? cell.colSpan : 1;
      }
      if (placed === 0) continue;
      rows.push(cells);
      rowClasses.push(squish(row.getAttribute('class')));
    }
    return { columns, rows, rowClasses };
  };

  for (const candidate of Array.from(document.querySelectorAll('table'))) {
    if (!(candidate instanceof HTMLTableElement)) continue;
    const headerRows = headerRowsOf(candidate);
    if (headerRows.length === 0) continue;
    const grid = gridOf(candidate, headerRows);
    if (grid === null) continue;
    const carriesAll = wanted.every((alias) =>
      grid.columns.some((texts) => texts.some((text) => normalize(text) === alias)),
    );
    if (carriesAll) return grid;
  }
  return null;
}

/**
 * Runs inside the legacy page: the position of the first tab whose heading matches one of `wanted`,
 * or `-1` when the page carries no such tab. The record's sections are `uib-tab` panes, and each
 * pane sits at its tab's position.
 */
function findTabIndex(wanted: readonly string[]): number {
  const normalize = (text: string | null | undefined): string =>
    (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const targets = wanted.map(normalize);
  const tabs = Array.from(document.querySelectorAll('ul.nav-tabs > li'));
  for (let index = 0; index < tabs.length; index += 1) {
    const heading = normalize(tabs[index].textContent);
    if (targets.some((target) => heading.indexOf(target) >= 0)) return index;
  }
  return -1;
}

/** Runs inside the legacy page: moves the AngularJS router, which listens for a hash change. */
function setWindowHash(hash: string): void {
  window.location.hash = hash;
}

/**
 * Runs inside the legacy page: the class of the record's rendered status indicator.
 *
 * The legacy header draws the status as a Font Awesome `fa-stop` glyph, so the `<i>` carries no text
 * and no box of its own — `:visible` would report it as hidden. `offsetParent` is the rendering test
 * that still answers for such an element, and it is also what separates the icon the record shows
 * from the copy the header hides when the loan is in arrears. Confirm against the running legacy app.
 */
function readStatusIndicatorClass(): string {
  for (const icon of Array.from(document.querySelectorAll('i.fa-stop'))) {
    if (icon instanceof HTMLElement && icon.offsetParent !== null) {
      return (icon.getAttribute('class') ?? '').replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

/** Narrows the grid a page function answered with; the DOM boundary stops at this guard. */
function isTableGrid(value: unknown): value is TableGrid {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { columns?: unknown; rows?: unknown; rowClasses?: unknown };
  if (!Array.isArray(candidate.columns)) return false;
  if (!Array.isArray(candidate.rows)) return false;
  return Array.isArray(candidate.rowClasses);
}

/** A grid with no columns and no rows, so a reader of an absent table answers `[]`. */
function emptyGrid(): TableGrid {
  return { columns: [], rows: [], rowClasses: [] };
}

/** The index of the column an alias list names, or `-1` when the table carries none of them. */
function columnIndex(grid: TableGrid, aliases: readonly string[]): number {
  for (const alias of aliases) {
    const wanted = alias.trim().toLowerCase();
    const index = grid.columns.findIndex((texts) =>
      texts.some((text) => text.trim().toLowerCase() === wanted),
    );
    if (index >= 0) return index;
  }
  return -1;
}

/** One cell of a row, `''` when the row or the column is absent. */
function cellAt(cells: readonly string[], index: number): string {
  if (index < 0 || index >= cells.length) return '';
  return (cells[index] ?? '').trim();
}

/**
 * Sets a legacy date control, which is a jQuery datepicker input rather than a native date field
 * (AAP 0.10.5 item 1: the new application replaces it with `input[type=date]`, so only this side
 * needs the plugin's behaviour).
 *
 * The text is the `dd MMMM yyyy` form every date-bearing Fineract payload carries
 * (Rule 1 clause 2), which is also the format the legacy `datepicker-pop` attribute declares. The
 * modified plugin parses the field on blur and may rewrite it, so the value is read back and, when
 * it did not stick — or when the field is the read-only one addloancharge.html renders — written
 * through native events before being checked once more. Confirm against the running legacy app.
 */
async function setLegacyDate(input: Locator, date: Date): Promise<void> {
  const field = input.first();
  await field.waitFor({ state: 'visible' });
  const text = formatFineractDate(date).date;
  if (await field.isEditable()) {
    await field.fill(text);
    await field.press('Escape');
    await field.blur();
  }
  if ((await field.inputValue()) !== text) {
    await field.evaluate(applyNativeValue, text);
    if (await field.isEditable()) await field.press('Escape');
    await field.blur();
  }
  const applied = await field.inputValue();
  if (applied !== text) {
    throw new Error(
      `The date field shows "${applied}" after it was set to "${text}". ` +
        'A legacy datepicker that refuses the value needs the format its own attribute declares; ' +
        'confirm the field against the running legacy app.',
    );
  }
}


/**
 * The legacy application's individual-loan screens: the application wizard, the loan record, the
 * action forms and the charge forms.
 *
 * Every method takes and answers plain values. Nothing here asserts, retries or reports: a method
 * that cannot do what it was asked raises an `Error` naming the control or the value it looked for,
 * so a failure carries the page's own answer instead of a silent difference.
 */
export class LoansPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ---------------------------------------------------------------------------------------------
  // Application form — W4 and W7 (AAP 0.10.1)
  // ---------------------------------------------------------------------------------------------

  /**
   * Opens the loan application form for one client — `#/newclientloanaccount/:clientId` (AAP 0.8.2)
   * — and waits for the product select that the first wizard step renders (AAP 0.10.1 W4).
   */
  async openApplication(clientId: number): Promise<void> {
    await this.gotoHash(`/newclientloanaccount/${clientId}`, this.page.locator('select#productId'));
  }

  /**
   * Selects the loan product by its visible name (AAP 0.10.1 W4, AAP 0.3.4 row 14).
   *
   * The legacy controller re-requests the loan template when the product changes, and the template's
   * own defaults would overwrite anything typed before it arrives, so this waits for the fields the
   * template fills — a locator wait on the controls being present and enabled, not a pause.
   */
  async selectProduct(name: string): Promise<void> {
    const select = this.page.locator(APPLICATION_SELECTS.productName);
    await select.waitFor({ state: 'visible' });
    await chooseOption(this.page, select.first(), name);
    await this.page.locator('#principal:enabled').waitFor({ state: 'visible' });
    await this.page.locator('#numberOfRepayments:enabled').waitFor({ state: 'visible' });
  }

  /**
   * Fills the application form with the values supplied, walking the wizard's own steps to reach the
   * control each one carries (AAP 0.10.1 W4; AAP 0.3.4 row 14).
   *
   * **No product bound is read, applied or reported.** W7 (AAP 0.10.1) requires a principal of 50,000
   * — above the product's 10,000 maximum — to leave this method untouched and reach the server, so
   * that the server's own `errors[].defaultUserMessage` is what the workflow asserts. Rule 1 clause 3
   * forbids adding a client-side validation the legacy form does not have, so do not add a limit, a
   * floor or ceiling, a rounding or a pre-submit check here.
   */
  async fillApplication(values: LoanApplicationValues): Promise<void> {
    if (values.productName !== undefined) {
      await this.selectProduct(values.productName);
    }
    if (values.loanOfficerName !== undefined) {
      await this.chooseField('loanOfficerName', values.loanOfficerName);
    }
    if (values.fundName !== undefined) {
      await this.chooseField('fundName', values.fundName);
    }
    if (values.submittedOnDate !== undefined) {
      await setLegacyDate(this.page.locator('input#submittedOnDate'), values.submittedOnDate);
    }
    if (values.expectedDisbursementDate !== undefined) {
      await setLegacyDate(
        this.page.locator('input#expectedDisbursementDate'),
        values.expectedDisbursementDate,
      );
    }

    const termValues: readonly (string | undefined)[] = [
      values.principal,
      values.numberOfRepayments,
      values.repaymentEvery,
      values.interestRatePerPeriod,
      values.repaymentFrequency,
      values.amortizationType,
      values.interestType,
      values.interestCalculationPeriodType,
      values.transactionProcessingStrategy,
    ];
    if (termValues.some((value) => value !== undefined)) {
      await this.reachTermsStep();
      if (values.principal !== undefined) {
        await this.fillFieldByLabel('principal', values.principal);
      }
      if (values.numberOfRepayments !== undefined) {
        await this.fillFieldByLabel('numberOfRepayments', values.numberOfRepayments);
      }
      if (values.repaymentEvery !== undefined) {
        await this.fillFieldByLabel('repaymentEvery', values.repaymentEvery);
      }
      if (values.interestRatePerPeriod !== undefined) {
        await this.fillFieldByLabel('interestRatePerPeriod', values.interestRatePerPeriod);
      }
      const termSelects = [
        'repaymentFrequency',
        'amortizationType',
        'interestType',
        'interestCalculationPeriodType',
        'transactionProcessingStrategy',
      ] as const;
      for (const field of termSelects) {
        const optionText = values[field];
        if (optionText !== undefined) {
          await this.chooseField(field, optionText);
        }
      }
    }

    if (values.chargeAmounts !== undefined && values.chargeAmounts.length > 0) {
      await this.reachChargesStep();
      await this.fillChargeAmounts(values.chargeAmounts);
    }
  }

  /**
   * Clicks the application form's repayment-schedule preview and waits for the schedule it renders
   * (AAP 0.10.1 W4; AAP 0.3.4 row 14: `POST /loans` with `command=calculateLoanSchedule`).
   *
   * The control lives in the wizard's Charges step, so the wizard is walked forward to it first when
   * the caller previews before filling anything. The preview request itself is observed in the
   * capture, not made here.
   */
  async previewSchedule(): Promise<void> {
    await this.reachChargesStep();
    const control = this.previewControl();
    await control.waitFor({ state: 'visible' });
    await control.click();
    await this.previewShown().waitFor({ state: 'visible' });
  }

  /**
   * Reads the previewed schedule, one entry per period (AAP 0.10.1 W4).
   *
   * Columns are read by their headers, so the legacy preview's own column set is what is reported and
   * a column it does not render — it carries neither a period start date nor a total outstanding —
   * answers `''`. The record's schedule table is not a substitute here: it does not exist until the
   * application has been submitted.
   */
  async readPreviewRows(): Promise<RepaymentPreviewRow[]> {
    const grid = await this.readTable(PREVIEW_TABLE_HEADERS);
    const period = columnIndex(grid, PREVIEW_COLUMNS.period);
    const fromDate = columnIndex(grid, PREVIEW_COLUMNS.fromDate);
    const dueDate = columnIndex(grid, PREVIEW_COLUMNS.dueDate);
    const principalDue = columnIndex(grid, PREVIEW_COLUMNS.principalDue);
    const interestDue = columnIndex(grid, PREVIEW_COLUMNS.interestDue);
    const feesDue = columnIndex(grid, PREVIEW_COLUMNS.feesDue);
    const totalDue = columnIndex(grid, PREVIEW_COLUMNS.totalDue);
    const outstanding = columnIndex(grid, PREVIEW_COLUMNS.totalOutstandingForPeriod);
    return grid.rows.map((cells) => ({
      period: cellAt(cells, period),
      fromDate: cellAt(cells, fromDate),
      dueDate: cellAt(cells, dueDate),
      principalDue: cellAt(cells, principalDue),
      interestDue: cellAt(cells, interestDue),
      feesDue: cellAt(cells, feesDue),
      totalDue: cellAt(cells, totalDue),
      totalOutstandingForPeriod: cellAt(cells, outstanding),
    }));
  }

  /**
   * Submits the application (AAP 0.10.1 W4): the wizard is walked to its Review step and the form's
   * primary submit is clicked exactly once. There is no assertion, no retry and no second click,
   * because the workflow's own capture is what proves the request.
   */
  async submitApplication(): Promise<void> {
    await this.reachReviewStep();
    const save = this.page.locator('button#save.btn.btn-primary:visible').first();
    await save.waitFor({ state: 'visible' });
    await save.click();
  }

  // ---------------------------------------------------------------------------------------------
  // Loan record — reads for W5 and W6 (AAP 0.10.1)
  // ---------------------------------------------------------------------------------------------

  /**
   * Opens the loan record — `#/viewloanaccount/:id` (AAP 0.8.2) — and waits for the record header
   * the actions and repayment workflows read their preconditions from (AAP 0.10.1 W5, W6).
   */
  async openView(loanId: number): Promise<void> {
    await this.gotoHash(`/viewloanaccount/${loanId}`, this.page.locator('.gray-head'));
  }

  /**
   * Reads the record's status and summary (AAP 0.10.2, "Fineract end state"; AAP 0.10.5 item 11).
   *
   * The status is reported as the class the record's indicator carries — the legacy header shows a
   * colour and no text, and adding a textual status would be the improvement the migration forbids.
   * The summary is the matrix the record renders, with each cell reported as `"<row> <column>"` —
   * `"Principal Original"`, `"Total Outstanding"` — so the principal and the outstanding balance a
   * workflow compares are both addressable, and a cell the record leaves blank answers `''`.
   */
  async readSummary(): Promise<LoanSummary> {
    const statusClass = await this.readStatusClass();
    const grid = await this.readTable(SUMMARY_TABLE_HEADERS);
    const fields: LoanSummaryField[] = [];
    for (const cells of grid.rows) {
      const rowLabel = cellAt(cells, 0);
      for (let index = 1; index < grid.columns.length; index += 1) {
        const labels = grid.columns[index];
        const columnLabel = labels === undefined ? '' : labels.join(' ').trim();
        const label = `${rowLabel} ${columnLabel}`.replace(/\s+/g, ' ').trim();
        if (label.length === 0) continue;
        fields.push({ label, value: cellAt(cells, index) });
      }
    }
    return { statusClass, fields };
  }

  /**
   * Reads the record's repayment schedule, one entry per period (AAP 0.10.1 W6 — the first period's
   * total due is the repayment W6 submits). The Repayment Schedule is picked out of the three
   * schedule tables by the columns only it carries; `[]` when the record shows none.
   */
  async readScheduleRows(): Promise<ScheduleRow[]> {
    await this.sectionPane(SECTION_TABS.schedule);
    const grid = await this.readTable(SCHEDULE_TABLE_HEADERS);
    const period = columnIndex(grid, SCHEDULE_COLUMNS.period);
    const fromDate = columnIndex(grid, SCHEDULE_COLUMNS.fromDate);
    const dueDate = columnIndex(grid, SCHEDULE_COLUMNS.dueDate);
    const principalDue = columnIndex(grid, SCHEDULE_COLUMNS.principalDue);
    const interestDue = columnIndex(grid, SCHEDULE_COLUMNS.interestDue);
    const feesDue = columnIndex(grid, SCHEDULE_COLUMNS.feesDue);
    const totalDue = columnIndex(grid, SCHEDULE_COLUMNS.totalDue);
    const totalPaid = columnIndex(grid, SCHEDULE_COLUMNS.totalPaid);
    const outstanding = columnIndex(grid, SCHEDULE_COLUMNS.totalOutstandingForPeriod);
    return grid.rows.map((cells) => ({
      period: cellAt(cells, period),
      fromDate: cellAt(cells, fromDate),
      dueDate: cellAt(cells, dueDate),
      principalDue: cellAt(cells, principalDue),
      interestDue: cellAt(cells, interestDue),
      feesDue: cellAt(cells, feesDue),
      totalDue: cellAt(cells, totalDue),
      totalPaid: cellAt(cells, totalPaid),
      totalOutstandingForPeriod: cellAt(cells, outstanding),
    }));
  }

  /**
   * Reads the record's transactions (AAP 0.10.1 W6: the repayment must appear as a row). `reversed`
   * carries the indicator the legacy row renders for a manually reversed transaction — its
   * `strikeoff` class — and `''` when the row is not reversed.
   */
  async readTransactions(): Promise<TransactionRow[]> {
    await this.sectionPane(SECTION_TABS.transactions);
    const grid = await this.readTable(TRANSACTION_TABLE_HEADERS);
    const id = columnIndex(grid, TRANSACTION_COLUMNS.id);
    const date = columnIndex(grid, TRANSACTION_COLUMNS.date);
    const type = columnIndex(grid, TRANSACTION_COLUMNS.type);
    const amount = columnIndex(grid, TRANSACTION_COLUMNS.amount);
    const principal = columnIndex(grid, TRANSACTION_COLUMNS.principal);
    const interest = columnIndex(grid, TRANSACTION_COLUMNS.interest);
    const fees = columnIndex(grid, TRANSACTION_COLUMNS.fees);
    const balance = columnIndex(grid, TRANSACTION_COLUMNS.outstandingBalance);
    return grid.rows.map((cells, index) => {
      const rowClass = grid.rowClasses[index];
      return {
        id: cellAt(cells, id),
        date: cellAt(cells, date),
        type: cellAt(cells, type),
        amount: cellAt(cells, amount),
        principal: cellAt(cells, principal),
        interest: cellAt(cells, interest),
        fees: cellAt(cells, fees),
        outstandingBalance: cellAt(cells, balance),
        reversed: rowClass !== undefined && rowClass.indexOf('strikeoff') >= 0 ? 'strikeoff' : '',
      };
    });
  }

  /**
   * Reads the record's charges (AAP 0.7.3: the loan-charge list the add, pay and waive workflows read
   * back). `[]` when the loan carries no charges.
   */
  async readCharges(): Promise<ChargeRow[]> {
    await this.sectionPane(SECTION_TABS.charges);
    const grid = await this.readTable(CHARGE_TABLE_HEADERS);
    const name = columnIndex(grid, CHARGE_COLUMNS.name);
    const amount = columnIndex(grid, CHARGE_COLUMNS.amount);
    const paid = columnIndex(grid, CHARGE_COLUMNS.amountPaid);
    const waived = columnIndex(grid, CHARGE_COLUMNS.amountWaived);
    const outstanding = columnIndex(grid, CHARGE_COLUMNS.amountOutstanding);
    return grid.rows.map((cells) => ({
      name: cellAt(cells, name),
      amount: cellAt(cells, amount),
      amountPaid: cellAt(cells, paid),
      amountWaived: cellAt(cells, waived),
      amountOutstanding: cellAt(cells, outstanding),
    }));
  }

  /**
   * Reads the empty-state block of each of the three sections the request requires one on — the
   * repayment schedule, the transactions and the charges (AAP 0.11.1, AAP 0.7.4) — answering `''`
   * for a section that shows data.
   *
   * The legacy record renders no such block: a section with nothing to list is simply not shown. So
   * on this side the method answers `''` in both states, and the empty state the new application adds
   * is one of the deliberate differences AAP 0.10.5 registers.
   */
  async readEmptyStates(): Promise<{ schedule: string; transactions: string; charges: string }> {
    const schedule = await this.readSectionEmptyState(SECTION_TABS.schedule, SCHEDULE_TABLE_HEADERS);
    const transactions = await this.readSectionEmptyState(
      SECTION_TABS.transactions,
      TRANSACTION_TABLE_HEADERS,
    );
    const charges = await this.readSectionEmptyState(SECTION_TABS.charges, CHARGE_TABLE_HEADERS);
    return { schedule, transactions, charges };
  }

  // ---------------------------------------------------------------------------------------------
  // Loan actions — W5 (AAP 0.10.1)
  // ---------------------------------------------------------------------------------------------

  /**
   * Opens one loan action form — `#/loanaccount/:id/:action` (AAP 0.8.2) — and waits for the form
   * the action renders (AAP 0.10.1 W5). The union is the whole allowed set of action names.
   */
  async openAction(loanId: number, action: LoanAccountAction): Promise<void> {
    await this.gotoHash(`/loanaccount/${loanId}/${action}`, this.actionForm());
    await this.waitForActionForm();
  }

  /**
   * Fills the action form with the values it offers (AAP 0.10.1 W5).
   *
   * The legacy action form renders one date control, an amount, a payment type and a note, and which
   * of them it offers depends on the action — undo approval and undo disbursal carry no date, reject
   * carries no amount, and no loan action carries a reason. A supplied value the form does not offer is
   * therefore not entered, and the capture of the request the action sends is what reports the result;
   * a value the form does offer but cannot take — an option absent from the list, a read-only control
   * — raises instead of passing silently.
   */
  async fillActionForm(values: LoanActionValues): Promise<void> {
    if (values.date !== undefined) {
      const date = this.actionDateField();
      if ((await date.count()) === 0) {
        throw new Error(
          'This loan action form offers no date control. Only the actions the legacy controller gives ' +
            'a date field take one: undo approval and undo disbursal carry none.',
        );
      }
      await setLegacyDate(date, values.date);
    }
    if (values.amount !== undefined) {
      const amount = this.actionAmountField();
      if ((await amount.count()) > 0) {
        await amount.first().fill(values.amount);
      }
    }
    if (values.paymentType !== undefined && (await this.paymentTypeSelect().count()) > 0) {
      await chooseOption(this.page, this.paymentTypeSelect().first(), values.paymentType);
    }
    if (values.note !== undefined && (await this.noteField().count()) > 0) {
      await this.noteField().first().fill(values.note);
    }
    if (values.reasonName !== undefined) {
      const reason = this.reasonSelect();
      if ((await reason.count()) > 0) {
        await chooseOption(this.page, reason.first(), values.reasonName);
      }
    }
  }

  /**
   * Submits the action exactly once (AAP 0.10.1 W5: one POST per action). Nothing is bounded,
   * nothing is retried and the submit is not clicked twice.
   */
  async submitAction(): Promise<void> {
    await this.clickPrimarySubmit('The loan action form');
  }

  // ---------------------------------------------------------------------------------------------
  // Repayment — W6 (AAP 0.10.1)
  // ---------------------------------------------------------------------------------------------

  /**
   * Opens the repayment form — `#/loanaccount/:id/repayment` (AAP 0.8.2) — and waits for it
   * (AAP 0.10.1 W6).
   */
  async openRepayment(loanId: number): Promise<void> {
    await this.gotoHash(`/loanaccount/${loanId}/repayment`, this.actionForm());
    await this.waitForActionForm();
  }

  /**
   * Fills the repayment form: the transaction date, the transaction amount, the payment type and the
   * note (AAP 0.10.1 W6). The amount is the first schedule period's total due, which the caller reads
   * from {@link LoansPage.readScheduleRows}; this page object never invents it.
   */
  async fillRepayment(values: LoanActionValues): Promise<void> {
    if (values.date !== undefined) {
      await setLegacyDate(this.actionDateField(), values.date);
    }
    if (values.amount !== undefined) {
      await this.page.locator('input#transactionAmount').first().fill(values.amount);
    }
    if (values.paymentType !== undefined) {
      await chooseOption(this.page, this.paymentTypeSelect().first(), values.paymentType);
    }
    if (values.note !== undefined && (await this.noteField().count()) > 0) {
      await this.noteField().first().fill(values.note);
    }
  }

  /** Submits the repayment exactly once (AAP 0.10.1 W6). */
  async submitRepayment(): Promise<void> {
    await this.clickPrimarySubmit('The repayment form');
  }

  // ---------------------------------------------------------------------------------------------
  // Loan charges — AAP 0.7.3
  // ---------------------------------------------------------------------------------------------

  /**
   * Opens the add-charge form — `#/addloancharge/:id` (AAP 0.8.2) — and waits for the charge select,
   * which the charge template fills (AAP 0.7.3: `GET /loans/{id}/charges/template`).
   */
  async openAddCharge(loanId: number): Promise<void> {
    await this.gotoHash(
      `/addloancharge/${loanId}`,
      this.page.locator('form[name="loanchargeform"]'),
    );
    await this.page.locator('select#chargeId').first().waitFor({ state: 'visible' });
  }

  /**
   * Fills the add-charge form (AAP 0.7.3: `POST /loans/{id}/charges`).
   *
   * The shared shape carries no charge field, so the charge to apply is named through `reasonName`:
   * the form reveals its amount and due date only after a charge has been chosen, so naming one is
   * what makes the rest of the form fillable. A charge that carries no due date leaves the date
   * control absent, and a supplied date is then not entered — the capture of the request shows that.
   */
  async fillCharge(values: LoanActionValues): Promise<void> {
    if (values.reasonName !== undefined) {
      await chooseOption(this.page, this.page.locator('select#chargeId').first(), values.reasonName);
    }
    if (values.amount !== undefined) {
      const amount = this.page.locator('input#amount').first();
      await amount.waitFor({ state: 'visible' });
      await amount.fill(values.amount);
    }
    if (values.date !== undefined) {
      const dueDate = this.page.locator('input#dueDate');
      if ((await dueDate.count()) > 0) {
        await setLegacyDate(dueDate, values.date);
      }
    }
  }

  /** Submits the charge exactly once (AAP 0.7.3). */
  async submitCharge(): Promise<void> {
    await this.clickPrimarySubmit('The add-charge form');
  }

  /**
   * Opens a charge's pay or waive form — `#/loanaccountcharge/:id/:action/:chargeId` (AAP 0.8.2) —
   * and waits for it (AAP 0.7.3). The union names the Fineract command; the legacy route spells the
   * same action `paycharge`/`waivecharge`.
   */
  async openChargeAction(loanId: number, chargeId: number, action: LoanChargeAction): Promise<void> {
    const segment = CHARGE_ROUTE_SEGMENT[action];
    await this.gotoHash(`/loanaccountcharge/${loanId}/${segment}/${chargeId}`, this.actionForm());
    await this.waitForActionForm();
  }

  // ---------------------------------------------------------------------------------------------
  // Private helpers — navigation, wizard steps, control lookups and table reads
  // ---------------------------------------------------------------------------------------------

  /**
   * The legacy application's entry URL carrying the two query parameters Rule 2 requires. Without
   * them the legacy app falls back to its public demo host instead of the locally built Fineract.
   */
  private entryUrl(hash?: string): string {
    const base =
      `${LEGACY_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}` +
      `&tenantIdentifier=${encodeURIComponent(TENANT_ID)}`;
    return hash === undefined ? base : `${base}#${hash}`;
  }

  /**
   * Opens one legacy hash route and waits for the locator that proves the destination rendered.
   *
   * A hash-only change keeps the application loaded, so the query string survives. When the AngularJS
   * router does not react to it — a build that only follows its own `$location` transitions — the
   * hash is set directly, which drives the router through `hashchange`.
   */
  private async gotoHash(hash: string, ready: Locator): Promise<void> {
    await this.page.goto(this.entryUrl(hash));
    if (await this.settles(ready)) return;
    // The routers of some legacy builds follow only their own `$location` transitions. Setting the
    // hash drives the `hashchange` they do listen for; a build that still does not react gets one
    // reload of the hash route, which renders the destination from scratch.
    await this.page.evaluate(setWindowHash, hash);
    if (await this.settles(ready)) return;
    await this.page.reload();
    await ready.first().waitFor({ state: 'visible' });
  }

  /** Whether a locator becomes visible within the route's readiness window. */
  private async settles(ready: Locator): Promise<boolean> {
    return ready
      .first()
      .waitFor({ state: 'visible', timeout: ROUTE_READY_TIMEOUT_MS })
      .then(
        () => true,
        () => false,
      );
  }

  /** The visible form of one wizard step, which is what marks the step the application shows. */
  private stepMarker(step: WizardStep): Locator {
    return this.page.locator(`form[name="${step}"]:visible`);
  }

  /**
   * Walks the application wizard one step forward. The transition is proved by the step left behind
   * going away and the step awaited appearing, so a click that the form rejected cannot be mistaken
   * for progress.
   */
  private async stepForward(from: Locator, to: Locator): Promise<void> {
    const next = this.page.locator('button.btn.btn-default.pull-right:visible').first();
    if ((await next.count()) === 0) {
      throw new Error(
        'The loan application wizard shows no visible "Next" control, so the step that carries the ' +
          'field to fill cannot be reached. Confirm the wizard markup against the running legacy app.',
      );
    }
    await next.click();
    await from.first().waitFor({ state: 'hidden' });
    await to.first().waitFor({ state: 'visible' });
  }

  /** Reaches the application wizard's Terms step, which carries the terms and interest fields. */
  private async reachTermsStep(): Promise<void> {
    if (await this.stepMarker('Terms').first().isVisible()) return;
    await this.stepForward(this.stepMarker('Details'), this.stepMarker('Terms'));
  }

  /** Reaches the wizard's Charges step, which also carries the repayment-schedule preview. */
  private async reachChargesStep(): Promise<void> {
    if (await this.stepMarker('Charges').first().isVisible()) return;
    await this.reachTermsStep();
    await this.stepForward(this.stepMarker('Terms'), this.stepMarker('Charges'));
  }

  /** Reaches the wizard's Review step, which carries the application's primary submit. */
  private async reachReviewStep(): Promise<void> {
    if (await this.stepMarker('review').first().isVisible()) return;
    await this.reachChargesStep();
    await this.stepForward(this.stepMarker('Charges'), this.stepMarker('review'));
  }

  /**
   * The control that previews the repayment schedule. It is anchored on the handler the legacy
   * template binds rather than on its translated label, which is the reason it survives a language
   * switch. Confirm against the running legacy app.
   */
  private previewControl(): Locator {
    return this.page.locator('[ng-click="previewRepayments()"]').first();
  }

  /** The link the preview replaces the schedule area with, which proves the preview was rendered. */
  private previewShown(): Locator {
    return this.page.locator('[ng-click="previewRepayment=!previewRepayment"]').first();
  }

  /** Selects the option of one application-form dropdown by its visible label. */
  private async chooseField(
    field: keyof typeof APPLICATION_SELECTS,
    optionText: string,
  ): Promise<void> {
    const select = this.page.locator(APPLICATION_SELECTS[field]).first();
    await select.waitFor({ state: 'attached' });
    await chooseOption(this.page, select, optionText);
  }

  /**
   * Fills one field by its label. The control is resolved by label text first, then by the element id
   * the legacy template gives it, then by `formControlName`, then by placeholder — all inside one
   * page-side helper, so the field mapping stays in a single place. A control the browser will not
   * accept typing into is written through native events, which is what a read-only date field needs.
   */
  private async fillFieldByLabel(label: string, value: string): Promise<void> {
    const spec = FILLABLE_FIELDS.get(label);
    if (spec === undefined) {
      throw new Error(
        `fillFieldByLabel() has no mapping for "${label}". Known fields: ` +
          `${Array.from(FILLABLE_FIELDS.keys()).join(', ')}.`,
      );
    }
    const field = await this.resolveField(spec);
    if (await field.isEditable()) {
      await field.fill(value);
      return;
    }
    await field.evaluate(applyNativeValue, value);
    const applied = await field.inputValue();
    if (applied !== value) {
      throw new Error(
        `The field for "${label}" holds "${applied}" after it was set to "${value}", and the browser ` +
          'will not accept typing into it.',
      );
    }
  }

  /** The control a field names, resolved in the page; the page raises when nothing matches. */
  private async resolveField(spec: FieldSpec): Promise<ElementHandle<Element>> {
    const handle = await this.page.evaluateHandle(resolveFieldElement, spec);
    const element = handle.asElement();
    if (element === null) {
      await handle.dispose();
      throw new Error(
        `No form control could be resolved for "${spec.key}": nothing matched its label, its id ` +
          `"${spec.id}", its formControlName or its placeholder.`,
      );
    }
    return element;
  }

  /**
   * The amount control of each charge row the Charges step shows. Each row is anchored on its own
   * amount control, which the legacy template gives the `Amount` placeholder: the row input's id is
   * built from the row's own value, so the placeholder is the stable anchor. Confirm against the
   * running legacy app.
   */
  private chargeAmountFields(): Locator {
    return this.page.locator('input.form-control[placeholder="Amount"]:visible');
  }

  /**
   * Fills the charge rows the Charges step already shows, in order. This page object never chooses a
   * charge to apply on the application form, so a row that is missing is reported rather than invented.
   */
  private async fillChargeAmounts(amounts: readonly string[]): Promise<void> {
    const fields = this.chargeAmountFields();
    const count = await fields.count();
    if (count < amounts.length) {
      throw new Error(
        `The Charges step shows ${count} charge row(s) for ${amounts.length} amount(s). This page ` +
          'object does not pick a charge to apply; add the rows on the form before filling them.',
      );
    }
    for (let index = 0; index < amounts.length; index += 1) {
      const amount = amounts[index];
      await fields.nth(index).fill(amount === undefined ? '' : amount);
    }
  }

  /** The action and charge-action forms share one template, and one form name. */
  private actionForm(): Locator {
    return this.page.locator('form[name="loanactionform"]');
  }

  /**
   * Waits for an action form to be shown and for its first control to be on screen, so a read that
   * follows cannot see the previous route's markup.
   */
  private async waitForActionForm(): Promise<void> {
    const form = this.actionForm().first();
    await form.waitFor({ state: 'visible' });
    await form.locator('.form-control:visible').first().waitFor({ state: 'visible' });
  }

  /**
   * The action's own date control. The legacy controller names it per action — `approvedOnDate`,
   * `rejectedOnDate`, `actualDisbursementDate`, `transactionDate` — so every name it can use is
   * listed and the visible one answers. Confirm against the running legacy app.
   */
  private actionDateField(): Locator {
    const ids = [
      '#approvedOnDate',
      '#rejectedOnDate',
      '#actualDisbursementDate',
      '#transactionDate',
      '#withdrawnOnDate',
      '#unassignedDate',
    ];
    return this.page.locator(ids.map((id) => `input${id}:visible`).join(', '));
  }

  /** The action's amount control, whichever of the template's names the action uses. */
  private actionAmountField(): Locator {
    const ids = ['#transactionAmount', '#approvedAmt', '#approvedAmount', '#amount'];
    return this.page.locator(ids.map((id) => `input${id}:visible`).join(', '));
  }

  /** The action's payment-type select, which the transaction template fills (AAP 0.7.3). */
  private paymentTypeSelect(): Locator {
    return this.page.locator('select#paymentTypeId:visible');
  }

  /** The action's note control. */
  private noteField(): Locator {
    return this.page.locator('#note:visible');
  }

  /**
   * A reason select, where the action screen offers one. The legacy loan actions carry no reason
   * control, so this answers nothing here; it is the lookup a client-side reason form would satisfy.
   * Confirm against the running legacy app.
   */
  private reasonSelect(): Locator {
    return this.page.locator('select#reasonId:visible, select[ng-model*="eason"]:visible');
  }

  /**
   * Clicks the form's own primary submit once. A screen showing the entity-datatable step instead is
   * reported rather than walked through, because a second click is what W5 forbids.
   */
  private async clickPrimarySubmit(subject: string): Promise<void> {
    const save = this.page.locator('button#save.btn.btn-primary:visible').first();
    if ((await save.count()) === 0) {
      const proceed = this.page.locator('#save1:visible');
      if ((await proceed.count()) > 0) {
        throw new Error(
          `${subject} is showing its entity-datatable step (#save1) instead of the form's own submit ` +
            '(#save). This page object submits the form itself and never clicks twice, so the ' +
            'workflow needs a loan the datatable check does not gate. Confirm against the running legacy app.',
        );
      }
      throw new Error(`${subject} shows no visible primary submit (#save).`);
    }
    await save.click();
  }

  /** Reads the table carrying the required columns, answering an empty grid when there is none. */
  private async readTable(required: readonly string[]): Promise<TableGrid> {
    const answer: unknown = await this.page.evaluate(readTableGrid, required);
    return isTableGrid(answer) ? answer : emptyGrid();
  }

  /** The class the record's status indicator carries — never its text (AAP 0.10.5 item 11). */
  private async readStatusClass(): Promise<string> {
    return this.page.evaluate(readStatusIndicatorClass);
  }

  /**
   * The pane of one record section, activating its tab when the tab strip does not already show it.
   * The record renders its sections as `uib-tab` panes, and activating the tab is what guarantees a
   * build that creates panes lazily has rendered the section before it is read. Confirm against the
   * running legacy app.
   */
  private async sectionPane(headings: readonly string[]): Promise<Locator | null> {
    const index = await this.page.evaluate(findTabIndex, headings);
    if (index < 0) return null;
    const panes = this.page.locator('.tab-content > .tab-pane');
    if ((await panes.count()) !== (await this.page.locator('ul.nav-tabs > li').count())) return null;
    const pane = panes.nth(index);
    if (!(await pane.isVisible())) {
      const tab = this.page.locator('ul.nav-tabs > li').nth(index);
      const link = tab.locator('a').first();
      const target = (await link.count()) > 0 ? link : tab;
      await target.click();
      await pane.waitFor({ state: 'visible' });
    }
    return pane;
  }

  /**
   * One section's empty-state text: `''` when the section shows data, otherwise the block it renders
   * in place of the data (`.text-center.text-muted`, the composition AAP 0.7.4 settles on), or `''`
   * when it renders none — which is what the legacy record does.
   */
  private async readSectionEmptyState(
    headings: readonly string[],
    required: readonly string[],
  ): Promise<string> {
    const pane = await this.sectionPane(headings);
    const grid = await this.readTable(required);
    if (grid.rows.length > 0) return '';
    const scope = pane === null ? this.page.locator('body') : pane;
    const empty = scope.locator('.text-center.text-muted').first();
    if ((await empty.count()) === 0) return '';
    const text = await empty.textContent();
    return (text === null ? '' : text).replace(/\s+/g, ' ').trim();
  }
}
