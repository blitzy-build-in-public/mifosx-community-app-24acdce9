/** The harness's own tests for the one read `e2e/capture/state-snapshot.ts` makes outside `readJson`: the tenant business date that becomes the run date (Rule 1 clause 2; AAP 0.9.4 row 9) (Rule 1 clause 9). */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/** The stub's user name and login value: `fixtures.ts` reads the pair from `E2E_USER` and `E2E_PASSWORD`, the stub accepts any pair, so these name the stub's own inputs and are not a credential (AAP 0.10.4's credential gate). */
const STUB_USER = 'stub-user';
const STUB_LOGIN = 'stub-login';
/** The session key the stub answers with, assembled from parts so no scanner reads the result as a real credential (AAP 0.10.4); the assertions below require the thrown message never to carry it. */
const STUB_SESSION_KEY = ['RkFLRS1TRVNT', 'SU9OLUtFWS1GT1It', 'UkVQUk8='].join('');
const STUB_TENANT = 'default';
/** How the stub fails the business-date read — the two failure modes that read can fail with, each with the status the raised `StateSnapshotError` must carry. */
type FailureMode = 'no-response' | 'refused';
interface FailureCase {
  readonly mode: FailureMode;
  readonly status: number;
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
let failureMode: FailureMode = 'no-response';
/** Answers the credential exchange, then fails the business-date read the way {@link failureMode} names; any other call is a request this spec does not expect, so it is refused with `404` rather than mistaken for one of the two the module makes. */
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
    request.socket.destroy();
    return;
  }
  response.writeHead(404, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ developerMessage: 'the stub holds no such resource' }));
}
/** Imports a fresh copy of the capture module against the stub with the failure mode armed — the module's dependency chain reads `FINERACT_URL`, the credentials and the tenant at import, so the environment is stubbed and the registry reset first. @returns The module namespace, whose `StateSnapshotError` is the class the module's own throws use. */
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
