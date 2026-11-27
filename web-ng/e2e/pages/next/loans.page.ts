/** Page object for the new Angular application's individual-loan screens — the `next` project's side of workflows W4 (submit an application after previewing its schedule), W5 (approve and disburse), W6 (make a repayment) and W7 (a Fineract validation error rendered verbatim) (AAP 0.8.2, Rule 2, AAP 0.4.4, AAP 0.10.5). */
import type { Locator, Page } from '@playwright/test';

import { FINERACT_URL, NEXT_URL, TENANT_ID } from '../../seed/fixtures.js';

/** One label/value row of a record as the page renders it: the record's `#loan-summary` block prints a bold key and its figure side by side, and the same pair is what the legacy sibling's summary reader reports for the baseline it drives. */
export interface LabelValue {
  readonly label: string;
  readonly value: string;
}

/** One row of the application form's repayment-schedule preview, as the server's calculation returned it and the component painted it (AAP 0.10.1, AAP 0.10.2). */
export interface RepaymentPreviewRow {
  readonly period: number | null;
  readonly fromDate: string;
  readonly dueDate: string;
  readonly principalDue: number | null;
  readonly interestDue: number | null;
  readonly feesDue: number | null;
  readonly totalDue: number | null;
  readonly outstanding: number | null;
  readonly cells: readonly string[];
}

/** The loan record's status indicator and its summary rows, as the page renders them (AAP 0.10.5, Rule 1 clause 3). */
export interface LoanSummaryView {
  readonly statusClass: string;
  readonly fields: readonly LabelValue[];
}

export interface LoanScheduleRow {
  readonly period: number | null;
  readonly fromDate: string;
  readonly dueDate: string;
  readonly totalDue: number | null;
  readonly outstanding: number | null;
  readonly cells: readonly string[];
}

/** One row of the loan record's transaction list. After W6's repayment the list must carry the new transaction and the balance it left, which is the figure the workflow compares (AAP 0.10.1). */
export interface LoanTransactionRow {
  readonly date: string;
  readonly type: string;
  readonly amount: number | null;
  readonly outstandingBalance: number | null;
  readonly cells: readonly string[];
}

/** What {@link LoansPage.fillApplication} types into the application form (AAP 0.7.2). */
export interface LoanApplicationValues {
  readonly productId?: number | string;
  readonly principal?: number | string;
  readonly loanTermFrequency?: number | string;
  readonly numberOfRepayments?: number | string;
  readonly repaymentEvery?: number | string;
  readonly interestRatePerPeriod?: number | string;
  readonly loanOfficerId?: number | string;
  readonly fundId?: number | string;
  readonly expectedDisbursementDate?: string;
  readonly submittedOnDate?: string;
}

/** What {@link LoansPage.fillActionForm} types into an action form (AAP 0.7.2). */
export interface LoanActionValues {
  readonly approvedOnDate?: string;
  readonly approvedPrincipal?: number | string;
  readonly rejectedOnDate?: string;
  readonly actualDisbursementDate?: string;
  readonly transactionAmount?: number | string;
  readonly note?: string;
}

/** What {@link LoansPage.fillRepayment} types into the repayment form (AAP 0.7.2 `LoanRepaymentRequest`). */
export interface LoanRepaymentValues {
  readonly transactionDate?: string;
  readonly transactionAmount?: number | string;
  readonly paymentTypeId?: number | string;
  readonly note?: string;
}

/** The `:action` segments the `/loanaccount/:id/:action` route serves for these workflows (AAP 0.8.2): the five lifecycle commands of W5 and AAP 0.9.1, plus the repayment of W6. */
export type LoanAction =
  | 'approve'
  | 'undoapproval'
  | 'reject'
  | 'disburse'
  | 'undodisbursal'
  | 'repayment';

const APPLICATION_ROOT = 'app-loan-new';

const PREVIEW_ROOT = 'app-repayment-preview';

const EDIT_ROOT = 'app-loan-edit';

const VIEW_ROOT = 'app-loan-view';

const SCHEDULE_ROOT = 'app-loan-schedule';

const TRANSACTIONS_ROOT = 'app-loan-transactions';

const ACTION_ROOT = 'app-loan-action';

const REPAYMENT_ROOT = 'app-loan-repayment';

