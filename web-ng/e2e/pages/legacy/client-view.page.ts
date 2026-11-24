/**
 * Baseline page object for the legacy AngularJS application's single-client record: route
 * `#/viewclient/:id` (app/scripts/routes.js:85), served from `LEGACY_URL`.
 *
 * Workflows it serves (AAP 0.10.1): **W3**, which searches for a client and reads the record's
 * details, accounts and identifiers back from `GET /clients/{id}`, `GET /clients/{id}/accounts` and
 * `GET /clients/{id}/identifiers`; and the entry points of **W4** ("New Loan", routed to
 * `#/newclientloanaccount/:clientId`) and **W8** ("New Saving", routed to
 * `#/new_client_saving_application/:clientId`). Every Fineract call behind those readings is observed
 * by the network capture, never by this file: no Fineract address and no API call appears here
 * (Rule 1 clause 2).
 *
 * Entry URL (Rule 2): the harness may open the legacy app only through
 * `${LEGACY_URL}/?baseApiUrl=${FINERACT_URL}&tenantIdentifier=${TENANT_ID}`. Without both query
 * parameters the legacy app falls back to a public demo host, which Rule 2 forbids, so `entryUrl()`
 * builds that address and `gotoHash()` keeps it on every later in-app jump.
 *
 * Legacy-only tabs and actions are reported unfiltered (Rule 1 clause 3). The record still renders
 * Family Members, Documents, Notes and Credit Report, and actions such as "New Charge",
 * "Transfer Client", "Assign Staff" and the signature entries, none of which the new application
 * renders. They stay in every read so `report/parity-report.ts` can record them as
 * `intentional-diff` against AAP 0.10.5 items 5-8; filtering them out here would delete that
 * evidence.
 *
 * The legacy source tree is a read-only reference outside this checkout, so each selector below names
 * the legacy markup it comes from and the AAP section it serves, and must be confirmed against the
 * running legacy app.
 */
import type { Locator, Page } from '@playwright/test';

import { FINERACT_URL, LEGACY_URL, TENANT_ID } from '../../seed/fixtures';

/**
 * The record header's identity, as AAP 0.10.1 W3 compares it against the API's answer.
 *
 * Declared identically by the sibling `pages/next/client-view.page.ts` so one spec type-checks
 * against both page objects.
 */
export interface ClientViewHeader {
  /** Client name the record title renders (`displayName` in the API's answer). */
  displayName: string;
  /** Client number the inline metadata renders (`accountNo` in the API's answer). */
  clientNumber: string;
  /** External identifier, or `''` when the client has none — never a placeholder. */
  externalId: string;
  /** Assigned staff member's name, or `''` when no staff member is assigned. */
  staff: string;
  /** Raw `class` attribute of the record's status dot, e.g. `fa fa-circle status-active`. */
  statusClass: string;
}

/** One label/value row of the record's right-hand profile card (AAP 0.2.3 `ProfileCard`). */
export interface ProfileField {
  /** Row label as rendered, trimmed. */
  label: string;
  /** Row value as rendered, trimmed; `''` when the field has no value. */
  value: string;
}

/** One row of the General tab's accounts table (AAP 0.10.1 W3, from `GET /clients/{id}/accounts`). */
export interface AccountRow {
  /** Which account family the row belongs to, derived from the route the row links to. */
  accountType: 'loan' | 'savings' | 'other';
  /** Account number as rendered. */
  accountNo: string;
  /** Product name as rendered. */
  productName: string;
  /** Raw `class` attribute of the row's status marker; the status is never read as text. */
  statusClass: string;
  /** Balance the row renders — the balance or loan-balance column, whichever the table carries. */
  balance: string;
}

/** One row of the Identities tab's identifier table (AAP 0.10.1 W3, from
 * `GET /clients/{id}/identifiers`). */
export interface IdentifierRow {
  /** Document type as rendered, e.g. `National Id`. */
  documentType: string;
  /** The identifier's key — the document number itself. */
  documentKey: string;
  /** Raw `class` attribute of the status element, `''` when the rendered status carries no class. */
  statusClass: string;
}

