/** Legacy-only page object for the savings screens of the unchanged AngularJS application: the baseline of workflow W8, which is in scope because Stretch ships (AAP 0.9.3, 0.10.1) (AAP 0.8.2, Rule 2, AAP 0.10.1). */
import type { Locator, Page } from '@playwright/test';

import { FINERACT_URL, LEGACY_URL, TENANT_ID, formatFineractDate } from '../../seed/fixtures';
import { chooseOption } from './chosen';

/** What the application screen lets a caller choose. Both members are optional so a caller states only the values it means to set: an absent date leaves the date the template pre-filled, which is the legacy behaviour (AAP (AAP 0.10.5). */
export interface SavingsApplicationValues {
  /** Visible label of the savings product to choose, matched by `chooseOption`. */
  productName?: string;
  /** Submitted-on date, sent to the screen's datepicker as `dd MMMM yyyy`. */
  submittedOnDate?: Date;
}

/** One label/value pair of the savings record as the page renders it. */
export interface SavingsSummaryField {
  /** The row's label text, trimmed. */
  label: string;
  /** The row's rendered value, trimmed; `''` when the row renders no value. */
  value: string;
}

/** The savings record's status and summary, as the page renders them (AAP 0.10.5). */
export interface SavingsSummary {
  /** Legacy status token such as `statusactive`, or `''` when no status glyph is rendered. */
  statusClass: string;
  /** Label/value pairs in document order, covering the summary tables and the balance headings. */
  fields: SavingsSummaryField[];
}

/** One row of the record's transactions table, with each cell as the screen renders it. */
export interface SavingsTransactionRow {
  /** Transaction id column. */
  id: string;
  /** Transaction date column, formatted by the legacy `DateFormat` filter. */
  date: string;
  /** Transaction type column, without the reversal marker. */
  type: string;
  /** The row's amount: whichever of the legacy Debit and Credit columns renders a value. */
  amount: string;
  /** Running balance column. */
  balance: string;
  /** The reversal indicator the row renders, `''` when it renders none. */
  reversed: string;
}

/** What a caller supplies to a deposit or withdrawal form. Every member is optional because the legacy form pre-fills what Fineract's transaction template returns, and a caller may keep those defaults; nothing here (Rule 1 clause 3). */
export interface SavingsTransactionValues {
  /** Transaction date, typed into the screen's datepicker as `dd MMMM yyyy`. */
  date?: Date;
  /** Transaction amount, exactly as the caller supplies it. */
  amount?: string;
  /** Visible label of the payment type, matched by `chooseOption`. */
  paymentType?: string;
  /** Note; only the screens whose legacy controller sets `showNoteField` render one. */
  note?: string;
}

/** The savings commands the `#/savingaccount/:id/:action` route serves for workflow W8. */
export type SavingsAccountAction = 'approve' | 'activate' | 'deposit' | 'withdrawal';

/** Product `<select>` of the application screen. Source: new_saving_account_application.html, `<select id="productId" ...>`. */
const PRODUCT_SELECT = '[id="productId"]';

/** Submitted-on date field of the application screen. Source: new_saving_account_application.html, `<input id="submittedOnDate" datepicker-pop="dd MMMM yyyy" ng-show="formData.productId">`. */
const SUBMITTED_ON_DATE_INPUT = '[id="submittedOnDate"]';

/** The record header's status glyph, whose class list carries the legacy status token. */
const RECORD_STATUS_ICON = '.gray-head i.fa-stop';

/** The record header itself. Source: view_saving_account_details.html, `<div class="span gray-head">`. */
const RECORD_HEADER = '.gray-head';

/** The record's transactions table. Source: view_saving_account_details.html — the transactions tab's table is the only `.table` whose header cells carry the `pointer` class, because each one sorts the list through. */
const TRANSACTIONS_TABLE = 'table.table:has(thead th.pointer)';

/** Payment-type `<select>` of the deposit and withdrawal forms. Source: saving_account_actions.html, `<select id="paymentTypeId" ...>`; the controller fills it from `GET /savingsaccounts/{id}/transactions/template`. */
const PAYMENT_TYPE_SELECT = '[id="paymentTypeId"]';

