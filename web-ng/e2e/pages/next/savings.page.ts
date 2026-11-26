/** Page object for the new Angular application's savings screens — the `next` project's side of Stretch workflow W8: open a savings account, approve it, activate it, deposit 1,000, withdraw 200 and read the account back (AAP 0.9.1, AAP 0.9.3, AAP 0.10.1, AAP 0.8.2). */
import type { Locator, Page } from '@playwright/test';

import { FINERACT_URL, NEXT_URL, TENANT_ID } from '../../seed/fixtures.js';

/** One label/value row of a record as the page renders it, used for the savings summary table whose rows are a `<th scope="row">` key and a `<td>` value. */
export interface LabelValue {
  /** The row's label text, trimmed. */
  readonly label: string;
  /** The row's rendered value, trimmed; `''` when the row renders no value. */
  readonly value: string;
}

/** The savings record's status indicator and summary rows, as the page renders them (AAP 0.10.5, Rule 1 clause 3). */
export interface SavingsSummaryView {
  /** One of `status-active`, `status-pending`, `status-closed`, `status-other`, or `''` if none is painted. */
  readonly statusClass: string;
  /** Label/value rows in document order, exactly as rendered. */
  readonly fields: readonly LabelValue[];
}

/** One row of the record's transactions table, with each cell as the screen renders it. */
export interface SavingsTransactionRow {
  /** The date column, formatted for display by the screen. */
  readonly date: string;
  /** The type column, Fineract's own label for the transaction, passed through untranslated. */
  readonly type: string;
  /** The amount column parsed as a number, `null` when the cell renders no figure. */
  readonly amount: number | null;
  /** The running balance column parsed as a number, `null` when the cell renders none. */
  readonly balance: number | null;
  /** Every cell of the row, trimmed, in column order. */
  readonly cells: readonly string[];
}

/** What the application screen lets a caller choose. Every member is optional so a caller states only the values it means to set: an omitted date leaves the one the screen pre-filled from the browser clock, which is the (AAP 0.10.5, AAP 0.7.2). */
export interface SavingsApplicationValues {
  /** The product to open the account on, by id, when a caller drives the select by value. */
  readonly productId?: number | string;
  /** `yyyy-mm-dd`, always supplied by the caller from the run date — never computed here. */
  readonly submittedOnDate?: string;
  /** Field officer to attach to the account; not rendered by this screen (AAP 0.10.5 item 5). */
  readonly fieldOfficerId?: number | string;
}

/** What a caller supplies to an action form. Every member is optional because each screen pre-fills what it can from the template, and a caller may keep those defaults; nothing here is formatted, rounded or bounded (Rule 1 (Rule 1 clause 3). */
export interface SavingsActionValues {
  /** Approval date, as `yyyy-mm-dd`, typed into the approve screen's date field. */
  readonly approvedOnDate?: string;
  /** Activation date, as `yyyy-mm-dd`, typed into the activate screen's date field. */
  readonly activatedOnDate?: string;
  /** Transaction date, as `yyyy-mm-dd`, typed into the deposit or withdrawal screen's date field. */
  readonly transactionDate?: string;
  /** Transaction amount, passed through exactly as supplied. */
  readonly transactionAmount?: number | string;
  /** Payment type, by the id of one of the options the transactions template returned. */
  readonly paymentTypeId?: number | string;
}

/** The four `:action` segments the `#/savingaccount/:id/:action` route serves for workflow W8 (AAP 0.8.2, AAP 0.9.1 scope group 4). */
export type SavingsAction = 'approve' | 'activate' | 'deposit' | 'withdraw';

/** Root element of the savings application screen, `SavingsNewComponent`. */
const APPLICATION_ROOT = 'app-savings-new';

/** Root element of the savings record, `SavingsViewComponent`. */
const VIEW_ROOT = 'app-savings-view';

/** Root element of the single-purpose action screen, `SavingsActionComponent`. */
const ACTION_ROOT = 'app-savings-action';

/** The action segments accepted at run time, in the order the record offers them. */
const SAVINGS_ACTIONS: readonly string[] = ['approve', 'activate', 'deposit', 'withdraw'];

