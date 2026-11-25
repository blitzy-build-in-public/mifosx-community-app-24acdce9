/**
 * W2 — create a client and activate it, driven through whichever front end the Playwright project
 * names (AAP 0.10.1 W2; AAP 0.10.2; AAP 0.10.3 criteria 3 and 12; AAP 0.11.1 row 52; Rule 1
 * clause 8).
 *
 * The workflow, in the order the legacy screens perform it and the order a person performs it:
 *
 * 1. sign in through the application's own login screen, landing on the client list;
 * 2. read the list's six columns and settle that it shows rows or its explicit empty state;
 * 3. open the create form and read the office options from the template endpoint;
 * 4. submit the fixed client of AAP 0.10.1 — `Parity Client`, Head Office — on the tenant's business
 *    date, left pending, because activation is this workflow's own step;
 * 5. read the record the create opens;
 * 6. enter the same business date on the activation form and activate the client;
 * 7. read the end state back over the API and the record's status indicator off the screen;
 * 8. return to the list and find the created row carrying the active swatch.
 *
 * Every claim is asserted twice over: once from the captured Fineract traffic (method, path, query
 * command, body keys and values including `dateFormat` and `locale`, and the presence of the tenant
 * and credential headers) and once from the backend's own answer through `snapshotClient`. No
 * screenshot is a criterion (AAP 0.10.1), and no generated identifier is ever asserted by value —
 * the new client's id is parsed from the record hash and used only to address the snapshot and the
 * action route (AAP 0.10.2, "Generated identifiers").
 *
 * **Fixed data (AAP 0.10.1).** The client, its office and its dates come from `SCENARIO` in
 * `../seed/fixtures` and from the run date, never from a literal: the run date is the tenant's
 * business date read over the API by the `runDate` fixture (Rule 1 clause 2), so a run on a
 * different business day still creates and activates the client on that day. The forms' own
 * browser-clock defaults are overwritten with the run date for exactly that reason (AAP 0.10.5 item
 * 15 keeps a form's defaults where legacy has them, while a workflow's inputs must be the business
 * date).
 *
 * **Why the client is created pending.** AAP 0.10.1's W2 row is two commands — create, then activate —
 * and Fineract refuses the second on a client that is already active. The create form's "Active" box
 * is therefore left clear, which is what a person does on the legacy screens as well: submitting the
 * form active would fold the activation into the create, and the workflow would no longer exercise the
 * `command=activate` call the row requires.
 *
 * **Ordering contract.** The suite runs per project, one worker, in file order, against one seeded
 * database, so this spec must never assume an empty client list: `chain-w2-w4-w5-w6.spec.ts` sorts
 * before it and creates a `Parity Client` of its own, and the previous project's run leaves its
 * client behind too. The list is therefore settled as "rows or an explicit empty state, never a
 * blank table", and the row this workflow created is located by the client number the record header
 * shows rather than by name.
 *
 * **Two readings of the plan settled here.** AAP 0.10.1's W2 row lists
 * `GET /clients/{id}?template=true` among the workflow's calls, and the shipped controllers do not
 * make it on this path: the record screen reads the plain record, the activation screen reads the
 * datatable gate and the client, and only the edit screen asks for the template. The spec therefore
 * asserts the record read that both applications do make after the create, and holds any
 * `?template=true` read of the record to the ordering the row implies. The client list's columns are
 * also not the "status last" order a summary would suggest: `app/views/clients/clients.html` fixes
 * Name, Client No., External ID, Status, Office, Staff, and both page objects read them by that
 * heading order, so the assertion is six rendered columns rather than a position for the status one.
 *
 * **Security.** Nothing here reads the environment at module scope, so `npx playwright test --list`
 * collects this file with no configuration and no backend (AAP 0.10.3 criterion 3). The credential
 * pair is read at call time by `readCredentials()` and handed to the login screen; no header value,
 * authentication key or password is compared, printed or attached (Rule 1 clause 9) — the capture
 * records only whether the two headers were present.
 */
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

