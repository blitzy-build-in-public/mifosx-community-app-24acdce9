/**
 * Legacy-only page object for the savings screens of the unchanged AngularJS application: the
 * baseline of workflow W8, which is in scope because Stretch ships (AAP 0.9.3, 0.10.1).
 *
 * The three hash routes it drives mirror `app/scripts/routes.js` and AAP 0.8.2 exactly:
 *
 * - `#/new_client_saving_application/:clientId` - app/views/savings/new_saving_account_application.html
 * - `#/viewsavingaccount/:id`                   - app/views/savings/view_saving_account_details.html
 * - `#/savingaccount/:id/:action`               - app/views/savings/saving_account_actions.html
 *
 * Every navigation composes
 * `${LEGACY_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}&tenantIdentifier=${encodeURIComponent(TENANT_ID)}`
 * (Rule 2). Without both query parameters the legacy app ignores the configured backend and falls
 * back to a public demo host the rules forbid, so the parameters are composed for every `open*()`
 * call rather than inherited from whatever the previous screen navigated to.
 *
 * The spec drives the fixed data of AAP 0.10.1 against the `Parity Savings` product: submit,
 * approve, activate, deposit 1,000, withdraw 200, after which the record shows a balance of 800.
 * This class drives the screen and reads what it renders; every assertion lives in
 * `web-ng/e2e/specs/`, and nothing here calls the Fineract API — the template and transaction
 * requests the screens make are observed by `web-ng/e2e/capture/network-capture.ts`.
 *
 * Provenance: the legacy source tree is a read-only reference outside this checkout
 * (`/root/community-app` at 45ec7b82e9b14424a53ce9e8a847811f37f431bd, the commit `LEGACY_COMMIT`
 * names), so each selector below names the template or controller it was read from and carries a
 * "confirm when the legacy app runs" note for the facts only a live page can settle.
 */
import type { Locator, Page } from '@playwright/test';

import { FINERACT_URL, LEGACY_URL, TENANT_ID, formatFineractDate } from '../../seed/fixtures';
import { chooseOption } from './chosen';

/**
 * What the application screen lets a caller choose. Both members are optional so a caller states
 * only the values it means to set: an absent date leaves the date the template pre-filled, which is
 * the legacy behaviour (AAP 0.10.5 item 15 — the default comes from the browser clock).
 */
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

/**
 * The savings record's status and summary, as the page renders them.
 *
 * `statusClass` is the legacy status token (`statusactive`, `statuspending`, ...) read from the
 * header glyph's class list and never from text: the record screen shows a colour only, and adding
 * a textual status would be an improvement the migration forbids (AAP 0.10.5 item 11).
 */
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

/**
 * What a caller supplies to a deposit or withdrawal form. Every member is optional because the
 * legacy form pre-fills what Fineract's transaction template returns, and a caller may keep those
 * defaults; nothing here formats, rounds or bounds a value (Rule 1 clause 3).
 */
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

/**
 * The savings commands the `#/savingaccount/:id/:action` route serves for workflow W8.
 *
 * Exactly the four the plan fixes. Any other string fails to compile, so a spec cannot drive an
 * action this page object does not know the screen of.
 */
export type SavingsAccountAction = 'approve' | 'activate' | 'deposit' | 'withdrawal';

/**
 * Product `<select>` of the application screen.
 *
 * Source: new_saving_account_application.html, `<select id="productId" ...>`. It carries no
 * `chosen` attribute, so it is a native select, and `chooseOption` handles both cases. Confirm when
 * the legacy app runs.
 */
const PRODUCT_SELECT = '[id="productId"]';

/**
 * Submitted-on date field of the application screen.
 *
 * Source: new_saving_account_application.html, `<input id="submittedOnDate" datepicker-pop="dd MMMM
 * yyyy" ng-show="formData.productId">`. It appears only once a product is chosen, which is why
 * `selectProduct()` waits for it. Confirm when the legacy app runs.
 */
const SUBMITTED_ON_DATE_INPUT = '[id="submittedOnDate"]';

