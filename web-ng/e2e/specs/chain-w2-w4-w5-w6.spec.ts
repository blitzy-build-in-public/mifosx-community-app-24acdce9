/** AAP 0.11.1 row 52 `chain-w2-w4-w5-w6`, AAP 0.10.3 criterion 12 — the end-to-end proof of the migration: W2 (create and activate a client) → W4 (submit an individual loan application after previewing its schedule) → W5 (AAP 0.10.1, AAP 0.10.2, Rule 1 clause 8, Rule 2). */
import { test, expect } from '../fixtures/parity-fixture';
import type { WorkflowTools } from '../fixtures/parity-fixture';
import type {
  CaptureSession,
  NormalizedExchange,
  NormalizedValue,
} from '../capture/network-capture';
import { snapshotClient, snapshotLoan } from '../capture/state-snapshot';
import {
  LOCALE,
  PAYLOAD_DATE_FORMAT,
  SCENARIO,
  SEED_LOAN_PRODUCT,
  dayOffset,
  formatDateOnly,
  formatFineractDate,
  parseFineractDate,
  readCredentials,
} from '../seed/fixtures';

/** The Fineract paths the four stages call, exactly as the capture reports them (AAP 0.7.3 W1, W2, W4, W5, W6) (AAP 0.10.4). */
const AUTHENTICATION_PATH = '/fineract-provider/api/v1/authentication';
const CLIENT_COLLECTION_PATH = '/fineract-provider/api/v1/clients';
const CLIENT_RESOURCE_PATH = '/fineract-provider/api/v1/clients/{clientId}';
const CLIENT_ACTION_GATE_PATH = '/fineract-provider/api/v1/entityDatatableChecks';
const LOAN_COLLECTION_PATH = '/fineract-provider/api/v1/loans';
const LOAN_TEMPLATE_PATH = '/fineract-provider/api/v1/loans/template';
const LOAN_RESOURCE_PATH = '/fineract-provider/api/v1/loans/{loanId}';
const LOAN_APPROVAL_TEMPLATE_PATH = '/fineract-provider/api/v1/loans/{loanId}/template';
const LOAN_TRANSACTIONS_TEMPLATE_PATH = '/fineract-provider/api/v1/loans/{loanId}/transactions/template';
const LOAN_TRANSACTIONS_PATH = '/fineract-provider/api/v1/loans/{loanId}/transactions';

/** The hash routes the stages read a generated id from (AAP 0.8.2 mirrors the legacy URLs): the record W2 lands on, the application W4 lands on and the record W4's submission lands on. */
const CLIENT_RECORD_ROUTE = /#\/viewclient\/(\d+)$/;
const LOAN_APPLICATION_ROUTE = /#\/newclientloanaccount\/(\d+)$/;
const LOAN_RECORD_ROUTE = /#\/viewloanaccount\/(\d+)$/;

/** The colour class an active status indicator carries, in either application's spelling: the baseline paints `statusactive` and this one `status-active`, and neither paints a status word at all (AAP 0.10.5 item 11), so the comparison is made on the class both applications paint, never on text. */
const ACTIVE_STATUS_CLASS = /status[-_]?active/i;

/** One captured request body as its field map — the shape `capture/network-capture.ts` records a JSON object in, with keys canonicalised and every generated id already a role token. */
type FormFields = { [field: string]: NormalizedValue };

/** Whether a normalised payload is a field map rather than an array or a scalar (Rule 1 clause 4). */
function isFieldMap(value: NormalizedValue | null): value is FormFields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The field map of one exchange's request body, or `null` when it carried no JSON object — a call with no body, and one whose body is an array, both answer `null` so a caller can assert on it. @param exchange The captured exchange, or `null`. */
function requestFields(exchange: NormalizedExchange | null): FormFields | null {
  const body = exchange === null ? null : exchange.requestBody;
  return isFieldMap(body) ? body : null;
}

/** The exchanges a run recorded for one endpoint, in the order the page issued them (AAP 0.7.3). */
function callsTo(
  capture: CaptureSession,
  method: string,
  path: string,
  command?: string,
): readonly NormalizedExchange[] {
  return capture.capture.exchanges.filter(
    (exchange) =>
      exchange.method === method &&
      exchange.path === path &&
      (command === undefined
        ? exchange.query['command'] === undefined
        : exchange.query['command'] === command),
  );
}

