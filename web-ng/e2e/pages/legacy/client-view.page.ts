/** Baseline page object for the legacy AngularJS application's single-client record: route `#/viewclient/:id` (app/scripts/routes.js:85), served from `LEGACY_URL` (AAP 0.10.1, Rule 1 clause 2, Rule 2, Rule 1 clause 3). */
import type { Locator, Page } from '@playwright/test';

import { FINERACT_URL, LEGACY_URL, TENANT_ID } from '../../seed/fixtures';

/** The record header's identity, as AAP 0.10.1 W3 compares it against the API's answer. */
export interface ClientViewHeader {
  /** Client name the record title renders (`displayName` in the API's answer). */
  displayName: string;
  /** Client number the inline metadata renders (`accountNo` in the API's answer). */
  clientNumber: string;
  /** External identifier, or `''` when the client has none — never a placeholder. */
  externalId: string;
  /** Assigned staff member's name, or `''` when no staff member is assigned. */
  staff: string;
  statusClass: string;
}

/** One row of the General tab's accounts table (AAP 0.10.1 W3, from `GET /clients/{id}/accounts`). */
export interface AccountRow {
  accountType: 'loan' | 'savings' | 'other';
  accountNo: string;
  productName: string;
  statusClass: string;
  balance: string;
}

/** One row of the Identities tab's identifier table (AAP 0.10.1 W3, from `GET /clients/{id}/identifiers`). */
export interface IdentifierRow {
  documentType: string;
  documentKey: string;
  statusClass: string;
}

/** AAP 0.2.3 `Breadcrumb`: `<ul class="breadcrumb">` holding the client's office and, when one is assigned, its staff member (app/views/clients/viewclient.html:2-5). */
const BREADCRUMB = '.breadcrumb';

/** AAP 0.2.3 `RecordHeader`: the record's title block `<h3 class="client-title">` (app/views/clients/viewclient.html:168). */
const RECORD_HEADER = '.client-title';

const RECORD_TITLE = `${RECORD_HEADER} strong`;

/** The record's status marker: `<i class="fa fa-circle {{client.status.code | StatusLookup}}">` (app/views/clients/viewclient.html:169) (AAP 0.10.5). */
const STATUS_DOT = `${RECORD_HEADER} i.fa-circle`;

const RECORD_METADATA = `${RECORD_HEADER} > small:last-child`;

/** AAP 0.2.3 `TabStrip`: the `<ul class="nav nav-tabs">` that `uib-tabset` renders (angular-bootstrap 1.3.2), holding the record's tabs — General, Identities, Documents, Notes and Credit Report on the legacy app, of which only General and Identities are in scope for the new one. */
const TAB_STRIP = '.nav-tabs';

const TAB_PANEL = '.tab-content .tab-pane';

const ACTIVE_TAB = `${TAB_STRIP} li.active > a`;

/** AAP 0.2.3 `ActionButtonGroup`: the joined primary-button group of the record (`<div class="col-md-11 col-sm-11 btn-group row pull-right">`, app/views/clients/viewclient.html:183) inside the active tab pane, together with the `More` dropdown it contains. */
const ACTION_GROUP = `${TAB_PANEL}.active .btn-group`;

const ACTION_MENU = '.dropdown-menu';

/** Tab labels as the legacy English translations render them: `label.heading.general` = "General" and `label.heading.identities` = "Identities" (app/global-translations/locale-en.json). */
const GENERAL_TAB = 'General';
const IDENTITIES_TAB = 'Identities';

/** Action labels as the legacy English translations render them: `label.button.more` = "More" and `label.button.newloan` = "New Loan" (app/scripts/models/clientStatus.js:90-110 and app/global-translations/locale-en.json). */
const MORE_LABEL = 'More';
const NEW_LOAN_LABEL = 'New Loan';

/** Hash prefixes of the routes the record's actions lead to: `location.path('/viewloanaccount/' + id)` in app/scripts/controllers/client/ViewClientController.js:145, and the action hrefs of app/scripts/models/clientStatus.js. */
const LOAN_ACCOUNT_ROUTE = '#/viewloanaccount/';
const NEW_LOAN_ROUTE = '#/newclientloanaccount/';

