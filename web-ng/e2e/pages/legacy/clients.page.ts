/** Legacy-baseline page object for the client screens of the unchanged AngularJS application served on port 9090 — the `legacy` project of the parity suite (AAP 0.8.1 tree `pages/legacy/*.page.ts`, AAP 0.11.1 row 47) (AAP 0.10.1, Rule 2, AAP 0.3.4, Rule 1 clause 2). */
import type { Locator, Page } from '@playwright/test';
import { FINERACT_URL, LEGACY_URL, TENANT_ID, formatFineractDate } from '../../seed/fixtures';
import { chooseOption, readChosenOptions } from './chosen';

/** One row of the client list, as the report compares it (AAP 0.10.1 W3, AAP 0.2.1 Step 2) (AAP 0.10.5). */
export interface ClientRow {
  /** Name column — the client's display name (`{{client.displayName}}`). */
  readonly name: string;
  /** Client number column — `{{client.accountNo}}`, e.g. `000000002`. */
  readonly clientNumber: string;
  /** Office column — `{{client.officeName}}`. */
  readonly office: string;
  /** Staff column — `{{client.staffName}}`; empty for an unassigned client. */
  readonly staff: string;
  /** The status swatch's raw class attribute, e.g. `fa fa-stop statusactive`. */
  readonly statusClass: string;
}

/** One row's status swatch, addressed by its 0-based position among the rows actually rendered. */
export interface StatusSwatchSummary {
  /** 0-based index of the row the swatch belongs to. */
  readonly rowIndex: number;
  /** The swatch's raw class attribute; `''` when the row carries no swatch. */
  readonly className: string;
}

/** One row of the global search results (`#/search/:query`). */
export interface SearchResultRow {
  /** The row's link text — the entity's display name. */
  readonly primaryText: string;
  /** The line below it, e.g. `Entity:CLIENT | Office:Head Office`; `''` when absent. */
  readonly secondaryText: string;
  /** The row's status swatch class; `''`, because the results list renders no swatch. */
  readonly statusClass: string;
}

/** One option of a dropdown, as the page offers it. */
export interface SelectOptionSummary {
  /** The `<option>` value — what the legacy form posts to Fineract. */
  readonly value: string;
  /** The visible label, trimmed. */
  readonly label: string;
}

/** The values {@link ClientsPage.fillClientForm} writes into the client form (Rule 1 clause 3). */
export interface ClientFormValues {
  /** Office to select by its visible label, e.g. `Head Office`; already chosen on the edit form. */
  readonly officeName?: string;
  /** Staff to select by its visible label, e.g. `Officer, Parity` — the name Fineract composes from a staff member's last and first names, which is what the dropdown shows; a loan officer is optional. */
  readonly staffName?: string;
  /** First name (`#firstname`) — required by the form on the person branch. */
  readonly firstName: string;
  /** Last name (`#lastname`) — required by the form on the person branch. */
  readonly lastName: string;
  /** External identifier (`#externalId`), optional in the legacy form. */
  readonly externalId?: string;
  /** Mobile number (`#mobileNo`), optional in the legacy form. */
  readonly mobileNo?: string;
  /** Submission date (`#submittedon`); sent as `dd MMMM yyyy`, the legacy datepicker's own format. */
  readonly submittedDate?: Date;
  /** Whether the client is created active (`#activeCheckbox`). */
  readonly active?: boolean;
  /** Activation date (`#activationDate`), rendered only once the active checkbox is ticked. */
  readonly activationDate?: Date;
}

/** The five client lifecycle actions the migration keeps (AAP 0.7.2 `ClientActionRequest`, AAP 0.9.1 scope group 2). */
export type ClientLifecycleAction = 'activate' | 'close' | 'reject' | 'withdraw' | 'reactivate';

/** The legacy screen root every in-scope route renders: `div.content-container` (clients.html:1, createclient.html:2, clientactions.html:1, views/search/glresults.html:1). */
const SCREEN_ROOT = '.content-container';

/** The card that holds the list. Legacy renders it as `div.card` with a `.toolbar` heading (clients.html:7-9); the new application renders the same card as a Bootstrap `.panel` (AAP 0.2.3 `PanelCard`, AAP 0.5.2). */
const SCREEN_CARD = '.panel, .card';

/** The list table — `table.table` (clients.html:51). */
const LIST_TABLE = '.table';

/** One list row — `table.table tbody tr` (clients.html:63-75). */
const LIST_ROW = '.table tbody tr';

