/**
 * The single Playwright fixture the whole legacy-versus-next parity suite is written against
 * (AAP 0.11.1 row 48, "page-object selection per project and the host assertion"; AAP 0.8.1 tree
 * `web-ng/e2e/fixtures/`; AAP 0.10.1; AAP 0.10.2; AAP 0.10.3 criteria 3 and 4; AAP 0.10.4;
 * AAP 0.14.2).
 *
 * One spec set drives two front ends. `e2e/playwright.config.ts` declares the untouched AngularJS
 * `legacy` baseline and this `next` application as two Playwright projects, and every spec under
 * `e2e/specs/` imports `test` and `expect` from this module, so a spec drives a screen through
 * {@link ParityPages} and never names a side. That is why this file is the only place in the harness
 * that knows which front end is under test: {@link ParityFixtures.uiProject} reads the project name
 * once and refuses any project the two-project contract does not declare.
 *
 * The fixtures a spec may ask for:
 *
 * | Fixture | What it is |
 * |---|---|
 * | `uiProject` | `legacy` or `next`, taken from the Playwright project |
 * | `pages` | the five page objects of the running side, tagged with the project they drive |
 * | `runDate` | the tenant's business date read over the API, never the browser clock |
 * | `capture` | the running network capture of the test's page, masked as it records |
 * | `runWorkflow` | `runWorkflow(id, body)` — run one workflow and record its verdict |
 *
 * {@link RunWorkflow} is where the parity verdicts are made (AAP 0.10.1; AAP 0.10.3 criterion 3):
 * a body that returns is `pass`; a body that throws on the `legacy` project is `legacy-broken`,
 * annotated on the test and left green, because the archived baseline may simply no longer be
 * drivable and that must never fail `npm run e2e`; the same throw on `next` is `fail`, carries the
 * masked evidence and is rethrown unchanged so the command exits non-zero. One record per project and
 * workflow is written either way (AAP 0.10.4), and the cross-UI comparison stays in
 * `e2e/report/parity-report.ts`: this module never writes `intentional-diff`, which the report derives
 * from the AAP 0.10.5 register.
 *
 * {@link assertBackendHost} discharges Rule 2 for the harness: every `/fineract-provider/` exchange a
 * run captured must carry the origin of `FINERACT_URL`, and no exchange may address a public demo
 * host. Static assets are excluded from it exactly as AAP 0.10.2 excludes them from the comparison,
 * and it runs in the capture's own teardown so a violation fails the test that owns it.
 *
 * Import-time discipline (AAP 0.10.3 criterion 3): `npx playwright test --list` must exit 0 with no
 * environment variable set and no backend running, so the module-level statements here are only the
 * imports, the demo-host tuple, the run-date cache and the `base.extend()` call. Every environment
 * value, credential, business date, page object and capture is resolved inside a fixture. Nothing here
 * reads a credential: the page objects sign in through the application's own login screen, and no
 * header, authentication key, password or session value is ever logged, annotated, attached or
 * serialised by this file (Rule 1 clause 9).
 */
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
import { SavingsPage as LegacySavingsPage } from '../pages/legacy/savings.page';
import { ClientViewPage as NextClientViewPage } from '../pages/next/client-view.page';
import { ClientsPage as NextClientsPage } from '../pages/next/clients.page';
import { LoansPage as NextLoansPage } from '../pages/next/loans.page';
import { LoginPage as NextLoginPage } from '../pages/next/login.page';
import { SavingsPage as NextSavingsPage } from '../pages/next/savings.page';
import { WORKFLOW_IDS, redactEntryLocation, writeWorkflowRecord } from '../report/parity-report';
import type { UiProject, WorkflowId, WorkflowRecord, WorkflowStatus } from '../report/parity-report';
import { FINERACT_URL, readBusinessDate, resetBusinessDateCache } from '../seed/fixtures';

/**
 * Playwright's own `expect`, re-exported unchanged so a spec imports `test` and `expect` from one
 * module (Rule 1 clause 8: every spec asserts through it).
 */
export { expect };

/**
 * The verdict vocabulary and the project names, re-exported as types so a spec needs no second import
 * for the vocabulary its workflow ids and statuses are written in (AAP 0.10.4).
 */
export type { UiProject, WorkflowId, WorkflowStatus } from '../report/parity-report';

