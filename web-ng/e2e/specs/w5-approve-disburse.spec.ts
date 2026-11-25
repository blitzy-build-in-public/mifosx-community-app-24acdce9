/**
 * W5 — approve and disburse the loan (AAP 0.10.1 W5 row; AAP 0.7.3 "W5 approve and disburse"; AAP 0.11.1
 * row 52; AAP 0.4.4 "one request per click"; Rule 1 clauses 2, 3, 4, 8 and 9).
 *
 * **Precondition and ordering contract.** `w4-loan-application.spec.ts` runs before this file — Playwright's
 * filename order over one seeded database per project (`workers: 1`, AAP 0.10.3 criterion 3) — and leaves one
 * loan in status `Submitted` for `Parity Client` (AAP 0.10.1 W4). The chain spec may additionally have left an
 * `Active` loan on a different client, so this file never takes "the first row": it lists the client's loan
 * accounts, confirms each candidate's status against Fineract with `snapshotLoan()` and works only on the one
 * loan whose status is `Submitted`. When no submitted loan can be located the spec fails with a message naming
 * that precondition — it never skips, because a skip would prove nothing (Rule 1 clause 8).
 *
 * **The four calls this workflow owns** (AAP 0.10.1 W5; AAP 0.7.3 row "W5 approve and disburse"), each asserted
 * against the running network capture:
 *
 * 1. `GET /loans/{id}/template?templateType=approval` — the approve form's defaults
 * 2. `POST /loans/{id}?command=approve` — one request, never two
 * 3. `GET /loans/{id}/transactions/template?command=disburse` — the disburse form's defaults
 * 4. `POST /loans/{id}?command=disburse` — one request, never two
 *
 * The end state is Fineract's own, read back over the API instead of off the screen: `Approved` with no
 * transaction after the first step, then `Active` with the whole expected repayment outstanding after the
 * second (AAP 0.10.1 W5 "loan status `Active`").
 *
 * **How the loan is located, and why the capture is read.** W5's entry point is `#/viewloanaccount/:id`, whose
 * id the harness must know before it can navigate. The client record is the only screen that lists the client's
 * loans and it is deliberately read-only: its accounts table paints the account number, the product, the status
 * swatch and the balance and nothing else — no id and no link, on either front end (AAP 0.7.4; the legacy table
 * links a row only in the legacy application's own markup). The id therefore comes from the answer that screen
 * itself requested, `GET /clients/{clientId}/accounts`, whose `loanAccounts[].id` the capture has templated by
 * role; {@link resourceIdOf} resolves that token back to the id through the capture's own role map. This adds no
 * request either front end did not already make, uses one code path for both projects, and compares no
 * generated identifier by value (AAP 0.10.2).
 *
 * **One request per click** (AAP 0.4.4; AAP 0.1.1 duplicate-submission protection): each action is submitted
 * exactly once through `submitAction()`, the spec never retries it, and the number of captured `POST
 * /loans/{loanId}` exchanges is asserted to be exactly one per command. The screens latch their submit control
 * while its request is in flight and the page object exposes no reader for that latch, so the single-POST count
 * is this file's proof of the protection.
 *
 * **Rules honoured here.** Rule 1 clause 2: only the AAP 0.7.3 W5 endpoints are addressed, every action carries
 * `?command=`, every date typed is the run date read from Fineract (`runDate`, never the browser clock) and every
 * date-bearing body carries `dateFormat: 'dd MMMM yyyy'` with the fixture's `locale`. Rule 1 clause 3: no
 * validation or confirmation step legacy lacks is added — the forms are filled and submitted as the screens
 * present them. Rule 1 clause 4: strict types throughout, `any` absent, and the two payload reads narrowed from
 * the capture's `NormalizedValue` at that boundary. Rule 1 clause 9: no credential, header value or session
 * material is printed, attached or compared — only header presence, which the capture reduces to a boolean.
 * Rule 2: every navigation goes through a page object, so no host literal appears here, and the fixture's
 * teardown fails the run if any captured API call left `FINERACT_URL`.
 */