/** One column heading — `table.table thead th` (clients.html:52-60). */
const COLUMN_HEADER = '.table thead th';

/** The status swatch inside a cell. Legacy paints it as `<i class="fa fa-stop {{client.status.code | StatusLookup}}">` (clients.html:70), where the filter answers `statusactive`, `statuspending`, `statusclosed` (AAP 0.2.3, AAP 0.10.5). */
const STATUS_SWATCH = [
  'i.fa-stop',
  'i.fa-circle',
  '.status-swatch',
  '.status-active',
  '.status-pending',
  '.status-closed',
  '.status-rejected',
  '.status-withdraw',
  '.statusactive',
  '.statuspending',
  '.statusclosed',
  '.statusrejected',
  '.statuswithdraw',
].join(', ');

/** The explicit empty state. AAP 0.5.2 defines it as a `.text-center.text-muted` block inside the card body; the legacy card holds its body as `.content` and the new app as `.panel-body`, so both containers are listed. */
const EMPTY_STATE = [
  '.panel-body .text-center.text-muted',
  '.panel .text-center.text-muted',
  '.card .content .text-center.text-muted',
  '.card .text-center.text-muted',
].join(', ');

/** The list toolbar's client-side filter box — `input[ng-model="filterText"]` inside the first `.col-md-4` of the toolbar form (clients.html:18-20). */
const LIST_FILTER = 'input[ng-model="filterText"], input[data-ng-model="filterText"]';

/** The toolbar's server-side "find" box — `input[data-ng-model="searchText"]` inside the `.input-group` beside the blue search button (clients.html:24-26). */
const LIST_FIND = 'input[data-ng-model="searchText"], input[ng-model="searchText"]';

/** The toolbar's blue search submission button — `button.btn.btn-primary` inside `.input-group-btn` (clients.html:28-30). */
const LIST_SEARCH_BUTTON = '.input-group-btn button.btn.btn-primary, .input-group-btn .btn.btn-primary';

/** The navbar global search field — `input#search` (views/_topnavbar.html:119). */
const SEARCH_FIELD = [
  '#search',
  'input[data-ng-model="search.query"]',
  '.navbar-form input[type="text"]',
  '.navbar-form input[type="search"]',
].join(', ');

/** The navbar scope control, native-select form. The new application replaces the legacy dropdown with an attached native `<select>` (AAP 0.2.3 `GlobalSearch`, AAP 0.10.5 item 2), so this half of the pair only exists on. */
const SEARCH_SCOPE_SELECT = '.navbar-form select, form.navbar-form select';

/** The navbar scope control, legacy form: a Bootstrap dropdown whose toggle is `button.btn.btn-default.btn-sm` inside `div.input-group-btn.search-panel` (views/_topnavbar.html:121-124). */
const SEARCH_SCOPE_TOGGLE =
  '.navbar-form .input-group-btn.search-panel button, .navbar-form .input-group-btn button.btn';

/** One scope entry of that dropdown: `li` elements produced by `ng-repeat="searchScope in searchScopes"` (views/_topnavbar.html:125-126). */
const SEARCH_SCOPE_ITEMS = '.navbar-form .input-group-btn ul li';

/** One global search result — `div.blockquoteresult` per `ng-repeat="result in searchResults"` (views/search/glresults.html:10-11). */
const SEARCH_RESULT = '.blockquoteresult';

/** Where a rendered message may live, most specific first; {@link ClientsPage.readNotifications} stops at the first candidate that renders something visible. - `.alert.alert-danger` — the `api-validate` block every (AAP 0.10.5). */
const NOTIFICATION_SOURCES = [
  'div.alert.alert-danger',
  'div.alert.alert-success',
  'div.alert.alert-info',
  'div.alert.alert-warning',
  '.notification-container .notification-list li h4',
];

/** Where a validation message may live, from the two selectors AAP 0.7.4 fixes (`.alert.alert-danger` and `.help-block` inside `.has-error`) plus legacy's own field-level markup, `<small class="error required">`. */
const VALIDATION_ERROR_SOURCES = ['div.alert.alert-danger', '.has-error .help-block', 'small.error'];

/** How long a navigation that the click itself decides — the list row that may or may not be wired to the record, {@link ClientsPage.openClient} — is given before the documented fallback runs. */
const OPTIONAL_NAVIGATION_TIMEOUT_MS = 10_000;

/** One option of a `<select>`, as a page-side function reports it. */
interface OptionPair {
  readonly value: string;
  readonly label: string;
}