/**
 * The record header's status glyph, whose class list carries the legacy status token.
 *
 * Source: view_saving_account_details.html, `<i class="fa fa-stop {{...status.code |
 * StatusLookup}}">` inside `.gray-head`; the tokens come from app/scripts/filters/StatusLookup.js
 * (`statusactive`, `statuspending`, `statusApproved`, `statusmatured`, ...). The header renders one
 * glyph per status expression and hides the other, so the reader keeps only the visible one. Confirm
 * when the legacy app runs.
 */
const RECORD_STATUS_ICON = '.gray-head i.fa-stop';

/**
 * The record header itself.
 *
 * Source: view_saving_account_details.html, `<div class="span gray-head">`. The template renders it
 * as soon as the record route is on screen, so it is the navigation's readiness signal, while the
 * glyph inside it — which gains its status class only once the account has loaded — is the
 * record's. Confirm when the legacy app runs.
 */
const RECORD_HEADER = '.gray-head';

/**
 * The record's transactions table.
 *
 * Source: view_saving_account_details.html — the transactions tab's table is the only `.table` whose
 * header cells carry the `pointer` class, because each one sorts the list through
 * `changeTransactionSort(...)`. That marker identifies the table without depending on a translated
 * heading, and it is the first (active) tab of the record's tabset. Confirm when the legacy app runs.
 */
const TRANSACTIONS_TABLE = 'table.table:has(thead th.pointer)';

/**
 * Payment-type `<select>` of the deposit and withdrawal forms.
 *
 * Source: saving_account_actions.html, `<select id="paymentTypeId" ...>`; the controller fills it
 * from `GET /savingsaccounts/{id}/transactions/template`. Confirm when the legacy app runs.
 */
const PAYMENT_TYPE_SELECT = '[id="paymentTypeId"]';

/**
 * Date field of the currently open action form.
 *
 * The action template renders `<input id="{{modelName}}" ...>`, and
 * SavingAccountActionsController.js sets `modelName` per command: `approvedOnDate` for approve,
 * `activatedOnDate` for activate, `transactionDate` for deposit and withdrawal. Exactly one of the
 * three exists on a given screen, so the union resolves to it. Confirm when the legacy app runs.
 */
const ACTION_DATE_INPUT = '[id="approvedOnDate"], [id="activatedOnDate"], [id="transactionDate"]';

/**
 * The wizard's primary submit, the button that creates or acts on the account.
 *
 * Source: both savings templates, `<button id="save" type="submit" class="btn btn-primary">`. The
 * wizard keeps every step in the DOM (`step.html` is `<div ng-show="selected">`), so `:visible`
 * selects the one the current step renders. Confirm when the legacy app runs.
 */
const PRIMARY_SUBMIT = 'button#save:visible';

/**
 * A wizard step's forward control, clicked only until the primary submit is reachable.
 *
 * Source: `<button class="btn btn-default pull-right" type="submit">Next</button>` on the Details,
 * Terms and Charges steps of new_saving_account_application.html, and the datatable steps' "Proceed"
 * buttons `#save1` / `#save4` (`btn btn-primary`) on both savings templates. Confirm when the legacy
 * app runs.
 */
const STEP_FORWARD = 'button#save1:visible, button#save4:visible, button.btn.btn-default.pull-right:visible';

/**
 * Visible label of the transaction-amount field: `label.input.transactionamount` is
 * "Transaction amount" in app/global-translations/locale-en.json.
 */
const AMOUNT_LABEL = 'Transaction amount';

/** Visible label of the note field: `label.input.note` is "Note" in the same locale file. */
const NOTE_LABEL = 'Note';

/**
 * How many wizard steps `submitForm()` may advance before it reports that it never reached the
 * primary submit. The application screen has four mandatory steps plus one per datatable plus the
 * Review step, so eight leaves room for a datatable-registered tenant without looping forever.
 */
const MAX_WIZARD_STEPS = 8;

/**
 * How long a navigation is given for the AngularJS router to render the destination's root locator
 * before the hash is set a second way. Comfortably above one template load, and far below the
 * 180-second test timeout the suite runs with.
 */
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

