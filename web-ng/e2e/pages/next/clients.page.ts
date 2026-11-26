/** Page object for the new Angular application's client screens — the `next` project's side of workflow **W2** (create a client and activate it), workflow **W3** (search for a client and read the list's answer), the client (AAP 0.10.1, AAP 0.11.1, AAP 0.8.1, AAP 0.8.2). */
import type { Locator, Page } from '@playwright/test';

import { FINERACT_URL, NEXT_URL, TENANT_ID } from '../../seed/fixtures.js';

/** One row of the client list, as the report compares it (AAP 0.10.1 W3; AAP 0.2.1 step 2) (AAP 0.7.2, AAP 0.10.5). */
export interface ClientRow {
  /** Name column — the client's display name. */
  readonly name: string;
  /** Client number column, e.g. `000000002`; a string, never a number. */
  readonly clientNumber: string;
  /** Office column — the client's office name. */
  readonly office: string;
  /** Staff column — the loan officer's name; `''` for a client with no officer assigned. */
  readonly staff: string;
  /** The row's status colour: `status-active`, `status-pending`, `status-closed`, `status-other`, or `''`. */
  readonly statusClass: string;
  /** Every cell of the row, trimmed, in column order — the external id included, which has no field above. */
  readonly cells: readonly string[];
}

/** One rendered status indicator: its colour and, always, the empty text the design gives it. */
export interface StatusSwatchView {
  /** The colour class the indicator carries, or `''` when the element carries none of the four. */
  readonly statusClass: string;
  /** The indicator's own text, which is `''` by design — never a status word read from a neighbour. */
  readonly text: string;
}

/** One message the application's single notification host is showing. */
export interface NotificationView {
  /** The notice's kind, from the accent class the component binds; `unknown` for an unclassed notice. */
  readonly kind: 'info' | 'success' | 'error' | 'unknown';
  /** Fineract's own message, verbatim: never translated, prefixed or truncated. */
  readonly text: string;
}

/** One result of the global search (`#/search/:query`, AAP 0.7.3 "Shell: global search"). */
export interface SearchResultRow {
  /** The result's label — a client's display name, or a loan product's name; the block's link text. */
  readonly name: string;
  /** The account number the block prints after its `#`, or `''` when the block prints none. */
  readonly accountNo: string;
  /** The line beneath the name, e.g. `Entity:Client | Office:Head Office`, or `''` when absent. */
  readonly secondaryText: string;
  /** The result's product, or `''`. No result line names a product in either application — a loan result's name is its product's name — so this answers `''` instead of inventing a value or repeating the name. */
  readonly product: string;
  /** The result's status colour class; always `''`, because a result carries no swatch. */
  readonly statusClass: string;
  /** The hash path the block's link points at, e.g. `#/viewclient/2`; `null` when no link is shown. */
  readonly link: string | null;
}

/** One option of a native `<select>`, in the order the Fineract template returned it. */
export interface SelectOptionView {
  /** The option's DOM value; for an `[ngValue]` option Angular prefixes it with the option's key. */
  readonly value: string;
  /** The option's visible label, trimmed. */
  readonly label: string;
  /** Whether the option is the one currently selected. */
  readonly selected: boolean;
}

/** The values {@link ClientsPage.fillClientForm} writes into the client form (Rule 1 clause 3). */
export interface ClientFormValues {
  /** Office to select by its id, e.g. `1`; the create form's own first field. */
  readonly officeId?: number | string;
  /** Loan officer to select by its id; optional on the form itself. */
  readonly staffId?: number | string;
  /** First name (`#firstname`) — required by the form on the person branch. */
  readonly firstname?: string;
  /** Last name (`#lastname`) — required by the form on the person branch. */
  readonly lastname?: string;
  /** External identifier (`#externalId`); optional on the form. */
  readonly externalId?: string;
  /** Mobile number (`#mobileNo`); optional on the form. */
  readonly mobileNo?: string;
  /** `yyyy-mm-dd`, always supplied by the caller from the run date — never computed here. */
  readonly submittedOnDate?: string;
  /** `yyyy-mm-dd`; rendered only while the client is to be created active, so `active` must be set too. */
  readonly activationDate?: string;
  /** Whether the creation checkbox is ticked; it decides whether an activation date exists at all. */
  readonly active?: boolean;
}

/** The five client lifecycle actions the migration keeps (AAP 0.7.2 `ClientActionRequest`; AAP 0.9.1 scope group 2). */
export type ClientAction = 'activate' | 'close' | 'reject' | 'withdraw' | 'reactivate';

/** The list screen's root, and the element every list locator below is scoped to. */
const LIST_ROOT = 'app-client-list';

/** The create form's root. */
const CREATE_ROOT = 'app-client-create';