const HASH_SETTLE_TIMEOUT_MS = 2_000;

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Splits the record's inline metadata — `Client Number: … | External ID: … | Staff: …` — into its three runs (AAP 0.2.1). */
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

/** Runs inside the legacy page, so it references nothing from module scope — Playwright serialises the function and evaluates it in the document (AAP 0.10.1, AAP 0.10.5). */
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

/** Runs inside the legacy page, so it references nothing from module scope (AAP 0.10.1). */
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

/** The legacy application's single-client record (`#/viewclient/:id`) (AAP 0.10.1). */
export class ClientViewPage {
  private readonly page: Page;

  /** @param page The page of the `legacy` Playwright project, already authenticated by the login page object — the record requires a session because every read is a Fineract call. */
  constructor(page: Page) {
    this.page = page;
  }

  /** Opens the record of `clientId` (AAP 0.10.1 W3) — the entry point of W4 as well, because the "New Loan" action lives on this screen — and waits for the record header, which the profile card, the tab strip and the action group all settle after. */
  async open(clientId: number): Promise<void> {
    await this.gotoHash(`#/viewclient/${clientId}`);
    await this.recordHeader().waitFor({ state: 'visible' });
  }

  /** The breadcrumb text the record renders (AAP 0.2.1 Step 3 shows "Head Office /"). */
  async readBreadcrumb(): Promise<string> {
    const breadcrumb = this.page.locator(BREADCRUMB).first();
    await breadcrumb.waitFor({ state: 'visible' });
    return normalize(await breadcrumb.innerText());
  }

  /** The record header (AAP 0.10.1 W3, AAP 0.2.1 Step 3): the bold client name, the status dot's class attribute, and the inline client number, external id and staff member (AAP 0.10.5). */
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

  /** Every tab label the record renders, in DOM order (AAP 0.2.3 `TabStrip`) (Rule 1 clause 3, AAP 0.10.5). */
  async readTabs(): Promise<string[]> {
    const tabs = this.page.locator(`${TAB_STRIP} a`);
    await tabs.first().waitFor({ state: 'visible' });
    const labels = await tabs.allInnerTexts();
    return labels.map(normalize).filter((label) => label.length > 0);
  }

  /** Selects the tab labelled `label` and waits for it to become the active tab, so the caller reads the pane that click switched to (AAP 0.2.3). */
  async selectTab(label: string): Promise<void> {
    await this.tabLink(label).click();
    await this.page
      .locator(`${ACTIVE_TAB}:text-is(${JSON.stringify(label)})`)
      .waitFor({ state: 'visible' });
  }

  /** Every action label the record renders (AAP 0.2.3 `ActionButtonGroup`): the joined buttons of the active tab, then the entries of the `More` menu (AAP 0.10.5, Rule 1 clause 3). */
  async readActionLabels(): Promise<string[]> {
    const group = this.actionGroup();
    await group.waitFor({ state: 'visible' });
    await this.closeActionMenu();
    const buttons = await this.readVisibleLabels(group.locator('a, button'));
    await this.openActionMenu();
    const entries = await this.readVisibleLabels(this.actionMenu().locator('a'));
    await this.closeActionMenu();
    return [...buttons, ...entries];
  }

  /** Opens the `More` menu of the action group and waits for it to be visible (AAP 0.2.3 `ActionButtonGroup`). */
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

  /** Clicks the action whose rendered text is `label`, whether it is one of the joined buttons or an entry of the `More` menu (AAP 0.2.3 `ActionButtonGroup`). */
  async startAction(label: string): Promise<void> {
    const button = this.labelled(this.actionGroup(), label);
    if ((await button.count()) > 0) {
      await button.first().click();
      return;
    }
    await this.openActionMenu();
    const entry = this.labelled(this.actionMenu(), label);
    if ((await entry.count()) === 0) {
      // `readActionLabels()` names every action the record offers — the joined buttons as well as the menu's entries — and leaves the menu closed, which is the state a miss should leave the record in.
      const known = await this.readActionLabels();
      throw new Error(
        `"${label}" is neither a button nor a "More" entry of this client record. ` +
          `Actions: ${known.length === 0 ? 'none' : known.map((name) => `"${name}"`).join(', ')}.`,
      );
    }
    await entry.first().click();
  }

