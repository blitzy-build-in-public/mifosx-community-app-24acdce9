/**
 * Workflow **W3 — search for a client, then view its details and accounts** — proved on both front
 * ends from one spec text (AAP 0.10.1 W3; AAP 0.11.1 row 52, the row that names this file; AAP 0.7.3
 * rows "Shell: global search", "W3 search and view client" and "Client list and edit").
 *
 * **What W3 is.** AAP 0.10.1 states the workflow as: entry through the global search and through the
 * client list's own search, "search, open the row, read the sections", and the outcome as the ordered
 * API calls — `GET /search?query=&resource=`, `GET /clients/{id}`, `GET /clients/{id}/accounts`,
 * `GET /clients/{id}/identifiers` — with "the displayed name, client number, office and status equal
 * the API's". This file drives that on the running side (`pages`, chosen by the Playwright project)
 * and reads the API through `capture/state-snapshot.ts`, so the same assertions measure the archived
 * baseline and this application.
 *
 * **Precondition and ordering contract — read before changing anything here.** `npm run e2e` runs one
 * spec set per project against one seeded database (`e2e/playwright.config.ts`: `workers: 1`,
 * `fullyParallel: false`, and the database is reset and seeded per project). Playwright collects the
 * files in filename order, so `chain-w2-w4-w5-w6.spec.ts` and `w2-create-client.spec.ts` both run
 * before this one and are what create the `Parity Client` (AAP 0.10.1 "Fixed test data": `Parity
 * Client`, office 1, submitted and activated on the run date). W3 therefore *finds* that client and
 * never creates it, and a run in which no such row exists fails here with a message naming the
 * precondition rather than skipping: a skipped workflow would read as `missing` in the parity report
 * (AAP 0.10.4, criterion 4), which hides a real problem behind a green command.
 *
 * **What the two applications actually send, and why the assertions are shaped that way.** Three
 * facts were read from the shipping code rather than assumed, and each one differs from the sketch a
 * reader might expect:
 *
 * 1. The list's **find** box is the server search on both sides. A submitted find carrying text runs
 *    `GET /search` with `query`, `resource: "clients,clientIdentifiers"` and `exactMatch` — the call
 *    legacy's `ClientController.search()` makes (`app/scripts/controllers/client/ClientController.js`)
 *    — while `GET /clients` carries `offset` and `limit` only. The display-only **filter** box issues
 *    no request at all (AAP 0.7.4: "filter (client-side display)" against "search (server)"), which is
 *    why `findList()` is the driver used here and `filterList()` is not.
 * 2. The **identifiers** read happens when the `Identities` tab is selected, not when the record
 *    loads: legacy's tab carries `select="getClientIdentityDocuments()"`
 *    (`app/views/clients/viewclient.html`), and this application renders `app-client-identifiers` only
 *    while that tab is active. The accounts read is the opposite — it belongs to `General`, which is
 *    the tab the record arrives on.
 * 3. The **empty state** is this application's, required by AAP 0.7.4; the baseline list has none
 *    (`pages/legacy/clients.page.ts` documents its `''`). Both sides must show no row and no error for
 *    a find that matches nothing, and the explicit empty state is asserted where the AAP puts it.
 *
 * **Deliberate differences respected, never asserted against (Rule 1 clause 3; AAP 0.10.5).** The
 * record's other tabs (item 6), the list's bulk-import control (item 4), the navbar's out-of-scope
 * destinations and the left rail (item 8), and the status *word* are not mentioned by any assertion:
 * the status is the colour class alone (item 11), which is why `statusClass` is compared and no status
 * text is ever read. Nothing here asserts the presence or absence of an out-of-scope control; those
 * differences belong to the parity report, which derives them from the AAP's own register.
 *
 * **Ids and dates (AAP 0.10.2).** The client id is never written into this file: it is read from the
 * route the row opened and used only to ask the API what the same client looks like. No date is
 * compared, so the browser clock can never enter a verdict; `runDate` — the tenant's business date read
 * over the API (Rule 1 clause 2) — is handed to the state snapshot so any date-bearing field it reduces
 * is expressed as an offset from that date rather than as a literal.
 *
 * **Security (Rule 1 clause 9).** Credentials come from `readCredentials()` inside the test body, are
 * handed straight to the login screen's own form and are never printed, attached or compared. The
 * capture the fixture records masks the authorization header and every session-named value as it
 * records (AAP 0.10.2), and this file reads only method, path, query and the tenant-header *presence*
 * from it.
 */