/**
 * AAP 0.2.3 `Breadcrumb`: `<ul class="breadcrumb">` holding the client's office and, when one is
 * assigned, its staff member (app/views/clients/viewclient.html:2-5). The `/` the design node `1:4`
 * shows between the two is a generated CSS divider, not text.
 */
const BREADCRUMB = '.breadcrumb';

/**
 * AAP 0.2.3 `RecordHeader`: the record's title block `<h3 class="client-title">`
 * (app/views/clients/viewclient.html:168).
 */
const RECORD_HEADER = '.client-title';

/** The 24px bold client name inside the record header: `<strong>{{client.displayName}}</strong>`. */
const RECORD_TITLE = `${RECORD_HEADER} strong`;

/**
 * The record's status marker: `<i class="fa fa-circle {{client.status.code | StatusLookup}}">`
 * (app/views/clients/viewclient.html:169). A colour dot with a tooltip and no text, which is why
 * AAP 0.10.5 item 11 forbids reading a textual status anywhere.
 */
const STATUS_DOT = `${RECORD_HEADER} i.fa-circle`;

/**
 * The inline metadata run of the record header — its last `<small>`, rendering
 * `Client Number: {accountNo} | External ID: {externalId} | Staff: {staffName}`. An optional
 * substatus `<small>` precedes it, so the metadata is always the last one.
 */
const RECORD_METADATA = `${RECORD_HEADER} > small:last-child`;

/**
 * AAP 0.2.3 `TabStrip`: the `<ul class="nav nav-tabs">` that `uib-tabset` renders (angular-bootstrap
 * 1.3.2), holding the record's tabs — General, Identities, Documents, Notes and Credit Report on the
 * legacy app, of which only General and Identities are in scope for the new one.
 */
const TAB_STRIP = '.nav-tabs';

/** The pane container `uib-tabset` renders beside the strip: `<div class="tab-content"><div class="tab-pane">`. */
const TAB_PANEL = '.tab-content .tab-pane';

/** The active tab's link, used to tell a tab switch from a click that landed on the wrong tab. */
const ACTIVE_TAB = `${TAB_STRIP} li.active > a`;

/**
 * AAP 0.2.3 `ActionButtonGroup`: the joined primary-button group of the record
 * (`<div class="col-md-11 col-sm-11 btn-group row pull-right">`, app/views/clients/viewclient.html:183)
 * inside the active tab pane, together with the `More` dropdown it contains.
 */
const ACTION_GROUP = `${TAB_PANEL}.active .btn-group`;

/** The `More` dropdown's menu: `<ul class="dropdown dropdown-menu dropdown-menu-right">`. */
const ACTION_MENU = '.dropdown-menu';

/**
 * AAP 0.2.3 `ProfileCard`: the right-hand card
 * (`<div class="thumbnail row"><table class="table-minified">`, app/views/clients/viewclient.html:767,787),
 * whose rows pair a bold `th` label with a `td` value.
 */
const PROFILE_TABLE = '.thumbnail .table-minified';

/**
 * Tab labels as the legacy English translations render them: `label.heading.general` = "General" and
 * `label.heading.identities` = "Identities" (app/global-translations/locale-en.json). The harness runs
 * the legacy app in English (`LOCALE` in the fixtures), so these are the rendered labels.
 * Confirm against the running legacy app.
 */
const GENERAL_TAB = 'General';
const IDENTITIES_TAB = 'Identities';

/**
 * Action labels as the legacy English translations render them: `label.button.more` = "More",
 * `label.button.newloan` = "New Loan", `label.button.newsaving` = "New Saving" and
 * `label.button.edit` = "Edit" (app/scripts/models/clientStatus.js:90-110 and
 * app/global-translations/locale-en.json). Confirm against the running legacy app.
 */
const MORE_LABEL = 'More';
const NEW_LOAN_LABEL = 'New Loan';
const NEW_SAVING_LABEL = 'New Saving';
const EDIT_LABEL = 'Edit';

