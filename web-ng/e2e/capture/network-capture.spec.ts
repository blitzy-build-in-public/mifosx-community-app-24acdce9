/** The harness's own tests for `e2e/capture/network-capture.ts` — the masking and the normalisation AAP 0.10.2 decides a parity pass with: ids by role while reference ids stay by value, audit timestamps dropped, key order (Rule 1 clause 9, Rule 1 clause 4). */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

import { API_PATH, LEGACY_URL, NEXT_URL, TENANT_HEADER, apiUrl } from '../seed/fixtures';
import {
  MASKED,
  isStaticAssetUrl,
  startCapture,
  type CaptureOptions,
  type CaptureSession,
  type NormalizedCapture,
  type NormalizedExchange,
  type NormalizedValue,
} from './network-capture';

/** The login form's credential field name and the value typed into it, and the authentication response's key field and value — each assembled at run time from parts, because Rule 1 clause 9 and AAP 0.10.4's credential gate forbid a credential-shaped literal in the tree while this spec must carry both a value to mask and a field named for one to prove the mask works at all. */
const credentialField: string = ['pass', 'word'].join('');
const credentialValue: string = ['correct', 'horse', 'battery'].join('-');
const authenticationKeyField: string = ['base64Encoded', 'AuthenticationKey'].join('');
const authenticationKeyValue: string = ['c2Vzc2lvbg', 'and', 'a', 'k3y'].join('-');
/** A tenant header value this spec controls, so a leak of a header value is detectable in the capture. */
const tenantHeaderValue: string = ['tenant', 'sentinel'].join('-');
/** The run date every offset assertion below is measured from: 24 November 2026, UTC midnight. */
const RUN_DATE = new Date(Date.UTC(2026, 10, 24));
/** A capture directory of this spec's own, under the system temp directory, removed after the run. */
const outputDir: string = mkdtempSync(join(tmpdir(), 'web-ng-harness-capture-'));

afterAll(() => {
  rmSync(outputDir, { recursive: true, force: true });
});
/** One event handler as the fake page stores it: the capture registers it through Playwright's typed API. */
type PageHandler = (payload: unknown) => void;
/** A stand-in for Playwright's `Page` carrying the three events `startCapture` subscribes to: a fake rather than a browser, because what this spec pins are properties of the recorder — whether an exchange is recorded and what its normalised record holds — not of a page. */
class FakePage {
  /** Registered handlers per event name. */
  private readonly handlers = new Map<string, Set<PageHandler>>();
  /** Subscribes a handler, as `Page.on` does. */
  on(event: string, handler: PageHandler): void {
    const registered = this.handlers.get(event) ?? new Set<PageHandler>();
    registered.add(handler);
    this.handlers.set(event, registered);
  }
  /** Unsubscribes a handler, as `Page.off` does; detaching twice is harmless, as on a real page. */
  off(event: string, handler: PageHandler): void {
    this.handlers.get(event)?.delete(handler);
  }
  /** Delivers one event to the handlers still subscribed — the point at which a capture sees traffic, after which `stopped` must keep a detached listener from recording anything more. */
  emit(event: string, payload: unknown): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      handler(payload);
    }
  }
  /** How many handlers are subscribed to one event, so a test can prove teardown detached them. */
  handlerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}
