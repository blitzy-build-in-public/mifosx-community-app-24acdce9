/**
 * Page object for the new Angular application's savings screens — the `next` project's side of
 * Stretch workflow W8: open a savings account, approve it, activate it, deposit 1,000, withdraw 200
 * and read the account back (AAP 0.9.1 scope group 4, AAP 0.9.3, AAP 0.10.1 W8 row). The workflow
 * is in scope because Stretch ships, so W8 appears in the parity report.
 *
 * **Three routes, the same hash paths the legacy app uses** (`tools/parity/in-scope-routes.json`,
 * AAP 0.8.2):
 *
 * - `/new_client_saving_application/:clientId` — `SavingsNewComponent`, root `app-savings-new`
 * - `/viewsavingaccount/:id`                   — `SavingsViewComponent`, root `app-savings-view`
 * - `/savingaccount/:id/:action`               — `SavingsActionComponent`, root `app-savings-action`
 *
 * **Entry URL (Rule 2, AAP 0.4.4 decision 5).** Every navigation composes
 * `${NEXT_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}&tenantIdentifier=${TENANT_ID}#<route>`.
 * The application resolves its backend once, before the first navigation, from `assets/config.json`,
 * then the container's `API_BASE_URL`/`TENANT_ID`, then these two query parameters, which win. That
 * precedence is what lets one bundle address the local stack and a forwarded Codespaces host with no
 * code difference (AAP 0.10.3), and it is why no host literal appears in this file: `NEXT_URL` and
 * `FINERACT_URL` are the only origins and both come from `seed/fixtures.ts`.
 *
 * **The route segment is not the wire command.** The account's withdrawal screen is reached at
 * `#/savingaccount/:id/withdraw`, while the command the application sends with the transactions
 * endpoint is `withdrawal` (AAP 0.7.3 W8 row). This object navigates the `withdraw` segment verbatim
 * and never sends, rewrites or normalises a command: the segment-to-command table lives in
 * `features/savings/savings-actions/savings-action.component.ts`, and a page object that second-guessed
 * it could drive one route while reporting another. The same asymmetry is why nothing here is named
 * after a command.
 *
 * **The submitted-on date has no method of its own**, because the fixed contract of this class has
 * none: a caller sets it through the markup the screen ships. `app-savings-new` renders the shared
 * date field, whose native control is `app-savings-new input[type="date"]` inside the `.form-group`
 * whose `.control-label` names the submission — the shipped id is `savings-submitted-on`, so
 * `app-savings-new .form-group:has(> label:text-matches("submitted", "i")) input[type="date"]` and
 * `app-savings-new #savings-submitted-on` both resolve it. It is filled with a `yyyy-mm-dd` string,
 * which is what `formatDateOnly(readBusinessDate())` in `seed/fixtures.ts` renders, and it is filled
 * before {@link SavingsPage.submitApplication} is clicked. The application itself defaults that date
 * from the browser clock exactly as the legacy form does (AAP 0.10.5 item 15), so the harness always
 * supplies the tenant business date rather than inheriting the default (Rule 1 clause 2).
 *
 * **No date is computed here.** This file holds no clock read of any kind: every date it types is the
 * caller's own `yyyy-mm-dd` string, derived from the tenant business date over the API by
 * `seed/fixtures.ts`, so the run date cannot drift from the backend's (Rule 1 clause 2, AAP 0.10.1
 * "Run date").
 *
 * **What it does and does not do.** It drives the three screens and reads what they render: locators
 * and typed readers only, no assertion of any kind, because every judgement belongs to the specs under
 * `web-ng/e2e/specs/` (Rule 1 clause 8). It issues no HTTP request of its own, names no endpoint, and
 * sends no command — the screens' own typed service owns every path and the interceptor attaches the
 * auth and tenant headers (Rule 1 clause 2 and 5, Rule 2). Amounts, balances and dates are returned
 * exactly as the screen renders them, plus one documented numeric parse, so normalisation stays with
 * the network capture and the parity report (AAP 0.10.2); nothing is rounded, clamped or bounded
 * (Rule 1 clause 3).
 *
 * **Locators.** Taken from the three templates above and from the two shared field components
 * (`shared/date-field`, `shared/select-field`) they render. Every visible caption is translated at run
 * time from the legacy locale bundles (AAP 0.7.1 i18n row), so every text match is a case-insensitive
 * pattern with a structural fallback — an `id`, a Bootstrap 3 class or the element's own type. Both
 * shared fields render native controls (AAP 0.10.5 items 1 and 2), which is what makes a plain
 * `fill` and `selectOption` enough here.
 */