/**
 * Hash prefixes of the routes the record's actions lead to: `location.path('/viewloanaccount/' + id)`
 * in app/scripts/controllers/client/ViewClientController.js:145, and the action hrefs of
 * app/scripts/models/clientStatus.js. Each is the destination `start*()` and `openLoanAccount()`
 * wait for.
 */
const LOAN_ACCOUNT_ROUTE = '#/viewloanaccount/';
const NEW_LOAN_ROUTE = '#/newclientloanaccount/';
const NEW_SAVING_ROUTE = '#/new_client_saving_application/';
const EDIT_CLIENT_ROUTE = '#/editclient/';

/**
 * How long a hash jump is given to take effect before the helper drives `location.hash` directly.
 * The AngularJS router reacts to the browser's `hashchange` on the next digest, so a same-document
 * jump issued from outside the application can need a nudge.
 */
const HASH_SETTLE_TIMEOUT_MS = 2_000;

/** Collapses the whitespace AngularJS leaves between interpolations, then trims. */
function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Splits the record's inline metadata — `Client Number: … | External ID: … | Staff: …` — into its
 * three runs. Each run is matched by its label first and by its position second, so a locale whose
 * label text differs still yields the three values in their documented order. A run with no value
 * yields `''`, never a placeholder (AAP 0.2.1 Step 3).
 */
function parseClientMetadata(text: string): { clientNumber: string; externalId: string; staff: string } {
  const runs = text
    .split('|')
    .map((run) => {
      const separator = run.indexOf(':');
      return separator < 0
        ? { label: '', value: normalize(run) }
        : { label: normalize(run.slice(0, separator)).toLowerCase(), value: normalize(run.slice(separator + 1)) };
    })
    .filter((run) => run.label.length > 0);
  const byLabel = (label: string): string | undefined => runs.find((run) => run.label === label)?.value;
  const byPosition = (index: number): string => runs[index]?.value ?? '';
  return {
    clientNumber: byLabel('client number') ?? byPosition(0),
    externalId: byLabel('external id') ?? byPosition(1),
    staff: byLabel('staff') ?? byPosition(2),
  };
}

/**
 * Runs inside the legacy page, so it references nothing from module scope — Playwright serialises
 * the function and evaluates it in the document.
 *
 * It declares no inner functions of its own for the same reason: a transpiler that preserves
 * function names (`keepNames`) would emit a helper call into the serialised source, and that helper
 * does not exist in the page. Anonymous callbacks are safe; named bindings are not.
 *
 * Reads the General tab's account tables into {@link AccountRow}s (AAP 0.10.1 W3). A row qualifies
 * when its table carries an `Account Number` header (`label.heading.accnum`), which is what keeps
 * the upcoming-charges and collateral tables of the same area out, and its account family is taken
 * from the route the row itself links to: a row whose cells route to a loan account is a loan row,
 * one that routes to a savings account is a savings row, anything else is `other`. The balance is
 * the column whose header names it, so the loan table's "Loan Balance" and the savings table's
 * "Balance" both resolve. The status is read from the marker's `class` attribute and never from its
 * text (AAP 0.10.5 item 11). Rows hidden by `ng-show` never reach this function: the locator filters
 * them out, because the two loan tables and the two savings tables are alternated by it.
 */