  /** The General tab's account rows (AAP 0.10.1 W3, from `GET /clients/{id}/accounts`). */
  async readAccounts(): Promise<AccountRow[]> {
    await this.showTab(GENERAL_TAB);
    const rows = this.page.locator('table tr').filter({ visible: true });
    if ((await rows.count()) === 0) return [];
    const read = await rows.evaluateAll(readAccountRows);
    return read.filter((row): row is AccountRow => row !== null);
  }

  /** Opens the loan account whose account number is `accountNo` and waits for the loan record's route (AAP 0.10.1 W5 and W6 reach the loan record this way). */
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

  /** The Identities tab's identifier rows (AAP 0.10.1 W3, from `GET /clients/{id}/identifiers`). */
  async readIdentifiers(): Promise<IdentifierRow[]> {
    await this.showTab(IDENTITIES_TAB);
    const rows = this.page.locator(`${TAB_PANEL}.active table tr`).filter({ visible: true });
    if ((await rows.count()) === 0) return [];
    const read = await rows.evaluateAll(readIdentifierRows);
    return read.filter((row): row is IdentifierRow => row !== null);
  }

  /** Starts a new loan application from the record and waits for its route (AAP 0.10.1 W4; `#/newclientloanaccount/:clientId`). */
  async startNewLoan(): Promise<void> {
    await this.startAction(NEW_LOAN_LABEL);
    await this.hashStartsWith(NEW_LOAN_ROUTE);
  }

  /** The record header locator: the title block the whole screen settles behind (AAP 0.2.3 `RecordHeader`). */
  private recordHeader(): Locator {
    return this.page.locator(RECORD_HEADER).first();
  }

  /** The address the harness opens the legacy app at (Rule 2): `LEGACY_URL` with the two query parameters that make it talk to this run's Fineract — without them the legacy app resolves a public demo host, which Rule 2 forbids. */
  private entryUrl(hash?: string): string {
    const query = `?baseApiUrl=${encodeURIComponent(FINERACT_URL)}&tenantIdentifier=${encodeURIComponent(TENANT_ID)}`;
    return hash === undefined ? `${LEGACY_URL}/${query}` : `${LEGACY_URL}/${query}${hash}`;
  }

  /** Moves the loaded legacy app to `hash`, keeping the query parameters of {@link entryUrl} (Rule 2). */
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

  private async hashStartsWith(prefix: string): Promise<void> {
    await this.page.waitForFunction((wanted: string) => window.location.hash.startsWith(wanted), prefix);
  }

  /** Makes the tab labelled `label` the active one, unless it already is (AAP 0.2.3 `TabStrip`). */
  private async showTab(label: string): Promise<void> {
    const active = this.page.locator(`${ACTIVE_TAB}:text-is(${JSON.stringify(label)})`);
    if ((await active.count()) > 0) return;
    await this.selectTab(label);
  }

  private tabLink(label: string): Locator {
    return this.page.locator(`${TAB_STRIP} a:text-is(${JSON.stringify(label)})`).first();
  }

  /** The record's joined action group: the primary-button group of the active tab (AAP 0.2.3 `ActionButtonGroup`). */
  private actionGroup(): Locator {
    return this.page.locator(ACTION_GROUP).filter({ visible: true }).first();
  }

  /** The `More` dropdown's menu inside the action group (AAP 0.2.3 `ActionButtonGroup`). */
  private actionMenu(): Locator {
    return this.actionGroup().locator(ACTION_MENU);
  }

  /** The `More` dropdown's toggle. `uib-dropdown` marks its toggle with `dropdown-toggle`; a build that does not leaves the rendered label as the only handle. */
  private async moreToggle(): Promise<Locator> {
    const toggle = this.actionGroup().locator('.dropdown-toggle').filter({ visible: true });
    if ((await toggle.count()) > 0) return toggle.first();
    return this.labelled(this.actionGroup(), MORE_LABEL).first();
  }

  private labelled(scope: Locator, label: string): Locator {
    return scope.getByText(label, { exact: true }).filter({ visible: true });
  }

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