import type { Locator, Page } from '@playwright/test';

import { FINERACT_URL, NEXT_URL, TENANT_ID } from '../../seed/fixtures.js';

/**
 * One label/value row of a record as the page renders it, used for the savings summary table whose
 * rows are a `<th scope="row">` key and a `<td>` value.
 *
 * The legacy sibling `web-ng/e2e/pages/legacy/savings.page.ts` declares the same label/value pair for
 * the record it reads, so a spec compares the two records' rows without mapping either side's type.
 * The workflow methods themselves differ per side — the baseline drives a jQuery-era widget and its
 * own action vocabulary — and bridging them is the parity fixture's job, not this interface's.
 */
export interface LabelValue {
  /** The row's label text, trimmed. */
  readonly label: string;
  /** The row's rendered value, trimmed; `''` when the row renders no value. */
  readonly value: string;
}

/**
 * The savings record's status indicator and summary rows, as the page renders them.
 *
 * `statusClass` is the colour class of the status swatch and never a word: the record shows a colour
 * only, and adding a textual status would be an improvement the migration forbids (AAP 0.10.5 item 11,
 * Rule 1 clause 3). The swatch carries no text, so the status row of {@link SavingsSummaryView.fields}
 * reports an empty value.
 */
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

/**
 * What the application screen lets a caller choose. Every member is optional so a caller states only
 * the values it means to set: an omitted date leaves the one the screen pre-filled from the browser
 * clock, which is the legacy default (AAP 0.10.5 item 15).
 *
 * The contract of {@link SavingsPage} has no method that takes this shape, so it documents rather than
 * passes the values: the product is selected through {@link SavingsPage.selectProduct} by its visible
 * label, and the submitted-on date is typed into the markup the class doc names. `fieldOfficerId` is
 * modelled for completeness of the record and is not rendered — the creation body AAP 0.7.2 fixes
 * carries no officer member, and AAP 0.10.5 item 5 keeps staff assignment out of scope.
 */
export interface SavingsApplicationValues {
  /** The product to open the account on, by id, when a caller drives the select by value. */
  readonly productId?: number | string;
  /** `yyyy-mm-dd`, always supplied by the caller from the run date — never computed here. */
  readonly submittedOnDate?: string;
  /** Field officer to attach to the account; not rendered by this screen (AAP 0.10.5 item 5). */
  readonly fieldOfficerId?: number | string;
}

/**
 * What a caller supplies to an action form. Every member is optional because each screen pre-fills
 * what it can from the template, and a caller may keep those defaults; nothing here is formatted,
 * rounded or bounded (Rule 1 clause 3).
 */
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

/**
 * The four `:action` segments the `#/savingaccount/:id/:action` route serves for workflow W8
 * (AAP 0.8.2, AAP 0.9.1 scope group 4). Exactly these four: a segment this object does not know the
 * screen of is rejected by {@link SavingsPage.openAction} rather than navigated to.
 */
export type SavingsAction = 'approve' | 'activate' | 'deposit' | 'withdraw';

/** Root element of the savings application screen, `SavingsNewComponent`. */
const APPLICATION_ROOT = 'app-savings-new';

/** Root element of the savings record, `SavingsViewComponent`. */
const VIEW_ROOT = 'app-savings-view';

/** Root element of the single-purpose action screen, `SavingsActionComponent`. */
const ACTION_ROOT = 'app-savings-action';

/**
 * The action segments accepted at run time, in the order the record offers them. The union type is
 * the compile-time guard; this list is the run-time one, for a caller that reaches the class through
 * plain JavaScript.
 */
const SAVINGS_ACTIONS: readonly string[] = ['approve', 'activate', 'deposit', 'withdraw'];

