/**
 * The failure surface of a bootstrap that never completed.
 *
 * `web-ng/src/main.ts` starts the application with `bootstrapApplication`, and the initializer in
 * `web-ng/src/app/app.config.ts` awaits `AppConfigService.load()` before the first navigation. That
 * call rejects when the served `assets/config.json` cannot be read, is incomplete or holds a value
 * the application will not run on, and when a `?baseApiUrl=` or `?tenantIdentifier=` override is
 * unusable — a rejection the configuration layer documents as "the application will not start with
 * an incomplete configuration and will not substitute a default host" (AAP 0.4.4 decision 5). The
 * root component therefore never renders, and the rejection is the only thing the application has
 * left to say.
 *
 * Said only to the console it is a blank white page: an operator who opens a misconfigured
 * deployment sees nothing at all unless the diagnostic is also put into the document. This module is
 * that one surface. It renders the text the configuration service already produced into the
 * `app-root` host, in Bootstrap 3 markup the global stylesheet provides, so the report a reader gets
 * in the page and the one in devtools are the same text.
 */

/** The heading the block carries, so a reader knows the state belongs to the application. */
const FAILURE_HEADING = 'Mifos X cannot start';

/**
 * The sentence shown when the rejection carries no message of its own — a rejection with a blank
 * message included, since an empty paragraph tells a reader nothing. It states both facts the
 * reader needs and points at the place the detail actually sits.
 */
const FALLBACK_MESSAGE =
  'The application could not start and the browser console holds the details of the failure.';

/**
 * The text a bootstrap rejection is shown as: an `Error`'s own message, which is the shape every
 * configuration failure is thrown in, a non-empty string as it stands, and the fallback sentence for
 * anything else.
 *
 * The text is reproduced character for character, never trimmed, prefixed or truncated: it is the
 * diagnostic the configuration layer produced, and a reader may be comparing it with a value an
 * operator typed into `config.json` or into the page URL. Nothing is added to it and no configuration
 * value, tenant identifier or credential is read here — the message text is the whole payload.
 *
 * @param error the value `bootstrapApplication`'s promise rejected with.
 * @returns the message to show, which is never empty.
 */
function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  if (typeof error !== 'string') {
    return FALLBACK_MESSAGE;
  }

  return error.trim() === '' ? FALLBACK_MESSAGE : error;
}

/**
 * Renders a failed bootstrap into the document, so a misconfigured deployment reports itself in the
 * page instead of leaving a blank white screen (QA finding qa-config-failure-blank-page).
 *
 * **Where it renders.** The block goes inside the `app-root` host the page already declares, because
 * that is the element a reader looking at the document sees the application in. The host's existing
 * children are cleared first, so a root that began rendering before the rejection cannot sit above
 * the message and hide it. A document that carries no `app-root` host — a page whose markup was
 * edited, or a document built for a test — falls back to its `body`, so the message is never dropped
 * for want of a host.
 *
 * **How it renders.** Every node is built with `createElement` and filled with `textContent`, and no
 * markup string is ever parsed: a message can quote a status line, a key name or a URL fragment an
 * operator supplied, and text that is assigned rather than parsed cannot become an element, a script
 * or an event handler. The structure is the Bootstrap 3 the legacy look is built on — a
 * `div.container` holding a `div.alert.alert-danger` with `role="alert"` — so the block is styled by
 * the global stylesheet with no rule of its own.
 *
 * **What it must never do.** It has no failure mode of its own: when the document cannot be written
 * to — no body, a host that refuses the insertion, a document that is already gone — it returns
 * quietly rather than raising out of the bootstrap handler, where a second exception would replace
 * the diagnostics `web-ng/src/main.ts` has already recorded with a rejection nobody sees.
 *
 * @param error the value `bootstrapApplication`'s promise rejected with; any value is accepted and
 * one that carries no message is shown as the fallback sentence.
 * @param target the document to render into. The application passes none and the page's own
 * `document` is used; a caller passes one only to render into another document.
 */
export function renderBootstrapFailure(error: unknown, target: Document = document): void {
  try {
    const host: Element = target.querySelector('app-root') ?? target.body;

    // A half-rendered root would otherwise sit above the message, so the host is emptied first.
    host.replaceChildren();

    const container = target.createElement('div');
    container.className = 'container';

    const alert = target.createElement('div');
    alert.className = 'alert alert-danger';
    alert.setAttribute('role', 'alert');

    const heading = target.createElement('h1');
    heading.className = 'h4';
    heading.textContent = FAILURE_HEADING;

    const message = target.createElement('p');
    message.textContent = failureMessage(error);

    alert.append(heading, message);
    container.append(alert);
    host.append(container);
  } catch {
    // The document offers nowhere to render: it has no host and no body, or the insertion itself
    // failed. Nothing is reported here, because the console entry `web-ng/src/main.ts` made before
    // this call is already the whole record of the failure and an exception thrown here would
    // replace it with a rejection no reader sees.
  }
}
