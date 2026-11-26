import { beforeEach, describe, expect, it } from 'vitest';

import { renderBootstrapFailure } from './bootstrap-failure';

/**
 * Behaviour spec for `core/errors/bootstrap-failure.ts`, the one surface a failed bootstrap reaches a
 * reader through (QA finding qa-config-failure-blank-page; Rule 1 clause 8, AAP 0.14.2 "Test
 * coverage").
 *
 * The finding is that every configuration failure — a served `assets/config.json` missing
 * `apiBaseUrl`, missing three keys, holding six invalid values, a non-JSON body, a 404 body, or an
 * unusable `?baseApiUrl=` — aborts bootstrap with an actionable message that reaches devtools only,
 * while `document.body` stays empty and the operator stares at a blank white page. These cases pin
 * the four things that stand between that state and a reported one:
 *
 *   - the message reaches the document, inside the `app-root` host the page declares, so the page is
 *     no longer empty;
 *   - whatever a root that began rendering left in the host is cleared first, so the block is what a
 *     reader sees rather than what is left of the root;
 *   - the block is the Bootstrap 3 danger alert with its role and heading, so the global stylesheet
 *     styles it and a screen reader announces it;
 *   - the message is inserted as text, so a diagnostic quoting a status line, a key or a value can
 *     never be parsed as markup.
 *
 * No `TestBed` is involved: the module is a plain function over a `Document`, and the unit-test
 * environment already provides the page's own `document`. The `innerText` the QA run measured is not
 * asserted, because jsdom implements `textContent` rather than `innerText`; both report the text of
 * the same nodes.
 */

/**
 * The sentence the block shows when the rejection carries no message of its own. Written out rather
 * than imported, so the spec pins the fallback's wording instead of agreeing with whatever the
 * module happens to hold.
 */
const FALLBACK_SENTENCE =
  'The application could not start and the browser console holds the details of the failure.';

/** The heading the block carries, pinned for the same reason. */
const FAILURE_HEADING = 'Mifos X cannot start';

/**
 * The diagnostic `AppConfigService.load()` rejects with when the served file lacks `apiBaseUrl`,
 * quoted as the text the page has to carry. The assertion is that the text arrives unchanged, not
 * that this particular message is produced.
 */
const CONFIG_MESSAGE =
  "Invalid configuration in assets/config.json: 'apiBaseUrl' must be a non-empty string.";

/**
 * The message extraction, as one parameterized case: the label the case reports itself under, the
 * rejection, and the text the page must then show. The fallback covers both a rejection of an
 * unexpected type and an `Error` whose message is empty, since a blank paragraph tells a reader
 * nothing.
 */
const MESSAGE_CASES: readonly (readonly [label: string, rejection: unknown, expected: string])[] = [
  ['an Error carrying a message', new Error(CONFIG_MESSAGE), CONFIG_MESSAGE],
  ['a rejection that is a string', 'The configuration file could not be read.', 'The configuration file could not be read.'],
  ['an Error carrying an empty message', new Error(''), FALLBACK_SENTENCE],
  ['a rejection of an unexpected type', { reason: 'unknown' }, FALLBACK_SENTENCE],
];

/** The page's `app-root` host, which is the element the block belongs in. */
const appRoot = (): Element | null => document.querySelector('app-root');

/** The rendered danger block, or null when nothing was rendered. */
const dangerBlock = (): Element | null => document.querySelector('.alert-danger');

/** The paragraph carrying the message, or null when nothing was rendered. */
const messageParagraph = (): Element | null | undefined => dangerBlock()?.querySelector('p');

/**
 * The one surface a failed bootstrap reaches a reader through: the block `web-ng/src/main.ts`
 * renders into the `app-root` host when `bootstrapApplication`'s promise rejects, so a deployment
 * whose configuration cannot be resolved reports itself in the page instead of leaving a blank white
 * screen. Each case below states one property that surface has to keep.
 */