function readAccountRows(rows: Element[]): (AccountRow | null)[] {
  const amountLike = /^-?[\d,]+(?:\.\d+)?$/;
  const results: (AccountRow | null)[] = [];
  for (const element of rows) {
    if (!(element instanceof HTMLTableRowElement) || element.querySelector('td') === null) {
      results.push(null);
      continue;
    }
    const cells = Array.from(element.cells);
    const table = element.closest('table');
    const headerRow =
      table === null
        ? undefined
        : Array.from(table.rows).find(
            (candidate) =>
              candidate.cells.length > 0 &&
              Array.from(candidate.cells).every((cell) => cell.tagName === 'TH'),
          );
    const headers =
      headerRow === undefined
        ? []
        : Array.from(headerRow.cells).map((cell) =>
            (cell.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
          );
    const texts = cells.map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim());
    const accountIndex = headers.findIndex((label) => label === 'account number');
    if (cells.length === 0 || headerRow === undefined || accountIndex < 0) {
      results.push(null);
      continue;
    }
    const productIndex = headers.findIndex((label) => /loan account|savings account/.test(label));
    let balanceIndex = headers.findIndex((label) => /balance/.test(label));
    if (balanceIndex < 0) balanceIndex = headers.findIndex((label) => /outstanding/.test(label));
    if (balanceIndex < 0) {
      for (let index = cells.length - 1; index > accountIndex; index -= 1) {
        if (amountLike.test(texts[index])) {
          balanceIndex = index;
          break;
        }
      }
    }
    const statusIcons = Array.from(element.querySelectorAll('i.fa-stop'));
    const statusMarker = statusIcons.find((icon) => icon.getClientRects().length > 0) ?? statusIcons[0];
    const hints: string[] = [];
    for (const target of Array.from(element.querySelectorAll('[ng-click], [data-ng-click], a[href]'))) {
      const click = target.getAttribute('data-ng-click') ?? target.getAttribute('ng-click');
      if (click !== null) hints.push(click);
      const href = target.getAttribute('href');
      if (href !== null) hints.push(href);
    }
    const routes = hints.join(' ');
    results.push({
      accountType: /loanaccount|routeToLoan/i.test(routes)
        ? 'loan'
        : /savingaccount|routeToSaving|depositaccount/i.test(routes)
          ? 'savings'
          : 'other',
      accountNo: texts[accountIndex] ?? '',
      productName: texts[productIndex < 0 ? 1 : productIndex] ?? '',
      statusClass: statusMarker === undefined ? '' : (statusMarker.getAttribute('class') ?? ''),
      balance: balanceIndex < 0 ? '' : (texts[balanceIndex] ?? ''),
    });
  }
  return results;
}

/**
 * Runs inside the legacy page, so it references nothing from module scope.
 *
 * Reads the profile card's rows as `{ label, value }` in document order (AAP 0.2.1 Step 3,
 * AAP 0.2.3 `ProfileCard`). Only rows pairing a `th` label with a `td` value are fields, so the
 * card's `colspan` section headings — "Performance History" among them — are skipped. A field the
 * client has no value for returns `''`, which is how the design shows several rows of the card.
 */
function readProfileRows(rows: Element[]): (ProfileField | null)[] {
  const results: (ProfileField | null)[] = [];
  for (const element of rows) {
    const label = element instanceof HTMLTableRowElement ? element.querySelector('th') : null;
    const value = element instanceof HTMLTableRowElement ? element.querySelector('td') : null;
    if (label === null || value === null) {
      results.push(null);
      continue;
    }
    results.push({
      label: (label.textContent ?? '').replace(/\s+/g, ' ').trim(),
      value: (value.textContent ?? '').replace(/\s+/g, ' ').trim(),
    });
  }
  return results;
}

/**
 * Runs inside the legacy page, so it references nothing from module scope.
 *
 * Reads the Identities tab's identifier table into {@link IdentifierRow}s (AAP 0.10.1 W3). Columns
 * are located by their headers — `ID`, `Type`, `Status` — so a table whose columns shift still reads
 * correctly, with the legacy positions as the fallback. The status is read from the `class` attribute
 * of the status cell or of its element child: the legacy app renders a translated status word there
 * with no class, so this legitimately yields `''` and the parity report compares it as such.
 */
