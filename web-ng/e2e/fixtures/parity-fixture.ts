/** The single Playwright fixture the whole legacy-versus-next parity suite is written against (AAP 0.11.1 row 48, "page-object selection per project and the host assertion"; AAP 0.8.1 tree `web-ng/e2e/fixtures/`; AAP (AAP 0.10.1, AAP 0.10.2, AAP 0.10.3, AAP 0.10.4). */
import { test as base, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

import { isStaticAssetUrl, startCapture } from '../capture/network-capture';
import type { CaptureSession, NormalizedExchange } from '../capture/network-capture';
import { captureState } from '../capture/state-snapshot';
import type { StateTargets, WrittenStateSnapshot } from '../capture/state-snapshot';
import { ClientViewPage as LegacyClientViewPage } from '../pages/legacy/client-view.page';
import { ClientsPage as LegacyClientsPage } from '../pages/legacy/clients.page';
import { LoansPage as LegacyLoansPage } from '../pages/legacy/loans.page';
import { LoginPage as LegacyLoginPage } from '../pages/legacy/login.page';
import { ClientViewPage as NextClientViewPage } from '../pages/next/client-view.page';
import { ClientsPage as NextClientsPage } from '../pages/next/clients.page';
import { LoansPage as NextLoansPage } from '../pages/next/loans.page';
import { LoginPage as NextLoginPage } from '../pages/next/login.page';
import { WORKFLOW_IDS, redactEntryLocation, writeWorkflowRecord } from '../report/parity-report';
import type { UiProject, WorkflowId, WorkflowRecord, WorkflowStatus } from '../report/parity-report';
import { FINERACT_URL, readBusinessDate, resetBusinessDateCache } from '../seed/fixtures';

/** Playwright's own `expect`, re-exported unchanged so a spec imports `test` and `expect` from one module (Rule 1 clause 8: every spec asserts through it). */
export { expect };

/** The verdict vocabulary and the project names, re-exported as types so a spec needs no second import for the vocabulary its workflow ids and statuses are written in (AAP 0.10.4). */
export type { UiProject, WorkflowId, WorkflowStatus } from '../report/parity-report';

/** The four page objects of the running front end, one accessor per screen family, tagged with the project they drive (AAP 0.10.5). */
export type ParityPages = LegacyParityPages | NextParityPages;

/** The legacy baseline's four page objects, tagged with the project they drive. */
export interface LegacyParityPages {
  readonly uiProject: 'legacy';
  /** Login screen, the entry point of W1 (AAP 0.10.1). */
  readonly login: LegacyLoginPage;
  readonly clients: LegacyClientsPage;
  readonly clientView: LegacyClientViewPage;
  readonly loans: LegacyLoansPage;
}

export interface NextParityPages {
  readonly uiProject: 'next';
  /** Login screen, the entry point of W1 (AAP 0.10.1). */
  readonly login: NextLoginPage;
  readonly clients: NextClientsPage;
  readonly clientView: NextClientViewPage;
  readonly loans: NextLoansPage;
}

export interface WorkflowTools {
  readonly pages: ParityPages;
  readonly page: Page;
  /** The tenant's business date (AAP 0.10.1): the reference every workflow date is an offset from. */
  readonly runDate: Date;
  readonly capture: CaptureSession;
}

export interface WorkflowArtifacts {
  readonly stateTargets?: Partial<StateTargets>;
}

export type WorkflowBody = (tools: WorkflowTools) => Promise<WorkflowArtifacts | void>;

/** `runWorkflow(id, body)` — the fixture value a spec calls to run one workflow (AAP 0.10.1). */
export type RunWorkflow = (workflowId: WorkflowId, body: WorkflowBody) => Promise<void>;

/** Per-test paths and facts the fixtures share: the capture names itself at setup, `runWorkflow` writes the artefacts and the record, and the capture's teardown fills in the path it wrote when the body never got that far. */
export interface EvidenceSink {
  captureLabel?: string;
  /** Workflow id `runWorkflow` was called with in this test. */
  workflow?: WorkflowId;
  /** Absolute path of the normalised capture `capture/network-capture.ts` wrote. */
  capturePath?: string;
  /** Absolute path of the end state `capture/state-snapshot.ts` wrote, when one was captured. */
  statePath?: string;
  /** Absolute path of the record `report/parity-report.ts` wrote. */
  recordPath?: string;
}

export interface ParityFixtures {
  /** Which front end the Playwright project drives (AAP 0.8.2). */
  uiProject: UiProject;
  pages: ParityPages;
  /** The tenant's business date read over the API (Rule 1 clause 2; AAP 0.10.1 "Run date"). */
  runDate: Date;
  /** The running, masked capture of the test's page (AAP 0.10.2; Rule 1 clause 9). */
  capture: CaptureSession;
  /** Runs one workflow and records its verdict (AAP 0.10.4). */
  runWorkflow: RunWorkflow;
  evidence: EvidenceSink;
}

/** Public demo Fineract hosts Rule 2 forbids either front end from addressing, given label by label. */
const DEMO_HOSTNAMES: readonly string[] = [
  ['demo', 'mifos', 'io'].join('.'),
  ['demo', 'fineract', 'dev'].join('.'),
];

/** The run date already resolved for each front end. AAP 0.10.4 runs the legacy project and then the next one in a single command, so the date is memoised per project and re-read once per project: a business date that. */
const RUN_DATES = new Map<UiProject, Promise<Date>>();

/** The hostname of an origin, or `null` when the origin is not a URL this module can read. */
function hostnameOf(origin: string): string | null {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

/** Fails when a capture left the configured backend, which is Rule 2's gate for the harness (AAP 0.3.4, AAP 0.10.2, Rule 1 clause 9). */
export function assertBackendHost(exchanges: readonly NormalizedExchange[]): void {
  const expectedOrigin = new URL(FINERACT_URL).origin;
  // Held here rather than at module level to keep the module's declarations to the four AAP 0.10.3 criterion 3 allows; a pattern is rebuilt per capture, which costs nothing next to the run.
  const apiPath = /^\/fineract-provider\//;
  for (const exchange of exchanges) {
    if (isStaticAssetUrl(`${exchange.origin}${exchange.path}`)) {
      continue;
    }
    if (apiPath.test(exchange.path) && exchange.origin !== expectedOrigin) {
      throw new Error(
        `Rule 2: ${exchange.method} ${exchange.path} went to ${exchange.origin}, but every environment ` +
          `calls the Fineract server named by FINERACT_URL (${expectedOrigin}) and never a public demo host.`,
      );
    }
    const hostname = hostnameOf(exchange.origin);
    if (hostname !== null && DEMO_HOSTNAMES.includes(hostname.toLowerCase())) {
      throw new Error(
        `Rule 2: ${exchange.method} ${exchange.path} went to the public demo host ${hostname}; both front ` +
          `ends must call the Fineract server named by FINERACT_URL (${expectedOrigin}).`,
      );
    }
  }
}

/** The front end a Playwright project drives (AAP 0.8.2's two projects), refusing any other project. */
function uiProjectOf(projectName: string): UiProject {
  if (projectName === 'legacy' || projectName === 'next') {
    return projectName;
  }
  throw new Error(
    `the parity fixture drives the "legacy" baseline and the "next" application only, but Playwright is ` +
      `running project "${projectName}": the two projects are the whole contract this fixture decides ` +
      `verdicts from, so a third one must not be registered.`,
  );
}

/** Whether a label is one of the eight workflow ids (AAP 0.8.2, AAP 0.10.4). */
function isWorkflowId(value: string): value is WorkflowId {
  // The tuple is widened to `readonly string[]` for the membership test only: its own element type would let `includes` accept nothing but a WorkflowId, which is the thing being established.
  return (WORKFLOW_IDS as readonly string[]).includes(value);
}

/** The workflow label the capture artefact is named for. `startCapture()` fixes a capture's name when it starts, and the capture here starts in a fixture — before the spec has called {@link RunWorkflow} with the id it (AAP 0.11.1). */
function captureLabelOf(testInfo: TestInfo): string {
  const workflowToken = /(?:^|[^A-Z0-9])(W[1-7]|CHAIN)(?![A-Z0-9])/;
  const specName = (testInfo.file.split(/[\\/]/).pop() ?? '').replace(/\.spec\.ts$/i, '');
  for (const candidate of [testInfo.title, specName]) {
    const found = workflowToken.exec(candidate.toUpperCase())?.[1];
    if (found !== undefined) {
      return found;
    }
  }
  return `${testInfo.title} ${testInfo.line}`.trim();
}

/** The run date of one front end's run: the tenant's business date read over the API (Rule 1 clause 2; AAP 0.10.1 "Run date"), never the browser clock, memoised per project (AAP 0.10.4). */
async function businessDateFor(project: UiProject): Promise<Date> {
  const known = RUN_DATES.get(project);
  if (known !== undefined) {
    return new Date((await known).getTime());
  }
  resetBusinessDateCache();
  const pending = readBusinessDate();
  RUN_DATES.set(project, pending);
  try {
    return new Date((await pending).getTime());
  } catch (error: unknown) {
    RUN_DATES.delete(project);
    throw error;
  }
}

/** What a thrown value says, as the non-empty text a verdict's `reason` must carry (AAP 0.10.4's `legacy-broken` record is unreadable without one) (AAP 0.10.2, Rule 1 clause 9). */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const text = message.trim().length > 0 ? message : 'the workflow failed without a message';
  return redactEntryLocation(text);
}

/** The legacy baseline's four page objects, all driving one page. */
function legacyPages(page: Page): LegacyParityPages {
  return {
    uiProject: 'legacy',
    login: new LegacyLoginPage(page),
    clients: new LegacyClientsPage(page),
    clientView: new LegacyClientViewPage(page),
    loans: new LegacyLoansPage(page),
  };
}

function nextPages(page: Page): NextParityPages {
  return {
    uiProject: 'next',
    login: new NextLoginPage(page),
    clients: new NextClientsPage(page),
    clientView: new NextClientViewPage(page),
    loans: new NextLoansPage(page),
  };
}

/** The path of the capture this test's record will declare, written once. {@link CaptureSession.write} settles the capture and is idempotent, so `runWorkflow` writes here (the record needs the path) and the capture's. */
async function capturePathOf(
  session: CaptureSession,
  known: string | undefined,
  testInfo: TestInfo,
): Promise<string | undefined> {
  if (known !== undefined) {
    return known;
  }
  try {
    return await session.write();
  } catch (error: unknown) {
    testInfo.annotations.push({ type: 'capture-unwritten', description: describeError(error) });
    return undefined;
  }
}

/** Attaches a failed workflow's evidence to its test. Only the two artefacts the masking writers produced are attached — the normalised capture, whose headers, bodies and ids were masked as they were recorded, and the (Rule 1 clause 9, AAP 0.10.2). */
async function attachEvidence(testInfo: TestInfo, evidence: EvidenceSink): Promise<void> {
  if (evidence.capturePath !== undefined) {
    await testInfo.attach('network-capture', {
      path: evidence.capturePath,
      contentType: 'application/json',
    });
  }
  if (evidence.recordPath !== undefined) {
    await testInfo.attach('workflow-record', {
      path: evidence.recordPath,
      contentType: 'application/json',
    });
  }
}

/** The parity suite's `test`: Playwright's own, extended with the five fixtures above (AAP 0.11.1 row 48; AAP 0.10.1 to 0.10.4). */
export const test = base.extend<ParityFixtures>({
  uiProject: async ({}, use, testInfo) => {
    await use(uiProjectOf(testInfo.project.name));
  },

  evidence: async ({}, use) => {
    await use({});
  },

  pages: async ({ page, uiProject }, use) => {
    await use(uiProject === 'legacy' ? legacyPages(page) : nextPages(page));
  },

  runDate: async ({ uiProject }, use) => {
    await use(await businessDateFor(uiProject));
  },

  capture: async ({ page, uiProject, runDate, evidence }, use, testInfo) => {
    const label = captureLabelOf(testInfo);
    evidence.captureLabel = label;
    // The capture starts before the test body and records until the body is over; the run date is handed over so every date in a payload is normalised to an offset from it (AAP 0.10.2).
    const session = startCapture(page, { project: uiProject, workflow: label, runDate });
    await use(session);
    // Stop, then assert, then write (Rule 2; AAP 0.10.2). The write happens even when the assertion throws, so a run that left the backend still leaves the evidence that shows it doing so, and the write goes through (AAP 0.10.4).
    const exchanges = session.stop();
    try {
      assertBackendHost(exchanges);
    } finally {
      evidence.capturePath = await capturePathOf(session, evidence.capturePath, testInfo);
    }
  },

  runWorkflow: async ({ uiProject, pages, page, runDate, capture, evidence }, use, testInfo) => {
    const run: RunWorkflow = async (workflowId, body) => {
      if (evidence.workflow !== undefined) {
        throw new Error(
          `this test already recorded ${evidence.workflow} through runWorkflow(): one test records one ` +
            `workflow, because a record names one capture and one end state per project and workflow ` +
            `(AAP 0.10.4).`,
        );
      }
      evidence.workflow = workflowId;
      const label = evidence.captureLabel;
      if (label !== undefined && isWorkflowId(label) && label !== workflowId) {
        testInfo.annotations.push({
          type: 'capture-name',
          description:
            `"${testInfo.title}" is named for ${label}, but runWorkflow() recorded ${workflowId}: the ` +
            `capture artefact keeps the ${label} name, and the record names it by path`,
        });
      }

      let status: WorkflowStatus = 'pass';
      let reason: string | undefined;
      let statePath: string | undefined;
      let failure: unknown;

      try {
        const artifacts = await body({ pages, page, runDate, capture });
        const targets = artifacts?.stateTargets;
        if (targets !== undefined) {
          // The end state is read only after the body succeeded: a failed workflow's state is not comparable with the other front end's (AAP 0.10.1), and the metadata that identifies the snapshot is the fixture's to supply, so a.
          const written: WrittenStateSnapshot = await captureState({
            ...targets,
            project: uiProject,
            workflow: workflowId,
            runDate: targets.runDate ?? runDate,
          });
          statePath = written.path;
          evidence.statePath = written.path;
        }
      } catch (error: unknown) {
        reason = describeError(error);
        if (uiProject === 'legacy') {
          // The archived baseline may no longer be drivable: detected, labelled and reported apart from the new app's defects, and never allowed to fail `npm run e2e` (AAP 0.10.1; AAP 0.10.3 criterion 3).
          status = 'legacy-broken';
          testInfo.annotations.push({ type: 'legacy-broken', description: reason });
        } else {
          status = 'fail';
          failure = error;
        }
      } finally {
        // Whatever happened, the record is written: a workflow with no record would read as `missing` in the report, which criterion 4 reports as a problem rather than as the outcome it was.
        evidence.capturePath = await capturePathOf(capture, evidence.capturePath, testInfo);
        const record: WorkflowRecord = {
          workflow: workflowId,
          project: uiProject,
          status,
          ...(reason === undefined ? {} : { reason }),
          ...(evidence.capturePath === undefined ? {} : { capturePath: evidence.capturePath }),
          ...(statePath === undefined ? {} : { statePath }),
        };
        evidence.recordPath = await writeWorkflowRecord(record);
      }

      if (failure !== undefined) {
        await attachEvidence(testInfo, evidence);
        // The original error, unchanged and with its stack: `npm run e2e` only exits non-zero when the spec itself fails (AAP 0.10.3 criterion 3).
        throw failure;
      }
    };
    await use(run);
  },
});