import { expect, test } from '../fixtures/parity-fixture';
import { snapshotLoan } from '../capture/state-snapshot';
import type { LoanSnapshot } from '../capture/state-snapshot';
import type { CaptureSession, NormalizedExchange, NormalizedValue } from '../capture/network-capture';
import {
  LOCALE,
  PAYLOAD_DATE_FORMAT,
  SCENARIO,
  formatDateOnly,
  formatFineractDate,
  readCredentials,
} from '../seed/fixtures';

/**
 * The one endpoint the five lifecycle commands share, spelled whole so `npm run check:endpoints` reads it as the
 * declared `/loans/{id}` row rather than as an unresolvable builder. The capture templates every numeric path
 * segment by its role (AAP 0.10.2), so this is the form a recorded exchange carries — which is also why this file
 * holds no generated id and no id literal.
 */
const LOAN_RESOURCE_PATH = '/fineract-provider/api/v1/loans/{loanId}';

/** `GET /loans/{id}/template?templateType=approval` — the approve form's defaults (AAP 0.7.3 row W5). */
const APPROVAL_TEMPLATE_PATH = '/fineract-provider/api/v1/loans/{loanId}/template';

/** `GET /loans/{id}/transactions/template?command=disburse` — the disburse form's defaults (AAP 0.7.3 row W5). */
const DISBURSE_TEMPLATE_PATH = '/fineract-provider/api/v1/loans/{loanId}/transactions/template';

/**
 * What the capture writes for a payload date equal to the run date: AAP 0.10.2 compares dates as day offsets
 * from the tenant business date, and `d0` is that normaliser's token for the run date itself. A capture taken
 * without a run date leaves dates verbatim, which is why the assertions below accept either form.
 */
const RUN_DATE_OFFSET_TOKEN = 'd0';

/** Fineract's status for an application that is submitted and not yet approved (AAP 0.10.1 W4's end state). */
const SUBMITTED_STATUS = 'submitted';

/** Fineract's status once the approve command has run (AAP 0.10.1 W5, first step). */
const APPROVED_STATUS = 'approved';

/** Fineract's status once the disburse command has run (AAP 0.10.1 W5's end state). */
const ACTIVE_STATUS = 'active';

/**
 * The colour class each front end paints for an active loan, keyed by project. The two vocabularies differ and
 * neither is the other's mistake: this application binds the hyphenated `status-active` token of AAP 0.2.2
 * (`StatusSwatchComponent`), while the baseline's `StatusLookup` filter maps `loanStatusType.active` to the
 * unhyphenated `statusactive`. Matching each side's own token is what keeps the check a statement about the
 * rendered state rather than about a stylesheet.
 */
const ACTIVE_STATUS_CLASS: Readonly<Record<'legacy' | 'next', RegExp>> = {
  legacy: /statusactive/i,
  next: /status-active/i,
};

/**
 * How a legacy notice is recognised as a failure. The baseline's `readNotifications()` answers text only — it has
 * no kind to read — and it does surface success toasts, so the check is on the vocabulary Fineract's own failures
 * use rather than on the presence of any notice at all.
 */
const LEGACY_FAILURE_NOTICE = /error|fail|invalid|unable|cannot|denied|required/i;

/** One parsed JSON body of a recorded exchange: the shape {@link asRecord} narrows to. */
type JsonObject = { readonly [field: string]: NormalizedValue };

/**
 * Narrows one normalised payload to a JSON object, or answers `null` for anything else.
 *
 * Every body reached from here is a Fineract request or response the harness does not model field by field, so
 * one check per JSON kind as it is walked is the documented boundary Rule 1 clause 4 permits: the captures' own
 * `NormalizedValue` union stays the type of every field, and no `any` enters this file.
 *
 * @param value A recorded request or response body, or `null` when the call carried none.
 */
function asRecord(value: NormalizedValue | undefined): JsonObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value;
}

