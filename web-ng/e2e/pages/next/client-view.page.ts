/**
 * Page object for the new Angular application's individual client record — the `next` project's side
 * of workflow **W3** (search for a client, then read the record's details, accounts and identifiers
 * back, AAP 0.10.1) and the screen every in-scope client action and every loan and savings workflow
 * starts from.
 *
 * **Route.** `#/viewclient/:id` (AAP 0.8.2; `web-ng/tools/parity/in-scope-routes.json`), rendered by
 * `features/clients/client-view/client-view.component.ts` under the root element `app-client-view`.
 * The record's own blocks — `app-record-header`, `app-tab-strip`, `app-action-button-group`,
 * `app-client-summary`, `app-client-accounts` and `app-client-identifiers` — are the sub-roots
 * every other locator in this file is scoped to.
 *
 * **Entry URL (Rule 2; AAP 0.4.4 decision 5).** Every navigation composes
 * `${NEXT_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}&tenantIdentifier=${TENANT_ID}#<route>`.
 * The application resolves its backend once, before the first navigation, from `assets/config.json`,
 * then the container's `API_BASE_URL`/`TENANT_ID`, then these two query parameters, which win. That
 * precedence is what lets one bundle address the local stack and a forwarded Codespaces host with no
 * code difference (AAP 0.10.3), and it is why no host literal appears here: `NEXT_URL` and
 * `FINERACT_URL` are the only origins and both come from `seed/fixtures.ts`. A bare `page.goto('#/…')`
 * would resolve against the configured `baseURL` and drop both parameters, so {@link ClientViewPage}
 * never issues one.
 *
 * **What it reads, and what it only drives.** Every reader returns text the screen rendered, trimmed
 * and with its whitespace runs collapsed: the record header, the two tab labels, the visible action
 * labels, the accounts table and the identifiers table. Nothing is parsed into a number,
 * reformatted or normalised beyond that, because display normalisation is the capture's and the
 * parity report's business (AAP 0.10.2; Rule 1 clause 3). The object issues no HTTP
 * request of its own: the only effects are clicks and reads of what the record's own service fetched
 * (Rule 1 clause 2), and it holds no clock read of any kind — a date reaches a caller as the screen
 * printed it, through the application's one display pattern.
 *
 * **The record's four states (AAP 0.7.4).** While the record read is outstanding the screen paints
 * nothing; a 404 paints the not-found message *in place of* the record, so `app-client-view` is on
 * the page while `app-record-header`, the strip, the action row and the profile card are all absent;
 * any other 4xx paints Fineract's own message above a record that stays usable; a 5xx raises the
 * interceptor's single notification. The readers therefore return `''` or `[]` for a sub-root the
 * screen did not paint rather than raising, with one exception: {@link ClientViewPage.readHeader}
 * throws an `Error` naming `app-record-header`, because a caller that cannot find the header is
 * reading a record the server refused and needs to know which of the two it hit. That is an
 * exception, never an assertion.
 *
 * **Deliberate differences the readers respect (AAP 0.10.5).** The record keeps exactly the two
 * in-scope tabs, `General` and `Identities` (item 6), and the in-scope actions (items 5 and 7): the
 * four tabs, the signature, avatar and camera controls, and the client charge, client transfer and
 * staff-assignment features of the baseline application are out of scope and are never looked for
 * here — loan charges are in scope and live on the loan account's own record. The status is a colour
 * only: {@link ClientHeaderView.statusClass} carries the colour class of the indicator and no word is
 * read anywhere (item 11). `New Saving` is present solely because Stretch ships, so it is W8's entry
 * point (item 5; AAP 0.10.1 W8).
 *
 * **Locators (Rule 1 clause 6).** Taken from the templates above and only from them: the Bootstrap 3
 * classes the templates render (`.panel`, `.table`, `.nav-tabs`, `.btn-group`, `.btn.btn-primary`,
 * `.dropdown-menu`, `.breadcrumb`), the application's status colour classes, and the component
 * selectors that are the templates' own roots. Every visible caption is translated at run
 * time from the legacy locale bundles, so a text match is a case-insensitive pattern built from the
 * caller's label and paired with a structural fallback. No attribute is required on `web-ng/src` for
 * this file to work, and the dropdown's open position is the Angular-bound `.open` class — clicked,
 * never driven through a global plugin call (Rule 1 clause 7).
 *
 * **No assertions (Rule 1 clause 8), no credentials (Rule 1 clause 9).** Every judgement belongs to
 * the specs under `web-ng/e2e/specs/`. No client number, account number or session value is printed,
 * logged or returned anywhere but to the caller that asked for it.
 */
