/** The failure surface of a bootstrap that never completed. `web-ng/src/main.ts` starts the application with `bootstrapApplication`, and the initializer in `web-ng/src/app/app.config.ts` awaits `AppConfigService.load()` (AAP 0.4.4). */

/** The heading the block carries, so a reader knows the state belongs to the application. */
const FAILURE_HEADING = 'Mifos X cannot start';

/** The sentence shown when the rejection carries no message of its own — a rejection with a blank message included, since an empty paragraph tells a reader nothing. */
const FALLBACK_MESSAGE =
  'The application could not start and the browser console holds the details of the failure.';

/** The text a bootstrap rejection is shown as: an `Error`'s own message, which is the shape every configuration failure is thrown in, a non-empty string as it stands, and the fallback sentence for anything else. */
function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  if (typeof error !== 'string') {
    return FALLBACK_MESSAGE;
  }

  return error.trim() === '' ? FALLBACK_MESSAGE : error;
}

/** Renders a failed bootstrap into the document, so a misconfigured deployment reports itself in the page instead of leaving a blank white screen. The block goes inside the `app-root` host the page already declares, because that is the element a reader sees the application in; the host's existing children are cleared first, so a root that began rendering before the rejection cannot sit above the message and hide it; and a document that carries no `app-root` host — a page whose markup was edited, or a document built for a test — falls back to its `body`, so the message is never dropped for want of a host. */
export function renderBootstrapFailure(error: unknown, target: Document = document): void {
  try {
    const host: Element = target.querySelector('app-root') ?? target.body;

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
  }
}