/** Date field of the currently open action form. The action template renders `<input id="{{modelName}}" ...>`, and SavingAccountActionsController.js sets `modelName` per command: `approvedOnDate` for approve. */
const ACTION_DATE_INPUT = '[id="approvedOnDate"], [id="activatedOnDate"], [id="transactionDate"]';

/** The wizard's primary submit, the button that creates or acts on the account. */
const PRIMARY_SUBMIT = 'button#save:visible';

/** A wizard step's forward control, clicked only until the primary submit is reachable. */
const STEP_FORWARD = 'button#save1:visible, button#save4:visible, button.btn.btn-default.pull-right:visible';

/** Visible label of the transaction-amount field: `label.input.transactionamount` is "Transaction amount" in app/global-translations/locale-en.json. */
const AMOUNT_LABEL = 'Transaction amount';

/** Visible label of the note field: `label.input.note` is "Note" in the same locale file. */
const NOTE_LABEL = 'Note';

/** How many wizard steps `submitForm()` may advance before it reports that it never reached the primary submit. */
const MAX_WIZARD_STEPS = 8;

/** How long a navigation is given for the AngularJS router to render the destination's root locator before the hash is set a second way. */
const ROUTER_REACTION_TIMEOUT_MS = 15_000;

/** One rendered table row: its `class` attribute and the rendered text of each cell. */
interface RenderedRow {
  readonly className: string;
  readonly cells: readonly string[];
}

/** The transactions table as the DOM renders it: header labels and body rows. */
interface RenderedTable {
  readonly headers: readonly string[];
  readonly rows: readonly RenderedRow[];
}

/** How a transaction row's interesting values map onto the table's columns. */
interface TransactionColumns {
  readonly id: number;
  readonly date: number;
  readonly type: number;
  readonly debit: number;
  readonly credit: number;
  readonly balance: number;
}

/** Column positions of the legacy transactions table, used when a header cannot be recognised (a locale whose labels are not English, for instance). */
const LEGACY_TRANSACTION_COLUMNS: TransactionColumns = {
  id: 0,
  date: 1,
  type: 2,
  debit: 3,
  credit: 4,
  balance: 5,
};

/** Reads the record's status token and label/value pairs from the rendered savings record. */
function readSummaryInPage(): SavingsSummary {
  const statusClass =
    Array.from(document.querySelectorAll('.gray-head i'))
      // The header renders one glyph per status expression and hides the other with `ng-hide`, so only the glyph the browser considers visible carries the account's status.
      .filter((icon) => icon.checkVisibility())
      .map((icon) => Array.from(icon.classList).find((name) => name.startsWith('status')))
      .find((token) => token !== undefined) ?? '';

  const fields: SavingsSummaryField[] = [];
  // One walk in document order over the record's table rows and its balance headings.
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('table tr, h3'))) {
    const text = element.innerText.replace(/\s+/g, ' ').trim();
    if (element instanceof HTMLHeadingElement) {
      // The balances render as `<h3>Current Balance: $ 800</h3>` rather than as table rows, so they are split at the first colon to keep the same label/value shape.
      const separator = text.indexOf(':');
      if (separator > 0) {
        fields.push({
          label: text.slice(0, separator).trim(),
          value: text.slice(separator + 1).trim(),
        });
      }
      continue;
    }
    if (!(element instanceof HTMLTableRowElement)) continue;
    const heads = Array.from(element.querySelectorAll<HTMLTableCellElement>('th'));
    const cells = Array.from(element.querySelectorAll<HTMLTableCellElement>('td'));
    if (heads.length === 0 || cells.length === 0) continue;
    if (heads[0].colSpan > 1) continue;
    fields.push({
      label: heads[0].innerText.replace(/\s+/g, ' ').trim(),
      value: cells[0].innerText.replace(/\s+/g, ' ').trim(),
    });
  }

  return { statusClass, fields };
}