/** `yyyy-mm-dd`, the only form a native date control accepts and the form this object requires. */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Ceiling for a screen's root element to paint after a navigation has been requested. */
const SCREEN_TIMEOUT_MS = 30_000;

/**
 * Ceiling for a template-driven option list to arrive. The product options come from the savings
 * template the screen requests on entry, so the list is empty for a moment after the form paints.
 */
const TEMPLATE_TIMEOUT_MS = 30_000;

/**
 * How long one attempt to read a template-driven option list waits before the next, when a selection
 * has to be matched on the option's logical value rather than on its DOM value.
 */
const OPTION_POLL_INTERVAL_MS = 100;

/**
 * One `<option>` of a native select, as the page renders it. Internal to this module.
 *
 * `value` is the option's *logical* value, not its DOM `value` attribute: a select bound through
 * `[ngValue]` stores each option under `${position}: ${ngValue}` — the sample screen's product select
 * renders `0: null`, `1: 1`, `6: 6` — so matching a caller's id against the DOM attribute would find
 * nothing. `index` is the option's own position, which is what the selection is made by.
 */
interface RenderedOption {
  /** The option's position in the select, from zero. */
  readonly index: number;
  /** The value the application bound, with Angular's `${position}: ` prefix removed. */
  readonly value: string;
  /** The option's visible text, trimmed — what a caller matches by label. */
  readonly label: string;
}

/**
 * Renders an argument a caller passed, for an error message. A string is quoted so a value that is
 * blank, or that carries a separator, is visible in the message. Internal to this module.
 *
 * @param value The argument as it arrived.
 */
function describeArgument(value: number | string): string {
  return typeof value === 'number' ? String(value) : JSON.stringify(value);
}

/**
 * Renders the options a select offers — each one's label with the id it carries — so an error
 * message about a label or an id that is missing names what the screen does offer. Internal to this
 * module.
 *
 * @param options The options the select rendered.
 */
function describeOptions(options: readonly RenderedOption[]): string {
  if (options.length === 0) {
    return 'no options at all';
  }
  return options.map((option) => `"${option.label}" (id ${option.value.length > 0 ? option.value : 'none'})`).join(', ');
}

/**
 * Renders a route argument as the single segment a hash route may carry, and rejects what could not
 * be one. Internal to this module.
 *
 * A guard, never an assertion: it protects the caller from driving a route it did not name — an
 * empty id, a non-finite number, or a value carrying `/`, `?` or `#`, each of which would address a
 * different route than the one asked for. Nothing about the application or its behaviour is checked.
 *
 * @param value Client or account id the caller supplied.
 * @param role What the value names, used in the error message.
 * @returns The segment text.
 * @throws When the value is empty, is not a finite number, or carries a route separator.
 */
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

/**
 * Narrows an action to the four segments this object serves. Internal to this module.
 *
 * The union already guarantees this at compile time; the check is the run-time half of the same
 * guard, so a caller reaching the class from plain JavaScript cannot navigate to a segment whose
 * screen this object does not know.
 *
 * @param action The action a caller supplied.
 * @returns The same action, narrowed.
 * @throws When the action is not one of the four segments.
 */
function requireActionSegment(action: SavingsAction): SavingsAction {
  if (!SAVINGS_ACTIONS.includes(action)) {
    throw new Error(
      `the savings action must be one of ${SAVINGS_ACTIONS.join(', ')}; received ${describeArgument(action)}`,
    );
  }
  return action;
}

/**
 * Renders a date argument as the `yyyy-mm-dd` a native date control accepts, and rejects anything
 * else. Internal to this module.
 *
 * This checks the caller's own input, never the application: the object may not compute, shift or
 * reformat a date, because every date the harness types must be the run date derived from the tenant
 * business date (Rule 1 clause 2, AAP 0.10.1). A value in another form would be silently dropped by
 * the control and would post the date the screen pre-filled, so it fails here instead.
 *
 * @param value Date text the caller supplied.
 * @param field What the value is for, used in the error message.
 * @returns The date text, trimmed.
 * @throws When the value is not `yyyy-mm-dd`.
 */