/** The edit form's root. */
const EDIT_ROOT = 'app-client-edit';

/** The lifecycle action form's root. */
const ACTIONS_ROOT = 'app-client-actions';

/** The client record's root — only awaited, never read: the record has its own page object. */
const VIEW_ROOT = 'app-client-view';

/** The global search results' root. */
const SEARCH_ROOT = 'app-search-results';

/** One result of the global search: the block legacy renders per result — `div.blockquoteresult` in `app/views/search/glresults.html:10-11` — whose class the product stylesheet reproduces because the partial that declares. */
const SEARCH_RESULT_BLOCK = '.blockquoteresult';

/** The navbar's global search control. */
const GLOBAL_SEARCH_ROOT = 'app-global-search';

/** The application's single notification host, rendered by the root component on every route. */
const NOTIFICATION_HOST = 'app-notification';

/** The shared status indicator, on the list and on the record header. */
const STATUS_SWATCH = 'app-status-swatch';

/** The shared explicit empty state. */
const EMPTY_STATE = 'app-empty-state';

// The four colour classes the status indicator paints — `status-active`, `status-pending`, `status-closed` and `status-other` — are the vocabulary `shared/status-swatch` binds (AAP 0.2.3 row `StatusSwatch`).

/** Ceiling for a screen, a row or a settle to appear. */
const SCREEN_TIMEOUT_MS = 30_000;

/** Ceiling for a list to repaint after the find submitted: the screen paints nothing while its read is in flight, so this is how long the previous rows are given to leave the document. */
const REPAINT_TIMEOUT_MS = 10_000;


/** What one table row reads as, before it is projected onto a public row type. */
interface RowReading {
  /** Every `td` of the row, trimmed, in document order. */
  readonly cells: readonly string[];
  /** The colour class of the row's status indicator, or `''` when the row paints none. */
  readonly statusClass: string;
  /** The `href` of the row's visible link, or `null` when the row offers none. */
  readonly link: string | null;
}

/** What one status indicator reads as, before projection. */
interface SwatchReading {
  /** The colour class the indicator carries, or `''`. */
  readonly statusClass: string;
  /** The indicator's own text, which the design always leaves empty. */
  readonly text: string;
}

/** What one notification reads as, before its accent class is mapped to a kind. */
interface NotificationReading {
  /** The notice element's whole class attribute, so the mapping stays in Node. */
  readonly className: string;
  /** The notice's message, with its close control removed. */
  readonly text: string;
}

/** The arguments a row read carries into the document. */
interface RowQuery {
  /** Selector of the screen root the table lives in, e.g. `app-client-list`. */
  readonly rootSelector: string;
  /** Selector of the rows, relative to that root, e.g. `table tbody tr`. */
  readonly rowSelector: string;
}

/** The arguments a search-results read carries into the document. */
interface SearchBlockQuery {
  /** Selector of the results screen's root, e.g. `app-search-results`. */
  readonly rootSelector: string;
  /** Selector of one result block, relative to that root, e.g. `.blockquoteresult`. */
  readonly blockSelector: string;
}

/** One search result as the document renders it, before projection. */
interface SearchBlockReading {
  /** The block's link text: the name the result carries. */
  readonly primaryText: string;
  /** The line beneath it, e.g. `Entity:Client | Office:Head Office`; `''` when absent. */
  readonly secondaryText: string;
  /** The account number the block prints after its `#`, or `''` when it prints none. */
  readonly accountNo: string;
  /** The href the block's link points at, or `null` when the link is not displayed. */
  readonly link: string | null;
}

/** Runs inside the page: reads every row of a table as its cells, its status colour and its link. */
function readRowsInPage(query: RowQuery): RowReading[] {
  const statusTokens: readonly string[] = [
    'status-active',
    'status-pending',
    'status-closed',
    'status-other',
  ];

  const readings: RowReading[] = [];
  const root = document.querySelector(query.rootSelector);

  if (root === null) {
    return readings;
  }

  for (const row of Array.from(root.querySelectorAll(query.rowSelector))) {
    const cells: string[] = [];

    for (const cell of Array.from(row.querySelectorAll('td'))) {
      const rendered: string = (cell as HTMLElement).innerText;
      const raw: string = typeof rendered === 'string' ? rendered : (cell.textContent ?? '');
      cells.push(raw.replace(/\s+/g, ' ').trim());
    }

    let statusClass = '';
    const indicator: Element | null = row.querySelector(
      '.status-swatch, .status-active, .status-pending, .status-closed, .status-other',
    );

    if (indicator !== null) {
      for (const token of statusTokens) {
        if (indicator.classList.contains(token)) {
          statusClass = token;
          break;
        }
      }
    }

    let link: string | null = null;
    const anchor: Element | null = row.querySelector('a');

    if (anchor !== null) {
      const box: DOMRect = anchor.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        link = anchor.getAttribute('href');
      }
    }

    readings.push({ cells, statusClass, link });
  }

  return readings;
}

