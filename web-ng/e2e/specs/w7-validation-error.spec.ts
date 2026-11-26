/** Workflow W7 — a Fineract validation error is shown to the user (AAP 0.10.1 W7 row; AAP 0.7.3 W7 row; AAP 0.11.1 row 52) (AAP 0.4.4, AAP 0.7.2, Rule 1 clause 3, Rule 1 clause 2). */
import { expect, test } from '../fixtures/parity-fixture';
import { snapshotClient } from '../capture/state-snapshot';
import type { NormalizedExchange } from '../capture/network-capture';
import {
  LOCALE,
  PAYLOAD_DATE_FORMAT,
  SCENARIO,
  SEED_LOAN_PRODUCT,
  formatDateOnly,
  readCredentials,
} from '../seed/fixtures';

/** The application screen W7 is driven from, as the hash the route produces (AAP 0.8.2). */
const APPLICATION_ROUTE = '#/newclientloanaccount/';

const LOAN_RECORD_ROUTE = '#/viewloanaccount/';

const CLIENT_RECORD_HASH = /\/viewclient\/(\d+)/;

/** The principal control, rendered as `#principal` on both front ends (`LoanNewComponent`). */
const PRINCIPAL_FIELD = '#principal';

/** The screen's failure banner. Both front ends render the server's message in this region — the new app's `loan-new.component.html` as `.alert.alert-danger`, the legacy screen through the `uib-alert` the `apiValidate` directive renders. */
const ERROR_BANNER = 'div.alert.alert-danger';

/** Last path segment of the loan collection the application is submitted to (AAP 0.7.3 W4, W7). */
const LOAN_COLLECTION_PATH = '/loans';

/** The statuses AAP 0.10.1's W7 row accepts for the refusal. A 400 is what this fork answers for an out-of-range principal; a 403 is accepted as well because the row names both. */
const ACCEPTED_REFUSAL_STATUSES: readonly number[] = [400, 403];

const SUBMIT_TIMEOUT_MS = 30_000;

const BANNER_TIMEOUT_MS = 15_000;

interface ServerErrorEnvelope {
  /** The message the application renders: the first field-level `defaultUserMessage`, else its top-level one. */
  readonly rendered: string;
  /** The non-empty `errors[].defaultUserMessage` entries, in the server's order. */
  readonly fieldMessages: readonly string[];
}

/** A text with its runs of whitespace collapsed to one space and its ends trimmed (AAP 0.10.2). */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The client id a client-record URL carries. @param url The page's absolute URL, e.g. the configured application origin followed by `/#/viewclient/2`. @throws When the hash names no client record, quoting the hash that was read. */
function readClientId(url: string): number {
  const hash = new URL(url).hash;
  const match = CLIENT_RECORD_HASH.exec(hash);
  const id = match === null ? undefined : match[1];
  if (id === undefined) {
    throw new Error(`the client record's hash carries no client id; the page is at ${hash}`);
  }
  return Number(id);
}

/** Whether one captured exchange is an application submission: a `POST` to the loan collection that carries no `command` query parameter, so the schedule calculation (`command=calculateLoanSchedule`) is never counted as a submission. */
function isLoanSubmit(exchange: NormalizedExchange): boolean {
  return (
    exchange.method === 'POST' &&
    exchange.path.endsWith(LOAN_COLLECTION_PATH) &&
    !('command' in exchange.query)
  );
}

/** Every application submission a capture holds, in the order the page issued them (AAP 0.1.1). */
function loanSubmits(exchanges: readonly NormalizedExchange[]): readonly NormalizedExchange[] {
  return exchanges.filter(isLoanSubmit);
}

function onlyLoanSubmit(exchanges: readonly NormalizedExchange[]): NormalizedExchange {
  const submits = loanSubmits(exchanges);
  if (submits.length !== 1) {
    throw new Error(
      `the capture holds ${submits.length} POST to the loan collection without a command; W7 states ` +
        'exactly one submission, because a refused application is never retried automatically',
    );
  }
  const [submit] = submits;
  return submit;
}