/** The figure a page object reported for an amount, as a number, or `null` when the cell carried none. */
function figureOf(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const digits = value.replace(/[^0-9.-]/g, '');
  if (digits.length === 0) {
    return null;
  }
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function requireFigure(value: number | null, description: string): number {
  if (value === null || !Number.isFinite(value)) {
    throw new Error(
      `${description} is missing from the loan's end state, so the chain's arithmetic cannot be ` +
        'checked (AAP 0.10.1 W6). The schedule the loan answers with is what carries it.',
    );
  }
  return value;
}

/** The day offset a capture's normalised date token stands for — `d0` is the run date itself, `d+1` the day after — or `null` when the value is not one the capture produced from a date (AAP 0.10.2). */
function offsetOfDateToken(value: NormalizedValue | undefined): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const matched = /^d([+-]?\d+)$/.exec(value);
  if (matched === null) {
    return null;
  }
  return Number(matched[1]);
}

/** The generated id the current address carries once it matches a record route (AAP 0.10.2: ids are taken from the run that produced them, never assumed). */
async function routeIdOf(
  page: WorkflowTools['page'],
  route: RegExp,
  description: string,
): Promise<number> {
  await expect(page, `${description}: the workflow step must land on ${String(route)}`).toHaveURL(
    route,
  );
  const matched = route.exec(page.url());
  const id = matched === null ? Number.NaN : Number(matched[1]);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(
      `${description}: the address ${page.url()} carries no positive numeric id, so the record the ` +
        'workflow created cannot be followed into the next stage.',
    );
  }
  return id;
}

/** The most recent exchange a run recorded for one endpoint, or `null` when it recorded none. */
function latestCall(
  capture: CaptureSession,
  method: string,
  path: string,
  command?: string,
): NormalizedExchange | null {
  return callsTo(capture, method, path, command).at(-1) ?? null;
}

