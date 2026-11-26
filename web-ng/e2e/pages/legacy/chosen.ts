/** Legacy-only chosen-widget helper: legacy templates mark each dropdown with the `chosen` attribute and the plugin replaces the `<select>`, while the new app renders a native one (AAP 0.10.5 item 2), so no `pages/next/` (AAP 0.3.4). */
import type { Locator, Page } from '@playwright/test';
/** One option of the `<select>` underneath the chosen widget, so a page object can describe a dropdown. */
export interface ChosenOption {
  /** The `<option>` value, which is what the legacy form posts to Fineract. */
  value: string;
  /** The visible label, trimmed the way this helper matches it. */
  label: string;
}

/** The container chosen builds beside the `<select>`, which v1.0.0 inserts as its next sibling and hides. */
const CHOSEN_CONTAINER = 'xpath=following-sibling::div[contains(@class,"chosen-container")]';
/** The anchor that renders the current selection inside the widget: Chosen v1.0.0's `<a class="chosen-single">`. */
const CHOSEN_SINGLE = 'a.chosen-single';
/** The `<span>` inside that anchor: it alone carries the selection, the `<div><b></b></div>` beside it is the caret. */
const CHOSEN_SINGLE_LABEL = 'a.chosen-single span';
/** One selectable row in the open dropdown: `<li class="active-result">`; a disabled option is `disabled-result`. */
const CHOSEN_RESULT = '.chosen-results li.active-result';
/** Redraw allowance after a dispatched `change`: AngularJS digests asynchronously, so a miss drives the widget itself. */
const WIDGET_REDRAW_TIMEOUT_MS = 2_000;
/** What driving the `<select>` inside the page reported back, kept serialisable for the page boundary. */
type SelectOutcome =
  | {
      readonly status: 'selected';
      readonly selectName: string;
      readonly label: string;
      readonly labels: readonly string[];
    }
  | { readonly status: 'not-select'; readonly selectName: string; readonly labels: readonly string[] }
  | { readonly status: 'missing'; readonly selectName: string; readonly labels: readonly string[] }
  | { readonly status: 'ambiguous'; readonly selectName: string; readonly labels: readonly string[] };
/** Runs inside the legacy page: selects the `<option>` whose trimmed, lower-cased label matches, tells AngularJS and the plugin, and reports what it found. */
function selectOptionText(element: HTMLElement, optionText: string): SelectOutcome {
  if (!(element instanceof HTMLSelectElement)) {
    return { status: 'not-select', selectName: element.tagName.toLowerCase(), labels: [] };
  }
  const labels = Array.from(element.options).map((option) => option.text.trim());
  const selectName = element.name || element.id || element.getAttribute('aria-label') || '<select>';
  const wanted = optionText.trim().toLowerCase();
  const matching = (test: (label: string) => boolean): HTMLOptionElement[] =>
    Array.from(element.options).filter((option) => test(option.text.trim().toLowerCase()));
  const exact = matching((label) => label === wanted);
  const candidates = exact.length > 0 ? exact : matching((label) => label.includes(wanted));
  if (candidates.length === 0) return { status: 'missing', selectName, labels };
  if (candidates.length > 1) return { status: 'ambiguous', selectName, labels };
  const [option] = candidates;
  option.selected = true;
  element.value = option.value;
  // ng-model updates from a bubbling `change`, which is what carries the new value into the legacy form's payload.
  element.dispatchEvent(new Event('change', { bubbles: true }));
  // Chosen repaints its widget only when the legacy page's own `$` is told the select changed, and that copy is already loaded (Rule 1 clause 7) (Rule 1 clause 4).
  const host = window as unknown as {
    $?: (element: Element) => { trigger?: (event: string) => void } | undefined;
  };
  host.$?.(element)?.trigger?.('chosen:updated');
  element.blur();
  return { status: 'selected', selectName, label: option.text.trim(), labels };
}

/** Runs inside the legacy page: the label of every `<option>` in order, or `null` when the locator is not a `<select>`. */
function readOptionLabels(element: HTMLElement): string[] | null {
  if (!(element instanceof HTMLSelectElement)) return null;
  return Array.from(element.options).map((option) => option.text.trim());
}

/** Runs inside the legacy page: the label the widget displays, read from the anchor's `<span>`, never the caret. */
function readSingleLabel(element: HTMLElement): string {
  // `chosen-default` stays on the anchor while it shows the plugin's placeholder, so that state is no selection at all.
  if (element.classList.contains('chosen-default')) return '';
  const label = element.querySelector('span');
  return label === null ? '' : (label.textContent ?? '').trim();
}