import type { CaptureSession, NormalizedExchange } from '../capture/network-capture';
import { snapshotClient } from '../capture/state-snapshot';
import type { ClientSnapshot } from '../capture/state-snapshot';
import { expect, test } from '../fixtures/parity-fixture';
import type { SearchResultRow as LegacySearchResultRow } from '../pages/legacy/clients.page';
import type { SearchResultRow as NextSearchResultRow } from '../pages/next/clients.page';
import { API_PATH, SCENARIO, readCredentials } from '../seed/fixtures';

/**
 * The text the workflow searches for: the client's first name, which both search controls match, and
 * the same string the list's find box is given (AAP 0.10.1 "Fixed test data" — `Parity Client`).
 */
const SEARCH_TEXT: string = SCENARIO.client.firstname;

/** The client's display name, the label both applications render in a list row and in the record. */
const CLIENT_NAME: string = SCENARIO.client.displayName;

/**
 * A find that cannot match a seeded client, so the screen has to render the empty result of a
 * successful read. It is spelled so no display name, client number, external id or office could
 * contain it.
 */
const NO_SUCH_CLIENT = 'zzz-no-such-client-zzz';

/**
 * The Fineract API root as a regular-expression fragment, allowed as an *optional* prefix on every
 * captured path.
 *
 * It is built from `seed/fixtures.ts`'s `API_PATH` rather than written out again, so the harness keeps
 * one declaration of the root (Rule 1 clause 2). It is optional because `capture/network-capture.ts`
 * records the pathname the browser actually requested: a capture against an API mounted somewhere else
 * is then measured by the same patterns instead of looking like a call that never happened.
 */
const API_ROOT = `(?:${API_PATH})?`;

/**
 * `GET /search` — the global search and the list's find (AAP 0.7.3 "Shell: global search").
 *
 * Anchored at both ends so it can never be satisfied by `GET /search/template`, which is the ad-hoc
 * query screen's template and not a search this workflow performs.
 */
const SEARCH_CALL = new RegExp(`^${API_ROOT}/search$`);

/** `GET /clients` — the list's page read, carrying `offset` and `limit` (AAP 0.7.3 "Client list and edit"). */
const CLIENT_LIST_CALL = new RegExp(`^${API_ROOT}/clients$`);

/**
 * `GET /clients/{id}` — one client. The id segment is accepted as the digits a browser sent or as the
 * role token `capture/network-capture.ts` templates it into, so the assertion holds whatever client
 * the run generated (AAP 0.10.2: ids are compared by role).
 */
const CLIENT_ID_SEGMENT = String.raw`(?:\d+|\{[A-Za-z]+\})`;
const CLIENT_CALL = new RegExp(`^${API_ROOT}/clients/${CLIENT_ID_SEGMENT}$`);

/** `GET /clients/{id}/accounts` — the `General` tab's accounts table (AAP 0.10.1 W3). */
const CLIENT_ACCOUNTS_CALL = new RegExp(`^${API_ROOT}/clients/${CLIENT_ID_SEGMENT}/accounts$`);

/**
 * `GET /clients/{id}/identifiers` — the `Identities` tab's table (AAP 0.10.1 W3).
 *
 * The trailing anchor keeps `GET /clients/{id}/identifiers/template` — the document-type lookup this
 * application makes only when a client actually carries an identifier — out of the count.
 */
const CLIENT_IDENTIFIERS_CALL = new RegExp(`^${API_ROOT}/clients/${CLIENT_ID_SEGMENT}/identifiers$`);

/**
 * The record route both applications serve, whose id segment is the only place a generated client id
 * enters this file (AAP 0.8.2: `viewclient/:id` mirrors the legacy path).
 */
const CLIENT_RECORD_ROUTE = /#\/viewclient\/(\d+)/;

/**
 * The active tab of the record's strip.
 *
 * Both applications are Bootstrap 3 and move Bootstrap's own `active` class onto the tab item, and each
 * page object names the same selector internally (`pages/legacy/client-view.page.ts` `ACTIVE_TAB`,
 * `pages/next/client-view.page.ts` `ACTIVE_TAB_SELECTOR`) without exposing a reader for it. Reading the
 * class here is therefore reading markup the design fixes (AAP 0.2.3 `TabStrip`), not inventing an
 * affordance.
 */