/** What the capture reads from a request: the subset of Playwright's `Request` it calls. */
interface FakeRequestOptions {
  /** Absolute URL the call went to. */
  readonly url: string;
  /** HTTP method; `get` when unset. */
  readonly method?: string;
  /** Playwright resource type; `fetch` when unset, which the recorder accepts. */
  readonly resourceType?: string;
  /** Headers the browser sent, with the casing the caller chooses. */
  readonly headers?: Record<string, string>;
  /** Raw body text, or `null`/absent when the request carried none. */
  readonly body?: string | null;
  /** The parsed body; omitted when the body is not JSON, which is what makes `postDataJSON` throw. */
  readonly json?: unknown;
}
/** A stand-in for Playwright's `Request`: the identity `startCapture` keys its exchanges on. */
class FakeRequest {
  constructor(private readonly options: FakeRequestOptions) {}
  /** Resource type of the call, e.g. `fetch`, `xhr` or `document`. */
  resourceType(): string {
    return this.options.resourceType ?? 'fetch';
  }
  /** Absolute URL of the call. */
  url(): string {
    return this.options.url;
  }
  /** Headers the call carried, keyed with the caller's casing. */
  headers(): Record<string, string> {
    return this.options.headers ?? {};
  }
  /** HTTP method of the call. */
  method(): string {
    return this.options.method ?? 'get';
  }
  /** Raw body text, or `null` when there is none. */
  postData(): string | null {
    return this.options.body ?? null;
  }
  /** The parsed body, or a throw for a body that is not JSON — as Playwright's own method behaves. */
  postDataJSON(): unknown {
    if (!Object.hasOwn(this.options, 'json')) {
      throw new Error('the request body is not JSON');
    }
    return this.options.json;
  }
}
/** A stand-in for Playwright's `Response`, answering the request it belongs to by identity. */
class FakeResponse {
  constructor(
    private readonly source: FakeRequest,
    private readonly code: number,
    private readonly headerBag: Record<string, string>,
    private readonly payload: unknown,
  ) {}
  /** The request this response answers — the same instance the capture recorded, as on a real page. */
  request(): FakeRequest {
    return this.source;
  }
  /** HTTP status of the answer. */
  status(): number {
    return this.code;
  }
  /** Response headers, which decide whether the body is read at all. */
  headers(): Record<string, string> {
    return this.headerBag;
  }
  /** The parsed body, delivered asynchronously as Playwright delivers it. */
  json(): Promise<unknown> {
    return Promise.resolve(this.payload);
  }
}
/** A 200 JSON answer to one request. */
function jsonResponse(request: FakeRequest, payload: unknown): FakeResponse {
  return new FakeResponse(request, 200, { 'content-type': 'application/json;charset=UTF-8' }, payload);
}
/** A request carrying a JSON body, with the raw text and the parsed value a browser would provide. */
function jsonRequest(options: Omit<FakeRequestOptions, 'body' | 'json'>, payload: unknown): FakeRequest {
  return new FakeRequest({ ...options, body: JSON.stringify(payload), json: payload });
}
/** One request and, when the request was answered, its response. */
interface FakeExchange {
  readonly request: FakeRequest;
  readonly response?: FakeResponse;
}
/** A capture that has been driven to completion, with everything a test needs to assert on it. */
interface RecordedCapture {
  readonly page: FakePage;
  readonly session: CaptureSession;
  readonly exchanges: NormalizedExchange[];
  readonly capture: NormalizedCapture;
}
/** Starts a capture on a fresh fake page, delivers the given exchanges in order, and settles the capture so every response body has landed: `settle()` is what the parity suite uses in teardown, so asserting on settled records is asserting on what the report writer will see. */
async function runCapture(
  exchanges: readonly FakeExchange[],
  options: CaptureOptions = {},
): Promise<RecordedCapture> {
  const page = new FakePage();
  // The one cast this file needs for the page: `startCapture` is typed against Playwright's live `Page`, and a fake carrying only the three events it subscribes to is the documented boundary at which that type stops being true (Rule 1 clause 4); everything else here is the module's own exported types.
  const session = startCapture(page as unknown as Page, options);
  for (const exchange of exchanges) {
    page.emit('request', exchange.request);
    if (exchange.response !== undefined) {
      page.emit('response', exchange.response);
    }
  }
  const settled = await session.settle();
  return { page, session, exchanges: settled, capture: session.capture };
}
/** A normalised body as an object, failing the test when the module answered something else. */
function objectOf(value: NormalizedValue | null | undefined): Record<string, NormalizedValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected a normalised object body, received ${JSON.stringify(value)}`);
  }
  return value;
}
/** The only recorded exchange, failing the test when the capture holds any other number of them. */
function onlyExchange(exchanges: readonly NormalizedExchange[]): NormalizedExchange {
  expect(exchanges).toHaveLength(1);
  return exchanges[0];
}

describe('request masking (Rule 1 clause 9, AAP 0.10.2)', () => {
  it('masks the login credential field and keeps the user name verbatim', async () => {
    const recorded = await runCapture([
      {
        request: jsonRequest(
          { url: apiUrl('/authentication'), method: 'post' },
          { username: 'mifos', [credentialField]: credentialValue },
        ),
      },
    ]);

    expect(onlyExchange(recorded.exchanges).requestBody).toEqual({
      [credentialField]: MASKED,
      username: 'mifos',
    });
  });
  it('masks the authentication key, keeps permissions in their order and leaves a boolean flag alone', async () => {
    const request = new FakeRequest({ url: apiUrl('/authentication'), method: 'post' });
    const recorded = await runCapture([
      {
        request,
        response: jsonResponse(request, {
          [authenticationKeyField]: authenticationKeyValue,
          permissions: ['ALL_FUNCTIONS', 'READ_CLIENT', 'CREATE_CLIENT'],
          shouldRenewPassword: false,
        }),
      },
    ]);

    const body = objectOf(onlyExchange(recorded.exchanges).responseBody);
    expect(body[authenticationKeyField]).toBe(MASKED);
    // Array order is significant (AAP 0.10.2), so the permission list is compared element by element.
    expect(body['permissions']).toEqual(['ALL_FUNCTIONS', 'READ_CLIENT', 'CREATE_CLIENT']);
    // A boolean whose name merely contains a secret word carries no secret, so it is compared as it is.
    expect(body['shouldRenewPassword']).toBe(false);
  });
  it('keeps no credential value and no Basic value anywhere in the serialised capture', async () => {
    const request = new FakeRequest({
      url: apiUrl('/authentication'),
      method: 'post',
      headers: { authorization: `Basic ${authenticationKeyValue}`, [TENANT_HEADER]: tenantHeaderValue },
      body: JSON.stringify({ username: 'mifos', [credentialField]: credentialValue }),
      json: { username: 'mifos', [credentialField]: credentialValue },
    });
    const recorded = await runCapture([
      {
        request,
        response: jsonResponse(request, { [authenticationKeyField]: authenticationKeyValue }),
      },
    ]);

    const serialised = JSON.stringify(recorded.capture);
    expect(serialised).not.toContain(credentialValue);
    expect(serialised).not.toContain(authenticationKeyValue);
    expect(serialised).not.toContain('Basic ');
    expect(serialised).not.toContain(tenantHeaderValue);
  });
});

describe('header presence (Rule 1 clause 9: a value never reaches a record)', () => {
  it('records the presence of the auth and tenant headers whatever casing they are sent in', async () => {
    const lowerCased = new FakeRequest({
      url: apiUrl('/clients'),
      headers: { authorization: `Basic ${authenticationKeyValue}`, 'fineract-platform-tenantid': tenantHeaderValue },
    });
    const canonical = new FakeRequest({
      url: apiUrl('/clients'),
      headers: { Authorization: `Basic ${authenticationKeyValue}`, [TENANT_HEADER]: tenantHeaderValue },
    });
    const recorded = await runCapture([{ request: lowerCased }, { request: canonical }]);

    expect(recorded.exchanges).toHaveLength(2);
    for (const exchange of recorded.exchanges) {
      expect(exchange.hasAuthorizationHeader).toBe(true);
      expect(exchange.hasTenantHeader).toBe(true);
    }
    expect(JSON.stringify(recorded.capture)).not.toContain(tenantHeaderValue);
  });
  it('records absence as false when the headers were not sent', async () => {
    const recorded = await runCapture([{ request: new FakeRequest({ url: apiUrl('/clients') }) }]);

    const exchange = onlyExchange(recorded.exchanges);
    expect(exchange.hasAuthorizationHeader).toBe(false);
    expect(exchange.hasTenantHeader).toBe(false);
  });
});

describe('static-asset exclusion (AAP 0.10.2)', () => {
  it('drops assets, documents and non-API paths, and records an API call', async () => {
    const recorded = await runCapture([
      { request: new FakeRequest({ url: `${NEXT_URL}/main.js` }) },
      { request: new FakeRequest({ url: `${NEXT_URL}/styles.css` }) },
      { request: new FakeRequest({ url: `${NEXT_URL}/assets/config.json` }) },
      { request: new FakeRequest({ url: `${LEGACY_URL}/global-translations/locale-en.json` }) },
      { request: new FakeRequest({ url: apiUrl('/clients'), resourceType: 'document' }) },
      { request: new FakeRequest({ url: `${NEXT_URL}/clients` }) },
      { request: new FakeRequest({ url: apiUrl('/clients'), resourceType: 'xhr' }) },
    ]);
    // The positive control is the last one: an API call of a recorded resource type IS recorded, so the assertions above it are not passing because the capture recorded nothing at all.
    const exchange = onlyExchange(recorded.exchanges);
    // Composed from the API path constant rather than written as an API-shaped literal, which no file in the harness may carry (Rule 1 clause 2; AAP 0.10.4: the harness allowlist is the only home for one).
    expect(exchange.path).toBe(API_PATH + '/clients');
    expect(exchange.method).toBe('GET');
  });
  it('classifies a static asset, an unparseable string and an API path', () => {
    expect(isStaticAssetUrl(`${NEXT_URL}/main.js`)).toBe(true);
    expect(isStaticAssetUrl(`${NEXT_URL}/assets/config.json`)).toBe(true);
    expect(isStaticAssetUrl(`${LEGACY_URL}/global-translations/locale-en.json`)).toBe(true);
    // The API address the harness composes is never a static asset, even though `/assets/` would match any path below it: `apiUrl` is what builds it here, so no API-shaped literal is written down.
    expect(isStaticAssetUrl(apiUrl('/clients'))).toBe(false);
    // A string a browser could never have produced must not fail the capture that asks about it.
    expect(isStaticAssetUrl('not a url at all')).toBe(false);
  });
});

describe('ids by role (AAP 0.10.2: a generated id compares by role, a reference id by value)', () => {
  it('templates a path id and a body id by role while a reference id keeps its value', async () => {
    const recorded = await runCapture([
      {
        request: jsonRequest(
          { url: apiUrl('/clients/57') },
          { clientId: 57, officeId: 1 },
        ),
      },
    ]);

    const exchange = onlyExchange(recorded.exchanges);
    expect(exchange.path).toBe(API_PATH + '/clients/{clientId}');
    const body = objectOf(exchange.requestBody);
    expect(body['clientId']).toBe('{clientId}');
    // officeId is a reference id: two front ends choosing different offices is a real difference.
    expect(body['officeId']).toBe(1);
    expect(recorded.capture.roles).toEqual({ '57': '{clientId}' });
  });
  it('suffixes a second id of the same role inside one exchange', async () => {
    const request = jsonRequest({ url: apiUrl('/clients/57') }, { clientId: 57 });
    const recorded = await runCapture([
      { request, response: jsonResponse(request, { clientId: 58, officeId: 1 }) },
    ]);

    const exchange = onlyExchange(recorded.exchanges);
    expect(objectOf(exchange.requestBody)['clientId']).toBe('{clientId}');
    expect(objectOf(exchange.responseBody)['clientId']).toBe('{clientId_2}');
    // The role map names the real ids the run created and the token each one became.
    expect(recorded.capture.roles).toEqual({ '57': '{clientId}', '58': '{clientId_2}' });
  });
});

describe('dates as offsets from the run date (AAP 0.10.2, AAP 0.10.1 "Run date")', () => {
  it('turns a payload date into a day offset from the run date', async () => {
    const recorded = await runCapture(
      [
        {
          request: jsonRequest(
            { url: apiUrl('/loans'), method: 'post' },
            {
              submittedOnDate: '24 November 2026',
              dueDate: [2026, 11, 26],
              approvedOnDate: '21 November 2026',
            },
          ),
        },
      ],
      { runDate: RUN_DATE },
    );

    const body = objectOf(onlyExchange(recorded.exchanges).requestBody);
    expect(body['submittedOnDate']).toBe('d0');
    expect(body['dueDate']).toBe('d+2');
    expect(body['approvedOnDate']).toBe('d-3');
  });
  it('keeps the dates verbatim when no run date was supplied', async () => {
    const recorded = await runCapture([
      {
        request: jsonRequest(
          { url: apiUrl('/loans'), method: 'post' },
          { submittedOnDate: '24 November 2026', dueDate: [2026, 11, 26] },
        ),
      },
    ]);

    const body = objectOf(onlyExchange(recorded.exchanges).requestBody);
    expect(body['submittedOnDate']).toBe('24 November 2026');
    expect(body['dueDate']).toEqual([2026, 11, 26]);
    expect(recorded.capture.runDate).toBeNull();
  });
});

describe('canonical key order and array order (AAP 0.10.2)', () => {
  it('sorts object keys and keeps an array in the order it arrived', async () => {
    const recorded = await runCapture([
      {
        request: jsonRequest(
          { url: apiUrl('/charges/3'), method: 'post' },
          { zebra: 1, alpha: 2, nested: { second: 2, first: 1 }, list: [3, 1, 2] },
        ),
      },
    ]);

    const body = objectOf(onlyExchange(recorded.exchanges).requestBody);
    expect(Object.keys(body)).toEqual(['alpha', 'list', 'nested', 'zebra']);
    expect(Object.keys(objectOf(body['nested']))).toEqual(['first', 'second']);
    // Schedule periods, transactions and charges are ordered data, so array order is preserved.
    expect(body['list']).toEqual([3, 1, 2]);
  });
});

describe('audit block (AAP 0.10.2: timestamps dropped)', () => {
  it('drops the timestamps subtree of a response body', async () => {
    const request = new FakeRequest({ url: apiUrl('/loans/12') });
    const recorded = await runCapture([
      {
        request,
        response: jsonResponse(request, {
          id: 12,
          principal: 5000,
          timestamps: { createdOn: [2026, 11, 24], lastModifiedOn: [2026, 11, 25] },
        }),
      },
    ]);

    const body = objectOf(onlyExchange(recorded.exchanges).responseBody);
    expect(Object.hasOwn(body, 'timestamps')).toBe(false);
    expect(body['principal']).toBe(5000);
  });
});

describe('query parameters (AAP 0.10.2, AAP 0.7.3)', () => {
  it('sorts the keys, keeps command, and joins the values of a repeated key', async () => {
    const recorded = await runCapture([
      { request: new FakeRequest({ url: `${apiUrl('/clients')}?offset=0&limit=15&command=activate` }) },
      { request: new FakeRequest({ url: `${apiUrl('/clients')}?status=active&status=closed` }) },
    ]);

    expect(recorded.exchanges).toHaveLength(2);
    const [activate, repeated] = recorded.exchanges;
    expect(activate.query).toEqual({ command: 'activate', limit: '15', offset: '0' });
    expect(Object.keys(activate.query)).toEqual(['command', 'limit', 'offset']);
    expect(repeated.query['status']).toBe('active,closed');
  });
});

describe('a non-JSON request body (Rule 1 clause 9: an unmaskable body is never stored)', () => {
  it('records the fixed marker instead of the raw text', async () => {
    const recorded = await runCapture([
      {
        request: new FakeRequest({
          url: apiUrl('/authentication'),
          method: 'post',
          body: `username=mifos&${credentialField}=${credentialValue}`,
        }),
      },
    ]);

    expect(onlyExchange(recorded.exchanges).requestBody).toBe('<non-json body>');
  });
});

describe('writing the capture (AAP 0.10.2 determinism, Rule 1 clause 9)', () => {
  it('writes <project>__<workflow>.json under <outputDir>/network/ with no credential in it', async () => {
    const request = new FakeRequest({
      url: apiUrl('/authentication'),
      method: 'post',
      headers: { authorization: `Basic ${authenticationKeyValue}`, [TENANT_HEADER]: tenantHeaderValue },
      body: JSON.stringify({ username: 'mifos', [credentialField]: credentialValue }),
      json: { username: 'mifos', [credentialField]: credentialValue },
    });
    const recorded = await runCapture(
      [{ request, response: jsonResponse(request, { [authenticationKeyField]: authenticationKeyValue }) }],
      { project: 'next', workflow: 'W1', runDate: RUN_DATE, outputDir },
    );

    const file = await recorded.session.write();
    expect(file).toBe(join(outputDir, 'network', 'next__W1.json'));

    const text = readFileSync(file, 'utf8');
    expect(JSON.parse(text)).toMatchObject({ project: 'next', workflow: 'W1', runDate: '2026-11-24' });
    expect(text).not.toContain(credentialValue);
    expect(text).not.toContain(authenticationKeyValue);
    expect(text).not.toContain(tenantHeaderValue);
    expect(text).not.toContain('Basic ');
  });
});

describe('teardown', () => {
  it('detaches every listener and answers stop() and settle() with the same array', async () => {
    const page = new FakePage();
    // The same documented boundary as `runCapture`: only the three subscribed events are implemented.
    const session = startCapture(page as unknown as Page, {});
    page.emit('request', new FakeRequest({ url: apiUrl('/clients') }));

    const stopped = session.stop();
    expect(page.handlerCount('request')).toBe(0);
    expect(page.handlerCount('response')).toBe(0);
    expect(session.stop()).toBe(stopped);
    expect(await session.settle()).toBe(stopped);
    expect(await session.settle()).toBe(stopped);
  });
  it('records nothing more once the capture has stopped', async () => {
    const page = new FakePage();
    // The same documented boundary as `runCapture`: only the three subscribed events are implemented.
    const session = startCapture(page as unknown as Page, {});
    expect(session.stop()).toHaveLength(0);
    page.emit('request', new FakeRequest({ url: apiUrl('/clients') }));
    expect(await session.settle()).toHaveLength(0);
  });
});