/** One numeric member of a captured request body, narrowed out of the unmodelled payload. @param value A captured request body, `unknown` by design (Rule 1 clause 4). @param member The member to read, e.g. `principal`. */
function readNumericMember(value: unknown, member: string): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const memberValue = (value as Record<string, unknown>)[member];
  return typeof memberValue === 'number' ? memberValue : null;
}

/** One text member of a captured request body, narrowed out of the unmodelled payload the same way — the contract's `dateFormat` and `locale` are read through it (Rule 1 clause 2). @param value A captured request body (Rule 1 clause 4). */
function readTextMember(value: unknown, member: string): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const memberValue = (value as Record<string, unknown>)[member];
  return typeof memberValue === 'string' ? memberValue : null;
}

/** Whether a member of `errors` is an entry carrying its own message. */
function carriesDefaultUserMessage(value: unknown): value is { readonly defaultUserMessage: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { defaultUserMessage?: unknown }).defaultUserMessage === 'string'
  );
}

/** Reads a Fineract refusal into the message the screen renders and the field-level messages that accompany it (Rule 1 clause 4). */
function readErrorEnvelope(body: unknown): ServerErrorEnvelope {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error(
      'the refused POST to the loan collection carried no JSON error object, so there is no server ' +
        'message to compare the screen with',
    );
  }

  const envelope = body as { defaultUserMessage?: unknown; errors?: unknown };
  const declared =
    typeof envelope.defaultUserMessage === 'string' ? collapse(envelope.defaultUserMessage) : '';
  const fieldMessages: readonly string[] = Array.isArray(envelope.errors)
    ? envelope.errors
        .filter(carriesDefaultUserMessage)
        .map((entry) => collapse(entry.defaultUserMessage))
        .filter((message) => message.length > 0)
    : [];

  const rendered = fieldMessages[0] ?? declared;
  if (rendered.length === 0) {
    throw new Error(
      'the refused POST to the loan collection carried neither an errors[].defaultUserMessage nor ' +
        'a top-level defaultUserMessage, so the screen had no server text to show',
    );
  }

  return { rendered, fieldMessages };
}