/** `yyyy-mm-dd`, the only form a native date control accepts and the form this object requires. */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Ceiling for a screen's root element to paint after a navigation has been requested. */
const SCREEN_TIMEOUT_MS = 30_000;

/** Ceiling for a template-driven option list to arrive. The product options come from the savings template the screen requests on entry, so the list is empty for a moment after the form paints. */
const TEMPLATE_TIMEOUT_MS = 30_000;

/** How long one attempt to read a template-driven option list waits before the next, when a selection has to be matched on the option's logical value rather than on its DOM value. */
const OPTION_POLL_INTERVAL_MS = 100;

/** One `<option>` of a native select, as the page renders it. Internal to this module. */
interface RenderedOption {
  /** The option's position in the select, from zero. */
  readonly index: number;
  /** The value the application bound, with Angular's `${position}: ` prefix removed. */
  readonly value: string;
  /** The option's visible text, trimmed — what a caller matches by label. */
  readonly label: string;
}

/** Renders an argument a caller passed, for an error message. A string is quoted so a value that is blank, or that carries a separator, is visible in the message. */
function describeArgument(value: number | string): string {
  return typeof value === 'number' ? String(value) : JSON.stringify(value);
}

/** Renders the options a select offers — each one's label with the id it carries — so an error message about a label or an id that is missing names what the screen does offer. */
function describeOptions(options: readonly RenderedOption[]): string {
  if (options.length === 0) {
    return 'no options at all';
  }
  return options.map((option) => `"${option.label}" (id ${option.value.length > 0 ? option.value : 'none'})`).join(', ');
}

/** Renders a route argument as the single segment a hash route may carry, and rejects what could not be one. */
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

