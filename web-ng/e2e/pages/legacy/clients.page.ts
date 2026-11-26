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

export interface StatusSwatchSummary {
  readonly rowIndex: number;
  readonly className: string;
}

/** One row of the global search results (`#/search/:query`). */
export interface SearchResultRow {
  readonly primaryText: string;
  /** The line below it, e.g. `Entity:CLIENT | Office:Head Office`; `''` when absent. */
  readonly secondaryText: string;
  /** The row's status swatch class; `''`, because the results list renders no swatch. */
  readonly statusClass: string;
}

export interface SelectOptionSummary {
  readonly value: string;
  readonly label: string;
}

/** The values {@link ClientsPage.fillClientForm} writes into the client form (Rule 1 clause 3). */
export interface ClientFormValues {
  readonly officeName?: string;
  /** Staff to select by its visible label, e.g. `Officer, Parity` — the name Fineract composes from a staff member's last and first names, which is what the dropdown shows; a loan officer is optional. */
  readonly staffName?: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly externalId?: string;
  readonly mobileNo?: string;
  /** Submission date (`#submittedon`); sent as `dd MMMM yyyy`, the legacy datepicker's own format. */
  readonly submittedDate?: Date;
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

/** The navbar scope control, native-select form. The new application replaces the legacy dropdown with an attached native `<select>` (AAP 0.2.3 `GlobalSearch`, AAP 0.10.5 item 2), so this half of the pair only exists on the new side. */
const SEARCH_SCOPE_SELECT = '.navbar-form select, form.navbar-form select';

/** The navbar scope control, legacy form: a Bootstrap dropdown whose toggle is `button.btn.btn-default.btn-sm` inside `div.input-group-btn.search-panel` (views/_topnavbar.html:121-124). */
const SEARCH_SCOPE_TOGGLE =
  '.navbar-form .input-group-btn.search-panel button, .navbar-form .input-group-btn button.btn';

/** One scope entry of that dropdown: `li` elements produced by `ng-repeat="searchScope in searchScopes"` (views/_topnavbar.html:125-126). */
const SEARCH_SCOPE_ITEMS = '.navbar-form .input-group-btn ul li';

/** One global search result — `div.blockquoteresult` per `ng-repeat="result in searchResults"` (views/search/glresults.html:10-11). */
const SEARCH_RESULT = '.blockquoteresult';

/** Where a rendered message may live, most specific first; {@link ClientsPage.readNotifications} stops at the first candidate that renders something visible. - `.alert.alert-danger` — the `api-validate` block every in-scope form renders for a Fineract error (AAP 0.10.5). */
const NOTIFICATION_SOURCES = [
  'div.alert.alert-danger',
  'div.alert.alert-success',
  'div.alert.alert-info',
  'div.alert.alert-warning',
  '.notification-container .notification-list li h4',
];

/** Where a validation message may live, from the two selectors AAP 0.7.4 fixes (`.alert.alert-danger` and `.help-block` inside `.has-error`) plus legacy's own field-level markup, `<small class="error required">` (createclient.html:60). */
const VALIDATION_ERROR_SOURCES = ['div.alert.alert-danger', '.has-error .help-block', 'small.error'];

/** The create form's own failure region: the `api-validate` directive renders Fineract's message in a `div.alert.alert-danger` above the fields (createclient.html:15), so a refused office-template read is visible there and nowhere else. */
const FORM_FAILURE = 'div.alert.alert-danger, api-validate .alert';

const OPTIONAL_NAVIGATION_TIMEOUT_MS = 10_000;

/** Ceiling for the create form's office list to arrive: the legacy controller reads the office template when the screen loads and assigns `scope.offices = data.officeOptions` from the answer, so `#officeId` carries no option for a moment after the form paints (`app/scripts/controllers/client/CreateClientController.js:5,48`; `app/views/clients/createclient.html:23-25`). */
const TEMPLATE_TIMEOUT_MS = 30_000;

const OPTION_POLL_INTERVAL_MS = 100;

/** How long a row the list already holds may take to become visible: the page in view is on screen when {@link ClientsPage.openClient} starts, so this covers a repaint and not a read. */
const LIST_ROW_TIMEOUT_MS = 5_000;

/** How long the toolbar's find may take to answer: its `GET /search` round trip replaces the rows, and the client it matched has to be visible before the record is opened. */
const SEARCH_TIMEOUT_MS = 30_000;

/** The find's own request: the controller submits the toolbar box with `globalSearch.search({query, resource: 'clients,clientIdentifiers', exactMatch})`, which is `GET <api>/search` carrying those query parameters (`app/scripts/controllers/client/ClientController.js:56`; `app/scripts/services/ResourceFactoryProvider.js:275-280`). Its query string is what separates it from a `/search/template` read. */
const SEARCH_PATH = '/search';

/** How often the list is re-read while a find settles, and how many consecutive readings that agree settle a find whose answer returns the rows already in view. */
const LIST_POLL_INTERVAL_MS = 100;
const LIST_SETTLE_READINGS = 3;

/** How long the table may take to repaint once the find has answered: the assignment it makes is a digest and not a request, so this bounds a render and never a round trip. */
const LIST_REPAINT_TIMEOUT_MS = 5_000;

interface OptionPair {
  readonly value: string;
  readonly label: string;
}

interface RowSnapshot {
  readonly cells: readonly string[];
  /** Every cell's status-swatch class attribute, in column order; `''` where a cell has none. */
  readonly swatchClasses: readonly string[];
}

interface SearchRowSnapshot {
  readonly primaryText: string;
  readonly secondaryText: string;
  readonly statusClass: string;
}

interface ColumnIndexes {
  readonly name: number;
  readonly clientNumber: number;
  readonly office: number;
  readonly staff: number;
  readonly status: number;
}

/** Which heading each compared field comes from. Headings are read as rendered — translated by the same `app/global-translations` files both applications load — and matched here rather than by column position, so a column inserted or reordered on one side shows up as a difference in that field instead of shifting every field after it (AAP 0.2.1). */
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

const STATUS_HEADINGS: readonly string[] = ['status'];

/** One navbar search scope: the value legacy sends as the `resource` query parameter, and every spelling a caller may pass to {@link ClientsPage.searchGlobal}. The values and their order are `searchScopes` in `app/scripts/controllers/main/MainController.js:183-196` (AAP 0.10.5). */
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

function normaliseText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function headingKey(text: string): string {
  return normaliseText(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

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

function cellAt(cells: readonly string[], index: number): string {
  return index < 0 ? '' : (cells[index] ?? '');
}

function columnIndex(headings: readonly string[], candidates: readonly string[]): number {
  return headings.findIndex((heading) => {
    const key = headingKey(heading);
    return candidates.some((candidate) => key === candidate || key.startsWith(`${candidate} `));
  });
}

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

function readOptionPairs(element: HTMLElement | SVGElement): OptionPair[] {
  if (!(element instanceof HTMLSelectElement)) return [];
  return Array.from(element.options).map((option) => ({
    value: option.value,
    label: (option.textContent ?? '').replace(/\s+/g, ' ').trim(),
  }));
}

function setNativeInputValue(element: HTMLElement | SVGElement, text: string): void {
  if (!(element instanceof HTMLInputElement)) return;
  element.value = text;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

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

  private listRows(): Locator {
    return this.page.locator(LIST_ROW);
  }

  /** The rows the screen actually renders, in document order. Legacy hides a closed client's row with `ng-show` rather than removing it (clients.html:65), so an unfiltered read would report rows the user cannot see — and the new app, which renders only what it received, would then differ for a reason that is not behavioural. */
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

  /** What the list shows right now, as one comparable string: every visible row's text in document order plus the card's empty state, so a reading taken before a find tells the page that find's answer produced from the page that was in view (AAP 0.10.2's displayed-data comparison). */
  private async listReading(): Promise<string> {
    const rows = await this.visibleRows();
    const texts: string[] = [];
    for (const row of rows) texts.push(normaliseText(await row.innerText()));
    return `${texts.join(' | ')}#${await this.readEmptyState()}`;
  }

  /** Waits until the list shows something other than `inView` — the find's own page, or no row with the empty state — or, when the answer was heard and the rows it returned are the ones already rendered, until {@link LIST_SETTLE_READINGS} consecutive readings agree, which is what makes a find answering the same rows safe. @throws When no search answer arrived and the table never moved, naming both waits: the rows a caller would then read are the find's predecessors, not its answer. */
  private async awaitListAnswered(find: string, inView: string, answered: boolean): Promise<void> {
    const attempts = Math.ceil(LIST_REPAINT_TIMEOUT_MS / LIST_POLL_INTERVAL_MS);
    let unchanged = 0;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if ((await this.listReading()) !== inView) return;
      unchanged = answered ? unchanged + 1 : 0;
      if (unchanged >= LIST_SETTLE_READINGS) return;
      await this.page.waitForTimeout(LIST_POLL_INTERVAL_MS);
    }

    throw new Error(
      `The legacy client list still shows the page it showed before the find for "${find}": no ` +
        `GET ${SEARCH_PATH} answer arrived within ${SEARCH_TIMEOUT_MS} ms and the table did not ` +
        `repaint within ${LIST_REPAINT_TIMEOUT_MS} ms, so the rows read now are the find's ` +
        'predecessors. Confirm the find against the running legacy app.',
    );
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

  /** Types into the toolbar's server-side "find" box without submitting it (AAP 0.2.3 `FilterToolbar`); {@link submitFilter} performs the submission, so a caller can set several toolbar controls before one query is sent. */
  async findList(text: string): Promise<void> {
    const field = await this.firstOf([LIST_FIND, '.input-group input.form-control']);
    await field.fill(text);
  }

  /**
   * Clicks the toolbar's blue search button, which is what submits the "find" box (clients.html:24-31; AAP 0.2.3 `FilterToolbar`), and waits for the find's own answer before it returns (AAP 0.7.4 "search (server)", Rule 1 clause 8).
   *
   * The wait is the whole point. Legacy empties only `scope.actualClients` when the find is submitted and assigns `scope.clients` — the collection the table renders — inside the `GET /search` callback (`ClientController.js:41,56,83`; `clients.html:64`), so the rows in view stay the previous page until that answer repaints them: a caller that read them at the click would assert on the `GET /clients?offset=0&limit=15` page it was already showing, and fail on any database holding more than one page. A blank find issues no search at all — the controller takes `scope.initPage()`'s list re-read instead (`ClientController.js:53-54,35`) — so no answer is awaited and the table's own repaint settles it.
   */
  async submitFilter(): Promise<void> {
    const field = await this.firstOf([LIST_FIND, '.input-group input.form-control']);
    const find = await field.inputValue();
    const button = await this.firstOf([LIST_SEARCH_BUTTON, '.input-group-btn button']);
    const inView = await this.listReading();

    // Registered before the click, so the answer can never land between the two and be missed.
    const answered =
      find.length === 0
        ? Promise.resolve(true)
        : this.page
            .waitForResponse(
              (response) =>
                response.request().method() === 'GET' &&
                response.url().includes(`${SEARCH_PATH}?`),
              { timeout: SEARCH_TIMEOUT_MS },
            )
            .then(
              () => true,
              () => false,
            );

    await button.click();
    await this.awaitListAnswered(find, inView, await answered);
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

  /** Opens one client's record by clicking the row whose first cell shows exactly `name` (AAP 0.2.1 Step 2's trigger, AAP 0.10.1 W3). The list pages fifteen rows at a time, so a client that is not on the page in view is looked for through the toolbar's find — the server search its blue button submits — and the list is read once more; a client that find does not answer either is reported with both row counts, so a genuine absence is told apart from a paging problem. */
  async openClient(name: string): Promise<void> {
    const onPage = (await this.visibleRows()).length;

    if (await this.clickClientRow(name, LIST_ROW_TIMEOUT_MS)) return;

    await this.findList(name);
    await this.submitFilter();

    if (await this.clickClientRow(name, SEARCH_TIMEOUT_MS)) return;

    throw new Error(
      `The legacy client list shows no row whose first cell is exactly "${name}": the page in ` +
        `view held ${onPage} visible row(s) and the find for "${name}" left ` +
        `${(await this.visibleRows()).length} visible row(s). Confirm the client against the ` +
        `seeded database before treating this as a paging problem.`,
    );
  }

  /** Clicks the row whose first cell shows exactly `name` once that row is visible, and confirms the `#/viewclient/` address the click opens — the row first, then the cell inside it, which is the documented fallback when the row itself does not route. Answers `false` when no such row appears within `timeoutMs`, so a caller can run its own fallback instead of waiting out a navigation that will never start. */
  private async clickClientRow(name: string, timeoutMs: number): Promise<boolean> {
    const nameCell = this.page
      .locator(`.table tbody tr td:first-child:text-is(${JSON.stringify(name)})`)
      .first();

    const appeared = await nameCell
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .then(
        () => true,
        () => false,
      );
    if (!appeared) return false;

    await nameCell.locator('xpath=..').click();
    if (await this.waitForHashPrefix('#/viewclient/')) return true;
    await nameCell.click();
    await this.page.waitForURL((url) => url.hash.startsWith('#/viewclient/'));
    return true;
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

  /** The position of `scope` in {@link SEARCH_SCOPES}, matching either its legacy value or one of its short names. @throws When the scope is unknown, listing the scopes that are known — a caller has a bug, and a silent no-op would search in whichever scope happened to be selected. */
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

  /** Opens the create form and waits for its first control to render (AAP 0.8.2's `createclient` route; AAP 0.10.1 W2). It then waits for the office template that fills `#officeId`, so a caller reads the dropdown's options only once they exist (AAP 0.7.3 "W2 create and activate client"). */
  async openCreateForm(): Promise<void> {
    await this.gotoHash('#/createclient');
    await this.page.locator('.form-control:visible').first().waitFor({ state: 'visible' });
    await this.awaitOfficeOptions();
  }

  /** Waits for the office template to fill the form's `#officeId` select: the controller assigns its `officeOptions` from that read, so the select carries no option until the answer lands (`app/scripts/controllers/client/CreateClientController.js:48`). One option settles the wait — this backend answers as few as one office, so a second option is never required — and the form's own failure region settles it at once, because a refused read never fills the list. The wait is on the `<select>`'s options, which are what the form posts, and never on its visibility: the chosen widget hides the native select and paints its own control beside it (AAP 0.10.5 item 2). @throws When the form shows Fineract's message for the read, or when `#officeId` still offers no option after {@link TEMPLATE_TIMEOUT_MS}. */
  private async awaitOfficeOptions(): Promise<void> {
    const office = this.page.locator('#officeId');
    await office.waitFor({ state: 'attached', timeout: TEMPLATE_TIMEOUT_MS });
    const attempts = Math.ceil(TEMPLATE_TIMEOUT_MS / OPTION_POLL_INTERVAL_MS);

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const [failure] = await this.visibleTexts(FORM_FAILURE);
      if (failure !== undefined) {
        throw new Error(
          `The legacy create form reported a failed office-template read, so its office options are ` +
            `not filled: ${failure}`,
        );
      }
      if ((await office.locator('option').count()) > 0) return;
      await this.page.waitForTimeout(OPTION_POLL_INTERVAL_MS);
    }

    const offered = await office.locator('option').count();
    throw new Error(
      `The legacy create form's #officeId offered ${offered} option(s) within ` +
        `${TEMPLATE_TIMEOUT_MS} ms of loading and the form shows no failure message. Confirm the ` +
        `office template read against the running legacy app.`,
    );
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

  /** A dropdown, addressed by the same cascade: its legacy id (`select#officeId`, `select#staffId` — createclient.html:23, :33), its `name`, its `formControlName`, then the `<select>` beside its label. @param id Stable identifier of the field, e.g. `officeId`. @param label Visible label of the field, e.g. `Office`. */
  private async selectField(id: string, label: string): Promise<Locator> {
    const labelSelector = `label:has-text(${JSON.stringify(label)})`;
    return this.firstOf([
      `select#${id}`,
      `select[name="${id}"]`,
      `select[formControlName="${id}"]`,
      `${labelSelector} ~ div select`,
    ]);
  }

  /** A date input, addressed by its legacy id (`#submittedon`, `#activationDate` — createclient.html:281, :271), its `name`, its `formControlName`, then the input beside its label. @param id Stable identifier of the field, e.g. `submittedon`. @param label Visible label of the field, e.g. `Submitted on`. */
  private async dateField(id: string, label: string): Promise<Locator> {
    const labelSelector = `label:has-text(${JSON.stringify(label)})`;
    return this.firstOf([
      `#${id}`,
      `input[name="${id}"]`,
      `input[formControlName="${id}"]`,
      `${labelSelector} ~ div input.form-control, ${labelSelector} ~ input.form-control`,
    ]);
  }

  /** A checkbox, addressed by its legacy id (`#activeCheckbox` — createclient.html:263), its `formControlName`, then the checkbox inside or beside its label. @param id Stable identifier of the field, e.g. `activeCheckbox`. @param label Visible label of the field, e.g. `Active`. */
  private async checkboxField(id: string, label: string): Promise<Locator> {
    const labelSelector = `label:has-text(${JSON.stringify(label)})`;
    return this.firstOf([
      `#${id}`,
      `input[type="checkbox"][formControlName="${id}"]`,
      `${labelSelector} ~ div input[type="checkbox"], ${labelSelector} input[type="checkbox"]`,
    ]);
  }

  /** The `<select>` a visible label names, preferring one in the label's own cell and falling back to the next `<select>` in the document, which is what a label whose control sits further down the row needs. @param fieldLabel Visible label of the field. */
  private async selectByLabel(fieldLabel: string): Promise<Locator> {
    const label = this.page.locator(`label:has-text(${JSON.stringify(fieldLabel)})`).first();
    const inCell = label.locator('xpath=following-sibling::div[1]//select');
    if ((await inCell.count()) > 0) return inCell.first();
    return label.locator('xpath=following::select[1]');
  }

  /** Whether a `<select>` is enhanced by the legacy chosen widget, either because the template asks for it with the `chosen` attribute (createclient.html:23, :33) or because the plugin's container already sits beside it. @param select Locator for the `<select>` in question. */
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

