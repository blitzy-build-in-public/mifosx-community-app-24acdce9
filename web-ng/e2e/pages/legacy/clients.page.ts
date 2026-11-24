/**
 * Legacy-baseline page object for the client screens of the unchanged AngularJS application served
 * on port 9090 — the `legacy` project of the parity suite (AAP 0.8.1 tree `pages/legacy/*.page.ts`,
 * AAP 0.11.1 row 47).
 *
 * The five client routes it drives, mirroring `web-ng/tools/parity/in-scope-routes.json` and the
 * legacy router (`app/scripts/routes.js:79,85,103,323` of the reference clone):
 *
 * - `#/clients`             the "List of Clients" card, its toolbar and its six-column table
 * - `#/createclient`        the create form
 * - `#/editclient/:id`      the edit form, reached through the same field cascade as create
 * - `#/client/:id/:action`  a client lifecycle action form
 * - `#/search/:query`       the global search results
 *
 * Workflows it serves (AAP 0.10.1): **W2** — create a client and activate it — and **W3** — search
 * for a client and view its details and accounts. The fixed data behind both is AAP 0.10.1's
 * "Parity Client", office 1 Head Office, submitted and activated on the run date.
 *
 * Two rules shape every method below.
 *
 * - **Rule 2 (backend).** No navigation starts from a bare address: {@link ClientsPage} composes
 *   `${LEGACY_URL}/?baseApiUrl=<FINERACT_URL>&tenantIdentifier=<TENANT_ID>` first, because without
 *   those two query parameters the legacy app targets a public demo host (AAP 0.3.4). No Fineract
 *   resource path and no API call appears in this file at all — the datatable gate of AAP 0.3.4
 *   row 13 is observed in the captured traffic by the capture layer, never re-implemented here
 *   (Rule 1 clause 2).
 * - **Rule 1 clause 3 (match legacy, do not improve it).** Every reader reports what the legacy
 *   screen actually renders and filters nothing out. The list toolbar really does offer "Import
 *   Clients", and suppressing it would erase the evidence behind AAP 0.10.5 item 4. No reader
 *   validates a value and no driver adds a constraint the legacy form does not carry.
 *
 * The legacy source tree is a read-only reference outside this checkout. Every selector below
 * carries the file and line it was read from and what still has to be confirmed against the running
 * legacy app, so a selector that stops matching can be traced back to the markup it was derived
 * from instead of being guessed again.
 */
import type { Locator, Page } from '@playwright/test';
import { FINERACT_URL, LEGACY_URL, TENANT_ID, formatFineractDate } from '../../seed/fixtures';
import { chooseOption, readChosenOptions } from './chosen';

/**
 * One row of the client list, as the report compares it (AAP 0.10.1 W3, AAP 0.2.1 Step 2).
 *
 * `statusClass` is the raw `class` attribute of the row's status swatch and never a label: the
 * design renders the status as a colour swatch with no text at all (AAP 0.2.1, AAP 0.10.5 item 11),
 * so a reader that fell back to cell text would answer `''` on both applications and hide a real
 * difference.
 */
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

/**
 * The values {@link ClientsPage.fillClientForm} writes into the client form.
 *
 * Every field is optional: a field the caller does not supply is left exactly as the legacy screen
 * rendered it, and nothing is invented for it (Rule 1 clause 3 — the form's own defaults and the
 * template endpoints stay the only source of dropdown options and starting values).
 */