/**
 * Column positions of the legacy transactions table, used when a header cannot be recognised
 * (a locale whose labels are not English, for instance).
 *
 * Source: view_saving_account_details.html — Id, Transaction date, Transaction type, Debit, Credit,
 * Balance, View Receipts. Confirm when the legacy app runs.
 */
const LEGACY_TRANSACTION_COLUMNS: TransactionColumns = {
  id: 0,
  date: 1,
  type: 2,
  debit: 3,
  credit: 4,
  balance: 5,
};

/**
 * Reads the record's status token and label/value pairs from the rendered savings record.
 *
 * Serialised into the browser by `readSummary()`, so it is self-contained: it neither references
 * module scope nor declares a helper, because a transpiler that preserves function names leaves a
 * call to its own helper inside the serialised source, which the page cannot resolve. It reads
 * `innerText`, the browser's rendered-text result, which skips what the template hides with
 * `ng-show` (an unassigned field officer, for instance): a hidden wrapper's text must never be
 * reported as the field's value.
 */
function readSummaryInPage(): SavingsSummary {
  const statusClass =
    Array.from(document.querySelectorAll('.gray-head i'))
      // The header renders one glyph per status expression and hides the other with `ng-hide`, so
      // only the glyph the browser considers visible carries the account's status.
      .filter((icon) => icon.checkVisibility())
      .map((icon) => Array.from(icon.classList).find((name) => name.startsWith('status')))
      .find((token) => token !== undefined) ?? '';

  const fields: SavingsSummaryField[] = [];
  // One walk in document order over the record's table rows and its balance headings. A
  // `<th colspan="2">` row is a section heading ("Savings Details", "Performance History"), not a
  // field, and the transactions table's rows carry no `<th>`, so the same test skips them.
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('table tr, h3'))) {
    const text = element.innerText.replace(/\s+/g, ' ').trim();
    if (element instanceof HTMLHeadingElement) {
      // The balances render as `<h3>Current Balance: $ 800</h3>` rather than as table rows, so they
      // are split at the first colon to keep the same label/value shape.
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

/**
 * Reads the transactions table's header labels and body rows, cell by cell.
 *
 * Serialised into the browser by `readTransactions()`, so it is self-contained in the same way. Each
 * cell is read as `innerText`, which reports the value a reader sees and not the one the template
 * keeps hidden: the amount is rendered in both the Debit and the Credit column and only one of the
 * two is displayed. Header labels are read rather than assumed, which keeps this side comparable
 * with the new application.
 */
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

/**
 * Types a date into one of the legacy screen's date fields the way a user does, and verifies what
 * the field holds afterwards.
 *
 * The field belongs to the modified jQuery datepicker the legacy app loads from
 * app/scripts/datepicker.js through app/scripts/loader.js (AAP 0.3.4): it parses and reformats its
 * own text, so a typed value can come back rewritten. The typed text is `dd MMMM yyyy` — the format
 * every date-bearing Fineract payload carries (Rule 1 clause 2) and the format each
 * `datepicker-pop="dd MMMM yyyy"` attribute declares. Escape closes the picker the focus opened and
 * the blur lets the form settle.
 *
 * When the plugin still holds a different value, the field is set directly and told about it
 * through native `input` and `change` events, which is what `ng-model` listens for. A value that
 * still does not match is reported rather than retried, because a silently different date would
 * make the workflow's API call differ from the legacy baseline. Comment carried from the plan: the
 * picker's exact behaviour is confirmed when the legacy app runs.
 *
 * @param input Locator of the date field to fill.
 * @param date The date to enter; formatted with the UTC calendar day the harness works in.
 */
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

/**
 * Turns a visible field label into the name the field carries as an attribute: "Transaction amount"
 * becomes "transactionAmount", "Note" becomes "note".
 *
 * This bridges the convention both front ends follow — a control is named after its model — so the
 * amount and note fields can still be found when the running locale's label is not the English one
 * this file passes in.
 */
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

/**
 * Where a transaction row's values sit, read from the rendered header labels.
 *
 * A label the running locale renders differently from the legacy English one falls back to the
 * legacy column order, so a translated build reads the same cells instead of reporting empty ones.
 */
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

/**
 * Splits the reversal marker the transactions table appends to a transaction type.
 *
 * Legacy renders `{{transaction.transactionType.value}}<span ng-if="transaction.isReversal">(R)</span>`,
 * so a reversal entry's type cell reads "Deposit(R)"; the marker is reported on its own so the type
 * compares cleanly with the new application's.
 */
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
  // Legacy splits the amount across the Debit and Credit columns and hides the one that does not
  // apply (`ng-show` in view_saving_account_details.html), so the rendered column is the amount.
  return {
    id: cellAt(row, columns.id),
    date: cellAt(row, columns.date),
    type: split.type,
    amount: debit !== '' ? debit : credit,
    balance: cellAt(row, columns.balance),
    // A reversal entry carries the `(R)` marker; a reversed original is struck through with the
    // `strike-grey` row class instead. Whichever the row renders is the indicator this side reports.
    reversed: split.reversed !== '' ? split.reversed : row.className.includes('strike-grey') ? 'strike-grey' : '',
  };
}

/**
 * The savings screens of the unchanged AngularJS application, driven the way a user drives them.
 *
 * One instance serves a whole W8 run: every method navigates by hash, waits for the destination
 * screen's own root element and never asserts. It reads and types only — no `expect`, no retry of a
 * POST, and no console output (Rule 1 clauses 8 and 9).
 */
export class SavingsPage {
  private readonly page: Page;

  /**
   * @param page The Playwright page the spec has already logged in on; this class never
   * authenticates or reads a credential (Rule 1 clause 9).
   */
  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Opens the new-savings-account application for a client.
   *
   * Serves the application step of W8 over `#/new_client_saving_application/:clientId` (AAP 0.8.2),
   * whose first step is the product choice, so the product select is the screen's readiness signal.
   *
   * @param clientId Fineract client the account is opened for.
   */
  async openApplication(clientId: number): Promise<void> {
    await this.gotoHash(
      `#/new_client_saving_application/${clientId}`,
      this.page.locator(PRODUCT_SELECT),
    );
  }

  /**
   * Chooses the savings product and waits for the fields that depend on it.
   *
   * Serves the application step of W8 (AAP 0.7.3 — `GET /savingsaccounts/template?clientId=&productId=`).
   * Choosing a product makes the legacy screen re-request its template, which rewrites the term
   * defaults and reveals the submitted-on date, so the method returns only once that date is on
   * screen and usable. The dropdown is driven through `chooseOption`, which handles both the chosen
   * widget and the plain select this screen renders.
   *
   * @param name Visible label of the product, e.g. `Parity Savings` (AAP 0.10.1).
   */
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

  /**
   * Submits the application, walking the wizard's own steps on the way.
   *
   * The account-creating submit of W8 (AAP 0.7.3 — `POST /savingsaccounts`). The legacy screen is a
   * wizard whose Details, Terms, Charges and Review steps each own a submit button, so the steps are
   * advanced with the screen's own forward controls and the primary submit is clicked exactly once:
   * Fineract account creation is not idempotent, and one click must produce one POST.
   *
   * @param date Submitted-on date to type in first. Omitted, the date the template pre-filled is
   * submitted unchanged — the legacy default comes from the browser clock (AAP 0.10.5 item 15), and
   * this method never invents one of its own.
   */
  async submitApplication(date?: Date): Promise<void> {
    if (date !== undefined) {
      await setLegacyDate(this.page.locator(SUBMITTED_ON_DATE_INPUT), date);
    }
    await this.submitForm();
  }

  /**
   * Opens the savings record.
   *
   * Serves the view step of W8 over `#/viewsavingaccount/:id` (AAP 0.8.2, `GET
   * /savingsaccounts/{id}?associations=all`). The header is awaited first, then the header's status
   * glyph, which the screen fills only once the account has loaded, so a reader called next sees the
   * record rather than an empty template.
   *
   * @param savingsId Fineract savings account id, e.g. the id the seed recorded for the new account.
   */
  async openView(savingsId: number): Promise<void> {
    await this.gotoHash(`#/viewsavingaccount/${savingsId}`, this.page.locator(RECORD_HEADER));
    await this.waitForRecordStatus();
  }

  /**
   * Reads the record's status token and summary label/value pairs.
   *
   * Serves the comparison of W8's end state (AAP 0.10.1): the balance, deposits and withdrawals the
   * screen shows are what the report measures against 800, 1,000 and 200 once the deposit and the
   * withdrawal have been made. Values are exactly as the screen renders them, grouping and decimals
   * included, and a field with no value reports `''`.
   */
  async readSummary(): Promise<SavingsSummary> {
    return this.page.evaluate(readSummaryInPage);
  }

  /**
   * Reads the transactions table, one row per rendered transaction.
   *
   * Serves the transaction half of W8's verdict (AAP 0.10.1): after the 1,000 deposit and the 200
   * withdrawal the table must carry both rows and the running balance. Columns are resolved from
   * the rendered header labels rather than fixed positions, and an account with no transactions
   * reports an empty list rather than an error.
   */
  async readTransactions(): Promise<SavingsTransactionRow[]> {
    const table = this.page.locator(TRANSACTIONS_TABLE).first();
    if ((await table.count()) === 0) return [];
    const rendered = await table.evaluate(readTransactionsInPage);
    if (rendered.rows.length === 0) return [];
    const columns = resolveTransactionColumns(rendered.headers);
    return rendered.rows.map((row) => toTransactionRow(row, columns));
  }

  /**
   * Opens one of the four W8 action screens and waits for its form.
   *
   * Serves the lifecycle steps of W8 over `#/savingaccount/:id/:action` (AAP 0.8.2): approve and
   * activate post to `POST /savingsaccounts/{id}?command=approve|activate`, deposit and withdrawal
   * to `POST /savingsaccounts/{id}/transactions?command=deposit|withdrawal`. Each command renders
   * its own date field, so that field is the readiness signal; the deposit and withdrawal screens
   * additionally wait for the payment types Fineract's transaction template returns, which are what
   * the transaction body's `paymentTypeId` comes from.
   *
   * @param savingsId Fineract savings account id the action applies to.
   * @param action One of the four commands the union allows; any other value fails to compile.
   */
  async openAction(savingsId: number, action: SavingsAccountAction): Promise<void> {
    await this.gotoHash(
      `#/savingaccount/${savingsId}/${action}`,
      this.page.locator(ACTION_DATE_INPUT),
    );
    if (action === 'deposit' || action === 'withdrawal') {
      await this.waitForPaymentTypes();
    }
  }

  /**
   * Fills the values a transaction form is to send, and only those.
   *
   * Serves the deposit and withdrawal steps of W8 (AAP 0.7.2 `SavingsActionRequest`: `transactionDate`,
   * `transactionAmount`, `paymentTypeId`) and the dated approve and activate steps (`approvedOnDate`,
   * `activatedOnDate`). Nothing is formatted, rounded or bounded — the amount is typed exactly as the
   * caller supplies it, because a different value here would be a different API call (Rule 1 clause 3).
   *
   * A note supplied for `activate` raises: the legacy controller leaves `showNoteField` off for that
   * command, so there is no field to type it into, and accepting it silently would let the two UIs
   * post different bodies.
   *
   * @param values The values to enter; anything omitted keeps the value the template pre-filled.
   */
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

  /**
   * Submits the open action form.
   *
   * Finishes the approve, activate, deposit or withdrawal step of W8 (AAP 0.10.1). Deposit and
   * withdrawal are not idempotent, so the primary submit is clicked once and never retried; the
   * assertions about the resulting state belong to the spec, which reads them back through
   * {@link readSummary} and {@link readTransactions}.
   */
  async submitAction(): Promise<void> {
    await this.submitForm();
  }

  /**
   * The legacy shell's entry URL, carrying the two query parameters Rule 2 requires.
   *
   * Legacy resolves its API host from `baseApiUrl` and its tenant from `tenantIdentifier`
   * (app/scripts/initialTasks.js:33-44) and falls back to a public demo host when neither is given,
   * so every navigation this page object makes passes both.
   *
   * @param hash Hash route to land on, e.g. `#/viewsavingaccount/7`; omitted, the shell entry alone.
   */
  private entryUrl(hash?: string): string {
    const query =
      `?baseApiUrl=${encodeURIComponent(FINERACT_URL)}` +
      `&tenantIdentifier=${encodeURIComponent(TENANT_ID)}`;
    return hash === undefined ? `${LEGACY_URL}/${query}` : `${LEGACY_URL}/${query}${hash}`;
  }

  /**
   * Navigates to a hash route and waits for the destination screen's root element.
   *
   * The full entry URL is composed for every navigation rather than a fragment-only one: a fragment
   * resolved against a base address would drop the two query parameters and send the legacy app back
   * to a demo host (Rule 2). When the current document already is the legacy shell, a navigation that
   * differs only in its fragment is a same-document one, so the AngularJS router handles it without a
   * reload.
   *
   * @param hash Hash route to open.
   * @param root Locator of the destination screen's root element, awaited until visible.
   */
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
    // The router did not react to the navigation; setting the hash in the page is the second way to
    // ask it, and the wait below is what reports the failure if that does not work either.
    await this.page.evaluate((fragment: string): void => {
      window.location.hash = fragment;
    }, hash);
    await root.first().waitFor({ state: 'visible' });
  }

  /**
   * Advances the wizard's steps and clicks the primary submit exactly once.
   *
   * Both savings templates are angular-wizard screens (app/scripts/modules/angular-wizard.js, whose
   * `step.html` hides every step but the selected one with `ng-show`), so the button that creates or
   * acts on the account is rendered but hidden until its step is reached. On a single-step form —
   * every action screen — the primary submit is already visible and this method is one click. On the
   * application screen the forward controls are clicked until the submit appears, each click being
   * followed by a wait for that step to be replaced, so no step is ever submitted twice.
   */
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
      // Pinned to the button that was clicked: the locator would otherwise re-resolve to the next
      // step's forward control, which is visible again once the wizard has moved on.
      await handle.waitForElementState('hidden');
    }
    throw new Error(
      `The savings form on ${this.page.url()} offered no primary submit (${PRIMARY_SUBMIT}) within ` +
        `${MAX_WIZARD_STEPS} wizard steps.`,
    );
  }

  /**
   * Types a value into the text field a visible label names.
   *
   * Resolution order, first hit wins: the field inside the `.form-group` whose label carries the
   * label text, then a field whose placeholder is the label, then the field named after the label
   * ({@link camelCaseLabel}), which is how both front ends name a control after its model. Only a
   * visible field is filled, so a template that keeps a hidden copy of the form — the wizard does —
   * cannot be typed into by mistake.
   *
   * @param label Visible label text, e.g. `Transaction amount`.
   * @param value Value to type, exactly as given.
   */
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

  /**
   * Waits until the record header carries a status token.
   *
   * The legacy template renders the header glyph from the account payload, so a glyph with a status
   * class is the screen's signal that the record — its summary, its transactions and its balance —
   * has been filled in.
   */
  private async waitForRecordStatus(): Promise<void> {
    await this.page.waitForFunction((selector: string): boolean => {
      const icons = Array.from(document.querySelectorAll(selector));
      return icons.some((icon) => Array.from(icon.classList).some((name) => name.startsWith('status')));
    }, RECORD_STATUS_ICON);
  }

  /**
   * Waits until the payment-type dropdown holds the options Fineract's transaction template returns.
   *
   * AAP 0.7.3: the deposit and withdrawal screens fill `#paymentTypeId` from `GET
   * /savingsaccounts/{id}/transactions/template`, so choosing a payment type before that request
   * answers would find only the placeholder option.
   */
  private async waitForPaymentTypes(): Promise<void> {
    await this.page.waitForFunction((selector: string): boolean => {
      const select = document.querySelector(selector);
      return select instanceof HTMLSelectElement && select.options.length > 1;
    }, PAYMENT_TYPE_SELECT);
  }
}