test.describe('W7 a Fineract validation error is shown to the user', () => {
  test('an out-of-range principal is refused by Fineract and its message is shown verbatim', async ({
    runWorkflow,
  }) => {
    await runWorkflow('W7', async ({ page, pages, capture, runDate }) => {
      // 1. Sign in first: the fixture hands an unauthenticated page, and `authGuard` sends every other route to `/login`.
      const { username, password } = readCredentials();
      await pages.login.open();
      await pages.login.signIn(username, password);

      // 2. The client record W7 applies from, and the loan-account count it starts with — the before figure step 13 compares against, read from Fineract rather than assumed to be zero (the chain spec may already have given this client a loan).
      await pages.clients.open();
      await pages.clients.openClient(SCENARIO.client.displayName);
      const clientId = readClientId(page.url());
      const loanAccountsBefore: number = (await snapshotClient(clientId, runDate)).loanAccountCount;

      // 3. Into the application screen, for this client (AAP 0.10.1 W7 entry point).
      await pages.clientView.startNewLoan();
      const applicationHash = new URL(page.url()).hash;
      expect(applicationHash.startsWith(APPLICATION_ROUTE)).toBe(true);
      expect(applicationHash.slice(APPLICATION_ROUTE.length)).toBe(String(clientId));

      await pages.loans.selectProduct(SCENARIO.invalidLoanApplication.productName);

      // 5. Rule 1 clause 3, read directly off the control: nothing bounds the figure an applicant may enter, so the server — not the form — is what refuses an out-of-range principal.
      const principal = page.locator(PRINCIPAL_FIELD).filter({ visible: true }).first();
      await expect(principal).toBeVisible();
      expect(await principal.getAttribute('min')).toBeNull();
      expect(await principal.getAttribute('max')).toBeNull();
      expect(await principal.getAttribute('pattern')).toBeNull();

      const principalValue = SCENARIO.invalidLoanApplication.principal;
      if (pages.uiProject === 'legacy') {
        await pages.loans.fillApplication({
          principal: String(principalValue),
          numberOfRepayments: String(SEED_LOAN_PRODUCT.numberOfRepayments),
          repaymentEvery: String(SEED_LOAN_PRODUCT.repaymentEveryMonths),
          submittedOnDate: runDate,
          expectedDisbursementDate: runDate,
        });
      } else {
        const date = formatDateOnly(runDate);
        await pages.loans.fillApplication({
          principal: principalValue,
          numberOfRepayments: SEED_LOAN_PRODUCT.numberOfRepayments,
          repaymentEvery: SEED_LOAN_PRODUCT.repaymentEveryMonths,
          submittedOnDate: date,
          expectedDisbursementDate: date,
        });
      }

      // 7. The field accepted the figure and no error is showing yet: nothing rejected it before it was sent, which is the state W7 has to start from.
      expect(await principal.inputValue()).toBe(String(principalValue));
      expect(await page.locator(ERROR_BANNER).filter({ visible: true }).count()).toBe(0);

      await pages.loans.submitApplication();
      await expect
        .poll(
          () =>
            loanSubmits(capture.capture.exchanges).filter((exchange) => exchange.status !== 0).length,
          { timeout: SUBMIT_TIMEOUT_MS },
        )
        .toBe(1);
      const exchanges: readonly NormalizedExchange[] = await capture.settle();

      // 9. Exactly one submission left the browser, carrying the figure the applicant entered — the proof that the request reached Fineract rather than being stopped in the form (Rule 1 clause 2).
      expect(loanSubmits(exchanges)).toHaveLength(1);
      const submit = onlyLoanSubmit(exchanges);
      expect(readNumericMember(submit.requestBody, 'principal')).toBe(principalValue);
      expect(readTextMember(submit.requestBody, 'dateFormat')).toBe(PAYLOAD_DATE_FORMAT);
      expect(readTextMember(submit.requestBody, 'locale')).toBe(LOCALE);

      // 10. Fineract refused it. Either status AAP 0.10.1 accepts, and a body that names the field-level message the applicant has to act on.
      expect(ACCEPTED_REFUSAL_STATUSES).toContain(submit.status);
      const envelope = readErrorEnvelope(submit.responseBody);
      expect(envelope.fieldMessages.length).toBeGreaterThan(0);
      expect(envelope.rendered.length).toBeGreaterThan(0);

      // 11. The screen shows that message verbatim — the whole assertion of Rule 1 clause 3: the server's wording, punctuation and figures, with formatting alone normalised.
      const banner = page.locator(ERROR_BANNER).filter({ visible: true }).first();
      await expect(banner).toBeVisible({ timeout: BANNER_TIMEOUT_MS });
      expect(collapse(await banner.innerText())).toBe(envelope.rendered);

      expect(await principal.inputValue()).toBe(String(principalValue));
      const hashAfterSubmit = new URL(page.url()).hash;
      expect(hashAfterSubmit).toBe(applicationHash);
      expect(hashAfterSubmit.startsWith(LOAN_RECORD_ROUTE)).toBe(false);

      // 13. Nothing was created: the client's loan-account count is the one read before submitting, so a refused application left Fineract exactly as it found it.
      const loanAccountsAfter: number = (await snapshotClient(clientId, runDate)).loanAccountCount;
      expect(loanAccountsAfter).toBe(loanAccountsBefore);

      // The refused application changed nothing, so the only end state worth recording is the client whose count proves it (AAP 0.10.4: the parity report's end-state snapshot).
      return { stateTargets: { clientId } };
    });
  });
});