/** Narrows an action to the four segments this object serves. Internal to this module. */
function requireActionSegment(action: SavingsAction): SavingsAction {
  if (!SAVINGS_ACTIONS.includes(action)) {
    throw new Error(
      `the savings action must be one of ${SAVINGS_ACTIONS.join(', ')}; received ${describeArgument(action)}`,
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

/** Runs inside the page: every `<option>` of a select as `{ value, label }`, both trimmed, in document order. */
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

/** Runs inside the page: the record's status colour class and its summary label/value rows (AAP 0.10.5). */
function readSummaryInPage(root: HTMLElement): SavingsSummaryView {
  let statusClass = '';
  const swatch = root.querySelector('.status-swatch');
  if (swatch !== null) {
    const tokens = (swatch.getAttribute('class') ?? '').split(/\s+/);
    for (const token of tokens) {
      if (/^status-(?:active|pending|closed|other)$/.test(token)) {
        statusClass = token;
        break;
      }
    }
  }

  const panel = root.querySelector('.savings-summary');
  const rows = Array.from((panel ?? root).querySelectorAll('tr'));
  const fields: LabelValue[] = [];
  for (const row of rows) {
    const label = row.querySelector('th');
    if (label === null) {
      continue;
    }
    const value = row.querySelector('td');
    fields.push({
      label: (label.textContent ?? '').trim(),
      value: (value?.textContent ?? '').trim(),
    });
  }

  return { statusClass, fields };
}

/** Runs inside the page: every row of the record's transactions table as its trimmed cell texts (AAP 0.7.4). */
function readTransactionCells(root: HTMLElement): string[][] {
  if (root.querySelector('app-empty-state') !== null) {
    return [];
  }

  const named = root.querySelector('#savings-transactions');
  const panel = root.querySelector('.savings-transactions');
  const table = named ?? (panel === null ? null : panel.querySelector('table'));
  if (table === null) {
    return [];
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
  return rows;
}


/** Drives the new Angular application's savings screens and reads what they render: the `next` side of workflow W8 (AAP 0.10.1) (Rule 1 clause 9, Rule 1 clause 3). */
export class SavingsPage {
  /** @param page The Playwright page the spec has already authenticated on. */
  constructor(private readonly page: Page) {}

  /** Chooses the savings product by its visible label, case-insensitively (AAP 0.10.5, AAP 0.10.1). */
  async selectProduct(name: string): Promise<void> {
    const wanted = name.trim();
    if (wanted.length === 0) {
      throw new Error('selectProduct() needs the visible label of a savings product; received a blank name');
    }

    // Two ids, both kept: the plan names `#productId`, and the shipped application form renders the shared select field with `inputId="savings-product"`.
    const select = await this.resolveField(
      [
        `${APPLICATION_ROOT} #productId`,
        `${APPLICATION_ROOT} #savings-product`,
        `${APPLICATION_ROOT} .form-group:has(> label:text-matches("product", "i")) select.form-control`,
        `${APPLICATION_ROOT} select.form-control`,
      ],
      'savings product select',
    );

    const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const option = select.locator(`option:text-matches("^\\s*${escaped}\\s*$", "i")`).first();
    try {
      await option.waitFor({ state: 'attached', timeout: TEMPLATE_TIMEOUT_MS });
    } catch {
      const offered = await select.evaluate(readSelectOptions);
      throw new Error(
        `the savings product select offers no option labelled "${wanted}"; it offers ${describeOptions(offered)}`,
      );
    }

    const index = await option.evaluate((element: Element): number => (element as HTMLOptionElement).index);
    await select.selectOption({ index });
  }

  /** Submits the application exactly once. The account-creating step of W8. */
  async submitApplication(): Promise<void> {
    await this.clickPrimary(APPLICATION_ROOT, 'the savings application screen');
  }

  /** Opens the savings record. Serves the read-back step of W8 over `#/viewsavingaccount/:id` (AAP 0.8.2), where the account read carries the status, the three figures and the transaction list together (AAP 0.7.3 W8 row) (AAP 0.7.4). */
  async openView(savingsId: number | string): Promise<void> {
    const id = requireRouteId(savingsId, 'the savings account id');
    await this.navigate(`/viewsavingaccount/${id}`);
    await this.awaitRoot(VIEW_ROOT, 'the savings record');
  }

  /** Reads the record's status colour class and its summary label/value rows (AAP 0.10.1, AAP 0.7.4). */
  async readSummary(): Promise<SavingsSummaryView> {
    const root = this.page.locator(VIEW_ROOT).first();
    if ((await root.count()) === 0) {
      throw new Error(`the savings record is not on the page: no ${VIEW_ROOT} element. Open it with openView() first.`);
    }
    return root.evaluate(readSummaryInPage);
  }

  /** Reads the record's transactions table, one row per rendered transaction (AAP 0.10.1, AAP 0.10.2, AAP 0.7.4). */
  async readTransactions(): Promise<readonly SavingsTransactionRow[]> {
    const root = this.page.locator(VIEW_ROOT).first();
    if ((await root.count()) === 0) {
      return [];
    }

    const rendered = await root.evaluate(readTransactionCells);
    return rendered.map((cells) => ({
      date: cells[0] ?? '',
      type: cells[1] ?? '',
      amount: toAmount(cells[2] ?? ''),
      balance: toAmount(cells[3] ?? ''),
      cells,
    }));
  }

  /** Opens one of the four action screens. Serves the lifecycle and cash steps of W8 over `#/savingaccount/:id/:action` (AAP 0.8.2) (AAP 0.7.3). */
  async openAction(savingsId: number | string, action: SavingsAction): Promise<void> {
    const id = requireRouteId(savingsId, 'the savings account id');
    const segment = requireActionSegment(action);
    await this.navigate(`/savingaccount/${id}/${segment}`);
    await this.awaitRoot(ACTION_ROOT, 'the savings action screen');
  }

  /** Fills the values the open action form is to send, and only those (AAP 0.7.2, Rule 1 clause 3, Rule 1 clause 2). */
  async fillTransaction(values: SavingsActionValues): Promise<void> {
    if (values.approvedOnDate !== undefined) {
      await this.fillDate('approvedOnDate', values.approvedOnDate);
    }
    if (values.activatedOnDate !== undefined) {
      await this.fillDate('activatedOnDate', values.activatedOnDate);
    }
    if (values.transactionDate !== undefined) {
      await this.fillDate('transactionDate', values.transactionDate);
    }
    if (values.transactionAmount !== undefined) {
      await this.fillAmount(values.transactionAmount);
    }
    if (values.paymentTypeId !== undefined) {
      await this.fillPaymentType(values.paymentTypeId);
    }
  }

  /** Submits the open action form exactly once. Finishes the approve, activate, deposit or withdrawal step of W8 (AAP 0.10.2). */
  async submitAction(): Promise<void> {
    await this.clickPrimary(ACTION_ROOT, 'the savings action screen');
  }

  /** The absolute URL of one screen, carrying both query parameters Rule 2 requires (AAP 0.4.4). */
  private screenUrl(route: string): string {
    return `${NEXT_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}&tenantIdentifier=${TENANT_ID}#${route}`;
  }

  /** Navigates to a hash route on the full entry URL. The navigation is confirmed against `window.location.hash` rather than trusted: when the router has not applied the fragment — a document that was already open, or a. */
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

  /** Waits for a screen's root element to paint, and reports the hash it settled on when it does not. @param rootSelector Root element of the screen. @param description What the screen is, used in the error message. @throws. */
  private async awaitRoot(rootSelector: string, description: string): Promise<void> {
    const root = this.page.locator(rootSelector).first();
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
  }

  /** Resolves a control through an ordered chain of selectors and waits for it to be usable. */
  private async resolveField(selectors: readonly string[], description: string): Promise<Locator> {
    for (const selector of selectors) {
      const candidate = this.page.locator(selector).first();
      if ((await candidate.count()) > 0) {
        await candidate.waitFor({ state: 'visible', timeout: SCREEN_TIMEOUT_MS });
        return candidate;
      }
    }
    throw new Error(`the ${description} is not on the screen; tried ${selectors.join(' | ')}`);
  }

  /** Clicks a screen's primary submit exactly once. Two candidates, in order: the Bootstrap primary button whose label begins with "Submit" (the legacy caption, translated at run time, so the match is case-insensitive and. */
  private async clickPrimary(rootSelector: string, description: string): Promise<void> {
    await this.awaitRoot(rootSelector, description);

    const root = this.page.locator(rootSelector).first();
    const labelled = root.locator('.btn.btn-primary').filter({ hasText: /^\s*submit/i }).first();
    if ((await labelled.count()) > 0) {
      await labelled.click();
      return;
    }

    const typed = root.locator('button[type="submit"]').first();
    if ((await typed.count()) > 0) {
      await typed.click();
      return;
    }

    throw new Error(`${description} renders no primary submit control, so the request was not sent`);
  }

  /** Types a `yyyy-mm-dd` date into the action screen's date field. */
  private async fillDate(fieldId: string, value: string): Promise<void> {
    const text = requireDateValue(value, fieldId);
    const field = await this.resolveField(
      [
        `${ACTION_ROOT} #${fieldId}`,
        `${ACTION_ROOT} .form-group:has(> label:text-matches("date", "i")) input[type="date"]`,
        `${ACTION_ROOT} input[type="date"]`,
      ],
      `${fieldId} date field`,
    );
    await field.fill(text);
  }

  /** Types a transaction amount exactly as supplied. @param value The amount the caller supplied, as a number or as text. @throws When no amount field resolves. */
  private async fillAmount(value: number | string): Promise<void> {
    const field = await this.resolveField(
      [
        `${ACTION_ROOT} #transactionAmount`,
        `${ACTION_ROOT} .form-group:has(> label:text-matches("amount", "i")) input.form-control`,
      ],
      'transaction amount field',
    );
    await field.fill(String(value));
  }

  /** Selects a payment type by the id of an option the transactions template returned (AAP 0.10.5). */
  private async fillPaymentType(value: number | string): Promise<void> {
    const wanted = String(value).trim();
    const field = await this.resolveField(
      [
        `${ACTION_ROOT} #paymentTypeId`,
        `${ACTION_ROOT} .form-group:has(> label:text-matches("payment\\s*type", "i")) select.form-control`,
      ],
      'payment type select',
    );

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
        `the payment type select offers no option with id ${describeArgument(wanted)}; ` +
          `it offers ${describeOptions(offered)}`,
      );
    }
    await field.selectOption({ index: match.index });
  }
}
