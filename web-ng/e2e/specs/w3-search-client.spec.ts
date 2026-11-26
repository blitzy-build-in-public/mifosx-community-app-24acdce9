/** W3 — search for a client, then view its details and accounts, from one spec text on both front ends (AAP 0.10.1 W3, AAP 0.11.1 row 52, AAP 0.7.3 rows "Shell: global search", "W3 search and view client", "Client list and (AAP 0.10.2, AAP 0.10.4, AAP 0.7.4, AAP 0.10.5). */
import type { CaptureSession, NormalizedExchange } from '../capture/network-capture';
import { snapshotClient } from '../capture/state-snapshot';
import type { ClientSnapshot } from '../capture/state-snapshot';
import { expect, test } from '../fixtures/parity-fixture';
import type { SearchResultRow as LegacySearchResultRow } from '../pages/legacy/clients.page';
import type { SearchResultRow as NextSearchResultRow } from '../pages/next/clients.page';
import { API_PATH, SCENARIO, readCredentials } from '../seed/fixtures';
/** The text W3 searches for: the client's first name, which both search controls match and the list's find box is given (AAP 0.10.1 fixed data, `Parity Client`). */
const SEARCH_TEXT: string = SCENARIO.client.firstname;
/** The client's display name, the label both applications render in a list row and in the record. */
const CLIENT_NAME: string = SCENARIO.client.displayName;
/** A find that cannot match a seeded client, spelled so no display name, client number, external id or office could contain it. */
const NO_SUCH_CLIENT = 'zzz-no-such-client-zzz';
/** The API root as an optional regex prefix on every captured path, built from `seed/fixtures.ts`'s `API_PATH` so the harness declares the root once (Rule 1 clause 2). */
const API_ROOT = `(?:${API_PATH})?`;

/** `GET /search` — the global search and the list's find (AAP 0.7.3 "Shell: global search"). */
const SEARCH_CALL = new RegExp(`^${API_ROOT}/search$`);

/** `GET /clients` — the list's page read, carrying `offset` and `limit` (AAP 0.7.3 "Client list and edit"). */
const CLIENT_LIST_CALL = new RegExp(`^${API_ROOT}/clients$`);

/** `GET /clients/{id}` — one client. The id segment is accepted as the digits a browser sent or as the role token `capture/network-capture.ts` templates it into, so the assertion holds whatever client the run generated (AAP 0.10.2). */
const CLIENT_ID_SEGMENT = String.raw`(?:\d+|\{[A-Za-z]+\})`;
const CLIENT_CALL = new RegExp(`^${API_ROOT}/clients/${CLIENT_ID_SEGMENT}$`);

/** `GET /clients/{id}/accounts` — the `General` tab's accounts table (AAP 0.10.1 W3). */
const CLIENT_ACCOUNTS_CALL = new RegExp(`^${API_ROOT}/clients/${CLIENT_ID_SEGMENT}/accounts$`);

/** `GET /clients/{id}/identifiers` — the `Identities` tab's table (AAP 0.10.1 W3). */
const CLIENT_IDENTIFIERS_CALL = new RegExp(`^${API_ROOT}/clients/${CLIENT_ID_SEGMENT}/identifiers$`);

/** The record route both applications serve, whose id segment is the only place a generated client id enters this file (AAP 0.8.2: `viewclient/:id` mirrors the legacy path). */
const CLIENT_RECORD_ROUTE = /#\/viewclient\/(\d+)/;

/** The active tab of the record's strip. Both applications are Bootstrap 3 and move Bootstrap's own `active` class onto the tab item, and each page object names the same selector internally (AAP 0.2.3). */
const ACTIVE_TAB = '.nav-tabs li.active > a';

/** One row of either application's global search results. */
type SearchRow = NextSearchResultRow | LegacySearchResultRow;

/** Collapses the whitespace a template leaves between elements, then trims — as the page objects do. */
function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** The label a search row carries. The two page objects declare different row shapes for the same table — this application's reader answers `name`, the baseline's answers `primaryText` — so the union is narrowed on the (AAP 0.10.2, Rule 1 clause 4). */
function searchLabelOf(row: SearchRow): string {
  return 'name' in row ? row.name : row.primaryText;
}

/** Whether a rendered label is the client this workflow is about. */
function namesScenarioClient(label: string): boolean {
  return label.trim().toLowerCase().includes(CLIENT_NAME.toLowerCase());
}

/** Every captured exchange that is a `GET` on a path matching `pattern`. @param capture The running capture of this test's page. @param pattern The path pattern to match, tested against the normalised path. */
function getCalls(
  capture: CaptureSession,
  pattern: RegExp,
): readonly NormalizedExchange[] {
  return capture.capture.exchanges.filter(
    (exchange: NormalizedExchange): boolean => exchange.method === 'GET' && pattern.test(exchange.path),
  );
}