/** Reads the transactions table's header labels and body rows, cell by cell. */
function readTransactionsInPage(element: HTMLElement): RenderedTable {
  if (!(element instanceof HTMLTableElement)) {
    return { headers: [], rows: [] };
  }
  const headers =
    element.tHead === null
      ? []
      : Array.from(element.tHead.rows).flatMap((row) =>
          Array.from(row.cells).map((cell) => cell.innerText.replace(/\s+/g, ' ').trim()),
        );
  const body = element.tBodies.length > 0 ? element.tBodies[0] : null;
  const rows =
    body === null
      ? []
      : Array.from(body.rows).map((row) => ({
          className: row.className,
          cells: Array.from(row.cells).map((cell) => cell.innerText.replace(/\s+/g, ' ').trim()),
        }));
  return { headers, rows };
}

/** Types a date into one of the legacy screen's date fields the way a user does, and verifies what the field holds afterwards (AAP 0.3.4, Rule 1 clause 2). */
async function setLegacyDate(input: Locator, date: Date): Promise<void> {
  const rendered = formatFineractDate(date).date;
  const field = input.first();
  await field.click();
  await field.fill(rendered);
  await field.press('Escape');
  await field.blur();
  if ((await field.inputValue()) === rendered) return;
  await field.evaluate((element: HTMLElement, value: string): void => {
    if (!(element instanceof HTMLInputElement)) return;
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();
  }, rendered);
  const settled = await field.inputValue();
  if (settled === rendered) return;
  const name = (await field.getAttribute('id')) ?? 'the date field';
  throw new Error(
    `The datepicker on #${name} holds "${settled}" after "${rendered}" was entered. ` +
      'Confirm how the legacy datepicker formats its field when the legacy app runs.',
  );
}

/** Turns a visible field label into the name the field carries as an attribute: "Transaction amount" becomes "transactionAmount", "Note" becomes "note". */
function camelCaseLabel(label: string): string {
  return label
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word, index) =>
      index === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join('');
}

/** The index of the first header satisfying `matches`, or `-1` when there is none. */
function headerIndex(headers: readonly string[], matches: (header: string) => boolean): number {
  return headers.findIndex((header) => matches(header.toLowerCase()));
}

/** Where a transaction row's values sit, read from the rendered header labels. */
function resolveTransactionColumns(headers: readonly string[]): TransactionColumns {
  const id = headerIndex(headers, (header) => header === 'id');
  const date = headerIndex(headers, (header) => header.includes('date'));
  const type = headerIndex(headers, (header) => header.includes('type'));
  const debit = headerIndex(headers, (header) => header.includes('debit'));
  const credit = headerIndex(headers, (header) => header.includes('credit'));
  const balance = headerIndex(headers, (header) => header.includes('balance'));
  return {
    id: id >= 0 ? id : LEGACY_TRANSACTION_COLUMNS.id,
    date: date >= 0 ? date : LEGACY_TRANSACTION_COLUMNS.date,
    type: type >= 0 ? type : LEGACY_TRANSACTION_COLUMNS.type,
    debit: debit >= 0 ? debit : LEGACY_TRANSACTION_COLUMNS.debit,
    credit: credit >= 0 ? credit : LEGACY_TRANSACTION_COLUMNS.credit,
    balance: balance >= 0 ? balance : LEGACY_TRANSACTION_COLUMNS.balance,
  };
}

/** Splits the reversal marker the transactions table appends to a transaction type. */
function splitReversalMarker(type: string): { type: string; reversed: string } {
  const marker = /\(([^)]+)\)\s*$/.exec(type);
  if (marker === null) return { type, reversed: '' };
  return { type: type.slice(0, marker.index).trim(), reversed: marker[0].trim() };
}

/** One cell's rendered text, `''` when the row is shorter than the column map expects. */
function cellAt(row: RenderedRow, index: number): string {
  return row.cells[index] ?? '';
}

/** Builds one reported transaction row from the rendered table row and the column map. */
function toTransactionRow(row: RenderedRow, columns: TransactionColumns): SavingsTransactionRow {
  const split = splitReversalMarker(cellAt(row, columns.type));
  const debit = cellAt(row, columns.debit);
  const credit = cellAt(row, columns.credit);
  // Legacy splits the amount across the Debit and Credit columns and hides the one that does not apply (`ng-show` in view_saving_account_details.html), so the rendered column is the amount.
  return {
    id: cellAt(row, columns.id),
    date: cellAt(row, columns.date),
    type: split.type,
    amount: debit !== '' ? debit : credit,
    balance: cellAt(row, columns.balance),
    // A reversal entry carries the `(R)` marker; a reversed original is struck through with the `strike-grey` row class instead.
    reversed: split.reversed !== '' ? split.reversed : row.className.includes('strike-grey') ? 'strike-grey' : '',
  };
}