function readIdentifierRows(rows: Element[]): (IdentifierRow | null)[] {
  const results: (IdentifierRow | null)[] = [];
  for (const element of rows) {
    if (!(element instanceof HTMLTableRowElement) || element.querySelector('td') === null) {
      results.push(null);
      continue;
    }
    const cells = Array.from(element.cells);
    const table = element.closest('table');
    const headerRow =
      table === null
        ? undefined
        : Array.from(table.rows).find(
            (candidate) =>
              candidate.cells.length > 0 &&
              Array.from(candidate.cells).every((cell) => cell.tagName === 'TH'),
          );
    const headers =
      headerRow === undefined
        ? []
        : Array.from(headerRow.cells).map((cell) =>
            (cell.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
          );
    const texts = cells.map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim());
    const keyIndex = headers.indexOf('id');
    const typeIndex = headers.indexOf('type');
    const statusIndex = headers.indexOf('status');
    const statusCell = statusIndex >= 0 && statusIndex < cells.length ? cells[statusIndex] : null;
    const statusMarker = statusCell === null ? null : (statusCell.querySelector('*') ?? statusCell);
    results.push({
      documentType: texts[typeIndex < 0 ? 2 : typeIndex] ?? '',
      documentKey: texts[keyIndex < 0 ? 0 : keyIndex] ?? '',
      statusClass: statusMarker === null ? '' : (statusMarker.getAttribute('class') ?? ''),
    });
  }
  return results;
}

/**
 * The legacy application's single-client record (`#/viewclient/:id`).
 *
 * Typed readers only: no assertion, no `expect`, and no Fineract call of its own, so the same spec
 * can measure this baseline and the new application's record with one set of comparisons
 * (AAP 0.10.1 W3, 0.10.2).
 */
export class ClientViewPage {
  private readonly page: Page;

  /** @param page The page of the `legacy` Playwright project, already authenticated by the login
   * page object — the record requires a session because every read is a Fineract call. */
  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Opens the record of `clientId` (AAP 0.10.1 W3) — the entry point of W4 and W8 as well, because
   * the "New Loan" and "New Saving" actions live on this screen — and waits for the record header,
   * which the profile card, the tab strip and the action group all settle after.
   */
  async open(clientId: number): Promise<void> {
    await this.gotoHash(`#/viewclient/${clientId}`);
    await this.recordHeader().waitFor({ state: 'visible' });
  }

  /**
   * The breadcrumb text the record renders (AAP 0.2.1 Step 3 shows "Head Office /"). Only text is
   * returned: the `/` in the design is a CSS divider on the strip, not part of the content, so the
   * value is the office name and, for a staffed client, the staff member's name after it.
   */
  async readBreadcrumb(): Promise<string> {
    const breadcrumb = this.page.locator(BREADCRUMB).first();
    await breadcrumb.waitFor({ state: 'visible' });
    return normalize(await breadcrumb.innerText());
  }

  /**
   * The record header (AAP 0.10.1 W3, AAP 0.2.1 Step 3): the bold client name, the status dot's
   * class attribute, and the inline client number, external id and staff member. The status is
   * never read as text — the design shows a colour dot with no label (AAP 0.10.5 item 11) — and a
   * metadata run with no value yields `''` rather than a placeholder.
   */
  async readHeader(): Promise<ClientViewHeader> {
    await this.recordHeader().waitFor({ state: 'visible' });
    const displayName = await this.page.locator(RECORD_TITLE).first().innerText();
    const statusClass = await this.page.locator(STATUS_DOT).first().getAttribute('class');
    const metadata = await this.page.locator(RECORD_METADATA).first().innerText();
    const fields = parseClientMetadata(metadata);
    return {
      displayName: normalize(displayName),
      clientNumber: fields.clientNumber,
      externalId: fields.externalId,
      staff: fields.staff,
      statusClass: statusClass ?? '',
    };
  }

  /**
   * Every tab label the record renders, in DOM order (AAP 0.2.3 `TabStrip`). On the legacy app that
   * includes the out-of-scope Family Members, Documents, Notes and Credit Report tabs, which are
   * reported as they are (Rule 1 clause 3; AAP 0.10.5 item 6).
   */
  async readTabs(): Promise<string[]> {
    const tabs = this.page.locator(`${TAB_STRIP} a`);
    await tabs.first().waitFor({ state: 'visible' });
    const labels = await tabs.allInnerTexts();
    return labels.map(normalize).filter((label) => label.length > 0);
  }