/** A recorded text field, or `''` when the field is absent or was not a string. */
function asText(value: NormalizedValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

/**
 * A recorded money figure, whether the form posted it as a number or as the text its input held.
 *
 * The figure is what AAP 0.10.2 compares; which JSON type carried it is the two applications' business, and
 * pinning the type here would fail one of them for a difference the parity report exists to describe.
 *
 * @param value A recorded field.
 */
function asAmount(value: NormalizedValue | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const text = asText(value).trim();
  return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
}

/**
 * The JSON body of one recorded exchange.
 *
 * @param exchange An exchange the capture recorded.
 * @throws Error when the exchange carried no JSON body, naming the call — a command whose payload is missing
 *   cannot be compared with the workflow's values, and failing here beats asserting against `undefined`.
 */
function requestBodyOf(exchange: NormalizedExchange): JsonObject {
  const body = asRecord(exchange.requestBody);
  if (body === null) {
    throw new Error(
      `the ${exchange.method} ${exchange.path} exchange recorded no JSON body, so the command it carried ` +
        'cannot be compared with the values this workflow submitted',
    );
  }
  return body;
}

/**
 * The exchanges one capture recorded for one method and templated path, in the order the page issued them.
 *
 * @param capture The running capture.
 * @param method HTTP method, upper-cased as the capture records it.
 * @param path Templated path, e.g. {@link APPROVAL_TEMPLATE_PATH}.
 */
function callsTo(
  capture: CaptureSession,
  method: string,
  path: string,
): readonly NormalizedExchange[] {
  return capture.capture.exchanges.filter(
    (exchange) => exchange.method === method && exchange.path === path,
  );
}

/**
 * The `POST /loans/{id}` exchanges that carried one lifecycle command.
 *
 * The command lives in the query string, so two commands against one loan share a path and are told apart here;
 * the count of what this returns is the duplicate-submission evidence AAP 0.10.1 W5 asks for.
 *
 * @param capture The running capture.
 * @param command The lifecycle command, e.g. `approve` or `disburse`.
 */
function commandPosts(capture: CaptureSession, command: string): readonly NormalizedExchange[] {
  return callsTo(capture, 'POST', LOAN_RESOURCE_PATH).filter(
    (exchange) => exchange.query['command'] === command,
  );
}

/**
 * The loan ids the client record's own accounts read answered with.
 *
 * Every exchange answering with a `loanAccounts` array is read, which is how the harness reaches the ids without
 * asking a page object to render one: the record's table prints none (see the module doc). Ids are de-duplicated
 * because the same account can be described by more than one recorded answer, and the order the payload listed
 * them in is kept.
 *
 * @param capture The running capture.
 */
function loanAccountIds(capture: CaptureSession): readonly number[] {
  const ids: number[] = [];
  for (const exchange of capture.capture.exchanges) {
    if (exchange.method !== 'GET') {
      continue;
    }
    const payload = asRecord(exchange.responseBody);
    const accounts = payload === null ? undefined : payload['loanAccounts'];
    if (!Array.isArray(accounts)) {
      continue;
    }
    for (const account of accounts) {
      const entry = asRecord(account);
      const id = entry === null ? null : resourceIdOf(capture, entry['id']);
      if (id !== null && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }
  return ids;
}

/**
 * The id a recorded payload field stands for: the number itself when the capture kept it, or the id its role
 * token replaced.
 *
 * The capture normalises every id a run generates into a role token (`loanAccounts[].id` becomes
 * `{loanAccountId}`) so two runs compare equal, and keeps the real id in {@link CaptureSession.capture}'s
 * `roles` map. This is the reader that goes back the other way for the one case the harness needs an id to
 * navigate with.
 *
 * @param capture The running capture, whose role map is read.
 * @param value A recorded field that names a generated id.
 * @returns The id, or `null` when the value names none.
 */
function resourceIdOf(capture: CaptureSession, value: NormalizedValue | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  const token = asText(value);
  if (token.length === 0) {
    return null;
  }
  for (const [realId, recorded] of Object.entries(capture.capture.roles)) {
    if (recorded !== token) {
      continue;
    }
    const id = Number(realId);
    return Number.isInteger(id) && id > 0 ? id : null;
  }
  return null;
}

/**
 * The generated id one of the application's hash routes carries, e.g. `#/viewclient/2` -> `2`.
 *
 * Read from the address the page is on, so the workflow addresses the record it just opened rather than an id it
 * inferred. The id is used as an argument and for the end-state snapshot only — never compared with a literal
 * (AAP 0.10.2) — so this reader returns it and asserts nothing. Only the fragment is ever named in a failure:
 * the entry URL's query carries the harness's backend and tenant parameters, which have no place in a message.
 *
 * @param url The page's current address, as `page.url()` reports it.
 * @param route The route segment the id follows, e.g. `viewloanaccount`.
 * @param subject What was expected to be open, used in the failure message.
 * @throws Error when the address carries no such route with a numeric id.
 */
function requireHashId(url: string, route: string, subject: string): number {
  const hash = url.includes('#') ? url.slice(url.indexOf('#')) : '(no hash)';
  const matched = new RegExp(`#/${route}/(\\d+)(?=$|[/?#])`).exec(hash);
  const id = matched === null ? Number.NaN : Number(matched[1]);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(
      `${subject} is not open at a route carrying a generated id: the fragment is ${hash}, and this step ` +
        `needs #/${route}/{id} to address the record it reads`,
    );
  }
  return id;
}

/**
 * Fineract's status name in the one form the assertions compare: trimmed and lower-cased, so `Submitted`,
 * `submitted` and a payload that splices in a space are the same answer.
 *
 * @param status The status a snapshot reported.
 */
function normaliseStatus(status: string): string {
  return status.trim().toLowerCase();
}

test.describe('W5 approve and disburse the loan', () => {
  /**
   * Approves the loan W4 left submitted, then disburses it, asserting every call the two steps make, the count of
   * each command (one POST per action), and the Fineract end state each step leaves behind.
   */
  test('approves then disburses the submitted loan, one POST per action', async ({ runWorkflow }) => {
    await runWorkflow('W5', async ({ page, pages, capture, runDate }) => {
      const principal = SCENARIO.loanApplication.principal;
      const payloadDate = formatFineractDate(runDate).date;

      // ---------------------------------------------------------------------------------------------
      // Entry: sign in, land on the client list, open the client the loan belongs to (AAP 0.10.1 W5).
      // ---------------------------------------------------------------------------------------------
      const credentials = readCredentials();
      await pages.login.open();
      await pages.login.signIn(credentials.username, credentials.password);

      await pages.clients.open();
      await pages.clients.openClient(SCENARIO.client.displayName);
      const clientId = requireHashId(page.url(), 'viewclient', 'the client record');

      // The client record is the screen W5 is entered from, so its accounts section must answer: that answer is
      // also the read this file resolves the loan ids from (see the module doc on how the loan is located).
      const accounts = await pages.clientView.readAccounts();
      expect(
        accounts.length,
        'the client record rendered no account row: the submitted loan W4 creates is an account of ' +
          `${SCENARIO.client.displayName}, so the record must list at least one`,
      ).toBeGreaterThan(0);

      await expect
        .poll(() => loanAccountIds(capture).length, {
          message:
            'the client record did not read GET /clients/{id}/accounts, or its answer listed no loan account: ' +
            'W5 needs the loan W4 submitted, so check that the record screen still fetches the accounts section',
          timeout: 15_000,
        })
        .toBeGreaterThanOrEqual(1);

      // ---------------------------------------------------------------------------------------------
      // Locate the submitted loan. Never "the first row": the status is confirmed against Fineract.
      // ---------------------------------------------------------------------------------------------
      const submitted: { readonly loanId: number; readonly snapshot: LoanSnapshot }[] = [];
      for (const candidateId of loanAccountIds(capture)) {
        const candidate = await snapshotLoan(candidateId);
        if (normaliseStatus(candidate.status) === SUBMITTED_STATUS) {
          submitted.push({ loanId: candidateId, snapshot: candidate });
        }
      }
      expect(
        submitted.map((entry) => entry.loanId),
        'exactly one loan of ' +
          `${SCENARIO.client.displayName} must be in status Submitted for W5 to approve: ` +
          'w4-loan-application.spec.ts runs before this file (Playwright filename order, one seeded database ' +
          'per project) and leaves that loan behind, so this failure means the precondition was not met or the ' +
          'loan was already approved by an earlier step',
      ).toHaveLength(1);

      const [submittedLoan] = submitted;
      expect(
        submittedLoan.snapshot.principal,
        `the submitted loan must be the application W4 posted for ${principal} (AAP 0.10.1 W4)`,
      ).toBe(principal);
      expect(
        submittedLoan.snapshot.approvedPrincipal,
        'a loan in status Submitted carries no approved principal yet, so approving it is what W5 measures',
      ).toBeNull();

      // W5's entry point, `#/viewloanaccount/:id` (AAP 0.10.1). The id is read from the address the record opened
      // at and used as an argument only — it is never compared with a literal (AAP 0.10.2).
      await pages.loans.openView(submittedLoan.loanId);
      const loanId = requireHashId(page.url(), 'viewloanaccount', 'the loan record');

      // ---------------------------------------------------------------------------------------------
      // Approve: the approval template, one fill, one submit, one POST (AAP 0.10.1 W5; AAP 0.4.4).
      // ---------------------------------------------------------------------------------------------
      await pages.loans.openAction(loanId, 'approve');
      await expect
        .poll(
          () => callsTo(capture, 'GET', APPROVAL_TEMPLATE_PATH).map((exchange) => exchange.status),
          {
            message:
              'the approve screen did not read GET /loans/{id}/template?templateType=approval, which is the ' +
              'call that seeds its approved amount and approval date (AAP 0.7.3 row W5)',
            timeout: 15_000,
          },
        )
        .toEqual([200]);

      const [approvalTemplate] = callsTo(capture, 'GET', APPROVAL_TEMPLATE_PATH);
      expect(
        approvalTemplate.query['templateType'],
        'the approve form must be seeded from the approval template, so its request carries templateType=approval',
      ).toBe('approval');
      expect(
        approvalTemplate.hasTenantHeader,
        'every Fineract call carries the tenant header (Rule 1 clause 2), and the capture records its presence',
      ).toBe(true);
      expect(
        approvalTemplate.hasAuthorizationHeader,
        'every Fineract call carries the basic-auth header (Rule 1 clause 2), and the capture records its presence',
      ).toBe(true);

      // The two payload shapes are the one place the two front ends genuinely differ: the legacy datepicker takes a
      // Date and the amount as text, while the application's native date input takes `yyyy-mm-dd` and a number
      // (AAP 0.10.5 items 1 and 2). Each value is the loan's own approved amount and the run date — the browser
      // clock is never used for a value the workflow submits (Rule 1 clause 2).
      if (pages.uiProject === 'legacy') {
        await pages.loans.fillActionForm({ date: runDate, amount: String(principal) });
      } else {
        await pages.loans.fillActionForm({
          approvedOnDate: formatDateOnly(runDate),
          approvedPrincipal: principal,
        });
      }
      await pages.loans.submitAction();

      await expect
        .poll(() => commandPosts(capture, 'approve').length, {
          message:
            'the approve form did not send its command: expected one POST /loans/{id}?command=approve after the ' +
            'single submit (AAP 0.10.1 W5)',
          timeout: 15_000,
        })
        .toBe(1);

      const [approvePost] = commandPosts(capture, 'approve');
      await expect
        .poll(() => approvePost.status, {
          message:
            'the approve command was sent but Fineract did not answer it: a submitted loan in this tenant must ' +
            'accept command=approve with the approved amount and the run date',
          timeout: 15_000,
        })
        .toBe(200);

      const approveBody = requestBodyOf(approvePost);
      expect(
        [RUN_DATE_OFFSET_TOKEN, payloadDate],
        'the approve body must carry the run date as approvedOnDate, formatted for Fineract (Rule 1 clause 2)',
      ).toContain(asText(approveBody['approvedOnDate']));
      expect(
        asAmount(approveBody['approvedLoanAmount']),
        `the approved amount is the wire name both front ends post for ${principal} (AAP 0.7.2 calls it ` +
          'approvedPrincipal); it must equal the application principal',
      ).toBe(principal);
      expect(
        approveBody['dateFormat'],
        'every date-bearing body carries dateFormat dd MMMM yyyy (Rule 1 clause 2)',
      ).toBe(PAYLOAD_DATE_FORMAT);
      expect(
        approveBody['locale'],
        'every date-bearing body carries the locale of the payload dates (Rule 1 clause 2)',
      ).toBe(LOCALE);
      expect(
        approvePost.hasTenantHeader,
        'the approve command carries the tenant header, as every Fineract call does (Rule 1 clause 2)',
      ).toBe(true);
      expect(
        approvePost.hasAuthorizationHeader,
        'the approve command carries the basic-auth header, as every Fineract call does (Rule 1 clause 2)',
      ).toBe(true);

      // The end state of the first step, read from Fineract rather than from the screen (AAP 0.10.1 W5).
      const approved = await snapshotLoan(loanId);
      expect(
        normaliseStatus(approved.status),
        'approving a submitted loan leaves it in status Approved, and nothing has been disbursed yet',
      ).toBe(APPROVED_STATUS);
      expect(
        approved.approvedPrincipal,
        `Fineract must report the ${principal} approved principal after the approve command`,
      ).toBe(principal);
      expect(
        approved.transactionCount,
        'approval books no transaction: the disbursement is the first one this loan can carry (W6 starts from it)',
      ).toBe(0);

      // ---------------------------------------------------------------------------------------------
      // Disburse: the transactions template, one fill, one submit, one POST (AAP 0.10.1 W5; AAP 0.4.4).
      // ---------------------------------------------------------------------------------------------
      await pages.loans.openAction(loanId, 'disburse');
      await expect
        .poll(
          () => callsTo(capture, 'GET', DISBURSE_TEMPLATE_PATH).map((exchange) => exchange.status),
          {
            message:
              'the disburse screen did not read GET /loans/{id}/transactions/template?command=disburse, which is ' +
              'the call that seeds its disbursement date and amount (AAP 0.7.3 row W5)',
            timeout: 15_000,
          },
        )
        .toEqual([200]);

      const [disburseTemplate] = callsTo(capture, 'GET', DISBURSE_TEMPLATE_PATH);
      expect(
        disburseTemplate.query['command'],
        'the disburse form must be seeded from the transactions template read with command=disburse',
      ).toBe('disburse');

      // The screen's own default for the disbursed amount is the approved principal; it is stated here rather than
      // inherited so the posted figure is the workflow's own (the page object exposes no reader for the rendered
      // default, and a differing default would change the loan the backend records).
      if (pages.uiProject === 'legacy') {
        await pages.loans.fillActionForm({ date: runDate, amount: String(principal) });
      } else {
        await pages.loans.fillActionForm({
          actualDisbursementDate: formatDateOnly(runDate),
          transactionAmount: principal,
        });
      }
      await pages.loans.submitAction();

      await expect
        .poll(() => commandPosts(capture, 'disburse').length, {
          message:
            'the disburse form did not send its command: expected one POST /loans/{id}?command=disburse after the ' +
            'single submit (AAP 0.10.1 W5)',
          timeout: 15_000,
        })
        .toBe(1);

      const [disbursePost] = commandPosts(capture, 'disburse');
      await expect
        .poll(() => disbursePost.status, {
          message:
            'the disburse command was sent but Fineract did not answer it: an approved loan must accept ' +
            'command=disburse with the run date and the approved principal',
          timeout: 15_000,
        })
        .toBe(200);

      const disburseBody = requestBodyOf(disbursePost);
      expect(
        [RUN_DATE_OFFSET_TOKEN, payloadDate],
        'the disburse body must carry the run date as actualDisbursementDate (Rule 1 clause 2)',
      ).toContain(asText(disburseBody['actualDisbursementDate']));
      expect(
        asAmount(disburseBody['transactionAmount']),
        `the disbursed amount is the full approved principal of ${principal}, which the disbursal releases`,
      ).toBe(principal);
      expect(
        disburseBody['dateFormat'],
        'every date-bearing body carries dateFormat dd MMMM yyyy (Rule 1 clause 2)',
      ).toBe(PAYLOAD_DATE_FORMAT);
      expect(
        disburseBody['locale'],
        'every date-bearing body carries the locale of the payload dates (Rule 1 clause 2)',
      ).toBe(LOCALE);

      // The end state of the workflow: Active, with the whole expected repayment still outstanding because nothing
      // has been repaid yet (W6 is the workflow that repays). The charge count is deliberately not pinned: a loan
      // product that carries a charge would legitimately raise it.
      const disbursed = await snapshotLoan(loanId);
      expect(
        normaliseStatus(disbursed.status),
        'disbursing an approved loan leaves it in status Active (AAP 0.10.1 W5 outcome)',
      ).toBe(ACTIVE_STATUS);
      expect(
        disbursed.approvedPrincipal,
        `the active loan keeps the ${principal} approved principal the approve command recorded`,
      ).toBe(principal);
      expect(
        disbursed.totalExpectedRepayment,
        'the loan must report the total it expects to be repaid, which is what the outstanding balance is measured ' +
          'against',
      ).not.toBeNull();
      expect(
        disbursed.totalOutstanding,
        'a freshly disbursed loan has nothing repaid, so its outstanding balance equals the total expected repayment',
      ).toBe(disbursed.totalExpectedRepayment);

      // ---------------------------------------------------------------------------------------------
      // The record the user is left on: active status, the disbursement in its transactions, no error.
      // ---------------------------------------------------------------------------------------------
      await pages.loans.openView(loanId);
      const summary = await pages.loans.readSummary();
      expect(
        summary.statusClass,
        'the record must paint its active status: this application binds the hyphenated status-active token ' +
          '(AAP 0.2.2) while the baseline StatusLookup filter paints statusactive, so each side is checked for its ' +
          'own token',
      ).toMatch(ACTIVE_STATUS_CLASS[pages.uiProject]);

      const transactions: readonly { readonly type: string }[] = await pages.loans.readTransactions();
      expect(
        transactions.length,
        'the record transaction list must render exactly the transactions Fineract reports for the loan, which is ' +
          'the disbursement after this workflow',
      ).toBe(disbursed.transactionCount);
      expect(
        transactions.length,
        'the disbursement is a transaction, so the populated list must render at least one row rather than its ' +
          'empty state (AAP 0.7.4)',
      ).toBeGreaterThan(0);
      expect(
        transactions.some((row) => /disburs/i.test(row.type)),
        'the rendered transaction list must carry the disbursement the second step posted',
      ).toBe(true);

      if (pages.uiProject === 'legacy') {
        // The baseline record renders no empty state for any section (AAP 0.10.5), so an empty answer is what a
        // populated transaction list looks like there.
        const emptyStates = await pages.loans.readEmptyStates();
        expect(
          emptyStates.transactions,
          'the baseline record draws no empty state beside a populated transaction list',
        ).toBe('');
        const notices = await pages.clients.readNotifications();
        expect(
          notices.filter((notice) => LEGACY_FAILURE_NOTICE.test(notice)),
          'no failure notice may be on screen after the two commands were accepted',
        ).toEqual([]);
      } else {
        // Only the active section is mounted, so an empty answer means the transaction list is showing its rows and
        // no section is claiming to be empty.
        const emptyStates = await pages.loans.readEmptyStates();
        expect(
          emptyStates,
          'the populated transaction list must render no empty state, and only the active section is mounted',
        ).toEqual([]);
        const notices = await pages.clients.readNotifications();
        expect(
          notices.filter((notice) => notice.kind === 'error'),
          'no error notification may be shown after the two commands were accepted',
        ).toEqual([]);
      }

      // The client and the loan whose end state the run records for this workflow (AAP 0.10.1, AAP 0.10.4). The
      // fixture supplies the project, the workflow id and the run date, so nothing here can mislabel the snapshot.
      return { stateTargets: { clientId, loanId } };
    });
  });
});

