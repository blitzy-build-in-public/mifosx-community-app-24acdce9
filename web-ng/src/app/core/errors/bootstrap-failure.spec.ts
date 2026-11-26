import { beforeEach, describe, expect, it } from 'vitest';

import { renderBootstrapFailure } from './bootstrap-failure';

/** Behaviour spec for `core/errors/bootstrap-failure.ts`, the one surface a failed bootstrap reaches a reader through (QA finding qa-config-failure-blank-page; Rule 1 clause 8, AAP 0.14.2 "Test coverage"). */

/** The sentence the block shows when the rejection carries no message of its own. */
const FALLBACK_SENTENCE =
  'The application could not start and the browser console holds the details of the failure.';

/** The heading the block carries, pinned for the same reason. */
const FAILURE_HEADING = 'Mifos X cannot start';

/** The diagnostic `AppConfigService.load()` rejects with when the served file lacks `apiBaseUrl`, quoted as the text the page has to carry. */
const CONFIG_MESSAGE =
  "Invalid configuration in assets/config.json: 'apiBaseUrl' must be a non-empty string.";

/** The message extraction, as one parameterized case: the label the case reports itself under, the rejection, and the text the page must then show. */
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

/** The one surface a failed bootstrap reaches a reader through: the block `web-ng/src/main.ts` renders into the `app-root` host when `bootstrapApplication`'s promise rejects, so a deployment whose configuration cannot be. */
describe('renderBootstrapFailure', () => {
  beforeEach(() => {
    // Every case starts from the document the application ships — one empty `app-root` host and nothing else — so no case can pass on a block an earlier one rendered.
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
    // A document of its own, so the fallback is exercised on a page that has no host at all rather than on one whose host a case removed.
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
    // No host and no body, so the insertion itself cannot happen. The cast is the one boundary where a partial object stands in for the platform `Document`, of which the module reads only `querySelector`, `body` (Rule 1 clause 4).
    const unusable = { querySelector: (): null => null, body: null } as unknown as Document;

    expect(() => renderBootstrapFailure(new Error(CONFIG_MESSAGE), unusable)).not.toThrow();
  });
});
