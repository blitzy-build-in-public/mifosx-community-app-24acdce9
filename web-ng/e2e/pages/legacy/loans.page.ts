/** Baseline page object for the individual-loan screens of the legacy AngularJS application — the unchanged Mifos X community-app served on port 9090, which the parity run measures before the new Angular application is (AAP 0.10.1, AAP 0.9.3, AAP 0.8.2, Rule 2). */
import type { ElementHandle, Locator, Page } from '@playwright/test';
import { FINERACT_URL, LEGACY_URL, TENANT_ID, formatFineractDate } from '../../seed/fixtures';
import { chooseOption } from './chosen';

export interface LoanApplicationValues {
  /** Visible label of the product to choose from `select#productId`, matched by `chooseOption`. */
  productName?: string;
  /** Submitted-on date, typed into `input#submittedOnDate` as `dd MMMM yyyy`. */
  submittedOnDate?: Date;
  /** Expected disbursement date, typed into `input#expectedDisbursementDate` the same way. */
  expectedDisbursementDate?: Date;
  /** Principal the Terms step's `#principal` field receives, exactly as the caller supplied it. */
  principal?: string;
  /** Number of repayments the Terms step's `#numberOfRepayments` field receives. */
  numberOfRepayments?: string;
  /** Repayment interval the Terms step's `#repaymentEvery` field receives (`repaymentEvery`). */
  repaymentEvery?: string;
  /** Visible label of `select#repaymentFrequencyType`, the Terms step's frequency option. */
  repaymentFrequency?: string;
  /** Nominal interest rate the Terms step's `#interestRatePerPeriod` control receives. */
  interestRatePerPeriod?: string;
  /** Visible label of `select#amortizationType` (`amortizationType`). */
  amortizationType?: string;
  /** Visible label of `select#interestType` (`interestType`). */
  interestType?: string;
  /** Visible label of `select#interestCalculationPeriodType`. */
  interestCalculationPeriodType?: string;
  /** Visible label of `select#transactionProcessingStrategyId`, the processing strategy option. */
  transactionProcessingStrategy?: string;
  /** Visible label of `select#loanOfficerId`, the officer the application is assigned to. */
  loanOfficerName?: string;
  /** Visible label of `select#fundId`, the fund the application draws on. */
  fundName?: string;
  chargeAmounts?: string[];
}

export interface RepaymentPreviewRow {
  /** Period column (`#`), the previewed period's sequence number. */
  period: string;
  /** From-date column; `''` because the legacy preview renders no period start date. */
  fromDate: string;
  dueDate: string;
  principalDue: string;
  interestDue: string;
  feesDue: string;
  totalDue: string;
  /** Total-outstanding column; `''` because the legacy preview renders none. */
  totalOutstandingForPeriod: string;
}

export interface LoanSummaryField {
  /** The cell's label, `"<row> <column>"` such as `Principal Original`. */
  label: string;
  /** The cell's rendered text, `''` when the record leaves the cell blank. */
  value: string;
}

export interface LoanSummary {
  /** The class list of the record's status indicator: legacy shows a colour and no text. */
  statusClass: string;
  fields: LoanSummaryField[];
}

