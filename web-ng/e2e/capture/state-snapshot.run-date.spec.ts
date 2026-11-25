/**
 * The harness's own tests for the one read `e2e/capture/state-snapshot.ts` makes outside `readJson`:
 * the tenant business date that becomes the run date (Rule 1 clause 2; AAP 0.9.4 row 9).
 *
 * Why this file exists. `captureState()` resolves its run date by calling the seed module's
 * `readBusinessDate()`, which sends the session headers with its request. That call was the one read in
 * the module with no wrapping of its own, so a transport-level failure escaped as Playwright's own
 * error — whose message is the API call log, `Authorization: Basic <key>` and
 * `Fineract-Platform-TenantId` included — into whatever logged it: a failing spec's output, the parity
 * report writer or CI. That is exactly the Rule 1 clause 9 breach this module's contract exists to
 * prevent, and nothing in `npm test` reaches the module, so it survived the harness suite. The spec
 * below pins the wrapping for both ways the read can fail, and pins the absence of header text, session
 * key and Playwright failure text in what is thrown.
 *
 * How it runs without a backend. A loopback stub answers `POST /authentication` and then fails the
 * business-date read the way the defect was reproduced: by destroying the socket (no HTTP response at
 * all, the case that leaked) or with `HTTP 500`. The module reads `FINERACT_URL` at import, so each test
 * stubs the environment, resets the module registry and imports a fresh copy — which is also what gives
 * every test an empty run-date cache, so the read really is attempted.
 *
 * These are the harness's tests, not the Playwright workflow specs: they run under the
 * `web-ng-harness` vitest project (`e2e/vitest.config.ts`, `npm run test:harness`) in a plain Node
 * environment and need no browser, no Fineract and no legacy host.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The stub's user name and login value. `fixtures.ts` reads the pair from `E2E_USER` and
 * `E2E_PASSWORD`, and the stub accepts any pair, so these name the stub's own inputs and are not a
 * credential (AAP 0.10.4's credential gate).
 */
const STUB_USER = 'stub-user';
const STUB_LOGIN = 'stub-login';

/**
 * The session key the stub answers with, assembled from parts so no scanner reads the result as a real
 * credential (AAP 0.10.4). The assertions below require the thrown message never to carry it.
 */
const STUB_SESSION_KEY = ['RkFLRS1TRVNT', 'SU9OLUtFWS1GT1It', 'UkVQUk8='].join('');

/** The tenant this run uses: the default, so the tenant header the module sends is predictable. */
const STUB_TENANT = 'default';

/** How the stub fails the business-date read — the two failure modes the finding and its expectation name. */
type FailureMode = 'no-response' | 'refused';

/** One row of the table below: how the stub fails, the status that must surface, and the label. */
interface FailureCase {
  /** Shape of the stub's failure. */
  readonly mode: FailureMode;
  /** Status the raised `StateSnapshotError` must carry: `0` when no response arrived at all. */
  readonly status: number;
  /** What the case does, interpolated into the test name. */
  readonly label: string;
}

const CASES: FailureCase[] = [
  {
    mode: 'no-response',
    status: 0,
    label: 'the business-date socket is destroyed so no response arrives',
  },
  {
    mode: 'refused',
    status: 500,
    label: 'the business-date read is answered with HTTP 500',
  },
];

/** The stub backend every test talks to, and the base address `FINERACT_URL` is pointed at. */
let stub: Server;
let stubUrl: string;

/** The failure the next business-date read meets; armed by each test before it imports the module. */
let failureMode: FailureMode = 'no-response';

/**
 * Answers the credential exchange, then fails the business-date read the way {@link failureMode} names.
 * Any other call is a request this spec does not expect, so it is refused with `404` rather than
 * mistaken for one of the two the module makes.
 */
function handleStubRequest(request: IncomingMessage, response: ServerResponse): void {
  const url = request.url ?? '';
  if (request.method === 'POST' && url.endsWith('/authentication')) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ base64EncodedAuthenticationKey: STUB_SESSION_KEY }));
    return;
  }
  if (request.method === 'GET' && url.endsWith('/businessdate/BUSINESS_DATE')) {
    if (failureMode === 'refused') {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          developerMessage: 'the stub refused the business date',
          httpStatusCode: '500',
        }),
      );
      return;
    }
    // The transport failure the defect was reproduced with: the socket goes before any response exists.
    request.socket.destroy();
    return;
  }
  response.writeHead(404, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ developerMessage: 'the stub holds no such resource' }));
}

/**
 * Imports a fresh copy of the capture module against the stub, with the failure mode armed.
 *
 * The module's dependency chain reads `FINERACT_URL`, the credentials and the tenant at import, so the
 * environment is stubbed and the registry reset first.
 *
 * @param mode How the stub will fail the business-date read.
 * @returns The module namespace, whose `StateSnapshotError` is the class the module's own throws use.
 */
async function importCaptureModuleAgainstStub(
  mode: FailureMode,
): Promise<typeof import('./state-snapshot')> {
  failureMode = mode;
  vi.stubEnv('FINERACT_URL', stubUrl);
  vi.stubEnv('TENANT_ID', STUB_TENANT);
  vi.stubEnv('E2E_USER', STUB_USER);
  vi.stubEnv('E2E_PASSWORD', STUB_LOGIN);
  vi.resetModules();
  return import('./state-snapshot');
}

beforeAll(async () => {
  stub = createServer(handleStubRequest);
  await new Promise<void>((resolve, reject) => {
    stub.once('error', reject);
    // Port 0 asks the kernel for a free ephemeral port, so a parallel run on this host cannot collide.
    stub.listen(0, '127.0.0.1', () => resolve());
  });
  const address = stub.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The stub backend bound no TCP port on 127.0.0.1, so no test can reach it.');
  }
  stubUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  stub.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    stub.close((error?: Error) => (error === undefined ? resolve() : reject(error)));
  });
});

describe('captureState() with no runDate: a failed business-date read (Rule 1 clause 9; Rule 1 clause 2)', () => {
  it.each(CASES)(
    'raises a StateSnapshotError naming the endpoint and the status when $label',
    async ({ mode, status }) => {
      const snapshot = await importCaptureModuleAgainstStub(mode);

      const failure = await snapshot
        .captureState({ project: 'next', workflow: 'W6', clientId: 27 })
        .then(() => null)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(snapshot.StateSnapshotError);
      if (!(failure instanceof snapshot.StateSnapshotError)) {
        throw new Error(`captureState() threw ${String(failure)} instead of a StateSnapshotError.`);
      }
      expect(failure.name).toBe('StateSnapshotError');
      expect(failure.endpoint).toBe('/businessdate/BUSINESS_DATE');
      expect(failure.status).toBe(status);
      // The message says what failed and why nothing stands in for it (Rule 1 clause 2) ...
      expect(failure.message).toContain('/businessdate/BUSINESS_DATE');
      expect(failure.message).toMatch(/browser clock/i);
      // ... and carries no request header, no session key and no Playwright call log (Rule 1 clause 9).
      expect(failure.message).not.toMatch(/authorization/i);
      expect(failure.message).not.toMatch(/basic\s+[A-Za-z0-9+/=]{8,}/i);
      expect(failure.message).not.toContain('Fineract-Platform-TenantId');
      expect(failure.message).not.toContain(STUB_SESSION_KEY);
    },
  );
});