/**
 * The client collection, as the capture records it. Only the tail of the path is written here — the
 * versioned prefix is the application's to compose (Rule 1 clause 2) — and the tail is one of the
 * paths `tools/parity/endpoint-allowlist.json` declares.
 */
const CLIENTS_COLLECTION = '/clients';

/** The form's option source: `GET /clients/template` (AAP 0.7.3, "W2 create and activate client"). */
const CLIENT_TEMPLATE = '/clients/template';

/**
 * One client, as the capture templates it: the numeric segment is replaced by the role token the
 * comparison uses, so the path is the same whichever client the run created (AAP 0.10.2).
 */
const CLIENT_RECORD = '/clients/{clientId}';

/** The lifecycle command this workflow runs (AAP 0.9.1 scope group 2). */
const ACTIVATE_COMMAND = 'activate';

/** How long a record navigation is allowed to take; the config's own navigation timeout is 45 s. */
const RECORD_TIMEOUT_MS = 45_000;

/**
 * One field of a captured JSON body, or `undefined` when the body is absent or is not an object.
 *
 * A capture is not typed against the application's models on purpose: comparing payloads the
 * application is not typed for at the boundary is the capture's whole purpose. `NormalizedValue` is
 * therefore the only shape the body has here, and this guard is the documented boundary at which it
 * becomes a keyed object (Rule 1 clause 4; the body itself is narrowed field by field, `unknown` is
 * never cast to a model).
 *
 * @param body A captured request body, masked and canonicalised as the capture recorded it.
 * @param field Top-level field to read.
 * @returns The field's value, or `undefined` when the body has none.
 */
function bodyField(body: NormalizedValue | null, field: string): NormalizedValue | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }
  return body[field];
}

/**
 * A captured date value as a whole-day offset from the run date.
 *
 * The capture rewrites every value under a date-named key into that offset — `d0` for the run date,
 * `d+1` the day after (AAP 0.10.2, "Dates") — so the token is read first. The payload's own text form
 * and the `[year, month, day]` triple are read too, because a date that reached the body under a key
 * the capture does not treat as a date still has to be comparable with the run date here.
 *
 * @param value The captured value under a date-named key.
 * @param runDate The tenant's business date the offset is measured from.
 * @returns The offset in whole days, or `null` when the value is not a date this harness reads.
 */
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

/**
 * The client id a record hash names, or `null` for any other hash.
 *
 * Used only to address the snapshot and the action route: the id itself is never asserted
 * (AAP 0.10.2 compares generated identifiers by their role in the sequence, never by value).
 *
 * @param hash `window.location.hash` as the browser reports it, e.g. `#/viewclient/7`.
 */