/** Runs inside the legacy page: whether the plugin has its dropdown open. */
function isDropOpen(element: HTMLElement): boolean {
  // results_show adds `chosen-with-drop` to the container and results_hide removes it; the dropdown shows from it.
  return element.classList.contains('chosen-with-drop');
}

/** Formats option labels for an error message, which never carries page markup. */
function listLabels(labels: readonly string[]): string {
  return labels.length === 0 ? 'none' : labels.map((label) => `"${label}"`).join(', ');
}

/** The label the chosen widget beside `select` displays, or `''` when no real option is selected. */
async function readWidgetLabel(select: Locator): Promise<string> {
  const anchor = select.locator(CHOSEN_CONTAINER).locator(CHOSEN_SINGLE);
  if ((await anchor.count()) === 0) return '';
  return anchor.first().evaluate(readSingleLabel);
}

/** Whether the widget displays `label` on its anchor, allowing one bounded window for it to repaint. */
async function widgetShows(select: Locator, label: string): Promise<boolean> {
  if (label === '') return (await readWidgetLabel(select)) === '';
  // Scoped to the anchor's label and exact, so a result row of the same text cannot be read as the rendered selection.
  const shown = select.locator(CHOSEN_CONTAINER)
    .locator(`${CHOSEN_SINGLE_LABEL}:text-is(${JSON.stringify(label)})`);
  return shown.first().waitFor({ state: 'visible', timeout: WIDGET_REDRAW_TIMEOUT_MS }).then(
    () => true,
    () => false,
  );
}

/** Opens the widget's dropdown, whichever click the plugin's current state needs. */
async function openChosenDrop(widget: Locator, selectName: string): Promise<void> {
  // Chosen toggles the dropdown on every mousedown in the container, so a click on the anchor opens it the user's way.
  await widget.locator(CHOSEN_SINGLE).click();
  if (await widget.evaluate(isDropOpen)) return;
  // The click landed while the plugin held the field active and closed the dropdown; a click on the container reopens it.
  await widget.click();
  if (await widget.evaluate(isDropOpen)) return;
  throw new Error(`The chosen dropdown on ${selectName} did not open.`);
}

/** Selects a legacy chosen dropdown option by its visible label, verifying the widget's rendered label and driving the dropdown as a user would; a failure names the options, never page markup. */
export async function chooseOption(page: Page, select: Locator, optionText: string): Promise<void> {
  const outcome = await select.evaluate(selectOptionText, optionText);
  if (outcome.status === 'not-select') {
    throw new Error(
      `${outcome.selectName} is not a <select>; pass the locator of the <select> the widget wraps.`,
    );
  }
  if (outcome.status === 'missing' || outcome.status === 'ambiguous') {
    const lead =
      outcome.status === 'missing'
        ? `"${optionText}" matches no option`
        : `"${optionText}" matches more than one option`;
    const advice = outcome.status === 'ambiguous' ? " Pass the option's full label." : '';
    throw new Error(
      `${lead} in the chosen dropdown on ${outcome.selectName}.${advice} ` +
        `Available labels: ${listLabels(outcome.labels)}.`,
    );
  }
  const widget = select.locator(CHOSEN_CONTAINER);
  // Without the widget this select was never enhanced, so the native select is the whole control.
  if ((await widget.count()) === 0) return;
  if (await widgetShows(select, outcome.label)) return;
  await openChosenDrop(widget, outcome.selectName);
  await widget.locator(CHOSEN_RESULT).getByText(outcome.label, { exact: true }).first().click();
  await page.keyboard.press('Escape');
  if (await widgetShows(select, outcome.label)) return;
  const rendered = await readWidgetLabel(select);
  throw new Error(
    `The chosen dropdown on ${outcome.selectName} shows "${
      rendered === '' ? 'no selection' : rendered
    }" after selecting "${outcome.label}".`,
  );
}

/** The visible labels of every option the legacy chosen dropdown offers, in document order. */
export async function readChosenOptions(page: Page, select: Locator): Promise<string[]> {
  const labels = await select.evaluate(readOptionLabels);
  if (labels === null) {
    throw new Error('readChosenOptions needs the legacy <select> the widget wraps, not another element.');
  }
  return labels;
}

/** The label the legacy chosen widget displays, or `''` when nothing is selected: what it renders, not the `<select>`. */
export async function readChosenSelection(page: Page, select: Locator): Promise<string> {
  return readWidgetLabel(select);
}
