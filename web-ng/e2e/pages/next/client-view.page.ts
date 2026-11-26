/** Page object for the new Angular application's individual client record — the `next` project's side of workflow **W3** (search for a client, then read the record's details, accounts and identifiers back, AAP 0.10.1) and (AAP 0.8.2, Rule 2, AAP 0.4.4, AAP 0.10.3). */
import type { Locator, Page } from '@playwright/test';

import { FINERACT_URL, NEXT_URL, TENANT_ID } from '../../seed/fixtures.js';

/** The record header's identity, as AAP 0.10.1 W3 compares it against the API's answer. */
export interface ClientHeaderView {
  /** The client name the record title renders — the API's `displayName`. */
  readonly displayName: string;
  /** The client number the inline metadata renders — the API's `accountNo`. */
  readonly clientNumber: string;
  /** The external identifier, or `''` when the client has none — never a placeholder. */
  readonly externalId: string;
  /** The assigned staff member's name, or `''` when no staff member is assigned. */
  readonly staff: string;
  /** The indicator's colour class — `status-active`, `status-pending`, `status-closed`, `status-other`, or `''`. */
  readonly statusClass: string;
}

/** One row of the record's accounts table (AAP 0.10.1 W3, from `GET /clients/{id}/accounts`). */
export interface AccountRow {
  readonly accountNo: string;
  readonly product: string;
  /** The row's indicator colour class, or `''` when the row paints none. */
  readonly statusClass: string;
  readonly balance: string;
  readonly cells: readonly string[];
}

/** One row of the record's identifiers table (AAP 0.10.1 W3, from `GET /clients/{id}/identifiers`). */
export interface IdentifierRow {
  readonly documentType: string;
  readonly documentKey: string;
  readonly description: string;
  /** The row's indicator colour class, or `''` — this table prints its status as text, not as a colour. */
  readonly statusClass: string;
  readonly cells: readonly string[];
}

interface HeaderReading {
  readonly displayName: string;
  /** The indicator's colour class, or `''`. */
  readonly statusClass: string;
  readonly runs: readonly { readonly label: string; readonly value: string }[];
}

interface TableRowReading {
  readonly cells: readonly string[];
  /** The row's indicator colour class, or `''`. */
  readonly statusClass: string;
}

const ROOT_SELECTOR = 'app-client-view';

/** The record's own trail (`<ol class="breadcrumb">` holding the client's office). */
const BREADCRUMB_SELECTOR = '.breadcrumb';

const RECORD_HEADER_SELECTOR = 'app-record-header';

const TAB_STRIP_SELECTOR = 'app-tab-strip';

/** The record's joined action row, with its `More` dropdown. */
const ACTION_GROUP_SELECTOR = 'app-action-button-group';

/** `General` tab's accounts section. */
const ACCOUNTS_SELECTOR = 'app-client-accounts';

/** The three states the accounts section paints once its own `GET /clients/{id}/accounts` has answered, and the whole of what "settled" means for it: the populated table (`#client-accounts`), the explicit empty state the. */
const ACCOUNTS_SETTLED_SELECTOR =
  `${ACCOUNTS_SELECTOR} #client-accounts, ` +
  `${ACCOUNTS_SELECTOR} app-empty-state, ` +
  `${ACCOUNTS_SELECTOR} .alert.alert-danger`;

/** `General` tab's summary block, above the accounts section. */
const SUMMARY_SELECTOR = 'app-client-summary';

/** `Identities` tab's identifiers section. */
const IDENTIFIERS_SELECTOR = 'app-client-identifiers';

/** A tab of the strip: the `role="tab"` anchor a `.nav-tabs` item holds. The strip renders no scroll chevron, because the in-scope record carries at most three tabs and a control that scrolls nothing is the broken affordance the plan refuses (AAP 0.10.5 items 6 and 8, Rule 1 clause 3). */
const TAB_LINK_SELECTOR = `.nav-tabs li > a`;

const TAB_ITEM_SELECTOR = `.nav-tabs li`;

const ACTIVE_TAB_SELECTOR = '.nav-tabs li.active > a';

const TOP_LEVEL_ACTION_SELECTOR = 'a.btn.btn-primary';

/** An entry of the action row's `More` menu, which Bootstrap hides until the `.open` class is set. */
const MENU_ACTION_SELECTOR = '.dropdown-menu a';