/**
 * The five page objects of the running front end, one accessor per screen family, tagged with the
 * project they drive.
 *
 * A spec calls one method name on `pages` and the fixture has already chosen the implementation, so a
 * body that drives a screen the same way on both sides names no side at all. The two folders export
 * structurally compatible but differently named reader interfaces — `StatusSwatchSummary` beside
 * `StatusSwatchView`, `ClientViewHeader` beside `ClientHeaderView` — which is why no reader interface is
 * named here: the union of the class types is what type-checks a call against both projects, so a member
 * a spec cannot call on both sides fails to compile instead of failing at run time.
 *
 * The variants are discriminated by {@link LegacyParityPages.uiProject} because one family of payloads
 * genuinely differs between the sides: a form value carries its dates as the `Date` objects the legacy
 * jQuery datepicker takes, while the new app's native date input takes the `yyyy-mm-dd` string the spec
 * derives from the tenant's business date (AAP 0.10.5 items 1 and 2). A union call would demand a value
 * that satisfies both, which no date does, so a spec branches once — `if (pages.uiProject === 'legacy')`
 * — and each branch then sees the concrete class with its own payload type. Every other member is called
 * on the union directly, with no branch and no cast.
 */
export type ParityPages = LegacyParityPages | NextParityPages;

/** The legacy baseline's five page objects, tagged with the project they drive. */
export interface LegacyParityPages {
  /** The discriminant of {@link ParityPages}: these objects drive the AngularJS baseline. */
  readonly uiProject: 'legacy';
  /** Login screen, the entry point of W1 (AAP 0.10.1). */
  readonly login: LegacyLoginPage;
  /** Client list, its search, the create and edit forms and the lifecycle action forms. */
  readonly clients: LegacyClientsPage;
  /** One client's record: header, tabs, action group, accounts and identifiers. */
  readonly clientView: LegacyClientViewPage;
  /** The loan application, its repayment preview, the record, its actions and its charges. */
  readonly loans: LegacyLoansPage;
  /** The savings application, its record and its actions (Stretch, W8). */
  readonly savings: LegacySavingsPage;
}

/** The new application's five page objects, tagged with the project they drive. */
export interface NextParityPages {
  /** The discriminant of {@link ParityPages}: these objects drive this application. */
  readonly uiProject: 'next';
  /** Login screen, the entry point of W1 (AAP 0.10.1). */
  readonly login: NextLoginPage;
  /** Client list, its search, the create and edit forms and the lifecycle action forms. */
  readonly clients: NextClientsPage;
  /** One client's record: header, tabs, action group, accounts and identifiers. */
  readonly clientView: NextClientViewPage;
  /** The loan application, its repayment preview, the record, its actions and its charges. */
  readonly loans: NextLoansPage;
  /** The savings application, its record and its actions (Stretch, W8). */
  readonly savings: NextSavingsPage;
}

/** What a {@link WorkflowBody} is handed: the running side's screens, page, run date and capture. */
export interface WorkflowTools {
  /** The five page objects of the running front end. */
  readonly pages: ParityPages;
  /** The test's own Playwright page, for the navigation a page object does not wrap. */
  readonly page: Page;
  /** The tenant's business date (AAP 0.10.1): the reference every workflow date is an offset from. */
  readonly runDate: Date;
  /** The running capture, so a body can read what it has recorded so far. */
  readonly capture: CaptureSession;
}

/**
 * What a {@link WorkflowBody} may return: the backend end state to snapshot once it succeeded.
 *
 * Every field of {@link StateTargets} is optional here because a body knows only the ids its own
 * workflow created; the fixture supplies `project`, `workflow` and `runDate` itself, so a spec cannot
 * mislabel the snapshot it asks for — and cannot leave a required field unset. A body that returns
 * nothing records no end state, which is the right shape for a workflow with no comparable outcome.
 */
export interface WorkflowArtifacts {
  /** Client, loan and savings ids whose end state should be read after the body returns. */
  readonly stateTargets?: Partial<StateTargets>;
}

/** The body of one workflow: the work a spec performs between entry and its end state. */
export type WorkflowBody = (tools: WorkflowTools) => Promise<WorkflowArtifacts | void>;

/**
 * `runWorkflow(id, body)` — the fixture value a spec calls to run one workflow (AAP 0.10.1).
 *
 * It records exactly one `WorkflowRecord` per project and workflow id, whatever the outcome, and it
 * decides the verdict from the project and from whether the body threw (see the module doc).
 */
export type RunWorkflow = (workflowId: WorkflowId, body: WorkflowBody) => Promise<void>;