export interface ClientFormValues {
  /** Office to select by its visible label, e.g. `Head Office`; already chosen on the edit form. */
  readonly officeName?: string;
  /**
   * Staff to select by its visible label, e.g. `Officer, Parity` — the name Fineract composes from
   * a staff member's last and first names, which is what the dropdown shows; a loan officer is
   * optional.
   */
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

/**
 * The five client lifecycle actions the migration keeps (AAP 0.7.2 `ClientActionRequest`, AAP
 * 0.9.1 scope group 2). The union is exhaustive on purpose — any other string is a TypeScript error
 * rather than a runtime branch, because no sixth action screen is in scope.
 */
export type ClientLifecycleAction = 'activate' | 'close' | 'reject' | 'withdraw' | 'reactivate';

/**
 * The legacy screen root every in-scope route renders: `div.content-container`
 * (clients.html:1, createclient.html:2, clientactions.html:1, views/search/glresults.html:1).
 * Wait it out after each hash navigation, then wait for the screen's own root.
 */
const SCREEN_ROOT = '.content-container';

/**
 * The card that holds the list. Legacy renders it as `div.card` with a `.toolbar` heading
 * (clients.html:7-9); the new application renders the same card as a Bootstrap `.panel`
 * (AAP 0.2.3 `PanelCard`, AAP 0.5.2). Both spellings are accepted so one reader describes both
 * applications. Confirm the legacy class when the legacy app runs.
 */
const SCREEN_CARD = '.panel, .card';

/** The list table — `table.table` (clients.html:51). */
const LIST_TABLE = '.table';

/** One list row — `table.table tbody tr` (clients.html:63-75). */
const LIST_ROW = '.table tbody tr';

/** One column heading — `table.table thead th` (clients.html:52-60). */
const COLUMN_HEADER = '.table thead th';

/**
 * The status swatch inside a cell. Legacy paints it as
 * `<i class="fa fa-stop {{client.status.code | StatusLookup}}">` (clients.html:70), where the
 * filter answers `statusactive`, `statuspending`, `statusclosed`, `statusrejected` or
 * `statuswithdraw` (`app/scripts/filters/StatusLookup.js`), with no hyphen. The hyphenated forms and
 * `.status-swatch` are the spellings AAP 0.2.3 and AAP 0.10.5 item 11 use for the new app's
 * `StatusSwatch`, so both are matched and the raw class attribute is what a caller compares.
 */
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

/**
 * The explicit empty state. AAP 0.5.2 defines it as a `.text-center.text-muted` block inside the
 * card body; the legacy card holds its body as `.content` and the new app as `.panel-body`, so both
 * containers are listed. Confirm the legacy side when the legacy app runs — the baseline list has no
 * empty state of its own, so `''` is the expected legacy answer.
 */
const EMPTY_STATE = [
  '.panel-body .text-center.text-muted',
  '.panel .text-center.text-muted',
  '.card .content .text-center.text-muted',
  '.card .text-center.text-muted',
].join(', ');

/**
 * The list toolbar's client-side filter box — `input[ng-model="filterText"]` inside the first
 * `.col-md-4` of the toolbar form (clients.html:18-20). AngularJS leaves the directive attributes
 * on the element, so the model name is the most stable handle it offers.
 */
const LIST_FILTER = 'input[ng-model="filterText"], input[data-ng-model="filterText"]';

/**
 * The toolbar's server-side "find" box — `input[data-ng-model="searchText"]` inside the
 * `.input-group` beside the blue search button (clients.html:24-26).
 */
const LIST_FIND = 'input[data-ng-model="searchText"], input[ng-model="searchText"]';

/**
 * The toolbar's blue search submission button — `button.btn.btn-primary` inside
 * `.input-group-btn` (clients.html:28-30). The navbar carries an `.input-group-btn` too, but its
 * button is `.btn-default`, so the primary class keeps this scoped to the list toolbar.
 */
const LIST_SEARCH_BUTTON = '.input-group-btn button.btn.btn-primary, .input-group-btn .btn.btn-primary';

/**
 * The "Show Closed" checkbox — `input#showAll` inside `div.checkbox.form-control label`
 * (clients.html:32-37). Located by id rather than by its text on purpose: the legacy label reads
 * `label.button.showall` ("Show All"), while the design and AAP 0.2.3 call the control "Show
 * Closed", so matching the wording would break on either application. The generic `.checkbox`
 * fallback is the new app's markup.
 */
const LIST_SHOW_CLOSED = ['#showAll', '.checkbox input[type="checkbox"]'];

/** The navbar global search field — `input#search` (views/_topnavbar.html:119). */
const SEARCH_FIELD = [
  '#search',
  'input[data-ng-model="search.query"]',
  '.navbar-form input[type="text"]',
  '.navbar-form input[type="search"]',
].join(', ');

/**
 * The navbar scope control, native-select form. The new application replaces the legacy dropdown
 * with an attached native `<select>` (AAP 0.2.3 `GlobalSearch`, AAP 0.10.5 item 2), so this half of
 * the pair only exists on the new side. Confirm with the new app; the legacy side has no select.
 */
const SEARCH_SCOPE_SELECT = '.navbar-form select, form.navbar-form select';

/**
 * The navbar scope control, legacy form: a Bootstrap dropdown whose toggle is
 * `button.btn.btn-default.btn-sm` inside `div.input-group-btn.search-panel`
 * (views/_topnavbar.html:121-124). Confirm when the legacy app runs.
 */
const SEARCH_SCOPE_TOGGLE =
  '.navbar-form .input-group-btn.search-panel button, .navbar-form .input-group-btn button.btn';

/**
 * One scope entry of that dropdown: `li` elements produced by `ng-repeat="searchScope in
 * searchScopes"` (views/_topnavbar.html:125-126). Their order is the order of `searchScopes` in
 * `app/scripts/controllers/main/MainController.js:183-196`. Confirm when the legacy app runs.
 */
const SEARCH_SCOPE_ITEMS = '.navbar-form .input-group-btn ul li';

/**
 * One global search result — `div.blockquoteresult` per `ng-repeat="result in searchResults"`
 * (views/search/glresults.html:10-11). Confirm when the legacy app runs.
 */
const SEARCH_RESULT = '.blockquoteresult';

/**
 * Where a rendered message may live, most specific first; {@link ClientsPage.readNotifications}
 * stops at the first candidate that renders something visible.
 *
 * - `.alert.alert-danger` — the `api-validate` block every in-scope form renders for a Fineract
 *   error (`app/scripts/directives/ApiValidationDirective.js:9`, `uib-alert type="danger"`).
 * - `.alert.alert-success` / `-info` / `-warning` — the `uib-alert` blocks the wizard shows after a
 *   successful datatable entry (clientactions.html:12).
 * - `.notification-container .notification-list li h4` — the legacy notification tray behind the
 *   navbar bell (views/_topnavbar.html:88-96). It is invisible until the tray is opened and the tray
 *   itself is out of scope for the new app (AAP 0.10.5 item 8), so it only ever contributes a
 *   message here if a caller opened it. Confirm the remaining three when the legacy app runs.
 */
const NOTIFICATION_SOURCES = [
  'div.alert.alert-danger',
  'div.alert.alert-success',
  'div.alert.alert-info',
  'div.alert.alert-warning',
  '.notification-container .notification-list li h4',
];

/**
 * Where a validation message may live, from the two selectors AAP 0.7.4 fixes (`.alert.alert-danger`
 * and `.help-block` inside `.has-error`) plus legacy's own field-level markup,
 * `<small class="error required">` (createclient.html:60). Confirm the third when the legacy app
 * runs.
 */
const VALIDATION_ERROR_SOURCES = ['div.alert.alert-danger', '.has-error .help-block', 'small.error'];

/**
 * How long a navigation that the click itself decides — the list row that may or may not be wired
 * to the record, {@link ClientsPage.openClient} — is given before the documented fallback runs.
 * Everything that must happen without a fallback uses Playwright's own action and navigation
 * timeouts from `e2e/playwright.config.ts`.
 */
const OPTIONAL_NAVIGATION_TIMEOUT_MS = 10_000;

/**
 * One option of a `<select>`, as a page-side function reports it. Kept apart from
 * {@link SelectOptionSummary} because it is serialised across the page boundary.
 */
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

/**
 * Which heading each compared field comes from. Headings are read as rendered — translated by the
 * same `app/global-translations` files both applications load — and matched here rather than by
 * column position, so a column inserted or reordered on one side shows up as a difference in that
 * field instead of shifting every field after it (AAP 0.2.1 Step 2 fixes the six columns in the
 * order Name, Client Number, External ID, Status, Office, Staff).
 */
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

/**
 * One navbar search scope: the value legacy sends as the `resource` query parameter, and every
 * spelling a caller may pass to {@link ClientsPage.searchGlobal}.
 *
 * The values and their order are `searchScopes` in
 * `app/scripts/controllers/main/MainController.js:183-196`; the legacy dropdown renders them in that
 * order, which is why a scope is addressed by index. The short spellings are what the new app offers
 * (AAP 0.10.5 item 9: clients, loans and "all" meaning both), so a spec can name one scope and both
 * page objects understand it.
 */
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

/**
 * Runs inside the legacy page: one row's cell texts and status-swatch classes.
 *
 * The swatch selector arrives as an argument because a function evaluated in the page cannot see
 * this module's constants. Nothing else from module scope is referenced here for the same reason.
 */
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

/**
 * Runs inside the legacy page: one search result's link text, its information line and any status
 * swatch class.
 *
 * The information line is the text of the row's `<span>` elements that carry no link, which is
 * exactly the `Entity:` / `Office:` line the template renders under the name
 * (views/search/glresults.html:56-66); the span that wraps the name link is skipped so the name is
 * not repeated inside the line.
 */
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

/**
 * Runs inside the page: the options of a `<select>`, in document order. Answers `[]` for anything
 * that is not a select, which is how a field resolved to the wrong element is reported rather than
 * thrown at.
 */
function readOptionPairs(element: HTMLElement | SVGElement): OptionPair[] {
  if (!(element instanceof HTMLSelectElement)) return [];
  return Array.from(element.options).map((option) => ({
    value: option.value,
    label: (option.textContent ?? '').replace(/\s+/g, ' ').trim(),
  }));
}

/**
 * Runs inside the page: sets a text input's value and tells AngularJS about it.
 *
 * The fallback for the legacy datepicker (see {@link setLegacyDate}): the widget parses its input's
 * text through a `$parser` and repaints from a `$formatter` (`app/scripts/modules/datepicker.js:412-428`),
 * so the value a form submits is the one the input holds once a native `input` and `change` event
 * have been dispatched.
 */
function setNativeInputValue(element: HTMLElement | SVGElement, text: string): void {
  if (!(element instanceof HTMLInputElement)) return;
  element.value = text;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Runs inside the page: a `<select>`'s tag name, lower-cased, used to report a field that resolved
 * to something other than a dropdown.
 */
function readTagName(element: HTMLElement | SVGElement): string {
  return element.tagName.toLowerCase();
}

/**
 * The baseline page object for the legacy application's client screens: the client list, the create
 * and edit forms, the lifecycle action forms and the global search results.
 *
 * Constructed with the Playwright {@link Page} of whichever browser context the suite handed to the
 * `legacy` project; it holds no state of its own beyond that page, so two instances never share a
 * selection or a navigation.
 */
export class ClientsPage {
  constructor(private readonly page: Page) {}

  // ---------------------------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------------------------

  /**
   * Composes an entry address for the legacy application (Rule 2, AAP 0.3.4).
   *
   * The two query parameters are what make the legacy app talk to this harness's Fineract instead of
   * a public demo host, so every navigation starts from this address rather than from a bare
   * `LEGACY_URL`. Both values are URI-encoded, and `FINERACT_URL` carries no trailing slash, so the
   * composed address cannot be malformed.
   *
   * @param hash Hash route to append, with or without its leading `#`; omitted for the app root.
   */
  private entryUrl(hash?: string): string {
    const query =
      `?baseApiUrl=${encodeURIComponent(FINERACT_URL)}` +
      `&tenantIdentifier=${encodeURIComponent(TENANT_ID)}`;
    return `${LEGACY_URL}/${query}${hash ?? ''}`;
  }

  /**
   * Navigates to a legacy hash route, keeping the entry query string, and waits for the screen root.
   *
   * The first navigation opens {@link entryUrl} so the query parameters are in place. Every later one
   * is resolved against the page's own address: a fragment-only argument is resolved by Playwright
   * against the configured `baseURL`, which replaces the whole address with `LEGACY_URL` and discards
   * the query string, so the legacy app would reload without `baseApiUrl`/`tenantIdentifier`, derive
   * its API host from its own hostname and stop addressing `FINERACT_URL` (Rule 2,
   * app/scripts/initialTasks.js:25-44). Resolved this way only the fragment moves, which is what the
   * legacy router listens for (`html5Mode(false)`, `hashPrefix('')` — AAP 0.3.4 row 2). If the router
   * does not react to the navigation — the hash is unchanged — the route is set through
   * `location.hash`, which is the fallback a user's own address edit amounts to.
   *
   * @param hash Hash route to open, with or without its leading `#`.
   */
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

  /**
   * The first element any of `selectors` matches, tried in order.
   *
   * A union selector would hand back whichever match comes first in the document rather than the
   * most specific one, so the legacy markup is addressed by a documented cascade: the stable handle
   * first, the new application's markup last.
   *
   * @param selectors Candidate selectors, most specific first.
   * @throws When no candidate matches, listing the candidates and pointing at the legacy markup.
   */
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

  /**
   * The rendered text of every visible match of `selector`, whitespace-normalised and in document
   * order. Hidden matches are skipped because an `ng-show`-hidden element is not rendered.
   */
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

  /**
   * Whether the address hash starts with `prefix` within {@link OPTIONAL_NAVIGATION_TIMEOUT_MS},
   * answering `false` instead of throwing so a caller can run its documented fallback.
   */
  private async waitForHashPrefix(prefix: string): Promise<boolean> {
    return this.page
      .waitForURL((url) => url.hash.startsWith(prefix), { timeout: OPTIONAL_NAVIGATION_TIMEOUT_MS })
      .then(
        () => true,
        () => false,
      );
  }

  /**
   * Clicks the first visible match of `selector`, reporting whether it found one.
   *
   * Used by the submit cascade: a wizard renders a "proceed" button beside the real submit, and
   * clicking a hidden one would wait forever instead of moving on to the next candidate.
   */
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

  /**
   * Clicks the screen's primary submit, one click and nothing more — no retry and no second click,
   * because a Fineract lifecycle action is not idempotent (AAP 0.1.1 duplicate-submission rule).
   *
   * The cascade starts at the markup the legacy forms actually use: the create form's submit is
   * `button#save2[type="submit"].btn.btn-primary` (createclient.html:693) and an action form's is
   * `button#save[type="submit"].btn.btn-primary` (clientactions.html:96), both inside the screen's
   * `<form>`. The looser candidates cover the new application's markup (AAP 0.5.2 `.btn.btn-primary`).
   *
   * @throws When the screen renders no visible primary button at all.
   */
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

  /**
   * The rows the screen actually renders, in document order.
   *
   * Legacy hides a closed client's row with `ng-show` rather than removing it
   * (clients.html:65), so an unfiltered read would report rows the user cannot see — and the new app,
   * which renders only what it received, would then differ for a reason that is not behavioural.
   */
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

  // ---------------------------------------------------------------------------------------------
  // Client list (#/clients) — W2's entry point and W3's list half
  // ---------------------------------------------------------------------------------------------

  /**
   * Opens the client list and waits for the "List of Clients" card to render its table.
   *
   * Serves AAP 0.10.1 W2 (the entry point of "create a client and activate it") and W3 (the list
   * whose search box a user searches from).
   */
  async open(): Promise<void> {
    await this.gotoHash('#/clients');
    await this.page.locator(SCREEN_CARD).first().waitFor({ state: 'visible' });
    await this.page
      .locator(`${LIST_TABLE}, ${EMPTY_STATE}`)
      .first()
      .waitFor({ state: 'visible' });
  }

  /**
   * Types into the toolbar's filter box, which filters the rendered rows client-side
   * (AAP 0.2.3 `FilterToolbar`). The value is never submitted.
   *
   * The trailing key press reproduces a user's last keystroke so the legacy handler bound to
   * `ng-keyup="onFilter()"` (clients.html:18) runs exactly as it does for a person; the filtered rows
   * themselves come from the `filter:filterText` pipe on the row repeat.
   *
   * @param text Text to filter the rendered rows by.
   */
  async filterList(text: string): Promise<void> {
    const field = await this.firstOf([LIST_FILTER, '.form-group .col-md-4 input.form-control']);
    await field.fill(text);
    await field.press('End');
  }

  /**
   * Types into the toolbar's server-side "find" box without submitting it (AAP 0.2.3
   * `FilterToolbar`); {@link submitFilter} performs the submission, so a caller can set several
   * toolbar controls before one query is sent.
   *
   * @param text Text to search the client collection by.
   */
  async findList(text: string): Promise<void> {
    const field = await this.firstOf([LIST_FIND, '.input-group input.form-control']);
    await field.fill(text);
  }

  /**
   * Clicks the toolbar's blue search button, which is what submits the "find" box
   * (clients.html:27-31; AAP 0.2.3 `FilterToolbar`).
   */
  async submitFilter(): Promise<void> {
    const button = await this.firstOf([LIST_SEARCH_BUTTON, '.input-group-btn button']);
    await button.click();
  }

  /**
   * Ticks or clears the toolbar's "Show Closed" checkbox, which is what brings the client rows hidden
   * by `ng-show` into view (clients.html:32-37, :65; AAP 0.2.3 `FilterToolbar`).
   *
   * `check()`/`uncheck()` only run when the box is not already in the wanted state, so a repeated
   * call cannot toggle twice.
   *
   * @param checked Whether closed clients should be shown.
   */
  async toggleShowClosed(checked: boolean): Promise<void> {
    const box = await this.firstOf(LIST_SHOW_CLOSED);
    if ((await box.isChecked()) === checked) return;
    if (checked) {
      await box.check();
    } else {
      await box.uncheck();
    }
  }

  /**
   * The list's column headings, in rendered order and trimmed (AAP 0.2.1 Step 2's six columns;
   * AAP 0.2.3 `ClientList`).
   *
   * This is the reference {@link readRows} maps against, so comparing it on both applications proves
   * the columns themselves match before any cell is compared.
   */
  async readColumnHeaders(): Promise<string[]> {
    const headings = this.page.locator(COLUMN_HEADER);
    const total = await headings.count();
    const texts: string[] = [];
    for (let index = 0; index < total; index += 1) {
      texts.push(normaliseText(await headings.nth(index).innerText()));
    }
    return texts;
  }

  /**
   * The rows the list renders, one {@link ClientRow} each, with every field read from the column its
   * heading names (AAP 0.10.1 W3's displayed-data comparison).
   *
   * Read by heading, never by position: the design fixes the six columns in one order
   * (AAP 0.2.1 Step 2), and a column that moves on either side then shows up as a difference in that
   * field instead of shifting every field after it.
   *
   * `statusClass` is the raw class attribute of the status swatch, never its text — the design
   * renders no status text at all (AAP 0.2.1, AAP 0.10.5 item 11). A table with no headings (a screen
   * that failed to render) answers `''` for every field rather than guessing a position.
   */
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

  /**
   * Each rendered row's status swatch, addressed by its 0-based row position
   * (AAP 0.2.3 `StatusSwatch`, AAP 0.10.5 item 11).
   *
   * Independent of the headings on purpose: the swatch is the row's only status evidence, so it is
   * reported even from a table whose headings failed to render.
   */
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

  /**
   * Opens one client's record by clicking the row whose first cell shows `name`
   * (AAP 0.2.1 Step 2's trigger, AAP 0.10.1 W3).
   *
   * The legacy row carries no link styling, chevron or button: the navigation is an
   * `ng-click="routeTo(client.id)"` on each of its cells (clients.html:66-74), so the row is clicked
   * as a whole and, when the click lands somewhere that is not wired, the name cell is clicked as the
   * documented fallback.
   *
   * @param name The client's display name, matched exactly against the first cell.
   */
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

  /**
   * The text of the card's explicit empty state, or `''` when the screen renders none
   * (AAP 0.5.2; AAP 0.7.4 lists the empty state as a required screen state).
   *
   * The baseline list has no empty state of its own, so a legacy answer of `''` beside the new app's
   * message is expected and is recorded as a deliberate difference, not a failure.
   */
  async readEmptyState(): Promise<string> {
    const empty = this.page.locator(EMPTY_STATE);
    if ((await empty.count()) === 0) return '';
    const first = empty.first();
    if (!(await first.isVisible())) return '';
    return normaliseText(await first.innerText());
  }

  /**
   * The messages the screen is currently showing, deduplicated, and `[]` when it shows none
   * (AAP 0.2.3 `Notification`, AAP 0.7.4's error display).
   *
   * Each candidate in {@link NOTIFICATION_SOURCES} is tried in turn and the first one that renders
   * anything visible is reported, because the legacy app spreads messages over an `api-validate`
   * alert, wizard alerts and a notification tray rather than one widget. Nothing is read from an
   * element the user cannot see, so a closed tray contributes nothing.
   */
  async readNotifications(): Promise<string[]> {
    for (const selector of NOTIFICATION_SOURCES) {
      const texts = await this.visibleTexts(selector);
      if (texts.length > 0) return dedupe(texts);
    }
    return [];
  }

  /**
   * Every action label the screen renders, in document order (AAP 0.2.3 `FilterToolbar` and
   * `ActionButtonGroup`).
   *
   * Reported unfiltered on purpose: the legacy list really does render "Import Clients" beside
   * "Create Client" (clients.html:44-47), and the new app deliberately does not (AAP 0.10.5 item 4).
   * That difference is `intentional-diff` evidence for the parity report, so suppressing it here
   * would destroy the evidence rather than remove the difference (Rule 1 clause 3).
   *
   * Buttons whose visible text is empty — the toolbar's icon-only search button — are not labels and
   * are left out.
   */
  async readVisibleActions(): Promise<string[]> {
    const buttons = this.page.locator('.btn');
    const total = await buttons.count();
    const labels: string[] = [];
    for (let index = 0; index < total; index += 1) {
      const button = buttons.nth(index);
      if (!(await button.isVisible())) continue;
      const label = normaliseText(await button.innerText());
      if (label.length > 0) labels.push(label);
    }
    return labels;
  }


  // ---------------------------------------------------------------------------------------------
  // Global search (#/search/:query) — W3's search half
  // ---------------------------------------------------------------------------------------------

  /**
   * Searches from the navbar's global search field, optionally in one named scope
   * (AAP 0.2.3 `GlobalSearch`, AAP 0.3.4's search adjuncts; AAP 0.10.1 W3).
   *
   * `scope` is typed `string` on both this page object and the `next` one for a reason: the legacy
   * control offers six scopes and the new app three (AAP 0.10.5 item 9), so a closed union would
   * describe neither. Either the legacy value (`clients,clientIdentifiers` and friends) or the short
   * name (`clients`, `loans`, `savings`, `groups`, `shares`, `all`) may be passed, and
   * {@link selectSearchScope} translates it for whichever control the screen renders.
   *
   * Enter submits the navbar form, which is the legacy router's own trigger
   * (`ng-submit="search()"`, views/_topnavbar.html:117).
   *
   * @param query Text to search for.
   * @param scope Optional scope to select before searching.
   */
  async searchGlobal(query: string, scope?: string): Promise<void> {
    const field = await this.firstOf([SEARCH_FIELD, '.navbar-form input']);
    await field.waitFor({ state: 'visible' });
    if (scope !== undefined) await this.selectSearchScope(scope);
    await field.fill(query);
    await field.press('Enter');
    await this.page.waitForURL((url) => url.hash.startsWith('#/search/'));
  }

  /**
   * Opens a search results address directly, without going through the navbar
   * (AAP 0.8.2's `search/:query` route; AAP 0.10.1 W3).
   *
   * @param query Text the results address is built from; encoded into the hash.
   */
  async openSearchResults(query: string): Promise<void> {
    await this.gotoHash(`#/search/${encodeURIComponent(query)}`);
    await this.page.locator(SCREEN_CARD).first().waitFor({ state: 'visible' });
  }

  /**
   * The rendered search results, one {@link SearchResultRow} each (AAP 0.10.1 W3's displayed-data
   * comparison).
   *
   * The primary text is the row's link text and the secondary text is the `Entity:` / `Office:` line
   * beside it; either is `''` when the row does not render it, and `statusClass` is `''` on the
   * legacy results list, which paints no status swatch at all.
   */
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

  /**
   * Selects one navbar search scope, on whichever control the screen renders.
   *
   * The new app attaches a native `<select>` (AAP 0.2.3), so it is set by value. The legacy app
   * renders a Bootstrap dropdown whose entries are translated labels rather than values
   * (views/_topnavbar.html:121-126), so the entry is addressed by its position in
   * {@link SEARCH_SCOPES}, which is the order `searchScopes` is declared in
   * (app/scripts/controllers/main/MainController.js:183-196).
   *
   * @param scope Legacy value or short name of the scope to select.
   * @throws When `scope` names no known scope, or the native select offers no matching option.
   */
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

  /**
   * The position of `scope` in {@link SEARCH_SCOPES}, matching either its legacy value or one of its
   * short names.
   *
   * @throws When the scope is unknown, listing the scopes that are known — a caller has a bug, and a
   * silent no-op would search in whichever scope happened to be selected.
   */
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

  // ---------------------------------------------------------------------------------------------
  // Client forms (#/createclient, #/editclient/:id) — W2's create half
  // ---------------------------------------------------------------------------------------------

  /**
   * Opens the create form and waits for its first control to render (AAP 0.8.2's `createclient`
   * route; AAP 0.10.1 W2).
   *
   * The first `.form-control` in the legacy markup is the office `<select>`, which the chosen widget
   * hides, so the wait is for the first *visible* control rather than for the first match.
   */
  async openCreateForm(): Promise<void> {
    await this.gotoHash('#/createclient');
    await this.page.locator('.form-control:visible').first().waitFor({ state: 'visible' });
  }

  /**
   * Fills the fields `values` supplies and leaves every other field exactly as the screen rendered
   * it (AAP 0.10.1 W2, AAP 0.7.2's `ClientCreateRequest` and `ClientEditRequest`).
   *
   * Nothing is invented for a field the caller omits, and nothing is constrained that the legacy form
   * does not constrain (Rule 1 clause 3): the fields are written exactly as given. The office and
   * staff dropdowns go through {@link chooseOption} because they are chosen widgets; the dates go
   * through the private `setLegacyDate` because they are legacy datepicker inputs; the activation date
   * is written only after the active checkbox, since legacy renders it from `setChoice()` once the box
   * is ticked (createclient.html:260-277).
   *
   * @param values The values to write; omitted fields are left alone.
   */
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

  /**
   * The options the dropdown beside `fieldLabel` offers, in document order (AAP 0.2.3
   * `SelectField`, AAP 0.6.2's template-driven option lists).
   *
   * A chosen widget is read through `./chosen`, which reports the labels the plugin wraps, and the
   * values are paired positionally from the `<select>` the widget enhances — both come from the same
   * `<option>` list, in the same order.
   *
   * @param fieldLabel Visible label of the field, e.g. `Office`.
   * @throws When the label resolves to something other than a `<select>`.
   */
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

  /**
   * Submits the form with its primary button — exactly one click, no retry (AAP 0.1.1's
   * duplicate-submission rule; AAP 0.10.1 W2).
   */
  async submitForm(): Promise<void> {
    await this.clickPrimarySubmit();
  }

  /**
   * The validation messages the form is showing, deduplicated, and `[]` when it shows none
   * (AAP 0.7.4's inline validation and server-error display).
   *
   * Fineract's own `errors[].defaultUserMessage` arrives through the `api-validate` block, which is
   * the first source in {@link VALIDATION_ERROR_SOURCES}; the other two are the new app's Bootstrap
   * `.help-block` markup and legacy's own `small.error` field messages. The message text is reported
   * verbatim, because the parity criterion is that both applications show Fineract's wording.
   */
  async readValidationErrors(): Promise<string[]> {
    const texts: string[] = [];
    for (const selector of VALIDATION_ERROR_SOURCES) {
      texts.push(...(await this.visibleTexts(selector)));
    }
    return dedupe(texts);
  }

  /**
   * A text input, addressed by a documented cascade: the id the legacy form gives it
   * (createclient.html:55, :104, :137, :256), then its `name`, its `formControlName`, the input
   * beside its label and finally its placeholder. The later steps exist for the new application's
   * reactive form and for a field whose id changes.
   *
   * @param id Stable identifier of the field, e.g. `firstname`.
   * @param label Visible label of the field, e.g. `First name`.
   */
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

  /**
   * A dropdown, addressed by the same cascade: its legacy id (`select#officeId`,
   * `select#staffId` — createclient.html:23, :33), its `name`, its `formControlName`, then the
   * `<select>` beside its label.
   *
   * @param id Stable identifier of the field, e.g. `officeId`.
   * @param label Visible label of the field, e.g. `Office`.
   */
  private async selectField(id: string, label: string): Promise<Locator> {
    const labelSelector = `label:has-text(${JSON.stringify(label)})`;
    return this.firstOf([
      `select#${id}`,
      `select[name="${id}"]`,
      `select[formControlName="${id}"]`,
      `${labelSelector} ~ div select`,
    ]);
  }

  /**
   * A date input, addressed by its legacy id (`#submittedon`, `#activationDate` —
   * createclient.html:281, :271), its `name`, its `formControlName`, then the input beside its label.
   *
   * @param id Stable identifier of the field, e.g. `submittedon`.
   * @param label Visible label of the field, e.g. `Submitted on`.
   */
  private async dateField(id: string, label: string): Promise<Locator> {
    const labelSelector = `label:has-text(${JSON.stringify(label)})`;
    return this.firstOf([
      `#${id}`,
      `input[name="${id}"]`,
      `input[formControlName="${id}"]`,
      `${labelSelector} ~ div input.form-control, ${labelSelector} ~ input.form-control`,
    ]);
  }

  /**
   * A checkbox, addressed by its legacy id (`#activeCheckbox` — createclient.html:263), its
   * `formControlName`, then the checkbox inside or beside its label.
   *
   * @param id Stable identifier of the field, e.g. `activeCheckbox`.
   * @param label Visible label of the field, e.g. `Active`.
   */
  private async checkboxField(id: string, label: string): Promise<Locator> {
    const labelSelector = `label:has-text(${JSON.stringify(label)})`;
    return this.firstOf([
      `#${id}`,
      `input[type="checkbox"][formControlName="${id}"]`,
      `${labelSelector} ~ div input[type="checkbox"], ${labelSelector} input[type="checkbox"]`,
    ]);
  }

  /**
   * The `<select>` a visible label names, preferring one in the label's own cell and falling back to
   * the next `<select>` in the document, which is what a label whose control sits further down the
   * row needs.
   *
   * @param fieldLabel Visible label of the field.
   */
  private async selectByLabel(fieldLabel: string): Promise<Locator> {
    const label = this.page.locator(`label:has-text(${JSON.stringify(fieldLabel)})`).first();
    const inCell = label.locator('xpath=following-sibling::div[1]//select');
    if ((await inCell.count()) > 0) return inCell.first();
    return label.locator('xpath=following::select[1]');
  }

  /**
   * Whether a `<select>` is enhanced by the legacy chosen widget, either because the template asks
   * for it with the `chosen` attribute (createclient.html:23, :33) or because the plugin's container
   * already sits beside it.
   *
   * @param select Locator for the `<select>` in question.
   */
  private async isChosen(select: Locator): Promise<boolean> {
    if ((await select.getAttribute('chosen')) !== null) return true;
    const container = select.locator('xpath=following-sibling::div[contains(@class,"chosen-container")]');
    return (await container.count()) > 0;
  }

  // ---------------------------------------------------------------------------------------------
  // Client lifecycle actions (#/client/:id/:action) — W2's activate step
  // ---------------------------------------------------------------------------------------------

  /**
   * Opens one lifecycle action form for a client and waits for its first control
   * (AAP 0.8.2's `client/:id/:action` route; AAP 0.7.2's `ClientActionRequest`).
   *
   * Only the five in-scope actions exist, and the union enforces that: a sixth action string is a
   * TypeScript error rather than a navigation that would 404 at run time.
   *
   * The datatable gate that legacy runs before this form posts (AAP 0.3.4 row 13) is not reproduced
   * here — it is a request the legacy controller sends itself, so it appears in the captured traffic
   * where the parity comparison reads it.
   *
   * @param clientId Client the action applies to.
   * @param action Which lifecycle action to open.
   */
  async openClientAction(clientId: number, action: ClientLifecycleAction): Promise<void> {
    await this.gotoHash(`#/client/${clientId}/${action}`);
    await this.page.locator('.form-control:visible').first().waitFor({ state: 'visible' });
  }

  /**
   * Submits the action form with its primary button — exactly one click, no retry, so one click sends
   * one request (AAP 0.1.1 duplicate-submission rule; AAP 0.10.1 W5's one-POST-per-action outcome).
   */
  async submitAction(): Promise<void> {
    await this.clickPrimarySubmit();
  }
}

/**
 * Writes a date into a legacy datepicker input, in the text the Fineract payload carries.
 *
 * Legacy binds a modified jQuery datepicker to a text input (`datepicker-pop`, AAP 0.3.4) whose only
 * date duties are a `$parser` that reads the typed text with `new Date(text)` and a `$formatter` that
 * repaints with `dd MMMM yyyy` (app/scripts/modules/datepicker.js:407-428): a `dd MMMM yyyy` text is
 * therefore both what a person sees and what the form submits, which is exactly what
 * {@link formatFineractDate} answers. Typing it through `fill()` focuses the field and dispatches a
 * native `input` event, so AngularJS's own text-input binding updates the model without the widget
 * being driven at all.
 *
 * The Escape press dismisses the popup if focus opened it; the popup's key handler only closes
 * (key 27, datepicker.js:449-458) and leaves the value untouched. If the widget rewrote the text
 * anyway, the value is set through native `input` and `change` events and read back, and a value that
 * still disagrees raises instead of letting a workflow submit a date nobody chose.
 *
 * Kept private to this page object on purpose: the datepicker interaction belongs to the legacy side
 * only, and the new application has no such widget (AAP 0.10.5 item 1).
 *
 * @param input Locator for the legacy date input.
 * @param date Date to write; its time of day is ignored.
 * @throws When the input does not end up holding the text that was written.
 */
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