/** The `More` trigger. */
const MENU_TOGGLE_SELECTOR = '.dropdown-toggle';

/** The list the `More` trigger reveals. */
const MENU_SELECTOR = '.dropdown-menu';

/** The dropdown wrapper whose `.open` class reveals {@link MENU_SELECTOR}. */
const DROPDOWN_SELECTOR = '.dropdown';

const LOAN_VIEW_SELECTOR = 'app-loan-view';

const ACTION_DESTINATIONS: readonly {
  readonly route: RegExp;
  readonly root: string;
  readonly description: string;
}[] = [
  { route: /\/editclient\//, root: 'app-client-edit', description: 'the client edit screen' },
  { route: /\/newclientloanaccount\//, root: 'app-loan-new', description: 'the loan application screen' },
  { route: /\/client\//, root: 'app-client-actions', description: 'the client action screen' },
];

const SCREEN_TIMEOUT_MS = 30_000;

/** Ceiling for the `More` menu to open, which is a class change and nothing else. */
const MENU_TIMEOUT_MS = 5_000;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function labelPattern(label: string): RegExp {
  const tokens = label
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    throw new Error('a label is required: an empty label would match every control on the record');
  }
  return new RegExp(tokens.map(escapeRegExp).join('\\s*'), 'i');
}

function describeArgument(value: number | string): string {
  return typeof value === 'number' ? String(value) : JSON.stringify(value);
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

/** Reads a cell by position, answering `''` for a column the row does not render. Internal here. */
function cellAt(cells: readonly string[], index: number): string {
  return index >= 0 && index < cells.length ? cells[index] : '';
}

/** The first metadata run whose label matches a field's pattern, or `''`. */
function valueOfRun(
  runs: readonly { readonly label: string; readonly value: string }[],
  pattern: RegExp,
): string {
  for (const run of runs) {
    if (pattern.test(run.label)) {
      return run.value;
    }
  }
  return '';
}

function describeLabels(labels: readonly string[]): string {
  return labels.length === 0 ? 'no labels at all' : labels.map((label) => `"${label}"`).join(', ');
}

/** Runs inside the page: the record header's title, its indicator colour and its inline metadata runs (AAP 0.10.5). */
function readHeaderBlock(element: HTMLElement): HeaderReading {
  let statusClass = '';
  const swatch = element.querySelector('.status-active, .status-pending, .status-closed, .status-other');
  if (swatch !== null) {
    for (const token of (swatch.getAttribute('class') ?? '').split(/\s+/)) {
      if (/^status-(?:active|pending|closed|other)$/.test(token)) {
        statusClass = token;
        break;
      }
    }
  }

  let displayName = '';
  // The record header's title is the screen's `h1` — the level the accessibility fix moved it to (QA
  // report F40), with the name inside the `strong` the delivered markup wraps it in.
  const name = element.querySelector('h1 strong') ?? element.querySelector('h1');
  if (name !== null) {
    displayName = (name.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  const runs: { label: string; value: string }[] = [];
  const metadata = element.querySelector('.small.text-small') ?? element.querySelector('div');
  if (metadata !== null) {
    const spans = Array.from(metadata.querySelectorAll('span')).filter(
      (span) => span.getAttribute('aria-hidden') !== 'true',
    );
    for (let index = 0; index + 1 < spans.length; index += 2) {
      runs.push({
        label: (spans[index].textContent ?? '').replace(/\s+/g, ' ').trim().replace(/:$/, '').trim(),
        value: (spans[index + 1].textContent ?? '').replace(/\s+/g, ' ').trim(),
      });
    }
    if (runs.length === 0) {
      for (const part of (metadata.textContent ?? '').split('|')) {
        const separator = part.indexOf(':');
        if (separator < 0) {
          continue;
        }
        runs.push({
          label: part.slice(0, separator).replace(/\s+/g, ' ').trim(),
          value: part.slice(separator + 1).replace(/\s+/g, ' ').trim(),
        });
      }
    }
  }

  return { displayName, statusClass, runs };
}

/** Runs inside the page: every body row of the first table a section renders, with its cells and its indicator's colour class (AAP 0.10.5). */
function readTableRowsInPage(element: HTMLElement): TableRowReading[] {
  if (element.querySelector('app-empty-state') !== null) {
    return [];
  }
  const table = element.querySelector('table');
  if (table === null) {
    return [];
  }
  const readings: TableRowReading[] = [];
  for (const row of Array.from(table.querySelectorAll('tbody tr'))) {
    const cells: string[] = [];
    for (const cell of Array.from(row.querySelectorAll('td'))) {
      cells.push((cell.textContent ?? '').replace(/\s+/g, ' ').trim());
    }
    if (cells.length === 0) {
      continue;
    }
    let statusClass = '';
    const swatch = row.querySelector('.status-active, .status-pending, .status-closed, .status-other');
    if (swatch !== null) {
      for (const token of (swatch.getAttribute('class') ?? '').split(/\s+/)) {
        if (/^status-(?:active|pending|closed|other)$/.test(token)) {
          statusClass = token;
          break;
        }
      }
    }
    readings.push({ cells, statusClass });
  }
  return readings;
}

/** Drives the new Angular application's client record and reads what it renders: the `next` side of workflow W3 and the entry point every in-scope client action and every loan and savings workflow uses (AAP 0.10.1, AAP (AAP 0.7.4, Rule 1 clause 9, Rule 1 clause 8). */
export class ClientViewPage {
  constructor(private readonly page: Page) {}

  /** Opens the record of one client on `#/viewclient/:id` (the entry step of AAP 0.10.1 W3) (AAP 0.7.4). */
  async open(clientId: number | string): Promise<void> {
    const id = requireRouteId(clientId, 'the client id');
    await this.navigate(`/viewclient/${id}`);
    await this.awaitScreen(ROOT_SELECTOR, 'the client record');
    await this.awaitRecordSettled();
  }

  /** Reads the record's own trail — the client's office, the one crumb the record renders. @returns The trail's text, trimmed; `''` while the record is unread or was refused. */
  async readBreadcrumb(): Promise<string> {
    const crumbs = (await this.record()).locator(BREADCRUMB_SELECTOR);
    if ((await crumbs.count()) === 0) {
      return '';
    }
    return normalizeText(await crumbs.first().innerText());
  }

  /** Reads the record header: the client name, the indicator's colour class and the three metadata values AAP 0.10.1 W3 compares against `GET /clients/{id}` (AAP 0.10.5). */
  async readHeader(): Promise<ClientHeaderView> {
    const header = (await this.record()).locator(RECORD_HEADER_SELECTOR).first();
    if ((await header.count()) === 0) {
      throw new Error(
        `the client record has no ${RECORD_HEADER_SELECTOR} on the page: a record the server refused ` +
          'paints its message in place of the record (AAP 0.7.4), so there is no header to read',
      );
    }
    const reading = await header.evaluate(readHeaderBlock);
    return {
      displayName: reading.displayName,
      clientNumber: valueOfRun(reading.runs, /client\s*(?:number|no)\b/i),
      externalId: valueOfRun(reading.runs, /external\s*id/i),
      staff: valueOfRun(reading.runs, /\bstaff\b/i),
      statusClass: reading.statusClass,
    };
  }

  /** Reads the tab labels the strip renders, in document order. The record keeps exactly the in-scope tabs, so a caller reads the two the plan allows rather than the baseline application's fuller set (AAP 0.10.5 item 6). */
  async readTabs(): Promise<readonly string[]> {
    const strip = (await this.record()).locator(TAB_STRIP_SELECTOR);
    const links = strip.locator(TAB_LINK_SELECTOR);
    if ((await links.count()) > 0) {
      return (await links.allInnerTexts()).map(normalizeText).filter((label) => label.length > 0);
    }
    const items = strip.locator(TAB_ITEM_SELECTOR);
    return (await items.allInnerTexts()).map(normalizeText).filter((label) => label.length > 0);
  }

  async selectTab(label: string): Promise<void> {
    const pattern = labelPattern(label);
    const root = await this.record();
    const strip = root.locator(TAB_STRIP_SELECTOR);
    const tab = await this.findVisible(strip.locator(TAB_LINK_SELECTOR), pattern);
    if (tab === null) {
      throw new Error(
        `no tab matching ${JSON.stringify(label)} is visible in ${TAB_STRIP_SELECTOR}; ` +
          `the record offers ${describeLabels(await this.readTabs())}`,
      );
    }
    await tab.click();
    await tab.and(strip.locator(ACTIVE_TAB_SELECTOR)).waitFor({ state: 'visible', timeout: SCREEN_TIMEOUT_MS });
    const section = this.tabSectionSelector(label);
    if (section !== null) {
      await root.locator(section).first().waitFor({ state: 'visible', timeout: SCREEN_TIMEOUT_MS });
    }
  }

  /** Reads the labels of the action row's visible controls, in document order (Rule 1 clause 3). */
  async readActionLabels(): Promise<readonly string[]> {
    const group = (await this.record()).locator(ACTION_GROUP_SELECTOR);
    const controls = group.locator(
      `${TOP_LEVEL_ACTION_SELECTOR}, ${MENU_TOGGLE_SELECTOR}, ${MENU_ACTION_SELECTOR}`,
    );
    const labels: string[] = [];
    const count = await controls.count();
    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index);
      if (!(await control.isVisible())) {
        continue;
      }
      const label = normalizeText(await control.innerText());
      if (label.length > 0) {
        labels.push(label);
      }
    }
    return labels;
  }

  /** Opens the action row's `More` menu, which holds the lifecycle entries the row keeps off its face (Rule 1 clause 7). */
  async openActionMenu(): Promise<void> {
    const group = (await this.record()).locator(ACTION_GROUP_SELECTOR);
    const menu = group.locator(MENU_SELECTOR).first();
    const dropdown = group.locator(DROPDOWN_SELECTOR).first();
    if ((await dropdown.count()) > 0) {
      const classes = (await dropdown.getAttribute('class')) ?? '';
      if (/\bopen\b/.test(classes)) {
        return;
      }
    } else if ((await menu.count()) > 0 && (await menu.isVisible())) {
      return;
    }
    const toggle = group.locator(MENU_TOGGLE_SELECTOR).first();
    await toggle.waitFor({ state: 'visible', timeout: MENU_TIMEOUT_MS });
    await toggle.click();
    await menu.waitFor({ state: 'visible', timeout: MENU_TIMEOUT_MS });
  }

  async startAction(label: string): Promise<void> {
    const pattern = labelPattern(label);
    const group = (await this.record()).locator(ACTION_GROUP_SELECTOR);
    let target = await this.findVisible(group.locator(TOP_LEVEL_ACTION_SELECTOR), pattern);
    if (target === null) {
      await this.openActionMenu();
      target = await this.findVisible(group.locator(MENU_ACTION_SELECTOR), pattern);
    }
    if (target === null) {
      throw new Error(
        `no action matching ${JSON.stringify(label)} is visible in ${ACTION_GROUP_SELECTOR}; ` +
          `the record offers ${describeLabels(await this.readActionLabels())}`,
      );
    }
    const href = (await target.getAttribute('href')) ?? '';
    await target.click();
    await this.awaitActionDestination(href);
  }

  /** Reads the `General` tab's accounts table — the client's loan and savings accounts as the section renders them (AAP 0.10.1 W3, from `GET /clients/{id}/accounts`) (AAP 0.10.2). */
  async readAccounts(): Promise<readonly AccountRow[]> {
    const region = (await this.record()).locator(ACCOUNTS_SELECTOR).first();
    await this.awaitAccountsSettled();
    if ((await region.count()) === 0) {
      return [];
    }
    const readings = await region.evaluate(readTableRowsInPage);
    return readings.map((reading) => ({
      accountNo: cellAt(reading.cells, 0),
      product: cellAt(reading.cells, 1),
      statusClass: reading.statusClass,
      balance: cellAt(reading.cells, reading.cells.length - 1),
      cells: reading.cells,
    }));
  }

  /** Opens the loan account record of one account the record lists (AAP 0.7.4). */
  async openLoanAccount(loanId: number | string): Promise<void> {
    const id = requireRouteId(loanId, 'the loan account id');
    const target = new RegExp(`/viewloanaccount/${escapeRegExp(id)}(?:$|[/?#])`);
    const anchors = (await this.record()).locator(`${ACCOUNTS_SELECTOR} a[href]`);
    const count = await anchors.count();
    for (let index = 0; index < count; index += 1) {
      const anchor = anchors.nth(index);
      if (!target.test((await anchor.getAttribute('href')) ?? '')) {
        continue;
      }
      if (!(await anchor.isVisible())) {
        continue;
      }
      await anchor.click();
      await this.awaitScreen(LOAN_VIEW_SELECTOR, 'the loan account record');
      return;
    }
    await this.navigate(`/viewloanaccount/${id}`);
    await this.awaitScreen(LOAN_VIEW_SELECTOR, 'the loan account record');
  }

  /** Reads the `Identities` tab's identifiers table (AAP 0.10.1 W3, from `GET /clients/{id}/identifiers`) (Rule 1 clause 3). */
  async readIdentifiers(): Promise<readonly IdentifierRow[]> {
    const region = (await this.record()).locator(IDENTIFIERS_SELECTOR).first();
    if ((await region.count()) === 0) {
      return [];
    }
    const readings = await region.evaluate(readTableRowsInPage);
    return readings.map((reading) => ({
      documentType: cellAt(reading.cells, 0),
      documentKey: cellAt(reading.cells, 1),
      description: cellAt(reading.cells, 2),
      statusClass: reading.statusClass,
      cells: reading.cells,
    }));
  }

  /** Leaves the record for the client's new loan application — the entry step of W4 (AAP 0.10.1). @throws When the row does not offer the entry to the user, naming the labels it does offer. */
  async startNewLoan(): Promise<void> {
    await this.startAction('New Loan');
  }

  private root(): Locator {
    return this.page.locator(ROOT_SELECTOR).first();
  }

  /** The record root, once the record has settled into one of the states AAP 0.7.4 defines. */
  private async record(): Promise<Locator> {
    await this.awaitRecordSettled();
    return this.root();
  }

  private async awaitRecordSettled(): Promise<void> {
    const settled = this.root().locator(`${RECORD_HEADER_SELECTOR}, .alert.alert-danger`);
    if ((await settled.count()) > 0) {
      return;
    }
    await settled
      .first()
      .waitFor({ state: 'attached', timeout: SCREEN_TIMEOUT_MS })
      .catch((): void => undefined);
  }

  private async awaitAccountsSettled(): Promise<void> {
    const settled = this.root().locator(ACCOUNTS_SETTLED_SELECTOR);
    if ((await settled.count()) > 0) {
      return;
    }
    await settled
      .first()
      .waitFor({ state: 'attached', timeout: SCREEN_TIMEOUT_MS })
      .catch((): void => undefined);
  }

  /** Composes the record's entry URL: the application, both configuration query parameters and the hash route (Rule 2; AAP 0.4.4 decision 5). @param route Hash route of the screen, starting with `/`. */
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

  /** Waits for a screen's root element to appear, and reports the hash the page settled on when it does not (AAP 0.7.4). */
  private async awaitScreen(selector: string, description: string): Promise<void> {
    const screen = this.page.locator(selector).first();
    try {
      await screen.waitFor({ state: 'attached', timeout: SCREEN_TIMEOUT_MS });
    } catch {
      const hash = await this.page.evaluate((): string => window.location.hash).catch((): string => '');
      throw new Error(
        `${description} (${selector}) did not appear within ${SCREEN_TIMEOUT_MS} ms; ` +
          `the page is at ${hash.length > 0 ? hash : 'no hash at all'}`,
      );
    }
  }

  /** Finds the first candidate a caller may actually use: visible, and rendering the label it asked for (Rule 1 clause 3). */
  private async findVisible(candidates: Locator, pattern: RegExp): Promise<Locator | null> {
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!(await candidate.isVisible())) {
        continue;
      }
      if (pattern.test(normalizeText(await candidate.innerText()))) {
        return candidate;
      }
    }
    return null;
  }

  private async awaitActionDestination(href: string): Promise<void> {
    for (const destination of ACTION_DESTINATIONS) {
      if (destination.route.test(href)) {
        await this.awaitScreen(destination.root, destination.description);
        return;
      }
    }
    const previous = await this.page.evaluate((): string => window.location.hash);
    try {
      await this.page.waitForFunction(
        (before: string): boolean => window.location.hash !== before,
        previous,
        { timeout: SCREEN_TIMEOUT_MS },
      );
    } catch {
      throw new Error(
        `the action at ${href.length > 0 ? href : 'no href at all'} did not leave the client record ` +
          `within ${SCREEN_TIMEOUT_MS} ms`,
      );
    }
  }

  /** The section a tab label shows, used to wait for the switch to take effect (AAP 0.10.5). */
  private tabSectionSelector(label: string): string | null {
    if (/identit/i.test(label)) {
      return IDENTIFIERS_SELECTOR;
    }
    if (/general/i.test(label)) {
      return `${SUMMARY_SELECTOR}, ${ACCOUNTS_SELECTOR}`;
    }
    return null;
  }
}