/**
 * Per-test paths and facts the fixtures share: the capture names itself at setup, `runWorkflow` writes
 * the artefacts and the record, and the capture's teardown fills in the path it wrote when the body
 * never got that far. It is a fixture rather than a module-level variable so that two tests running in
 * one worker can never see each other's evidence.
 *
 * Internal to this module: a spec never asks for it, and it is exported only because
 * {@link ParityFixtures} names it.
 */
export interface EvidenceSink {
  /** Workflow label the capture artefact is named for, decided at setup from the test's identity. */
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

/** Every fixture this module provides, in the order a reader meets them. */
export interface ParityFixtures {
  /** Which front end the Playwright project drives (AAP 0.8.2). */
  uiProject: UiProject;
  /** The five page objects of that front end. */
  pages: ParityPages;
  /** The tenant's business date read over the API (Rule 1 clause 2; AAP 0.10.1 "Run date"). */
  runDate: Date;
  /** The running, masked capture of the test's page (AAP 0.10.2; Rule 1 clause 9). */
  capture: CaptureSession;
  /** Runs one workflow and records its verdict (AAP 0.10.4). */
  runWorkflow: RunWorkflow;
  /** Internal: the per-test evidence sink. */
  evidence: EvidenceSink;
}

/**
 * Public demo Fineract hosts Rule 2 forbids either front end from addressing, given label by label.
 *
 * Written as fragments on purpose: the tree-wide gate in `tools/parity/check-endpoints.ts` fails the
 * build on a demo host written out in full, anywhere in the tree and in comments alike, so spelling one
 * here would make this gate trip the other. The tuple holds the two hostnames the rule names and
 * nothing else; it is a host denylist, not a credential, which is why it may live at module level.
 */
const DEMO_HOSTNAMES: readonly string[] = [
  ['demo', 'mifos', 'io'].join('.'),
  ['demo', 'fineract', 'dev'].join('.'),
];

/**
 * The run date already resolved for each front end. AAP 0.10.4 runs the legacy project and then the
 * next one in a single command, so the date is memoised per project and re-read once per project: a
 * business date that rolled over between the two runs is then picked up instead of being dated from
 * the other UI's run. The map holds a promise, never a credential, and no work starts until the first
 * fixture asks for it, which is what keeps `--list` free of import-time effects.
 */
const RUN_DATES = new Map<UiProject, Promise<Date>>();

/**
 * The hostname of an origin, or `null` when the origin is not a URL this module can read. A capture
 * records the origin a browser reported, so a value that does not parse is attributed to no host
 * rather than failing the run over it.
 *
 * @param origin Origin recorded on an exchange, e.g. `https://localhost:8443`.
 */
function hostnameOf(origin: string): string | null {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

/**
 * Fails when a capture left the configured backend, which is Rule 2's gate for the harness.
 *
 * Two violations are checked, and the first offending exchange ends the check with one message rather
 * than an aggregate:
 *
 * 1. any exchange whose path is a Fineract API call must carry the origin of `FINERACT_URL`. The
 *    legacy app falls back to a public demo server when its page URL carries neither `baseApiUrl` nor
 *    `tenantIdentifier` (AAP 0.3.4), so this is the assertion that proves a run measured the intended
 *    backend rather than the demo one.
 * 2. no exchange may address a public demo host at all (Rule 2).
 *
 * Static assets are skipped first, because AAP 0.10.2 excludes them from the comparison and from this
 * assertion: a font served from a CDN says nothing about which Fineract a run used. `FINERACT_URL` is
 * read here rather than at module level, so a malformed value fails the test that owns the capture
 * instead of breaking the module import that `npx playwright test --list` performs.
 *
 * @param exchanges The exchanges one capture recorded, in the order the page issued them.
 * @throws Error naming the method, the path, the origin seen and the origin required, or the demo host
 * that was addressed. It carries no header, body or credential (Rule 1 clause 9).
 */
export function assertBackendHost(exchanges: readonly NormalizedExchange[]): void {
  const expectedOrigin = new URL(FINERACT_URL).origin;
  // Held here rather than at module level to keep the module's declarations to the four AAP 0.10.3
  // criterion 3 allows; a pattern is rebuilt per capture, which costs nothing next to the run.
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

/**
 * The front end a Playwright project drives (AAP 0.8.2's two projects), refusing any other project.
 *
 * A third project would bypass every verdict rule in {@link RunWorkflow} — neither a legacy baseline
 * to label `legacy-broken` nor a `next` application to fail — so it is rejected here, loudly and by
 * name, rather than being treated as one of the two.
 *
 * @param projectName `testInfo.project.name` as Playwright reports it.
 * @throws Error naming the unexpected project.
 */
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

/** Whether a label is one of the nine workflow ids (AAP 0.8.2, AAP 0.10.4). */
function isWorkflowId(value: string): value is WorkflowId {
  // The tuple is widened to `readonly string[]` for the membership test only: its own element type
  // would let `includes` accept nothing but a WorkflowId, which is the thing being established.
  return (WORKFLOW_IDS as readonly string[]).includes(value);
}

/**
 * The workflow label the capture artefact is named for.
 *
 * `startCapture()` fixes a capture's name when it starts, and the capture here starts in a fixture —
 * before the spec has called {@link RunWorkflow} with the id it records. The label is therefore read
 * from the test's own identity: a workflow id in the test title first, then one in the spec file's
 * name (`w3-clients`, `chain-w2-w4-w5-w6`), which are the names AAP 0.11.1 gives the specs; and
 * otherwise the title with the test's own line, so each test keeps a capture file of its own instead
 * of any two workflows sharing one. The record names its capture by absolute path, so the report never
 * depends on this label: it exists so the artefact a person opens is recognisable.
 *
 * @param testInfo The current test, whose third fixture argument is the only place its identity is
 * readable at setup.
 */
function captureLabelOf(testInfo: TestInfo): string {
  const workflowToken = /(?:^|[^A-Z0-9])(W[1-8]|CHAIN)(?![A-Z0-9])/;
  const specName = (testInfo.file.split(/[\\/]/).pop() ?? '').replace(/\.spec\.ts$/i, '');
  for (const candidate of [testInfo.title, specName]) {
    const found = workflowToken.exec(candidate.toUpperCase())?.[1];
    if (found !== undefined) {
      return found;
    }
  }
  return `${testInfo.title} ${testInfo.line}`.trim();
}

/**
 * The run date of one front end's run: the tenant's business date read over the API (Rule 1 clause 2;
 * AAP 0.10.1 "Run date"), never the browser clock, memoised per project.
 *
 * The seed module caches the business date for the life of the process, so the first read of each
 * project's run starts from a discarded cache: `npm run e2e` drives the two projects one after the
 * other (AAP 0.10.4), and a date that rolled over in between belongs to the later run. A read that
 * fails is evicted so the failure lands on the test that caused it instead of poisoning every later
 * test with the same rejection.
 *
 * @param project Front end whose run the date belongs to.
 * @throws The seed module's own error when Fineract cannot answer, naming the endpoint and the status.
 */
async function businessDateFor(project: UiProject): Promise<Date> {
  const known = RUN_DATES.get(project);
  if (known !== undefined) {
    return new Date((await known).getTime());
  }
  resetBusinessDateCache();
  const pending = readBusinessDate();
  RUN_DATES.set(project, pending);
  try {
    // A copy goes to the caller: a workflow that shifted the date it was handed must not move the run
    // date every later comparison is measured against.
    return new Date((await pending).getTime());
  } catch (error: unknown) {
    RUN_DATES.delete(project);
    throw error;
  }
}

/**
 * What a thrown value says, as the non-empty text a verdict's `reason` must carry (AAP 0.10.4's
 * `legacy-broken` record is unreadable without one). A value that is not an `Error`, and an `Error`
 * whose message is blank, both get text a reader can act on rather than an empty reason.
 *
 * The text is masked before it is returned, because the two channels it feeds are both output: the
 * record's `reason`, which reaches `parity-report.md`, `parity-report.json` and the record artefact, and
 * the annotation pushed onto the test. A page object's own message quotes the entry URL it opened, which
 * carries `?baseApiUrl=<FINERACT_URL>&tenantIdentifier=<TENANT_ID>`, so the values are replaced by the
 * mask AAP 0.10.2 uses while the sentence, the call and the status it names survive (Rule 1 clause 9;
 * AAP 0.10.4 keeps the tenant identifier out of the credential gate, so masking is what protects it).
 */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const text = message.trim().length > 0 ? message : 'the workflow failed without a message';
  return redactEntryLocation(text);
}

/** The legacy baseline's five page objects, all driving one page. */
function legacyPages(page: Page): LegacyParityPages {
  return {
    uiProject: 'legacy',
    login: new LegacyLoginPage(page),
    clients: new LegacyClientsPage(page),
    clientView: new LegacyClientViewPage(page),
    loans: new LegacyLoansPage(page),
    savings: new LegacySavingsPage(page),
  };
}

/** The new application's five page objects, all driving one page. */
function nextPages(page: Page): NextParityPages {
  return {
    uiProject: 'next',
    login: new NextLoginPage(page),
    clients: new NextClientsPage(page),
    clientView: new NextClientViewPage(page),
    loans: new NextLoansPage(page),
    savings: new NextSavingsPage(page),
  };
}

/**
 * The path of the capture this test's record will declare, written once.
 *
 * {@link CaptureSession.write} settles the capture and is idempotent, so `runWorkflow` writes here (the
 * record needs the path) and the capture's teardown writes the same file again with the same content.
 * A filesystem failure is annotated rather than thrown: a workflow that behaved correctly must not be
 * failed over an unwritable artefact, and the record then carries no `capturePath`, which the report
 * reports as the missing artefact it is.
 *
 * @param session The running capture.
 * @param known Path already written in this test, reused when there is one.
 * @param testInfo Current test, whose annotations note a capture that could not be written.
 */
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

/**
 * Attaches a failed workflow's evidence to its test.
 *
 * Only the two artefacts the masking writers produced are attached — the normalised capture, whose
 * headers, bodies and ids were masked as they were recorded, and the record itself. No page content, no
 * request dump and no storage value is attached, so nothing a reader opens can hold a credential
 * (Rule 1 clause 9; AAP 0.10.2 "Session and auth material").
 *
 * @param testInfo Current test.
 * @param evidence Paths the artefacts were written to.
 */
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

/**
 * The parity suite's `test`: Playwright's own, extended with the five fixtures above (AAP 0.11.1 row
 * 48; AAP 0.10.1 to 0.10.4).
 *
 * A spec imports `test` and `expect` from here and nothing else, so it runs unchanged against both
 * projects and never learns which front end it is driving. Teardown order matters and is Playwright's:
 * the capture was instantiated first, so it is torn down last — after the test's own outcome is known
 * and after `runWorkflow` has written its record — which is exactly where the backend-host assertion
 * belongs, because a violation invalidates the run rather than the workflow.
 */
export const test = base.extend<ParityFixtures>({
  uiProject: async ({}, use, testInfo) => {
    await use(uiProjectOf(testInfo.project.name));
  },

  // The sink is created empty per test: the capture labels itself, runWorkflow fills in the artefact
  // paths, and the capture's teardown supplies the path when the test never reached runWorkflow.
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
    // The capture starts before the test body and records until the body is over; the run date is
    // handed over so every date in a payload is normalised to an offset from it (AAP 0.10.2).
    const session = startCapture(page, { project: uiProject, workflow: label, runDate });
    await use(session);
    // Stop, then assert, then write (Rule 2; AAP 0.10.2). The write happens even when the assertion
    // throws, so a run that left the backend still leaves the evidence that shows it doing so, and
    // the write goes through `capturePathOf`, the guard `runWorkflow` uses: a filesystem failure is
    // annotated on this test rather than thrown, so a workflow that behaved correctly is not failed
    // over an artefact that could not be written (AAP 0.10.2; AAP 0.10.4).
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
        // Annotated, never thrown: the record addresses its capture by absolute path, so a differently
        // named file costs a reader some confusion and nothing else, and a workflow that behaved
        // correctly is never failed over an artefact's name (Rule 1 clauses 3 and 8).
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
          // The end state is read only after the body succeeded: a failed workflow's state is not
          // comparable with the other front end's (AAP 0.10.1), and the metadata that identifies the
          // snapshot is the fixture's to supply, so a body cannot mislabel it.
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
          // The archived baseline may no longer be drivable: detected, labelled and reported apart from
          // the new app's defects, and never allowed to fail `npm run e2e` (AAP 0.10.1; AAP 0.10.3
          // criterion 3). The test stays green and the verdict is on the record.
          status = 'legacy-broken';
          testInfo.annotations.push({ type: 'legacy-broken', description: reason });
        } else {
          status = 'fail';
          failure = error;
        }
      } finally {
        // Whatever happened, the record is written: a workflow with no record would read as `missing`
        // in the report, which criterion 4 reports as a problem rather than as the outcome it was.
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
        // The original error, unchanged and with its stack: `npm run e2e` only exits non-zero when the
        // spec itself fails (AAP 0.10.3 criterion 3).
        throw failure;
      }
    };
    await use(run);
  },
});