function requireDateValue(value: string, field: string): string {
  const text = String(value).trim();
  if (!DATE_ONLY_PATTERN.test(text)) {
    throw new Error(
      `${field} takes a date as yyyy-mm-dd, from the run date read over the API; received ${describeArgument(value)}`,
    );
  }
  return text;
}

/**
 * Parses a rendered amount or balance into a number, keeping every digit the screen printed.
 * Internal to this module.
 *
 * The parse rule: everything that is not a digit, a `.` or a `-` is dropped — thousands separators,
 * ordinary and non-breaking spaces, and any currency or sign glyph — and what remains is read as a
 * number. A cell with no digit at all answers `null` rather than `0`, because `Number('')` is `0` and
 * a figure the screen never printed would otherwise compare equal to a real zero balance. The raw
 * cell text stays available in {@link SavingsTransactionRow.cells}, so a spec can compare text when a
 * locale groups or rounds a figure differently; normalisation belongs to the capture and the report
 * (AAP 0.10.2), not to this reader.
 *
 * @param text A cell as the screen rendered it.
 * @returns The value, or `null` when the cell carries no figure.
 */
function toAmount(text: string): number | null {
  const stripped = text.replace(/[^0-9.-]/g, '');
  if (!/[0-9]/.test(stripped)) {
    return null;
  }
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Runs inside the page: every `<option>` of a select as `{ value, label }`, both trimmed, in document
 * order. A locator that resolved to something other than a `<select>` yields an empty list rather
 * than a dump of some other control.
 *
 * Self-contained on purpose: Playwright serialises this function's source and evaluates it in the
 * page, where no module-scope binding of this file exists.
 *
 * @param element The element the locator resolved to.
 */
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

/**
 * Runs inside the page: the record's status colour class and its summary label/value rows.
 *
 * The status is read from the class list of the swatch element and never from text, because the
 * record paints a colour with no word beside it (AAP 0.10.5 item 11). The rows are the summary
 * panel's `<th scope="row">` / `<td>` pairs, in document order; when that panel is absent the whole
 * root is scanned for the same shape, so a record whose panel class differs still reports its fields
 * rather than nothing. A row whose value cell renders no text — the status row, whose cell holds the
 * swatch — reports an empty string.
 *
 * Self-contained on purpose: see {@link readSelectOptions}.
 *
 * @param root The `app-savings-view` element.
 */
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

/**
 * Runs inside the page: every row of the record's transactions table as its trimmed cell texts.
 *
 * An account with no transactions renders the explicit empty state and no table (AAP 0.7.4), so a
 * visible empty state and an absent table both answer an empty list rather than raising.
 *
 * Self-contained on purpose: see {@link readSelectOptions}.
 *
 * @param root The `app-savings-view` element.
 */
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


/**
 * Drives the new Angular application's savings screens and reads what they render: the `next` side of
 * workflow W8 (AAP 0.10.1). One instance per Playwright page, constructed with the page the spec has
 * already authenticated on — this class never logs in, never reads a credential and never touches
 * `localStorage` (Rule 1 clause 9).
 *
 * A caller walks W8 in the order the screens allow, and every step is one public method:
 *
 * 1. {@link openApplication} on the client the account is opened for, {@link selectProduct} by the
 *    product's visible label, the submitted-on date typed into the markup the class doc names, then
 *    {@link submitApplication} — which lands on `#/viewsavingaccount/{id}`, the id the record's URL
 *    carries.
 * 2. {@link openAction} with `approve`, then {@link fillTransaction} and {@link submitAction}; the
 *    same pair with `activate`; the same pair with `deposit` and 1,000; the same pair with `withdraw`
 *    and 200. Each successful submit returns the router to `#/viewsavingaccount/{id}`, so this object
 *    waits for nothing there: it returns `void` and the spec re-reads the record.
 * 3. {@link openView}, {@link readSummary} and {@link readTransactions} for the verdict.
 *
 * Which lifecycle step is legal at any moment is Fineract's decision, not this object's: no step is
 * reordered, gated or skipped here, and a step the server refuses leaves Fineract's own message in the
 * screen for the spec to compare (Rule 1 clause 3).
 */
export class SavingsPage {
  /**
   * @param page The Playwright page the spec has already authenticated on.
   */
  constructor(private readonly page: Page) {}

  /**
   * Opens the savings application screen for a client.
   *
   * Serves the first step of W8 over `#/new_client_saving_application/:clientId` (AAP 0.8.2). The
   * screen's root is awaited, which is the readiness signal for the card; the product options it
   * requests arrive a moment later and {@link selectProduct} waits for them.
   *
   * @param clientId Fineract client the account is opened for — the id the client record's own action
   * carries.
   * @throws When the id is empty or would address more than one route segment.
   */
  async openApplication(clientId: number | string): Promise<void> {
    const id = requireRouteId(clientId, 'the client id');
    await this.navigate(`/new_client_saving_application/${id}`);
    await this.awaitRoot(APPLICATION_ROOT, 'the savings application screen');
  }

  /**
   * Chooses the savings product by its visible label, case-insensitively.
   *
   * The product decides which template the account is opened on, so the option is matched and the
   * miss is reported rather than tolerated: a caller that proceeds on the wrong product would post a
   * different body than W8 states. The control is the native `<select>` the shared select field
   * renders — the Angular-native replacement for the legacy plugin (AAP 0.10.5 item 2) — resolved by
   * id first and by its label second, and picked by the option's own index so no value stringification
   * stands between the label a caller names and the option the browser selects.
   *
   * @param name Visible label of the product, e.g. `Parity Savings` (AAP 0.10.1).
   * @throws When the label is blank, or when no option of the select carries it within
   * {@link TEMPLATE_TIMEOUT_MS} — the message lists the labels the select does offer.
   */
  async selectProduct(name: string): Promise<void> {
    const wanted = name.trim();
    if (wanted.length === 0) {
      throw new Error('selectProduct() needs the visible label of a savings product; received a blank name');
    }

    // Two ids, both kept: the plan names `#productId`, and the shipped application form renders the
    // shared select field with `inputId="savings-product"`. Trying both before the caption-based
    // fallbacks keeps the resolution structural rather than dependent on a translated label, and
    // removing either one would put a translated caption back on the critical path.
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

  /**
   * Submits the application exactly once.
   *
   * The account-creating step of W8. Fineract account creation is not idempotent, so the primary
   * button is clicked once and the method never retries it: the screen disables that button while its
   * request is in flight, and a second click here would defeat the protection the workflow measures.
   * On success the router returns to `#/viewsavingaccount/{id}`, whose id the caller reads from the
   * URL — this method reads nothing back and returns `void`.
   *
   * The product and the submitted-on date are the caller's own two steps: {@link selectProduct} by
   * label, and the date typed into `app-savings-new input[type="date"]` as the class doc describes.
   * This method deliberately does not fill either, so one method never changes a value the caller set.
   */
  async submitApplication(): Promise<void> {
    await this.clickPrimary(APPLICATION_ROOT, 'the savings application screen');
  }

  /**
   * Opens the savings record.
   *
   * Serves the read-back step of W8 over `#/viewsavingaccount/:id` (AAP 0.8.2), where the account
   * read carries the status, the three figures and the transaction list together (AAP 0.7.3 W8 row).
   * The record's root is awaited, and the root only takes height once that response has been painted,
   * so a reader called next sees the record rather than an empty page. A record that does not exist
   * renders the not-found card in place of the account (AAP 0.7.4): the root is still there, and the
   * readers then report what that card renders instead of raising.
   *
   * @param savingsId Fineract savings account id, e.g. the id the record's URL carried after the
   * application was submitted.
   * @throws When the id is empty or would address more than one route segment.
   */
  async openView(savingsId: number | string): Promise<void> {
    const id = requireRouteId(savingsId, 'the savings account id');
    await this.navigate(`/viewsavingaccount/${id}`);
    await this.awaitRoot(VIEW_ROOT, 'the savings record');
  }

  /**
   * Reads the record's status colour class and its summary label/value rows.
   *
   * Serves the comparison of W8's end state (AAP 0.10.1): the balance, the deposits and the
   * withdrawals the screen shows are the figures the report measures once the 1,000 deposit and the
   * 200 withdrawal have been made. Values are exactly as the screen renders them, grouping and
   * decimals included — nothing is recomputed from the transactions and no currency is added — and a
   * field with no value reports an empty string.
   *
   * A record that does not exist answers the not-found card's own content rather than raising, because
   * that card is a legitimate rendering of the route (AAP 0.7.4). Only the record element itself being
   * absent is an error, and it names `app-savings-view` so the caller knows to navigate first.
   */
  async readSummary(): Promise<SavingsSummaryView> {
    const root = this.page.locator(VIEW_ROOT).first();
    if ((await root.count()) === 0) {
      throw new Error(`the savings record is not on the page: no ${VIEW_ROOT} element. Open it with openView() first.`);
    }
    return root.evaluate(readSummaryInPage);
  }

  /**
   * Reads the record's transactions table, one row per rendered transaction.
   *
   * Serves the transaction half of W8's verdict (AAP 0.10.1): after the deposit and the withdrawal the
   * table must carry both rows with their running balances. Rows keep the server's order and their own
   * type text, which is Fineract's label and is therefore never translated. Columns are positional —
   * date, type, amount, balance — and every cell is also returned as text, so a spec can compare the
   * rendering itself when a locale formats a figure differently (AAP 0.10.2).
   *
   * An account with no transactions, and a record that does not exist, both answer an empty list
   * rather than raising: the empty state is a legitimate rendering, not a failure (AAP 0.7.4).
   */
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

  /**
   * Opens one of the four action screens.
   *
   * Serves the lifecycle and cash steps of W8 over `#/savingaccount/:id/:action` (AAP 0.8.2). The
   * segment is navigated exactly as the URL spells it, including `withdraw`, whose wire command is
   * `withdrawal` (AAP 0.7.3 W8 row): the screen owns that mapping, and this object neither sends a
   * command nor rewrites one. Approve and activate render a date field; deposit and withdrawal render
   * a date, an amount and a payment-type select whose options arrive from the transactions template,
   * which the form's own `selectOption` waits for when it is filled.
   *
   * @param savingsId Fineract savings account id the action applies to.
   * @param action One of the four segments {@link SavingsAction} allows.
   * @throws When the id is empty or would address more than one route segment, or when the action is
   * not one of the four segments.
   */
  async openAction(savingsId: number | string, action: SavingsAction): Promise<void> {
    const id = requireRouteId(savingsId, 'the savings account id');
    const segment = requireActionSegment(action);
    await this.navigate(`/savingaccount/${id}/${segment}`);
    await this.awaitRoot(ACTION_ROOT, 'the savings action screen');
  }

  /**
   * Fills the values the open action form is to send, and only those.
   *
   * Serves the dated approve and activate steps (`approvedOnDate`, `activatedOnDate`) and the deposit
   * and withdrawal steps (`transactionDate`, `transactionAmount`, `paymentTypeId`) of W8 (AAP 0.7.2
   * `SavingsActionRequest`). A member the caller omits keeps the value the screen rendered, so the
   * screen's own defaults are what gets posted; `fillTransaction({})` therefore does nothing at all.
   *
   * Nothing is rounded, clamped or bounded: the amount is typed exactly as the caller supplies it,
   * because a different value here would be a different body than the workflow states (Rule 1 clause
   * 3). Dates are the caller's `yyyy-mm-dd` strings and are never computed, shifted or reformatted
   * (Rule 1 clause 2).
   *
   * Each control is resolved by its id first and by its caption second, since every caption is
   * translated at run time: the ids the screen ships are `approvedOnDate`, `activatedOnDate`,
   * `transactionDate`, `transactionAmount` and `paymentTypeId`.
   *
   * @param values The values to enter; anything omitted keeps what the screen rendered.
   * @throws When a supplied date is not `yyyy-mm-dd`, or when a control the values name is not on the
   * screen — the message lists the selectors tried.
   */
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

  /**
   * Submits the open action form exactly once.
   *
   * Finishes the approve, activate, deposit or withdrawal step of W8. Neither the lifecycle command
   * nor the transaction command is idempotent, so the primary button is clicked once and the method
   * never retries: the screen disables it while its request is in flight, and a second click would
   * defeat exactly the protection the workflow measures. On success the router returns to
   * `#/viewsavingaccount/{id}`, so this method returns `void` and the caller re-reads the record with
   * {@link openView} and {@link readSummary}. Generated ids are compared by their role in the sequence
   * (AAP 0.10.2), never by a value invented here.
   */
  async submitAction(): Promise<void> {
    await this.clickPrimary(ACTION_ROOT, 'the savings action screen');
  }

  /**
   * The absolute URL of one screen, carrying both query parameters Rule 2 requires.
   *
   * A bare `page.goto('#/viewsavingaccount/7')` would be resolved against the browser's `baseURL` and
   * would therefore drop `baseApiUrl` and `tenantIdentifier`, leaving the application on the backend
   * its build configured rather than the one this run must address. Composing the whole URL for every
   * navigation is what keeps the two environments identical apart from their variables (AAP 0.4.4
   * decision 5, Rule 2).
   *
   * @param route Hash route to land on, starting with `/`.
   */
  private screenUrl(route: string): string {
    return `${NEXT_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}&tenantIdentifier=${TENANT_ID}#${route}`;
  }

  /**
   * Navigates to a hash route on the full entry URL.
   *
   * The navigation is confirmed against `window.location.hash` rather than trusted: when the router
   * has not applied the fragment — a document that was already open, or a redirect that ran first —
   * the hash is set in the page as the second way to ask it. Nothing is awaited beyond that here; the
   * caller awaits its own screen's root, which is the readiness signal that belongs to the screen.
   *
   * @param route Hash route the screen sits on, starting with `/`.
   */
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

  /**
   * Waits for a screen's root element to paint, and reports the hash it settled on when it does not.
   *
   * @param rootSelector Root element of the screen.
   * @param description What the screen is, used in the error message.
   * @throws When the root has not painted within {@link SCREEN_TIMEOUT_MS}.
   */
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

  /**
   * Resolves a control through an ordered chain of selectors and waits for it to be usable.
   *
   * The chain is the point: the first selector is the structural one (an id the template ships) and
   * the last is a positional or class-based fallback, so a caption that translates differently — or a
   * template that renames a field — degrades to a structural match instead of failing on text alone.
   *
   * @param selectors Candidate selectors, most specific first.
   * @param description What the control is, used in the error message.
   * @returns The first candidate that resolves, as a locator awaiting its own visibility.
   * @throws When no candidate resolves, naming every selector tried.
   */
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

  /**
   * Clicks a screen's primary submit exactly once.
   *
   * Two candidates, in order: the Bootstrap primary button whose label begins with "Submit" (the
   * legacy caption, translated at run time, so the match is case-insensitive and anchored at the start
   * of the label), then the form's own `type="submit"`. No retry of any kind: a retried click would
   * send a second request to an endpoint that is not idempotent.
   *
   * @param rootSelector Root element of the screen that owns the button.
   * @param description What the screen is, used in the error message.
   * @throws When the screen renders no primary submit.
   */
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

  /**
   * Types a `yyyy-mm-dd` date into the action screen's date field.
   *
   * Each of the three screens renders exactly one date field, captioned with the legacy `Date` or
   * `Transaction date` label, so the caption pattern covers both and the id is what distinguishes the
   * three fields from each other.
   *
   * @param fieldId Id the template ships for the field, e.g. `transactionDate`.
   * @param value The caller's date text.
   * @throws When the value is not `yyyy-mm-dd`, or when no field resolves.
   */
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

  /**
   * Types a transaction amount exactly as supplied.
   *
   * @param value The amount the caller supplied, as a number or as text.
   * @throws When no amount field resolves.
   */
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

  /**
   * Selects a payment type by the id of an option the transactions template returned.
   *
   * The select is native (AAP 0.10.5 item 2) and its options are bound through `[ngValue]`, so the
   * option's DOM value is `${position}: ${id}` rather than the id itself: the option is matched on the
   * value the application bound, and the selection is then made by the option's position. The list is
   * empty for a moment after the form paints, because it comes from the transactions template the
   * screen requests on entry, so the read is repeated for a bounded period rather than once.
   *
   * @param value Payment type id the caller supplied.
   * @throws When no payment type select resolves, or when the select offers no option with that id
   * within {@link TEMPLATE_TIMEOUT_MS} — the message lists the options it does offer.
   */
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