/** Waits until at least `minimum` matching calls are on the wire and answers with them. */
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

/** The record's reads of the client itself — `GET /clients/{id}` without a `template` query (AAP 0.7.3). */
function recordReads(capture: CaptureSession): readonly NormalizedExchange[] {
  return getCalls(capture, CLIENT_CALL).filter(
    (exchange: NormalizedExchange): boolean => !('template' in exchange.query),
  );
}

/** The client id of the record the workflow opened, read from the page's own address (AAP 0.10.2). @param url The page's absolute URL, hash included. @returns The id the `#/viewclient/:id` route names. @throws When the. */
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

/** W3 on the running side: the global search, the list's find, the empty result, and the record read against the API (AAP 0.10.1 W3; AAP 0.11.1 row 52) (AAP 0.10.4). */
test.describe('W3 search for a client and view details', () => {
  test('finds the Parity Client by global search and by the list find, then reads its record against the API', async ({
    runWorkflow,
  }) => {
    await runWorkflow('W3', async ({ page, pages, capture, runDate }) => {
      // --------------------------------------------------------------------------------------- 1 (Rule 1 clause 9).
      await pages.login.open();
      const credentials = readCredentials();
      await pages.login.signIn(credentials.username, credentials.password);
      await pages.clients.open();

      // --------------------------------------------------------------------------------------- 2 (AAP 0.7.3, AAP 0.8.2).
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

      // How many searches the capture already holds, so the find below can be proved to have issued its own read rather than inheriting this one.
      const searchesAfterGlobalSearch = getCalls(capture, SEARCH_CALL).length;

      // --------------------------------------------------------------------------------------- 3 (AAP 0.7.4).
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

      // --------------------------------------------------------------------------------------- 4 (AAP 0.7.4).
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

      // --------------------------------------------------------------------------------------- 5.
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

      // --------------------------------------------------------------------------------------- 6.
      await awaitCalls(capture, CLIENT_CALL, 1, 'the record read of GET /clients/{id}');
      const header = await pages.clientView.readHeader();

      expect(
        recordReads(capture).length,
        'the record reads its client exactly once per visit (AAP 0.7.3 "W3 search and view client")',
      ).toBe(1);

      // --------------------------------------------------------------------------------------- 7 (AAP 0.10.1).
      const snapshot: ClientSnapshot = await snapshotClient(clientId, runDate);

      expect(
        header.displayName,
        'the record title is the display name the API answers for that client',
      ).toBe(snapshot.displayName);

      expect(
        header.clientNumber.trim().length,
        'the record renders a client number (the design\'s inline `Client Number` run)',
      ).toBeGreaterThan(0);
      // `ClientSnapshot` carries no account number — `capture/state-snapshot.ts` reduces the status, activation offset, office and the three counts, and deliberately no `accountNo` — so the client number is proved where it can.
      expect(
        header.clientNumber,
        'the record shows the client number of the row the list rendered for the same client',
      ).toBe(parityRow.clientNumber);

      const breadcrumb = await pages.clientView.readBreadcrumb();
      expect(
        parityRow.office.trim().length,
        'the list row carries the client\'s office name',
      ).toBeGreaterThan(0);
      // Containment, not equality: the trail is the office and, for a staffed client, the staff member's name after it (both page objects document that), while the list row carries the office alone.
      expect(
        breadcrumb.toLowerCase(),
        'the record trail names the office the list row carries',
      ).toContain(parityRow.office.trim().toLowerCase());
      expect(
        snapshot.officeId ?? 0,
        'the API places the client in a seeded office — the numeric office the snapshot exposes, where ' +
          'the screen shows the label',
      ).toBeGreaterThan(0);

      // The status is the colour class alone on both sides (AAP 0.10.5 item 11): the baseline paints `statusactive` on the dot, this application paints `status-active`, and both are read as the one word they share so the API's.
      expect(
        header.statusClass.toLowerCase(),
        'the record paints the active status class for a client the API reports as active',
      ).toContain('active');
      expect(
        snapshot.status.toLowerCase(),
        'the API reports the opened client as active (AAP 0.10.1 "Fixed test data": W2 activates it)',
      ).toContain('active');

      // --------------------------------------------------------------------------------------- 8 (AAP 0.10.5).
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

      // --------------------------------------------------------------------------------------- 9.
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

      // --------------------------------------------------------------------------------------- 10.
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

      // The record's end state, so the report holds the same client on both sides of the comparison (AAP 0.10.4).
      return { stateTargets: { clientId } };
    });
  });
});

