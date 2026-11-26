/** Page object for the new Angular application's client screens — the `next` project's side of workflow **W2** (create a client and activate it), workflow **W3** (search for a client and read the list's answer), the client lifecycle actions and the validation surface workflow **W7** asserts (AAP 0.10.1, AAP 0.11.1, AAP 0.8.1, AAP 0.8.2). */
import type { Locator, Page, Response } from '@playwright/test';

import { FINERACT_URL, NEXT_URL, TENANT_ID } from '../../seed/fixtures.js';

/** One row of the client list, as the report compares it (AAP 0.10.1 W3; AAP 0.2.1 step 2) (AAP 0.7.2, AAP 0.10.5). */
export interface ClientRow {
  readonly name: string;
  readonly clientNumber: string;
  readonly office: string;
  readonly staff: string;
  readonly statusClass: string;
  readonly cells: readonly string[];
}

export interface StatusSwatchView {
  readonly statusClass: string;
  readonly text: string;
}

export interface NotificationView {
  readonly kind: 'info' | 'success' | 'error' | 'unknown';
  readonly text: string;
}

/** One result of the global search (`#/search/:query`, AAP 0.7.3 "Shell: global search"). */
export interface SearchResultRow {
  readonly name: string;
  readonly accountNo: string;
  readonly secondaryText: string;
  readonly product: string;
  readonly statusClass: string;
  readonly link: string | null;
}

export interface SelectOptionView {
  readonly value: string;
  readonly label: string;
  readonly selected: boolean;
}

/** The values {@link ClientsPage.fillClientForm} writes into the client form (Rule 1 clause 3). */
export interface ClientFormValues {
  readonly officeId?: number | string;
  readonly staffId?: number | string;
  readonly firstname?: string;
  readonly lastname?: string;
  readonly externalId?: string;
  readonly mobileNo?: string;
  readonly submittedOnDate?: string;
  readonly activationDate?: string;
  readonly active?: boolean;
}

/** The five client lifecycle actions the migration keeps (AAP 0.7.2 `ClientActionRequest`; AAP 0.9.1 scope group 2). */
export type ClientAction = 'activate' | 'close' | 'reject' | 'withdraw' | 'reactivate';

const LIST_ROOT = 'app-client-list';

/** The find field's own read: `GET /search`, the server search legacy's `ClientController.search()` makes for the same text and the only request a find submission issues (AAP 0.7.3 row "Shell: global search"; AAP 0.7.4 "search (server)"). */
const FIND_PATH = '/search';

const CREATE_ROOT = 'app-client-create';

const EDIT_ROOT = 'app-client-edit';

const ACTIONS_ROOT = 'app-client-actions';

const VIEW_ROOT = 'app-client-view';

const SEARCH_ROOT = 'app-search-results';

/** One result of the global search: the block legacy renders per result — `div.blockquoteresult` in `app/views/search/glresults.html:10-11` — whose class the product stylesheet reproduces because the partial that declares it is not imported. */
const SEARCH_RESULT_BLOCK = '.blockquoteresult';

const GLOBAL_SEARCH_ROOT = 'app-global-search';

const NOTIFICATION_HOST = 'app-notification';

const STATUS_SWATCH = 'app-status-swatch';

const EMPTY_STATE = 'app-empty-state';

// The six colour classes the status indicator paints — `status-active`, `status-pending`, `status-closed`, `status-rejected`, `status-withdrawn` and `status-other` — are the vocabulary `shared/status-swatch` binds (AAP 0.2.3 row `StatusSwatch`, AAP 0.5.4 row "Status indicator").

const SCREEN_TIMEOUT_MS = 30_000;

const REPAINT_TIMEOUT_MS = 10_000;

/** Ceiling for the create form's option lists to arrive: the screen reads `GET /clients/template` when it is constructed, so its office and staff pickers carry no option for a moment after the form paints (AAP 0.7.3 "W2 create and activate client"). */
const TEMPLATE_TIMEOUT_MS = 30_000;

const OPTION_POLL_INTERVAL_MS = 100;