const ACTIVE_TAB = '.nav-tabs li.active > a';

/** One row of either application's global search results. */
type SearchRow = NextSearchResultRow | LegacySearchResultRow;

/** Collapses the whitespace a template leaves between elements, then trims — as the page objects do. */
function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * The label a search row carries.
 *
 * The two page objects declare different row shapes for the same table — this application's reader
 * answers `name`, the baseline's answers `primaryText` — so the union is narrowed on the member only
 * one of them declares. This is the documented boundary AAP 0.10.2 asks for: one spec text reads both
 * shapes, and no `any` is needed to do it (Rule 1 clause 4).
 *
 * @param row One result row as the running side's page object reported it.
 * @returns The row's label as the screen renders it.
 */
function searchLabelOf(row: SearchRow): string {
  return 'name' in row ? row.name : row.primaryText;
}

/**
 * Whether a rendered label is the client this workflow is about.
 *
 * Containment rather than equality, because it is the rule `openClient()` opens a row with — the row
 * whose name cell carries the name — so the row this file compares against is the row that was
 * actually opened, even where a run has two clients whose names share a prefix.
 *
 * @param label A list row's name cell or a search result's label.
 */
function namesScenarioClient(label: string): boolean {
  return label.trim().toLowerCase().includes(CLIENT_NAME.toLowerCase());
}

/**
 * Every captured exchange that is a `GET` on a path matching `pattern`.
 *
 * @param capture The running capture of this test's page.
 * @param pattern The path pattern to match, tested against the normalised path.
 */
function getCalls(
  capture: CaptureSession,
  pattern: RegExp,
): readonly NormalizedExchange[] {
  return capture.capture.exchanges.filter(
    (exchange: NormalizedExchange): boolean => exchange.method === 'GET' && pattern.test(exchange.path),
  );
}

/**
 * Waits until at least `minimum` matching calls are on the wire and answers with them.
 *
 * The capture records a request as the page issues it and fills its response in afterwards, so a
 * reader that ran the instant a screen settled could still miss the record of the call that settled it.
 * Polling closes that race for the call's *presence*; the exact counts a workflow owns are asserted
 * afterwards, once the screen's own reader has settled and any duplicate would already have been sent.
 *
 * @param capture The running capture.
 * @param pattern The path pattern that identifies the call.
 * @param minimum How many matching calls must be recorded before the wait ends.
 * @param description What the call is, used in the timeout message.
 * @throws When the count does not reach `minimum` before Playwright's assertion timeout.
 */
async function awaitCalls(
  capture: CaptureSession,
  pattern: RegExp,
  minimum: number,
  description: string,
): Promise<readonly NormalizedExchange[]> {
  await expect
    .poll((): number => getCalls(capture, pattern).length, {
      message: `${description}: the capture holds fewer than ${minimum} matching exchange(s)`,
    })
    .toBeGreaterThanOrEqual(minimum);
  return getCalls(capture, pattern);
}

/**
 * The record's reads of the client itself — `GET /clients/{id}` without a `template` query.
 *
 * The template read is a different endpoint (`?template=true` returns the create/edit form's payload
 * and `commandParam` options, AAP 0.7.3 "Client actions"), so it is excluded here rather than being
 * counted as a second read of the record.
 *
 * @param capture The running capture.
 */
function recordReads(capture: CaptureSession): readonly NormalizedExchange[] {
  return getCalls(capture, CLIENT_CALL).filter(
    (exchange: NormalizedExchange): boolean => !('template' in exchange.query),
  );
}

/**
 * The client id of the record the workflow opened, read from the page's own address (AAP 0.10.2).
 *
 * @param url The page's absolute URL, hash included.
 * @returns The id the `#/viewclient/:id` route names.
 * @throws When the address is not a client record, or when it carries no numeric id.
 */
function clientIdFromUrl(url: string): number {
  const match = CLIENT_RECORD_ROUTE.exec(url);
  const id = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(
      `the page is not on a client record: ${url} carries no #/viewclient/<id> route, so the record ` +
        'that should have opened did not, and the state this workflow compares against cannot be read',
    );
  }
  return id;
}