import type { Locator, Page } from '@playwright/test';

import { FINERACT_URL, NEXT_URL, TENANT_ID } from '../../seed/fixtures.js';

/**
 * The record header's identity, as AAP 0.10.1 W3 compares it against the API's answer.
 *
 * `pages/legacy/client-view.page.ts` declares the counterpart for the baseline application, and one
 * spec text reads both, so the field set here is the one the two sides agree on.
 */
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
  /** Account number as rendered — the table's first column. */
  readonly accountNo: string;
  /** Product name as rendered — the table's second column. */
  readonly product: string;
  /** The row's indicator colour class, or `''` when the row paints none. */
  readonly statusClass: string;
  /** The balance the row prints — the table's last column, verbatim. */
  readonly balance: string;
  /** Every cell of the row, trimmed, in column order. */
  readonly cells: readonly string[];
}

/** One row of the record's identifiers table (AAP 0.10.1 W3, from `GET /clients/{id}/identifiers`). */
export interface IdentifierRow {
  /** Document type as rendered — the table's first column. */
  readonly documentType: string;
  /** The identifier's key, i.e. the document number — the table's second column. */
  readonly documentKey: string;
  /** Free-text description — the table's third column. */
  readonly description: string;
  /** The row's indicator colour class, or `''` — this table prints its status as text, not as a colour. */
  readonly statusClass: string;
  /** Every cell of the row, trimmed, in column order. */
  readonly cells: readonly string[];
}

/**
 * What the record header yields inside the page, before the metadata runs are matched to the three
 * fields {@link ClientHeaderView} names. Internal to this module: a caller reads
 * {@link ClientHeaderView}, never this shape.
 */
interface HeaderReading {
  /** The record title's text, trimmed. */
  readonly displayName: string;
  /** The indicator's colour class, or `''`. */
  readonly statusClass: string;
  /** The inline metadata runs, in document order, each label stripped of its trailing colon. */
  readonly runs: readonly { readonly label: string; readonly value: string }[];
}

/**
 * One table row read inside the page: its cells and its indicator's colour class. Internal to this
 * module — {@link ClientViewPage.readAccounts} and {@link ClientViewPage.readIdentifiers} each map it
 * onto their own exported row shape, because the two tables' columns mean different things.
 */
interface TableRowReading {
  /** The row's cells, trimmed, in column order. */
  readonly cells: readonly string[];
  /** The row's indicator colour class, or `''`. */
  readonly statusClass: string;
}

/** Root of the client record: every other locator in this file is scoped to it. */
const ROOT_SELECTOR = 'app-client-view';

/**
 * The record's own trail (`<ol class="breadcrumb">` holding the client's office). The screen renders
 * it only once the record has been read, and the shell declares no crumb for this route, so it is the
 * one trail on the page and never a fallback to the navbar's.
 */
const BREADCRUMB_SELECTOR = '.breadcrumb';

/** The record's head block: the indicator, the name and the three inline metadata runs. */
const RECORD_HEADER_SELECTOR = 'app-record-header';

/** The record's tab strip. */
const TAB_STRIP_SELECTOR = 'app-tab-strip';

/** The record's joined action row, with its `More` dropdown. */
const ACTION_GROUP_SELECTOR = 'app-action-button-group';

/** `General` tab's accounts section. */
const ACCOUNTS_SELECTOR = 'app-client-accounts';

/** `General` tab's summary block, above the accounts section. */
const SUMMARY_SELECTOR = 'app-client-summary';

/** `Identities` tab's identifiers section. */
const IDENTIFIERS_SELECTOR = 'app-client-identifiers';

/**
 * A tab of the strip: the anchor of a `role="presentation"` item. The two decorative chevrons the
 * strip renders are `<li aria-hidden="true">` with no anchor, so they never appear as a label.
 */
const TAB_LINK_SELECTOR = `.nav-tabs li[role="presentation"] > a`;

/** The strip's whole items, used only if a template stops rendering an anchor inside a tab item. */
const TAB_ITEM_SELECTOR = `.nav-tabs li[role="presentation"]`;

/** The tab item the screen currently shows — the target the active class moves to on a switch. */
const ACTIVE_TAB_SELECTOR = '.nav-tabs li.active > a';

