/** W2 — create a client and activate it, driven through whichever front end the Playwright project names (AAP 0.10.1 W2; AAP 0.10.2; AAP 0.10.3 criteria 3 and 12; AAP 0.11.1 row 52; Rule 1 clause 8) (Rule 1 clause 2, AAP 0.10.5, Rule 1 clause 9). */
import type { NormalizedExchange, NormalizedValue } from '../capture/network-capture';
import { snapshotClient } from '../capture/state-snapshot';
import { expect, test } from '../fixtures/parity-fixture';
import type { ParityPages, WorkflowTools } from '../fixtures/parity-fixture';
import {
  LOCALE,
  PAYLOAD_DATE_FORMAT,
  SCENARIO,
  dayOffset,
  formatDateOnly,
  formatFineractDate,
  parseFineractDate,
  readCredentials,
} from '../seed/fixtures';

/** The client collection, as the capture records it. Only the tail of the path is written here — the versioned prefix is the application's to compose (Rule 1 clause 2) — and the tail is one of the paths. */
const CLIENTS_COLLECTION = '/clients';

/** The form's option source: `GET /clients/template` (AAP 0.7.3, "W2 create and activate client"). */
const CLIENT_TEMPLATE = '/clients/template';

/** One client, as the capture templates it: the numeric segment is replaced by the role token the comparison uses, so the path is the same whichever client the run created (AAP 0.10.2). */
const CLIENT_RECORD = '/clients/{clientId}';

/** The lifecycle command this workflow runs (AAP 0.9.1 scope group 2). */
const ACTIVATE_COMMAND = 'activate';

/** How long a record navigation is allowed to take; the config's own navigation timeout is 45 s. */
const RECORD_TIMEOUT_MS = 45_000;

/** One field of a captured JSON body, or `undefined` when the body is absent or is not an object (Rule 1 clause 4). */
function bodyField(body: NormalizedValue | null, field: string): NormalizedValue | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }
  return body[field];
}

/** A captured date value as a whole-day offset from the run date (AAP 0.10.2). */
function runDateOffsetIn(value: NormalizedValue | undefined, runDate: Date): number | null {
  if (typeof value === 'string') {
    // The capture's own token: `d0` for the run date, `d+1` the day after, `d-2` two days before.
    const token = /^d([+-]?\d+)$/.exec(value.trim());
    if (token !== null) {
      return Number(token[1]);
    }
  }
  const parsed: Date | null = parseFineractDate(value);
  return parsed === null ? null : dayOffset(runDate, parsed);
}