  /**
   * Selects the tab labelled `label` and waits for it to become the active tab, so the caller reads
   * the pane that click switched to. Whether a tab is active in the first place is the spec's
   * comparison to make, not this page object's (AAP 0.2.3 `TabStrip`).
   */
  async selectTab(label: string): Promise<void> {
    await this.tabLink(label).click();
    await this.page
      .locator(`${ACTIVE_TAB}:text-is(${JSON.stringify(label)})`)
      .waitFor({ state: 'visible' });
  }

  /**
   * Every action label the record renders (AAP 0.2.3 `ActionButtonGroup`): the joined buttons of the
   * active tab, then the entries of the `More` menu. The legacy-only actions — "New Charge",
   * "Transfer Client", "Assign Staff", the signature entries and the rest — are included as
   * rendered, because AAP 0.10.5 items 5-8 records them as `intentional-diff` and filtering them
   * would remove that evidence (Rule 1 clause 3). The menu is opened to read its entries and closed
   * again, so the screen is left as it was found.
   */
  async readActionLabels(): Promise<string[]> {
    const group = this.actionGroup();
    await group.waitFor({ state: 'visible' });
    // A menu left open by an earlier interaction would otherwise repeat its entries below.
    await this.closeActionMenu();
    const buttons = await this.readVisibleLabels(group.locator('a, button'));
    await this.openActionMenu();
    const entries = await this.readVisibleLabels(this.actionMenu().locator('a'));
    await this.closeActionMenu();
    return [...buttons, ...entries];
  }

  /**
   * Opens the `More` menu of the action group and waits for it to be visible (AAP 0.2.3
   * `ActionButtonGroup`). The legacy toggle is a `uib-dropdown` whose menu Bootstrap reveals from
   * its parent's `open` class.
   */
  async openActionMenu(): Promise<void> {
    const menu = this.actionMenu().first();
    if ((await this.actionMenu().count()) === 0) {
      throw new Error('The client record renders no "More" menu, so its actions are single buttons only.');
    }
    if (await menu.isVisible()) return;
    const toggle = await this.moreToggle();
    await toggle.click();
    await menu.waitFor({ state: 'visible' });
  }

  /**
   * Clicks the action whose rendered text is `label`, whether it is one of the joined buttons or an
   * entry of the `More` menu (AAP 0.2.3 `ActionButtonGroup`). No assertion is made and no route is
   * waited for: where the action leads belongs to the workflow that invoked it (W2, W5, W8).
   */
  async startAction(label: string): Promise<void> {
    const button = this.labelled(this.actionGroup(), label);
    if ((await button.count()) > 0) {
      await button.first().click();
      return;
    }
    await this.openActionMenu();
    const entry = this.labelled(this.actionMenu(), label);
    if ((await entry.count()) === 0) {
      const known = await this.readVisibleLabels(this.actionMenu().locator('a'));
      await this.closeActionMenu();
      throw new Error(
        `"${label}" is neither a button nor a "More" entry of this client record. ` +
          `Menu entries: ${known.length === 0 ? 'none' : known.map((name) => `"${name}"`).join(', ')}.`,
      );
    }
    await entry.first().click();
  }

  /**
   * The right-hand profile card's rows as `{ label, value }` in document order (AAP 0.2.1 Step 3,
   * AAP 0.2.3 `ProfileCard`). Rows the client has no value for return `''`: the design shows several
   * such rows, and inventing a placeholder would be an improvement the migration forbids
   * (Rule 1 clause 3).
   */
  async readProfileFields(): Promise<ProfileField[]> {
    const rows = this.page.locator(`${PROFILE_TABLE} tr`).filter({ visible: true });
    if ((await rows.count()) === 0) return [];
    const read = await rows.evaluateAll(readProfileRows);
    return read.filter((row): row is ProfileField => row !== null);
  }