interface RowReading {
  readonly cells: readonly string[];
  readonly statusClass: string;
  readonly link: string | null;
}

interface SwatchReading {
  readonly statusClass: string;
  readonly text: string;
}

interface NotificationReading {
  readonly className: string;
  readonly text: string;
}

interface RowQuery {
  readonly rootSelector: string;
  readonly rowSelector: string;
}

interface SearchBlockQuery {
  readonly rootSelector: string;
  readonly blockSelector: string;
}

interface SearchBlockReading {
  readonly primaryText: string;
  readonly secondaryText: string;
  readonly accountNo: string;
  readonly link: string | null;
}

function readRowsInPage(query: RowQuery): RowReading[] {
  const statusTokens: readonly string[] = [
    'status-active',
    'status-pending',
    'status-closed',
    'status-rejected',
    'status-withdrawn',
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
      '.status-swatch, .status-active, .status-pending, .status-closed, .status-rejected, .status-withdrawn, .status-other',
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
    'status-rejected',
    'status-withdrawn',
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

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function describeArgument(value: number | string): string {
  return typeof value === 'number' ? String(value) : JSON.stringify(value);
}

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

function cellAt(cells: readonly string[], index: number): string {
  return index >= 0 && index < cells.length ? cells[index] : '';
}

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


export class ClientsPage {
  /** @param page The Playwright page the `next` project drives. The object holds no other collaborator: it composes the entry URL from `seed/fixtures.ts` and reads the document through this page alone. */
  constructor(private readonly page: Page) {}

  /** Opens the clients list and waits for its first answer. `authGuard` redirects an unauthenticated navigation to `/login`, so a caller that has not signed in sees this wait time out naming `app-client-list` rather than a surprising screen: the specs sign in through `pages/next/login.page.ts` first (AAP 0.10.1). */
  async open(): Promise<void> {
    await this.navigate('/clients');
    await this.awaitScreen(LIST_ROOT, 'the clients list');
    await this.awaitListSettled();
  }

  /** Opens the create-client form, the entry point of workflow W2, and waits for the Fineract template that fills its office and staff pickers, so a caller reads the form's options only once they exist (AAP 0.7.3 "W2 create and activate client"). */
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
    await this.awaitCreateFormFilled();
  }

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

  async openSearchResults(query: string): Promise<void> {
    await this.navigate(`/search/${encodeURIComponent(query)}`);
    await this.awaitScreen(SEARCH_ROOT, 'the search results');
  }

  /** Reads the search results (workflow W3's search half). One block per result, exactly as legacy renders it: the name as the link, the `#account` segment the block prints when its family carries one, and the entity and parent line beneath, e.g. `Entity:Client | Office:Head Office` (AAP 0.7.3). */
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

  async findList(text: string): Promise<void> {
    const find = await this.textField('find', 'find');
    await find.fill(text);
  }

  /** Submits the toolbar's find, the list's one server search. The blue primary control inside the find field's `.input-group` is the screen's own submit. The wait ends once the screen has applied the find's answer — the `GET /search` the click issues has answered and the card's own `aria-busy` mark is gone — so a caller reads the find's rows and never the page that was in view before it (AAP 0.7.4 "search (server)"; AAP 0.14.1 "one request per click"). */
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

    const answered = this.page
      .waitForResponse(
        (response: Response): boolean =>
          response.request().method() === 'GET' && response.url().includes(FIND_PATH),
        { timeout: SCREEN_TIMEOUT_MS },
      )
      .catch((): null => null);

    await button.click();
    await answered;
    await this.awaitListApplied();
  }

  /** Reads the list's column headings, in document order. The six captions are translated at run time from the legacy bundles, so they are reported as rendered and never hard-coded here: a caller compares them with the API-derived values (AAP 0.10.2) rather than with an invented English string. */
  async readColumnHeaders(): Promise<readonly string[]> {
    const headers: readonly string[] = await this.page
      .locator(`${LIST_ROOT} table thead th`)
      .allInnerTexts();

    return headers.map((header: string): string => normalizeText(header));
  }

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

  /** Opens the record of the client named `name`, the row-into-record step of workflow W3 and the precondition W4–W7 enter their record from. The list shows fifteen rows a page, so a row that is not on the page in view is looked for through the screen's own find — the server search its blue button submits — and the list is read once more; a client the find does not answer either is reported with both row counts, so a genuine absence is told apart from a paging problem (AAP 0.7.4 "search (server)"). */
  async openClient(name: string): Promise<void> {
    if (name.trim().length === 0) {
      throw new Error('a client name is required: an empty name would open the first row of the list');
    }

    const pattern = new RegExp(escapeRegExp(name.trim()), 'i');

    await this.awaitListSettled();

    const onPage: number = await this.listRows().count();

    if (await this.clickRowMatching(pattern)) {
      await this.awaitScreen(VIEW_ROOT, `the client record the "${name}" row opens`);
      return;
    }

    await this.findList(name.trim());
    await this.submitFilter();

    const inFind: number = await this.listRows().count();

    if (await this.clickRowMatching(pattern)) {
      await this.awaitScreen(VIEW_ROOT, `the client record the "${name}" row opens`);
      return;
    }

    throw new Error(
      `no client row in ${LIST_ROOT} carries "${name}" in its name column: the page in view held ` +
        `${onPage} row(s) and the find for "${name}" answered ${inFind}, and none of them matches`,
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

  /** Submits the open form with its own primary control. One click and never a retry: the control disables itself while its request is in flight (`[disabled]="guard.busy()"`), which is the duplicate-submission protection the workflow asserts. */
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

  /** Opens one client lifecycle action's form by its own route. The action is a member of {@link ClientAction}, so the route segment can only be one of the five the application renders, and the id is validated as a single route segment before it is used (AAP 0.3.4, Rule 1 clause 3). */
  async openClientAction(clientId: number | string, action: ClientAction): Promise<void> {
    const id = requireRouteId(clientId, 'client id');
    await this.navigate(`/client/${id}/${action}`);
    await this.awaitScreen(ACTIONS_ROOT, `the client ${action} form`);
  }

  async submitAction(): Promise<void> {
    const root = this.page.locator(ACTIONS_ROOT).first();
    await this.submitPrimary(root);
  }

  /** Composes a screen's entry URL: the application, both configuration query parameters and the hash route (Rule 2; AAP 0.4.4 decision 5). @param route Hash route of the screen, starting with `/`. */
  private screenUrl(route: string): string {
    return `${NEXT_URL}/?baseApiUrl=${encodeURIComponent(FINERACT_URL)}&tenantIdentifier=${TENANT_ID}#${route}`;
  }

  /** Navigates to a hash route on the full entry URL. The navigation is confirmed against `window.location.hash` rather than trusted: when the router has not applied the fragment — a document that was already open, or a redirect that ran first — the hash is set in the page as the second way to ask it. */
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

  /** Waits until the list has painted one of its states. Four outcomes are painted mutually exclusively and any of them is a settled screen: the table, the explicit empty state, the card's failure banner for a 4xx, or the notification host's message for a 5xx or a transport fault (AAP 0.7.4). */
  private async awaitListSettled(): Promise<void> {
    const settled = this.page
      .locator(
        `${LIST_ROOT} table, ${LIST_ROOT} ${EMPTY_STATE}, ${LIST_ROOT} .alert, ` +
          `${NOTIFICATION_HOST} .notification, ${NOTIFICATION_HOST} .alert`,
      )
      .first();

    await this.awaitSettled(settled, 'the clients list');
  }

  /** Waits until the search results have painted one of the three states the screen renders: one {@link SEARCH_RESULT_BLOCK} per resolved result, the explicit empty state when the answer matched nothing, or the failure banner a 4xx shows above the results (AAP 0.7.4). @throws When none of them appears within {@link SCREEN_TIMEOUT_MS}. */
  private async awaitSearchSettled(): Promise<void> {
    const settled = this.page
      .locator(
        `${SEARCH_ROOT} ${SEARCH_RESULT_BLOCK}, ${SEARCH_ROOT} ${EMPTY_STATE}, ${SEARCH_ROOT} .alert`,
      )
      .first();

    await this.awaitSettled(settled, 'the search results');
  }

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

  /** Waits until the list has applied the answer it just read. The card marks its body `aria-busy` for as long as a read is in flight, so the wait ends once that mark is gone; the settled state is then read as the answer itself. A read that finished between two polls leaves no mark to observe, and the state on screen is read as it stands. */
  private async awaitListApplied(): Promise<void> {
    const busy = this.page.locator(`${LIST_ROOT} .panel-body[aria-busy="true"]`);
    const attempts = Math.ceil(REPAINT_TIMEOUT_MS / OPTION_POLL_INTERVAL_MS);

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if ((await busy.count()) === 0) {
        break;
      }

      await this.page.waitForTimeout(OPTION_POLL_INTERVAL_MS);
    }

    await this.awaitListSettled();
  }

  private async awaitListReadyIfOpen(): Promise<void> {
    const root = this.page.locator(LIST_ROOT).first();

    if ((await root.count()) > 0) {
      await this.awaitListSettled();
    }
  }

  /** The rows of the list's table, as the screen has painted them — one page of fifteen on a list read, or the whole answer of a find (AAP 0.7.4). */
  private listRows(): Locator {
    return this.page.locator(`${LIST_ROOT} table tbody tr`);
  }

  /** Clicks the row of the page in view whose name column matches `pattern`, answering whether it found and clicked one. The page in view only: a caller that needs a row from beyond it narrows the list through the screen's own find first. */
  private async clickRowMatching(pattern: RegExp): Promise<boolean> {
    const rows = this.listRows();
    const count: number = await rows.count();

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      const nameCell = row.locator('td').first();
      if (pattern.test(normalizeText(await nameCell.innerText()))) {
        await row.click();
        return true;
      }
    }

    return false;
  }

  /** Waits for `GET /clients/template` to fill the open create form's pickers: the screen reads the template when it is constructed and paints each `<select>` from the answer, so the office control offers no option until that read lands (AAP 0.7.3 "W2 create and activate client"). One option settles the wait — this backend answers as few as one office, so a second option is never required — and the form's failure banner settles it at once, because a refused template never fills the list. @throws When the form shows Fineract's failure message for the read, or when the office control still offers no option after {@link TEMPLATE_TIMEOUT_MS}. */
  private async awaitCreateFormFilled(): Promise<void> {
    const office = await this.controlFor(
      this.page.locator(CREATE_ROOT).first(),
      /office/i,
      'officeId',
    );
    const failure = this.page.locator(`${CREATE_ROOT} .alert.alert-danger`).first();
    const attempts = Math.ceil(TEMPLATE_TIMEOUT_MS / OPTION_POLL_INTERVAL_MS);

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if ((await failure.count()) > 0) {
        const message: string = normalizeText(await failure.innerText().catch((): string => ''));
        throw new Error(
          `the create-client form reported a failed GET /clients/template, so its office list is ` +
            `not filled: ${message.length > 0 ? message : 'it shows no message for the failure'}`,
        );
      }

      if ((await office.locator('option').count()) > 0) {
        return;
      }

      await this.page.waitForTimeout(OPTION_POLL_INTERVAL_MS);
    }

    const offered: number = await office.locator('option').count();
    throw new Error(
      `the create-client form offered no office option within ${TEMPLATE_TIMEOUT_MS} ms: its ` +
        `GET /clients/template read left ${offered} option(s) in the office control and the form ` +
        `shows no failure message`,
    );
  }

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

  /** Finds the control a form field's own caption names. The create screen renders the office, staff and date captions outside the field component, as a `<label for>` pointing at the control's id, so the label's `for` target is the handle that works for every field on every client form regardless of how the field is composed. */
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

  /** Resolves a field's control by its caption, falling back to the id the legacy markup gave it. @param root The open form's root element. @param pattern The field's caption. @param inputId The id the field carries when the caption cannot be matched. */
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

interface OptionReading {
  readonly value: string;
  readonly label: string;
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