export interface ScheduleRow {
  /** Period column (`#`), the schedule period's sequence number. */
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

export interface TransactionRow {
  /** Id column, the transaction's Fineract id. */
  id: string;
  /** Transaction-date column, formatted by the legacy `DateFormat` filter. */
  date: string;
  /** Transaction-type column: Fineract's `type.value`, without the reversal marker. */
  type: string;
  /** Amount column, the transaction's Fineract `amount`. */
  amount: string;
  /** Principal column, Fineract's `principalPortion`. */
  principal: string;
  /** Interest column, Fineract's `interestPortion`. */
  interest: string;
  /** Fees column, Fineract's `feeChargesPortion`. */
  fees: string;
  /** Running-balance column ("Loan Balance"), Fineract's `outstandingLoanBalance`. */
  outstandingBalance: string;
  /** `strikeoff` when the row carries that class, `''` otherwise (`manuallyReversed`). */
  reversed: string;
}

export interface LoanActionValues {
  /** The form's transaction or action date control, typed as `dd MMMM yyyy`. */
  date?: Date;
  amount?: string;
  /** The note textarea, on the forms whose legacy controller renders one. */
  note?: string;
  /** Visible label of `select#paymentTypeId`, the payment type the transaction template fills. */
  paymentType?: string;
  /** Reason, for a form that renders a reason control — the `select#reasonId` / `select[ng-model*="eason"]` probe of `fillActionForm`. */
  reasonName?: string;
}

/** The loan actions `#/loanaccount/:id/:action` accepts (AAP 0.8.2, AAP 0.10.1 W5). */
export type LoanAccountAction =
  | 'approve'
  | 'undoapproval'
  | 'reject'
  | 'disburse'
  | 'undodisbursal'
  | 'repayment';

const PREVIEW_TABLE_HEADERS = ['principal due', 'interest due', 'due'] as const;

/** Positions the record's Repayment Schedule table. It is the only one of the three schedule tables that carries both a `Due` and a `Paid` column (viewloanaccountdetails.html), which is what separates it from the Original. */
const SCHEDULE_TABLE_HEADERS = ['principal due', 'interest', 'fees', 'due', 'paid'] as const;

/** Positions the record's transaction list, whose second header row carries `Principal`. */
const TRANSACTION_TABLE_HEADERS = ['transaction type', 'amount', 'principal'] as const;

/** Positions the record's charge list, the only table headed `Name` that also has `Outstanding`. */
const CHARGE_TABLE_HEADERS = ['name', 'outstanding'] as const;

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

/** The legacy form control each fillable field resolves to, by label text and by element id. */
interface FieldSpec {
  /** Field key as the models spell it, used for the `formControlName` fallback. */
  readonly key: string;
  /** Element id the legacy form gives the control. */
  readonly id: string;
  /** Label texts, in the legacy's own English wording (app/global-translations/locale-en.json). */
  readonly labels: readonly string[];
}

/** The four fields `fillApplication` types into, by the model's own key, plus the two the action and repayment forms carry. */
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

/** The dropdown of the application form each `LoanApplicationValues` field selects from (newloanaccount.html). */
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

interface TableGrid {
  readonly columns: readonly (readonly string[])[];
  readonly rows: readonly (readonly string[])[];
  readonly rowClasses: readonly string[];
}

type WizardStep = 'Details' | 'Terms' | 'Charges' | 'review';

const ROUTE_READY_TIMEOUT_MS = 15_000;

/** Runs inside the legacy page, so it references nothing from module scope — Playwright serialises the function and evaluates it in the document. */
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

/** Runs inside the legacy page: writes a value into a control and tells AngularJS and the jQuery plugins about it. */
function applyNativeValue(element: Element, value: string): void {
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) return;
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Runs inside the legacy page: the header texts of the first table carrying every required column label, with the table's data rows positioned by column. */
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
      if (repeated >= 2) rows.push(first);
    }
    return rows;
  };

  const gridOf = (table: HTMLTableElement, headerRows: HTMLTableRowElement[]): TableGrid | null => {
    // Column positions are accumulated across the cells before them: `cellIndex` counts cells, so a cell spanning four columns would otherwise shift every label after it by three.
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

/** Runs inside the legacy page: the position of the first tab whose heading matches one of `wanted`, or `-1` when the page carries no such tab. */
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

/** Runs inside the legacy page: the class of the record's rendered status indicator. */
function readStatusIndicatorClass(): string {
  for (const icon of Array.from(document.querySelectorAll('i.fa-stop'))) {
    if (icon instanceof HTMLElement && icon.offsetParent !== null) {
      return (icon.getAttribute('class') ?? '').replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

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

/** Sets a legacy date control, which is a jQuery datepicker input rather than a native date field (AAP 0.10.5 item 1: the new application replaces it with `input[type=date]`, so only this side needs the plugin's behaviour) (Rule 1 clause 2). */
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


/** The legacy application's individual-loan screens: the application wizard, the loan record and the action forms. */
export class LoansPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // --------------------------------------------------------------------------------------------- Application form — W4 and W7 (AAP 0.10.1).

  /** Selects the loan product by its visible name (AAP 0.10.1 W4, AAP 0.3.4 row 14). */
  async selectProduct(name: string): Promise<void> {
    const select = this.page.locator(APPLICATION_SELECTS.productName);
    await select.waitFor({ state: 'visible' });
    await chooseOption(this.page, select.first(), name);
    await this.page.locator('#principal:enabled').waitFor({ state: 'visible' });
    await this.page.locator('#numberOfRepayments:enabled').waitFor({ state: 'visible' });
  }

  /** Fills the application form with the values supplied, walking the wizard's own steps to reach the control each one carries (AAP 0.10.1 W4; AAP 0.3.4 row 14). **No product bound is read, applied or reported.** W7 (AAP (Rule 1 clause 3). */
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

  /** Clicks the application form's repayment-schedule preview and waits for the schedule it renders (AAP 0.10.1 W4; AAP 0.3.4 row 14: `POST /loans` with `command=calculateLoanSchedule`). */
  async previewSchedule(): Promise<void> {
    await this.reachChargesStep();
    const control = this.previewControl();
    await control.waitFor({ state: 'visible' });
    await control.click();
    await this.previewShown().waitFor({ state: 'visible' });
  }

  /** Reads the previewed schedule, one entry per period (AAP 0.10.1 W4). */
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

  /** Submits the application (AAP 0.10.1 W4): the wizard is walked to its Review step and the form's primary submit is clicked exactly once. */
  async submitApplication(): Promise<void> {
    await this.reachReviewStep();
    const save = this.page.locator('button#save.btn.btn-primary:visible').first();
    await save.waitFor({ state: 'visible' });
    await save.click();
  }

  // --------------------------------------------------------------------------------------------- Loan record — reads for W5 and W6 (AAP 0.10.1).

  /** Opens the loan record — `#/viewloanaccount/:id` (AAP 0.8.2) — and waits for the record header the actions and repayment workflows read their preconditions from (AAP 0.10.1 W5, W6). */
  async openView(loanId: number): Promise<void> {
    await this.gotoHash(`/viewloanaccount/${loanId}`, this.page.locator('.gray-head'));
  }

  /** Reads the record's status and summary (AAP 0.10.2, "Fineract end state"; AAP 0.10.5 item 11). */
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

  /** Reads the record's repayment schedule, one entry per period (AAP 0.10.1 W6 — the first period's total due is the repayment W6 submits). */
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

  /** Reads the record's transactions (AAP 0.10.1 W6: the repayment must appear as a row). */
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

  /** Reads the empty-state block of each of the three sections the request requires one on — the repayment schedule, the transactions and the charges (AAP 0.11.1, AAP 0.7.4) — answering `''` for a section that shows data (AAP 0.10.5). */
  async readEmptyStates(): Promise<{ schedule: string; transactions: string; charges: string }> {
    const schedule = await this.readSectionEmptyState(SECTION_TABS.schedule, SCHEDULE_TABLE_HEADERS);
    const transactions = await this.readSectionEmptyState(
      SECTION_TABS.transactions,
      TRANSACTION_TABLE_HEADERS,
    );
    const charges = await this.readSectionEmptyState(SECTION_TABS.charges, CHARGE_TABLE_HEADERS);
    return { schedule, transactions, charges };
  }

  // --------------------------------------------------------------------------------------------- Loan actions — W5 (AAP 0.10.1) ---------------------------------------------------------------------------------------------

  /** Opens one loan action form — `#/loanaccount/:id/:action` (AAP 0.8.2) — and waits for the form the action renders (AAP 0.10.1 W5). */
  async openAction(loanId: number, action: LoanAccountAction): Promise<void> {
    await this.gotoHash(`/loanaccount/${loanId}/${action}`, this.actionForm());
    await this.waitForActionForm();
  }

  /** Fills the action form with the values it offers (AAP 0.10.1 W5). */
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

  /** Submits the action exactly once (AAP 0.10.1 W5: one POST per action). */
  async submitAction(): Promise<void> {
    await this.clickPrimarySubmit('The loan action form');
  }

  // --------------------------------------------------------------------------------------------- Repayment — W6 (AAP 0.10.1) ---------------------------------------------------------------------------------------------

  /** Opens the repayment form — `#/loanaccount/:id/repayment` (AAP 0.8.2) — and waits for it (AAP 0.10.1 W6). */
  async openRepayment(loanId: number): Promise<void> {
    await this.gotoHash(`/loanaccount/${loanId}/repayment`, this.actionForm());
    await this.waitForActionForm();
  }

  /** Fills the repayment form: the transaction date, the transaction amount, the payment type and the note (AAP 0.10.1 W6). */
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

  // --------------------------------------------------------------------------------------------- Private helpers — navigation, wizard steps, control lookups and table reads.

  /** The legacy application's entry URL carrying the two query parameters Rule 2 requires. */
  private entryUrl(hash?: string): string {
    const base =
      `${LEGACY_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}` +
      `&tenantIdentifier=${encodeURIComponent(TENANT_ID)}`;
    return hash === undefined ? base : `${base}#${hash}`;
  }

  /** Opens one legacy hash route and waits for the locator that proves the destination rendered. */
  private async gotoHash(hash: string, ready: Locator): Promise<void> {
    await this.page.goto(this.entryUrl(hash));
    if (await this.settles(ready)) return;
    // The routers of some legacy builds follow only their own `$location` transitions.
    await this.page.evaluate(setWindowHash, hash);
    if (await this.settles(ready)) return;
    await this.page.reload();
    await ready.first().waitFor({ state: 'visible' });
  }

  private async settles(ready: Locator): Promise<boolean> {
    return ready
      .first()
      .waitFor({ state: 'visible', timeout: ROUTE_READY_TIMEOUT_MS })
      .then(
        () => true,
        () => false,
      );
  }

  private stepMarker(step: WizardStep): Locator {
    return this.page.locator(`form[name="${step}"]:visible`);
  }

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

  private async reachTermsStep(): Promise<void> {
    if (await this.stepMarker('Terms').first().isVisible()) return;
    await this.stepForward(this.stepMarker('Details'), this.stepMarker('Terms'));
  }

  private async reachChargesStep(): Promise<void> {
    if (await this.stepMarker('Charges').first().isVisible()) return;
    await this.reachTermsStep();
    await this.stepForward(this.stepMarker('Terms'), this.stepMarker('Charges'));
  }

  private async reachReviewStep(): Promise<void> {
    if (await this.stepMarker('review').first().isVisible()) return;
    await this.reachChargesStep();
    await this.stepForward(this.stepMarker('Charges'), this.stepMarker('review'));
  }

  /** The control that previews the repayment schedule. It is anchored on the handler the legacy template binds rather than on its translated label, which is the reason it survives a language switch. */
  private previewControl(): Locator {
    return this.page.locator('[ng-click="previewRepayments()"]').first();
  }

  private previewShown(): Locator {
    return this.page.locator('[ng-click="previewRepayment=!previewRepayment"]').first();
  }

  private async chooseField(
    field: keyof typeof APPLICATION_SELECTS,
    optionText: string,
  ): Promise<void> {
    const select = this.page.locator(APPLICATION_SELECTS[field]).first();
    await select.waitFor({ state: 'attached' });
    await chooseOption(this.page, select, optionText);
  }

  /** Fills one field by its label. The control is resolved by label text first, then by the element id the legacy template gives it, then by `formControlName`, then by placeholder — all inside one page-side helper, so the. */
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

  private chargeAmountFields(): Locator {
    return this.page.locator('input.form-control[placeholder="Amount"]:visible');
  }

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

  private actionForm(): Locator {
    return this.page.locator('form[name="loanactionform"]');
  }

  private async waitForActionForm(): Promise<void> {
    const form = this.actionForm().first();
    await form.waitFor({ state: 'visible' });
    await form.locator('.form-control:visible').first().waitFor({ state: 'visible' });
  }

  /** The action's own date control. The legacy controller names it per action — `approvedOnDate`, `rejectedOnDate`, `actualDisbursementDate`, `transactionDate` — so every name it can use is listed and the visible one answers. */
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

  private actionAmountField(): Locator {
    const ids = ['#transactionAmount', '#approvedAmt', '#approvedAmount', '#amount'];
    return this.page.locator(ids.map((id) => `input${id}:visible`).join(', '));
  }

  /** The action's payment-type select, which the transaction template fills (AAP 0.7.3). */
  private paymentTypeSelect(): Locator {
    return this.page.locator('select#paymentTypeId:visible');
  }

  private noteField(): Locator {
    return this.page.locator('#note:visible');
  }

  /** A reason select, where the action screen offers one. The legacy loan actions carry no reason control, so this answers nothing here; it is the lookup a client-side reason form would satisfy. */
  private reasonSelect(): Locator {
    return this.page.locator('select#reasonId:visible, select[ng-model*="eason"]:visible');
  }

  /** Clicks the form's own primary submit once. A screen showing the entity-datatable step instead is reported rather than walked through, because a second click is what W5 forbids. */
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

  private async readTable(required: readonly string[]): Promise<TableGrid> {
    const answer: unknown = await this.page.evaluate(readTableGrid, required);
    return isTableGrid(answer) ? answer : emptyGrid();
  }

  /** The class the record's status indicator carries — never its text (AAP 0.10.5 item 11). */
  private async readStatusClass(): Promise<string> {
    return this.page.evaluate(readStatusIndicatorClass);
  }

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

  /** One section's empty-state text: `''` when the section shows data, otherwise the block it renders in place of the data (`.text-center.text-muted`, the composition AAP 0.7.4 settles on), or `''` when it renders none. */
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