  /**
   * The General tab's account rows (AAP 0.10.1 W3, from `GET /clients/{id}/accounts`). The tab is
   * activated first because the accounts tables live on it, and `[]` is returned when the client has
   * no account table at all — the design's own raster shows the empty work area, so an empty answer
   * is a legitimate state of this screen rather than an error.
   */
  async readAccounts(): Promise<AccountRow[]> {
    await this.showTab(GENERAL_TAB);
    const rows = this.page.locator('table tr').filter({ visible: true });
    if ((await rows.count()) === 0) return [];
    const read = await rows.evaluateAll(readAccountRows);
    return read.filter((row): row is AccountRow => row !== null);
  }

  /**
   * Opens the loan account whose account number is `accountNo` and waits for the loan record's
   * route (AAP 0.10.1 W5 and W6 reach the loan record this way). The legacy rows carry no link: the
   * route is issued from the row's own click handler, so the account-number cell is what is clicked.
   */
  async openLoanAccount(accountNo: string): Promise<void> {
    await this.showTab(GENERAL_TAB);
    const row = this.page
      .locator('table tr')
      .filter({ has: this.page.locator(`td:first-child:text-is(${JSON.stringify(accountNo)})`) })
      .filter({ visible: true })
      .first();
    await row.locator('td').first().click();
    await this.hashStartsWith(LOAN_ACCOUNT_ROUTE);
  }

  /**
   * The Identities tab's identifier rows (AAP 0.10.1 W3, from `GET /clients/{id}/identifiers`). The
   * tab is activated first, as `readAccounts()` does for General, and `[]` is returned when the
   * client has no identifier — the legacy table is hidden until the tab's request answers with rows.
   */
  async readIdentifiers(): Promise<IdentifierRow[]> {
    await this.showTab(IDENTITIES_TAB);
    const rows = this.page.locator(`${TAB_PANEL}.active table tr`).filter({ visible: true });
    if ((await rows.count()) === 0) return [];
    const read = await rows.evaluateAll(readIdentifierRows);
    return read.filter((row): row is IdentifierRow => row !== null);
  }

  /**
   * Starts a new loan application from the record and waits for its route
   * (AAP 0.10.1 W4; `#/newclientloanaccount/:clientId`).
   */
  async startNewLoan(): Promise<void> {
    await this.startAction(NEW_LOAN_LABEL);
    await this.hashStartsWith(NEW_LOAN_ROUTE);
  }

  /**
   * Starts a new savings application from the record and waits for its route
   * (AAP 0.10.1 W8; `#/new_client_saving_application/:clientId`).
   */
  async startNewSaving(): Promise<void> {
    await this.startAction(NEW_SAVING_LABEL);
    await this.hashStartsWith(NEW_SAVING_ROUTE);
  }

  /**
   * Opens the client's edit form and waits for its route (AAP 0.10.1 "Client list and edit";
   * `#/editclient/:id`).
   */
  async startEdit(): Promise<void> {
    await this.startAction(EDIT_LABEL);
    await this.hashStartsWith(EDIT_CLIENT_ROUTE);
  }

  /**
   * The record header locator: the title block the whole screen settles behind
   * (AAP 0.2.3 `RecordHeader`). Confirm against the running legacy app.
   */
  private recordHeader(): Locator {
    return this.page.locator(RECORD_HEADER).first();
  }

  /**
   * The address the harness opens the legacy app at (Rule 2): `LEGACY_URL` with the two query
   * parameters that make it talk to this run's Fineract — without them the legacy app resolves a
   * public demo host, which Rule 2 forbids — plus `hash` when a route is asked for.
   */
  private entryUrl(hash?: string): string {
    const query = `?baseApiUrl=${encodeURIComponent(FINERACT_URL)}&tenantIdentifier=${encodeURIComponent(TENANT_ID)}`;
    return hash === undefined ? `${LEGACY_URL}/${query}` : `${LEGACY_URL}/${query}${hash}`;
  }