/**
 * W3 on the running side: the global search, the list's find, the empty result, and the record read
 * against the API (AAP 0.10.1 W3; AAP 0.11.1 row 52).
 *
 * One test, one workflow record: `runWorkflow` writes exactly one `WorkflowRecord` per project and
 * workflow id and decides the verdict from the project and from whether this body throws — `pass` when
 * it returns, `legacy-broken` when the archived baseline throws (annotated, left green) and `fail` when
 * this application does (AAP 0.10.4). The body therefore asserts and never catches: a message this
 * file's own `expect` produced is the evidence the report needs.
 */
test.describe('W3 search for a client and view details', () => {
  test('finds the Parity Client by global search and by the list find, then reads its record against the API', async ({
    runWorkflow,
  }) => {
    await runWorkflow('W3', async ({ page, pages, capture, runDate }) => {
      // ---------------------------------------------------------------------------------------
      // 1. Sign in. Every route of both applications is guarded, and Playwright gives each test a
      //    fresh context, so W3 authenticates through the application's own login screen (W1 is the
      //    login workflow's own proof; this is its ordinary precondition, exactly as it is for a
      //    person). Nothing about the credential leaves this frame (Rule 1 clause 9).
      // ---------------------------------------------------------------------------------------
      await pages.login.open();
      const credentials = readCredentials();
      await pages.login.signIn(credentials.username, credentials.password);
      await pages.clients.open();

      // ---------------------------------------------------------------------------------------
      // 2. The navbar's global search — AAP 0.7.3 "Shell: global search".
      //
      //    `searchGlobal()` submits the control and lands on the results route, which is the address
      //    `openSearchResults()` would compose; entering it a second time would be a navigation no
      //    user makes and a second read the comparison would have to explain, so the workflow takes
      //    the user's own path once.
      // ---------------------------------------------------------------------------------------
      await pages.clients.searchGlobal(SEARCH_TEXT, 'clients');

      const results: readonly SearchRow[] = await pages.clients.readSearchResults();
      const resultLabels: readonly string[] = results
        .map(searchLabelOf)
        .map(normalize)
        .filter((label: string): boolean => label.length > 0);

      expect(
        resultLabels.length,
        `the global search for "${SEARCH_TEXT}" renders at least one result row (AAP 0.10.1 W3)`,
      ).toBeGreaterThan(0);
      expect(
        resultLabels.some(namesScenarioClient),
        `the global search for "${SEARCH_TEXT}" lists the "${CLIENT_NAME}" client the seeded database holds`,
      ).toBe(true);

      const globalSearchCalls = await awaitCalls(
        capture,
        SEARCH_CALL,
        1,
        `the global search of GET /search for "${SEARCH_TEXT}"`,
      );
      const globalSearchCall = globalSearchCalls[0];

      expect(
        globalSearchCall.query['query'],
        'the global search sends the text the user typed as the `query` parameter (AAP 0.7.3)',
      ).toBe(SEARCH_TEXT);
      expect(
        globalSearchCall.query['resource']?.length ?? 0,
        'the search names the resource families it searched in `resource`, which AAP 0.10.5 item 9 fixes ' +
          'at clients and loans — the value is asserted as present and non-empty rather than as one ' +
          'particular list, because `All` legitimately means both',
      ).toBeGreaterThan(0);
      expect(
        globalSearchCall.hasTenantHeader,
        'the search carries the Fineract tenant header (Rule 1 clause 2)',
      ).toBe(true);

      // How many searches the capture already holds, so the find below can be proved to have issued
      // its own read rather than inheriting this one.
      const searchesAfterGlobalSearch = getCalls(capture, SEARCH_CALL).length;

      // ---------------------------------------------------------------------------------------
      // 3. The list's own search. `open()` re-enters the list, and the find box — not the display
      //    filter — is what reaches the server (AAP 0.7.4: "filter (client-side display)" against
      //    "search (server)").
      // ---------------------------------------------------------------------------------------
      await pages.clients.open();

      const listCalls = await awaitCalls(
        capture,
        CLIENT_LIST_CALL,
        1,
        'the client list read of GET /clients',
      );
      const listCall = listCalls[0];

      expect(
        listCall.query['offset'],
        'the list read pages with `offset`, the parameter legacy `clientResource.getAllClients` sends ' +
          '(AAP 0.3.4 "Verified adjuncts")',
      ).toMatch(/^\d+$/);
      expect(
        listCall.query['limit'],
        'the list read pages with `limit`, the second parameter that same call sends (AAP 0.3.4)',
      ).toMatch(/^\d+$/);

      await pages.clients.findList(SEARCH_TEXT);
      await pages.clients.submitFilter();

      await expect
        .poll((): number => getCalls(capture, SEARCH_CALL).length, {
          message:
            `the list's find of "${SEARCH_TEXT}" issues its own GET /search, the read legacy's ` +
            'ClientController.search() makes for the same text',
        })
        .toBeGreaterThan(searchesAfterGlobalSearch);

      const findRows = await pages.clients.readRows();
      expect(
        findRows.length,
        `the find "${SEARCH_TEXT}" renders at least one client row`,
      ).toBeGreaterThan(0);
      expect(
        findRows.some((row) => namesScenarioClient(row.name)),
        `the find "${SEARCH_TEXT}" lists the "${CLIENT_NAME}" client`,
      ).toBe(true);

      // ---------------------------------------------------------------------------------------
      // 4. A find that matches nothing: no row, no error, and — where the AAP requires it — the
      //    explicit empty state (AAP 0.7.4). The baseline list has no empty state of its own
      //    (`pages/legacy/clients.page.ts` documents that `''`), so the state itself is asserted on
      //    this application, and the behaviour the two share — an empty result that is not an error —
      //    is asserted on both.
      // ---------------------------------------------------------------------------------------
      await pages.clients.findList(NO_SUCH_CLIENT);
      await pages.clients.submitFilter();

      const emptyRows = await pages.clients.readRows();
      expect(
        emptyRows.length,
        'a find that matches no client renders no client row',
      ).toBe(0);

      const notifications = await pages.clients.readNotifications();
      expect(
        notifications.length,
        'an empty result set is a successful read, not a failure: the screen raises no notification',
      ).toBe(0);

      const emptyState = await pages.clients.readEmptyState();
      if (pages.uiProject === 'next') {
        expect(
          (emptyState ?? '').trim().length,
          'this application renders its explicit empty state for a find that matched nothing (AAP 0.7.4)',
        ).toBeGreaterThan(0);
      }

      // ---------------------------------------------------------------------------------------
      // 5. Open the record. The list is re-entered and re-found, because the empty find above left
      //    the table without rows to open.
      // ---------------------------------------------------------------------------------------
      await pages.clients.open();
      await pages.clients.findList(SEARCH_TEXT);
      await pages.clients.submitFilter();

      const parityRows = await pages.clients.readRows();
      const parityRow = parityRows.find((row) => namesScenarioClient(row.name));
      if (parityRow === undefined) {
        throw new Error(
          `W3 runs after the W2 workflow has created the "${CLIENT_NAME}" client (AAP 0.10.1 "Fixed ` +
            `test data"), so a find for "${SEARCH_TEXT}" must list it. The find answered ` +
            `${parityRows.length} row(s) and none of them is named "${CLIENT_NAME}": this file runs ` +
            'after chain-w2-w4-w5-w6.spec.ts and w2-create-client.spec.ts in Playwright\'s filename ' +
            'order against one seeded database, so that precondition was not met — run W2 first rather ' +
            'than skipping this workflow.',
        );
      }

      await pages.clients.openClient(CLIENT_NAME);
      const clientId = clientIdFromUrl(page.url());
      expect(
        clientId,
        'the record route names the client that was opened',
      ).toBeGreaterThan(0);

      // ---------------------------------------------------------------------------------------
      // 6. The record's own read: `GET /clients/{id}`, once.
      // ---------------------------------------------------------------------------------------
      await awaitCalls(capture, CLIENT_CALL, 1, 'the record read of GET /clients/{id}');
      const header = await pages.clientView.readHeader();

      expect(
        recordReads(capture).length,
        'the record reads its client exactly once per visit (AAP 0.7.3 "W3 search and view client")',
      ).toBe(1);

      // ---------------------------------------------------------------------------------------
      // 7. Displayed data against the API's own answer (AAP 0.10.1 W3: "the displayed name, client
      //    number, office and status equal the API's"). `runDate` is handed over so the snapshot
      //    expresses any date it reduces as an offset from the tenant's business date.
      // ---------------------------------------------------------------------------------------
      const snapshot: ClientSnapshot = await snapshotClient(clientId, runDate);

      expect(
        header.displayName,
        'the record title is the display name the API answers for that client',
      ).toBe(snapshot.displayName);

      expect(
        header.clientNumber.trim().length,
        'the record renders a client number (the design\'s inline `Client Number` run)',
      ).toBeGreaterThan(0);
      // `ClientSnapshot` carries no account number — `capture/state-snapshot.ts` reduces the status,
      // activation offset, office and the three counts, and deliberately no `accountNo` — so the client
      // number is proved where it can be: against the list row the record was opened from, which is
      // the same `accountNo` the API returns for that client.
      expect(
        header.clientNumber,
        'the record shows the client number of the row the list rendered for the same client',
      ).toBe(parityRow.clientNumber);

      const breadcrumb = await pages.clientView.readBreadcrumb();
      expect(
        parityRow.office.trim().length,
        'the list row carries the client\'s office name',
      ).toBeGreaterThan(0);
      // Containment, not equality: the trail is the office and, for a staffed client, the staff
      // member's name after it (both page objects document that), while the list row carries the office
      // alone.
      expect(
        breadcrumb.toLowerCase(),
        'the record trail names the office the list row carries',
      ).toContain(parityRow.office.trim().toLowerCase());
      expect(
        snapshot.officeId ?? 0,
        'the API places the client in a seeded office — the numeric office the snapshot exposes, where ' +
          'the screen shows the label',
      ).toBeGreaterThan(0);

      // The status is the colour class alone on both sides (AAP 0.10.5 item 11): the baseline paints
      // `statusactive` on the dot, this application paints `status-active`, and both are read as the
      // one word they share so the API's own `Active` is what pairs them.
      expect(
        header.statusClass.toLowerCase(),
        'the record paints the active status class for a client the API reports as active',
      ).toContain('active');
      expect(
        snapshot.status.toLowerCase(),
        'the API reports the opened client as active (AAP 0.10.1 "Fixed test data": W2 activates it)',
      ).toContain('active');

      // ---------------------------------------------------------------------------------------
      // 8. The tab strip: the two in-scope tabs, the first one active on arrival (AAP 0.10.5 item 6
      //    keeps the rest out of this assertion, because their absence is a difference the report
      //    records rather than a defect a spec should report).
      // ---------------------------------------------------------------------------------------
      const tabLabels = (await pages.clientView.readTabs()).map((label: string): string =>
        label.toLowerCase(),
      );
      expect(tabLabels, 'the record offers the `General` tab').toContain('general');
      expect(tabLabels, 'the record offers the `Identities` tab').toContain('identities');

      const activeTab = normalize(await page.locator(ACTIVE_TAB).first().innerText());
      expect(
        activeTab.toLowerCase(),
        'the record arrives on its `General` tab, the design\'s own state (AAP 0.2.1 step 3)',
      ).toContain('general');

      // ---------------------------------------------------------------------------------------
      // 9. `General`: the accounts table, from `GET /clients/{id}/accounts`, once.
      // ---------------------------------------------------------------------------------------
      await awaitCalls(
        capture,
        CLIENT_ACCOUNTS_CALL,
        1,
        'the accounts read of GET /clients/{id}/accounts',
      );
      const accounts = await pages.clientView.readAccounts();

      expect(
        getCalls(capture, CLIENT_ACCOUNTS_CALL).length,
        'the `General` tab reads the client\'s accounts exactly once per visit',
      ).toBe(1);
      expect(
        accounts.length,
        'the accounts table lists the loan and savings accounts the API counted for that client',
      ).toBe(snapshot.loanAccountCount + snapshot.savingsAccountCount);

      // ---------------------------------------------------------------------------------------
      // 10. `Identities`: the read happens when the tab is selected — legacy's tab carries
      //     `select="getClientIdentityDocuments()"` and this application renders the section only
      //     while the tab is active — so the call is asserted here, not on arrival.
      // ---------------------------------------------------------------------------------------
      await pages.clientView.selectTab('Identities');

      await awaitCalls(
        capture,
        CLIENT_IDENTIFIERS_CALL,
        1,
        'the Identities tab read of GET /clients/{id}/identifiers',
      );
      const identifiers = await pages.clientView.readIdentifiers();

      expect(
        getCalls(capture, CLIENT_IDENTIFIERS_CALL).length,
        'the `Identities` tab reads the client\'s identifiers exactly once per visit',
      ).toBe(1);
      expect(
        identifiers.length,
        'the identifiers table lists the identifiers the API counted for that client',
      ).toBe(snapshot.identifierCount);

      // The record's end state, so the report holds the same client on both sides of the comparison
      // (AAP 0.10.4). The fixture supplies the project, workflow and run date itself.
      return { stateTargets: { clientId } };
    });
  });
});