const SCREENS: Readonly<Record<string, string>> = {
  [APPLICATION_ROOT]: 'the loan application screen',
  [PREVIEW_ROOT]: 'the repayment-schedule preview',
  [EDIT_ROOT]: 'the loan edit screen',
  [VIEW_ROOT]: 'the loan record',
  [SCHEDULE_ROOT]: 'the repayment-schedule section',
  [TRANSACTIONS_ROOT]: 'the transactions section',
  [ACTION_ROOT]: 'the loan action screen',
  [REPAYMENT_ROOT]: 'the loan repayment screen',
};

/** The six action segments accepted at run time, in the order the legacy record offers them. */
const LOAN_ACTIONS: readonly string[] = [
  'approve',
  'undoapproval',
  'reject',
  'disburse',
  'undodisbursal',
  'repayment',
];

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const SCREEN_TIMEOUT_MS = 30_000;

const TEMPLATE_TIMEOUT_MS = 30_000;

const OPTION_POLL_INTERVAL_MS = 100;

const TEMPLATE_BUSY_GRACE_MS = 2_000;

interface RenderedOption {
  readonly index: number;
  readonly value: string;
  readonly label: string;
}

interface TableGrid {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

interface FieldSpec {
  readonly ids: readonly string[];
  readonly label: string;
  readonly kind: 'date' | 'select' | 'text';
  readonly description: string;
}

const APPLICATION_FIELDS = {
  productId: { ids: ['productId'], label: 'product', kind: 'select', description: 'loan product select' },
  principal: { ids: ['principal'], label: 'principal', kind: 'text', description: 'principal field' },
  loanTermFrequency: { ids: ['loanTermFrequency'], label: 'loan\\s*term', kind: 'text', description: 'loan term field' },
  numberOfRepayments: { ids: ['numberOfRepayments'], label: 'number\\s*of\\s*repayments', kind: 'text', description: 'number-of-repayments field' },
  repaymentEvery: { ids: ['repaymentEvery'], label: 'repaid\\s*every', kind: 'text', description: 'repayment frequency field' },
  interestRatePerPeriod: { ids: ['interestRatePerPeriod'], label: 'nominal\\s*interest', kind: 'text', description: 'interest rate field' },
  loanOfficerId: { ids: ['loanOfficerId'], label: 'loan\\s*officer', kind: 'select', description: 'loan officer select' },
  fundId: { ids: ['fundId'], label: 'fund', kind: 'select', description: 'fund select' },
  expectedDisbursementDate: { ids: ['expectedDisbursementDate'], label: 'disbursement', kind: 'date', description: 'expected-disbursement date field' },
  submittedOnDate: { ids: ['submittedOnDate'], label: 'submitted', kind: 'date', description: 'submitted-on date field' },
} as const satisfies Readonly<Record<keyof LoanApplicationValues, FieldSpec>>;

const APPLICATION_FIELD_ORDER: readonly (keyof LoanApplicationValues)[] = [
  'productId',
  'principal',
  'loanTermFrequency',
  'numberOfRepayments',
  'repaymentEvery',
  'interestRatePerPeriod',
  'loanOfficerId',
  'fundId',
  'expectedDisbursementDate',
  'submittedOnDate',
];

const ACTION_FIELDS = {
  approvedOnDate: { ids: ['approvedOnDate'], label: 'date', kind: 'date', description: 'approval date field' },
  approvedPrincipal: { ids: ['approvedPrincipal', 'approvedLoanAmount'], label: 'principal', kind: 'text', description: 'approved amount field' },
  rejectedOnDate: { ids: ['rejectedOnDate'], label: 'date', kind: 'date', description: 'rejection date field' },
  actualDisbursementDate: { ids: ['actualDisbursementDate'], label: 'date', kind: 'date', description: 'disbursement date field' },
  transactionAmount: { ids: ['transactionAmount'], label: 'amount', kind: 'text', description: 'disbursement amount field' },
  note: { ids: ['note'], label: 'note', kind: 'text', description: 'note field' },
} as const satisfies Readonly<Record<keyof LoanActionValues, FieldSpec>>;

const ACTION_FIELD_ORDER: readonly (keyof LoanActionValues)[] = [
  'approvedOnDate',
  'approvedPrincipal',
  'rejectedOnDate',
  'actualDisbursementDate',
  'transactionAmount',
  'note',
];

const REPAYMENT_FIELDS = {
  transactionDate: { ids: ['transactionDate'], label: 'transaction', kind: 'date', description: 'transaction date field' },
  transactionAmount: { ids: ['transactionAmount'], label: 'amount', kind: 'text', description: 'repayment amount field' },
  paymentTypeId: { ids: ['paymentTypeId'], label: 'payment\\s*type', kind: 'select', description: 'payment type select' },
  note: { ids: ['note'], label: 'note', kind: 'text', description: 'note field' },
} as const satisfies Readonly<Record<keyof LoanRepaymentValues, FieldSpec>>;

const REPAYMENT_FIELD_ORDER: readonly (keyof LoanRepaymentValues)[] = [
  'transactionDate',
  'transactionAmount',
  'paymentTypeId',
  'note',
];

const SCHEDULE_COLUMNS = {
  period: ['no', 'period'],
  fromDate: ['from date', 'fromdate', 'period from'],
  dueDate: ['date', 'due date', 'duedate'],
  principalDue: ['principal', 'principal due', 'principaldue'],
  interestDue: ['interest', 'interest due', 'interestdue'],
  feesDue: ['fees', 'fees due', 'feesdue'],
  totalDue: ['total', 'total due', 'totaldue'],
  outstanding: ['outstanding', 'total outstanding', 'totaloutstanding'],
} as const;

const TRANSACTION_COLUMNS = {
  date: ['date', 'transaction date', 'transactiondate'],
  type: ['type', 'transaction type', 'transactiontype'],
  amount: ['amount'],
  outstandingBalance: ['outstanding', 'loan balance', 'loanbalance', 'outstanding balance'],
} as const;

function describeArgument(value: number | string): string {
  return typeof value === 'number' ? String(value) : JSON.stringify(value);
}

function describeOptions(options: readonly RenderedOption[]): string {
  if (options.length === 0) {
    return 'no options at all';
  }
  return options
    .map((option) => `"${option.label}" (id ${option.value.length > 0 ? option.value : 'none'})`)
    .join(', ');
}

function requireRouteId(value: number | string, role: string): string {
  const text = (typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value).trim();
  if (text.length === 0) {
    throw new Error(`${role} must be a non-empty id; received ${describeArgument(value)}`);
  }
  if (/[/?#]/.test(text)) {
    throw new Error(`${role} must be a single route segment; received ${describeArgument(value)}`);
  }
  return text;
}

function requireLoanAction(action: LoanAction): LoanAction {
  if (!LOAN_ACTIONS.includes(action)) {
    throw new Error(
      `the loan action must be one of ${LOAN_ACTIONS.join(', ')}; received ${describeArgument(action)}`,
    );
  }
  return action;
}

/** Renders a date argument as the `yyyy-mm-dd` a native date control accepts, and rejects anything else (Rule 1 clause 2, AAP 0.10.1). */
function requireDateValue(value: string, field: string): string {
  const text = String(value).trim();
  if (!DATE_ONLY_PATTERN.test(text)) {
    throw new Error(
      `${field} takes a date as yyyy-mm-dd, from the run date read over the API; received ${describeArgument(value)}`,
    );
  }
  return text;
}

/** Parses a rendered amount or balance into a number, keeping every digit the screen printed (AAP 0.10.2). */
function toAmount(text: string): number | null {
  const stripped = text.replace(/[^0-9.-]/g, '');
  if (!/[0-9]/.test(stripped)) {
    return null;
  }
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? parsed : null;
}

function toWholeNumber(text: string): number | null {
  const parsed = toAmount(text);
  return parsed === null ? null : Math.trunc(parsed);
}

function columnIndex(columns: readonly string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const index = columns.indexOf(alias);
    if (index >= 0) {
      return index;
    }
  }
  return -1;
}

function cellAt(cells: readonly string[], index: number): string {
  return index >= 0 ? (cells[index] ?? '') : '';
}

function readSelectOptions(element: HTMLElement): RenderedOption[] {
  if (!(element instanceof HTMLSelectElement)) {
    return [];
  }
  const options: RenderedOption[] = [];
  for (const option of Array.from(element.options)) {
    options.push({
      index: option.index,
      value: option.value.trim().replace(/^\d+:\s*/, ''),
      label: (option.textContent ?? '').trim(),
    });
  }
  return options;
}

/** Runs inside the page: the loan record's status colour class and its summary label/value rows (AAP 0.10.5). */
function readSummaryInPage(root: HTMLElement): LoanSummaryView {
  let statusClass = '';
  const swatch = root.querySelector('.status-swatch');
  if (swatch !== null) {
    for (const token of (swatch.getAttribute('class') ?? '').split(/\s+/)) {
      if (/^status-(?:active|pending|closed|other)$/.test(token)) {
        statusClass = token;
        break;
      }
    }
  }

  const block = root.querySelector('#loan-summary') ?? root;
  const fields: LabelValue[] = [];
  for (const row of Array.from(block.querySelectorAll('.row'))) {
    const key = row.querySelector('.value-key');
    if (key === null) {
      continue;
    }
    const value = key.parentElement === null ? null : key.parentElement.nextElementSibling;
    fields.push({
      label: (key.textContent ?? '').trim(),
      value: (value?.textContent ?? '').trim(),
    });
  }

  return { statusClass, fields };
}

function readGridInPage(root: HTMLElement): TableGrid | null {
  const table = root.querySelector('table');
  if (table === null) {
    return null;
  }

  const columns: string[] = [];
  for (const header of Array.from(table.querySelectorAll('thead th'))) {
    columns.push(
      (header.textContent ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim(),
    );
  }

  const rows: string[][] = [];
  for (const row of Array.from(table.querySelectorAll('tbody tr'))) {
    const cells: string[] = [];
    for (const cell of Array.from(row.querySelectorAll('td'))) {
      cells.push((cell.textContent ?? '').trim());
    }
    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return { columns, rows };
}

/** Drives the new Angular application's individual-loan screens and reads what they render: the `next` side of workflows W4, W5, W6 and W7 (AAP 0.10.1) (Rule 1 clause 9, AAP 0.10.2, Rule 1 clause 3). */
export class LoansPage {
  constructor(private readonly page: Page) {}

  /** Chooses the loan product by its visible label, case-insensitively (AAP 0.10.5, AAP 0.10.1). */
  async selectProduct(name: string): Promise<void> {
    const wanted = name.trim();
    if (wanted.length === 0) {
      throw new Error('selectProduct() needs the visible label of a loan product; received a blank name');
    }

    const root = await this.awaitRoot(APPLICATION_ROOT);
    const select = await this.resolveField(
      root,
      [
        `#${APPLICATION_FIELDS.productId.ids[0]}`,
        '.form-group:has(label:text-matches("product", "i")) select.form-control',
        'select.form-control',
      ],
      APPLICATION_FIELDS.productId.description,
    );

    const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const option = select.locator(`option:text-matches("^\\s*${escaped}\\s*$", "i")`).first();
    try {
      await option.waitFor({ state: 'attached', timeout: TEMPLATE_TIMEOUT_MS });
    } catch {
      const offered = await select.evaluate(readSelectOptions);
      throw new Error(
        `the loan product select offers no option labelled ${JSON.stringify(wanted)}; ` +
          `it offers ${describeOptions(offered)}`,
      );
    }

    const index = await option.evaluate((element: Element): number => (element as HTMLOptionElement).index);
    await select.selectOption({ index });
    await this.awaitTemplateApplied(root);
  }

  /** Fills the application values the caller states, and only those (AAP 0.7.2, Rule 1 clause 3, Rule 1 clause 2). */
  async fillApplication(values: LoanApplicationValues): Promise<void> {
    const root = await this.awaitRoot(APPLICATION_ROOT);

    if (values.productId !== undefined) {
      await this.fillField(root, APPLICATION_FIELDS.productId, values.productId);
      await this.awaitTemplateApplied(root);
    }

    const terms = APPLICATION_FIELD_ORDER.filter((key) => key !== 'productId');
    await this.fillFields(root, APPLICATION_FIELDS, terms, values);
  }

  async previewSchedule(): Promise<void> {
    const root = await this.awaitRoot(APPLICATION_ROOT);
    const labelled = root.locator('.btn.btn-primary').filter({ hasText: /preview/i }).first();
    const candidate = (await labelled.count()) > 0
      ? labelled
      : root.locator('.btn.btn-primary').filter({ hasNotText: /submit/i }).first();
    if ((await candidate.count()) === 0) {
      throw new Error(
        'the loan application screen renders no preview control, so the schedule was not calculated',
      );
    }
    await candidate.click();

    const rows = this.page.locator(`${PREVIEW_ROOT} tbody tr`);
    try {
      await rows.first().waitFor({ state: 'attached', timeout: TEMPLATE_TIMEOUT_MS });
    } catch {
      throw new Error(
        `the repayment preview painted no schedule row within ${TEMPLATE_TIMEOUT_MS} ms; ` +
          'the screen keeps its calculation error in its own alert region',
      );
    }
  }

  /** Reads the repayment-schedule preview the screen calculated, one row per period (AAP 0.10.1, AAP 0.10.2, AAP 0.7.4). */
  async readPreviewRows(): Promise<readonly RepaymentPreviewRow[]> {
    const grid = await this.readGridOf(PREVIEW_ROOT, null);
    if (grid === null) {
      return [];
    }

    const period = columnIndex(grid.columns, SCHEDULE_COLUMNS.period);
    const fromDate = columnIndex(grid.columns, SCHEDULE_COLUMNS.fromDate);
    const dueDate = columnIndex(grid.columns, SCHEDULE_COLUMNS.dueDate);
    const principalDue = columnIndex(grid.columns, SCHEDULE_COLUMNS.principalDue);
    const interestDue = columnIndex(grid.columns, SCHEDULE_COLUMNS.interestDue);
    const feesDue = columnIndex(grid.columns, SCHEDULE_COLUMNS.feesDue);
    const totalDue = columnIndex(grid.columns, SCHEDULE_COLUMNS.totalDue);
    const outstanding = columnIndex(grid.columns, SCHEDULE_COLUMNS.outstanding);

    return grid.rows.map((cells) => ({
      period: toWholeNumber(cellAt(cells, period)),
      fromDate: cellAt(cells, fromDate),
      dueDate: cellAt(cells, dueDate),
      principalDue: toAmount(cellAt(cells, principalDue)),
      interestDue: toAmount(cellAt(cells, interestDue)),
      feesDue: toAmount(cellAt(cells, feesDue)),
      totalDue: toAmount(cellAt(cells, totalDue)),
      outstanding: toAmount(cellAt(cells, outstanding)),
      cells,
    }));
  }

  /** Submits the application exactly once. The loan-creating step of W4 (AAP 0.10.2). */
  async submitApplication(): Promise<void> {
    const root = await this.awaitRoot(APPLICATION_ROOT);
    const typed = root.locator('button[type="submit"]').first();
    if ((await typed.count()) > 0) {
      await typed.click();
      return;
    }
    const labelled = root.locator('.btn.btn-primary').filter({ hasText: /submit/i }).first();
    if ((await labelled.count()) > 0) {
      await labelled.click();
      return;
    }
    throw new Error(
      'the loan application screen renders no submit control, so the application was not sent',
    );
  }

  /** Opens the loan record. Serves the read-back step of W5 and W6 over `#/viewloanaccount/:id` (AAP 0.8.2), where the one read carries the status, the summary figures, the repayment schedule, the transactions and the charges together (AAP 0.7.3, AAP 0.7.4). */
  async openView(loanId: number | string): Promise<void> {
    const id = requireRouteId(loanId, 'the loan id');
    await this.navigate(`/viewloanaccount/${id}`);
    await this.awaitRecordSettled();
  }

  /** Reads the record's status colour class and its summary label/value rows (AAP 0.10.1, AAP 0.10.5, AAP 0.7.4). */
  async readSummary(): Promise<LoanSummaryView> {
    const root = this.page.locator(VIEW_ROOT).first();
    if ((await root.count()) === 0) {
      throw new Error(
        `the loan record is not on the page: no ${VIEW_ROOT} element. Open it with openView() first.`,
      );
    }
    await this.awaitRecordSettled();
    return root.evaluate(readSummaryInPage);
  }

  async readScheduleRows(): Promise<readonly LoanScheduleRow[]> {
    const grid = await this.readGridOf(SCHEDULE_ROOT, /repayment/i);
    if (grid === null) {
      return [];
    }

    const period = columnIndex(grid.columns, SCHEDULE_COLUMNS.period);
    const fromDate = columnIndex(grid.columns, SCHEDULE_COLUMNS.fromDate);
    const dueDate = columnIndex(grid.columns, SCHEDULE_COLUMNS.dueDate);
    const totalDue = columnIndex(grid.columns, SCHEDULE_COLUMNS.totalDue);
    const outstanding = columnIndex(grid.columns, SCHEDULE_COLUMNS.outstanding);

    return grid.rows.map((cells) => ({
      period: toWholeNumber(cellAt(cells, period)),
      fromDate: cellAt(cells, fromDate),
      dueDate: cellAt(cells, dueDate),
      totalDue: toAmount(cellAt(cells, totalDue)),
      outstanding: toAmount(cellAt(cells, outstanding)),
      cells,
    }));
  }

  /** Reads the record's transaction list, one row per transaction (AAP 0.10.1, AAP 0.7.4). */
  async readTransactions(): Promise<readonly LoanTransactionRow[]> {
    const grid = await this.readGridOf(TRANSACTIONS_ROOT, /transactions/i);
    if (grid === null) {
      return [];
    }

    const date = columnIndex(grid.columns, TRANSACTION_COLUMNS.date);
    const type = columnIndex(grid.columns, TRANSACTION_COLUMNS.type);
    const amount = columnIndex(grid.columns, TRANSACTION_COLUMNS.amount);
    const outstandingBalance = columnIndex(grid.columns, TRANSACTION_COLUMNS.outstandingBalance);

    return grid.rows.map((cells) => ({
      date: cellAt(cells, date),
      type: cellAt(cells, type),
      amount: toAmount(cellAt(cells, amount)),
      outstandingBalance: toAmount(cellAt(cells, outstandingBalance)),
      cells,
    }));
  }

  /** Reads the message of every explicit empty state currently visible, in document order (AAP 0.7.4). */
  async readEmptyStates(): Promise<readonly string[]> {
    const hosts = await this.page.locator('app-empty-state').all();
    const messages: string[] = [];
    for (const host of hosts) {
      if (!(await host.isVisible())) {
        continue;
      }
      messages.push(((await host.textContent()) ?? '').trim());
    }
    return messages;
  }

  /** Opens one of the six lifecycle action screens. Serves the approve, undo-approval, reject, disburse and undo-disbursal steps of W5 and the repayment step of W6 over `#/loanaccount/:id/:action` (AAP 0.8.2). */
  async openAction(loanId: number | string, action: LoanAction): Promise<void> {
    const id = requireRouteId(loanId, 'the loan id');
    const segment = requireLoanAction(action);
    await this.navigate(`/loanaccount/${id}/${segment}`);
    await this.awaitRoot(ACTION_ROOT);
  }

  /** Fills the values the open action form is to send, and only those (AAP 0.7.2). */
  async fillActionForm(values: LoanActionValues): Promise<void> {
    const root = await this.awaitRoot(ACTION_ROOT);
    await this.fillFields(root, ACTION_FIELDS, ACTION_FIELD_ORDER, values);
  }

  /** Submits the open action form exactly once. Finishes the approve, undo-approval, reject, disburse or undo-disbursal step of W5. */
  async submitAction(): Promise<void> {
    await this.clickPrimary(ACTION_ROOT);
  }

  /** Opens the repayment form. Serves W6 over `#/loanaccount/:id/repayment` (AAP 0.8.2): the `repayment` segment of the action route, whose screen renders the repayment form inside the action screen's own card. */
  async openRepayment(loanId: number | string): Promise<void> {
    const id = requireRouteId(loanId, 'the loan id');
    await this.navigate(`/loanaccount/${id}/repayment`);
    await this.awaitRoot(REPAYMENT_ROOT);
  }

  /** Fills the values the repayment form is to send, and only those (AAP 0.7.2). */
  async fillRepayment(values: LoanRepaymentValues): Promise<void> {
    const root = await this.awaitRoot(REPAYMENT_ROOT);
    await this.fillFields(root, REPAYMENT_FIELDS, REPAYMENT_FIELD_ORDER, values);
  }

  /** Submits the repayment exactly once. Finishes W6. A repayment is not idempotent, so the primary control is clicked once and never retried; on success the router returns to `#/viewloanaccount/{id}`, so the caller re-reads. */
  async submitRepayment(): Promise<void> {
    await this.clickPrimary(REPAYMENT_ROOT);
  }

  /** The absolute URL of one screen, carrying both query parameters Rule 2 requires (AAP 0.4.4). */
  private screenUrl(route: string): string {
    return `${NEXT_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}&tenantIdentifier=${TENANT_ID}#${route}`;
  }

  /** Navigates to a hash route on the full entry URL. The navigation is confirmed against `window.location.hash` rather than trusted: when the router has not applied the fragment — a document that was already open, or a redirect that ran first — the hash is set in the page as the second way to ask it. */
  private async navigate(route: string): Promise<void> {
    await this.page.goto(this.screenUrl(route));
    const applied = await this.page.evaluate(
      (hint: string): boolean => window.location.hash === `#${hint}`,
      route,
    );
    if (!applied) {
      await this.page.evaluate((hint: string): void => {
        window.location.hash = hint;
      }, route);
    }
  }

  /** Waits until the loan record has painted its content, or has reported why it cannot (AAP 0.7.4). */
  private async awaitRecordSettled(): Promise<Locator> {
    const view = await this.awaitRoot(VIEW_ROOT);
    const settled = this.page
      .locator(
        `${VIEW_ROOT} #loan-summary, ${VIEW_ROOT} #loan-view-error, ${VIEW_ROOT} #loan-view-not-found, ` +
          `${VIEW_ROOT} .alert.alert-danger, ${VIEW_ROOT} .text-center.text-muted, ` +
          `.notification-container .notification`,
      )
      .first();
    try {
      await settled.waitFor({ state: 'attached', timeout: SCREEN_TIMEOUT_MS });
    } catch {
      throw new Error(
        `the loan record (${VIEW_ROOT}) neither painted its summary nor reported a failure within ` +
          `${SCREEN_TIMEOUT_MS} ms`,
      );
    }
    return view;
  }

  private async awaitRoot(rootSelector: string): Promise<Locator> {
    const root = this.page.locator(rootSelector).first();
    const description = SCREENS[rootSelector] ?? rootSelector;
    try {
      await root.waitFor({ state: 'visible', timeout: SCREEN_TIMEOUT_MS });
    } catch {
      const hash = await this.page
        .evaluate((): string => window.location.hash)
        .catch((): string => '');
      throw new Error(
        `${description} (${rootSelector}) did not paint within ${SCREEN_TIMEOUT_MS} ms; ` +
          `the page is at ${hash.length > 0 ? hash : 'no hash at all'}`,
      );
    }
    return root;
  }

  private async resolveField(
    root: Locator,
    selectors: readonly string[],
    description: string,
  ): Promise<Locator> {
    for (const selector of selectors) {
      const candidate = root.locator(selector).first();
      if ((await candidate.count()) > 0) {
        await candidate.waitFor({ state: 'visible', timeout: SCREEN_TIMEOUT_MS });
        return candidate;
      }
    }
    throw new Error(`the ${description} is not on the screen; tried ${selectors.join(' | ')}`);
  }

  private async clickPrimary(rootSelector: string): Promise<void> {
    const root = await this.awaitRoot(rootSelector);
    const chain = [
      'button.btn.btn-primary[type="submit"]',
      '.btn.btn-primary',
      'button[type="submit"]',
    ];
    for (const selector of chain) {
      const candidate = root.locator(selector).first();
      if ((await candidate.count()) > 0) {
        await candidate.click();
        return;
      }
    }
    throw new Error(
      `${SCREENS[rootSelector] ?? rootSelector} renders no primary control, so the request was not sent`,
    );
  }

  private async fillFields<K extends string>(
    root: Locator,
    specs: Readonly<Record<K, FieldSpec>>,
    order: readonly K[],
    values: Readonly<Partial<Record<K, number | string>>>,
  ): Promise<void> {
    for (const key of order) {
      const value = values[key];
      if (value === undefined) {
        continue;
      }
      await this.fillField(root, specs[key], value);
    }
  }

  private async fillField(root: Locator, spec: FieldSpec, value: number | string): Promise<void> {
    const field = await this.resolveField(root, this.fieldSelectors(spec), spec.description);
    if (spec.kind === 'select') {
      await this.selectLogicalValue(field, spec, value);
      return;
    }
    if (spec.kind === 'date') {
      await field.fill(requireDateValue(String(value), spec.description));
      return;
    }
    await field.fill(String(value));
  }

  private async awaitTemplateApplied(root: Locator): Promise<void> {
    const busy = root.locator('.panel-body[aria-busy="true"]');
    const appeared = await busy
      .first()
      .waitFor({ state: 'attached', timeout: TEMPLATE_BUSY_GRACE_MS })
      .then(
        () => true,
        () => false,
      );
    if (!appeared) {
      return;
    }
    try {
      await busy.first().waitFor({ state: 'detached', timeout: TEMPLATE_TIMEOUT_MS });
    } catch {
      throw new Error(
        `the loan application form was still reading its Fineract template after ` +
          `${TEMPLATE_TIMEOUT_MS} ms, so its terms are not settled`,
      );
    }
  }

  private fieldSelectors(spec: FieldSpec): readonly string[] {
    const chain: string[] = spec.ids.map((id) => `#${id}`);
    const captioned = `.form-group:has(label:text-matches("${spec.label}", "i"))`;
    if (spec.kind === 'date') {
      chain.push(`${captioned} input[type="date"]`);
    } else if (spec.kind === 'select') {
      chain.push(`${captioned} select.form-control`);
    } else {
      chain.push(`${captioned} input.form-control`, `${captioned} textarea.form-control`);
    }
    return chain;
  }

  /** Selects the option whose bound value is the id a caller supplied (AAP 0.10.5). */
  private async selectLogicalValue(
    field: Locator,
    spec: FieldSpec,
    value: number | string,
  ): Promise<void> {
    const wanted = String(value).trim();
    const attempts = Math.ceil(TEMPLATE_TIMEOUT_MS / OPTION_POLL_INTERVAL_MS);
    let offered = await field.evaluate(readSelectOptions);
    let match = offered.find((option) => option.value === wanted);
    for (let attempt = 1; match === undefined && attempt < attempts; attempt += 1) {
      await this.page.waitForTimeout(OPTION_POLL_INTERVAL_MS);
      offered = await field.evaluate(readSelectOptions);
      match = offered.find((option) => option.value === wanted);
    }

    if (match === undefined) {
      throw new Error(
        `the ${spec.description} offers no option with id ${describeArgument(value)}; ` +
          `it offers ${describeOptions(offered)}`,
      );
    }
    await field.selectOption({ index: match.index });
  }

  private async readGridOf(rootSelector: string, tab: RegExp | null): Promise<TableGrid | null> {
    if (tab !== null) {
      await this.revealSection(rootSelector, tab);
    }
    const root = this.page.locator(rootSelector).first();
    if ((await root.count()) === 0) {
      return null;
    }
    return root.evaluate(readGridInPage);
  }

  private async revealSection(rootSelector: string, tab: RegExp): Promise<void> {
    if ((await this.page.locator(rootSelector).count()) > 0) {
      return;
    }
    const view = this.page.locator(VIEW_ROOT).first();
    if ((await view.count()) === 0) {
      return;
    }
    await this.awaitRecordSettled();
    if ((await this.page.locator(rootSelector).count()) > 0) {
      return;
    }
    const trigger = view.locator('.nav-tabs li > a').filter({ hasText: tab }).first();
    if ((await trigger.count()) === 0) {
      return;
    }
    await trigger.click();

    const ready = this.page.locator(`${rootSelector}, ${VIEW_ROOT} app-empty-state`).first();
    try {
      await ready.waitFor({ state: 'attached', timeout: SCREEN_TIMEOUT_MS });
    } catch {
      throw new Error(
        `${SCREENS[rootSelector] ?? rootSelector} (${rootSelector}) did not paint after its tab was ` +
          `selected within ${SCREEN_TIMEOUT_MS} ms`,
      );
    }
  }
}