/** The chain: one test, four stages, every stage asserted before the next one begins (AAP 0.10.4). */
test.describe('Chain W2 → W4 → W5 → W6 end-to-end proof', () => {
  test('creates a client, submits a loan, approves and disburses it, then repays it on Fineract', async ({
    runWorkflow,
  }) => {
    await runWorkflow('CHAIN', async ({ page, pages, capture, runDate }) => {
      // ── Stage 0 — sign in (AAP 0.10.1 W1) ──────────────────────────────────────────────────────── Every in-scope route is guarded, so the chain begins with the ordinary login both applications perform, with the credentials (Rule 1 clause 9).
      const runDatePayload = formatFineractDate(runDate);
      const runDateInput = formatDateOnly(runDate);
      expect(
        runDatePayload.dateFormat,
        'Rule 1 clause 2: every date-bearing payload carries the dd MMMM yyyy format',
      ).toBe(PAYLOAD_DATE_FORMAT);
      expect(
        runDatePayload.locale,
        'Rule 1 clause 2: every date-bearing payload names the locale it must be read in',
      ).toBe(LOCALE);
      expect(
        runDatePayload.date,
        'AAP 0.10.1 "Run date": the run date is the tenant business date read over the API',
      ).toMatch(/^\d{2} [A-Z][a-z]+ \d{4}$/);

      await pages.login.open();
      const credentials = readCredentials();
      await pages.login.signIn(credentials.username, credentials.password);
      const authentications = callsTo(capture, 'POST', AUTHENTICATION_PATH);
      expect(
        authentications.length,
        'W1: signing in sends exactly one POST /authentication, the only credential exchange of the run',
      ).toBe(1);

      // ── Stage 1 — W2 create and activate a client (AAP 0.10.1 W2) ─────────────────────────────── The list it starts from is asserted before anything is written: an alphabetical run puts this spec first, so the database may hold no client at all and the list is allowed to show its empty state (AAP 0.7.4).
      await pages.clients.open();
      const columnHeaders = await pages.clients.readColumnHeaders();
      expect(
        columnHeaders.join(' | '),
        'W2: the client list renders a Name column, which is the column the created client is found in',
      ).toMatch(/name/i);
      expect(
        columnHeaders.length,
        'W2: the list renders the columns the design shows (AAP 0.2.1 Step 2)',
      ).toBeGreaterThanOrEqual(5);

      const startingRows = await pages.clients.readRows();
      const startingNames: string[] = [];
      for (const row of startingRows) {
        startingNames.push(row.name);
      }
      const startingEmptyState = await pages.clients.readEmptyState();
      expect(
        startingNames.every((name) => name.trim().length > 0),
        'W2: every row the list renders names the client it stands for, so the run starts from a readable list',
      ).toBe(true);
      expect(
        startingRows.length > 0 || (startingEmptyState ?? '').trim().length > 0,
        'W2: a client list with no rows shows the explicit empty state and no error (AAP 0.7.4)',
      ).toBe(true);

      await pages.clients.openCreateForm();
      const officeOptions = await pages.clients.readSelectOptions('Office');
      let officeOptionValue = '';
      for (const option of officeOptions) {
        if (option.label.trim().toLowerCase() === SCENARIO.client.officeName.toLowerCase()) {
          officeOptionValue = option.value;
        }
      }
      expect(
        officeOptionValue.length,
        `W2: the create form offers the office labelled ${SCENARIO.client.officeName}`,
      ).toBeGreaterThan(0);

      if (pages.uiProject === 'legacy') {
        // The baseline names its office by label and takes the Date objects its datepicker writes (AAP 0.10.5 items 1 and 2: a deliberate difference of control, not of payload).
        await pages.clients.fillClientForm({
          officeName: SCENARIO.client.officeName,
          firstName: SCENARIO.client.firstname,
          lastName: SCENARIO.client.lastname,
          submittedDate: runDate,
          active: false,
        });
      } else {
        await pages.clients.fillClientForm({
          officeId: officeOptionValue,
          firstname: SCENARIO.client.firstname,
          lastname: SCENARIO.client.lastname,
          submittedOnDate: runDateInput,
          active: false,
        });
      }
      await pages.clients.submitForm();

      // The client is created pending, which is the state W2's activate command acts on: W2's outcome is the two calls in the AAP's order, and a client created already active leaves the activate command nothing the server would accept.
      const clientId = await routeIdOf(page, CLIENT_RECORD_ROUTE, 'W2: creating the client');
      const clientCreates = callsTo(capture, 'POST', CLIENT_COLLECTION_PATH);
      expect(
        clientCreates.length,
        'W2: submitting the create form posts exactly one POST /clients',
      ).toBe(1);
      const clientFields = requestFields(clientCreates.at(0) ?? null);
      expect(clientFields, 'W2: the create-client POST carries a JSON body').not.toBeNull();
      const client = clientFields ?? {};
      expect(client['firstname'], 'W2: the body carries the first name of the fixed data').toBe(
        SCENARIO.client.firstname,
      );
      expect(client['lastname'], 'W2: the body carries the last name of the fixed data').toBe(
        SCENARIO.client.lastname,
      );
      expect(Number(client['officeId']), 'W2: the body carries Head Office, office 1').toBe(
        SCENARIO.client.officeId,
      );
      expect(client['dateFormat'], 'Rule 1 clause 2: the body carries dateFormat').toBe(
        PAYLOAD_DATE_FORMAT,
      );
      expect(client['locale'], 'Rule 1 clause 2: the body carries the locale').toBe(LOCALE);
      expect(
        client['submittedOnDate'],
        'Rule 1 clause 2: the submitted date is the run date (the capture normalises it to a day offset)',
      ).toBe('d0');

      const createdClient = await snapshotClient(clientId, runDate);
      expect(
        createdClient.status,
        'W2: the created client waits for activation, which is what the activate command acts on',
      ).toBe('Pending');
      expect(
        createdClient.activationDateOffset,
        'W2: a pending client carries no activation date yet',
      ).toBeNull();
      expect(createdClient.officeId, 'W2: the client sits in the office the run is fixed to').toBe(
        SCENARIO.client.officeId,
      );
      expect(
        createdClient.displayName,
        'W2: the display name Fineract composes is the fixed data',
      ).toBe(SCENARIO.client.displayName);

      await pages.clients.openClientAction(clientId, 'activate');
      if (pages.uiProject === 'next') {
        // The action form seeds its date from the browser clock (AAP 0.10.5 item 15), so the workflow input is written from the tenant business date instead: every date a workflow sends is the run date or an offset from it (AAP 0.10.1).
        await pages.clients.fillClientForm({ activationDate: runDateInput });
      }
      await pages.clients.submitAction();
      await expect(
        page,
        'W2: a successful activation returns to the client record',
      ).toHaveURL(CLIENT_RECORD_ROUTE);
      const gateCalls = callsTo(capture, 'GET', CLIENT_ACTION_GATE_PATH);
      expect(
        gateCalls.length,
        'AAP 0.7.3: the action screen runs the datatable gate before the command it posts',
      ).toBeGreaterThanOrEqual(1);
      const activations = callsTo(capture, 'POST', CLIENT_RESOURCE_PATH, 'activate');
      expect(
        activations.length,
        'W2: activating posts exactly one POST /clients/{id}?command=activate — one click, one request',
      ).toBe(1);
      const activationFields = requestFields(activations.at(0) ?? null);
      expect(activationFields, 'W2: the activate call carries a JSON body').not.toBeNull();
      const activation = activationFields ?? {};
      expect(activation['dateFormat'], 'Rule 1 clause 2: the body carries dateFormat').toBe(
        PAYLOAD_DATE_FORMAT,
      );
      expect(activation['locale'], 'Rule 1 clause 2: the body carries the locale').toBe(LOCALE);
      const sentActivationOffset = offsetOfDateToken(activation['activationDate']);
      expect(
        sentActivationOffset,
        'W2: the activation body carries a date the capture reads as a day offset from the run date',
      ).not.toBeNull();

      const activatedClient = await snapshotClient(clientId, runDate);
      expect(activatedClient.status, 'W2: the activated client is Active').toBe('Active');
      expect(
        activatedClient.activationDateOffset,
        'W2: the backend activated the client on the day the form sent',
      ).toBe(sentActivationOffset ?? Number.NaN);
      if (pages.uiProject === 'next') {
        expect(
          sentActivationOffset,
          'W2: this application activates on the run date itself, not on the browser clock',
        ).toBe(0);
      }

      await pages.clientView.open(clientId);
      const clientHeader = await pages.clientView.readHeader();
      expect(
        clientHeader.displayName,
        'W2: the record shows the client the run created',
      ).toBe(SCENARIO.client.displayName);
      expect(
        clientHeader.statusClass,
        'W2: the record paints the active status indicator (AAP 0.10.5 item 11: a colour, never a word)',
      ).toMatch(ACTIVE_STATUS_CLASS);

      // ── Stage 2 — W4 submit an individual loan application after previewing the schedule ────────
      await pages.clientView.startNewLoan();
      await expect(
        page,
        "W4: the record's New Loan action opens the loan application",
      ).toHaveURL(LOAN_APPLICATION_ROUTE);
      expect(
        page.url(),
        'W4: the application is addressed to the client the chain created (AAP 0.8.2 route)',
      ).toContain(`#/newclientloanaccount/${clientId}`);

      await pages.loans.selectProduct(SCENARIO.loanApplication.productName);
      const applicationTemplate = latestCall(capture, 'GET', LOAN_TEMPLATE_PATH);
      expect(applicationTemplate, 'W4: the application reads GET /loans/template').not.toBeNull();
      expect(
        applicationTemplate?.query['templateType'],
        'W4: the individual application reads the individual template',
      ).toBe('individual');
      const productTemplate =
        callsTo(capture, 'GET', LOAN_TEMPLATE_PATH)
          .filter((exchange) => (exchange.query['productId'] ?? '').length > 0)
          .at(-1) ?? null;
      expect(
        productTemplate,
        "W4: choosing the product reads that product's template, which is where the terms come from",
      ).not.toBeNull();
      expect(
        productTemplate?.query['clientId'],
        'W4: the product template names the client the application is for',
      ).toBe(String(clientId));

      if (pages.uiProject === 'legacy') {
        await pages.loans.fillApplication({
          submittedOnDate: runDate,
          expectedDisbursementDate: runDate,
          principal: String(SCENARIO.loanApplication.principal),
          numberOfRepayments: String(SEED_LOAN_PRODUCT.numberOfRepayments),
        });
      } else {
        await pages.loans.fillApplication({
          principal: SCENARIO.loanApplication.principal,
          numberOfRepayments: SEED_LOAN_PRODUCT.numberOfRepayments,
          submittedOnDate: runDateInput,
          expectedDisbursementDate: runDateInput,
        });
      }

      await pages.loans.previewSchedule();
      const previewCalls = callsTo(capture, 'POST', LOAN_COLLECTION_PATH, 'calculateLoanSchedule');
      expect(
        previewCalls.length,
        'W4: previewing the schedule posts exactly one POST /loans?command=calculateLoanSchedule',
      ).toBe(1);
      const previewFields = requestFields(previewCalls.at(0) ?? null) ?? {};
      expect(
        Number(previewFields['principal']),
        'W4: the previewed application applies for the fixed 5,000 principal',
      ).toBe(SCENARIO.loanApplication.principal);
      expect(
        Number(previewFields['numberOfRepayments']),
        "W4: the previewed application asks for the product's 12 monthly repayments",
      ).toBe(SEED_LOAN_PRODUCT.numberOfRepayments);
      expect(previewFields['dateFormat'], 'Rule 1 clause 2: the body carries dateFormat').toBe(
        PAYLOAD_DATE_FORMAT,
      );
      expect(previewFields['locale'], 'Rule 1 clause 2: the body carries the locale').toBe(LOCALE);
      expect(
        previewFields['expectedDisbursementDate'],
        'Rule 1 clause 2: the expected disbursement date is the run date',
      ).toBe('d0');

      const previewRows = await pages.loans.readPreviewRows();
      let previewPrincipal = 0;
      const previewDueDates: string[] = [];
      for (const row of previewRows) {
        // The server's schedule opens with a disbursement row that carries no period number and no principal (AAP 0.7.2, `RepaymentPeriod`), so only numbered periods are counted.
        if (row.period === null || Number(row.period) < 1) {
          continue;
        }
        previewPrincipal += figureOf(row.principalDue) ?? 0;
        previewDueDates.push(row.dueDate);
      }
      expect(
        previewDueDates.length,
        'W4: the preview renders one row per repayment period the product schedules',
      ).toBe(SEED_LOAN_PRODUCT.numberOfRepayments);
      expect(
        previewPrincipal,
        'W4: the previewed periods repay exactly the principal applied for, as the server computed it',
      ).toBeCloseTo(SCENARIO.loanApplication.principal, 2);
      expect(
        previewDueDates.every((dueDate) => dueDate.trim().length > 0),
        'W4: every previewed period carries its own due date',
      ).toBe(true);
      expect(
        new Set(previewDueDates).size,
        'W4: the previewed due dates advance period by period rather than repeating one date',
      ).toBe(previewDueDates.length);
      if (pages.uiProject === 'next') {
        // The baseline renders its dates through its own filter, so the display-format contract is asserted where the plan fixes it (AAP 0.7.2 DISPLAY_DATE_FORMAT): on this application.
        const firstDue = parseFineractDate(previewDueDates[0]);
        expect(
          firstDue,
          'W4: the preview renders its due dates in the dd MMMM yyyy format the record displays',
        ).not.toBeNull();
        if (firstDue !== null) {
          expect(
            dayOffset(runDate, firstDue),
            'W4: the previewed schedule starts after the disbursement date',
          ).toBeGreaterThan(0);
          expect(
            dayOffset(runDate, firstDue),
            'W4: a monthly period falls due within the month after the disbursement date',
          ).toBeLessThanOrEqual(31);
        }
      }

      await pages.loans.submitApplication();
      const loanId = await routeIdOf(page, LOAN_RECORD_ROUTE, 'W4: submitting the application');
      const loanSubmissions = callsTo(capture, 'POST', LOAN_COLLECTION_PATH);
      expect(
        loanSubmissions.length,
        'W4: submitting the application posts exactly one POST /loans, with no command',
      ).toBe(1);
      const loanFields = requestFields(loanSubmissions.at(0) ?? null);
      expect(loanFields, 'W4: the loan-creating POST carries a JSON body').not.toBeNull();
      const application = loanFields ?? {};
      expect(
        application['principal'],
        'W4: the submitted body is the application that was previewed, principal included',
      ).toBe(previewFields['principal']);
      expect(
        application['numberOfRepayments'],
        'W4: the submitted body is the application that was previewed, its term included',
      ).toBe(previewFields['numberOfRepayments']);
      expect(application['dateFormat'], 'Rule 1 clause 2: the body carries dateFormat').toBe(
        PAYLOAD_DATE_FORMAT,
      );
      expect(application['locale'], 'Rule 1 clause 2: the body carries the locale').toBe(LOCALE);
      expect(
        application['submittedOnDate'],
        'Rule 1 clause 2: the application is submitted on the run date',
      ).toBe('d0');
      expect(
        application['clientId'],
        'W4: the application names the client the chain created (the capture templates a generated id by its role)',
      ).toBe('{clientId}');

      const submittedLoan = await snapshotLoan(loanId);
      expect(
        submittedLoan.status.toLowerCase(),
        'W4: the loan waits for the approval W5 gives it',
      ).toContain('submitted');
      expect(submittedLoan.principal, 'W4: the loan holds the principal applied for').toBe(
        SCENARIO.loanApplication.principal,
      );
      // The fork reports an `approvedPrincipal` on the submitted loan as well, echoing the amount the application proposes, so nothing is asserted about it until W5 sets it through the approve command.
      expect(submittedLoan.transactionCount, 'W4: a submitted loan carries no transaction').toBe(0);
      expect(
        submittedLoan.chargeCount,
        'W4: the application carries no charge, because the chain adds none (Rule 1 clause 3)',
      ).toBe(0);

      // ── Stage 3 — W5 approve and disburse ───────────────────────────────────────────────────────
      await pages.loans.openAction(loanId, 'approve');
      const approvalTemplate = latestCall(capture, 'GET', LOAN_APPROVAL_TEMPLATE_PATH);
      expect(
        approvalTemplate,
        'W5: the approval form reads GET /loans/{id}/template for the values it may approve',
      ).not.toBeNull();
      expect(
        approvalTemplate?.query['templateType'],
        'W5: the approval form reads the approval template',
      ).toBe('approval');
      if (pages.uiProject === 'legacy') {
        await pages.loans.fillActionForm({
          date: runDate,
          amount: String(SCENARIO.loanApplication.principal),
        });
      } else {
        await pages.loans.fillActionForm({
          approvedOnDate: runDateInput,
          approvedPrincipal: SCENARIO.loanApplication.principal,
        });
      }
      await pages.loans.submitAction();
      await expect(
        page,
        'W5: a successful approval returns to the loan record',
      ).toHaveURL(LOAN_RECORD_ROUTE);
      const approvals = callsTo(capture, 'POST', LOAN_RESOURCE_PATH, 'approve');
      expect(
        approvals.length,
        'W5: approving posts exactly one POST /loans/{id}?command=approve — one click, one request',
      ).toBe(1);
      const approvalFields = requestFields(approvals.at(0) ?? null) ?? {};
      expect(approvalFields['dateFormat'], 'Rule 1 clause 2: the body carries dateFormat').toBe(
        PAYLOAD_DATE_FORMAT,
      );
      expect(approvalFields['locale'], 'Rule 1 clause 2: the body carries the locale').toBe(LOCALE);
      expect(approvalFields['approvedOnDate'], 'W5: the approval is dated the run date').toBe('d0');
      expect(
        Number(approvalFields['approvedLoanAmount'] ?? approvalFields['approvedPrincipal']),
        'W5: the approval approves the principal applied for (the fork names the field approvedLoanAmount)',
      ).toBe(SCENARIO.loanApplication.principal);

      await pages.loans.openAction(loanId, 'disburse');
      const disburseTemplate = latestCall(capture, 'GET', LOAN_TRANSACTIONS_TEMPLATE_PATH, 'disburse');
      expect(
        disburseTemplate,
        'W5: the disbursal form reads GET /loans/{id}/transactions/template?command=disburse',
      ).not.toBeNull();
      if (pages.uiProject === 'legacy') {
        await pages.loans.fillActionForm({
          date: runDate,
          amount: String(SCENARIO.loanApplication.principal),
        });
      } else {
        await pages.loans.fillActionForm({
          actualDisbursementDate: runDateInput,
          transactionAmount: SCENARIO.loanApplication.principal,
        });
      }
      await pages.loans.submitAction();
      await expect(
        page,
        'W5: a successful disbursal returns to the loan record',
      ).toHaveURL(LOAN_RECORD_ROUTE);
      const disbursals = callsTo(capture, 'POST', LOAN_RESOURCE_PATH, 'disburse');
      expect(
        disbursals.length,
        'W5: disbursing posts exactly one POST /loans/{id}?command=disburse — one click, one request',
      ).toBe(1);
      const disburseFields = requestFields(disbursals.at(0) ?? null) ?? {};
      expect(disburseFields['dateFormat'], 'Rule 1 clause 2: the body carries dateFormat').toBe(
        PAYLOAD_DATE_FORMAT,
      );
      expect(disburseFields['locale'], 'Rule 1 clause 2: the body carries the locale').toBe(LOCALE);
      expect(
        disburseFields['actualDisbursementDate'],
        'W5: the disbursal is dated the run date',
      ).toBe('d0');
      expect(
        Number(disburseFields['transactionAmount']),
        'W5: the disbursal releases the principal that was approved',
      ).toBe(SCENARIO.loanApplication.principal);

      const disbursedLoan = await snapshotLoan(loanId);
      expect(disbursedLoan.status, 'W5: the disbursed loan is Active').toBe('Active');
      expect(
        disbursedLoan.approvedPrincipal,
        'W5: the approved principal is the amount that was applied for',
      ).toBe(SCENARIO.loanApplication.principal);
      const totalExpectedRepayment = requireFigure(
        disbursedLoan.totalExpectedRepayment,
        "the loan's total expected repayment",
      );
      expect(
        disbursedLoan.totalOutstanding,
        'W5: a freshly disbursed loan owes its whole expected repayment',
      ).toBeCloseTo(totalExpectedRepayment, 2);

      await pages.loans.openView(loanId);
      const transactionsAfterDisbursal = await pages.loans.readTransactions();
      // The product is accrual-based, so the disbursal leaves the loan with the disbursement and the interest it accrues; what matters here is that the record shows exactly what the API reports, and that the repayment below repays the first period's total due.
      expect(
        transactionsAfterDisbursal.length,
        'W5: the loan record shows the transactions the disbursal left on the loan',
      ).toBe(disbursedLoan.transactionCount);
      expect(
        transactionsAfterDisbursal.length,
        'W5: a disbursed loan carries at least the disbursement itself',
      ).toBeGreaterThanOrEqual(1);

      // ── Stage 4 — W6 repay the first period, and the schedule and transactions follow ──────────
      const scheduleRows = await pages.loans.readScheduleRows();
      let firstRepaymentPeriod: {
        period: string | number | null;
        totalDue: string | number | null;
      } | null = null;
      for (const row of scheduleRows) {
        if (firstRepaymentPeriod === null && row.period !== null && Number(row.period) >= 1) {
          firstRepaymentPeriod = { period: row.period, totalDue: row.totalDue };
        }
      }
      expect(
        firstRepaymentPeriod,
        'W6: the record renders the repayment schedule whose first period is the amount W6 repays',
      ).not.toBeNull();
      const firstPeriodTotalDue = requireFigure(
        disbursedLoan.firstPeriodTotalDue,
        "the loan's first repayment period total due",
      );
      expect(
        figureOf(firstRepaymentPeriod?.totalDue ?? null),
        'W6: the rendered first period total due equals the schedule the server returned',
      ).toBeCloseTo(firstPeriodTotalDue, 2);

      await pages.loans.openRepayment(loanId);
      const repaymentTemplate = latestCall(
        capture,
        'GET',
        LOAN_TRANSACTIONS_TEMPLATE_PATH,
        'repayment',
      );
      expect(
        repaymentTemplate,
        'W6: the repayment form reads GET /loans/{id}/transactions/template?command=repayment',
      ).not.toBeNull();
      if (pages.uiProject === 'legacy') {
        await pages.loans.fillRepayment({
          date: runDate,
          amount: String(firstPeriodTotalDue),
        });
      } else {
        await pages.loans.fillRepayment({
          transactionDate: runDateInput,
          transactionAmount: firstPeriodTotalDue,
        });
      }
      await pages.loans.submitRepayment();
      await expect(
        page,
        'W6: a successful repayment returns to the loan record',
      ).toHaveURL(LOAN_RECORD_ROUTE);
      const repayments = callsTo(capture, 'POST', LOAN_TRANSACTIONS_PATH, 'repayment');
      expect(
        repayments.length,
        'W6: repaying posts exactly one POST /loans/{id}/transactions?command=repayment',
      ).toBe(1);
      const repaymentFields = requestFields(repayments.at(0) ?? null) ?? {};
      expect(
        Number(repaymentFields['transactionAmount']),
        "W6: the repayment is the first period's total due, exactly as the schedule reports it",
      ).toBeCloseTo(firstPeriodTotalDue, 2);
      expect(repaymentFields['transactionDate'], 'W6: the repayment is booked on the run date').toBe(
        'd0',
      );
      expect(repaymentFields['dateFormat'], 'Rule 1 clause 2: the body carries dateFormat').toBe(
        PAYLOAD_DATE_FORMAT,
      );
      expect(repaymentFields['locale'], 'Rule 1 clause 2: the body carries the locale').toBe(LOCALE);
      expect(
        String(repaymentFields['paymentTypeId'] ?? '').length,
        'W6: the repayment names the payment type its transaction template offered',
      ).toBeGreaterThan(0);

      await pages.loans.openView(loanId);
      const recordRead = latestCall(capture, 'GET', LOAN_RESOURCE_PATH);
      expect(
        recordRead,
        'W6: the record reads the loan back through GET /loans/{id}?associations=all',
      ).not.toBeNull();
      expect(
        recordRead?.query['associations'] ?? '',
        'W6: that read asks for the schedule, the transactions and the charges together',
      ).toContain('all');

      // ── Final proof — the record evidence, then AAP 0.10.3 criterion 12's three facts ───────── The screen reads happen before the API snapshots and before the acceptance assertions, so the three facts that decide the verdict are read once the chain has settled.
      await pages.clientView.open(clientId);
      const finalClientHeader = await pages.clientView.readHeader();
      await pages.loans.openView(loanId);
      const finalLoanSummary = await pages.loans.readSummary();
      const transactionsAfterRepayment = await pages.loans.readTransactions();
      const notifications = await pages.clients.readNotifications();
      const finalClient = await snapshotClient(clientId, runDate);
      const finalLoan = await snapshotLoan(loanId);

      expect(
        finalClientHeader.statusClass,
        'W2: after the whole chain the client record still paints the active status indicator',
      ).toMatch(ACTIVE_STATUS_CLASS);
      expect(
        finalLoanSummary.statusClass,
        'W5: after the whole chain the loan record paints the active status indicator',
      ).toMatch(ACTIVE_STATUS_CLASS);
      expect(
        transactionsAfterRepayment.length,
        'W6: the record shows one transaction more than the disbursal alone left',
      ).toBe(transactionsAfterDisbursal.length + 1);
      expect(
        finalLoan.transactionCount,
        'W6: the loan carries one transaction more than the disbursal alone left',
      ).toBe(disbursedLoan.transactionCount + 1);
      expect(
        notifications.length,
        'AAP 0.7.4: no screen in the run raised a notification — the chain is a happy path',
      ).toBe(0);
      for (const exchange of capture.capture.exchanges) {
        if (exchange.path === AUTHENTICATION_PATH) {
          continue;
        }
        expect(
          exchange.hasTenantHeader,
          `Rule 1 clause 2: ${exchange.method} ${exchange.path} carries the tenant header`,
        ).toBe(true);
        expect(
          exchange.hasAuthorizationHeader,
          `W1: ${exchange.method} ${exchange.path} carries the session the login produced`,
        ).toBe(true);
      }

      expect(
        finalClient.status,
        'criterion 12 (W2): the client the chain created and activated is Active on the backend',
      ).toBe('Active');
      expect(
        finalLoan.status,
        'criterion 12 (W5): the loan the chain submitted, approved and disbursed is Active on the backend',
      ).toBe('Active');
      expect(
        requireFigure(finalLoan.totalOutstanding, "the repaid loan's outstanding balance"),
        "criterion 12 (W6): the outstanding balance equals the loan's total expected repayment minus the first period's total due",
      ).toBeCloseTo(totalExpectedRepayment - firstPeriodTotalDue, 2);

      return { stateTargets: { clientId, loanId } };
    });
  });
});