/** Runs inside the page: reads every result block of the search results as the name line, the line beneath it and the account segment the name line carries. */
function readSearchBlocksInPage(query: SearchBlockQuery): SearchBlockReading[] {
  const readings: SearchBlockReading[] = [];
  const root = document.querySelector(query.rootSelector);

  if (root === null) {
    return readings;
  }

  const blocks: Element[] = Array.from(root.querySelectorAll(query.blockSelector));

  for (const block of blocks) {
    const anchor: Element | null = block.querySelector('a');
    const rendered: string = (block as HTMLElement).innerText;
    const raw: string = typeof rendered === 'string' ? rendered : (block.textContent ?? '');
    const lines: string[] = raw.split('\n');
    let head = '';
    let tail = '';

    for (let index = 0; index < lines.length; index += 1) {
      const line: string = lines[index].replace(/\s+/g, ' ').trim();

      if (line.length === 0) {
        continue;
      }

      if (head === '') {
        head = line;
      } else if (tail === '') {
        tail = line;
      }
    }

    let accountNo = '';
    const hash: number = head.indexOf('#');

    if (hash !== -1) {
      const after: string = head.slice(hash + 1);
      let digits = '';

      for (const character of after) {
        if (character < '0' || character > '9') {
          break;
        }
        digits += character;
      }

      accountNo = digits;
    }

    let link: string | null = null;

    if (anchor !== null) {
      const box: DOMRect = anchor.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        link = anchor.getAttribute('href');
      }
    }

    const primaryText: string = head.split('|')[0].replace(/\s+/g, ' ').trim();

    readings.push({ primaryText, secondaryText: tail, accountNo, link });
  }

  return readings;
}

/** Runs inside the page: reads every status indicator on the screen (AAP 0.10.5). */
function readSwatchesInPage(hostSelector: string): SwatchReading[] {
  const statusTokens: readonly string[] = [
    'status-active',
    'status-pending',
    'status-closed',
    'status-other',
  ];

  const readings: SwatchReading[] = [];

  for (const host of Array.from(document.querySelectorAll(hostSelector))) {
    let statusClass = '';

    for (const token of statusTokens) {
      if (host.classList.contains(token)) {
        statusClass = token;
        break;
      }
    }

    const inner: Element | null = host.firstElementChild;

    if (statusClass === '' && inner !== null) {
      for (const token of statusTokens) {
        if (inner.classList.contains(token)) {
          statusClass = token;
          break;
        }
      }
    }

    const rendered: string = (host as HTMLElement).innerText;
    const raw: string = typeof rendered === 'string' ? rendered : (host.textContent ?? '');

    readings.push({ statusClass, text: raw.replace(/\s+/g, ' ').trim() });
  }

  return readings;
}

/** Runs inside the page: reads every notice the notification host is showing. */
function readNotificationsInPage(hostSelector: string): NotificationReading[] {
  const readings: NotificationReading[] = [];
  const host = document.querySelector(hostSelector);

  if (host === null) {
    return readings;
  }

  for (const notice of Array.from(host.querySelectorAll('.notification, .alert'))) {
    const copy = notice.cloneNode(true) as Element;

    for (const close of Array.from(copy.querySelectorAll('.close'))) {
      close.remove();
    }

    const rendered: string = (copy as HTMLElement).innerText;
    const raw: string = typeof rendered === 'string' ? rendered : (copy.textContent ?? '');

    readings.push({
      className: notice.getAttribute('class') ?? '',
      text: raw.replace(/\s+/g, ' ').trim(),
    });
  }

  return readings;
}

/** Collapses the whitespace a template leaves between its elements, then trims. */
function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Escapes every character that would otherwise be read as part of a pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds the case-insensitive pattern a caller's label is matched with. */
function labelPattern(label: string): RegExp {
  const tokens: readonly string[] = label
    .trim()
    .split(/\s+/)
    .filter((token: string): boolean => token.length > 0);

  if (tokens.length === 0) {
    throw new Error('a field label is required: an empty label would match every caption on screen');
  }

  return new RegExp(tokens.map((token: string): string => escapeRegExp(token)).join('\\s*'), 'i');
}

/** Renders an argument a caller passed, so an error message shows a blank or odd value as it arrived. */
function describeArgument(value: number | string): string {
  return typeof value === 'number' ? String(value) : JSON.stringify(value);
}