/** An entry of the visible action row: the joined primary-button links. */
const TOP_LEVEL_ACTION_SELECTOR = 'a.btn.btn-primary';

/** An entry of the action row's `More` menu, which Bootstrap hides until the `.open` class is set. */
const MENU_ACTION_SELECTOR = '.dropdown-menu a';

/** The `More` trigger. */
const MENU_TOGGLE_SELECTOR = '.dropdown-toggle';

/** The list the `More` trigger reveals. */
const MENU_SELECTOR = '.dropdown-menu';

/** The dropdown wrapper whose `.open` class reveals {@link MENU_SELECTOR}. */
const DROPDOWN_SELECTOR = '.dropdown';

/** The loan account record a loan row opens. */
const LOAN_VIEW_SELECTOR = 'app-loan-view';

/** Where an action's own screen is, keyed by the route segment of the link the action carries. */
const ACTION_DESTINATIONS: readonly {
  readonly route: RegExp;
  readonly root: string;
  readonly description: string;
}[] = [
  { route: /\/editclient\//, root: 'app-client-edit', description: 'the client edit screen' },
  { route: /\/newclientloanaccount\//, root: 'app-loan-new', description: 'the loan application screen' },
  {
    route: /\/new_client_saving_application\//,
    root: 'app-savings-new',
    description: 'the savings application screen',
  },
  { route: /\/client\//, root: 'app-client-actions', description: 'the client action screen' },
];

/**
 * Ceiling for a screen to appear after a navigation or a click. Generous because the record's first
 * paint waits on `GET /clients/{id}` against the same backend the legacy baseline uses.
 */
const SCREEN_TIMEOUT_MS = 30_000;

/** Ceiling for the `More` menu to open, which is a class change and nothing else. */
const MENU_TIMEOUT_MS = 5_000;

/** Collapses the whitespace a template leaves between its elements, then trims. */
function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Escapes every character that would otherwise be read as part of a pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds the case-insensitive pattern a caller's label is matched with. Internal to this module.
 *
 * A label's words are joined by optional whitespace rather than by the exact spacing a caller typed:
 * the shipped legacy bundle words this record's actions `New Loan` and `New Saving`, while a run whose
 * locale file does not resolve falls back to the humanised key and renders `Newloan` and `Newsaving`.
 * Matching both keeps a caller's label independent of which translation bundle is on disk, and costs
 * nothing for a one-word label.
 *
 * @param label The label a caller asked for — an action's or a tab's visible text.
 * @returns A pattern matching that text anywhere in a control's rendering.
 * @throws When the label is empty, which would match every control the group offers.
 */
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

/** Renders an argument a caller passed, so an error message shows a blank or odd value as it arrived. */
function describeArgument(value: number | string): string {
  return typeof value === 'number' ? String(value) : JSON.stringify(value);
}

/**
 * Renders a client or loan account id as the single hash-route segment it has to be. Internal to this
 * module.
 *
 * A guard on the caller's own input, never a check on the application: an empty value, a non-finite
 * number or a value carrying `/`, `?` or `#` would address a different route than the one asked for.
 *
 * @param value The id a caller supplied.
 * @param role What the value names, used in the error message.
 * @returns The id as route text.
 * @throws When the value cannot be one route segment.
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

/** Reads a cell by position, answering `''` for a column the row does not render. Internal here. */
function cellAt(cells: readonly string[], index: number): string {
  return index >= 0 && index < cells.length ? cells[index] : '';
}

/**
 * The first metadata run whose label matches a field's pattern, or `''`. Internal to this module.
 *
 * The label is matched rather than the position, so a locale that words a label differently still
 * yields the three values in their documented places, and a field the record leaves unset answers
 * `''` instead of borrowing a neighbour's value.
 */
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

/**
 * Renders a list of labels for an error message, so a caller that asked for a label the screen does not
 * show is told what the screen does show. Internal to this module.
 */
function describeLabels(labels: readonly string[]): string {
  return labels.length === 0 ? 'no labels at all' : labels.map((label) => `"${label}"`).join(', ');
}

/**
 * Runs inside the page: the record header's title, its indicator colour and its inline metadata runs.
 *
 * The status is the colour class of the indicator and never a word, because the header paints a colour
 * with no label beside it (AAP 0.10.5 item 11). The metadata is read as span pairs — each run renders
 * its label in one span and its value in the next, with the pipe separator kept out of the
 * accessibility tree — and a run whose value span is empty answers `''` rather than borrowing text.
 * When a template renders the runs without spans, the block's text is split on the pipe instead, so a
 * markup change degrades to the same three values rather than to none.
 *
 * Self-contained on purpose: Playwright serialises this function's source and evaluates it in the
 * document, where no module-scope binding of this file exists, so nothing it needs is imported and no
 * inner binding is declared.
 *
 * @param element The `app-record-header` element.
 */
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
  const name = element.querySelector('h3 strong') ?? element.querySelector('h3');
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

/**
 * Runs inside the page: every body row of the first table a section renders, with its cells and its
 * indicator's colour class.
 *
 * A section that paints the explicit empty state instead of a table answers an empty list, and so does
 * one that has painted nothing yet, so a caller never mistakes "no rows read" for "no accounts". The
 * status is again the colour class and never the cell's text (AAP 0.10.5 item 11); the identifiers
 * table prints its status as text and carries no indicator, so its rows answer `''` here.
 *
 * Self-contained on purpose: see {@link readHeaderBlock}.
 *
 * @param element The section root — `app-client-accounts` or `app-client-identifiers`.
 */
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

/**
 * Drives the new Angular application's client record and reads what it renders: the `next` side of
 * workflow W3 and the entry point every in-scope client action and every loan and savings workflow
 * uses (AAP 0.10.1, AAP 0.7.4).
 *
 * One instance per Playwright page, constructed with the page the spec has already authenticated on:
 * this class never logs in, never reads a credential and never touches `localStorage` (Rule 1
 * clause 9). A caller walks the record in the order the screen allows — {@link open}, then the readers,
 * then one of the `start*` methods or {@link openLoanAccount} to leave it — and every judgement about
 * what was read belongs to the spec that called it (Rule 1 clause 8).
 *
 * The reader shapes are the ones `pages/legacy/client-view.page.ts` declares for the baseline
 * application as well, so one spec text reads both sides of the parity comparison.
 */
export class ClientViewPage {
  /**
   * @param page The Playwright page the spec has already authenticated on.
   */
  constructor(private readonly page: Page) {}

  /**
   * Opens the record of one client on `#/viewclient/:id` (the entry step of AAP 0.10.1 W3).
   *
   * The root element is awaited rather than any block inside it: a client id the server does not know
   * paints the not-found message in place of the record (AAP 0.7.4), and that state is a legitimate one
   * for a spec to drive. {@link readHeader} is what distinguishes the two.
   *
   * @param clientId Fineract client the record belongs to.
   * @throws When the id is empty or would address more than one route segment.
   */
  async open(clientId: number | string): Promise<void> {
    const id = requireRouteId(clientId, 'the client id');
    await this.navigate(`/viewclient/${id}`);
    await this.awaitScreen(ROOT_SELECTOR, 'the client record');
    await this.awaitRecordSettled();
  }

  /**
   * Reads the record's own trail — the client's office, the one crumb the record renders.
   *
   * @returns The trail's text, trimmed; `''` while the record is unread or was refused.
   */
  async readBreadcrumb(): Promise<string> {
    const crumbs = (await this.record()).locator(BREADCRUMB_SELECTOR);
    if ((await crumbs.count()) === 0) {
      return '';
    }
    return normalizeText(await crumbs.first().innerText());
  }

  /**
   * Reads the record header: the client name, the indicator's colour class and the three metadata
   * values AAP 0.10.1 W3 compares against `GET /clients/{id}`.
   *
   * An `External ID` or `Staff` the client does not carry answers `''`, which is what the screen shows:
   * the label with an empty value and no placeholder. The status is the colour class alone — the
   * server's status word is never painted, so nothing here can read one (AAP 0.10.5 item 11).
   *
   * @returns The header as the record renders it.
   * @throws When `app-record-header` is not on the page — the record was refused, so there is no header
   * to read. An `Error`, not an assertion: the caller decides what a missing record means.
   */
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

  /**
   * Reads the tab labels the strip renders, in document order.
   *
   * The record keeps exactly the in-scope tabs, so a caller reads the two the plan allows rather than
   * the baseline application's fuller set (AAP 0.10.5 item 6). The strip's decorative chevrons carry no
   * anchor and are therefore never reported.
   *
   * @returns The labels, trimmed; `[]` when the record paints no strip.
   */
  async readTabs(): Promise<readonly string[]> {
    const strip = (await this.record()).locator(TAB_STRIP_SELECTOR);
    const links = strip.locator(TAB_LINK_SELECTOR);
    if ((await links.count()) > 0) {
      return (await links.allInnerTexts()).map(normalizeText).filter((label) => label.length > 0);
    }
    const items = strip.locator(TAB_ITEM_SELECTOR);
    return (await items.allInnerTexts()).map(normalizeText).filter((label) => label.length > 0);
  }

  /**
   * Switches the record to the tab whose label a caller names, and waits for the section it shows.
   *
   * The active class moving to the selected tab is the readiness signal, and the section the label implies
   * is awaited as well, so a caller reads the new tab's content rather than the one it replaced.
   *
   * @param label The tab's visible label, matched case-insensitively.
   * @throws When no visible tab matches the label, naming the labels the strip does render.
   */
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

  /**
   * Reads the labels of the action row's visible controls, in document order.
   *
   * Visibility, not presence: a permission the user lacks hides an entry in place and leaves it in the
   * markup (Rule 1 clause 3), so a label the user may not use never appears here. The `More` trigger is
   * included — it is one of the row's controls — and the entries inside its menu appear once
   * {@link openActionMenu} has opened it, which is the only way they are ever visible.
   *
   * @returns The visible labels, trimmed; `[]` when the record paints no action row.
   */
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

  /**
   * Opens the action row's `More` menu, which holds the lifecycle entries the row keeps off its face.
   *
   * Idempotent: a menu the record already shows is left as it is, so a caller may open it before reading
   * the labels or let {@link startAction} open it on the way to an entry. The open position is the
   * component's own class, driven by a click and never by a global plugin call (Rule 1 clause 7).
   *
   * @throws When the trigger is not visible or the menu does not open within {@link MENU_TIMEOUT_MS}.
   */
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

  /**
   * Follows the action whose label a caller names, and waits for the screen it leads to.
   *
   * The entry is taken from the visible row first and from the `More` menu second, which is opened only
   * when the row does not carry the entry. The click is issued once and never retried: the action
   * screens post to non-idempotent endpoints, and the screen's own in-flight guard is what keeps one
   * click to one request, so a retry from here would be the duplicate that guard exists to prevent.
   *
   * @param label The action's visible label, matched case-insensitively.
   * @throws When no visible entry matches the label, naming the labels the row does offer.
   */
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

  /**
   * Reads the `General` tab's accounts table — the client's loan and savings accounts as the section
   * renders them (AAP 0.10.1 W3, from `GET /clients/{id}/accounts`).
   *
   * The columns are the section's own: account number, product, status indicator and balance. The
   * balance is the last cell's text as the screen printed it, grouping included, because display
   * formatting is a dimension the parity comparison decides on (AAP 0.10.2).
   *
   * @returns One row per account; `[]` when the section paints its empty state or has painted nothing.
   */
  async readAccounts(): Promise<readonly AccountRow[]> {
    const region = (await this.record()).locator(ACCOUNTS_SELECTOR).first();
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

  /**
   * Opens the loan account record of one account the record lists.
   *
   * The accounts table is read-only by design and renders no account affordance (AAP 0.7.4), so the DOM
   * never exposes the loan's id: the caller supplies it, from the capture or from the state snapshot
   * that reads the same endpoint. An anchor carrying the account's route is followed when the section
   * renders one, and the route is composed otherwise — the one deliberate asymmetry with
   * `pages/legacy/client-view.page.ts`, whose table does link each row, and the reason the specs pass
   * the id to both sides.
   *
   * @param loanId Fineract loan account to open.
   * @throws When the id is empty or would address more than one route segment.
   */
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

  /**
   * Reads the `Identities` tab's identifiers table (AAP 0.10.1 W3, from
   * `GET /clients/{id}/identifiers`).
   *
   * The columns are the section's own: document type, the document number, its description and the
   * status the endpoint sent. The section offers no add, edit or delete control, so nothing here looks
   * for one (Rule 1 clause 3).
   *
   * @returns One row per identifier; `[]` when the section paints its empty state or has painted none.
   */
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

  /**
   * Leaves the record for the client's new loan application — the entry step of W4 (AAP 0.10.1).
   *
   * @throws When the row does not offer the entry to the user, naming the labels it does offer.
   */
  async startNewLoan(): Promise<void> {
    await this.startAction('New Loan');
  }

  /**
   * Leaves the record for the client's new savings application — the entry step of W8 (AAP 0.10.1).
   *
   * The entry exists because Stretch ships (AAP 0.9.1 scope group 4; AAP 0.10.5 item 5). The client
   * charge, client transfer and staff-assignment features of the baseline application are out of scope
   * and are never looked for on this record; loan charges are in scope and live on the loan account's
   * own record.
   *
   * @throws When the row does not offer the entry to the user, naming the labels it does offer.
   */
  async startNewSaving(): Promise<void> {
    await this.startAction('New Saving');
  }

  /** Root locator: every other locator in this class is scoped to the record. */
  private root(): Locator {
    return this.page.locator(ROOT_SELECTOR).first();
  }

  /**
   * The record root, once the record has settled into one of the states AAP 0.7.4 defines.
   *
   * The screen paints nothing at all while its own read is outstanding, so a locator taken before the
   * answer arrives finds no header, no strip and no action row and would report those absences as the
   * record's shape — a race that makes a reader answer about the moment it ran rather than about the
   * record. Every reader and every interaction therefore begins here: the settle signal is the first of
   * the header or the message a refused read paints in its place, which are the two states the screen
   * reaches once it knows whether it has a record.
   */
  private async record(): Promise<Locator> {
    await this.awaitRecordSettled();
    return this.root();
  }

  /**
   * Waits for the record's first paint, or for the message that replaces a record the server refused.
   *
   * The wait is bounded by {@link SCREEN_TIMEOUT_MS} and its expiry is not raised: a page that carries
   * neither signal is read as it stands, so each reader reports what the page holds (an empty value or
   * an empty list) and {@link readHeader} names the header that never appeared. Raising here instead
   * would turn a slow record into a timeout from whichever reader happened to be called first.
   */
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

  /**
   * Composes the record's entry URL: the application, both configuration query parameters and the hash
   * route (Rule 2; AAP 0.4.4 decision 5).
   *
   * @param route Hash route of the screen, starting with `/`.
   */
  private screenUrl(route: string): string {
    return `${NEXT_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}&tenantIdentifier=${TENANT_ID}#${route}`;
  }

  /**
   * Navigates to a hash route on the full entry URL.
   *
   * The navigation is confirmed against `window.location.hash` rather than trusted: when the router has
   * not applied the fragment — a document that was already open, or a redirect that ran first — the hash
   * is set in the page as the second way to ask it. Nothing further is awaited here; the caller awaits
   * its own screen's root, which is the readiness signal that belongs to that screen.
   *
   * @param route Hash route of the screen, starting with `/`.
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
   * Waits for a screen's root element to appear, and reports the hash the page settled on when it does
   * not.
   *
   * The element is awaited as attached rather than as visible because a screen legitimately paints
   * nothing while its own read is outstanding (AAP 0.7.4), so visibility would race the request rather
   * than measure the navigation.
   *
   * @param selector Root element of the screen.
   * @param description What the screen is, used in the error message.
   * @throws When the root has not appeared within {@link SCREEN_TIMEOUT_MS}.
   */
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

  /**
   * Finds the first candidate a caller may actually use: visible, and rendering the label it asked for.
   *
   * Visibility is the test rather than presence, because the permission gate hides an entry in place and
   * never removes it (Rule 1 clause 3). The pattern is built by {@link labelPattern} without the global
   * flag, so testing it against one candidate cannot affect the next.
   *
   * @param candidates The controls to consider, in document order.
   * @param pattern The label to match.
   * @returns The matching control, or `null` when none of them is both visible and a match.
   */
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

  /**
   * Waits for the screen an action's own link leads to.
   *
   * The destination comes from the route the link carries rather than from the label, so a locale that
   * words an action differently still resolves the screen it opens. A link whose route this class does
   * not map is followed by its observable effect instead — the hash leaving the record — so an action
   * the plan adds later still reports honestly whether anything happened.
   *
   * @param href The clicked link's `href`, as rendered.
   * @throws When the page neither reached a known screen nor left the record within the timeout.
   */
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

  /**
   * The section a tab label shows, used to wait for the switch to take effect.
   *
   * The record's two in-scope tabs are the only ones this class knows (AAP 0.10.5 item 6); a label it
   * does not recognise leaves the caller waiting for the active class alone, which is still the tab
   * switch's own signal.
   *
   * @param label The tab's visible label.
   * @returns A selector matching the section that label shows, or `null` when it is not a known tab.
   */
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