/** One table row as the document holds it, serialised out of the page in a single round trip. */
interface RowSnapshot {
  /** Every cell's rendered text, in column order, whitespace normalised. */
  readonly cells: readonly string[];
  /** Every cell's status-swatch class attribute, in column order; `''` where a cell has none. */
  readonly swatchClasses: readonly string[];
}

/** One search result row as the document holds it. */
interface SearchRowSnapshot {
  readonly primaryText: string;
  readonly secondaryText: string;
  readonly statusClass: string;
}

/** The column position of each compared field; `-1` when the table has no such column. */
interface ColumnIndexes {
  readonly name: number;
  readonly clientNumber: number;
  readonly office: number;
  readonly staff: number;
  readonly status: number;
}

/** Which heading each compared field comes from. Headings are read as rendered — translated by the same `app/global-translations` files both applications load — and matched here rather than by column position, so a column (AAP 0.2.1). */
const COLUMN_HEADINGS: readonly { readonly field: keyof Omit<ColumnIndexes, 'status'>; readonly headings: readonly string[] }[] =
  [
    { field: 'name', headings: ['name', 'client name', 'display name'] },
    {
      field: 'clientNumber',
      headings: ['client number', 'client no', 'clientno', 'account number', 'account no'],
    },
    { field: 'office', headings: ['office', 'branch'] },
    { field: 'staff', headings: ['staff', 'loan officer', 'officer'] },
  ];

/** The heading the status swatch sits under. */
const STATUS_HEADINGS: readonly string[] = ['status'];

/** One navbar search scope: the value legacy sends as the `resource` query parameter, and every spelling a caller may pass to {@link ClientsPage.searchGlobal}. The values and their order are `searchScopes` in (AAP 0.10.5). */
const SEARCH_SCOPES: readonly { readonly legacyValue: string; readonly aliases: readonly string[] }[] = [
  {
    legacyValue: 'clients,clientIdentifiers,groups,savings,shares,loans',
    aliases: ['all'],
  },
  { legacyValue: 'clients,clientIdentifiers', aliases: ['clients', 'client'] },
  { legacyValue: 'groups', aliases: ['groups'] },
  { legacyValue: 'loans', aliases: ['loans'] },
  { legacyValue: 'shares', aliases: ['shares'] },
  { legacyValue: 'savings', aliases: ['savings'] },
];

/** Collapses runs of whitespace and trims, which is how every reader reports rendered text. */
function normaliseText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Lower-cases a heading and reduces it to its words, so punctuation cannot defeat a match. */
function headingKey(text: string): string {
  return normaliseText(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Keeps the first occurrence of each value, in order, dropping blanks. */
function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const value of values) {
    if (value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    kept.push(value);
  }
  return kept;
}

/** The cell at `index`, or `''` when the table has no such column or the cell is empty. */
function cellAt(cells: readonly string[], index: number): string {
  return index < 0 ? '' : (cells[index] ?? '');
}

/** The position of the first heading matching one of `headings`, or `-1`. */
function columnIndex(headings: readonly string[], candidates: readonly string[]): number {
  return headings.findIndex((heading) => {
    const key = headingKey(heading);
    return candidates.some((candidate) => key === candidate || key.startsWith(`${candidate} `));
  });
}

/** Resolves every compared field to its column position for the given rendered headings. */
function resolveColumns(headings: readonly string[]): ColumnIndexes {
  const positions: Record<string, number> = {};
  for (const { field, headings: candidates } of COLUMN_HEADINGS) {
    positions[field] = columnIndex(headings, candidates);
  }
  return {
    name: positions['name'] ?? -1,
    clientNumber: positions['clientNumber'] ?? -1,
    office: positions['office'] ?? -1,
    staff: positions['staff'] ?? -1,
    status: columnIndex(headings, STATUS_HEADINGS),
  };
}

/** Runs inside the legacy page: one row's cell texts and status-swatch classes. */
function readRowSnapshot(element: HTMLElement | SVGElement, swatchSelector: string): RowSnapshot {
  const cells = Array.from(element.querySelectorAll('td'));
  return {
    cells: cells.map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim()),
    swatchClasses: cells.map((cell) => {
      const swatch = cell.querySelector(swatchSelector);
      return swatch === null ? '' : (swatch.getAttribute('class') ?? '').trim();
    }),
  };
}