  /**
   * Moves the loaded legacy app to `hash`, keeping the query parameters of {@link entryUrl} (Rule 2).
   *
   * The jump is resolved against the page's own address rather than the configured base URL, because
   * a base-URL-relative jump would drop those parameters. If the AngularJS router does not react to
   * the same-document jump, `location.hash` is set directly, which raises the `hashchange` it
   * listens for, and a failure after that names the hash the app is actually showing.
   */
  private async gotoHash(hash: string): Promise<void> {
    const current = this.page.url();
    if (current.startsWith(LEGACY_URL)) {
      await this.page.goto(new URL(hash, current).href);
    } else {
      await this.page.goto(this.entryUrl(hash));
    }
    if (await this.hashSettles(hash)) return;
    await this.page.evaluate((target: string) => {
      window.location.hash = target;
    }, hash);
    if (await this.hashSettles(hash)) return;
    const shown = await this.page.evaluate(() => window.location.hash);
    throw new Error(`The legacy app did not move to ${hash}; it is showing ${shown}.`);
  }

  /** Whether the page's hash has become `hash` within {@link HASH_SETTLE_TIMEOUT_MS}. */
  private async hashSettles(hash: string): Promise<boolean> {
    try {
      await this.page.waitForFunction((target: string) => window.location.hash === target, hash, {
        timeout: HASH_SETTLE_TIMEOUT_MS,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Waits until the page's hash starts with `prefix` — the route an action led to. */
  private async hashStartsWith(prefix: string): Promise<void> {
    await this.page.waitForFunction((wanted: string) => window.location.hash.startsWith(wanted), prefix);
  }

  /**
   * Makes the tab labelled `label` the active one, unless it already is (AAP 0.2.3 `TabStrip`). The
   * readers call it before reading a pane's content, because `uib-tabset` keeps every pane in the
   * document and only the active one is visible.
   */
  private async showTab(label: string): Promise<void> {
    const active = this.page.locator(`${ACTIVE_TAB}:text-is(${JSON.stringify(label)})`);
    if ((await active.count()) > 0) return;
    await this.selectTab(label);
  }

  /** The tab strip's link whose rendered text is exactly `label`. Confirm against the running legacy app. */
  private tabLink(label: string): Locator {
    return this.page.locator(`${TAB_STRIP} a:text-is(${JSON.stringify(label)})`).first();
  }

  /**
   * The record's joined action group: the primary-button group of the active tab
   * (AAP 0.2.3 `ActionButtonGroup`). Confirm against the running legacy app.
   */
  private actionGroup(): Locator {
    return this.page.locator(ACTION_GROUP).filter({ visible: true }).first();
  }

  /** The `More` dropdown's menu inside the action group (AAP 0.2.3 `ActionButtonGroup`). */
  private actionMenu(): Locator {
    return this.actionGroup().locator(ACTION_MENU);
  }

  /**
   * The `More` dropdown's toggle. `uib-dropdown` marks its toggle with `dropdown-toggle`; a build
   * that does not leaves the rendered label as the only handle.
   */
  private async moreToggle(): Promise<Locator> {
    const toggle = this.actionGroup().locator('.dropdown-toggle').filter({ visible: true });
    if ((await toggle.count()) > 0) return toggle.first();
    return this.labelled(this.actionGroup(), MORE_LABEL).first();
  }

  /** The visible elements of `scope` whose rendered text is exactly `label`. */
  private labelled(scope: Locator, label: string): Locator {
    return scope.getByText(label, { exact: true }).filter({ visible: true });
  }

  /** The rendered text of every visible element of `scope`, trimmed, without the empty icon-only ones. */
  private async readVisibleLabels(scope: Locator): Promise<string[]> {
    const labels = await scope.filter({ visible: true }).allInnerTexts();
    return labels.map(normalize).filter((label) => label.length > 0);
  }

  /** Closes the `More` menu again when it is open, so a read leaves the screen as it found it. */
  private async closeActionMenu(): Promise<void> {
    const menu = this.actionMenu().first();
    if ((await this.actionMenu().count()) === 0 || !(await menu.isVisible())) return;
    const toggle = await this.moreToggle();
    await toggle.click();
    await menu.waitFor({ state: 'hidden' });
  }
}