describe('renderBootstrapFailure', () => {
  beforeEach(() => {
    // Every case starts from the document the application ships — one empty `app-root` host and
    // nothing else — so no case can pass on a block an earlier one rendered.
    document.body.replaceChildren();
    document.body.append(document.createElement('app-root'));
  });

  it('renders the message inside the app-root host, so the page carries text instead of nothing', () => {
    // The finding's own assertion, stated the other way round first: the page is empty before.
    expect(document.body.textContent?.trim()).toBe('');

    renderBootstrapFailure(new Error(CONFIG_MESSAGE));

    expect(appRoot()?.textContent).toContain(CONFIG_MESSAGE);
    expect(document.body.textContent).toContain(CONFIG_MESSAGE);
    expect(document.body.textContent?.trim()).not.toBe('');
  });

  it('renders the Bootstrap 3 danger block with its role, its heading and the message beneath', () => {
    renderBootstrapFailure(new Error(CONFIG_MESSAGE));

    const block = dangerBlock();
    const container = block?.parentElement;
    const heading = block?.querySelector('h1');

    expect(container?.tagName).toBe('DIV');
    expect(container?.className).toBe('container');
    expect(appRoot()?.firstElementChild).toBe(container);
    expect(block?.className).toBe('alert alert-danger');
    expect(block?.getAttribute('role')).toBe('alert');
    expect(heading?.tagName).toBe('H1');
    expect(heading?.className).toBe('h4');
    expect(heading?.textContent).toBe(FAILURE_HEADING);
    // Document order: the heading first, so a reader meets the state before the detail.
    expect(block?.firstElementChild).toBe(heading);
    expect(messageParagraph()?.textContent).toBe(CONFIG_MESSAGE);
  });

  it('clears what a half-rendered root left in the host before inserting the block', () => {
    const stale = document.createElement('div');
    stale.className = 'half-rendered';
    stale.textContent = 'a root that began rendering';
    appRoot()?.append(stale);

    expect(appRoot()?.textContent).toContain('a root that began rendering');

    renderBootstrapFailure(new Error(CONFIG_MESSAGE));

    expect(document.querySelector('.half-rendered')).toBeNull();
    expect(appRoot()?.textContent).not.toContain('a root that began rendering');
    // The block is the host's whole content, not an addition to it.
    expect(appRoot()?.children).toHaveLength(1);
    expect(dangerBlock()).not.toBeNull();
  });

  it('falls back to the document body when the page carries no app-root host', () => {
    // A document of its own, so the fallback is exercised on a page that has no host at all rather
    // than on one whose host a case removed.
    const page = document.implementation.createHTMLDocument('misconfigured');

    expect(page.querySelector('app-root')).toBeNull();

    renderBootstrapFailure(new Error(CONFIG_MESSAGE), page);

    expect(page.body.textContent).toContain(CONFIG_MESSAGE);
    expect(page.body.querySelector('.alert-danger')?.getAttribute('role')).toBe('alert');
  });

  it.each(MESSAGE_CASES)('shows the text %s carries', (_label, rejection, expected) => {
    renderBootstrapFailure(rejection);

    expect(messageParagraph()?.textContent).toBe(expected);
  });

  it('inserts a message holding markup characters as text, creating no element from it', () => {
    const hostile = '<img src=x onerror=alert(1)>';

    renderBootstrapFailure(new Error(hostile));

    const paragraph = messageParagraph();

    expect(paragraph?.textContent).toBe(hostile);
    // One text node and no children: nothing in the message was parsed.
    expect(paragraph?.childNodes).toHaveLength(1);
    expect(paragraph?.children).toHaveLength(0);
    expect(document.querySelector('img')).toBeNull();
  });

  it('returns quietly when the document offers nowhere to render', () => {
    // No host and no body, so the insertion itself cannot happen. The cast is the one boundary where
    // a partial object stands in for the platform `Document`, of which the module reads only
    // `querySelector`, `body`, `createElement` and the insertion itself (Rule 1 clause 4).
    const unusable = { querySelector: (): null => null, body: null } as unknown as Document;

    expect(() => renderBootstrapFailure(new Error(CONFIG_MESSAGE), unusable)).not.toThrow();
  });
});