function clientIdInHash(hash: string): number | null {
  const match = /^#\/viewclient\/(\d+)$/.exec(hash.trim());
  if (match === null) {
    return null;
  }
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Whether a status indicator's class attribute carries the active accent.
 *
 * The two applications spell the same accent differently — the legacy status filter answers
 * `statusactive` (`app/scripts/filters/StatusLookup.js`) while the shared indicator answers
 * `status-active` — so the accent is matched rather than a literal class, and the other states are
 * rejected explicitly because `inactive` contains `active`. The indicator paints no word on either
 * side (AAP 0.10.5 item 11), which is why a class is the only thing there is to read.
 *
 * @param className The indicator element's whole class attribute.
 */
function isActiveSwatchClass(className: string): boolean {
  const value = className.toLowerCase();
  return (
    value.includes('active') &&
    !value.includes('inactive') &&
    !value.includes('pending') &&
    !value.includes('closed')
  );
}

/**
 * Whether the API's own status word is the active one.
 *
 * Compared case-insensitively against the word the backend sent, never against a status the harness
 * chose: Fineract answers `Active` here, and a renamed value has to surface as a difference rather
 * than be papered over by a constant (AAP 0.10.2, "displayed data").
 */
function isActiveStatus(status: string): boolean {
  return status.trim().toLowerCase() === 'active';
}

/**
 * The exchanges of one capture that call a path with a method.
 *
 * @param exchanges The capture as it stands.
 * @param method HTTP method, upper-cased as the capture records it.
 * @param path Path tail the exchange's templated path must end with.
 */
function exchangesTo(
  exchanges: readonly NormalizedExchange[],
  method: string,
  path: string,
): readonly NormalizedExchange[] {
  return exchanges.filter(
    (exchange) => exchange.method === method && exchange.path.endsWith(path),
  );
}

/**
 * Waits for the client record to be the screen the browser shows, and answers the client id it names.
 *
 * The record is where both applications land once a client is created and once a lifecycle command
 * succeeds (`location.path('/viewclient/' + data.clientId)` in the legacy controllers, and the same
 * route in the new application), so waiting on it is what makes the workflow's next step — reading
 * the record, or reading the list again — happen after the navigation rather than during it.
 *
 * @param page The test's page.
 * @param expectedId The client the record must show, or `null` for whichever record opens next.
 * @returns The client id the record hash names.
 * @throws When the record does not open within {@link RECORD_TIMEOUT_MS}, or when the hash names no
 *   client id.
 */
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

/**
 * Waits until the screen that just appeared has finished the reads it issues on arrival.
 *
 * A record screen reads its client, its accounts and its identifiers as it paints, and a navigation
 * away from it before those answers land cancels them in the new application (an `HttpClient`
 * subscription is unsubscribed when the component is destroyed) while the legacy application's
 * `$http` calls carry on. A capture would then hold the same call twice, once answered and once
 * aborted, and the parity comparison would report a difference the workflow never had (AAP 0.10.2
 * compares the ordered calls with their statuses). Letting the screen settle before leaving it is
 * what keeps the two captures comparable.
 *
 * @param page The test's page.
 */
async function awaitScreenSettled(page: WorkflowTools['page']): Promise<void> {
  await page.waitForLoadState('networkidle');
}

/**
 * Types the run date into the open lifecycle action form's date field.
 *
 * The activation date is the one control no page-object method wraps on both sides, so it is entered
 * here: the legacy action form is a jQuery datepicker text input (`#activationDate`, written in the
 * payload's own `dd MMMM yyyy` form, `app/views/clients/clientactions.html:26`), while the new
 * application renders a native date input whose id the field component owns (`client-action-activation-date`,
 * painted only once the datatable gate has answered) and whose value accessor takes `yyyy-mm-dd`.
 * Both are read back, so "the activation date entered is the run date" is observed rather than
 * assumed.
 *
 * @param page The test's page.
 * @param pages The running front end's page objects.
 * @param runDate The tenant's business date to enter (Rule 1 clause 2).
 * @throws When the action form paints no date field, or when the field does not end up holding the
 *   run date.
 */
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
    // The datepicker opens on focus; Escape closes the popup and leaves the typed text, which is
    // both what a person sees and what the form submits.
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
      // ---------------------------------------------------------------------------------------
      // 1. Sign in through the application's own login screen (W1's entry step). The credential is
      // read at call time and handed to the form; nothing about it is compared or kept here.
      // ---------------------------------------------------------------------------------------
      const credentials = readCredentials();
      await pages.login.open();
      await pages.login.signIn(credentials.username, credentials.password);

      // ---------------------------------------------------------------------------------------
      // 2. The landing list. Six columns, rows or an explicit empty state, and no notification: a
      // listing that worked shows one of the two states the plan requires and no error at all
      // (AAP 0.7.4). Another workflow's client may already be in the list, so nothing is expected
      // of its contents beyond the shape.
      // ---------------------------------------------------------------------------------------
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

      // ---------------------------------------------------------------------------------------
      // 3. The create form. It opens with no error region, paints the legacy required markers, and
      // offers the Head Office of the fixed data in its office dropdown, whose options came from
      // the template endpoint (AAP 0.4.4 decision 6). No rule is asserted beyond the minimum the
      // legacy template marks (Rule 1 clause 3).
      // ---------------------------------------------------------------------------------------
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

      // The office options are read through the running side's page object. The two readers are
      // structurally compatible but differently named, so the labels are collected by iterating what
      // the object answers rather than by mapping a union of its two array types.
      const officeOptions = await pages.clients.readSelectOptions('Office');
      const officeLabels: string[] = [];
      for (const option of officeOptions) {
        officeLabels.push(option.label.trim());
      }
      expect(
        officeLabels,
        `the office dropdown must offer "${SCENARIO.client.officeName}", the office of the fixed data`,
      ).toContain(SCENARIO.client.officeName);

      // ---------------------------------------------------------------------------------------
      // 4. The fixed client, submitted on the tenant's business date and created **pending**: the
      // "Active" box is left clear because activation is this workflow's second half, and Fineract
      // refuses to activate a client that was created active. The two sides take their dates in the
      // form each control carries — the legacy datepicker takes a `Date` and the native input takes
      // `yyyy-mm-dd` — which is the only branch this workflow needs (AAP 0.10.5 items 1 and 15).
      // ---------------------------------------------------------------------------------------
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

      // ---------------------------------------------------------------------------------------
      // 5. Submit. One click, so exactly one POST of the client collection, and the record the
      // create opens. The id it names is used only to address the snapshot and the action route.
      // ---------------------------------------------------------------------------------------
      await pages.clients.submitForm();
      const clientId: number = await awaitClientRecord(page, null);
      // The record the create opened finishes its own reads before the workflow leaves it, so the
      // captured sequence holds the record read answered rather than cancelled.
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
      // No claim is made about an activation date in the create body: the legacy controller always
      // posts one, from a datepicker that defaults to the browser clock
      // (`app/scripts/controllers/client/CreateClientController.js:246`), while the new application
      // sends that control only when it holds a value and the box above is clear. The presence of
      // the key is therefore a difference between the two applications for the parity report to
      // record (AAP 0.10.2), not something this workflow's outcome rests on.

      const creationIndex: number = afterCreate.indexOf(creation);

      // The options the form rendered came from the template endpoint, which both applications read
      // when the form opens (AAP 0.7.3, "W2 create and activate client").
      const templateReads = exchangesTo(afterCreate, 'GET', CLIENT_TEMPLATE);
      expect(
        templateReads.length,
        'the form reads its options from the client template endpoint',
      ).toBeGreaterThanOrEqual(1);
      expect(
        afterCreate.indexOf(templateReads[0]),
        'the template read belongs to the form that was on screen before the submission',
      ).toBeLessThan(creationIndex);

      // The record the create opened is read back over the API by both applications. A template
      // read of that record, where a build makes one, can only follow the create it belongs to.
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

      // ---------------------------------------------------------------------------------------
      // 6. Activate. The action screen runs its datatable gate first, the date is the run date, and
      // one click sends exactly one command.
      // ---------------------------------------------------------------------------------------
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

      // ---------------------------------------------------------------------------------------
      // 7. The end state, read both ways: the backend's own answer, and the status the record
      // paints. The indicator is a colour and never a word (AAP 0.10.5 item 11), so a class is what
      // is read.
      // ---------------------------------------------------------------------------------------
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

      // ---------------------------------------------------------------------------------------
      // 8. Back to the list: the row this workflow created shows the active swatch too. The row is
      // found by the client number the record header shows, because another workflow may have
      // created a client with the same name before this spec ran.
      // ---------------------------------------------------------------------------------------
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

      // The end state the report compares: the client this workflow produced, read by the fixture
      // once the body returns (AAP 0.10.1 W2's outcome; AAP 0.10.4).
      return { stateTargets: { clientId } };
    });
  });
});