/** The savings screens of the unchanged AngularJS application, driven the way a user drives them. */
export class SavingsPage {
  private readonly page: Page;

  /** @param page The Playwright page the spec has already logged in on; this class never authenticates or reads a credential (Rule 1 clause 9). */
  constructor(page: Page) {
    this.page = page;
  }

  /** Chooses the savings product and waits for the fields that depend on it (AAP 0.7.3, AAP 0.10.1). */
  async selectProduct(name: string): Promise<void> {
    await chooseOption(this.page, this.page.locator(PRODUCT_SELECT), name);
    const submittedOn = this.page.locator(SUBMITTED_ON_DATE_INPUT).first();
    await submittedOn.waitFor({ state: 'visible' });
    await this.page.waitForFunction((selector: string): boolean => {
      const field = document.querySelector(selector);
      if (field === null) return false;
      let disabled = false;
      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLSelectElement ||
        field instanceof HTMLTextAreaElement
      ) {
        disabled = field.disabled;
      }
      return !disabled;
    }, SUBMITTED_ON_DATE_INPUT);
  }

  /** Submits the application, walking the wizard's own steps on the way (AAP 0.7.3, AAP 0.10.5). */
  async submitApplication(date?: Date): Promise<void> {
    if (date !== undefined) {
      await setLegacyDate(this.page.locator(SUBMITTED_ON_DATE_INPUT), date);
    }
    await this.submitForm();
  }

  /** Opens the savings record. Serves the view step of W8 over `#/viewsavingaccount/:id` (AAP 0.8.2, `GET /savingsaccounts/{id}?associations=all`). */
  async openView(savingsId: number): Promise<void> {
    await this.gotoHash(`#/viewsavingaccount/${savingsId}`, this.page.locator(RECORD_HEADER));
    await this.waitForRecordStatus();
  }

  /** Reads the record's status token and summary label/value pairs (AAP 0.10.1). */
  async readSummary(): Promise<SavingsSummary> {
    return this.page.evaluate(readSummaryInPage);
  }

  /** Reads the transactions table, one row per rendered transaction (AAP 0.10.1). */
  async readTransactions(): Promise<SavingsTransactionRow[]> {
    const table = this.page.locator(TRANSACTIONS_TABLE).first();
    if ((await table.count()) === 0) return [];
    const rendered = await table.evaluate(readTransactionsInPage);
    if (rendered.rows.length === 0) return [];
    const columns = resolveTransactionColumns(rendered.headers);
    return rendered.rows.map((row) => toTransactionRow(row, columns));
  }

  /** Opens one of the four W8 action screens and waits for its form (AAP 0.8.2). */
  async openAction(savingsId: number, action: SavingsAccountAction): Promise<void> {
    await this.gotoHash(
      `#/savingaccount/${savingsId}/${action}`,
      this.page.locator(ACTION_DATE_INPUT),
    );
    if (action === 'deposit' || action === 'withdrawal') {
      await this.waitForPaymentTypes();
    }
  }

  /** Fills the values a transaction form is to send, and only those (AAP 0.7.2, Rule 1 clause 3). */
  async fillTransaction(values: SavingsTransactionValues): Promise<void> {
    if (values.date !== undefined) {
      await setLegacyDate(this.page.locator(ACTION_DATE_INPUT), values.date);
    }
    if (values.amount !== undefined) {
      await this.fillFieldByLabel(AMOUNT_LABEL, values.amount);
    }
    if (values.paymentType !== undefined) {
      await chooseOption(this.page, this.page.locator(PAYMENT_TYPE_SELECT), values.paymentType);
    }
    if (values.note !== undefined) {
      await this.fillFieldByLabel(NOTE_LABEL, values.note);
    }
  }

  /** Submits the open action form. Finishes the approve, activate, deposit or withdrawal step of W8 (AAP 0.10.1). */
  async submitAction(): Promise<void> {
    await this.submitForm();
  }

  /** The legacy shell's entry URL, carrying the two query parameters Rule 2 requires. */
  private entryUrl(hash?: string): string {
    const query =
      `?baseApiUrl=${encodeURIComponent(FINERACT_URL)}` +
      `&tenantIdentifier=${encodeURIComponent(TENANT_ID)}`;
    return hash === undefined ? `${LEGACY_URL}/${query}` : `${LEGACY_URL}/${query}${hash}`;
  }

  /** Navigates to a hash route and waits for the destination screen's root element (Rule 2). */
  private async gotoHash(hash: string, root: Locator): Promise<void> {
    await this.page.goto(this.entryUrl(hash));
    const landed = await root
      .first()
      .waitFor({ state: 'visible', timeout: ROUTER_REACTION_TIMEOUT_MS })
      .then(
        () => true,
        () => false,
      );
    if (landed) return;
    // The router did not react to the navigation; setting the hash in the page is the second way to ask it, and the wait below is what reports the failure if that does not work either.
    await this.page.evaluate((fragment: string): void => {
      window.location.hash = fragment;
    }, hash);
    await root.first().waitFor({ state: 'visible' });
  }

  /** Advances the wizard's steps and clicks the primary submit exactly once. */
  private async submitForm(): Promise<void> {
    const primary = this.page.locator(PRIMARY_SUBMIT).first();
    for (let step = 0; step < MAX_WIZARD_STEPS; step += 1) {
      if (await primary.isVisible()) {
        await primary.click();
        return;
      }
      const forward = this.page.locator(STEP_FORWARD).first();
      if (!(await forward.isVisible()) || !(await forward.isEnabled())) break;
      const handle = await forward.elementHandle();
      if (handle === null) break;
      await handle.click();
      // Pinned to the button that was clicked: the locator would otherwise re-resolve to the next step's forward control, which is visible again once the wizard has moved on.
      await handle.waitForElementState('hidden');
    }
    throw new Error(
      `The savings form on ${this.page.url()} offered no primary submit (${PRIMARY_SUBMIT}) within ` +
        `${MAX_WIZARD_STEPS} wizard steps.`,
    );
  }

  /** Types a value into the text field a visible label names. Resolution order, first hit wins: the field inside the `.form-group` whose label carries the label text, then a field whose placeholder is the label, then the. */
  private async fillFieldByLabel(label: string, value: string): Promise<void> {
    const fieldName = camelCaseLabel(label);
    const candidates: Locator[] = [
      this.page.locator('.form-group').filter({ hasText: label }).locator('.form-control'),
      this.page.locator(`.form-control[placeholder=${JSON.stringify(label)}]`),
      this.page.locator(
        `.form-control[id=${JSON.stringify(fieldName)}], ` +
          `.form-control[name=${JSON.stringify(fieldName)}], ` +
          `.form-control[formControlName=${JSON.stringify(fieldName)}]`,
      ),
    ];
    for (const candidate of candidates) {
      const field = candidate.filter({ visible: true }).first();
      if ((await field.count()) === 0) continue;
      await field.fill(value);
      return;
    }
    throw new Error(
      `No visible field for "${label}" on ${this.page.url()}: tried its label, its placeholder and ` +
        `the "${fieldName}" field name.`,
    );
  }

  /** Waits until the record header carries a status token. The legacy template renders the header glyph from the account payload, so a glyph with a status class is the screen's signal that the record — its summary, its. */
  private async waitForRecordStatus(): Promise<void> {
    await this.page.waitForFunction((selector: string): boolean => {
      const icons = Array.from(document.querySelectorAll(selector));
      return icons.some((icon) => Array.from(icon.classList).some((name) => name.startsWith('status')));
    }, RECORD_STATUS_ICON);
  }

  /** Waits until the payment-type dropdown holds the options Fineract's transaction template returns (AAP 0.7.3). */
  private async waitForPaymentTypes(): Promise<void> {
    await this.page.waitForFunction((selector: string): boolean => {
      const select = document.querySelector(selector);
      return select instanceof HTMLSelectElement && select.options.length > 1;
    }, PAYMENT_TYPE_SELECT);
  }
}