/** Runs inside the legacy page: one search result's link text, its information line and any status swatch class. */
function readSearchRowSnapshot(element: HTMLElement | SVGElement, swatchSelector: string): SearchRowSnapshot {
  const link = element.querySelector('a');
  const lines: string[] = [];
  for (const span of Array.from(element.querySelectorAll('span'))) {
    if (span.querySelector('a') !== null) continue;
    const text = (span.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length > 0) lines.push(text);
  }
  const swatch = element.querySelector(swatchSelector);
  return {
    primaryText: (link?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    secondaryText: lines.join(' '),
    statusClass: swatch === null ? '' : (swatch.getAttribute('class') ?? '').trim(),
  };
}

/** Runs inside the page: the options of a `<select>`, in document order. */
function readOptionPairs(element: HTMLElement | SVGElement): OptionPair[] {
  if (!(element instanceof HTMLSelectElement)) return [];
  return Array.from(element.options).map((option) => ({
    value: option.value,
    label: (option.textContent ?? '').replace(/\s+/g, ' ').trim(),
  }));
}

/** Runs inside the page: sets a text input's value and tells AngularJS about it. */
function setNativeInputValue(element: HTMLElement | SVGElement, text: string): void {
  if (!(element instanceof HTMLInputElement)) return;
  element.value = text;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Runs inside the page: a `<select>`'s tag name, lower-cased, used to report a field that resolved to something other than a dropdown. */
function readTagName(element: HTMLElement | SVGElement): string {
  return element.tagName.toLowerCase();
}

/** The baseline page object for the legacy application's client screens: the client list, the create and edit forms, the lifecycle action forms and the global search results. */
export class ClientsPage {
  constructor(private readonly page: Page) {}

  // --------------------------------------------------------------------------------------------- Navigation ---------------------------------------------------------------------------------------------

  /** Composes an entry address for the legacy application (Rule 2, AAP 0.3.4). */
  private entryUrl(hash?: string): string {
    const query =
      `?baseApiUrl=${encodeURIComponent(FINERACT_URL)}` +
      `&tenantIdentifier=${encodeURIComponent(TENANT_ID)}`;
    return `${LEGACY_URL}/${query}${hash ?? ''}`;
  }

  /** Navigates to a legacy hash route, keeping the entry query string, and waits for the screen root (Rule 2, AAP 0.3.4). */
  private async gotoHash(hash: string): Promise<void> {
    const target = hash.startsWith('#') ? hash : `#${hash}`;
    const current = this.page.url();
    if (!current.startsWith(LEGACY_URL)) {
      await this.page.goto(this.entryUrl(target), { waitUntil: 'domcontentloaded' });
    } else {
      await this.page.goto(new URL(target, current).href, { waitUntil: 'domcontentloaded' });
      if (!this.page.url().includes(target)) {
        await this.page.evaluate((next: string) => {
          window.location.hash = next;
        }, target);
      }
    }
    await this.page.locator(SCREEN_ROOT).first().waitFor({ state: 'visible' });
  }

  /** The first element any of `selectors` matches, tried in order. */
  private async firstOf(selectors: readonly string[]): Promise<Locator> {
    for (const selector of selectors) {
      const found = this.page.locator(selector);
      if ((await found.count()) > 0) return found.first();
    }
    throw new Error(
      `The legacy client screen renders none of the elements this reader needs: ${selectors.join(
        ' | ',
      )}. Confirm the markup against the running legacy app and update the selector list in this file.`,
    );
  }

  /** The rendered text of every visible match of `selector`, whitespace-normalised and in document order. */
  private async visibleTexts(selector: string): Promise<string[]> {
    const matches = this.page.locator(selector);
    const total = await matches.count();
    const texts: string[] = [];
    for (let index = 0; index < total; index += 1) {
      const match = matches.nth(index);
      if (!(await match.isVisible())) continue;
      const text = normaliseText(await match.innerText());
      if (text.length > 0) texts.push(text);
    }
    return texts;
  }

  /** Whether the address hash starts with `prefix` within {@link OPTIONAL_NAVIGATION_TIMEOUT_MS}, answering `false` instead of throwing so a caller can run its documented fallback. */
  private async waitForHashPrefix(prefix: string): Promise<boolean> {
    return this.page
      .waitForURL((url) => url.hash.startsWith(prefix), { timeout: OPTIONAL_NAVIGATION_TIMEOUT_MS })
      .then(
        () => true,
        () => false,
      );
  }

  /** Clicks the first visible match of `selector`, reporting whether it found one. */
  private async clickFirstVisible(selector: string): Promise<boolean> {
    const matches = this.page.locator(selector);
    const total = await matches.count();
    for (let index = 0; index < total; index += 1) {
      const candidate = matches.nth(index);
      if (!(await candidate.isVisible())) continue;
      await candidate.click();
      return true;
    }
    return false;
  }

  /** Clicks the screen's primary submit, one click and nothing more — no retry and no second click, because a Fineract lifecycle action is not idempotent (AAP 0.1.1 duplicate-submission rule) (AAP 0.5.2). */
  private async clickPrimarySubmit(): Promise<void> {
    const cascade = ['form .btn.btn-primary[type="submit"]', 'form .btn.btn-primary', '.btn.btn-primary'];
    for (const selector of cascade) {
      if (await this.clickFirstVisible(selector)) return;
    }
    throw new Error(
      'The screen renders no visible .btn.btn-primary to submit. Confirm the legacy form markup ' +
        'against the running legacy app.',
    );
  }

  /** The list's rows as locators, in document order. */
  private listRows(): Locator {
    return this.page.locator(LIST_ROW);
  }

  /** The rows the screen actually renders, in document order. Legacy hides a closed client's row with `ng-show` rather than removing it (clients.html:65), so an unfiltered read would report rows the user cannot see — and the. */
  private async visibleRows(): Promise<Locator[]> {
    const rows = this.listRows();
    const total = await rows.count();
    const visible: Locator[] = [];
    for (let index = 0; index < total; index += 1) {
      const row = rows.nth(index);
      if (await row.isVisible()) visible.push(row);
    }
    return visible;
  }

  // --------------------------------------------------------------------------------------------- Client list (#/clients) — W2's entry point and W3's list half.

  /** Opens the client list and waits for the "List of Clients" card to render its table (AAP 0.10.1). */
  async open(): Promise<void> {
    await this.gotoHash('#/clients');
    await this.page.locator(SCREEN_CARD).first().waitFor({ state: 'visible' });
    await this.page
      .locator(`${LIST_TABLE}, ${EMPTY_STATE}`)
      .first()
      .waitFor({ state: 'visible' });
  }

  /** Types into the toolbar's filter box, which filters the rendered rows client-side (AAP 0.2.3 `FilterToolbar`). */
  async filterList(text: string): Promise<void> {
    const field = await this.firstOf([LIST_FILTER, '.form-group .col-md-4 input.form-control']);
    await field.fill(text);
    await field.press('End');
  }

  /** Types into the toolbar's server-side "find" box without submitting it (AAP 0.2.3 `FilterToolbar`); {@link submitFilter} performs the submission, so a caller can set several toolbar controls before one query is sent.. */
  async findList(text: string): Promise<void> {
    const field = await this.firstOf([LIST_FIND, '.input-group input.form-control']);
    await field.fill(text);
  }

  /** Clicks the toolbar's blue search button, which is what submits the "find" box (clients.html:27-31; AAP 0.2.3 `FilterToolbar`). */
  async submitFilter(): Promise<void> {
    const button = await this.firstOf([LIST_SEARCH_BUTTON, '.input-group-btn button']);
    await button.click();
  }

  /** The list's column headings, in rendered order and trimmed (AAP 0.2.1 Step 2's six columns; AAP 0.2.3 `ClientList`). */
  async readColumnHeaders(): Promise<string[]> {
    const headings = this.page.locator(COLUMN_HEADER);
    const total = await headings.count();
    const texts: string[] = [];
    for (let index = 0; index < total; index += 1) {
      texts.push(normaliseText(await headings.nth(index).innerText()));
    }
    return texts;
  }

  /** The rows the list renders, one {@link ClientRow} each, with every field read from the column its heading names (AAP 0.10.1 W3's displayed-data comparison) (AAP 0.2.1, AAP 0.10.5). */
  async readRows(): Promise<ClientRow[]> {
    const columns = resolveColumns(await this.readColumnHeaders());
    const rows: ClientRow[] = [];
    for (const row of await this.visibleRows()) {
      const snapshot = await row.evaluate(readRowSnapshot, STATUS_SWATCH);
      rows.push({
        name: cellAt(snapshot.cells, columns.name),
        clientNumber: cellAt(snapshot.cells, columns.clientNumber),
        office: cellAt(snapshot.cells, columns.office),
        staff: cellAt(snapshot.cells, columns.staff),
        statusClass: cellAt(snapshot.swatchClasses, columns.status),
      });
    }
    return rows;
  }

  /** Each rendered row's status swatch, addressed by its 0-based row position (AAP 0.2.3 `StatusSwatch`, AAP 0.10.5 item 11). */
  async readStatusSwatches(): Promise<StatusSwatchSummary[]> {
    const swatches: StatusSwatchSummary[] = [];
    const rows = await this.visibleRows();
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const snapshot = await rows[rowIndex].evaluate(readRowSnapshot, STATUS_SWATCH);
      swatches.push({
        rowIndex,
        className: snapshot.swatchClasses.find((className) => className.length > 0) ?? '',
      });
    }
    return swatches;
  }

  /** Opens one client's record by clicking the row whose first cell shows `name` (AAP 0.2.1 Step 2's trigger, AAP 0.10.1 W3). */
  async openClient(name: string): Promise<void> {
    const nameCell = this.page
      .locator(`.table tbody tr td:first-child:text-is(${JSON.stringify(name)})`)
      .first();
    await nameCell.waitFor({ state: 'visible' });
    await nameCell.locator('xpath=..').click();
    if (await this.waitForHashPrefix('#/viewclient/')) return;
    await nameCell.click();
    await this.page.waitForURL((url) => url.hash.startsWith('#/viewclient/'));
  }

  /** The text of the card's explicit empty state, or `''` when the screen renders none (AAP 0.5.2; AAP 0.7.4 lists the empty state as a required screen state). */
  async readEmptyState(): Promise<string> {
    const empty = this.page.locator(EMPTY_STATE);
    if ((await empty.count()) === 0) return '';
    const first = empty.first();
    if (!(await first.isVisible())) return '';
    return normaliseText(await first.innerText());
  }

  /** The messages the screen is currently showing, deduplicated, and `[]` when it shows none (AAP 0.2.3 `Notification`, AAP 0.7.4's error display). */
  async readNotifications(): Promise<string[]> {
    for (const selector of NOTIFICATION_SOURCES) {
      const texts = await this.visibleTexts(selector);
      if (texts.length > 0) return dedupe(texts);
    }
    return [];
  }

  // --------------------------------------------------------------------------------------------- Global search (#/search/:query) — W3's search half.

  /** Searches from the navbar's global search field, optionally in one named scope (AAP 0.2.3 `GlobalSearch`, AAP 0.3.4's search adjuncts; AAP 0.10.1 W3) (AAP 0.10.5). */
  async searchGlobal(query: string, scope?: string): Promise<void> {
    const field = await this.firstOf([SEARCH_FIELD, '.navbar-form input']);
    await field.waitFor({ state: 'visible' });
    if (scope !== undefined) await this.selectSearchScope(scope);
    await field.fill(query);
    await field.press('Enter');
    await this.page.waitForURL((url) => url.hash.startsWith('#/search/'));
  }

  /** The rendered search results, one {@link SearchResultRow} each (AAP 0.10.1 W3's displayed-data comparison). */
  async readSearchResults(): Promise<SearchResultRow[]> {
    const results = this.page.locator(SEARCH_RESULT);
    const total = await results.count();
    const rows: SearchResultRow[] = [];
    for (let index = 0; index < total; index += 1) {
      const result = results.nth(index);
      if (!(await result.isVisible())) continue;
      rows.push(await result.evaluate(readSearchRowSnapshot, STATUS_SWATCH));
    }
    return rows;
  }

  /** Selects one navbar search scope, on whichever control the screen renders (AAP 0.2.3). */
  private async selectSearchScope(scope: string): Promise<void> {
    const position = this.resolveScopePosition(scope);
    const known = SEARCH_SCOPES[position];
    const native = this.page.locator(SEARCH_SCOPE_SELECT);
    if ((await native.count()) > 0) {
      const select = native.first();
      const options = await select.evaluate(readOptionPairs);
      const wanted = normaliseText(scope).toLowerCase();
      const match = options.find(
        (option) =>
          option.value === scope ||
          option.value === known.legacyValue ||
          wanted === option.label.toLowerCase() ||
          known.aliases.includes(option.label.toLowerCase()),
      );
      if (match === undefined) {
        const offered = options.map((option) => `${option.value} (${option.label})`).join(', ');
        throw new Error(`The search scope control offers no option for "${scope}". Offered: ${offered}.`);
      }
      await select.selectOption({ value: match.value });
      return;
    }
    const toggle = await this.firstOf([SEARCH_SCOPE_TOGGLE]);
    await toggle.click();
    await this.page.locator(SEARCH_SCOPE_ITEMS).nth(position).click();
  }

  /** The position of `scope` in {@link SEARCH_SCOPES}, matching either its legacy value or one of its short names. @throws When the scope is unknown, listing the scopes that are known — a caller has a bug, and a silent no-op. */
  private resolveScopePosition(scope: string): number {
    const wanted = normaliseText(scope).toLowerCase();
    const position = SEARCH_SCOPES.findIndex(
      (entry) => entry.legacyValue === wanted || entry.aliases.some((alias) => alias === wanted),
    );
    if (position < 0) {
      const known = SEARCH_SCOPES.map((entry) => entry.aliases.join('/')).join(', ');
      throw new Error(`Unknown search scope "${scope}". Known scopes: ${known}.`);
    }
    return position;
  }

  // --------------------------------------------------------------------------------------------- Client forms (#/createclient, #/editclient/:id) — W2's create half.

  /** Opens the create form and waits for its first control to render (AAP 0.8.2's `createclient` route; AAP 0.10.1 W2). */
  async openCreateForm(): Promise<void> {
    await this.gotoHash('#/createclient');
    await this.page.locator('.form-control:visible').first().waitFor({ state: 'visible' });
  }

  /** Fills the fields `values` supplies and leaves every other field exactly as the screen rendered it (AAP 0.10.1 W2, AAP 0.7.2's `ClientCreateRequest` and `ClientEditRequest`) (Rule 1 clause 3). */
  async fillClientForm(values: ClientFormValues): Promise<void> {
    if (values.officeName !== undefined) {
      await chooseOption(this.page, await this.selectField('officeId', 'Office'), values.officeName);
    }
    if (values.staffName !== undefined) {
      await chooseOption(this.page, await this.selectField('staffId', 'Staff'), values.staffName);
    }
    const firstName = await this.textField('firstname', 'First name');
    await firstName.fill(values.firstName);
    const lastName = await this.textField('lastname', 'Last name');
    await lastName.fill(values.lastName);
    if (values.externalId !== undefined) {
      const externalId = await this.textField('externalId', 'External ID');
      await externalId.fill(values.externalId);
    }
    if (values.mobileNo !== undefined) {
      const mobileNo = await this.textField('mobileNo', 'Mobile number');
      await mobileNo.fill(values.mobileNo);
    }
    if (values.submittedDate !== undefined) {
      const submittedDate = await this.dateField('submittedon', 'Submitted on');
      await setLegacyDate(submittedDate, values.submittedDate);
    }
    if (values.active !== undefined) {
      const active = await this.checkboxField('activeCheckbox', 'Active');
      if ((await active.isChecked()) !== values.active) {
        if (values.active) {
          await active.check();
        } else {
          await active.uncheck();
        }
      }
    }
    if (values.activationDate !== undefined) {
      const activationDate = await this.dateField('activationDate', 'Activation date');
      await activationDate.waitFor({ state: 'visible' });
      await setLegacyDate(activationDate, values.activationDate);
    }
  }

  /** The options the dropdown beside `fieldLabel` offers, in document order (AAP 0.2.3 `SelectField`, AAP 0.6.2's template-driven option lists). */
  async readSelectOptions(fieldLabel: string): Promise<SelectOptionSummary[]> {
    const select = await this.selectByLabel(fieldLabel);
    const tagName = await select.evaluate(readTagName);
    if (tagName !== 'select') {
      throw new Error(
        `The field labelled "${fieldLabel}" resolved to a <${tagName}> rather than a dropdown. ` +
          'Confirm the legacy form markup against the running legacy app.',
      );
    }
    const pairs = await select.evaluate(readOptionPairs);
    if (!(await this.isChosen(select))) {
      return pairs.map((pair) => ({ value: pair.value, label: pair.label }));
    }
    const labels = await readChosenOptions(this.page, select);
    return labels.map((label, index) => ({ value: pairs[index]?.value ?? '', label }));
  }

  /** Submits the form with its primary button — exactly one click, no retry (AAP 0.1.1's duplicate-submission rule; AAP 0.10.1 W2). */
  async submitForm(): Promise<void> {
    await this.clickPrimarySubmit();
  }

  /** The validation messages the form is showing, deduplicated, and `[]` when it shows none (AAP 0.7.4's inline validation and server-error display). */
  async readValidationErrors(): Promise<string[]> {
    const texts: string[] = [];
    for (const selector of VALIDATION_ERROR_SOURCES) {
      texts.push(...(await this.visibleTexts(selector)));
    }
    return dedupe(texts);
  }

  /** A text input, addressed by a documented cascade: the id the legacy form gives it (createclient.html:55, :104, :137, :256), then its `name`, its `formControlName`, the input beside its label and finally its placeholder. */
  private async textField(id: string, label: string): Promise<Locator> {
    const labelSelector = `label:has-text(${JSON.stringify(label)})`;
    return this.firstOf([
      `#${id}`,
      `input[name="${id}"]`,
      `[formControlName="${id}"]`,
      `${labelSelector} ~ div input.form-control`,
      `input[placeholder*=${JSON.stringify(label)}]`,
    ]);
  }

  /** A dropdown, addressed by the same cascade: its legacy id (`select#officeId`, `select#staffId` — createclient.html:23, :33), its `name`, its `formControlName`, then the `<select>` beside its label. @param id Stable. */
  private async selectField(id: string, label: string): Promise<Locator> {
    const labelSelector = `label:has-text(${JSON.stringify(label)})`;
    return this.firstOf([
      `select#${id}`,
      `select[name="${id}"]`,
      `select[formControlName="${id}"]`,
      `${labelSelector} ~ div select`,
    ]);
  }

  /** A date input, addressed by its legacy id (`#submittedon`, `#activationDate` — createclient.html:281, :271), its `name`, its `formControlName`, then the input beside its label. @param id Stable identifier of the field. */
  private async dateField(id: string, label: string): Promise<Locator> {
    const labelSelector = `label:has-text(${JSON.stringify(label)})`;
    return this.firstOf([
      `#${id}`,
      `input[name="${id}"]`,
      `input[formControlName="${id}"]`,
      `${labelSelector} ~ div input.form-control, ${labelSelector} ~ input.form-control`,
    ]);
  }

  /** A checkbox, addressed by its legacy id (`#activeCheckbox` — createclient.html:263), its `formControlName`, then the checkbox inside or beside its label. @param id Stable identifier of the field, e.g. */
  private async checkboxField(id: string, label: string): Promise<Locator> {
    const labelSelector = `label:has-text(${JSON.stringify(label)})`;
    return this.firstOf([
      `#${id}`,
      `input[type="checkbox"][formControlName="${id}"]`,
      `${labelSelector} ~ div input[type="checkbox"], ${labelSelector} input[type="checkbox"]`,
    ]);
  }

  /** The `<select>` a visible label names, preferring one in the label's own cell and falling back to the next `<select>` in the document, which is what a label whose control sits further down the row needs. @param. */
  private async selectByLabel(fieldLabel: string): Promise<Locator> {
    const label = this.page.locator(`label:has-text(${JSON.stringify(fieldLabel)})`).first();
    const inCell = label.locator('xpath=following-sibling::div[1]//select');
    if ((await inCell.count()) > 0) return inCell.first();
    return label.locator('xpath=following::select[1]');
  }

  /** Whether a `<select>` is enhanced by the legacy chosen widget, either because the template asks for it with the `chosen` attribute (createclient.html:23, :33) or because the plugin's container already sits beside it.. */
  private async isChosen(select: Locator): Promise<boolean> {
    if ((await select.getAttribute('chosen')) !== null) return true;
    const container = select.locator('xpath=following-sibling::div[contains(@class,"chosen-container")]');
    return (await container.count()) > 0;
  }

  // --------------------------------------------------------------------------------------------- Client lifecycle actions (#/client/:id/:action) — W2's activate step.

  /** Opens one lifecycle action form for a client and waits for its first control (AAP 0.8.2's `client/:id/:action` route; AAP 0.7.2's `ClientActionRequest`) (AAP 0.3.4). */
  async openClientAction(clientId: number, action: ClientLifecycleAction): Promise<void> {
    await this.gotoHash(`#/client/${clientId}/${action}`);
    await this.page.locator('.form-control:visible').first().waitFor({ state: 'visible' });
  }

  /** Submits the action form with its primary button — exactly one click, no retry, so one click sends one request (AAP 0.1.1 duplicate-submission rule; AAP 0.10.1 W5's one-POST-per-action outcome). */
  async submitAction(): Promise<void> {
    await this.clickPrimarySubmit();
  }
}

/** Writes a date into a legacy datepicker input, in the text the Fineract payload carries (AAP 0.3.4, AAP 0.10.5). */
async function setLegacyDate(input: Locator, date: Date): Promise<void> {
  const text = formatFineractDate(date).date;
  await input.fill(text);
  await input.press('Escape');
  if (normaliseText(await input.inputValue()) === text) return;
  await input.evaluate(setNativeInputValue, text);
  const applied = normaliseText(await input.inputValue());
  if (applied === text) return;
  throw new Error(
    `The legacy date field shows "${applied}" after "${text}" was written to it. ` +
      'Confirm the datepicker binding against the running legacy app.',
  );
}