/** Renders a client id as the single hash-route segment it has to be. */
function requireRouteId(value: number | string, role: string): string {
  const text: string = (
    typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value
  ).trim();

  if (text.length === 0) {
    throw new Error(`${role} must be a non-empty id; received ${describeArgument(value)}`);
  }
  if (/[/?#]/.test(text)) {
    throw new Error(`${role} must be a single route segment; received ${describeArgument(value)}`);
  }

  return text;
}

/** Reads a cell by position, answering `''` for a column the row does not render. */
function cellAt(cells: readonly string[], index: number): string {
  return index >= 0 && index < cells.length ? cells[index] : '';
}

/** Maps a notice's class attribute onto the kind the notification queue holds. */
function notificationKind(className: string): NotificationView['kind'] {
  const has = (accent: string): boolean =>
    new RegExp(`(^|\\s)(notification|alert)-${accent}(\\s|$)`).test(className);

  if (has('success')) {
    return 'success';
  }
  if (has('error') || has('danger')) {
    return 'error';
  }
  if (has('info')) {
    return 'info';
  }
  return 'unknown';
}


/** Drives the new application's client screens and reads what they render. */
export class ClientsPage {
  /** @param page The Playwright page the `next` project drives. The object holds no other collaborator: it composes the entry URL from `seed/fixtures.ts` and reads the document through this page alone. */
  constructor(private readonly page: Page) {}

  /** Opens the clients list and waits for its first answer. `authGuard` redirects an unauthenticated navigation to `/login`, so a caller that has not signed in sees this wait time out naming `app-client-list` rather than a (AAP 0.10.1). */
  async open(): Promise<void> {
    await this.navigate('/clients');
    await this.awaitScreen(LIST_ROOT, 'the clients list');
    await this.awaitListSettled();
  }

  /** Opens the create-client form, the entry point of workflow W2. */
  async openCreateForm(): Promise<void> {
    await this.navigate('/clients');
    await this.awaitScreen(LIST_ROOT, 'the clients list');
    await this.awaitListSettled();

    const control = this.page
      .locator(`${LIST_ROOT} a.btn, ${LIST_ROOT} button.btn`)
      .filter({ hasText: labelPattern('create client') })
      .first();

    if ((await control.count()) > 0 && (await control.isVisible())) {
      await control.click();
    } else {
      await this.navigate('/createclient');
    }

    await this.awaitScreen(CREATE_ROOT, 'the create-client form');
  }

  /** Submits the navbar's global search for a query. The field is filled and the attached scope selector is set when a caller supplies one; the search is then submitted with the control's own submit button when the build. */
  async searchGlobal(query: string, scope?: 'all' | 'clients' | 'loans'): Promise<void> {
    const field = await this.globalSearchField();
    await field.fill(query);

    if (scope !== undefined) {
      const selector = this.page.locator(`${GLOBAL_SEARCH_ROOT} select`).first();
      if ((await selector.count()) > 0) {
        await selector.selectOption({ value: scope });
      }
    }

    const submit = this.page
      .locator(
        `${GLOBAL_SEARCH_ROOT} button[type="submit"], ${GLOBAL_SEARCH_ROOT} button:has(.fa-search)`,
      )
      .first();

    if ((await submit.count()) > 0 && (await submit.isVisible())) {
      await submit.click();
    } else {
      await field.press('Enter');
    }

    await this.awaitScreen(SEARCH_ROOT, 'the search results');
  }

  /** Opens the global search results for a query by its own route. */
  async openSearchResults(query: string): Promise<void> {
    await this.navigate(`/search/${encodeURIComponent(query)}`);
    await this.awaitScreen(SEARCH_ROOT, 'the search results');
  }

  /** Reads the search results (workflow W3's search half). One block per result, exactly as legacy renders it: the name as the link, the `#account` segment the block prints when its family carries one, and the entity and (AAP 0.7.3). */
  async readSearchResults(): Promise<readonly SearchResultRow[]> {
    await this.awaitSearchSettled();

    const readings: readonly SearchBlockReading[] = await this.page.evaluate(
      readSearchBlocksInPage,
      {
        rootSelector: SEARCH_ROOT,
        blockSelector: SEARCH_RESULT_BLOCK,
      },
    );

    return readings.map(
      (reading: SearchBlockReading): SearchResultRow => ({
        name: reading.primaryText,
        accountNo: reading.accountNo,
        secondaryText: reading.secondaryText,
        product: '',
        statusClass: '',
        link: reading.link,
      }),
    );
  }

  /** Fills the toolbar's filter box, which narrows the rows already in hand (AAP 0.7.4). */
  async filterList(text: string): Promise<void> {
    const filter = await this.textField('filter', 'filterText');
    await filter.fill(text);
  }

  /** Fills the toolbar's find box, whose submission is the screen's server search. */
  async findList(text: string): Promise<void> {
    const find = await this.textField('find', 'find');
    await find.fill(text);
  }

  /** Submits the toolbar's find, the list's one server search. The blue primary control inside the find field's `.input-group` is the screen's own submit. */
  async submitFilter(): Promise<void> {
    const button = this.page
      .locator(
        `${LIST_ROOT} .input-group-btn button.btn-primary, ${LIST_ROOT} button.btn.btn-primary`,
      )
      .filter({ hasNotText: labelPattern('create client') })
      .first();

    if ((await button.count()) === 0) {
      throw new Error(`the clients list rendered no search submit inside ${LIST_ROOT}`);
    }

    await button.click();
    await this.awaitListReplaced();
  }

  /** Reads the list's column headings, in document order. The six captions are translated at run time from the legacy bundles, so they are reported as rendered and never hard-coded here: a caller compares them with the (AAP 0.10.2). */
  async readColumnHeaders(): Promise<readonly string[]> {
    const headers: readonly string[] = await this.page
      .locator(`${LIST_ROOT} table thead th`)
      .allInnerTexts();

    return headers.map((header: string): string => normalizeText(header));
  }

  /** Reads the list's rows, one per client the table renders. The six columns are name, client number, external id, status, office and staff, in that order. */
  async readRows(): Promise<readonly ClientRow[]> {
    await this.awaitListSettled();

    const readings: readonly RowReading[] = await this.page.evaluate(readRowsInPage, {
      rootSelector: LIST_ROOT,
      rowSelector: 'table tbody tr',
    });

    return readings.map((reading: RowReading): ClientRow => {
      const hasPair: boolean = reading.cells.length >= 2;
      return {
        name: cellAt(reading.cells, 0),
        clientNumber: cellAt(reading.cells, 1),
        office: hasPair ? cellAt(reading.cells, reading.cells.length - 2) : '',
        staff: hasPair ? cellAt(reading.cells, reading.cells.length - 1) : '',
        statusClass: reading.statusClass,
        cells: reading.cells,
      };
    });
  }

  /** Reads every status indicator the screen paints — one per list row, or one per results row (AAP 0.10.5). */
  async readStatusSwatches(): Promise<readonly StatusSwatchView[]> {
    await this.awaitListReadyIfOpen();

    const readings: readonly SwatchReading[] = await this.page.evaluate(
      readSwatchesInPage,
      STATUS_SWATCH,
    );

    return readings.map(
      (reading: SwatchReading): StatusSwatchView => ({
        statusClass: reading.statusClass,
        text: reading.text,
      }),
    );
  }

  /** Opens one client's record by clicking the row whose name column carries it. */
  async openClient(name: string): Promise<void> {
    if (name.trim().length === 0) {
      throw new Error('a client name is required: an empty name would open the first row of the list');
    }

    const pattern = new RegExp(escapeRegExp(name.trim()), 'i');

    await this.awaitListSettled();

    const rows = this.page.locator(`${LIST_ROOT} table tbody tr`);
    const count: number = await rows.count();

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      const nameCell = row.locator('td').first();
      if (pattern.test(normalizeText(await nameCell.innerText()))) {
        await row.click();
        await this.awaitScreen(VIEW_ROOT, `the client record the "${name}" row opens`);
        return;
      }
    }

    throw new Error(
      `no client row in ${LIST_ROOT} carries "${name}" in its name column; examined ${count} row(s)`,
    );
  }

  /** Reads the explicit empty state the screen is showing, or `null` when it shows none (AAP 0.7.4). */
  async readEmptyState(): Promise<string | null> {
    await this.awaitListReadyIfOpen();

    const states = this.page.locator(`${LIST_ROOT} ${EMPTY_STATE}, ${SEARCH_ROOT} ${EMPTY_STATE}`);
    const count: number = await states.count();

    for (let index = 0; index < count; index += 1) {
      const text: string = normalizeText(await states.nth(index).innerText());
      if (text.length > 0) {
        return text;
      }
    }

    return null;
  }

  /** Reads the messages the application's single notification host is showing. */
  async readNotifications(): Promise<readonly NotificationView[]> {
    const readings: readonly NotificationReading[] = await this.page.evaluate(
      readNotificationsInPage,
      NOTIFICATION_HOST,
    );

    return readings.map(
      (reading: NotificationReading): NotificationView => ({
        kind: notificationKind(reading.className),
        text: reading.text,
      }),
    );
  }

  /** Writes a caller's values into the open client form. Only the fields a caller supplies are touched, so the template endpoint's defaults survive everywhere else (Rule 1 clause 3) (Rule 1 clause 2, AAP 0.10.5). */
  async fillClientForm(values: ClientFormValues): Promise<void> {
    const root = await this.openForm();

    if (values.active !== undefined) {
      const box = root.locator('[id="activeCheckbox"], .checkbox input[type="checkbox"]').first();
      if ((await box.count()) === 0) {
        throw new Error(`the open client form renders no "Active" checkbox inside ${CREATE_ROOT}`);
      }
      if (values.active) {
        await box.check();
      } else {
        await box.uncheck();
      }
    }

    if (values.officeId !== undefined) {
      await this.selectOptionById(await this.controlFor(root, /office/i, 'officeId'), values.officeId);
    }

    if (values.staffId !== undefined) {
      await this.selectOptionById(await this.controlFor(root, /staff/i, 'staffId'), values.staffId);
    }

    if (values.firstname !== undefined) {
      await (await this.controlFor(root, /first\s*name/i, 'firstname')).fill(values.firstname);
    }

    if (values.lastname !== undefined) {
      await (await this.controlFor(root, /last\s*name/i, 'lastname')).fill(values.lastname);
    }

    if (values.externalId !== undefined) {
      await (await this.controlFor(root, /external/i, 'externalId')).fill(values.externalId);
    }

    if (values.mobileNo !== undefined) {
      await (await this.controlFor(root, /mobile/i, 'mobileNo')).fill(values.mobileNo);
    }

    if (values.submittedOnDate !== undefined) {
      await (await this.controlFor(root, /submitted/i, 'submittedon')).fill(values.submittedOnDate);
    }

    if (values.activationDate !== undefined) {
      await (await this.controlFor(root, /activation/i, 'activationDate')).fill(
        values.activationDate,
      );
    }
  }

  /** Reads the options of the form's dropdown for a labelled field, in the order rendered (AAP 0.4.4). */
  async readSelectOptions(fieldLabel: string): Promise<readonly SelectOptionView[]> {
    const root = await this.openForm();
    const control = await this.findLabeledControl(root, labelPattern(fieldLabel));

    if (control === null) {
      return [];
    }

    const readings: readonly OptionReading[] = await control
      .locator('option')
      .evaluateAll((elements: Element[]): OptionReading[] =>
        elements.map((element: Element): OptionReading => {
          const option = element as HTMLOptionElement;
          return {
            value: option.value,
            label: (option.textContent ?? '').replace(/\s+/g, ' ').trim(),
            selected: option.selected,
          };
        }),
      );

    return readings.map(
      (reading: OptionReading): SelectOptionView => ({
        value: reading.value,
        label: reading.label,
        selected: reading.selected,
      }),
    );
  }

  /** Submits the open form with its own primary control. One click and never a retry: the control disables itself while its request is in flight (`[disabled]="guard.busy()"`), which is the duplicate-submission protection the. */
  async submitForm(): Promise<void> {
    await this.submitPrimary(await this.openForm());
  }

  /** Reads the open form's error regions, Fineract's own messages included. */
  async readValidationErrors(): Promise<readonly string[]> {
    const messages: readonly string[] = await this.page.evaluate(readValidationErrorsInPage, [
      CREATE_ROOT,
      EDIT_ROOT,
      ACTIONS_ROOT,
    ]);

    return messages;
  }

  /** Opens one client lifecycle action's form by its own route. The action is a member of {@link ClientAction}, so the route segment can only be one of the five the application renders, and the id is validated as a single (AAP 0.3.4, Rule 1 clause 3). */
  async openClientAction(clientId: number | string, action: ClientAction): Promise<void> {
    const id = requireRouteId(clientId, 'client id');
    await this.navigate(`/client/${id}/${action}`);
    await this.awaitScreen(ACTIONS_ROOT, `the client ${action} form`);
  }

  /** Submits the open lifecycle action with its own primary control. */
  async submitAction(): Promise<void> {
    const root = this.page.locator(ACTIONS_ROOT).first();
    await this.submitPrimary(root);
  }

  /** Composes a screen's entry URL: the application, both configuration query parameters and the hash route (Rule 2; AAP 0.4.4 decision 5). @param route Hash route of the screen, starting with `/`. */
  private screenUrl(route: string): string {
    return `${NEXT_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}&tenantIdentifier=${TENANT_ID}#${route}`;
  }

  /** Navigates to a hash route on the full entry URL. The navigation is confirmed against `window.location.hash` rather than trusted: when the router has not applied the fragment — a document already open, or a redirect that. */
  private async navigate(route: string): Promise<void> {
    await this.page.goto(this.screenUrl(route));

    const applied: boolean = await this.page.evaluate(
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
      const hash: string = await this.page
        .evaluate((): string => window.location.hash)
        .catch((): string => '');
      throw new Error(
        `${description} (${selector}) did not appear within ${SCREEN_TIMEOUT_MS} ms; ` +
          `the page is at ${hash.length > 0 ? hash : 'no hash at all'}`,
      );
    }
  }

  /** Finds the navbar's global search field and waits for it to be usable. */
  private async globalSearchField(): Promise<Locator> {
    const field = this.page
      .locator(
        `${GLOBAL_SEARCH_ROOT} input#search, ${GLOBAL_SEARCH_ROOT} input[type="search"], ` +
          `${GLOBAL_SEARCH_ROOT} input[type="text"]`,
      )
      .first();

    await field.waitFor({ state: 'visible', timeout: SCREEN_TIMEOUT_MS });

    return field;
  }

  /** Resolves one of the list toolbar's two text fields. The caption a caller passes is matched against the control's placeholder and its accessible name first, which is what keeps the answer right when a build reorders the. */
  private async textField(caption: string, inputId: string): Promise<Locator> {
    const root = this.page.locator(LIST_ROOT).first();

    if ((await root.count()) === 0) {
      throw new Error(`the clients list (${LIST_ROOT}) is not open`);
    }

    const pattern = labelPattern(caption);
    const inputs = root.locator('input[type="text"], input[type="search"]');
    const count: number = await inputs.count();

    for (let index = 0; index < count; index += 1) {
      const input = inputs.nth(index);
      const placeholder = normalizeText((await input.getAttribute('placeholder')) ?? '');
      const accessibleName = normalizeText((await input.getAttribute('aria-label')) ?? '');
      if (pattern.test(placeholder) || pattern.test(accessibleName)) {
        return input;
      }
    }

    const byId = root.locator(`[id="${inputId}"]`);
    if ((await byId.count()) > 0) {
      return byId.first();
    }

    const position: number = caption === 'filter' ? 0 : 1;
    if (position < count) {
      return inputs.nth(position);
    }

    throw new Error(
      `the clients list renders no "${caption}" text field: ${count} text input(s) were found`,
    );
  }

  /** Waits until the list has painted one of its states. Four outcomes are painted mutually exclusively and any of them is a settled screen: the table, the explicit empty state, the card's failure banner for a 4xx, or the (AAP 0.7.4). */
  private async awaitListSettled(): Promise<void> {
    const settled = this.page
      .locator(
        `${LIST_ROOT} table, ${LIST_ROOT} ${EMPTY_STATE}, ${LIST_ROOT} .alert, ` +
          `${NOTIFICATION_HOST} .notification, ${NOTIFICATION_HOST} .alert`,
      )
      .first();

    await this.awaitSettled(settled, 'the clients list');
  }

  /** Waits until the search results have painted one of their states: the table, the empty state or the failure banner (AAP 0.7.4). @throws When none of them appears within {@link SCREEN_TIMEOUT_MS}. */
  private async awaitSearchSettled(): Promise<void> {
    const settled = this.page
      .locator(`${SEARCH_ROOT} table, ${SEARCH_ROOT} ${EMPTY_STATE}, ${SEARCH_ROOT} .alert`)
      .first();

    await this.awaitSettled(settled, 'the search results');
  }

  /** Waits for a settled element, reporting the page's hash instead of a bare timeout when it never arrives. @param target The element to wait for. @param description What the element belongs to, used in the error message.. */
  private async awaitSettled(target: Locator, description: string): Promise<void> {
    try {
      await target.waitFor({ state: 'attached', timeout: SCREEN_TIMEOUT_MS });
    } catch {
      const hash: string = await this.page
        .evaluate((): string => window.location.hash)
        .catch((): string => '');
      throw new Error(
        `${description} painted none of its states within ${SCREEN_TIMEOUT_MS} ms; ` +
          `the page is at ${hash.length > 0 ? hash : 'no hash at all'}`,
      );
    }
  }

  /** Waits for a submitted find to replace the rows the list was holding. */
  private async awaitListReplaced(): Promise<void> {
    const rows = this.page.locator(`${LIST_ROOT} table tbody tr`);

    try {
      await rows.first().waitFor({ state: 'detached', timeout: REPAINT_TIMEOUT_MS });
    } catch {
      // The rows never left: the answer arrived before the busy state was painted, and the settle below reads the answer that is already on screen.
    }

    await this.awaitListSettled();
  }

  /** Settles the list when it is the open screen, and does nothing when another screen is. */
  private async awaitListReadyIfOpen(): Promise<void> {
    const root = this.page.locator(LIST_ROOT).first();

    if ((await root.count()) > 0) {
      await this.awaitListSettled();
    }
  }

  /** The client form that is currently open. @returns The visible root of the create, edit or lifecycle action form. @throws When none of the three is on screen — a caller that asks for a form before opening one, or one. */
  private async openForm(): Promise<Locator> {
    for (const selector of [CREATE_ROOT, EDIT_ROOT, ACTIONS_ROOT]) {
      const root = this.page.locator(selector).first();
      if ((await root.count()) > 0 && (await root.isVisible())) {
        return root;
      }
    }

    throw new Error(
      `no client form is open: one of ${CREATE_ROOT}, ${EDIT_ROOT} or ${ACTIONS_ROOT} must be on screen`,
    );
  }

  /** Finds the control a form field's own caption names. The create screen renders the office, staff and date captions outside the field component, as a `<label for>` pointing at the control's id, so the label's `for` target. */
  private async findLabeledControl(root: Locator, pattern: RegExp): Promise<Locator | null> {
    const labels = root.locator('.control-label');
    const count: number = await labels.count();

    for (let index = 0; index < count; index += 1) {
      const label = labels.nth(index);
      if (!pattern.test(normalizeText(await label.innerText()))) {
        continue;
      }

      const targetId = normalizeText((await label.getAttribute('for')) ?? '');
      if (targetId.length === 0 || targetId.includes('"')) {
        continue;
      }

      const control = root.locator(`[id="${targetId}"]`);
      if ((await control.count()) > 0) {
        return control.first();
      }
    }

    return null;
  }

  /** Resolves a field's control by its caption, falling back to the id the legacy markup gave it. @param root The open form's root element. @param pattern The field's caption. @param inputId The id the field carries when the. */
  private async controlFor(
    root: Locator,
    pattern: RegExp,
    inputId: string,
  ): Promise<Locator> {
    const labeled = await this.findLabeledControl(root, pattern);
    if (labeled !== null) {
      return labeled;
    }

    const byId = root.locator(`[id="${inputId}"]`);
    if ((await byId.count()) > 0) {
      return byId.first();
    }

    throw new Error(`the open client form renders no "${inputId}" control and no caption for it`);
  }

  /** Selects the option carrying a Fineract id on a native `<select>`. */
  private async selectOptionById(select: Locator, id: number | string): Promise<void> {
    const wanted = String(id).trim();

    if (wanted.length === 0) {
      throw new Error(`a select option id is required; received ${describeArgument(id)}`);
    }

    const options: readonly OptionReading[] = await select
      .locator('option')
      .evaluateAll((elements: Element[]): OptionReading[] =>
        elements.map((element: Element): OptionReading => {
          const option = element as HTMLOptionElement;
          return {
            value: option.value,
            label: (option.textContent ?? '').replace(/\s+/g, ' ').trim(),
            selected: option.selected,
          };
        }),
      );

    const position: number = options.findIndex(
      (option: OptionReading): boolean =>
        option.value === wanted || option.value.replace(/^[^:]*:\s*/, '') === wanted,
    );

    if (position < 0) {
      throw new Error(
        `the select offers no option for id ${JSON.stringify(wanted)}; it renders ${options.length} option(s)`,
      );
    }

    await select.selectOption({ index: position });
  }

  /** Clicks a screen's own primary submit, once. The control is awaited before it is clicked, because a lifecycle action form paints no field and no button until its datatable gate has answered. */
  private async submitPrimary(root: Locator): Promise<void> {
    const fallback = root.locator('form button[type="submit"], form .btn.btn-primary').first();

    await fallback.waitFor({ state: 'visible', timeout: SCREEN_TIMEOUT_MS });

    const primary = root.locator('form button[type="submit"].btn.btn-primary').first();

    if ((await primary.count()) > 0 && (await primary.isVisible())) {
      await primary.click();
      return;
    }

    await fallback.click();
  }
}

/** One option of a dropdown as it is read out of the document. */
interface OptionReading {
  /** The option's DOM value, Angular's own prefix included when it is bound with `[ngValue]`. */
  readonly value: string;
  /** The option's visible label, trimmed. */
  readonly label: string;
  /** Whether the option is the one currently selected. */
  readonly selected: boolean;
}

/** Runs inside the page: reads the error regions of whichever client form is open (Rule 1 clause 3). */
function readValidationErrorsInPage(rootSelectors: readonly string[]): string[] {
  const messages: string[] = [];

  for (const selector of rootSelectors) {
    const root = document.querySelector(selector);

    if (root === null) {
      continue;
    }

    for (const region of Array.from(root.querySelectorAll('.alert.alert-danger, .help-block'))) {
      const rendered: string = (region as HTMLElement).innerText;
      const raw: string = typeof rendered === 'string' ? rendered : (region.textContent ?? '');
      const text: string = raw.replace(/\s+/g, ' ').trim();

      if (text.length > 0) {
        messages.push(text);
      }
    }
  }

  return messages;
}