/** The client id a record hash names, or `null` for any other hash (AAP 0.10.2). */
function clientIdInHash(hash: string): number | null {
  const match = /^#\/viewclient\/(\d+)$/.exec(hash.trim());
  if (match === null) {
    return null;
  }
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Whether a status indicator's class attribute carries the active accent (AAP 0.10.5). */
function isActiveSwatchClass(className: string): boolean {
  const value = className.toLowerCase();
  return (
    value.includes('active') &&
    !value.includes('inactive') &&
    !value.includes('pending') &&
    !value.includes('closed')
  );
}

/** Whether the API's own status word is the active one. Compared case-insensitively against the word the backend sent, never against a status the harness chose: Fineract answers `Active` here, and a renamed value has to (AAP 0.10.2). */
function isActiveStatus(status: string): boolean {
  return status.trim().toLowerCase() === 'active';
}

/** The exchanges of one capture that call a path with a method. @param exchanges The capture as it stands. @param method HTTP method, upper-cased as the capture records it. @param path Path tail the exchange's templated. */
function exchangesTo(
  exchanges: readonly NormalizedExchange[],
  method: string,
  path: string,
): readonly NormalizedExchange[] {
  return exchanges.filter(
    (exchange) => exchange.method === method && exchange.path.endsWith(path),
  );
}

/** Waits for the client record to be the screen the browser shows, and answers the client id it names. */
async function awaitClientRecord(
  page: WorkflowTools['page'],
  expectedId: number | null,
): Promise<number> {
  const recordHash =
    expectedId === null ? /^#\/viewclient\/\d+$/ : new RegExp(`^#\\/viewclient\\/${expectedId}$`);

  await page.waitForURL((url: URL): boolean => recordHash.test(url.hash), {
    timeout: RECORD_TIMEOUT_MS,
  });

  const hash: string = await page.evaluate((): string => window.location.hash);
  const clientId = clientIdInHash(hash);

  expect(
    clientId,
    `the workflow must land on a client record; the hash is "${hash}", which names no client id`,
  ).not.toBeNull();

  if (clientId === null) {
    throw new Error(`the client record did not open: the hash is "${hash}"`);
  }
  if (expectedId !== null) {
    expect(clientId, 'the record shown is the client this workflow is working on').toBe(expectedId);
  }
  return clientId;
}

/** Waits until the screen that just appeared has finished the reads it issues on arrival (AAP 0.10.2). */
async function awaitScreenSettled(page: WorkflowTools['page']): Promise<void> {
  await page.waitForLoadState('networkidle');
}

/** Types the run date into the open lifecycle action form's date field (Rule 1 clause 2). */
async function enterActivationDate(
  page: WorkflowTools['page'],
  pages: ParityPages,
  runDate: Date,
): Promise<void> {
  const payloadDate: string = formatFineractDate(runDate).date;
  const fieldDate: string = pages.uiProject === 'legacy' ? payloadDate : formatDateOnly(runDate);

  if (pages.uiProject === 'legacy') {
    const legacyField = page.locator('#activationDate');
    await legacyField.waitFor({ state: 'visible', timeout: RECORD_TIMEOUT_MS });
    await legacyField.fill(fieldDate);
    // The datepicker opens on focus; Escape closes the popup and leaves the typed text, which is both what a person sees and what the form submits.
    await legacyField.press('Escape');
    expect(
      await legacyField.inputValue(),
      'the legacy activation date must hold the run date',
    ).toBe(fieldDate);
    return;
  }

  const field = page.locator('#client-action-activation-date');
  await field.waitFor({ state: 'visible', timeout: RECORD_TIMEOUT_MS });
  await pages.clients.fillClientForm({ activationDate: fieldDate });
  expect(await field.inputValue(), 'the activation date must hold the run date').toBe(fieldDate);
}

test.describe('W2 create and activate a client', () => {
  test('creates the fixed Parity Client and activates it on the run date', async ({
    runWorkflow,
  }) => {
    await runWorkflow('W2', async ({ page, pages, capture, runDate }) => {
      // --------------------------------------------------------------------------------------- 1.
      const credentials = readCredentials();
      await pages.login.open();
      await pages.login.signIn(credentials.username, credentials.password);

      // --------------------------------------------------------------------------------------- 2 (AAP 0.7.4).
      await pages.clients.open();

      const columnHeaders: readonly string[] = await pages.clients.readColumnHeaders();
      expect(columnHeaders.length, 'the list renders the six columns of the design').toBe(6);
      expect(
        columnHeaders.every((header: string): boolean => header.trim().length > 0),
        'every column carries a caption rendered from the legacy translation bundle',
      ).toBe(true);

      const listedBefore = await pages.clients.readRows();
      const emptyState = await pages.clients.readEmptyState();
      if (listedBefore.length === 0) {
        expect(
          emptyState?.trim().length ?? 0,
          'an empty result set shows its explicit empty state and no error',
        ).toBeGreaterThan(0);
      } else {
        expect(emptyState, 'a list that shows rows shows no empty state').toBeNull();
      }
      expect(
        await pages.clients.readNotifications(),
        'a listing that settled raises no notification',
      ).toEqual([]);

      // --------------------------------------------------------------------------------------- 3 (AAP 0.4.4, Rule 1 clause 3).
      await pages.clients.openCreateForm();
      expect(
        await pages.clients.readValidationErrors(),
        'the form opens clean, with no server message',
      ).toEqual([]);

      const requiredMarkers = await page.locator('span.required').count();
      expect(
        requiredMarkers,
        'the form paints the legacy required markers on the fields that are mandatory',
      ).toBeGreaterThanOrEqual(3);

      // The office options are read through the running side's page object.
      const officeOptions = await pages.clients.readSelectOptions('Office');
      const officeLabels: string[] = [];
      for (const option of officeOptions) {
        officeLabels.push(option.label.trim());
      }
      expect(
        officeLabels,
        `the office dropdown must offer "${SCENARIO.client.officeName}", the office of the fixed data`,
      ).toContain(SCENARIO.client.officeName);

      // --------------------------------------------------------------------------------------- 4 (AAP 0.10.5).
      if (pages.uiProject === 'legacy') {
        await pages.clients.fillClientForm({
          officeName: SCENARIO.client.officeName,
          firstName: SCENARIO.client.firstname,
          lastName: SCENARIO.client.lastname,
          submittedDate: runDate,
          active: false,
        });
      } else {
        await pages.clients.fillClientForm({
          officeId: SCENARIO.client.officeId,
          firstname: SCENARIO.client.firstname,
          lastname: SCENARIO.client.lastname,
          submittedOnDate: formatDateOnly(runDate),
          active: false,
        });
      }

      const enteredDate: string =
        pages.uiProject === 'legacy' ? formatFineractDate(runDate).date : formatDateOnly(runDate);
      expect(
        await page.locator('#submittedon').inputValue(),
        'the submission date entered is the run date',
      ).toBe(enteredDate);

      // --------------------------------------------------------------------------------------- 5.
      await pages.clients.submitForm();
      const clientId: number = await awaitClientRecord(page, null);
      // The record the create opened finishes its own reads before the workflow leaves it, so the captured sequence holds the record read answered rather than cancelled.
      await awaitScreenSettled(page);

      const afterCreate: readonly NormalizedExchange[] = capture.capture.exchanges;
      const creations = exchangesTo(afterCreate, 'POST', CLIENTS_COLLECTION);
      expect(creations, 'one submission sends exactly one client creation').toHaveLength(1);

      const creation = creations[0];
      expect(creation.hasTenantHeader, 'the creation carries the tenant header').toBe(true);
      expect(creation.hasAuthorizationHeader, 'the creation carries the credential header').toBe(
        true,
      );

      const createBody = creation.requestBody;
      expect(bodyField(createBody, 'firstname'), 'the body carries the submitted given name').toBe(
        SCENARIO.client.firstname,
      );
      expect(bodyField(createBody, 'lastname'), 'the body carries the submitted family name').toBe(
        SCENARIO.client.lastname,
      );
      expect(
        Number(bodyField(createBody, 'officeId')),
        'the body creates the client in the office the form had selected',
      ).toBe(SCENARIO.client.officeId);
      expect(
        bodyField(createBody, 'active'),
        'the body creates a pending client, which the activation command then activates',
      ).toBe(false);
      expect(
        bodyField(createBody, 'dateFormat'),
        'the body states the format its dates are written in',
      ).toBe(PAYLOAD_DATE_FORMAT);
      expect(
        bodyField(createBody, 'locale'),
        'the body states the language its dates must be read in',
      ).toBe(LOCALE);
      expect(
        runDateOffsetIn(bodyField(createBody, 'submittedOnDate'), runDate),
        'the client is submitted on the run date',
      ).toBe(0);
      // No claim is made about an activation date in the create body: the legacy controller always posts one, from a datepicker that defaults to the browser clock (AAP 0.10.2).

      const creationIndex: number = afterCreate.indexOf(creation);

      // The options the form rendered came from the template endpoint, which both applications read when the form opens (AAP 0.7.3, "W2 create and activate client").
      const templateReads = exchangesTo(afterCreate, 'GET', CLIENT_TEMPLATE);
      expect(
        templateReads.length,
        'the form reads its options from the client template endpoint',
      ).toBeGreaterThanOrEqual(1);
      expect(
        afterCreate.indexOf(templateReads[0]),
        'the template read belongs to the form that was on screen before the submission',
      ).toBeLessThan(creationIndex);

      // The record the create opened is read back over the API by both applications.
      const recordReads = afterCreate.filter(
        (exchange: NormalizedExchange, index: number): boolean =>
          index > creationIndex && exchange.method === 'GET' && exchange.path.endsWith(CLIENT_RECORD),
      );
      expect(
        recordReads.length,
        'the record the create opened is read back after the submission',
      ).toBeGreaterThanOrEqual(1);
      for (const [index, exchange] of afterCreate.entries()) {
        if (exchange.query['template'] === 'true' && exchange.path.endsWith(CLIENT_RECORD)) {
          expect(
            index,
            'a template read of the record can only follow the create that produced it',
          ).toBeGreaterThan(creationIndex);
        }
      }

      // --------------------------------------------------------------------------------------- 6.
      await pages.clients.openClientAction(clientId, ACTIVATE_COMMAND);
      await enterActivationDate(page, pages, runDate);
      await pages.clients.submitAction();
      await awaitClientRecord(page, clientId);
      await awaitScreenSettled(page);

      const afterActivate: readonly NormalizedExchange[] = capture.capture.exchanges;
      const activations = afterActivate.filter(
        (exchange: NormalizedExchange): boolean =>
          exchange.method === 'POST' &&
          exchange.path.endsWith(CLIENT_RECORD) &&
          exchange.query['command'] === ACTIVATE_COMMAND,
      );
      expect(activations, 'one submission sends exactly one activation command').toHaveLength(1);

      const activation = activations[0];
      expect(activation.hasTenantHeader, 'the activation carries the tenant header').toBe(true);
      expect(
        activation.hasAuthorizationHeader,
        'the activation carries the credential header',
      ).toBe(true);
      expect(
        bodyField(activation.requestBody, 'dateFormat'),
        'the activation states the format its date is written in',
      ).toBe(PAYLOAD_DATE_FORMAT);
      expect(
        bodyField(activation.requestBody, 'locale'),
        'the activation states the language its date must be read in',
      ).toBe(LOCALE);
      expect(
        runDateOffsetIn(bodyField(activation.requestBody, 'activationDate'), runDate),
        'the client is activated on the run date',
      ).toBe(0);

      // --------------------------------------------------------------------------------------- 7 (AAP 0.10.5).
      const snapshot = await snapshotClient(clientId, runDate);
      expect(
        isActiveStatus(snapshot.status),
        `the client's own status is the active one; the API answered "${snapshot.status}"`,
      ).toBe(true);
      expect(
        snapshot.activationDateOffset,
        'the API dates the activation on the run date',
      ).toBe(0);
      expect(
        snapshot.officeId,
        'the client exists in the Head Office of the fixed data',
      ).toBe(SCENARIO.client.officeId);
      expect(
        snapshot.displayName.trim().length,
        'the record carries the name the form submitted',
      ).toBeGreaterThan(0);

      await expect(async () => {
        const painting = await pages.clientView.readHeader();
        expect(
          isActiveSwatchClass(painting.statusClass),
          `the record indicator shows the active accent; its class is "${painting.statusClass}"`,
        ).toBe(true);
      }, 'the record header paints the active status indicator').toPass({
        timeout: RECORD_TIMEOUT_MS,
      });

      const header = await pages.clientView.readHeader();
      expect(
        header.clientNumber.trim().length,
        'the record header shows the client number the list row is matched by',
      ).toBeGreaterThan(0);

      // --------------------------------------------------------------------------------------- 8.
      await pages.clients.open();
      const listedAfter = await pages.clients.readRows();
      const swatchClasses: readonly string[] =
        pages.uiProject === 'legacy'
          ? (await pages.clients.readStatusSwatches()).map((swatch) => swatch.className)
          : (await pages.clients.readStatusSwatches()).map((swatch) => swatch.statusClass);

      const listedNumbers: string[] = [];
      for (const row of listedAfter) {
        listedNumbers.push(row.clientNumber.trim());
      }
      const rowIndex = listedNumbers.indexOf(header.clientNumber.trim());
      expect(
        rowIndex,
        `the list shows the client this workflow created, number "${header.clientNumber}"`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        isActiveSwatchClass(swatchClasses[rowIndex] ?? ''),
        'the created row shows the active status swatch',
      ).toBe(true);
      expect(
        await pages.clients.readNotifications(),
        'a successful create and activation raises no notification',
      ).toEqual([]);

      // The end state the report compares: the client this workflow produced, read by the fixture once the body returns (AAP 0.10.1 W2's outcome; AAP 0.10.4).
      return { stateTargets: { clientId } };
    });
  });
});
